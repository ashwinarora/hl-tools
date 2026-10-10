-- Proposals, signatures, endings and submission results.
--
-- A proposal is the Phase 2 document, stored as the exact text the proposer's
-- browser encoded (key order matters to whoever re-verifies it), with its
-- signatures and receipts in their own tables. Nothing here can be edited:
-- a proposal is inserted once, signatures are inserted and deleted by their
-- own signer, endings and receipts are inserted once. The database checks
-- who may do what and that a row is filed under the treasury its document
-- names; it cannot check a digest or a signature, and does not pretend to.
-- Every browser re-verifies both.

-- ------------------------------------------------------------------- proposals

create table public.proposals (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	-- `encodeProposal` text with `signatures: []` and `receipt: null`.
	document text not null check (octet_length(document) <= 32768),
	created_by public.address not null,
	-- The document's outerSigner: the one signer who can submit it.
	finaliser public.address not null,
	nonce bigint not null,
	-- nonce + 2 days: after this the chain refuses it.
	expires_at timestamptz not null,
	status text not null default 'open' check (status in ('open', 'withdrawn', 'declined', 'accepted')),
	closed_at timestamptz,
	created_at timestamptz not null default now(),
	-- The treasury is part of the key: a signer of one treasury cannot occupy
	-- a digest that belongs to another.
	primary key (network, treasury, digest),
	foreign key (network, treasury) references public.treasuries (network, address)
);
create index proposals_open on public.proposals (network, treasury, expires_at) where status = 'open';
create index proposals_by_digest on public.proposals (digest);
create index proposals_by_creator on public.proposals (created_by, created_at);

alter table public.proposals enable row level security;

create policy "signers read their treasuries' proposals" on public.proposals
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "a current signer proposes, as itself" on public.proposals
	for insert to authenticated
	with check (
		created_by = (select private.current_wallet())
		and private.is_signer(network, treasury, true)
	);

create function private.proposal_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	doc jsonb;
	payload jsonb;
	ok boolean;
	now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
	new.created_by := me;
	new.status := 'open';
	new.closed_at := null;
	new.created_at := now();
	-- A stranger learns nothing here: the policy refuses the row.
	if me is null or not private.is_signer(new.network, new.treasury) then
		new.expires_at := now();
		return new;
	end if;
	if not private.is_signer(new.network, new.treasury, true) then
		raise exception 'relay.treasury_frozen'
			using detail = 'This account is no longer a multi-sig, so nothing new can be proposed for it.';
	end if;

	-- The row must be filed where its document says it belongs. Written as one
	-- conjunction that has to come out true: a missing field makes it null,
	-- which is a refusal like any other.
	begin
		doc := new.document::jsonb;
		payload := doc -> 'payload';
		ok := jsonb_typeof(doc) = 'object'
			and (select array_agg(k order by k) from jsonb_object_keys(doc) k)
				= array['digest', 'meta', 'payload', 'receipt', 'signatures', 'v']
			and doc -> 'v' = '1'::jsonb
			and doc -> 'signatures' = '[]'::jsonb
			and jsonb_typeof(doc -> 'receipt') = 'null'
			and jsonb_typeof(doc -> 'meta') = 'object'
			and jsonb_typeof(payload) = 'object'
			and jsonb_typeof(payload -> 'action') = 'object'
			and jsonb_typeof(payload -> 'action' -> 'type') = 'string'
			and payload -> 'action' ->> 'type' <> 'multiSig'
			and jsonb_typeof(payload -> 'nonce') = 'number'
			and doc -> 'digest' = to_jsonb(new.digest::text)
			and payload -> 'network' = to_jsonb(new.network::text)
			and payload -> 'multiSigUser' = to_jsonb(new.treasury::text)
			and payload -> 'outerSigner' = to_jsonb(new.finaliser::text)
			and (payload ->> 'nonce')::numeric = new.nonce
			-- user-signed actions only: vault and expiry are outside their digest
			and doc -> 'meta' -> 'kind' = '"user-signed"'::jsonb
			and jsonb_typeof(payload -> 'vaultAddress') = 'null'
			and jsonb_typeof(payload -> 'expiresAfter') = 'null';
	exception when others then
		ok := false;
	end;
	if ok is not true then
		raise exception 'relay.document_mismatch'
			using detail = 'The document is not a bare user-signed proposal for this network, treasury, finaliser, nonce and digest.';
	end if;

	if not exists (select 1 from public.treasury_signers s
			where s.network = new.network and s.treasury = new.treasury and s.signer = new.finaliser) then
		raise exception 'relay.finaliser_not_signer'
			using detail = 'The finaliser must be one of the treasury''s current signers.';
	end if;

	-- Valid on chain from nonce - 1 day until nonce + 2 days.
	if new.nonce <= now_ms - 172800000 then
		raise exception 'relay.proposal_expired'
			using detail = 'This proposal''s signing window has already closed.';
	end if;
	if new.nonce > now_ms + 86400000 + 300000 then
		raise exception 'relay.nonce_too_far'
			using detail = 'The nonce is more than a day ahead; the chain would not accept it yet.';
	end if;
	new.expires_at := to_timestamp((new.nonce + 172800000) / 1000.0);

	if (select count(*) from public.proposals p
			where p.created_by = me and p.created_at > now() - interval '1 hour') >= 30 then
		raise exception 'relay.rate_limited'
			using detail = 'A wallet may share 30 proposals an hour.';
	end if;
	if (select count(*) from public.proposals p
			where p.network = new.network and p.treasury = new.treasury
				and p.status = 'open' and p.expires_at > now()) >= 50 then
		raise exception 'relay.pending_cap'
			using detail = 'This treasury already has 50 pending proposals.';
	end if;
	if (select count(*) from public.proposals p
			where p.network = new.network and p.treasury = new.treasury and p.created_by = me
				and p.status = 'open' and p.expires_at > now()) >= 20 then
		raise exception 'relay.pending_cap'
			using detail = 'You already have 20 pending proposals for this treasury.';
	end if;
	return new;
