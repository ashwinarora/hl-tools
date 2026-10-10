-- Who has seen a proposal (shared with the treasury's signers) and how far a
-- signer has read (the signer's own).
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
-- a wallet's marker for a treasury: the newest row, as the page reads it
create function tests.marker(n int, n_treasury int) returns text
language sql security definer as $$
	select event_id || ' ' || chain::text from public.read_marks
	where wallet = tests.addr(n) and treasury = tests.addr(n_treasury)
	order by id desc limit 1
$$;

select tests.make_wallet(n) from generate_series(1, 5) n;
-- T10: wallets 1, 2, 3. T11: wallet 4. Wallet 5: nothing.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);
select tests.propose(1, 10, 2, 1, tests.now_ms() + 1);
select tests.propose(1, 10, 2, 2, tests.now_ms() + 2);
select tests.propose(4, 11, 4, 3, tests.now_ms() + 3);
select tests.forget_pings();

-- ----------------------------------------------------------------------- views
set local role authenticated;
select lives_ok($$ select tests.view(2, 10, 1) $$, 'a signer''s first look at a proposal is recorded');
select results_eq($$ select signer::text, seen_at = now() from public.proposal_views $$,
	$$ values (tests.addr(2)::text, true) $$, 'under its own name, now');
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'and every signer of that treasury is told');
select tests.forget_pings();

select lives_ok($$ select tests.view(2, 10, 1) $$, 'looking again is not an error');
select is((select count(*)::int from public.proposal_views), 1, 'and not a second row');
select is(tests.pinged(), '{}', 'nor a second ping');

select tests.claims(1);
select is((select count(*)::int from public.proposal_views where signer = tests.addr(2)), 1,
	'the proposer reads who has seen it');
select tests.claims(3);
select is((select count(*)::int from public.proposal_views), 1, 'so does every other signer of the treasury');
select tests.claims(4);
select is((select count(*)::int from public.proposal_views), 0, 'another treasury''s signer does not');
select tests.claims(5);
select is((select count(*)::int from public.proposal_views), 0, 'nor a stranger');

select throws_ok($$ select tests.view(5, 10, 1) $$, '42501', null, 'a stranger cannot record a view');
select throws_ok($$ select tests.view(4, 10, 1) $$, '42501', null, 'nor another treasury''s signer');
select throws_ok($$ select tests.view(99, 10, 1) $$, '42501', null, 'nor a session with no wallet');
select throws_ok($$ select tests.view(1, 10, 77) $$, '23503', null, 'nor anybody for a proposal the relay does not have');
select tests.claims(1);
select throws_ok($$ insert into public.proposal_views (network, treasury, digest, signer)
	values ('testnet', tests.addr(10), tests.digest(1), tests.addr(3)) $$, '42501', null,
	'nobody says that somebody else has seen it');
select throws_ok($$ insert into public.proposal_views (network, treasury, digest, seen_at)
	values ('testnet', tests.addr(10), tests.digest(2), now() - interval '1 day') $$, '42501', null, 'nor when');
select throws_ok($$ update public.proposal_views set seen_at = now() $$, '42501', null, 'a view cannot be edited');
select throws_ok($$ delete from public.proposal_views $$, '42501', null, 'nor taken back');
reset role;

-- closed proposals are not worth a row
select tests.end_it(1, 10, 2, 'withdrawn');
select tests.forget_pings();
set local role authenticated;
select lives_ok($$ select tests.view(3, 10, 2) $$, 'opening a closed proposal is not an error');
select is_empty($$ select 1 from public.proposal_views where digest = tests.digest(2) $$, 'and leaves no row');
reset role;
select is(tests.pinged(), '{}', 'and no ping');
update public.proposals set expires_at = now() - interval '1 minute' where digest = tests.digest(1);
set local role authenticated;
select lives_ok($$ select tests.view(3, 10, 1) $$, 'nor is opening one whose window has closed');
select is((select count(*)::int from public.proposal_views where digest = tests.digest(1)), 1, 'which keeps the views it had');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.proposal_views $$, '42501', null, 'anon cannot read views');
select throws_ok($$ select tests.view(1, 10, 1) $$, '42501', null, 'nor record one, whatever claims it carries');
reset role;

-- a view goes with its proposal
delete from public.proposals where digest = tests.digest(1);
select is_empty($$ select 1 from public.proposal_views $$, 'views are removed with their proposal');

