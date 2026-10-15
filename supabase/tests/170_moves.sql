-- A move is two proposals the pages show as one (staking: move in, then
-- stake). Nothing in the relay knows about moves: the tie is a field in each
-- document's unsigned part, which the relay stores and does not read. What
-- the pages rely on is pinned here: such a document is taken as it is, and a
-- write of both steps in ONE statement is taken whole or not at all, so the
-- limits, the proposer rule and a closed step never leave a move half done.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 4) n;
-- T10: wallets 1, 2, 3 (2 of 3). T13: wallet 1 alone.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 13, 1, array[1]);

-- The two steps of a move, shared by wallet n in one statement.
create function tests.propose_pair(
	n int, n_treasury int, n_finaliser int, d1 int, d2 int, p_steps jsonb default null
) returns void
language plpgsql as $$
declare
	nonce bigint := tests.now_ms();
	meta jsonb := jsonb_build_object('kind', 'user-signed', 'title', null, 'note', null,
		'steps', coalesce(p_steps, jsonb_build_array(tests.digest(d1), tests.digest(d2))));
begin
	perform tests.claims(n);
	insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values
		('testnet', tests.addr(n_treasury), tests.digest(d1),
			tests.doc('testnet', n_treasury, n_finaliser, d1, nonce, jsonb_build_object('meta', meta), '{}', 'cDeposit'),
			tests.addr(n_finaliser), nonce),
		('testnet', tests.addr(n_treasury), tests.digest(d2),
			tests.doc('testnet', n_treasury, n_finaliser, d2, nonce + 1, jsonb_build_object('meta', meta), '{}', 'tokenDelegate'),
			tests.addr(n_finaliser), nonce + 1);
end $$;

create function tests.open_count(n_treasury int) returns int
language sql stable as $$
	select count(*)::int from public.proposals where treasury = tests.addr(n_treasury) and status = 'open'
$$;

set local role authenticated;

