-- Vault deposits and withdrawals.
--
-- Until now the relay stored one kind of proposal: a user-signed action,
-- which a wallet shows field by field. A vault deposit or withdrawal
-- (`vaultTransfer`) is the other kind, an L1 action: signers sign a hash of
-- it. The relay takes exactly that one L1 action, in exactly its shape, and
-- nothing else of that family (orders, cancels, leverage, sub-accounts stay
-- out). As before the relay checks where a document is filed and what shape
-- it has; whether a digest or a signature is right is for every browser to
-- verify, and every browser does.
--
-- One thing does change for the relay itself. A user-signed action carries a
-- number of its own (`nonce` or `time`), so Hyperliquid's record of a
-- transaction says which proposal it was, and "this was carried out without
-- the tool" can be checked against the explorer. A vault action carries no
-- number: two deposits of the same amount into the same vault are the same
-- action, whoever made them, the treasury's own API wallet included. So a
-- report about such a proposal is not accepted, and the worker would not act
-- on one: a vault proposal is closed by its finaliser's own result, or by its
-- proposer withdrawing it.

-- ------------------------------------------------------------------- documents

-- The one L1 action stored here, in its exact shape: no field more, none
-- less. `usd` is a whole positive number of millionths of a dollar.
create function private.is_vault_action(p_action jsonb) returns boolean
language sql immutable security definer set search_path = ''
as $$
	select coalesce(
		jsonb_typeof(p_action) = 'object'
		and (select array_agg(k order by k) from jsonb_object_keys(p_action) k)
			= array['isDeposit', 'type', 'usd', 'vaultAddress']
		and p_action -> 'type' = '"vaultTransfer"'::jsonb
		and jsonb_typeof(p_action -> 'isDeposit') = 'boolean'
		and jsonb_typeof(p_action -> 'usd') = 'number'
		and (p_action ->> 'usd') ~ '^[1-9][0-9]{0,15}$'
		and jsonb_typeof(p_action -> 'vaultAddress') = 'string'
		and (p_action ->> 'vaultAddress') ~ '^0x[0-9a-f]{40}$',
		false)
$$;

create or replace function private.proposal_before() returns trigger
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
			-- nothing beside the action: acting for a vault or a sub-account, and
			-- an expiry, are other uses of the L1 family and stay out
			and jsonb_typeof(payload -> 'vaultAddress') = 'null'
			and jsonb_typeof(payload -> 'expiresAfter') = 'null'
			-- The kind has to be the action's own: a vault deposit or withdrawal
			-- is the one L1 action taken, in its exact shape, and it is never
			-- filed as user-signed; every other action is user-signed.
			and case payload -> 'action' ->> 'type'
				when 'vaultTransfer' then
					doc -> 'meta' -> 'kind' = '"l1"'::jsonb
					and private.is_vault_action(payload -> 'action')
				else doc -> 'meta' -> 'kind' = '"user-signed"'::jsonb
			end;
	exception when others then
		ok := false;
	end;
	if ok is not true then
		raise exception 'relay.document_mismatch'
			using detail = 'The document is not a bare proposal for this network, treasury, finaliser, nonce and digest: a user-signed action, or a vault deposit or withdrawal.';
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

-- --------------------------------------------------- "carried out without the tool"

