-- Pings and schedules: who is told that something changed, and what runs when.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

create function tests.pinged() returns text[]
language sql as $$
	select coalesce(array_agg(distinct replace(topic, 'wallet:', '') order by replace(topic, 'wallet:', '')), '{}')
	from realtime.messages
	where topic like 'wallet:0x7e57%' and inserted_at >= now()
$$;
create function tests.forget_pings() returns void
language sql as $$ delete from realtime.messages where topic like 'wallet:0x7e57%' $$;

select tests.make_wallet(n) from generate_series(1, 5) n;
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);

-- ----------------------------------------------------------------------- pings
select tests.propose(1, 10, 2, 1);
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'a new proposal pings every signer of that treasury, and nobody else');
select results_eq(
	$$ select distinct event, private, extension, payload - 'id' from realtime.messages where topic = 'wallet:' || tests.addr(2) $$,
	$$ values ('changed', true, 'broadcast', '{}'::jsonb) $$,
	'the ping is a private broadcast with no content');
select tests.forget_pings();

select tests.sign(3, 10, 1);
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'a signature pings them');
select tests.forget_pings();
select tests.end_it(1, 10, 1, 'withdrawn');
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'an ending pings them');
select tests.forget_pings();
select tests.propose(1, 10, 2, 2);
select tests.forget_pings();
select tests.receipt(2, 10, 2, '{"status":"ok","response":{"type":"default"}}');
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'a recorded result pings them');
select tests.forget_pings();

-- a signer change reaches the newcomer and the one removed
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2, 5), 2);
select is(tests.pinged(), tests.addrs(1, 2, 3, 5)::text[], 'a signer change pings the current signers and the one just removed');
select tests.forget_pings();
select tests.propose(1, 10, 2, 3);
select is(tests.pinged(), tests.addrs(1, 2, 5)::text[], 'after that the removed signer hears nothing more');
select tests.forget_pings();

-- adding a treasury: the asker hears the answer; every signer hears the addition
select tests.request(4, 'add', 'testnet', 20);
select tests.request(5, 'add', 'testnet', 20);
select is(tests.pinged(), '{}', 'asking pings nobody');
select private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 5), 1);
select is(tests.pinged(), tests.addrs(1, 4, 5)::text[],
	'the answer pings both askers (one accepted, one refused) and the co-signer who never asked');
select tests.forget_pings();

-- ------------------------------------------------------------ joining a channel
-- Realtime evaluates the policy as the joining user, with the topic in a setting.
select realtime.send('{}'::jsonb, 'changed', 'wallet:' || tests.addr(1), true);
set local role authenticated;
select tests.claims(1);
select set_config('realtime.topic', 'wallet:' || tests.addr(1), true);
select isnt_empty($$ select 1 from realtime.messages where topic = 'wallet:' || tests.addr(1) $$, 'a wallet may read its own channel');
select tests.claims(2);
select is_empty($$ select 1 from realtime.messages where topic = 'wallet:' || tests.addr(1) $$, 'another wallet may not');
select set_config('realtime.topic', 'wallet:' || tests.addr(2), true);
select is_empty($$ select 1 from realtime.messages where topic = 'wallet:' || tests.addr(1) $$, 'nor by joining its own channel');
select tests.claims(99);
select set_config('realtime.topic', 'wallet:' || tests.addr(1), true);
select is_empty($$ select 1 from realtime.messages $$, 'a session with no wallet reads no channel');
select set_config('realtime.topic', 'wallet:', true);
select is_empty($$ select 1 from realtime.messages $$, 'and the empty topic matches nothing');
select tests.claims(1);
select set_config('realtime.topic', 'wallet:' || tests.addr(1), true);
select throws_ok($$ insert into realtime.messages (topic, extension, payload, event, private) values ('wallet:' || tests.addr(2), 'broadcast', '{}', 'changed', true) $$,
	'42501', null, 'no browser can put a message on a channel');
reset role;
select set_eq($$ select policyname || ':' || cmd from pg_policies where schemaname = 'realtime' and tablename = 'messages' $$,
	array['a wallet hears its own pings:SELECT'], 'the only policy on realtime.messages is that SELECT');

-- ------------------------------------------------------------------- schedules
select set_eq($$ select jobname || ' | ' || schedule || ' | ' || command from cron.job where jobname like 'relay-%' $$,
	array['relay-lookups | 2 seconds | select private.run_lookups()',
		'relay-sweep | * * * * * | select private.sweep()',
		'relay-prune | 7 * * * * | select private.prune()'],
	'three jobs: lookups every two seconds, the sweep every minute, housekeeping hourly');
select is((select count(*)::int from cron.job where jobname like 'relay-%' and active and username = 'postgres'), 3, 'all active, run by postgres');

-- housekeeping
insert into private.lookup_log (network, address, outcome, at) values
	('testnet', tests.addr(1), 'policy', now() - interval '8 days'), ('testnet', tests.addr(1), 'policy', now() - interval '6 days');
insert into private.session_marks (user_id, at) values (tests.user_id(1), now() - interval '2 hours'), (tests.user_id(1), now());
update public.treasury_requests set finished_at = now() - interval '8 days' where requested_by = tests.addr(4);
select tests.request(3, 'add', 'testnet', 30);
select tests.request(3, 'add', 'testnet', 31);
update public.treasury_requests set created_at = now() - interval '25 hours' where requested_by = tests.addr(3);
delete from private.lookup_queue where address = tests.addr(31);
select lives_ok('select private.prune()', 'housekeeping runs');
select is((select count(*)::int from private.lookup_log), 1, 'lookup log: a week is kept');
select is((select count(*)::int from private.session_marks), 1, 'marks: an hour is kept');
select is_empty($$ select 1 from public.treasury_requests where requested_by = tests.addr(4) $$, 'answered requests: a week is kept');
select results_eq($$ select address::text, status from public.treasury_requests where requested_by = tests.addr(3) order by address $$,
	$$ values (tests.addr(30)::text, 'pending'), (tests.addr(31)::text, 'failed') $$,
	'a request waiting a day with nothing queued for it is closed; one still queued is left');
select ok(not has_function_privilege('authenticated', 'private.ping_wallets(public.address[])', 'execute'), 'a browser cannot ping anybody');

select * from finish();
rollback;
