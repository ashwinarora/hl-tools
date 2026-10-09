-- Keeping the signer copy true: requests, the lookup queue, the worker, the
-- history log, and the token hook.
--
-- The only thing that ever writes public.treasuries and treasury_signers is
-- private.apply_lookup(), fed by one HTTP call to Hyperliquid's
-- `userToMultiSigSigners`. Lookups are triggered, in priority order, by:
--   0  a signer-set change submitted through the relay and accepted
--   1  somebody adding a treasury, or a signer's browser seeing a difference
--   2  a wallet signing in or renewing its session (the token hook)
--   3  the daily sweep
-- and are paced far below Hyperliquid's documented 60 lookups a minute.

create extension if not exists http with schema extensions;

-- -------------------------------------------------------------------- settings

create table private.settings (
	key text primary key,
	value text not null
);
alter table private.settings enable row level security;

insert into private.settings (key, value) values
	('info_url.mainnet', 'https://api.hyperliquid.xyz/info'),
	('info_url.testnet', 'https://api.hyperliquid-testnet.xyz/info'),
	('worker.enabled', 'true'),
	-- Lookups a minute, all networks together. Half the documented allowance.
	('worker.per_minute', '30');

create function private.setting(p_key text) returns text
language sql stable security definer set search_path = ''
as $$
	select s.value from private.settings s where s.key = p_key
$$;

-- --------------------------------------------------------------------- history

-- Who did what, and when. Written only by triggers and the worker; identifiers
-- only in `data`, never amounts or destinations (those live in the proposal).
create table public.events (
	id bigint generated always as identity primary key,
	network public.network not null,
	treasury public.address not null,
	digest public.hash32,
	kind text not null check (kind in (
		'treasury_added', 'signers_changed', 'treasury_frozen', 'treasury_unfrozen',
		'proposal_created', 'signature_added', 'signature_removed',
		'proposal_withdrawn', 'proposal_declined', 'submission_recorded')),
	-- The wallet that acted; null when the chain did (a signer change seen by a lookup).
	actor public.address,
	data jsonb not null default '{}',
	at timestamptz not null default now(),
	foreign key (network, treasury) references public.treasuries (network, address)
);
create index events_by_treasury on public.events (network, treasury, id desc);
create index events_by_digest on public.events (digest) where digest is not null;

alter table public.events enable row level security;
create policy "signers read their treasuries' history" on public.events
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create function private.log_event(
	p_network public.network,
	p_treasury public.address,
	p_digest public.hash32,
	p_kind text,
	p_actor public.address,
	p_data jsonb default '{}'
) returns void
language sql security definer set search_path = ''
as $$
	insert into public.events (network, treasury, digest, kind, actor, data)
	values (p_network, p_treasury, p_digest, p_kind, p_actor, coalesce(p_data, '{}'))
$$;

-- ----------------------------------------------------------------------- queue

create table private.lookup_queue (
	network public.network not null,
	address public.address not null,
	priority smallint not null check (priority between 0 and 3),
	-- 'add': asked for by a wallet that is not (yet) a stored signer.
	-- 'refresh': everything else. The worker alternates between the two so a
	-- flood of fresh wallets cannot starve the re-checks of real treasuries.
	lane text not null check (lane in ('add', 'refresh')),
	requested_at timestamptz not null default now(),
	not_before timestamptz not null default now(),
	attempts int not null default 0,
	primary key (network, address)
);
create index lookup_queue_next on private.lookup_queue (not_before, priority, requested_at);
alter table private.lookup_queue enable row level security;

create table private.worker_state (
	id boolean primary key default true check (id),
	last_lane text not null default 'refresh',
	blocked_until_mainnet timestamptz,
	blocked_until_testnet timestamptz,
	-- the last step that made a call
	last_run_at timestamptz
);
alter table private.worker_state enable row level security;
insert into private.worker_state default values;

-- One row per HTTP call: the per-minute cap counts these.
create table private.lookup_log (
	id bigint generated always as identity primary key,
	network public.network not null,
	address public.address not null,
	at timestamptz not null default now(),
	http_status int,
	outcome text not null,
	ms int
);
create index lookup_log_at on private.lookup_log (at);
alter table private.lookup_log enable row level security;

-- A treasury is frozen only after two "not a multi-sig" answers at least 30 s
-- apart; this remembers the first.
create table private.treasury_checks (
	network public.network not null,
	address public.address not null,
	null_streak int not null default 0,
	last_null_at timestamptz,
	primary key (network, address)
);
alter table private.treasury_checks enable row level security;

