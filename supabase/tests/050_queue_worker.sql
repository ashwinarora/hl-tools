-- The worker: what it picks, how it paces itself, what it does with each outcome.
-- Hyperliquid is replaced by scripted answers; the real call is covered by the
-- integration suite.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

create table tests.answers (
	id serial primary key, address public.address, outcome text,
	signers public.address[], threshold int, http_status int);
create table tests.calls (id serial primary key, network public.network, address public.address);

create or replace function private.fetch_signers(p_network public.network, p_address public.address)
returns table (outcome text, signers public.address[], threshold int, http_status int)
language plpgsql security definer set search_path = ''
as $$
declare
	a tests.answers;
begin
	insert into tests.calls (network, address) values (p_network, p_address);
	select * into a from tests.answers t where t.address = p_address order by t.id limit 1;
	if not found then
		return query select 'error'::text, null::public.address[], null::int, null::int;
		return;
	end if;
	delete from tests.answers t where t.id = a.id;
	return query select a.outcome, a.signers, a.threshold, a.http_status;
end $$;

create function tests.answer(n int, p_outcome text, p_signers public.address[] default null, p_threshold int default null) returns void
language sql as $$
	insert into tests.answers (address, outcome, signers, threshold, http_status)
	values (tests.addr(n), p_outcome, p_signers, p_threshold, case p_outcome when 'rate_limited' then 429 else 200 end)
$$;
create function tests.called() returns text[]
language sql as $$ select coalesce(array_agg(address::text order by id), '{}') from tests.calls $$;
create function tests.queued(n int) returns private.lookup_queue
language sql as $$ select q from private.lookup_queue q where address = tests.addr(n) $$;

select tests.make_wallet(n) from generate_series(1, 4) n;

-- ------------------------------------------------------------------ switches
select is(private.lookup_step(), 'idle', 'an empty queue is idle');
update private.settings set value = 'false' where key = 'worker.enabled';
select private.enqueue('testnet', tests.addr(50), 3, 'refresh');
select is(private.lookup_step(), 'disabled', 'the worker can be switched off');
select is(tests.called(), '{}', 'and then calls nobody');
update private.settings set value = 'true' where key = 'worker.enabled';
delete from private.lookup_queue;

-- ---------------------------------------------------------- one row per account
select private.enqueue('testnet', tests.addr(50), 3, 'add', now() + interval '1 hour');
select private.enqueue('testnet', tests.addr(50), 1, 'refresh', now());
select private.enqueue('testnet', tests.addr(50), 2, 'add', now() + interval '2 hours');
select results_eq(
	$$ select count(*)::int, min(priority)::int, min(lane), bool_and(not_before <= now()) from private.lookup_queue where address = tests.addr(50) $$,
	$$ values (1, 1, 'refresh', true) $$,
	'asking again keeps one row: the most urgent priority, the refresh lane, the earliest time');
delete from private.lookup_queue;

-- ---------------------------------------------------------------------- order
-- same lane: priority first, then age
insert into private.lookup_queue (network, address, priority, lane, requested_at) values
	('testnet', tests.addr(51), 3, 'refresh', now() - interval '3 minutes'),
	('testnet', tests.addr(52), 1, 'refresh', now() - interval '1 minute'),
	('testnet', tests.addr(53), 1, 'refresh', now() - interval '2 minutes'),
	('testnet', tests.addr(54), 2, 'refresh', now() - interval '4 minutes');
update private.worker_state set last_lane = 'add';
select tests.answer(n, 'none') from generate_series(51, 54) n;
select private.lookup_step() from generate_series(1, 4);
select is(tests.called(), array[tests.addr(53), tests.addr(52), tests.addr(54), tests.addr(51)]::text[],
	'within a lane: by priority, then the oldest request');
select is_empty('select 1 from private.lookup_queue', 'answered rows leave the queue');
delete from tests.calls;

-- the lane that did not go last goes next, even against a better priority
insert into private.lookup_queue (network, address, priority, lane, requested_at) values
	('testnet', tests.addr(55), 1, 'add', now() - interval '3 minutes'),
	('testnet', tests.addr(56), 1, 'add', now() - interval '2 minutes'),
	('testnet', tests.addr(57), 3, 'refresh', now() - interval '1 minute'),
	('testnet', tests.addr(58), 3, 'refresh', now());
update private.worker_state set last_lane = 'add';
select tests.answer(n, 'none') from generate_series(55, 58) n;
select private.lookup_step() from generate_series(1, 4);
select is(tests.called(), array[tests.addr(57), tests.addr(55), tests.addr(58), tests.addr(56)]::text[],
	'the two lanes take turns, so a flood of additions cannot starve re-checks');
delete from tests.calls;

-- an accepted signer change jumps every queue
insert into private.lookup_queue (network, address, priority, lane, requested_at) values
	('testnet', tests.addr(59), 1, 'add', now() - interval '1 hour'),
	('testnet', tests.addr(60), 0, 'refresh', now());