-- ---------------------------------------------------------------------- marks
select tests.forget_pings();
set local role authenticated;
select lives_ok(format('select tests.mark(1, 10, %s)', tests.newest_event(10)), 'a signer marks a treasury''s news as read');
select is(tests.marker(1, 10), tests.newest_event(10) || ' {}', 'up to the entry it named');
select is(tests.pinged(), array[tests.addr(1)::text], 'only that wallet''s own pages are told');

select tests.claims(2);
select is((select count(*)::int from public.read_marks), 0, 'a co-signer cannot read another signer''s marker');
select tests.claims(1);
select is((select count(*)::int from public.read_marks), 1, 'its owner can');

-- only forward
select lives_ok($$ select tests.mark(1, 10, 1) $$, 'an older "Got it" arriving late is accepted');
select is(tests.marker(1, 10), tests.newest_event(10) || ' {}', 'and changes nothing: the marker never moves back');
select throws_ok(format('select tests.mark(1, 10, %s)', tests.newest_event(10) + 1), 'P0001', 'relay.mark_invalid',
	'a marker cannot point past the newest history entry');
select throws_ok($$ select tests.mark(1, 10, -1) $$, 'P0001', 'relay.mark_invalid', 'nor before the first');
select throws_ok($$ insert into public.read_marks (network, treasury, event_id) values ('testnet', tests.addr(10), null) $$,
	'P0001', 'relay.mark_invalid', 'nor at nothing');

-- what only Hyperliquid knows
select lives_ok(format($f$ select tests.mark(1, 10, %s, '{"ledgerTime": 1791400000000, "agents": ["0x7e57000000000000000000000000000000000aaa"]}') $f$, tests.newest_event(10)),
	'a marker may carry a ledger time and the API wallets the signer knew of');
select lives_ok(format($f$ select tests.mark(1, 10, %s, '{"ledgerTime": 1791300000000}') $f$, tests.newest_event(10)),
	'a marker with an earlier ledger time is accepted');
select is(tests.marker(1, 10),
	tests.newest_event(10) || ' {"agents": ["0x7e57000000000000000000000000000000000aaa"], "ledgerTime": 1791400000000}',
	'and keeps the later time, and the API wallets it did not mention');
select lives_ok(format($f$ select tests.mark(1, 10, %s, '{"ledgerTime": 1791500000000, "agents": []}') $f$, tests.newest_event(10)),
	'a later time and another list replace them');
select is(tests.marker(1, 10), tests.newest_event(10) || ' {"agents": [], "ledgerTime": 1791500000000}', 'as given');

reset role;
select is(
	(select array_agg(private.mark_chain_ok(c::jsonb) order by n) from (values
		(1, '{}'),
		(2, '{"ledgerTime": 0}'),
		(3, '{"agents": []}'),
		(4, '{"ledgerTime": 1791400000000, "agents": ["0x7e57000000000000000000000000000000000aaa", "0x7e57000000000000000000000000000000000bbb"]}')
	) t(n, c)),
	array[true, true, true, true], 'what a marker may carry');
select is(
	(select array_agg(private.mark_chain_ok(c::jsonb) order by n) from (values
		(1, '[]'),
		(2, '"x"'),
		(3, 'null'),
		(4, '{"other": 1}'),
		(5, '{"ledgerTime": "soon"}'),
		(6, '{"ledgerTime": -1}'),
		(7, '{"ledgerTime": 1.5}'),
		(8, '{"ledgerTime": 99999999999999}'),
		(9, '{"agents": "0x7e57000000000000000000000000000000000aaa"}'),
		(10, '{"agents": ["0x7E57000000000000000000000000000000000AAA"]}'),
		(11, '{"agents": ["nobody"]}'),
		(12, '{"agents": [5]}'),
		(13, '{"agents": ["0x7e57000000000000000000000000000000000aaa", "0x7e57000000000000000000000000000000000aaa"]}')
	) t(n, c)),
	array_fill(false, array[13]), 'and what it may not: other fields, other shapes, a time far ahead, addresses that are not, repeats');
select ok(not private.mark_chain_ok(
	jsonb_build_object('agents', (select jsonb_agg('0x' || lpad(to_hex(n), 40, '0')) from generate_series(1, 51) n))),
	'nor more than 50 API wallets');
set local role authenticated;
select throws_ok(format($f$ select tests.mark(1, 10, %s, '{"note": "hello"}') $f$, tests.newest_event(10)), 'P0001', 'relay.mark_invalid',
	'a marker is not a place to keep anything else');

