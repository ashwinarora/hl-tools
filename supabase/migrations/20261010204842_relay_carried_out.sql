-- A proposal that was carried out without the tool.
--
-- A signed proposal is a complete Hyperliquid request: its finaliser can send
-- it from anywhere. When that happens the relay never receives a result, and
-- the proposal would sit under "pending" until it expires. A signer's browser
-- notices (the account's ledger shows a transfer whose transaction is the
-- proposal's own action) and files a report naming the transaction. The relay
-- believes nobody: it asks Hyperliquid's explorer for that transaction itself
-- and closes the proposal only if the account is the treasury, the
-- transaction went through, and its action is the proposal's action, exactly.
--
-- The worker makes these calls from the same queue as the signer look-ups,
-- still one outbound call per step and under the same per-minute cap.

-- ------------------------------------------------------------------- statuses

alter table public.proposals drop constraint proposals_status_check;
alter table public.proposals add constraint proposals_status_check
	check (status in ('open', 'withdrawn', 'declined', 'accepted', 'carried_out'));
-- finding a proposal's twin: the same number in the same treasury
create index proposals_by_nonce on public.proposals (network, treasury, nonce);

alter table public.events drop constraint events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
	'treasury_added', 'signers_changed', 'treasury_frozen', 'treasury_unfrozen',
	'proposal_created', 'signature_added', 'signature_removed',
	'proposal_withdrawn', 'proposal_declined', 'submission_recorded',
	'proposal_carried_out'));

insert into private.settings (key, value) values
	('explorer_url.mainnet', 'https://rpc.hyperliquid.xyz/explorer'),
	('explorer_url.testnet', 'https://rpc.hyperliquid-testnet.xyz/explorer');

-- ---------------------------------------------------------------------- history

