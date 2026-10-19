-- Sharing a proposal: who may, what the row must agree with, the caps.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 5) n;
-- T10: wallets 1, 2, 3. T11: wallet 4. T12 (frozen): wallet 1. T13: wallet 1. Wallet 5 signs for nothing.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);
select tests.seed_treasury('testnet', 12, 1, array[1]);
select tests.seed_treasury('testnet', 13, 1, array[1]);
select tests.seed_treasury('mainnet', 10, 1, array[1]);
update public.treasuries set frozen_at = now() where address = tests.addr(12);

create function tests.try_doc(p_patch jsonb, p_payload_patch jsonb default '{}') returns void
language plpgsql as $$
declare
	nonce bigint := tests.now_ms();
begin
	perform tests.claims(1);
	insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900), tests.doc('testnet', 10, 2, 900, nonce, p_patch, p_payload_patch), tests.addr(2), nonce);
end $$;

set local role authenticated;

-- the plain case
select lives_ok($$ select tests.propose(1, 10, 2, 1) $$, 'a signer shares a proposal');
select results_eq(
	$$ select created_by::text, finaliser::text, status, closed_at is null,
		expires_at = to_timestamp((nonce + 172800000) / 1000.0), created_at = now()
	   from public.proposals where digest = tests.digest(1) $$,
	$$ values (tests.addr(1)::text, tests.addr(2)::text, 'open', true, true, true) $$,
	'it is stamped with its proposer, opens, and expires two days after its nonce');
select results_eq(
	$$ select kind, actor::text, data ->> 'finaliser' from public.events where digest = tests.digest(1) $$,
	$$ values ('proposal_created', tests.addr(1)::text, tests.addr(2)::text) $$,
	'the history records who proposed and who finalises');
select throws_ok($$ select tests.propose(2, 10, 2, 1) $$, '23505', null, 'the same proposal cannot be shared twice');

-- what a client may not set
select tests.claims(1);
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce, created_by)
	values ('testnet', tests.addr(10), tests.digest(2), '{}', tests.addr(2), 1, tests.addr(3)) $$, '42501', null, 'the proposer cannot be named by the client');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce, status)
	values ('testnet', tests.addr(10), tests.digest(2), '{}', tests.addr(2), 1, 'accepted') $$, '42501', null, 'nor the status');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce, expires_at)
	values ('testnet', tests.addr(10), tests.digest(2), '{}', tests.addr(2), 1, now() + interval '1 year') $$, '42501', null, 'nor the expiry');

-- who may not propose
select throws_ok($$ select tests.propose(5, 10, 2, 3) $$, '42501', null, 'a wallet that signs for nothing cannot propose');
select throws_ok($$ select tests.propose(4, 10, 2, 3) $$, '42501', null, 'a signer of another treasury cannot propose here');
select throws_ok($$ select tests.propose(99, 10, 2, 3) $$, '42501', null, 'a session with no wallet cannot propose');
select throws_ok($$ select tests.propose(1, 12, 1, 3) $$, 'P0001', 'relay.treasury_frozen', 'nothing can be proposed for a frozen treasury');
select throws_ok($$ select tests.propose(1, 10, 4, 3) $$, 'P0001', 'relay.finaliser_not_signer', 'the finaliser must be one of the signers');
select throws_ok($$ select tests.propose(1, 10, 5, 3) $$, 'P0001', 'relay.finaliser_not_signer', 'a stranger cannot be named finaliser');