-- Whether a proposal's action carries the proposal's number inside itself
-- (`nonce`, or `time` for the older sends and a bridge withdrawal). Decided
-- by the action, never by what the document calls its kind: only then does
-- Hyperliquid's record of a transaction say which proposal it was.
create function private.has_own_number(p public.proposals) returns boolean
language sql stable security definer set search_path = ''
as $$
	select coalesce((
		select case when jsonb_typeof(a -> 'nonce') = 'number' then (a ->> 'nonce')::numeric = p.nonce else false end
			or case when jsonb_typeof(a -> 'time') = 'number' then (a ->> 'time')::numeric = p.nonce else false end
		from (select p.document::jsonb #> '{payload,action}' as a) x
	), false)
$$;

create or replace function private.execution_report_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	p public.proposals;
begin
	-- Everything but the four asked-for columns is ours to set.
	new.id := gen_random_uuid();
	new.reported_by := me;
	new.status := 'pending';
	new.reason := null;
	new.created_at := now();
	new.finished_at := null;
	new.not_before := now() + interval '30 seconds';
	new.attempts := 0;
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	select * into p from public.proposals
	where network = new.network and treasury = new.treasury and digest = new.digest;
	if not found then
		return new; -- the foreign key refuses it
	end if;
	if p.status in ('accepted', 'carried_out') then
		raise exception 'relay.proposal_closed'
			using detail = 'This proposal was already ' || private.status_words(p.status) || '.';
	end if;
	-- before the limit is counted: nothing is asked of the explorer for it
	if not private.has_own_number(p) then
		raise exception 'relay.report_unnumbered'
			using detail = 'This action carries no number of its own, so Hyperliquid''s record of a transaction cannot say which proposal it came from.';
	end if;
	if private.has_twin(p) then
		raise exception 'relay.report_ambiguous'
			using detail = 'Another proposal has the same action and number with a different finaliser. Hyperliquid''s record cannot tell which one was carried out.';
	end if;
	if (select count(*) from public.execution_reports r
			where r.reported_by = me and r.created_at > now() - interval '1 hour') >= 10 then
		raise exception 'relay.rate_limited'
			using detail = 'A wallet may report 10 transactions an hour.';
	end if;
	return new;
end $$;

-- The same rule where the answer is applied: whatever row the worker is
-- handed, a transaction never closes a proposal whose action it cannot be
-- told apart by. (`reason` gains `unnumbered`; it is free text, listed in the
-- table's comment.)
create or replace function private.apply_report(
	p_id uuid,
	p_outcome text,
	p_user text default null,
	p_action jsonb default null,
	p_error text default null,
	p_time bigint default null,
	p_hash text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
	rep public.execution_reports;
	p public.proposals;
	why text;
	give_up_after int;
begin
	select * into rep from public.execution_reports where id = p_id for update;
	if not found or rep.status <> 'pending' then
		return 'report_gone';
	end if;
	select * into p from public.proposals
	where network = rep.network and treasury = rep.treasury and digest = rep.digest
	for update;

	-- closed while the report waited: the finaliser's own result, or another report
	if p.status = 'accepted' then
		why := 'accepted';
	elsif p.status = 'carried_out' then
		why := 'closed';
	elsif not private.has_own_number(p) then
		why := 'unnumbered';
	elsif p_outcome in ('unknown', 'error') then
		-- "not known yet" a few times is normal right after a transaction; a
		-- call that fails is tried a little longer
		give_up_after := case p_outcome when 'unknown' then 5 else 6 end;
		if rep.attempts + 1 >= give_up_after then
			update public.execution_reports set
				status = 'failed',
				reason = case p_outcome when 'unknown' then 'not_found' else 'lookup_failed' end,
				attempts = rep.attempts + 1,
				finished_at = now()
			where id = rep.id;
			return 'report_failed';
		end if;
		update public.execution_reports set
			attempts = rep.attempts + 1,
			not_before = now() + least(interval '15 seconds' * power(2, rep.attempts), interval '10 minutes')
		where id = rep.id;
		return 'report_retry';
	elsif p_outcome <> 'tx' then
		raise exception 'apply_report: unknown outcome %', p_outcome;
	elsif p_hash is distinct from rep.tx_hash::text or p_user is distinct from rep.treasury::text then
		why := 'other_account';
	elsif p_error is not null then
		why := 'tx_failed';
	elsif p_action is null or p_action <> p.document::jsonb #> '{payload,action}' then
		why := 'other_action';
	elsif private.has_twin(p) then
		why := 'ambiguous';
	end if;

	if why is not null then
		update public.execution_reports set status = 'rejected', reason = why, finished_at = now()
		where id = rep.id;
		return 'report_rejected';
	end if;

	-- from open (expired or not), withdrawn or declined: what happened on chain wins
	update public.proposals set status = 'carried_out', closed_at = now()
	where network = p.network and treasury = p.treasury and digest = p.digest;
	update public.execution_reports set status = 'confirmed', finished_at = now()
	where id = rep.id;
	-- queue first, write history second (see receipt_after)
	if p_action ->> 'type' = 'convertToMultiSigUser' then
		perform private.enqueue(p.network, p.treasury, 0, 'refresh');
	end if;
	-- no actor: who sent it is exactly what nobody here knows
	perform private.log_event(p.network, p.treasury, p.digest, 'proposal_carried_out', null,
		jsonb_build_object('tx_hash', rep.tx_hash, 'tx_time', p_time, 'reported_by', rep.reported_by));
	return 'report_confirmed';
end $$;

comment on column public.execution_reports.reason is
	'rejected: accepted | closed | unnumbered | other_account | tx_failed | other_action | ambiguous; failed: not_found | lookup_failed';

revoke execute on all functions in schema private from public;