-- ------------------------------------------------------------------ the tie
select lives_ok($$ select tests.propose_pair(1, 10, 2, 1, 2) $$, 'both steps of a move are shared in one statement');
select is(tests.open_count(10), 2, 'and both are stored');
select results_eq(
	$$ select (document::jsonb #> '{meta,steps}')::text from public.proposals where treasury = tests.addr(10) order by nonce $$,
	$$ values (jsonb_build_array(tests.digest(1), tests.digest(2))::text), (jsonb_build_array(tests.digest(1), tests.digest(2))::text) $$,
	'each document keeps the list of the two, as it was written');
select is((select count(*)::int from public.events where kind = 'proposal_created' and treasury = tests.addr(10)), 2,
	'the history has one entry for each step');
select lives_ok($$ select tests.propose_pair(1, 10, 2, 3, 4, '"whatever the page wrote"') $$,
	'the relay does not read the tie: it is the pages that judge it');

-- ------------------------------------------------------------------ the limits
reset role;
delete from public.proposals;
set local role authenticated;
-- 20 pending per wallet per treasury
select tests.propose(1, 10, 2, 100 + n) from generate_series(1, 19) n;
select throws_ok($$ select tests.propose_pair(1, 10, 2, 201, 202) $$, 'P0001', 'relay.pending_cap',
	'with 19 waiting, a move would be the 20th and the 21st: it is refused');
select is(tests.open_count(10), 19, 'and neither step was stored');
select lives_ok($$ select tests.propose(1, 10, 2, 120) $$, 'one more proposal still fits');

-- 50 pending per treasury
select tests.propose(2, 10, 2, 300 + n) from generate_series(1, 20) n;
select tests.propose(3, 10, 2, 400 + n) from generate_series(1, 9) n;
select is(tests.open_count(10), 49, '49 are waiting for the treasury');
select throws_ok($$ select tests.propose_pair(3, 10, 2, 501, 502) $$, 'P0001', 'relay.pending_cap',
	'a move would be the 50th and the 51st: it is refused');
select is(tests.open_count(10), 49, 'and neither step was stored');

-- 30 an hour per wallet: wallet 1 has shared 20, nine more elsewhere make 29
select tests.propose(1, 13, 1, 600 + n) from generate_series(1, 9) n;
select throws_ok($$ select tests.propose_pair(1, 13, 1, 701, 702) $$, 'P0001', 'relay.rate_limited',
	'a move would be the 30th and the 31st within the hour: it is refused');
select is(tests.open_count(13), 9, 'and neither step was stored');

-- ------------------------------------------------------------------ withdrawing both
reset role;
delete from public.proposals;
set local role authenticated;
select tests.propose_pair(1, 10, 2, 1, 2);
select tests.propose(2, 10, 2, 3);
select tests.claims(1);
select throws_ok($$ insert into public.endings (network, treasury, digest, kind) values
	('testnet', tests.addr(10), tests.digest(1), 'withdrawn'),
	('testnet', tests.addr(10), tests.digest(3), 'withdrawn') $$, 'P0001', 'relay.not_proposer',
	'a withdrawal of two that names somebody else''s proposal is refused');
select is(tests.open_count(10), 3, 'and withdrew neither');
select lives_ok($$ insert into public.endings (network, treasury, digest, kind) values
	('testnet', tests.addr(10), tests.digest(1), 'withdrawn'),
	('testnet', tests.addr(10), tests.digest(2), 'withdrawn') $$, 'the proposer withdraws both steps in one statement');
select results_eq(
	$$ select status from public.proposals where digest in (tests.digest(1), tests.digest(2)) $$,
	$$ values ('withdrawn'), ('withdrawn') $$, 'and both are closed');
select is((select count(*)::int from public.events where kind = 'proposal_withdrawn'), 2, 'with a history entry each');

-- ------------------------------------------------------------------ a no to both, and back
select tests.propose_pair(1, 10, 2, 11, 12);
select tests.sign(3, 10, 11);
select tests.claims(3);
select lives_ok($$ insert into public.objections (network, treasury, digest) values
	('testnet', tests.addr(10), tests.digest(11)), ('testnet', tests.addr(10), tests.digest(12)) $$,
	'a signer says no to both steps in one statement');
select is((select count(*)::int from public.objections where signer = tests.addr(3)), 2, 'both are on record');
select is_empty($$ select 1 from public.signatures where signer = tests.addr(3) $$,
	'and the signature that signer had given on one step is taken back with it');
-- one of the two is closed meanwhile
select tests.propose_pair(1, 10, 2, 21, 22);
select tests.claims(1);
insert into public.endings (network, treasury, digest, kind) values ('testnet', tests.addr(10), tests.digest(22), 'withdrawn');
select tests.claims(2);
select throws_ok($$ insert into public.objections (network, treasury, digest) values
	('testnet', tests.addr(10), tests.digest(21)), ('testnet', tests.addr(10), tests.digest(22)) $$, 'P0001', 'relay.proposal_closed',
	'a no to two where one is closed is refused');
select is_empty($$ select 1 from public.objections where signer = tests.addr(2) $$, 'and said to neither');

select tests.claims(3);
select lives_ok($$ delete from public.objections where network = 'testnet' and treasury = tests.addr(10)
	and digest in (tests.digest(11), tests.digest(12)) and signer = tests.addr(3) $$, 'the signer takes both back in one statement');
select is_empty($$ select 1 from public.objections where signer = tests.addr(3) $$, 'and neither stands');

-- ------------------------------------------------------------------ signatures taken back together
select tests.propose_pair(1, 10, 2, 31, 32);
select tests.sign(3, 10, 31);
select tests.sign(3, 10, 32);
select tests.sign(3, 10, 11);
select tests.sign(3, 10, 12);
-- one step of the move 31, 32 is closed after it was signed
select tests.claims(1);
insert into public.endings (network, treasury, digest, kind) values ('testnet', tests.addr(10), tests.digest(32), 'withdrawn');
select tests.claims(3);
select throws_ok($$ delete from public.signatures where network = 'testnet' and treasury = tests.addr(10)
	and digest in (tests.digest(31), tests.digest(32)) and signer = tests.addr(3) $$, 'P0001', 'relay.proposal_closed',
	'signatures cannot be taken back in one statement that reaches into a closed proposal');
select is((select count(*)::int from public.signatures where signer = tests.addr(3)), 4, 'so none was');
select lives_ok($$ delete from public.signatures where network = 'testnet' and treasury = tests.addr(10)
	and digest in (tests.digest(11), tests.digest(12)) and signer = tests.addr(3) $$, 'both signatures of an open move are taken back in one statement');
select results_eq(
	$$ select digest::text from public.signatures where signer = tests.addr(3) order by digest $$,
	$$ values (tests.digest(31)::text), (tests.digest(32)::text) $$, 'and only those');
reset role;

select * from finish();