-- the row must agree with its document
select lives_ok($$ select tests.try_doc('{}') $$, 'the reference document is accepted');
reset role;
delete from public.proposals where digest = tests.digest(900);
set local role authenticated;
select throws_ok($$ select tests.try_doc(jsonb_build_object('digest', tests.digest(901))) $$, 'P0001', 'relay.document_mismatch', 'a document claiming another digest');
select throws_ok($$ select tests.try_doc('{}', '{"network":"mainnet"}') $$, 'P0001', 'relay.document_mismatch', 'a document for the other network');
select throws_ok($$ select tests.try_doc('{}', jsonb_build_object('multiSigUser', tests.addr(11))) $$, 'P0001', 'relay.document_mismatch', 'a document for another treasury');
select throws_ok($$ select tests.try_doc('{}', jsonb_build_object('outerSigner', tests.addr(3))) $$, 'P0001', 'relay.document_mismatch', 'a document naming another finaliser');
select throws_ok($$ select tests.try_doc('{}', '{"nonce":1}') $$, 'P0001', 'relay.document_mismatch', 'a document with another nonce');
select throws_ok($$ select tests.try_doc('{}', '{"nonce":"1791496830653"}') $$, 'P0001', 'relay.document_mismatch', 'a nonce that is a string');
select throws_ok($$ select tests.try_doc('{"signatures":[{"signer":"0x00"}]}') $$, 'P0001', 'relay.document_mismatch', 'a document carrying signatures');
select throws_ok($$ select tests.try_doc('{"receipt":{"httpStatus":200}}') $$, 'P0001', 'relay.document_mismatch', 'a document carrying a receipt');
select throws_ok($$ select tests.try_doc('{"extra":1}') $$, 'P0001', 'relay.document_mismatch', 'an extra top-level field');
select throws_ok($$ select tests.try_doc('{"v":2}') $$, 'P0001', 'relay.document_mismatch', 'another document version');
select throws_ok($$ select tests.try_doc('{"meta":{"kind":"l1"}}') $$, 'P0001', 'relay.document_mismatch', 'an L1 action');
select throws_ok($$ select tests.try_doc('{"meta":null}') $$, 'P0001', 'relay.document_mismatch', 'no meta');
select throws_ok($$ select tests.try_doc('{}', jsonb_build_object('vaultAddress', tests.addr(1))) $$, 'P0001', 'relay.document_mismatch', 'a vault address');
select throws_ok($$ select tests.try_doc('{}', '{"expiresAfter":1791496830653}') $$, 'P0001', 'relay.document_mismatch', 'an expiry');
select throws_ok($$ select tests.try_doc('{}', '{"action":{"type":"multiSig"}}') $$, 'P0001', 'relay.document_mismatch', 'an envelope as the inner action');
select throws_ok($$ select tests.try_doc('{}', '{"action":{"amount":"1"}}') $$, 'P0001', 'relay.document_mismatch', 'an action with no type');
select throws_ok($$ select tests.try_doc('{}', '{"action":"usdSend"}') $$, 'P0001', 'relay.document_mismatch', 'an action that is not an object');
select throws_ok($$ select tests.try_doc('{"payload":{}}') $$, 'P0001', 'relay.document_mismatch', 'an empty payload (every field missing)');
select throws_ok($$ select tests.try_doc('{"payload":null}') $$, 'P0001', 'relay.document_mismatch', 'no payload');

select tests.claims(1);
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900), 'not json', tests.addr(2), tests.now_ms()) $$, 'P0001', 'relay.document_mismatch', 'text that is not JSON');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900), '[]', tests.addr(2), tests.now_ms()) $$, 'P0001', 'relay.document_mismatch', 'a JSON array');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900),
		(tests.doc('testnet', 10, 2, 900, 5)::jsonb - 'meta')::text, tests.addr(2), 5) $$, 'P0001', 'relay.document_mismatch', 'a missing top-level field');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900),
		(jsonb_set(tests.doc('testnet', 10, 2, 900, 5)::jsonb, '{payload}', tests.doc('testnet', 10, 2, 900, 5)::jsonb -> 'payload' || '{}') #- '{payload,nonce}')::text,
		tests.addr(2), 5) $$, 'P0001', 'relay.document_mismatch', 'a payload with no nonce');
select throws_ok($$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(900),
		tests.doc('testnet', 10, 2, 900, tests.now_ms(), jsonb_build_object('meta', jsonb_build_object('kind', 'user-signed', 'note', repeat('x', 33000)))),
		tests.addr(2), tests.now_ms()) $$, '23514', null, 'a document over 32 KiB');
select is_empty($$ select 1 from public.proposals where digest = tests.digest(900) $$, 'none of those was stored');