end $$;

create function private.proposal_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	perform private.log_event(new.network, new.treasury, new.digest, 'proposal_created', new.created_by,
		jsonb_build_object('finaliser', new.finaliser));
	return null;
end $$;

create trigger proposal_before before insert on public.proposals
	for each row execute function private.proposal_before();
create trigger proposal_after after insert on public.proposals
	for each row execute function private.proposal_after();

-- ------------------------------------------------------------------ signatures

-- One per signer per proposal, as the chain counts them. A row is a claim:
-- "this is my signature". Browsers recover the signer from r, s, v and ignore
-- a row that does not recover to its `signer`.
create table public.signatures (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	signer public.address not null,
	r public.hash32 not null,
	s public.hash32 not null,
	v smallint not null check (v in (27, 28)),
	created_at timestamptz not null default now(),
	primary key (network, treasury, digest, signer),
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);

alter table public.signatures enable row level security;

create policy "signers read their treasuries' signatures" on public.signatures
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "a current signer adds its own signature" on public.signatures
	for insert to authenticated
	with check (
		signer = (select private.current_wallet())
		and private.is_signer(network, treasury, true)
	);

create policy "a signer takes back its own signature" on public.signatures
	for delete to authenticated
	using (
		signer = (select private.current_wallet())
		and (network, treasury) in (select m.network, m.treasury from private.my_treasuries() m)
	);

-- Shared by signatures and endings: the proposal must still be collecting.
create function private.require_open(
	p_network public.network, p_treasury public.address, p_digest public.hash32
) returns public.proposals
language plpgsql security definer set search_path = ''
as $$
declare
	p public.proposals;
begin
	select * into p from public.proposals
	where network = p_network and treasury = p_treasury and digest = p_digest
	for update;
	if not found then
		return null;
	end if;
	if p.status <> 'open' then
		raise exception 'relay.proposal_closed'
			using detail = 'This proposal was ' || p.status || '.';
	end if;
	if p.expires_at <= now() then
		raise exception 'relay.proposal_expired'
			using detail = 'This proposal''s signing window has closed.';
	end if;
	return p;
