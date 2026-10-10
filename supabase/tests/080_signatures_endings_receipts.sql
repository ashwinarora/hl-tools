-- Signing, taking back, ending, and recording the result.
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

set local role authenticated;

-- ------------------------------------------------------------------ signatures
select lives_ok($$ select tests.sign(1, 10, 1) $$, 'a signer adds its signature');
select results_eq($$ select signer::text, v::int from public.signatures where digest = tests.digest(1) $$,
	$$ values (tests.addr(1)::text, 27) $$, 'stamped with the session wallet');
select lives_ok($$ select tests.sign(3, 10, 1) $$, 'a co-signer adds theirs');
select throws_ok($$ select tests.sign(1, 10, 1) $$, '23505', null, 'one signature per signer per proposal');

select tests.claims(2);
select throws_ok($$ insert into public.signatures (network, treasury, digest, signer, r, s, v)
	values ('testnet', tests.addr(10), tests.digest(1), tests.addr(3), tests.digest(1), tests.digest(2), 27) $$,
	'42501', null, 'a signature cannot be filed under another signer''s name');
select throws_ok($$ insert into public.signatures (network, treasury, digest, r, s, v)
	values ('testnet', tests.addr(10), tests.digest(1), tests.digest(1), tests.digest(2), 29) $$, '23514', null, 'v must be 27 or 28');
select throws_ok($$ insert into public.signatures (network, treasury, digest, r, s, v)
	values ('testnet', tests.addr(10), tests.digest(1), '0x1234', tests.digest(2), 27) $$, '23514', null, 'r must be 32 bytes of lowercase hex');
select throws_ok($$ select tests.sign(2, 10, 999) $$, '23503', null, 'a signature needs its proposal');
select throws_ok($$ select tests.sign(5, 10, 1) $$, '42501', null, 'a stranger cannot sign');
select throws_ok($$ select tests.sign(4, 10, 1) $$, '42501', null, 'a signer of another treasury cannot sign here');
select throws_ok($$ select tests.sign(4, 11, 1) $$, '23503', null, 'nor file a signature for this digest under its own treasury');

-- reading
select tests.claims(2);
select is((select count(*)::int from public.signatures where digest = tests.digest(1)), 2, 'co-signers read every signature');
select tests.claims(4);
select is_empty('select 1 from public.signatures', 'another treasury''s signer reads none');

-- taking back
select tests.claims(2);
delete from public.signatures where digest = tests.digest(1) and signer = tests.addr(1);
select is((select count(*)::int from public.signatures where digest = tests.digest(1)), 2, 'a signer cannot remove someone else''s signature');
select tests.claims(1);
delete from public.signatures where digest = tests.digest(1) and signer = tests.addr(1);
select is((select count(*)::int from public.signatures where digest = tests.digest(1)), 1, 'a signer takes back its own');
select lives_ok($$ select tests.sign(1, 10, 1) $$, 'and may sign again');
select throws_ok($$ update public.signatures set r = tests.digest(5) $$, '42501', null, 'a signature cannot be edited');
select is(tests.kinds(10, 1), array['proposal_created', 'signature_added', 'signature_added', 'signature_removed', 'signature_added'],
	'the history has every step, in order');
select results_eq($$ select actor::text from public.events where digest = tests.digest(1) and kind = 'signature_removed' $$,
	array[tests.addr(1)::text], 'with who took theirs back');

-- an expired proposal
reset role;
update public.proposals set expires_at = now() - interval '1 second' where digest = tests.digest(2);
select tests.sign(3, 10, 3);
set local role authenticated;
select throws_ok($$ select tests.sign(1, 10, 2) $$, 'P0001', 'relay.proposal_expired', 'an expired proposal cannot be signed');

-- --------------------------------------------------------------------- endings
select throws_ok($$ select tests.end_it(3, 10, 4, 'withdrawn') $$, 'P0001', 'relay.not_proposer', 'only the proposer withdraws');
select throws_ok($$ select tests.end_it(1, 10, 4, 'declined') $$, 'P0001', 'relay.not_finaliser', 'only the finaliser declines');
select throws_ok($$ select tests.end_it(5, 10, 4, 'withdrawn') $$, '42501', null, 'a stranger ends nothing');
select throws_ok($$ select tests.end_it(4, 10, 4, 'declined') $$, '42501', null, 'nor does another treasury''s signer');
select throws_ok($$ select tests.end_it(1, 10, 4, 'cancelled') $$, '23514', null, 'there is no general cancel');
select throws_ok($$ select tests.end_it(1, 10, 999, 'withdrawn') $$, '23503', null, 'an ending needs its proposal');
select throws_ok($$ select tests.end_it(1, 10, 2, 'withdrawn') $$, 'P0001', 'relay.proposal_expired', 'an expired proposal is already over');
select tests.claims(1);
select throws_ok($$ insert into public.endings (network, treasury, digest, kind, ended_by)
	values ('testnet', tests.addr(10), tests.digest(4), 'declined', tests.addr(2)) $$, '42501', null, 'an ending cannot be filed under another name');