-- who may
select throws_ok($$ select tests.mark(5, 10, 0) $$, '42501', null, 'a stranger has no marker in a treasury');
select throws_ok($$ select tests.mark(4, 10, 0) $$, '42501', null, 'nor another treasury''s signer');
select throws_ok($$ select tests.mark(99, 10, 0) $$, '42501', null, 'nor a session with no wallet');
select tests.claims(2);
select throws_ok($$ insert into public.read_marks (network, treasury, event_id, wallet)
	values ('testnet', tests.addr(10), 0, tests.addr(1)) $$, '42501', null, 'nobody moves another wallet''s marker');
select throws_ok($$ update public.read_marks set event_id = 0 $$, '42501', null, 'a marker cannot be edited');
select throws_ok($$ delete from public.read_marks $$, '42501', null, 'nor removed');

-- "Mark all as read": one statement, a row per treasury
select tests.claims(1);
reset role;
select tests.seed_treasury('testnet', 12, 1, array[1]);
select private.log_event('testnet', tests.addr(12), null, 'treasury_added', tests.addr(1));
set local role authenticated;
select tests.claims(1);
select lives_ok(format($f$ insert into public.read_marks (network, treasury, event_id) values
	('testnet', tests.addr(10), %s), ('testnet', tests.addr(12), %s) $f$, tests.newest_event(10), tests.newest_event(12)),
	'several treasuries are marked in one statement');
select is((select count(distinct treasury)::int from public.read_marks), 2, 'each with its own marker');
select throws_ok(format($f$ insert into public.read_marks (network, treasury, event_id) values
	('testnet', tests.addr(12), %s), ('testnet', tests.addr(11), 0) $f$, tests.newest_event(12)), '42501', null,
	'and not if one of them is somebody else''s treasury');

-- a signer who is removed stops reading its markers
reset role;
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(2, 3), 2);
set local role authenticated;
select tests.claims(1);
select is((select count(distinct treasury)::int from public.read_marks), 1, 'a removed signer no longer reads its marker for that treasury');
select throws_ok($$ select tests.mark(1, 10, 0) $$, '42501', null, 'nor moves it');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.read_marks $$, '42501', null, 'anon cannot read markers');
reset role;

-- ------------------------------------------------------------------ rate limit
delete from public.read_marks;
-- (the trigger stamps the wallet from the session, whoever inserts)
select tests.claims(2);
insert into public.read_marks (network, treasury, event_id)
select 'testnet', tests.addr(10), 0 from generate_series(1, 599);
set local role authenticated;
select lives_ok($$ select tests.mark(2, 10, 0) $$, 'the 600th marker in an hour is taken');
select throws_ok($$ select tests.mark(2, 10, 0) $$, 'P0001', 'relay.rate_limited', 'the 601st is refused');
select lives_ok($$ select tests.mark(3, 10, 0) $$, 'another signer has their own allowance');
reset role;

-- ---------------------------------------------------------------- housekeeping
delete from public.read_marks;
select tests.mark(2, 10, 0);
select tests.mark(2, 10, 0);
select tests.mark(3, 10, 0);
-- wallet 2: two old markers; wallet 3: one very old one
update public.read_marks m set marked_at = now() - interval '35 days' - (
	select count(*) from public.read_marks n where n.wallet = m.wallet and n.id > m.id) * interval '5 days'
where m.wallet = tests.addr(2);
update public.read_marks set marked_at = now() - interval '90 days' where wallet = tests.addr(3);
select tests.nick(2, 10, tests.addr(50), 'Old');
select tests.nick(2, 10, tests.addr(51), 'Recent');
update public.nickname_changes set changed_at = now() - interval '366 days' where name = 'Old';
update public.nickname_changes set changed_at = now() - interval '10 days' where name = 'Recent';
select private.prune();
select results_eq($$ select wallet::text, count(*)::int from public.read_marks group by wallet order by wallet $$,
	$$ values (tests.addr(2)::text, 1), (tests.addr(3)::text, 1) $$,
	'old markers go, but each wallet keeps its newest for a treasury, however old');
select results_eq($$ select name from public.nickname_changes where treasury = tests.addr(10) and changed_by = tests.addr(2) order by name $$,
	$$ values ('Recent') $$, 'the record of nickname changes is kept for a year');

select ok(not has_function_privilege('authenticated', 'private.mark_chain_ok(jsonb)', 'execute'), 'the checks are not callable through the API');

select * from finish();
rollback;