-- the signing window
select throws_ok($$ select tests.propose(1, 10, 2, 4, tests.now_ms() - 172800000 - 1000) $$, 'P0001', 'relay.proposal_expired', 'a proposal whose window has closed cannot be shared');
select lives_ok($$ select tests.propose(1, 10, 2, 4, tests.now_ms() - 86400000) $$, 'one made a day ago still can');
select lives_ok($$ select tests.propose(1, 10, 2, 5, tests.now_ms() + 23 * 3600000) $$, 'one given the long window (nonce 23 hours ahead) can');
select throws_ok($$ select tests.propose(1, 10, 2, 6, tests.now_ms() + 86400000 + 600000) $$, 'P0001', 'relay.nonce_too_far', 'a nonce more than a day ahead cannot');

-- a digest is filed per treasury: one treasury's signer cannot block another's
select lives_ok($$ select tests.propose(4, 11, 4, 7) $$, 'wallet 4 files digest 7 under its own treasury');
select lives_ok($$ select tests.propose(1, 10, 2, 7) $$, 'and that does not stop digest 7 under treasury 10');
select lives_ok($$ select tests.propose(1, 10, 1, 8, null, 'mainnet') $$, 'the same address on the other network is another treasury');

-- reading
select tests.claims(2);
select is((select count(*)::int from public.proposals where treasury = tests.addr(10) and network = 'testnet'), 4, 'a co-signer reads the treasury''s proposals');
select is_empty($$ select 1 from public.proposals where treasury = tests.addr(11) $$, 'but not another treasury''s');
select is_empty($$ select 1 from public.proposals where network = 'mainnet' $$, 'nor the same address on the other network');
select tests.claims(5);
select is_empty('select 1 from public.proposals', 'a stranger reads none');
select is_empty('select 1 from public.events', 'and no history');

-- nothing is editable
select tests.claims(1);
select throws_ok($$ update public.proposals set status = 'accepted' $$, '42501', null, 'a proposal cannot be updated through the API');
select throws_ok($$ delete from public.proposals $$, '42501', null, 'nor deleted');
reset role;

set local role anon;
select throws_ok('select 1 from public.proposals', '42501', null, 'anon cannot read proposals');
select throws_ok($$ select tests.propose(1, 10, 2, 9) $$, '42501', null, 'anon cannot propose');
reset role;

-- caps: 20 pending per wallet per treasury, 50 per treasury, 30 an hour per wallet
delete from public.proposals;
set local role authenticated;
select tests.propose(1, 10, 2, 100 + n) from generate_series(1, 20) n;
select throws_ok($$ select tests.propose(1, 10, 2, 121) $$, 'P0001', 'relay.pending_cap', 'a 21st pending proposal by one wallet for one treasury is refused');
reset role;
update public.proposals set status = 'withdrawn', closed_at = now() where digest = tests.digest(101);
update public.proposals set expires_at = now() - interval '1 minute' where digest = tests.digest(102);
set local role authenticated;
select lives_ok($$ select tests.propose(1, 10, 2, 121) $$, 'a withdrawn one frees a place');
select lives_ok($$ select tests.propose(1, 10, 2, 122) $$, 'and so does an expired one');
select tests.propose(2, 10, 2, 200 + n) from generate_series(1, 20) n;
select tests.propose(3, 10, 2, 300 + n) from generate_series(1, 10) n;
select throws_ok($$ select tests.propose(3, 10, 2, 311) $$, 'P0001', 'relay.pending_cap', 'a 51st pending proposal for one treasury is refused');
-- wallet 1 has shared 22 in the last hour; 8 more elsewhere make 30
select tests.propose(1, 13, 1, 400 + n) from generate_series(1, 8) n;
select throws_ok($$ select tests.propose(1, 13, 1, 409) $$, 'P0001', 'relay.rate_limited', 'a 31st proposal within an hour is refused');
reset role;
update public.proposals set created_at = now() - interval '61 minutes' where digest = tests.digest(401);
set local role authenticated;
select lives_ok($$ select tests.propose(1, 13, 1, 409) $$, 'once one is over an hour old, another is allowed');
reset role;

select ok(not has_table_privilege('authenticated', 'public.proposals', 'update,delete,truncate'), 'authenticated holds no UPDATE or DELETE on proposals');
select ok(not has_any_column_privilege('authenticated', 'public.proposals', 'update'), 'not even on a single column');
select ok((select relrowsecurity from pg_class where oid = 'public.proposals'::regclass), 'RLS is on for proposals');

select * from finish();
rollback;