-- Asking twice keeps one row: the more urgent priority, the earlier time, and
-- the 'refresh' lane if either request had it.
create function private.enqueue(
	p_network public.network,
	p_address public.address,
	p_priority int,
	p_lane text,
	p_not_before timestamptz default now()
) returns void
language sql security definer set search_path = ''
as $$
	insert into private.lookup_queue as q (network, address, priority, lane, not_before)
	values (p_network, p_address, p_priority, p_lane, p_not_before)
	on conflict (network, address) do update set
		priority = least(q.priority, excluded.priority),
		lane = case when q.lane = 'refresh' or excluded.lane = 'refresh' then 'refresh' else 'add' end,
		not_before = least(q.not_before, excluded.not_before)
$$;

-- -------------------------------------------------------------------- requests

-- How a browser asks for a lookup. A row, not a function call: RLS decides who
-- may ask, the worker answers by updating `status`, and the asker reads it back.
--   add    "I am a signer of this account, start tracking it"
--   check  "the live signer list differs from yours" (stored signers only)
create table public.treasury_requests (
	id uuid primary key default gen_random_uuid(),
	network public.network not null,
	address public.address not null,
	kind text not null check (kind in ('add', 'check')),
	requested_by public.address not null,
	status text not null default 'pending' check (status in ('pending', 'done', 'rejected', 'failed')),
	-- not_multisig | not_a_signer | lookup_failed
	reason text,
	created_at timestamptz not null default now(),
	finished_at timestamptz
);
create index treasury_requests_by_requester on public.treasury_requests (requested_by, created_at);
create index treasury_requests_pending on public.treasury_requests (network, address) where status = 'pending';

alter table public.treasury_requests enable row level security;

create policy "a wallet reads its own requests" on public.treasury_requests
	for select to authenticated
	using (requested_by = (select private.current_wallet()));

create policy "a wallet asks for itself; only signers ask for a re-check" on public.treasury_requests
	for insert to authenticated
	with check (
		requested_by = (select private.current_wallet())
		and (kind = 'add' or private.is_signer(network, address))
	);

create function private.treasury_request_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
begin
	-- Everything but the three asked-for columns is ours to set.
	new.id := gen_random_uuid();
	new.requested_by := me;
	new.status := 'pending';
	new.reason := null;
	new.created_at := now();
	new.finished_at := null;
	if me is null then
		return new; -- the policy refuses it
	end if;

	if new.kind = 'add' then
		if (select count(*) from public.treasury_requests r
				where r.requested_by = me and r.kind = 'add'
					and r.created_at > now() - interval '1 hour') >= 5 then
			raise exception 'relay.rate_limited'
				using detail = 'A wallet may add 5 treasuries an hour.';
		end if;
		if (select count(*) from public.treasury_requests r
				where r.kind = 'add' and r.status = 'pending') >= 200 then
			raise exception 'relay.busy'
				using detail = 'Too many additions are waiting for a lookup. Try again in a few minutes.';
		end if;
		-- already in the stored list: nothing to look up
		if exists (select 1 from public.treasury_signers s
				where s.network = new.network and s.treasury = new.address and s.signer = me) then
			new.status := 'done';
			new.finished_at := now();
		end if;
	else
		if (select count(*) from public.treasury_requests r
				where r.requested_by = me and r.kind = 'check'
					and r.created_at > now() - interval '1 hour') >= 30 then
			raise exception 'relay.rate_limited'
				using detail = 'A wallet may ask for 30 re-checks an hour.';
		end if;
		-- checked a moment ago: that answer stands
		if exists (select 1 from public.treasuries t
				where t.network = new.network and t.address = new.address
					and t.checked_at > now() - interval '30 seconds') then
			new.status := 'done';
			new.finished_at := now();
		end if;
	end if;
	return new;
end $$;

create function private.treasury_request_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	if new.status = 'pending' then
		perform private.enqueue(new.network, new.address, 1,
			case new.kind when 'add' then 'add' else 'refresh' end);
	end if;
	return null;
end $$;

create trigger treasury_request_before before insert on public.treasury_requests
	for each row execute function private.treasury_request_before();
create trigger treasury_request_after after insert on public.treasury_requests
	for each row execute function private.treasury_request_after();

-- ---------------------------------------------------------------- the one call

-- Reads one answer of `userToMultiSigSigners`. Never raises:
--   policy        a multi-sig: signers (lowercase, sorted) and threshold
--   none          a well-formed "not a multi-sig" (HTTP 200, body `null`)
--   rate_limited  HTTP 429
--   error         anything else: another status, HTML, or a body that is not
--                 exactly what the API documents. Never mistaken for "none",
--                 because "none" twice freezes a treasury.
create function private.parse_signers(p_status int, p_content text)
returns table (outcome text, signers public.address[], threshold int, http_status int)
language plpgsql immutable security definer set search_path = ''
as $$
declare
	body jsonb;
	users text[];
	thr int;
