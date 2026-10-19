-- The treasury account itself, signed in with its own wallet: it reads what
-- its signers read and writes nothing (relay_treasury_reads_itself).
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

-- definer: a signed-in wallet reads its own channel only; the test looks at all of them
create function tests.pinged() returns text[]
language sql security definer as $$
	select coalesce(array_agg(distinct replace(topic, 'wallet:', '') order by replace(topic, 'wallet:', '')), '{}')
	from realtime.messages
	where topic like 'wallet:0x7e57%' and inserted_at >= now()
$$;
create function tests.forget_pings() returns void
language sql security definer as $$ delete from realtime.messages where topic like 'wallet:0x7e57%' $$;

-- 1, 2, 3 sign for treasury 10; 4 signs for treasury 11; 5 is a stranger.
-- 10 and 11 are the treasury accounts themselves, signed in with their own wallets.
select tests.make_wallet(n) from unnest(array[1, 2, 3, 4, 5, 10, 11]) n;
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);

-- what the signers did, as they would do it
select tests.propose(1, 10, 2, 1);
select tests.sign(1, 10, 1);
select tests.say_no(3, 10, 1);
select tests.propose(2, 10, 2, 2);
select tests.end_it(2, 10, 2, 'withdrawn');
select tests.propose(1, 10, 2, 3);
select tests.receipt(2, 10, 3, '{"status":"err","response":"refused"}');
select tests.nick(1, 10, tests.addr(50), 'Payroll');
select tests.view(2, 10, 1);
select tests.mark(1, 10, tests.newest_event(10));
select tests.propose(4, 11, 4, 4);

-- ---------------------------------------------------------------------- reads
set local role authenticated;
select tests.claims(10);
select results_eq($$ select address::text, threshold::int from public.treasuries $$,
	$$ values (tests.addr(10)::text, 2) $$, 'the account reads its own treasury, and no other');
select results_eq($$ select count(*)::int from public.treasury_signers $$, $$ values (3) $$, 'and who signs for it');
select results_eq($$ select count(*)::int from public.proposals $$, $$ values (3) $$, 'its proposals');
select results_eq($$ select signer::text from public.signatures $$, $$ values (tests.addr(1)::text) $$, 'their signatures');
select results_eq($$ select signer::text from public.objections $$, $$ values (tests.addr(3)::text) $$, 'the nos');
select results_eq($$ select kind from public.endings $$, $$ values ('withdrawn') $$, 'the endings');
select results_eq($$ select count(*)::int from public.receipts $$, $$ values (1) $$, 'the results');
select results_eq($$ select name from public.nicknames $$, $$ values ('Payroll') $$, 'the nicknames');
select results_eq($$ select count(*)::int from public.nickname_changes $$, $$ values (1) $$, 'who gave them');
select results_eq($$ select signer::text from public.proposal_views $$, $$ values (tests.addr(2)::text) $$, 'who has seen what');
select ok((select count(*) from public.events where treasury = tests.addr(10)) > 0, 'and its history');
select is_empty($$ select 1 from public.events where treasury = tests.addr(11) $$, 'but nothing of another treasury');
select is_empty($$ select 1 from public.read_marks $$, 'a signer''s read marks stay that signer''s');

select tests.claims(11);
select results_eq($$ select address::text from public.treasuries $$, $$ values (tests.addr(11)::text) $$,
	'the other account reads its own treasury only');
select results_eq($$ select count(*)::int from public.proposals $$, $$ values (1) $$, 'and its own proposals');

select tests.claims(5);
select is_empty($$ select 1 from public.treasuries $$, 'a stranger still reads nothing');
select is_empty($$ select 1 from public.proposals $$, 'no proposal either');

-- --------------------------------------------------------------------- writes
select throws_ok($$ select tests.propose(10, 10, 2, 20) $$, '42501', null, 'the account cannot propose');
select throws_ok($$ select tests.sign(10, 10, 1) $$, '42501', null, 'cannot sign');
select throws_ok($$ select tests.say_no(10, 10, 1) $$, '42501', null, 'cannot say no');
select throws_ok($$ select tests.end_it(10, 10, 1, 'withdrawn') $$, '42501', null, 'cannot end a proposal');
select throws_ok($$ select tests.receipt(10, 10, 1, '{}') $$, '42501', null, 'cannot record a result');
select throws_ok($$ select tests.report(10, 10, 1, 1) $$, '42501', null, 'cannot report a transaction');
select throws_ok($$ select tests.nick(10, 10, tests.addr(51), 'Mine') $$, '42501', null, 'cannot give a nickname');
select throws_ok($$ select tests.view(10, 10, 1) $$, '42501', null, 'cannot record a view');
select throws_ok($$ select tests.mark(10, 10, 1) $$, '42501', null, 'cannot mark anything read');
select throws_ok($$ select tests.request(10, 'check', 'testnet', 10) $$, '42501', null, 'cannot ask for a re-check');
select tests.claims(10);
select is((select count(*)::int from public.signatures where signer = tests.addr(10)), 0, 'nothing was stored under its name');
reset role;

-- ---------------------------------------------------------------------- pings
select tests.forget_pings();
select tests.sign(2, 10, 1);
select is(tests.pinged(), tests.addrs(1, 2, 3, 10)::text[], 'a signature pings the signers and the account itself');
select tests.forget_pings();
select tests.nick(2, 10, tests.addr(52), 'Rent');
select is(tests.pinged(), tests.addrs(1, 2, 3, 10)::text[], 'a nickname too');
select tests.forget_pings();
select tests.view(3, 10, 1);
select is(tests.pinged(), tests.addrs(1, 2, 3, 10)::text[], 'and a first view');
select tests.forget_pings();
select tests.sign(4, 11, 4);
select is(tests.pinged(), tests.addrs(4, 11)::text[], 'another treasury''s news reaches only its own people');

select * from finish();
rollback;
