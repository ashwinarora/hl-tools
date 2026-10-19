-- Nicknames: one treasury's own words for an address. Who may give one, what
-- one may look like, and that no other treasury ever sees it.
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
language sql as $$ delete from realtime.messages where topic like 'wallet:0x7e57%' $$;
-- The detail a refusal carries, for the sentence a signer reads.
create function tests.detail_of(p_sql text) returns text
language plpgsql as $$
declare
	d text;
begin
	begin
		execute p_sql;
	exception when others then
		get stacked diagnostics d = pg_exception_detail;
		return d;
	end;
	return 'no error';
end $$;

select tests.make_wallet(n) from generate_series(1, 6) n;
-- T10: wallets 1, 2, 3. T11: wallets 1 and 4 (wallet 1 signs for both). Wallet 5: nothing.
-- Address 50 is a destination both treasuries pay; 51 another one.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[1, 4]);
select tests.forget_pings();

-- ------------------------------------------------------------------ the rules
select is(private.nickname_text(E'  Ops \t  lead \n'), 'Ops lead', 'white space is trimmed and collapsed');
select is(private.nickname_text('Ｆｕｌｌ'), 'Full', 'compatibility forms are folded');
select is(private.nickname_key('  AUDITOR '), 'auditor', 'names are compared without capitals');
select is(private.nickname_problem('Auditor'), null, 'an ordinary name is fine');
select is(private.nickname_problem('Ops lead (Berlin) #2'), null, 'with punctuation and digits');
select is(private.nickname_problem('Büro Zürich 東京'), null, 'in any script');
select is(private.nickname_problem(repeat('a', 40)), null, '40 characters fit');
select isnt(private.nickname_problem(repeat('a', 41)), null, '41 do not');
select isnt(private.nickname_problem(''), null, 'nor nothing at all');
select isnt(private.nickname_problem(null), null, 'nor null');
select is(
	(select array_agg(private.nickname_problem(x) order by n) from (values
		(1, '0x5e7c3420160987d04db5e8ed6d5bc14f61237216'),
		(2, '0x5e7c…7216'),
		(3, 'Alice 0Xb0'),
		(4, 'pay 0xa')) t(n, x)),
	array_fill('A nickname cannot look like an address.'::text, array[4]),
	'nothing that reads like an address, whole, shortened, or inside a name');
select is(private.nickname_problem('Box 0 x-ray'), null, '(a zero and an x apart are not an address)');
select is(
	(select array_agg(private.nickname_problem(x) is not null order by n) from (values
		(1, 'you'), (2, 'You'), (3, 'SOMEONE'), (4, 'someone')) t(n, x)),
	array[true, true, true, true],
	'the words the screens use for the reader and for the unknown are taken');
select is(private.nickname_problem('You two'), null, '(only as the whole name)');
select is(
	(select array_agg(private.nickname_problem(x) order by n) from (values
		(1, E'Alice\u202Eecila'), (2, E'Al\u200Bice'), (3, E'Alice\u2066'), (4, E'Al\x07ice'), (5, E'\uFEFFAlice')) t(n, x)),
	array_fill('A nickname cannot contain invisible or direction-changing characters.'::text, array[5]),
	'no invisible or direction-changing characters');

-- ------------------------------------------------------------------- naming
set local role authenticated;
select lives_ok($$ select tests.nick(1, 10, tests.addr(50), '  The   Auditor ') $$, 'a signer names a destination');
select results_eq(
	$$ select name, name_key, set_by::text, set_at = now() from public.nicknames where treasury = tests.addr(10) $$,
	$$ values ('The Auditor', 'the auditor', tests.addr(1)::text, true) $$,
	'it is stored tidied, with who gave it and when');
select is(tests.pinged(), tests.addrs(1, 2, 3, 10)::text[], 'every signer of that treasury and the account itself is told, and nobody else');

select lives_ok($$ select tests.nick(2, 10, tests.addr(50), 'Auditor') $$, 'any signer may change it');
select results_eq($$ select name, set_by::text from public.nicknames where treasury = tests.addr(10) and address = tests.addr(50) $$,
	$$ values ('Auditor', tests.addr(2)::text) $$, 'the latest change stands, under the name of who made it');
