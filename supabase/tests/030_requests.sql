-- Asking for a lookup: who may ask, what they may set, the caps, the shortcuts.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 5) n;
select tests.seed_treasury('testnet', 10, 2, array[1, 2]);
update public.treasuries set checked_at = now() - interval '5 minutes' where address = tests.addr(10);

set local role authenticated;

-- adding an account nobody tracks yet
select tests.claims(3);
select lives_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(20), 'add') $$,
	'anyone signed in may ask to add a treasury');
select results_eq(
	$$ select requested_by::text, status, kind from public.treasury_requests where address = tests.addr(20) $$,
	$$ values (tests.addr(3)::text, 'pending', 'add') $$,
	'the request is stamped with the session wallet and starts pending');

select throws_ok($$ insert into public.treasury_requests (network, address, kind, requested_by) values ('testnet', tests.addr(21), 'add', tests.addr(1)) $$,
	'42501', null, 'the requester cannot be named by the client');
select throws_ok($$ insert into public.treasury_requests (network, address, kind, status) values ('testnet', tests.addr(21), 'add', 'done') $$,
	'42501', null, 'nor the status');
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(21), 'nonsense') $$,
	'42501', null, 'an unknown kind from a non-signer is refused by the policy');
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', '0x1234', 'add') $$,
	'23514', null, 'a malformed address is refused');

-- a re-check is for stored signers only
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'check') $$,
	'42501', null, 'a wallet outside the signer list cannot ask for a re-check');
select tests.claims(1);
select lives_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'check') $$,
	'a stored signer can');
select is((select status from public.treasury_requests where address = tests.addr(10) and kind = 'check'), 'pending',
	'and it waits for the worker when the copy is not fresh');
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'nonsense') $$,
	'23514', null, 'an unknown kind from a signer is refused by the table');

-- shortcuts: nothing to look up
select lives_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'add') $$,
	'adding a treasury you are already listed in is accepted');
select is((select status from public.treasury_requests where address = tests.addr(10) and kind = 'add' and requested_by = tests.addr(1)), 'done',
	'and is done at once');
reset role;
update public.treasuries set checked_at = now() - interval '10 seconds' where address = tests.addr(10);
set local role authenticated;
select tests.claims(2);
insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'check');
select is((select status from public.treasury_requests where requested_by = tests.addr(2)), 'done',
	'a re-check of a copy under 30 seconds old is done at once');

-- reading: your own only
select tests.claims(3);
select is((select count(*)::int from public.treasury_requests), 1, 'a wallet reads its own requests');
select tests.claims(4);
select is_empty('select 1 from public.treasury_requests', 'and nobody else''s');

-- no edits
select tests.claims(3);
select throws_ok($$ update public.treasury_requests set status = 'done' $$, '42501', null, 'requests cannot be updated through the API');
select throws_ok($$ delete from public.treasury_requests $$, '42501', null, 'nor deleted');

-- a session with no wallet
select tests.claims(99);
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(22), 'add') $$,
	'42501', null, 'a session with no wallet cannot ask');
reset role;

set local role anon;
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(22), 'add') $$,
	'42501', null, 'anon cannot ask');
select throws_ok('select 1 from public.treasury_requests', '42501', null, 'anon cannot read requests');
reset role;

-- what reached the queue
select results_eq(
	$$ select address::text, priority::int, lane from private.lookup_queue order by address $$,
	$$ values (tests.addr(10)::text, 1, 'refresh'), (tests.addr(20)::text, 1, 'add') $$,
	'pending requests are queued at priority 1: additions in the add lane, re-checks in the refresh lane');

-- caps
set local role authenticated;
select tests.claims(5);
insert into public.treasury_requests (network, address, kind)
select 'testnet', tests.addr(100 + n), 'add' from generate_series(1, 5) n;
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(106), 'add') $$,
	'P0001', 'relay.rate_limited', 'the sixth addition within an hour is refused');
reset role;
update public.treasury_requests set created_at = now() - interval '61 minutes'
where requested_by = tests.addr(5) and address = tests.addr(101);
set local role authenticated;
select lives_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(106), 'add') $$,
	'once one of them is over an hour old, another is allowed');

select tests.claims(1);
insert into public.treasury_requests (network, address, kind)
select 'testnet', tests.addr(10), 'check' from generate_series(1, 29);
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'check') $$,
	'P0001', 'relay.rate_limited', 'the 31st re-check within an hour is refused');
reset role;

-- the relay-wide ceiling on waiting additions
alter table public.treasury_requests disable trigger treasury_request_before;
alter table public.treasury_requests disable trigger treasury_request_after;
insert into public.treasury_requests (network, address, kind, requested_by)
select 'testnet', tests.addr(1000 + n), 'add', tests.addr(2000 + n) from generate_series(1, 200) n;
alter table public.treasury_requests enable trigger treasury_request_before;
alter table public.treasury_requests enable trigger treasury_request_after;
set local role authenticated;
select tests.claims(4);
select throws_ok($$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(23), 'add') $$,
	'P0001', 'relay.busy', 'with 200 additions already waiting, a new one is refused');
reset role;

select ok(not has_table_privilege('authenticated', 'public.treasury_requests', 'update,delete,truncate'),
	'authenticated holds no UPDATE or DELETE on requests');
select ok(not has_table_privilege('service_role', 'public.treasury_requests', 'select,insert'),
	'the secret key gets nothing on requests');
select ok((select relrowsecurity from pg_class where oid = 'public.treasury_requests'::regclass), 'RLS is on for requests');

select * from finish();
rollback;
