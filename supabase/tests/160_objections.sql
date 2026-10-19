-- Any signer can say no: an objection the others see, never a cancellation.
-- One position per signer per proposal, changeable while the proposal is open.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 5) n;
-- T10: wallets 1, 2, 3 (2 of 3). Wallet 4 signs for T11 only. Wallet 5 for nothing.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);
-- proposals by wallet 1, finaliser wallet 2
select tests.propose(1, 10, 2, d) from generate_series(1, 12) d;

select ok((select relrowsecurity from pg_class where oid = 'public.objections'::regclass), 'RLS is on for objections');

set local role authenticated;

-- ---------------------------------------------------------------- saying no
select lives_ok($$ select tests.say_no(3, 10, 1) $$, 'a signer who is neither proposer nor finaliser says no');
select results_eq($$ select signer::text, created_at is not null from public.objections where digest = tests.digest(1) $$,
	$$ values (tests.addr(3)::text, true) $$, 'stamped with the session wallet and the time');
select is(tests.status(10, 1), 'open', 'the proposal stays open: a no ends nothing');
select is(tests.kinds(10, 1), array['proposal_created', 'objection_added'], 'the history records it');
select lives_ok($$ select tests.say_no(1, 10, 1) $$, 'the proposer can say no to its own proposal');
select lives_ok($$ select tests.say_no(2, 10, 1) $$, 'the finaliser says no like any other signer');
select is(tests.status(10, 1), 'open', 'even with every signer against it, it is not closed');
select is(tests.said_no(10, 1), array[tests.addr(1)::text, tests.addr(2)::text, tests.addr(3)::text], 'three positions, three rows');
select throws_ok($$ select tests.say_no(3, 10, 1) $$, '23505', null, 'one no per signer per proposal');

-- who cannot
select throws_ok($$ select tests.say_no(5, 10, 2) $$, '42501', null, 'a stranger cannot say no');
select throws_ok($$ select tests.say_no(4, 10, 2) $$, '42501', null, 'nor can a signer of another treasury');
select throws_ok($$ select tests.say_no(4, 11, 2) $$, '23503', null, 'nor file one for this digest under its own treasury');
select throws_ok($$ select tests.say_no(3, 10, 999) $$, '23503', null, 'a no needs its proposal');
select tests.claims(2);
select throws_ok($$ insert into public.objections (network, treasury, digest, signer)
	values ('testnet', tests.addr(10), tests.digest(2), tests.addr(3)) $$,
	'42501', null, 'a no cannot be filed under another signer''s name');
select throws_ok($$ insert into public.objections (network, treasury, digest, created_at)
	values ('testnet', tests.addr(10), tests.digest(2), now() - interval '1 year') $$,
	'42501', null, 'nor dated by its author');
select throws_ok($$ update public.objections set signer = tests.addr(2) $$, '42501', null, 'a no cannot be edited');

-- reading
select tests.claims(1);
select is((select count(*)::int from public.objections where digest = tests.digest(1)), 3, 'co-signers read every no');
select tests.claims(4);
select is_empty('select 1 from public.objections', 'another treasury''s signer reads none');
select tests.claims(5);
select is_empty('select 1 from public.objections', 'a stranger reads none');
select tests.no_claims();
select is_empty('select 1 from public.objections', 'nor does a request with no wallet');

-- ------------------------------------------------------------ taking it back
select tests.claims(1);
delete from public.objections where digest = tests.digest(1) and signer = tests.addr(3);
select is(tests.said_no(10, 1), array[tests.addr(1)::text, tests.addr(2)::text, tests.addr(3)::text],
	'a signer cannot take back somebody else''s no');
select is(tests.take_back_no(3, 10, 1), 1, 'a signer takes back its own');
select is(tests.said_no(10, 1), array[tests.addr(1)::text, tests.addr(2)::text], 'and only its own');
select is(tests.kinds(10, 1),
	array['proposal_created', 'objection_added', 'objection_added', 'objection_added', 'objection_removed'],
	'the history keeps every step');
select lives_ok($$ select tests.say_no(3, 10, 1) $$, 'and can say no again');

-- ----------------------------------------------------- one position at a time
select tests.sign(3, 10, 2);
select is(tests.signed(10, 2), array[tests.addr(3)::text], 'wallet 3 has signed proposal 2');
select lives_ok($$ select tests.say_no(3, 10, 2) $$, 'a signer who signed can say no');
select is(tests.signed(10, 2), '{}'::text[], 'saying no takes its own signature back');
select is(tests.said_no(10, 2), array[tests.addr(3)::text], 'and leaves the no');
select is(tests.kinds(10, 2),
	array['proposal_created', 'signature_added', 'signature_removed', 'objection_added'],
	'both steps are in the history, in order');
select lives_ok($$ select tests.sign(3, 10, 2) $$, 'a signer who said no can sign');
select is(tests.said_no(10, 2), '{}'::text[], 'signing takes its own no back');
select is(tests.signed(10, 2), array[tests.addr(3)::text], 'and leaves the signature');
select is(tests.kinds(10, 2),
	array['proposal_created', 'signature_added', 'signature_removed', 'objection_added', 'objection_removed', 'signature_added'],
	'again both steps, in order');
