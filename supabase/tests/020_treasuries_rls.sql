-- The treasury registry: readable by the stored signers, written by nobody through the API.
begin;
\ir _helpers.inc
select no_plan();

select tests.make_wallet(n) from generate_series(1, 4) n;
-- T10: wallets 1 and 2. T11: wallets 2 and 3. T12 on mainnet: wallet 1. Wallet 4 is in none.
select tests.seed_treasury('testnet', 10, 2, array[1, 2]);
select tests.seed_treasury('testnet', 11, 1, array[2, 3]);
select tests.seed_treasury('mainnet', 12, 1, array[1]);

select ok((select relrowsecurity from pg_class where oid = 'public.treasuries'::regclass), 'RLS is on for treasuries');
select ok((select relrowsecurity from pg_class where oid = 'public.treasury_signers'::regclass), 'RLS is on for treasury_signers');

set local role authenticated;

select tests.claims(1);
select set_eq('select network::text, address::text from public.treasuries',
	$$ values ('testnet', tests.addr(10)::text), ('mainnet', tests.addr(12)::text) $$,
	'wallet 1 sees the treasuries it signs for, on both networks');
select set_eq($$ select signer::text from public.treasury_signers where treasury = tests.addr(10) $$,
	array[tests.addr(1)::text, tests.addr(2)::text],
	'and all the signers of those treasuries');
select is_empty($$ select 1 from public.treasury_signers where treasury = tests.addr(11) $$,
	'but not the signers of a treasury it is not in');
select ok(private.is_signer('testnet', tests.addr(10)), 'is_signer: yes for its own treasury');
select ok(not private.is_signer('testnet', tests.addr(11)), 'is_signer: no for another');
select ok(not private.is_signer('mainnet', tests.addr(10)), 'is_signer: the network is part of the identity');

select tests.claims(2);
select set_eq('select address::text from public.treasuries',
	array[tests.addr(10)::text, tests.addr(11)::text], 'wallet 2 sees both of its treasuries');

select tests.claims(4);
select is_empty('select 1 from public.treasuries', 'an outsider sees no treasury');
select is_empty('select 1 from public.treasury_signers', 'and no signer list');
select is_empty('select * from private.my_treasuries()', 'my_treasuries is empty for an outsider');

select tests.no_claims();
select is_empty('select 1 from public.treasuries', 'a session with no wallet sees nothing');

-- nobody writes the registry through the API, signer or not
select tests.claims(1);
select throws_ok($$ insert into public.treasuries (network, address, threshold, added_by) values ('testnet', tests.addr(20), 1, tests.addr(1)) $$,
	'42501', null, 'a signer cannot insert a treasury');
select throws_ok($$ update public.treasuries set threshold = 1 where address = tests.addr(10) $$,
	'42501', null, 'a signer cannot update a treasury');
select throws_ok($$ delete from public.treasuries where address = tests.addr(10) $$,
	'42501', null, 'a signer cannot delete a treasury');
select throws_ok($$ insert into public.treasury_signers (network, treasury, signer) values ('testnet', tests.addr(11), tests.addr(1)) $$,
	'42501', null, 'a wallet cannot add itself to a signer list');
select throws_ok($$ delete from public.treasury_signers where treasury = tests.addr(10) $$,
	'42501', null, 'a signer cannot remove signers');
reset role;

set local role anon;
select throws_ok('select 1 from public.treasuries', '42501', null, 'anon cannot read treasuries');
select throws_ok('select 1 from public.treasury_signers', '42501', null, 'anon cannot read signers');
reset role;

select ok(not has_table_privilege('service_role', 'public.treasuries', 'select'), 'the secret key gets nothing on treasuries');
select ok(not has_table_privilege('authenticated', 'public.treasuries', 'insert,update,delete,truncate'),
	'authenticated holds only SELECT on treasuries');
select ok(not has_table_privilege('authenticated', 'public.treasury_signers', 'insert,update,delete,truncate'),
	'authenticated holds only SELECT on treasury_signers');

-- a frozen treasury stays readable but is no longer "active"
update public.treasuries set frozen_at = now() where address = tests.addr(10);
set local role authenticated;
select tests.claims(1);
select ok(private.is_signer('testnet', tests.addr(10)), 'frozen: still a signer for reading');
select ok(not private.is_signer('testnet', tests.addr(10), true), 'frozen: not an active signer');
select isnt_empty($$ select 1 from public.treasuries where address = tests.addr(10) $$, 'frozen: the treasury is still readable');
reset role;

-- removal from the stored copy ends access at once
delete from public.treasury_signers where treasury = tests.addr(10) and signer = tests.addr(1);
set local role authenticated;
select tests.claims(1);
select is_empty($$ select 1 from public.treasuries where address = tests.addr(10) $$, 'a removed signer no longer sees the treasury');
select is_empty($$ select 1 from public.treasury_signers where treasury = tests.addr(10) $$, 'nor its signers');
reset role;

-- the shapes the registry refuses
select throws_ok($$ insert into public.treasuries (network, address, threshold, added_by) values ('testnet', '0xABCDEF0000000000000000000000000000000000', 1, tests.addr(1)) $$,
	'23514', null, 'an uppercase address is refused');
select throws_ok($$ insert into public.treasuries (network, address, threshold, added_by) values ('testnet', tests.addr(21), 0, tests.addr(1)) $$,
	'23514', null, 'a zero threshold is refused');
select throws_ok($$ insert into public.treasuries (network, address, threshold, added_by) values ('testnet', tests.addr(21), 11, tests.addr(1)) $$,
	'23514', null, 'a threshold above ten is refused');

select * from finish();
rollback;
