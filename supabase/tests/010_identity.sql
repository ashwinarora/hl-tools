-- Who a session speaks for: the wallet in the identity Auth verified, nothing else.
begin;
\ir _helpers.inc
select no_plan();

select tests.make_wallet(1, '0x7E57000000000000000000000000000000000001');
select tests.make_wallet(2);
select tests.make_wallet(3);
select tests.make_wallet(4);
select tests.make_wallet(5);
select tests.make_wallet(6);

-- wallet 3 also has an email identity; wallet 4's identity is not Ethereum;
-- wallet 5's address is malformed; wallet 6's provider is something else
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
values ('someone@example.com', tests.user_id(3), '{"sub":"someone@example.com"}', 'email', now(), now());
update auth.identities set provider_id = 'web3:solana:' || repeat('1', 40) where user_id = tests.user_id(4);
update auth.identities set provider_id = 'web3:ethereum:0x1234' where user_id = tests.user_id(5);
update auth.identities set provider = 'github' where user_id = tests.user_id(6);

select is(private.wallet_of(tests.user_id(1)), tests.addr(1), 'a checksummed identity resolves to the lowercase address');
select is(private.wallet_of(tests.user_id(2)), tests.addr(2), 'a lowercase identity resolves');
select is(private.wallet_of(tests.user_id(3)), null, 'a user with a second identity resolves to nothing');
select is(private.wallet_of(tests.user_id(4)), null, 'a non-Ethereum web3 identity resolves to nothing');
select is(private.wallet_of(tests.user_id(5)), null, 'a malformed address resolves to nothing');
select is(private.wallet_of(tests.user_id(6)), null, 'another provider resolves to nothing');
select is(private.wallet_of(tests.user_id(99)), null, 'an unknown user resolves to nothing');
select is(private.wallet_of(null), null, 'no user resolves to nothing');

-- through the API role, with the claims PostgREST sets
set local role authenticated;
select tests.claims(1);
select is(private.current_wallet(), tests.addr(1), 'the session wallet comes from the identity');
select is(public.whoami(), tests.addr(1), 'whoami reports it');

-- the token repeats the address under user_metadata, which the user can edit
select tests.claims(2, jsonb_build_object(
	'user_metadata', jsonb_build_object('custom_claims', jsonb_build_object('address', tests.addr(1))),
	'app_metadata', jsonb_build_object('wallet', tests.addr(1)),
	'wallet', tests.addr(1)));
select is(private.current_wallet(), tests.addr(2), 'an address forged into the token is ignored');

select tests.claims(3);
select is(private.current_wallet(), null, 'a session whose user has two identities has no wallet');
select tests.claims(99);
select is(private.current_wallet(), null, 'a session for a deleted user has no wallet');
select tests.no_claims();
select is(private.current_wallet(), null, 'no claims, no wallet');

select throws_ok('select private.wallet_of(tests.user_id(1))', '42501', null, 'a signed-in user cannot resolve other users');
reset role;

set local role anon;
select tests.claims(1);
select throws_ok('select public.whoami()', '42501', null, 'anon cannot call whoami');
select throws_ok('select private.current_wallet()', '42501', null, 'anon cannot enter the private schema');
reset role;

-- every function in private is closed unless listed here
select set_eq(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')
	     and p.proname in ('wallet_of', 'current_wallet', 'my_treasuries', 'is_signer') $$,
	array['private.current_wallet()', 'private.my_treasuries()', 'private.is_signer(network,address,boolean)'],
	'authenticated may run only the policy helpers of this migration');
select is_empty(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname = 'private' and has_function_privilege('anon', p.oid, 'execute') $$,
	'anon may run no function in private');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no access to the private schema');
select ok(not has_function_privilege('anon', 'public.whoami()', 'execute'), 'whoami is closed to anon');
select ok(not has_function_privilege('service_role', 'public.whoami()', 'execute'), 'whoami is closed to service_role');

select * from finish();
rollback;