select lives_ok($$ select tests.end_it(1, 10, 4, 'withdrawn') $$, 'the proposer withdraws');
select results_eq($$ select status, closed_at is not null from public.proposals where digest = tests.digest(4) $$,
	$$ values ('withdrawn', true) $$, 'the proposal is closed as withdrawn');
select results_eq($$ select kind, ended_by::text from public.endings where digest = tests.digest(4) $$,
	$$ values ('withdrawn', tests.addr(1)::text) $$, 'with who and when');
select is(tests.kinds(10, 4), array['proposal_created', 'proposal_withdrawn'], 'the history records it');
select throws_ok($$ select tests.end_it(2, 10, 4, 'declined') $$, 'P0001', 'relay.proposal_closed', 'an ended proposal cannot be ended again');
select throws_ok($$ select tests.sign(3, 10, 4) $$, 'P0001', 'relay.proposal_closed', 'nor signed');
select throws_ok($$ update public.endings set kind = 'declined' $$, '42501', null, 'an ending cannot be edited');
select throws_ok($$ delete from public.endings $$, '42501', null, 'nor undone');

select lives_ok($$ select tests.end_it(2, 10, 5, 'declined') $$, 'the finaliser declines');
select is(tests.status(10, 5), 'declined', 'the proposal is closed as declined');
select is(tests.kinds(10, 5), array['proposal_created', 'proposal_declined'], 'the history records it');

-- a signature cannot be taken back once the proposal is over
select tests.claims(3);
select lives_ok($$ select tests.end_it(1, 10, 3, 'withdrawn') $$, 'withdraw a proposal that has a signature');
select tests.claims(3);
select throws_ok($$ delete from public.signatures where digest = tests.digest(3) and signer = tests.addr(3) $$,
	'P0001', 'relay.proposal_closed', 'its signatures can no longer be taken back');

-- -------------------------------------------------------------------- receipts
select throws_ok($$ select tests.receipt(1, 10, 6, '{"status":"ok","response":{"type":"default"}}') $$,
	'P0001', 'relay.not_finaliser', 'only the finaliser records a result');
select throws_ok($$ select tests.receipt(5, 10, 6, '{"status":"ok"}') $$, '42501', null, 'a stranger records nothing');
select tests.claims(2);
select throws_ok($$ insert into public.receipts (network, treasury, digest, submitted_at, signature_chain_id, outer_r, outer_s, outer_v, http_status, response, accepted)
	values ('testnet', tests.addr(10), tests.digest(6), 1, '0x3e6', tests.digest(1), tests.digest(2), 27, 200, '{"status":"err"}', true) $$,
	'42501', null, '"accepted" is not the client''s to say');
select throws_ok($$ insert into public.receipts (network, treasury, digest, submitted_at, signature_chain_id, outer_r, outer_s, outer_v, http_status, response, submitted_by)
	values ('testnet', tests.addr(10), tests.digest(6), 1, '0x3e6', tests.digest(1), tests.digest(2), 27, 200, '{}', tests.addr(1)) $$,
	'42501', null, 'nor who submitted');
select throws_ok($$ select tests.receipt(2, 10, 999, '{}') $$, '23503', null, 'a receipt needs its proposal');

select lives_ok($$ select tests.receipt(2, 10, 6, '{"status":"err","response":"Invalid multi-sig inner signer"}', 200, 1000) $$,
	'the finaliser records a rejection');
select results_eq($$ select accepted, submitted_by::text from public.receipts where digest = tests.digest(6) $$,
	$$ values (false, tests.addr(2)::text) $$, 'stored as not accepted');
select is(tests.status(10, 6), 'open', 'a rejection leaves the proposal open, so it can be retried');
select throws_ok($$ select tests.receipt(2, 10, 6, '{"status":"ok"}', 200, 1000) $$, '23505', null, 'one row per attempt');
select lives_ok($$ select tests.sign(3, 10, 6) $$, 'and it can still be signed');

select lives_ok($$ select tests.receipt(2, 10, 6, '{"status":"ok","response":{"type":"default"}}', 200, 2000) $$,
	'the finaliser records the accepted attempt');
select results_eq($$ select status, closed_at is not null from public.proposals where digest = tests.digest(6) $$,
	$$ values ('accepted', true) $$, 'the proposal is closed as accepted');
select is(tests.kinds(10, 6), array['proposal_created', 'submission_recorded', 'signature_added', 'submission_recorded'], 'the history has both attempts');
select results_eq($$ select (data ->> 'accepted')::boolean from public.events where digest = tests.digest(6) and kind = 'submission_recorded' order by id $$,
	array[false, true], 'and how each ended');