select lives_ok($$ select tests.nick(1, 10, tests.addr(10), 'Operations') $$, 'the treasury itself can be given a nickname, by any signer');
select lives_ok($$ select tests.nick(3, 10, tests.addr(10), 'Ops treasury') $$, 'and another signer can change it');

-- a signer's own address
select lives_ok($$ select tests.nick(1, 10, tests.addr(1), 'Alice') $$, 'a signer names their own address');
select throws_ok($$ select tests.nick(2, 10, tests.addr(1), 'Boss') $$, 'P0001', 'relay.nickname_not_yours',
	'nobody else may rename a signer');
select throws_ok($$ select tests.nick(2, 10, tests.addr(1), null) $$, 'P0001', 'relay.nickname_not_yours',
	'nor take their nickname away');
select throws_ok($$ select tests.nick(1, 10, tests.addr(2), 'Bob') $$, 'P0001', 'relay.nickname_not_yours',
	'nor name a signer who chose to stay unnamed');
select is(tests.nick_of(10, tests.addr(1)), 'Alice', 'so the name is the signer''s own choice');
select lives_ok($$ select tests.nick(1, 10, tests.addr(1), null) $$, 'who can also go back to being unnamed');
select is(tests.nick_of(10, tests.addr(1)), null, 'and then has none');
select lives_ok($$ select tests.nick(1, 10, tests.addr(1), 'Alice') $$, '(named again for what follows)');

-- one name, one address
select throws_ok($$ select tests.nick(3, 10, tests.addr(51), 'auditor') $$, 'P0001', 'relay.nickname_taken',
	'a name already in use in the treasury is refused for another address, whatever its capitals');
select is(tests.detail_of($$ select tests.nick(3, 10, tests.addr(51), ' AUDITOR  ') $$),
	'Another address in this treasury already has that nickname.', 'in words');
select throws_ok($$ select tests.nick(3, 10, tests.addr(51), 'Alice') $$, 'P0001', 'relay.nickname_taken',
	'a signer''s chosen name cannot be given to something else');
select lives_ok($$ select tests.nick(2, 10, tests.addr(50), 'AUDITOR') $$, 'the address that has a name may have it respelled');
select lives_ok($$ select tests.nick(2, 10, tests.addr(50), null) $$, 'a signer takes a destination''s nickname away');
select lives_ok($$ select tests.nick(3, 10, tests.addr(51), 'Auditor') $$, 'and then the name is free for another address');
select lives_ok($$ select tests.nick(3, 10, tests.addr(52), null) $$, 'taking away a nickname that is not there is not an error');

-- what a nickname may be
select throws_ok($$ select tests.nick(1, 10, tests.addr(53), '0x5e7c…7216') $$, 'P0001', 'relay.nickname_invalid', 'address-like: refused');
select is(tests.detail_of($$ select tests.nick(1, 10, tests.addr(53), '0x5e7c…7216') $$),
	'A nickname cannot look like an address.', 'with the reason');
select throws_ok($$ select tests.nick(1, 10, tests.addr(53), 'You') $$, 'P0001', 'relay.nickname_invalid', 'reserved: refused');
select throws_ok($$ select tests.nick(1, 10, tests.addr(53), '   ') $$, 'P0001', 'relay.nickname_invalid', 'blank: refused');
select throws_ok($$ select tests.nick(1, 10, tests.addr(53), repeat('x', 41)) $$, 'P0001', 'relay.nickname_invalid', 'too long: refused');
select throws_ok($$ select tests.nick(1, 10, tests.addr(53), E'A\u202Eb') $$, 'P0001', 'relay.nickname_invalid', 'direction-changing: refused');
select is((select count(*)::int from public.nickname_changes where address = tests.addr(53)), 0,
	'a refused change leaves no trace');

-- ---------------------------------------------- one treasury never sees another's
select lives_ok($$ select tests.nick(1, 11, tests.addr(50), 'Lawyer') $$, 'the same address gets another name in another treasury');
select lives_ok($$ select tests.nick(4, 11, tests.addr(51), 'Auditor') $$, 'and a name used in one treasury is free in the other');
select lives_ok($$ select tests.nick(1, 11, tests.addr(1), 'A.') $$, 'a signer of two treasuries may be named differently in each');

