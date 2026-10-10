-- Attention: who has seen a proposal, and what a signer has already been told.
--
-- Two small facts, kept very differently:
--
--   proposal_views   "this signer has opened that proposal". Shared with the
--                    treasury's signers: a proposer waiting for signatures
--                    can tell "not seen yet" from "seen, not signed".
--   read_marks       "this signer has read the treasury's news up to here".
--                    The signer's own: no co-signer can read it. It is what
--                    "While you were away" is counted from, on every device
--                    the signer uses.
--
-- Both are rows a browser inserts and nothing edits.

-- ------------------------------------------------------------------- views

create table public.proposal_views (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	signer public.address not null,
	seen_at timestamptz not null default now(),
	primary key (network, treasury, digest, signer),
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);
create index proposal_views_by_signer on public.proposal_views (signer, seen_at);

alter table public.proposal_views enable row level security;

create policy "signers read who has seen their treasuries' proposals" on public.proposal_views
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "a signer records its own view" on public.proposal_views
	for insert to authenticated
	with check (
		signer = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

-- Opening a proposal a second time, or one that is already closed, is not
-- worth a row or an error: the insert is quietly dropped.
create function private.proposal_view_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	p public.proposals;
begin
	new.signer := me;
	new.seen_at := now();
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	select * into p from public.proposals
	where network = new.network and treasury = new.treasury and digest = new.digest;
	if not found then
		return new; -- the foreign key refuses it
	end if;
	if p.status <> 'open' or p.expires_at <= now() then
		return null;
	end if;
	if exists (select 1 from public.proposal_views v
			where v.network = new.network and v.treasury = new.treasury
				and v.digest = new.digest and v.signer = me) then
		return null;
	end if;
	return new;
end $$;

-- A first view tells the treasury's signers (the proposer's page shows it at once).
create function private.proposal_view_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	targets public.address[];
begin
	select array_agg(s.signer) into targets
	from public.treasury_signers s
	where s.network = new.network and s.treasury = new.treasury;
	perform private.ping_wallets(targets);
	return null;
end $$;

create trigger proposal_view_before before insert on public.proposal_views
	for each row execute function private.proposal_view_before();
create trigger proposal_view_after after insert on public.proposal_views
	for each row execute function private.proposal_view_after();

-- -------------------------------------------------------------------- marks

-- "Got it": everything up to history entry `event_id` of this treasury has
-- been read by this wallet. `chain` carries the same for what only
-- Hyperliquid knows and the relay cannot check: the time up to which the
-- signer has seen the account's transfers, and the API wallets it knew of.
-- Append-only: the newest row per (wallet, treasury) is the marker, and it
-- only ever moves forward.
create table public.read_marks (
	id bigint generated always as identity primary key,
	wallet public.address not null,
	network public.network not null,
	treasury public.address not null,
	event_id bigint not null check (event_id >= 0),
	chain jsonb not null default '{}',
	marked_at timestamptz not null default now(),
	foreign key (network, treasury) references public.treasuries (network, address)
);
create index read_marks_latest on public.read_marks (wallet, network, treasury, id desc);

alter table public.read_marks enable row level security;

create policy "a signer reads its own markers" on public.read_marks
	for select to authenticated
	using (
		wallet = (select private.current_wallet())
		and (network, treasury) in (select m.network, m.treasury from private.my_treasuries() m)
	);