end $$;

create function private.signature_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
begin
	if tg_op = 'INSERT' then
		new.signer := me;
		new.created_at := now();
		if me is not null and private.is_signer(new.network, new.treasury) then
			if not private.is_signer(new.network, new.treasury, true) then
				raise exception 'relay.treasury_frozen'
					using detail = 'This account is no longer a multi-sig, so nothing new can be signed for it.';
			end if;
			perform private.require_open(new.network, new.treasury, new.digest);
		end if;
		return new;
	end if;
	-- DELETE: after submission or expiry a signature can no longer be taken back
	perform private.require_open(old.network, old.treasury, old.digest);
	return old;
end $$;

create function private.signature_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform private.log_event(new.network, new.treasury, new.digest, 'signature_added', new.signer);
	else
		-- not when the whole proposal is being removed by an operator
		if exists (select 1 from public.proposals p
				where p.network = old.network and p.treasury = old.treasury and p.digest = old.digest) then
			perform private.log_event(old.network, old.treasury, old.digest, 'signature_removed', old.signer);
		end if;
	end if;
	return null;
end $$;

create trigger signature_before before insert or delete on public.signatures
	for each row execute function private.signature_before();
create trigger signature_after after insert or delete on public.signatures
	for each row execute function private.signature_after();

-- --------------------------------------------------------------------- endings

-- A shared signal, not a cancellation: signatures already given stay valid on
-- chain until the window closes, and only the finaliser can submit. The
-- proposer may withdraw; the finaliser may decline. Neither can be undone.
create table public.endings (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	kind text not null check (kind in ('withdrawn', 'declined')),
	ended_by public.address not null,
	ended_at timestamptz not null default now(),
	primary key (network, treasury, digest),
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);

alter table public.endings enable row level security;

create policy "signers read their treasuries' endings" on public.endings
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "a signer ends a proposal, as itself" on public.endings
	for insert to authenticated
	with check (
		ended_by = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

create function private.ending_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	p public.proposals;
begin
	new.ended_by := me;
	new.ended_at := now();
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	p := private.require_open(new.network, new.treasury, new.digest);
	if p.digest is null then
		return new; -- the foreign key refuses it
	end if;
	if new.kind = 'withdrawn' and p.created_by <> me then
		raise exception 'relay.not_proposer'
			using detail = 'Only the wallet that proposed it can withdraw a proposal.';
	end if;
	if new.kind = 'declined' and p.finaliser <> me then
		raise exception 'relay.not_finaliser'
			using detail = 'Only the finaliser can decline a proposal.';
	end if;
	return new;
end $$;

create function private.ending_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	update public.proposals set status = new.kind, closed_at = now()
	where network = new.network and treasury = new.treasury and digest = new.digest;
	perform private.log_event(new.network, new.treasury, new.digest,
		case new.kind when 'withdrawn' then 'proposal_withdrawn' else 'proposal_declined' end, new.ended_by);
	return null;
end $$;

create trigger ending_before before insert on public.endings
	for each row execute function private.ending_before();
create trigger ending_after after insert on public.endings
	for each row execute function private.ending_after();

-- -------------------------------------------------------------------- receipts

-- What Hyperliquid answered when the finaliser submitted, as reported by the
-- finaliser's browser. The relay cannot verify it (it never talks to the
-- exchange), so it is shown as a report, next to a link to the ledger.
-- `response` is the exact text the browser encoded: jsonb would reorder keys.
create table public.receipts (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	-- unix ms, from the document
	submitted_at bigint not null check (submitted_at > 0),
	submitted_by public.address not null,
	signature_chain_id text not null check (signature_chain_id ~ '^0x[0-9a-f]{1,16}$'),
	outer_r public.hash32 not null,
	outer_s public.hash32 not null,
	outer_v smallint not null check (outer_v in (27, 28)),
	http_status int not null check (http_status between 0 and 999),
	response text not null check (octet_length(response) <= 8192),
	accepted boolean not null,
	recorded_at timestamptz not null default now(),
	primary key (network, treasury, digest, submitted_at),
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);