select tests.claims(2);
select results_eq($$ select treasury::text, address::text, name from public.nicknames order by address, name $$,
	$$ values (tests.addr(10)::text, tests.addr(1)::text, 'Alice'),
		(tests.addr(10)::text, tests.addr(10)::text, 'Ops treasury'),
		(tests.addr(10)::text, tests.addr(51)::text, 'Auditor') $$,
	'a signer of one treasury reads that treasury''s nicknames only');
select is((select count(*)::int from public.nickname_changes where treasury = tests.addr(11)), 0, 'and none of the other''s changes');
select tests.claims(4);
select results_eq($$ select address::text, name from public.nicknames order by address $$,
	$$ values (tests.addr(1)::text, 'A.'), (tests.addr(50)::text, 'Lawyer'), (tests.addr(51)::text, 'Auditor') $$,
	'the other treasury''s signer reads its own, where the shared addresses carry other names');
select tests.claims(1);
select is((select count(*)::int from public.nicknames), 6, 'a signer of both reads both, each under its treasury');
select tests.claims(5);
select is((select count(*)::int from public.nicknames) + (select count(*)::int from public.nickname_changes), 0, 'a stranger reads none');
select tests.claims(99);
select is((select count(*)::int from public.nicknames), 0, 'nor a session with no wallet');

-- who may not
select throws_ok($$ select tests.nick(5, 10, tests.addr(54), 'Mine') $$, '42501', null, 'a stranger cannot name anything');
select throws_ok($$ select tests.nick(4, 10, tests.addr(54), 'Mine') $$, '42501', null, 'nor another treasury''s signer');
select throws_ok($$ select tests.nick(99, 10, tests.addr(54), 'Mine') $$, '42501', null, 'nor a session with no wallet');
select tests.claims(1);
select throws_ok($$ insert into public.nicknames (network, treasury, address, name, name_key, set_by)
	values ('testnet', tests.addr(10), tests.addr(54), 'Direct', 'direct', tests.addr(1)) $$, '42501', null,
	'the names themselves are written by the database only');
select throws_ok($$ update public.nicknames set name = 'Edited' $$, '42501', null, 'never edited');
select throws_ok($$ delete from public.nicknames $$, '42501', null, 'never deleted');
select throws_ok($$ insert into public.nickname_changes (network, treasury, address, name, changed_by)
	values ('testnet', tests.addr(10), tests.addr(54), 'Forged', tests.addr(2)) $$, '42501', null,
	'and a change cannot be filed under another wallet');
select throws_ok($$ update public.nickname_changes set name = 'Rewritten' $$, '42501', null, 'the record of changes cannot be rewritten');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.nicknames $$, '42501', null, 'anon cannot read nicknames');
select throws_ok($$ select tests.nick(1, 10, tests.addr(54), 'Anon') $$, '42501', null, 'nor give one, whatever claims it carries');
reset role;

-- ---------------------------------------------------- an address becomes a signer
-- address 51 ("Auditor" in T10, named by wallet 3) is wallet 6's; it joins T10
select is(tests.addr(6), tests.addr(6), '(wallet 6 exists)');
set local role authenticated;
select tests.nick(1, 10, tests.addr(6), 'New hire');
reset role;
select is(tests.nick_of(10, tests.addr(6)), 'New hire', 'before joining, others may name the address');
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2, 3, 6), 2);
select is(tests.nick_of(10, tests.addr(6)), null, 'a nickname others gave is dropped when the address becomes a signer');
set local role authenticated;
select throws_ok($$ select tests.nick(1, 10, tests.addr(6), 'New hire') $$, 'P0001', 'relay.nickname_not_yours',
	'and from then on only the new signer names it');