update private.worker_state set last_lane = 'refresh';
select tests.answer(59, 'none');
select tests.answer(60, 'none');
select private.lookup_step();
select is(tests.called(), array[tests.addr(60)]::text[], 'priority 0 goes first even when it is the other lane''s turn');
select private.lookup_step();
delete from tests.calls;

-- not yet due
insert into private.lookup_queue (network, address, priority, lane, not_before)
values ('testnet', tests.addr(61), 1, 'refresh', now() + interval '10 seconds');
select is(private.lookup_step(), 'idle', 'a row that is not due yet is left alone');
delete from private.lookup_queue;

-- ------------------------------------------------------------------- outcomes
-- a real addition, end to end through the queue
select tests.request(1, 'add', 'testnet', 62);
select tests.answer(62, 'policy', tests.addrs(1, 2), 2);
select is(private.lookup_step(), 'added', 'a queued addition is looked up and stored');
select isnt_empty($$ select 1 from public.treasuries where address = tests.addr(62) and threshold = 2 $$, 'the treasury exists');
select results_eq($$ select outcome, http_status from private.lookup_log where address = tests.addr(62) $$,
	$$ values ('policy', 200) $$, 'the call is logged');
select is((select last_lane from private.worker_state), 'add', 'the worker remembers which lane went');

-- an error backs off and is retried; the sixth failure gives up
select tests.request(3, 'add', 'testnet', 63);
select is(private.lookup_step(), 'error', 'no usable answer is an error');
select results_eq($$ select attempts, not_before > now() + interval '4 seconds', not_before < now() + interval '6 seconds' from private.lookup_queue where address = tests.addr(63) $$,
	$$ values (1, true, true) $$, 'retried after 5 seconds');
update private.lookup_queue set not_before = now() where address = tests.addr(63);
select private.lookup_step();
select results_eq($$ select attempts, not_before > now() + interval '9 seconds', not_before < now() + interval '11 seconds' from private.lookup_queue where address = tests.addr(63) $$,
	$$ values (2, true, true) $$, 'then after 10: the delay doubles');
update private.lookup_queue set not_before = now(), attempts = 5 where address = tests.addr(63);
select is(private.lookup_step(), 'gave_up', 'the sixth failure gives up');
select is_empty($$ select 1 from private.lookup_queue where address = tests.addr(63) $$, 'the row leaves the queue');
select is((select status || ':' || reason from public.treasury_requests where address = tests.addr(63)), 'failed:lookup_failed',
	'and the waiting request is told');
update private.lookup_queue set attempts = 20, not_before = now() where false;

-- the delay is capped
insert into private.lookup_queue (network, address, priority, lane, attempts) values ('testnet', tests.addr(64), 3, 'refresh', 4);
update private.lookup_queue set attempts = 4 where address = tests.addr(64);
select private.lookup_step();
select ok((select not_before <= now() + interval '10 minutes' from private.lookup_queue where address = tests.addr(64)), 'a retry is never more than 10 minutes away');
delete from private.lookup_queue;

-- 429: that network rests for a minute, the row stays, the other network goes on
insert into private.lookup_queue (network, address, priority, lane) values
	('testnet', tests.addr(65), 1, 'refresh'),
	('mainnet', tests.addr(66), 3, 'refresh');
select tests.answer(65, 'rate_limited');
select tests.answer(66, 'none');
delete from tests.calls;
select is(private.lookup_step(), 'rate_limited', 'a 429 is reported');
select isnt_empty($$ select 1 from private.lookup_queue where address = tests.addr(65) and attempts = 0 $$, 'the row stays, with no penalty');
select ok((select blocked_until_testnet > now() + interval '55 seconds' and blocked_until_mainnet is null from private.worker_state),
	'that network is left alone for a minute');
select is(private.lookup_step(), 'rejected', 'the other network is still served');
select is(private.lookup_step(), 'idle', 'the blocked network is not called');
select is(tests.called(), array[tests.addr(65), tests.addr(66)]::text[], 'two calls in all');
update private.worker_state set blocked_until_testnet = now() - interval '1 second';
select tests.answer(65, 'none');
select is(private.lookup_step(), 'rejected', 'once the minute is over it is tried again');
delete from tests.calls;