alter table public.receipts enable row level security;

create policy "signers read their treasuries' receipts" on public.receipts
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "the finaliser records the result, as itself" on public.receipts
	for insert to authenticated
	with check (
		submitted_by = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

-- The same rule as the browser's `receiptOk`: HTTP 200, `status: "ok"`, and no
-- per-item error in `response.data.statuses`. Text that is not JSON is a rejection.
create function private.response_accepted(p_http_status int, p_response text) returns boolean
language plpgsql immutable security definer set search_path = ''
as $$
declare
	b jsonb;
	statuses jsonb;
begin
	if p_http_status is distinct from 200 then
		return false;
	end if;
	b := p_response::jsonb;
	if jsonb_typeof(b) <> 'object' or b -> 'status' is distinct from '"ok"'::jsonb then
		return false;
	end if;
	statuses := b #> '{response,data,statuses}';
	if jsonb_typeof(statuses) = 'array' then
		return not exists (
			select 1 from jsonb_array_elements(statuses) s
			where jsonb_typeof(s) = 'object' and jsonb_typeof(s -> 'error') = 'string');
	end if;
	return true;
exception when others then
	return false;
end $$;

create function private.receipt_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	p public.proposals;
begin
	new.submitted_by := me;
	new.recorded_at := now();
	new.accepted := private.response_accepted(new.http_status, new.response);
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	select * into p from public.proposals
	where network = new.network and treasury = new.treasury and digest = new.digest
	for update;
	if not found then
		return new; -- the foreign key refuses it
	end if;
	if p.finaliser <> me then
		raise exception 'relay.not_finaliser'
			using detail = 'Only the finaliser can record a submission.';
	end if;
	if p.status = 'accepted' then
		raise exception 'relay.proposal_closed'
			using detail = 'This proposal was already accepted.';
	end if;
	if (select count(*) from public.receipts r
			where r.network = new.network and r.treasury = new.treasury and r.digest = new.digest) >= 20 then
		raise exception 'relay.rate_limited'
			using detail = 'A proposal keeps at most 20 submission attempts.';
	end if;
	return new;
end $$;

create function private.receipt_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	action_type text;
begin
	perform private.log_event(new.network, new.treasury, new.digest, 'submission_recorded', new.submitted_by,
		jsonb_build_object('accepted', new.accepted, 'http_status', new.http_status));
	if new.accepted then
		-- also for a withdrawn or declined proposal: what happened on chain wins
		update public.proposals set status = 'accepted', closed_at = now()
		where network = new.network and treasury = new.treasury and digest = new.digest;
		-- a signer-set change made through the relay is re-checked ahead of everything else
		select p.document::jsonb -> 'payload' -> 'action' ->> 'type' into action_type
		from public.proposals p
		where p.network = new.network and p.treasury = new.treasury and p.digest = new.digest;
		if action_type = 'convertToMultiSigUser' then
			perform private.enqueue(new.network, new.treasury, 0, 'refresh');
		end if;
	end if;
	return null;
end $$;

create trigger receipt_before before insert on public.receipts
	for each row execute function private.receipt_before();
create trigger receipt_after after insert on public.receipts
	for each row execute function private.receipt_after();

-- ---------------------------------------------------------------------- grants

revoke all on public.proposals, public.signatures, public.endings, public.receipts
	from anon, authenticated, service_role;

grant select on public.proposals, public.signatures, public.endings, public.receipts to authenticated;
grant insert (network, treasury, digest, document, finaliser, nonce) on public.proposals to authenticated;
grant insert (network, treasury, digest, r, s, v) on public.signatures to authenticated;
grant delete on public.signatures to authenticated;
grant insert (network, treasury, digest, kind) on public.endings to authenticated;
grant insert (network, treasury, digest, submitted_at, signature_chain_id, outer_r, outer_s, outer_v, http_status, response)
	on public.receipts to authenticated;

revoke execute on all functions in schema private from public;