-- another signer's position is never touched by one's own change
select tests.sign(1, 10, 3);
select tests.say_no(2, 10, 3);
select tests.say_no(3, 10, 3);
select is(tests.signed(10, 3), array[tests.addr(1)::text], 'a co-signer''s no leaves one''s signature alone');
select tests.sign(3, 10, 3);
select is(tests.said_no(10, 3), array[tests.addr(2)::text], 'and a co-signer''s signature leaves one''s no alone');

-- ------------------------------------------- a proposal that is no longer open
select tests.say_no(3, 10, 4);
select tests.end_it(1, 10, 4, 'withdrawn');
select throws_ok($$ select tests.say_no(2, 10, 4) $$, 'P0001', 'relay.proposal_closed', 'a withdrawn proposal takes no new no');
select throws_ok($$ select tests.take_back_no(3, 10, 4) $$, 'P0001', 'relay.proposal_closed', 'and a no on it can no longer be taken back');
select is(tests.said_no(10, 4), array[tests.addr(3)::text], 'positions stay as they were');
reset role;
select tests.say_no(3, 10, 5);
update public.proposals set expires_at = now() - interval '1 second' where digest = tests.digest(5);
set local role authenticated;
select throws_ok($$ select tests.say_no(2, 10, 5) $$, 'P0001', 'relay.proposal_expired', 'a lapsed proposal takes no new no');
select throws_ok($$ select tests.take_back_no(3, 10, 5) $$, 'P0001', 'relay.proposal_expired', 'and keeps the ones it had');

-- an account that is no longer a multi-sig
reset role;
select tests.seed_treasury('testnet', 12, 1, array[1, 2]);
select tests.propose(1, 12, 2, 20);
update public.treasuries set frozen_at = now() where address = tests.addr(12);
set local role authenticated;
select throws_ok($$ select tests.say_no(2, 12, 20) $$, 'P0001', 'relay.treasury_frozen', 'nothing is said to a former multi-sig''s proposals');

-- a session that was ended has no wallet, so it says nothing
reset role;
delete from auth.sessions where id = tests.session_id(3);
set local role authenticated;
select throws_ok($$ select tests.say_no(3, 10, 6) $$, '42501', null, 'an ended session cannot say no');
select tests.claims(3);
select is_empty('select 1 from public.objections', 'and reads none');
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at) values (tests.session_id(3), tests.user_id(3), now(), now());
set local role authenticated;

-- ----------------------------------------------------------------- the limit
-- A no costs no wallet prompt; each writes a history entry and pings the co-signers.
reset role;
-- wallet 2 has said no twice above; with these it stands at 29
select is((select count(*)::int from public.events where kind = 'objection_added' and actor = tests.addr(2)), 2,
	'wallet 2 has two on record so far');
insert into public.events (network, treasury, digest, kind, actor, at)
select 'testnet', tests.addr(10), tests.digest(7), 'objection_added', tests.addr(2), now() - interval '10 minutes'
from generate_series(1, 27);
set local role authenticated;
select lives_ok($$ select tests.say_no(2, 10, 7) $$, 'the thirtieth no in an hour is taken');
select throws_ok($$ select tests.say_no(2, 10, 8) $$, 'P0001', 'relay.rate_limited', 'the thirty-first is not');
select lives_ok($$ select tests.say_no(3, 10, 8) $$, 'another wallet is not held back by it');
select lives_ok($$ select tests.sign(2, 10, 8) $$, 'and the limited wallet can still sign');
reset role;
update public.events set at = now() - interval '2 hours'
where kind = 'objection_added' and actor = tests.addr(2);
set local role authenticated;
select lives_ok($$ select tests.say_no(2, 10, 9) $$, 'an hour later it can say no again');

-- ------------------------------------------- an operator removes the proposal
reset role;
select tests.say_no(1, 10, 10);
delete from public.proposals where digest = tests.digest(10);
select is_empty($$ select 1 from public.objections where digest = tests.digest(10) $$, 'its positions go with it');
select is_empty($$ select 1 from public.events where digest = tests.digest(10) and kind = 'objection_removed' $$,
	'and no entry pretends the signer took it back');

-- --------------------------------------------------------------------- grants
select set_eq(
	$$ select privilege_type from information_schema.role_table_grants
	   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'objections' $$,
	array['SELECT', 'DELETE'],
	'authenticated reads objections and deletes its own; nothing else on the table');
select set_eq(
	$$ select column_name::text from information_schema.column_privileges
	   where grantee = 'authenticated' and table_schema = 'public' and table_name = 'objections' and privilege_type = 'INSERT' $$,
	array['network', 'treasury', 'digest'],
	'and may name the proposal only: never who, never when');
select is_empty(
	$$ select 1 from information_schema.role_table_grants
	   where grantee in ('anon', 'service_role', 'PUBLIC') and table_schema = 'public' and table_name = 'objections' $$,
	'anon, service_role and PUBLIC hold nothing on it');
select is_empty(
	$$ select column_name from information_schema.columns
	   where table_schema = 'public' and table_name = 'objections' and data_type in ('text', 'character varying', 'jsonb', 'json')
	     and column_name not in ('network', 'treasury', 'digest', 'signer') $$,
	'a no has no column that could hold a reason');
select is_empty(
	$$ select policyname from pg_policies where schemaname = 'public' and tablename = 'objections' and roles <> '{authenticated}' $$,
	'every policy on it is for signed-in users only');

select * from finish();
rollback;