select lives_ok($$ select tests.nick(6, 10, tests.addr(6), 'Dana') $$, 'which they can');
reset role;
-- a signer who is removed keeps the name they chose; others may then change it
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2, 3), 2);
select is(tests.nick_of(10, tests.addr(6)), 'Dana', 'leaving the signer set does not erase the name');
set local role authenticated;
select lives_ok($$ select tests.nick(1, 10, tests.addr(6), 'Dana (left)') $$, 'the remaining signers may now relabel that address');
select throws_ok($$ select tests.nick(6, 10, tests.addr(6), 'Still me') $$, '42501', null, 'the one who left may not');
reset role;
-- and a name they gave themselves survives coming back
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2, 3, 6), 2);
select is(tests.nick_of(10, tests.addr(6)), null, 'coming back, a name set by somebody else meanwhile is dropped again');
select is(tests.nick_of(10, tests.addr(1)), 'Alice', 'the names signers gave themselves are untouched by a signer change');

-- a frozen treasury keeps its names and they can still be tidied
update public.treasuries set frozen_at = now() where address = tests.addr(11);
set local role authenticated;
select lives_ok($$ select tests.nick(4, 11, tests.addr(55), 'Old vendor') $$, 'a treasury that stopped being a multi-sig can still be annotated by its last signers');
reset role;

-- ------------------------------------------------------------------ limits
delete from public.nickname_changes;
set local role authenticated;
select lives_ok(format('select tests.nick(2, 10, tests.addr(%s), %L)', 100 + n, 'Vendor ' || n), 'change ' || n || ' of 60 in an hour')
from generate_series(1, 60) n;
select throws_ok($$ select tests.nick(2, 10, tests.addr(199), 'One more') $$, 'P0001', 'relay.rate_limited', 'the sixty-first is refused');
select lives_ok($$ select tests.nick(3, 10, tests.addr(199), 'One more') $$, 'another signer has their own allowance');
reset role;
update public.nickname_changes set changed_at = now() - interval '61 minutes' where changed_by = tests.addr(2);
set local role authenticated;
select lives_ok($$ select tests.nick(2, 10, tests.addr(200), 'Next hour') $$, 'an hour later there is room again');
reset role;
-- a treasury keeps at most 500
insert into public.nicknames (network, treasury, address, name, name_key, set_by)
select 'testnet', tests.addr(10), tests.addr(1000 + n), 'Bulk ' || n, 'bulk ' || n, tests.addr(1)
from generate_series(1, 500 - (select count(*)::int from public.nicknames where treasury = tests.addr(10))) n;
select is((select count(*)::int from public.nicknames where treasury = tests.addr(10)), 500, '(the treasury now holds 500)');
set local role authenticated;
select throws_ok($$ select tests.nick(3, 10, tests.addr(2000), 'Too many') $$, 'P0001', 'relay.nickname_cap', 'the 501st nickname is refused');
select lives_ok($$ select tests.nick(3, 10, tests.addr(1001), 'Renamed') $$, 'renaming one of the 500 is not');
select lives_ok($$ select tests.nick(3, 10, tests.addr(1002), null) $$, 'nor removing one');
select lives_ok($$ select tests.nick(3, 10, tests.addr(2000), 'Fits now') $$, 'after which there is room for one');
reset role;

-- the table refuses by itself what the trigger would never write
select throws_ok($$ insert into public.nicknames (network, treasury, address, name, name_key, set_by)
	values ('testnet', tests.addr(11), tests.addr(60), '0xdeadbeef', '0xdeadbeef', tests.addr(1)) $$, '23514', null,
	'even written directly, an address-like nickname does not fit the table');
select throws_ok($$ insert into public.nicknames (network, treasury, address, name, name_key, set_by)
	values ('testnet', tests.addr(11), tests.addr(60), 'Mixed Case', 'something else', tests.addr(1)) $$, '23514', null,
	'nor a key that is not the name');
select throws_ok($$ insert into public.nicknames (network, treasury, address, name, name_key, set_by)
	values ('testnet', tests.addr(11), tests.addr(60), 'auditor', 'auditor', tests.addr(1)) $$, '23505', null,
	'nor a second address under one name');

select ok(not has_function_privilege('authenticated', 'private.nickname_problem(text)', 'execute'), 'the rules are not callable through the API');

select * from finish();
rollback;