create policy "a signer moves its own marker" on public.read_marks
	for insert to authenticated
	with check (
		wallet = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

-- Whether `chain` is what a marker may carry: an object with at most
--   ledgerTime  unix ms, a whole number, not in the future beyond a day
--   agents      up to 50 lowercase addresses, no repeats
-- and nothing else. Written as one conjunction that has to come out true.
create function private.mark_chain_ok(p_chain jsonb) returns boolean
language plpgsql immutable security definer set search_path = ''
as $$
declare
	ok boolean;
begin
	begin
		ok := jsonb_typeof(p_chain) = 'object'
			and octet_length(p_chain::text) <= 4096
			and not exists (select 1 from jsonb_object_keys(p_chain) k where k not in ('ledgerTime', 'agents'))
			and (not p_chain ? 'ledgerTime' or (
				jsonb_typeof(p_chain -> 'ledgerTime') = 'number'
				and (p_chain ->> 'ledgerTime')::numeric >= 0
				and (p_chain ->> 'ledgerTime')::numeric = trunc((p_chain ->> 'ledgerTime')::numeric)
				and (p_chain ->> 'ledgerTime')::numeric <= (extract(epoch from now()) * 1000) + 86400000))
			and (not p_chain ? 'agents' or (
				jsonb_typeof(p_chain -> 'agents') = 'array'
				and jsonb_array_length(p_chain -> 'agents') <= 50
				and not exists (select 1 from jsonb_array_elements(p_chain -> 'agents') a
					where jsonb_typeof(a) <> 'string' or (a #>> '{}') !~ '^0x[0-9a-f]{40}$')
				and (select count(distinct a #>> '{}') from jsonb_array_elements(p_chain -> 'agents') a)
					= jsonb_array_length(p_chain -> 'agents')));
	exception when others then
		ok := false;
	end;
	return ok is true;
end $$;

create function private.read_mark_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	prev public.read_marks;
	newest bigint;
begin
	new.wallet := me;
	new.marked_at := now();
	new.chain := coalesce(new.chain, '{}'::jsonb);
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	if new.event_id is null or new.event_id < 0 or not private.mark_chain_ok(new.chain) then
		raise exception 'relay.mark_invalid'
			using detail = 'A marker carries a history entry and, optionally, a ledger time and a list of API wallets.';
	end if;

	-- one writer at a time per wallet and treasury: "Got it" on two devices at once
	perform pg_advisory_xact_lock(
		hashtextextended('hl-tools.relay.marks:' || me::text || ':' || new.network::text || ':' || new.treasury::text, 0));

	select coalesce(max(e.id), 0) into newest from public.events e
	where e.network = new.network and e.treasury = new.treasury;
	if new.event_id > newest then
		raise exception 'relay.mark_invalid'
			using detail = 'A marker cannot point past the newest history entry.';
	end if;

	select * into prev from public.read_marks m
	where m.wallet = me and m.network = new.network and m.treasury = new.treasury
	order by m.id desc limit 1;
	if found then
		-- a marker only moves forward; one that would move back is quietly brought level
		new.event_id := greatest(new.event_id, prev.event_id);
		if prev.chain ? 'ledgerTime' and (
				not new.chain ? 'ledgerTime'
				or (new.chain ->> 'ledgerTime')::numeric < (prev.chain ->> 'ledgerTime')::numeric) then
			new.chain := new.chain || jsonb_build_object('ledgerTime', prev.chain -> 'ledgerTime');
		end if;
		if prev.chain ? 'agents' and not new.chain ? 'agents' then
			new.chain := new.chain || jsonb_build_object('agents', prev.chain -> 'agents');
		end if;
	end if;

	if (select count(*) from public.read_marks m
			where m.wallet = me and m.marked_at > now() - interval '1 hour') >= 600 then
		raise exception 'relay.rate_limited'
			using detail = 'A wallet may move its markers 600 times an hour.';
	end if;
	return new;
end $$;

-- The signer's other open pages (another tab, another device) read the marker again.
create function private.read_mark_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	perform private.ping_wallets(array[new.wallet]);
	return null;
end $$;

create trigger read_mark_before before insert on public.read_marks
	for each row execute function private.read_mark_before();
create trigger read_mark_after after insert on public.read_marks
	for each row execute function private.read_mark_after();

-- ---------------------------------------------------------------- housekeeping

-- As before, and: a wallet's superseded markers go after a month (the newest
-- per treasury is the marker and is kept), the record of nickname changes
-- after a year.
create or replace function private.prune() returns void
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		delete from cron.job_run_details where end_time < now() - interval '6 hours';
	exception when others then
		null; -- not ours to fail on
	end;
	delete from private.lookup_log where at < now() - interval '7 days';
	delete from private.session_marks where at < now() - interval '1 hour';
	delete from public.treasury_requests
	where status <> 'pending' and finished_at < now() - interval '7 days';
	-- a request left waiting for a day with nothing queued for it will never be answered
	update public.treasury_requests r set status = 'failed', reason = 'lookup_failed', finished_at = now()
	where r.status = 'pending' and r.created_at < now() - interval '1 day'
		and not exists (select 1 from private.lookup_queue q
			where q.network = r.network and q.address = r.address);
	delete from public.execution_reports
	where status <> 'pending' and finished_at < now() - interval '30 days';
	delete from public.read_marks m
	where m.marked_at < now() - interval '30 days'
		and exists (select 1 from public.read_marks n
			where n.wallet = m.wallet and n.network = m.network and n.treasury = m.treasury and n.id > m.id);
	delete from public.nickname_changes where changed_at < now() - interval '365 days';
end $$;

-- ---------------------------------------------------------------------- grants

revoke all on public.proposal_views, public.read_marks from anon, authenticated, service_role;
grant select on public.proposal_views, public.read_marks to authenticated;
grant insert (network, treasury, digest) on public.proposal_views to authenticated;
grant insert (network, treasury, event_id, chain) on public.read_marks to authenticated;

revoke execute on all functions in schema private from public;