-- One treasury's history is written by one transaction at a time, and the
-- lock is held until that transaction commits. Entry ids are handed out
-- inside the lock, so within a treasury they commit in order: an entry with a
-- smaller id can never appear after a reader has seen a larger one. (A
-- signer's "seen up to here" marker depends on this.)
create or replace function private.log_event(
	p_network public.network,
	p_treasury public.address,
	p_digest public.hash32,
	p_kind text,
	p_actor public.address,
	p_data jsonb default '{}'
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
	perform pg_advisory_xact_lock(
		hashtextextended('hl-tools.relay.events:' || p_network::text || ':' || p_treasury::text, 0));
	insert into public.events (network, treasury, digest, kind, actor, data)
	values (p_network, p_treasury, p_digest, p_kind, p_actor, coalesce(p_data, '{}'));
end $$;

-- A status in words, for the refusals a signer reads.
create function private.status_words(p_status text) returns text
language sql immutable security definer set search_path = ''
as $$
	select case p_status when 'carried_out' then 'carried out outside this tool' else p_status end
$$;

create or replace function private.require_open(
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
			using detail = 'This proposal was ' || private.status_words(p.status) || '.';
	end if;
	if p.expires_at <= now() then
		raise exception 'relay.proposal_expired'
			using detail = 'This proposal''s signing window has closed.';
	end if;
	return p;
end $$;

-- As before, with one change of order: the re-check is queued before the
-- history entry is written. Writing the entry takes the treasury's history
-- lock; the worker holds a queue row while it writes entries of its own, so
-- taking the two in the other order could deadlock with it.
create or replace function private.receipt_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	action_type text;
begin
	if new.accepted then
		-- also for a withdrawn, declined or carried-out proposal: the finaliser's own result wins
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
	perform private.log_event(new.network, new.treasury, new.digest, 'submission_recorded', new.submitted_by,
		jsonb_build_object('accepted', new.accepted, 'http_status', new.http_status));
	return null;
end $$;

-- --------------------------------------------------------------------- reports

-- "This transaction carried that proposal out." A row, not a function call:
-- RLS decides who may say so, the worker answers by updating `status`, and
-- the reporter reads the answer back. Nothing a reporter writes is believed;
-- it only tells the worker which transaction to look at.
create table public.execution_reports (
	id uuid primary key default gen_random_uuid(),
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	tx_hash public.hash32 not null,
	reported_by public.address not null,
	status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'failed')),
	-- rejected: accepted | closed | other_account | tx_failed | other_action | ambiguous
	-- failed:   not_found | lookup_failed
	reason text,
	created_at timestamptz not null default now(),
	finished_at timestamptz,
	-- The worker waits this long before looking: a finaliser who submitted
	-- through the tool a moment ago gets to record the result first.
	not_before timestamptz not null default now(),
	attempts int not null default 0,
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);
-- one question at a time per proposal
create unique index execution_reports_one_pending on public.execution_reports (network, treasury, digest)
	where status = 'pending';
-- the same claim is answered once (a look-up that failed may be asked again)
create unique index execution_reports_once on public.execution_reports (network, treasury, digest, tx_hash)
	where status <> 'failed';
-- one transaction carries out one proposal
create unique index execution_reports_one_proposal on public.execution_reports (network, treasury, tx_hash)
	where status = 'confirmed';
create index execution_reports_due on public.execution_reports (not_before) where status = 'pending';
create index execution_reports_by_reporter on public.execution_reports (reported_by, created_at);

alter table public.execution_reports enable row level security;

-- its own, and only while it still signs for that treasury: an answer says
-- what became of a proposal
create policy "a signer reads its own reports" on public.execution_reports
	for select to authenticated
	using (
		reported_by = (select private.current_wallet())
		and (network, treasury) in (select m.network, m.treasury from private.my_treasuries() m)
	);

create policy "a signer reports a transaction, as itself" on public.execution_reports
	for insert to authenticated
	with check (
		reported_by = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

-- Another proposal of the same treasury with the same number and the same
-- action, differing only in who may submit it. Hyperliquid's record of the
-- transaction does not say who submitted, so it cannot tell the two apart.
create function private.has_twin(p public.proposals) returns boolean
language sql stable security definer set search_path = ''
as $$
	select exists (
		select 1 from public.proposals o
		where o.network = p.network and o.treasury = p.treasury
			and o.nonce = p.nonce and o.digest <> p.digest
			and o.document::jsonb #> '{payload,action}' = p.document::jsonb #> '{payload,action}')
$$;

create function private.execution_report_before() returns trigger
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

create trigger execution_report_before before insert on public.execution_reports
	for each row execute function private.execution_report_before();

-- The reporter hears the answer at once (a confirmation also reaches every
-- signer through the history entry).
create function private.execution_report_answered() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	perform private.ping_wallets(array[new.reported_by]);
	return null;
end $$;

create trigger execution_report_answered after update of status on public.execution_reports
	for each row when (old.status is distinct from new.status)
	execute function private.execution_report_answered();

-- ------------------------------------------------------------- the second call

-- Reads one answer of the explorer's `txDetails`. Never raises:
--   tx            a transaction: who it acted for, the action as signed, the
--                 chain's error if it was rejected, its time and its hash
--   unknown       a well-formed "no such transaction" (HTTP 200, type "error")
--   rate_limited  HTTP 429
--   error         anything else. Written as one conjunction that has to come
--                 out true, so a missing field is an error and never a pass.
create function private.parse_tx(p_status int, p_content text)
returns table (outcome text, tx_user text, tx_action jsonb, tx_error text, tx_time bigint, tx_hash text, http_status int)
language plpgsql immutable security definer set search_path = ''
as $$
declare
	body jsonb;
	tx jsonb;
	ok boolean;
begin
	if p_status = 429 then
		return query select 'rate_limited'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 429;
		return;
	end if;
	if p_status is distinct from 200 then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, p_status;
		return;
	end if;

	begin
		body := p_content::jsonb;
		if jsonb_typeof(body) = 'object' and body -> 'type' = '"error"'::jsonb then
			return query select 'unknown'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 200;
			return;
		end if;
		tx := body -> 'tx';
		ok := jsonb_typeof(body) = 'object'
			and body -> 'type' = '"txDetails"'::jsonb
			and jsonb_typeof(tx) = 'object'
			and jsonb_typeof(tx -> 'user') = 'string'
			and lower(tx ->> 'user') ~ '^0x[0-9a-f]{40}$'
			and jsonb_typeof(tx -> 'action') = 'object'
			and jsonb_typeof(tx -> 'hash') = 'string'
			and lower(tx ->> 'hash') ~ '^0x[0-9a-f]{64}$'
			and jsonb_typeof(tx -> 'time') = 'number'
			-- `error` must be there and say one of two things: null, or why it failed
			and tx ? 'error'
			and jsonb_typeof(tx -> 'error') in ('null', 'string');
	exception when others then
		ok := false;
	end;
	if ok is not true then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 200;
		return;
	end if;

	return query select 'tx'::text, lower(tx ->> 'user'), tx -> 'action', tx ->> 'error',
		(tx ->> 'time')::numeric::bigint, lower(tx ->> 'hash'), 200;
end $$;

-- The second network call in the database: asks Hyperliquid's explorer for one
-- transaction. A timeout or a refused connection is an `error`, not an exception.
create function private.fetch_tx(p_network public.network, p_hash public.hash32)
returns table (outcome text, tx_user text, tx_action jsonb, tx_error text, tx_time bigint, tx_hash text, http_status int)
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
			private.setting('explorer_url.' || p_network::text),
			jsonb_build_object('type', 'txDetails', 'hash', p_hash::text)::text,
			'application/json') h;
	exception when others then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, null::int;
		return;
	end;
	return query select * from private.parse_tx(res.status, res.content);
end $$;

-- ------------------------------------------------------------ applying an answer

-- The whole state change for one answer about one report. Returns what happened:
--   report_confirmed  the proposal is closed as carried out
--   report_rejected   it is not that proposal's transaction (or the proposal
--                     was closed meanwhile); final
--   report_retry      the explorer does not know the hash yet, or did not
--                     answer; asked again later
--   report_failed     given up asking
create function private.apply_report(
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

-- ---------------------------------------------------------------------- worker

-- An explorer call weighs twice a signer look-up on Hyperliquid's side, and
-- counts twice against the worker's cap.
alter table private.lookup_log
	add column kind text not null default 'signers' check (kind in ('signers', 'tx')),
	add column units int not null default 1 check (units > 0);

alter table private.worker_state
	add column last_kind text not null default 'tx' check (last_kind in ('signers', 'tx'));

-- One step: at most one HTTP call, a signer look-up or a report. The two take
-- turns when both are waiting, except that an accepted signer-set change
-- always goes first. Returns what it did, for the log and tests.
create or replace function private.lookup_step() returns text
language plpgsql security definer set search_path = ''
as $$
declare
	st private.worker_state;
	q private.lookup_queue;
	have_q boolean;
	rep public.execution_reports;
	have_rep boolean;
	r record;
	result text;
	t0 timestamptz;
begin
	if private.setting('worker.enabled') is distinct from 'true' then
		return 'disabled';
	end if;
	select * into st from private.worker_state for update;

	if (select coalesce(sum(l.units), 0) from private.lookup_log l where l.at > now() - interval '60 seconds')
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
	have_q := found;

	-- the report that has waited longest past its 30 seconds
	select * into rep from public.execution_reports e
	where e.status = 'pending' and e.not_before <= now()
		and not (e.network = 'mainnet' and coalesce(st.blocked_until_mainnet, '-infinity') > now())
		and not (e.network = 'testnet' and coalesce(st.blocked_until_testnet, '-infinity') > now())
	order by e.not_before, e.created_at
	limit 1
	for update skip locked;
	have_rep := found;

	if not have_q and not have_rep then
		-- nothing written on an idle step: this runs every two seconds
		perform private.drain_marks();
		return 'idle';
	end if;

	if have_rep and (not have_q or (q.priority <> 0 and st.last_kind = 'signers')) then
		t0 := clock_timestamp();
		select * into r from private.fetch_tx(rep.network, rep.tx_hash);
		insert into private.lookup_log (network, address, http_status, outcome, ms, kind, units)
		values (rep.network, rep.treasury, r.http_status, r.outcome,
			(extract(epoch from clock_timestamp() - t0) * 1000)::int, 'tx', 2);
		if r.outcome = 'rate_limited' then
			if rep.network = 'mainnet' then
				update private.worker_state set blocked_until_mainnet = now() + interval '60 seconds';
			else
				update private.worker_state set blocked_until_testnet = now() + interval '60 seconds';
			end if;
			result := 'rate_limited';
		else
			result := private.apply_report(rep.id, r.outcome, r.tx_user, r.tx_action, r.tx_error, r.tx_time, r.tx_hash);
		end if;
		perform private.drain_marks();
		update private.worker_state set last_kind = 'tx', last_run_at = now();
		return result;
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
	update private.worker_state set last_kind = 'signers', last_run_at = now();
	return result;
end $$;

-- Housekeeping, as before, and answered reports are kept for a month (the
-- history entry of a confirmed one keeps the transaction hash for good).
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
end $$;

-- ---------------------------------------------------------------------- grants

revoke all on public.execution_reports from anon, authenticated, service_role;
grant select on public.execution_reports to authenticated;
grant insert (network, treasury, digest, tx_hash) on public.execution_reports to authenticated;

revoke execute on all functions in schema private from public;