begin
	if p_status = 429 then
		return query select 'rate_limited'::text, null::public.address[], null::int, 429;
		return;
	end if;
	if p_status is distinct from 200 then
		return query select 'error'::text, null::public.address[], null::int, p_status;
		return;
	end if;

	begin
		body := p_content::jsonb;
		if jsonb_typeof(body) = 'null' then
			return query select 'none'::text, null::public.address[], null::int, 200;
			return;
		end if;
		if jsonb_typeof(body) <> 'object'
				or jsonb_typeof(body -> 'authorizedUsers') <> 'array'
				or jsonb_typeof(body -> 'threshold') <> 'number' then
			raise exception 'shape';
		end if;
		select array_agg(lower(u.value #>> '{}') order by lower(u.value #>> '{}')) into users
		from jsonb_array_elements(body -> 'authorizedUsers') u;
		thr := (body ->> 'threshold')::int;
		if users is null
				or cardinality(users) > 10
				or thr < 1 or thr > cardinality(users)
				or (select count(distinct x) from unnest(users) x) <> cardinality(users)
				or exists (select 1 from unnest(users) x where x is null or x !~ '^0x[0-9a-f]{40}$') then
			raise exception 'shape';
		end if;
	exception when others then
		return query select 'error'::text, null::public.address[], null::int, 200;
		return;
	end;

	return query select 'policy'::text, users::public.address[], thr, 200;
end $$;

-- The only network call in the database: asks Hyperliquid who signs for an
-- account. A timeout or a refused connection is an `error`, not an exception.
create function private.fetch_signers(p_network public.network, p_address public.address)
returns table (outcome text, signers public.address[], threshold int, http_status int)
language plpgsql security definer set search_path = ''
as $$
declare
	res record;
begin
	begin
		-- per session, so set on every call: 4 s in total, 2 s to connect
		perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '4000');
		perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '2000');
		select h.status, h.content into res
		from extensions.http_post(
			private.setting('info_url.' || p_network::text),
			jsonb_build_object('type', 'userToMultiSigSigners', 'user', p_address::text)::text,
			'application/json') h;
	exception when others then
		return query select 'error'::text, null::public.address[], null::int, null::int;
		return;
	end;
	return query select * from private.parse_signers(res.status, res.content);
end $$;

-- ------------------------------------------------------------ applying an answer