select throws_ok($$ select tests.receipt(2, 10, 6, '{"status":"ok"}', 200, 3000) $$, 'P0001', 'relay.proposal_closed', 'nothing is recorded after acceptance');
select throws_ok($$ select tests.sign(1, 10, 6) $$, 'P0001', 'relay.proposal_closed', 'an accepted proposal cannot be signed');
select throws_ok($$ select tests.end_it(1, 10, 6, 'withdrawn') $$, 'P0001', 'relay.proposal_closed', 'nor withdrawn');
select tests.claims(3);
select throws_ok($$ delete from public.signatures where digest = tests.digest(6) and signer = tests.addr(3) $$,
	'P0001', 'relay.proposal_closed', 'nor can its signatures be taken back');
select tests.claims(2);
select throws_ok($$ update public.receipts set accepted = true $$, '42501', null, 'a receipt cannot be edited');
select throws_ok($$ delete from public.receipts $$, '42501', null, 'nor deleted');

-- what happened on chain wins over a withdrawal
select lives_ok($$ select tests.end_it(1, 10, 7, 'withdrawn') $$, 'a proposal is withdrawn');
select lives_ok($$ select tests.receipt(2, 10, 7, '{"status":"ok","response":{"type":"default"}}') $$,
	'the finaliser submitted it anyway and says so');
select is(tests.status(10, 7), 'accepted', 'it is shown as accepted');
select is(tests.kinds(10, 7), array['proposal_created', 'proposal_withdrawn', 'submission_recorded'], 'with the whole story in the history');

-- a result recorded late, after the window closed, is still kept
reset role;
update public.proposals set expires_at = now() - interval '1 second' where digest = tests.digest(8);
set local role authenticated;
select lives_ok($$ select tests.receipt(2, 10, 8, '{"status":"ok","response":{"type":"default"}}') $$, 'a result can be recorded after expiry');
select is(tests.status(10, 8), 'accepted', 'and closes the proposal');

-- at most 20 attempts
select tests.receipt(2, 10, 9, '{"status":"err","response":"x"}', 200, n) from generate_series(1, 20) n;
select throws_ok($$ select tests.receipt(2, 10, 9, '{"status":"err","response":"x"}', 200, 21) $$, 'P0001', 'relay.rate_limited', 'a 21st attempt is not stored');

-- shapes
select throws_ok($$ select tests.receipt(2, 10, 10, repeat('x', 8193)) $$, '23514', null, 'a response over 8 KiB is refused');
reset role;

-- a signer-set change accepted through the relay is re-checked first
delete from private.lookup_queue;
select tests.propose(1, 10, 2, 20, null, 'testnet', 'convertToMultiSigUser');
select tests.receipt(2, 10, 20, '{"status":"err","response":"nope"}', 200, 1);
select is_empty('select 1 from private.lookup_queue', 'a rejected signer change triggers nothing');
select tests.receipt(2, 10, 20, '{"status":"ok","response":{"type":"default"}}', 200, 2);
select results_eq($$ select address::text, priority::int, lane from private.lookup_queue $$,
	$$ values (tests.addr(10)::text, 0, 'refresh') $$, 'an accepted one queues a priority-0 re-check of that treasury');
delete from private.lookup_queue;
select tests.receipt(2, 10, 11, '{"status":"ok","response":{"type":"default"}}');
select is_empty('select 1 from private.lookup_queue', 'an ordinary accepted action does not');

-- ------------------------------------------------------- "accepted", the one rule
select ok(private.response_accepted(200, '{"status":"ok","response":{"type":"default"}}'), 'ok is accepted');
select ok(private.response_accepted(200, '{"status":"ok"}'), 'ok without a response is accepted');
select ok(private.response_accepted(200, '{"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":1}}]}}}'), 'ok with clean statuses is accepted');
select ok(not private.response_accepted(200, '{"status":"ok","response":{"type":"order","data":{"statuses":[{"resting":{"oid":1}},{"error":"Tick size"}]}}}'), 'ok with an item error is not');
select ok(not private.response_accepted(200, '{"status":"err","response":"Invalid multi-sig inner signer"}'), 'err is not');
select ok(not private.response_accepted(500, '{"status":"ok"}'), 'a non-200 status is not, whatever the body');
select ok(not private.response_accepted(null, '{"status":"ok"}'), 'no status is not');
select ok(not private.response_accepted(200, '<html>'), 'HTML is not');
select ok(not private.response_accepted(200, '"ok"'), 'a bare string is not');
select ok(not private.response_accepted(200, 'null'), 'null is not');
select ok(not private.response_accepted(200, '[{"status":"ok"}]'), 'an array is not');
select ok(not private.response_accepted(200, '{"status":"OK"}'), 'the status is case-sensitive');
select ok(not private.response_accepted(200, '{"status":true}'), 'a non-string status is not');
select ok(not private.response_accepted(200, null), 'a missing body is not');

select * from finish();
rollback;