-- the per-minute ceiling
delete from private.lookup_log;
insert into private.lookup_log (network, address, outcome, at)
select 'testnet', tests.addr(1), 'policy', now() - interval '30 seconds' from generate_series(1, 30);
insert into private.lookup_queue (network, address, priority, lane) values ('testnet', tests.addr(67), 0, 'refresh');
select is(private.lookup_step(), 'capped', '30 calls in the last minute: no more, whatever the priority');
select is(tests.called(), '{}', 'nothing is called');
update private.lookup_log set at = now() - interval '61 seconds' where id = (select min(id) from private.lookup_log);
select tests.answer(67, 'none');
select is(private.lookup_step(), 'rejected', 'as soon as one of them is over a minute old, the next goes');
update private.settings set value = '5' where key = 'worker.per_minute';
insert into private.lookup_queue (network, address, priority, lane) values ('testnet', tests.addr(68), 0, 'refresh');
select is(private.lookup_step(), 'capped', 'the ceiling is a setting');
update private.settings set value = '30' where key = 'worker.per_minute';
delete from private.lookup_queue;
delete from private.lookup_log;
delete from tests.calls;

-- the first "not a multi-sig" for a known treasury comes back in 30 seconds
select tests.answer(62, 'none');
select private.enqueue('testnet', tests.addr(62), 3, 'refresh');
select is(private.lookup_step(), 'recheck', 'a known treasury answering "none" is asked again');
select results_eq($$ select priority::int, lane, not_before > now() + interval '29 seconds' from private.lookup_queue where address = tests.addr(62) $$,
	$$ values (1, 'refresh', true) $$, 'in 30 seconds, ahead of the sweep');
delete from private.lookup_queue;
delete from private.treasury_checks;

-- ------------------------------------------------------------ sign-in re-checks
select tests.seed_treasury('testnet', 70, 1, array[1, 2]);
select tests.seed_treasury('testnet', 71, 1, array[1]);
select tests.seed_treasury('mainnet', 72, 1, array[2]);
update public.treasuries set checked_at = now() - interval '11 minutes' where address in (tests.addr(70), tests.addr(72));
update public.treasuries set checked_at = now() - interval '9 minutes' where address = tests.addr(71);
insert into private.session_marks (user_id) values (tests.user_id(1)), (tests.user_id(1)), (tests.user_id(99));
select is(private.drain_marks(), 1, 'a sign-in re-checks that wallet''s treasuries not checked in the last 10 minutes');
select results_eq($$ select address::text, priority::int, lane from private.lookup_queue $$,
	$$ values (tests.addr(70)::text, 2, 'refresh') $$, 'at priority 2, and only that wallet''s');
select is_empty('select 1 from private.session_marks', 'marks are consumed, unknown users included');
select is(private.drain_marks(), 0, 'no marks, nothing to do');
delete from private.lookup_queue;

-- a wallet listed in many treasuries cannot flood the queue
select tests.seed_treasury('testnet', 200 + n, 1, array[3]) from generate_series(1, 30) n;
update public.treasuries set checked_at = now() - (n || ' hours')::interval
from generate_series(1, 30) n where address = tests.addr(200 + n);
insert into private.session_marks (user_id) values (tests.user_id(3));
select is(private.drain_marks(), 25, 'at most 25 re-checks per wallet per sign-in');
select ok(not exists (select 1 from private.lookup_queue where address in (select tests.addr(200 + n) from generate_series(1, 5) n)),
	'the stalest first: the five checked most recently wait for the next sign-in');
delete from private.lookup_queue;

-- the worker drains marks on its own way round
insert into private.session_marks (user_id) values (tests.user_id(2));
select is(private.lookup_step(), 'idle', 'an idle step');
select set_eq($$ select address::text from private.lookup_queue $$, array[tests.addr(70)::text, tests.addr(72)::text],
	'still turns marks into re-checks, on both networks');
delete from private.lookup_queue;

-- ----------------------------------------------------------------- daily sweep
update public.treasuries set checked_at = now() - interval '23 hours';
select is(private.sweep(), 0, 'nothing is swept before a day has passed');
update public.treasuries set checked_at = now() - interval '25 hours' where address in (tests.addr(70), tests.addr(71), tests.addr(72));
update public.treasuries set frozen_at = now() where address = tests.addr(71);
select private.enqueue('mainnet', tests.addr(72), 1, 'refresh');
select is(private.sweep(), 1, 'a treasury a day stale is swept; a frozen one and one already queued are not');
select results_eq($$ select priority::int, lane from private.lookup_queue where address = tests.addr(70) $$,
	$$ values (3, 'refresh') $$, 'at the lowest priority');
update public.treasuries set checked_at = now() - interval '8 days' where address = tests.addr(71);
select is(private.sweep(), 1, 'a frozen treasury is looked at once a week');
delete from private.lookup_queue;
update public.treasuries set checked_at = now() - interval '2 days', frozen_at = null;
select is(private.sweep(), 20, 'at most 20 per run, so a backlog spreads out');

-- ------------------------------------------------------------------- the entry
delete from private.lookup_queue;
select is(private.run_lookups(), 'idle', 'the cron entry point runs a step');
select ok(not has_function_privilege('authenticated', 'private.run_lookups()', 'execute'), 'and is not callable through the API');

select * from finish();
rollback;