-- The whole state change for one answer. Returns what happened:
--   added | changed | unchanged | unfrozen | frozen | recheck | rejected
-- `recheck` means "that was the first 'not a multi-sig'; ask again in 30 s".
create function private.apply_lookup(
	p_network public.network,
	p_address public.address,
	p_outcome text,
	p_signers public.address[] default null,
	p_threshold int default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
	t public.treasuries;
	known boolean;
	adder public.address;
	added public.address[];
	removed public.address[];
	chk private.treasury_checks;
	result text;
begin
	select * into t from public.treasuries
	where network = p_network and address = p_address for update;
	known := found;

	if p_outcome = 'policy' then
		if not known then
			-- stored only if somebody who asked is really one of its signers
			select r.requested_by into adder
			from public.treasury_requests r
			where r.network = p_network and r.address = p_address
				and r.kind = 'add' and r.status = 'pending'
				and r.requested_by = any (p_signers)
			order by r.created_at, r.id
			limit 1;
			if adder is null then
				result := 'rejected';
			else
				insert into public.treasuries (network, address, threshold, added_by)
				values (p_network, p_address, p_threshold, adder);
				insert into public.treasury_signers (network, treasury, signer)
				select p_network, p_address, s from unnest(p_signers) s;
				perform private.log_event(p_network, p_address, null, 'treasury_added', adder,
					jsonb_build_object('signers', to_jsonb(p_signers), 'threshold', p_threshold));
				result := 'added';
			end if;
		else
			select coalesce(array_agg(s order by s), '{}') into added
			from unnest(p_signers) s
			where not exists (select 1 from public.treasury_signers ts
				where ts.network = p_network and ts.treasury = p_address and ts.signer = s);
			select coalesce(array_agg(ts.signer order by ts.signer), '{}') into removed
			from public.treasury_signers ts
			where ts.network = p_network and ts.treasury = p_address
				and ts.signer <> all (p_signers);

			delete from public.treasury_signers ts
			where ts.network = p_network and ts.treasury = p_address and ts.signer = any (removed);
			insert into public.treasury_signers (network, treasury, signer)
			select p_network, p_address, s from unnest(added) s;

			result := case
				when cardinality(added) > 0 or cardinality(removed) > 0 or t.threshold <> p_threshold then 'changed'
				when t.frozen_at is not null then 'unfrozen'
				else 'unchanged' end;

			update public.treasuries set
				threshold = p_threshold,
				frozen_at = null,
				checked_at = now(),
				changed_at = case when result = 'unchanged' then changed_at else now() end
			where network = p_network and address = p_address;

			if t.frozen_at is not null then
				perform private.log_event(p_network, p_address, null, 'treasury_unfrozen', null);
			end if;
			if result = 'changed' then
				perform private.log_event(p_network, p_address, null, 'signers_changed', null,
					jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed),
						'threshold_before', t.threshold, 'threshold_after', p_threshold));
			end if;
			delete from private.treasury_checks c where c.network = p_network and c.address = p_address;
		end if;

		update public.treasury_requests r set
			status = case when r.kind = 'check' or r.requested_by = any (p_signers) then 'done' else 'rejected' end,
			reason = case when r.kind = 'check' or r.requested_by = any (p_signers) then null else 'not_a_signer' end,
			finished_at = now()
		where r.network = p_network and r.address = p_address and r.status = 'pending';
		return result;
	end if;

	if p_outcome = 'none' then
		if known and t.frozen_at is null then
			select * into chk from private.treasury_checks c
			where c.network = p_network and c.address = p_address for update;
			if not found or chk.null_streak = 0 or chk.last_null_at is null then
				insert into private.treasury_checks as c (network, address, null_streak, last_null_at)
				values (p_network, p_address, 1, now())
				on conflict (network, address) do update set null_streak = 1, last_null_at = now();
				return 'recheck';
			end if;
			if chk.last_null_at > now() - interval '30 seconds' then
				return 'recheck'; -- too soon after the first to count as a second
			end if;
			update private.treasury_checks c set null_streak = c.null_streak + 1, last_null_at = now()
			where c.network = p_network and c.address = p_address;
			update public.treasuries set frozen_at = now(), checked_at = now(), changed_at = now()
			where network = p_network and address = p_address;
			perform private.log_event(p_network, p_address, null, 'treasury_frozen', null);
			result := 'frozen';
		elsif known then
			update public.treasuries set checked_at = now()
			where network = p_network and address = p_address;
			result := 'unchanged';
		else
			result := 'rejected';
		end if;

		update public.treasury_requests r set
			status = case when r.kind = 'check' then 'done' else 'rejected' end,
			reason = case when r.kind = 'check' then null else 'not_multisig' end,
			finished_at = now()
		where r.network = p_network and r.address = p_address and r.status = 'pending';
		return result;
	end if;

	raise exception 'apply_lookup: unknown outcome %', p_outcome;
end $$;

-- ------------------------------------------------------------------ token hook

-- Appended by the hook each time Supabase Auth issues a token (sign-in or
-- renewal); drained by the worker into re-checks of that wallet's treasuries.
create table private.session_marks (
	id bigint generated always as identity primary key,
	user_id uuid not null,
	at timestamptz not null default now()
);
alter table private.session_marks enable row level security;

-- Custom access token hook. It changes nothing in the token; it only leaves a
-- mark. An error here would stop every sign-in and renewal, so whatever goes
-- wrong is swallowed and the event is returned untouched.
create function private.on_token_issued(event jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		insert into private.session_marks (user_id) values ((event ->> 'user_id')::uuid);
	exception when others then
		null;
	end;
	return event;
end $$;

-- Marks become priority-2 re-checks: the wallet's treasuries not checked in
-- the last 10 minutes, the stalest first, at most 25 per wallet per drain.
create function private.drain_marks() returns int
language plpgsql security definer set search_path = ''
as $$
declare
	n int := 0;
	r record;
begin
	for r in
		with taken as (
			delete from private.session_marks returning user_id
		), wallets as (
			select distinct private.wallet_of(user_id) as wallet from taken
		), ranked as (
			select s.network, s.treasury,
				row_number() over (partition by w.wallet order by t.checked_at) as rn
			from wallets w
			join public.treasury_signers s on s.signer = w.wallet
			join public.treasuries t on t.network = s.network and t.address = s.treasury
			where w.wallet is not null
				and t.checked_at < now() - interval '10 minutes'
		)
		select distinct network, treasury from ranked where rn <= 25
	loop
		perform private.enqueue(r.network, r.treasury, 2, 'refresh');
		n := n + 1;
	end loop;
	return n;
end $$;

-- ---------------------------------------------------------------------- worker

-- One step: at most one HTTP call. Returns what it did, for the log and tests.
create function private.lookup_step() returns text
language plpgsql security definer set search_path = ''
as $$
declare
	st private.worker_state;
	q private.lookup_queue;
	r record;
	result text;
	t0 timestamptz;
begin
	if private.setting('worker.enabled') is distinct from 'true' then
		return 'disabled';
	end if;
	select * into st from private.worker_state for update;

	if (select count(*) from private.lookup_log l where l.at > now() - interval '60 seconds')
			>= coalesce(private.setting('worker.per_minute')::int, 30) then
		perform private.drain_marks();
		return 'capped';
	end if;

	-- an accepted signer change first; then the lane that did not go last; then priority; then age
	select * into q from private.lookup_queue l
	where l.not_before <= now()
		and not (l.network = 'mainnet' and coalesce(st.blocked_until_mainnet, '-infinity') > now())
		and not (l.network = 'testnet' and coalesce(st.blocked_until_testnet, '-infinity') > now())
	order by (l.priority = 0) desc, (l.lane = st.last_lane), l.priority, l.requested_at
	limit 1
	for update skip locked;

	if not found then
		-- nothing written on an idle step: this runs every two seconds
		perform private.drain_marks();
		return 'idle';
	end if;

	t0 := clock_timestamp();
	select * into r from private.fetch_signers(q.network, q.address);
	insert into private.lookup_log (network, address, http_status, outcome, ms)
	values (q.network, q.address, r.http_status, r.outcome,
		(extract(epoch from clock_timestamp() - t0) * 1000)::int);

	if r.outcome = 'rate_limited' then
		-- Hyperliquid said slow down: leave that network alone for a minute, keep the row
		if q.network = 'mainnet' then
			update private.worker_state set blocked_until_mainnet = now() + interval '60 seconds';
		else
			update private.worker_state set blocked_until_testnet = now() + interval '60 seconds';
		end if;
		result := 'rate_limited';
	elsif r.outcome = 'error' then
		if q.attempts + 1 >= 6 then
			delete from private.lookup_queue l where l.network = q.network and l.address = q.address;
			update public.treasury_requests t set status = 'failed', reason = 'lookup_failed', finished_at = now()
			where t.network = q.network and t.address = q.address and t.status = 'pending';
			result := 'gave_up';
		else
			update private.lookup_queue l set
				attempts = q.attempts + 1,
				not_before = now() + least(interval '5 seconds' * power(2, q.attempts), interval '10 minutes')
			where l.network = q.network and l.address = q.address;
			result := 'error';
		end if;
	else
		result := private.apply_lookup(q.network, q.address, r.outcome, r.signers, r.threshold);
		if result = 'recheck' then
			update private.lookup_queue l set
				not_before = now() + interval '30 seconds', attempts = 0, priority = 1, lane = 'refresh'
			where l.network = q.network and l.address = q.address;
		else
			delete from private.lookup_queue l where l.network = q.network and l.address = q.address;
		end if;
		update private.worker_state set last_lane = q.lane;
	end if;

	perform private.drain_marks();
	update private.worker_state set last_run_at = now();
	return result;
end $$;

-- What cron calls. Two runs never overlap: the second one leaves at once.
create function private.run_lookups() returns text
language plpgsql security definer set search_path = ''
as $$
begin
	if not pg_try_advisory_xact_lock(hashtext('hl-tools.relay.lookups')) then
		return 'busy';
	end if;
	return private.lookup_step();
end $$;

-- The safety net: every treasury is re-checked once a day (a frozen one once
-- a week), a few at a time so the checks spread over the day by themselves.
create function private.sweep() returns int
language plpgsql security definer set search_path = ''
as $$
declare
	n int := 0;
	r record;
begin
	for r in
		select t.network, t.address
		from public.treasuries t
		where t.checked_at < now() - case when t.frozen_at is null then interval '24 hours' else interval '7 days' end
			and not exists (select 1 from private.lookup_queue q
				where q.network = t.network and q.address = t.address)
		order by t.checked_at
		limit 20
	loop
		perform private.enqueue(r.network, r.address, 3, 'refresh');
		n := n + 1;
	end loop;
	return n;
end $$;

-- ---------------------------------------------------------------------- grants

revoke all on public.events, public.treasury_requests from anon, authenticated, service_role;
grant select on public.events to authenticated;
grant select on public.treasury_requests to authenticated;
grant insert (network, address, kind) on public.treasury_requests to authenticated;

revoke execute on all functions in schema private from public;

-- Supabase Auth calls the hook as this role, and as nothing else.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.on_token_issued(jsonb) to supabase_auth_admin;
