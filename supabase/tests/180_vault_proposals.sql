-- Vault deposits and withdrawals (relay_vault_proposals). A `vaultTransfer`
-- is the one L1 action the relay stores: in its exact shape, filed as kind
-- "l1", and as nothing else. Such an action carries no number of its own, so
-- a report that it "was carried out without the tool" is not accepted and the
-- worker would not act on one. Signatures, a no, a withdrawal and the
-- finaliser's own result work as for any proposal.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 4) n;
-- T10: wallets 1, 2, 3 (2 of 3). Wallet 4 signs for nothing.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);

-- A vault action as the browser writes it; `p_patch` is merged over it and
-- `p_drop` names a field to leave out.
create function tests.vault_action(p_patch jsonb default '{}', p_drop text default null) returns jsonb
language sql immutable as $$
	select (jsonb_build_object(
		'type', 'vaultTransfer',
		'vaultAddress', '0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0',
		'isDeposit', true,
		'usd', 5000000) || p_patch) - coalesce(p_drop, '')
$$;

-- Wallet n shares document d for T10 with this action and kind.
create function tests.propose_doc(
	n int, d int, p_action jsonb, p_kind text,
	p_payload_patch jsonb default '{}', p_nonce bigint default null
) returns void
language plpgsql as $$
declare
	nonce bigint := coalesce(p_nonce, tests.now_ms());
begin
	perform tests.claims(n);
	insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values ('testnet', tests.addr(10), tests.digest(d),
		tests.doc('testnet', 10, 2, d, nonce,
			jsonb_build_object('meta', jsonb_build_object('kind', p_kind, 'title', 'Vault ' || d, 'note', null)),
			jsonb_build_object('action', p_action) || p_payload_patch),
		tests.addr(2), nonce);
end $$;

set local role authenticated;

-- ------------------------------------------------------------ what is taken
select lives_ok($$ select tests.propose_doc(1, 1, tests.vault_action(), 'l1') $$,
	'a vault deposit is shared: the one L1 action the relay stores');
select lives_ok($$ select tests.propose_doc(1, 2, tests.vault_action('{"isDeposit": false, "usd": 1}'), 'l1') $$,
	'and a withdrawal, of a millionth of a dollar');
select is((select count(*)::int from public.proposals where treasury = tests.addr(10) and status = 'open'), 2,
	'both are stored');
select is((select document::jsonb #>> '{meta,kind}' from public.proposals where digest = tests.digest(1)), 'l1',
	'filed as the kind they are');
select results_eq(
	$$ select kind from public.events where treasury = tests.addr(10) and digest = tests.digest(1) order by id $$,
	$$ values ('proposal_created') $$, 'with the same history entry as any proposal');

-- a user-signed action is taken as before
select lives_ok($$ select tests.propose(1, 10, 2, 3) $$, 'a user-signed proposal is shared as before');

-- ---------------------------------------------------------- what is refused
select throws_ok($$ select tests.propose_doc(1, 10, tests.vault_action(), 'user-signed') $$,
	'P0001', 'relay.document_mismatch', 'a vault action that claims to be user-signed');
select throws_ok($$ select tests.propose_doc(1, 11, tests.action_of(10, 3), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a user-signed action that claims to be an L1 action');
select throws_ok($$ select tests.propose_doc(1, 12, '{"type": "order", "orders": [], "grouping": "na"}', 'l1') $$,
	'P0001', 'relay.document_mismatch', 'another L1 action: an order');
select throws_ok($$ select tests.propose_doc(1, 13, '{"type": "noop"}', 'l1') $$,
	'P0001', 'relay.document_mismatch', 'another L1 action: noop');
select throws_ok($$ select tests.propose_doc(1, 14, '{"type": "subAccountTransfer", "subAccountUser": "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0", "isDeposit": true, "usd": 5000000}', 'l1') $$,
	'P0001', 'relay.document_mismatch', 'another L1 action: a sub-account transfer');
select throws_ok($$ select tests.propose_doc(1, 15, tests.vault_action(), 'something') $$,
	'P0001', 'relay.document_mismatch', 'a kind that is neither');

-- beside the action: acting for a vault or sub-account, an expiry
select throws_ok($$ select tests.propose_doc(1, 20, tests.vault_action(), 'l1',
		'{"vaultAddress": "0xa15099a30bbf2e68942d6f4c43d70d04faeab0a0"}') $$,
	'P0001', 'relay.document_mismatch', 'a vault action sent on behalf of a vault or sub-account');
select throws_ok($$ select tests.propose_doc(1, 21, tests.vault_action(), 'l1', '{"expiresAfter": 1791900000000}') $$,
	'P0001', 'relay.document_mismatch', 'a vault action with an expiry');

-- the exact shape
select throws_ok($$ select tests.propose_doc(1, 30, tests.vault_action('{"note": "x"}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a field more than the action has');
select throws_ok($$ select tests.propose_doc(1, 31, tests.vault_action('{}', 'isDeposit'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a field less: no direction');
select throws_ok($$ select tests.propose_doc(1, 32, tests.vault_action('{}', 'usd'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a field less: no amount');
select throws_ok($$ select tests.propose_doc(1, 33, tests.vault_action('{"usd": "5000000"}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'an amount written as text');
select throws_ok($$ select tests.propose_doc(1, 34, tests.vault_action('{"usd": 0}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'an amount of nothing');
select throws_ok($$ select tests.propose_doc(1, 35, tests.vault_action('{"usd": -5}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a negative amount');
select throws_ok($$ select tests.propose_doc(1, 36, tests.vault_action('{"usd": 5.5}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'an amount that is not a whole number');
select throws_ok($$ select tests.propose_doc(1, 37, tests.vault_action('{"isDeposit": "true"}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a direction written as text');
select throws_ok($$ select tests.propose_doc(1, 38, tests.vault_action('{"vaultAddress": "0xA15099a30bbf2e68942d6f4c43d70d04faeab0a0"}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a vault address with a capital in it');
select throws_ok($$ select tests.propose_doc(1, 39, tests.vault_action('{"vaultAddress": "0x1234"}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'a vault address that is no address');
select throws_ok($$ select tests.propose_doc(1, 40, tests.vault_action('{"vaultAddress": null}'), 'l1') $$,
	'P0001', 'relay.document_mismatch', 'no vault at all');
select is((select count(*)::int from public.proposals where treasury = tests.addr(10)), 3,
	'none of the refused ones was stored');

-- who may: the same rules as for any proposal
select throws_ok($$ select tests.propose_doc(4, 50, tests.vault_action(), 'l1') $$,
	'42501', null, 'a wallet that signs for nothing cannot share one');

-- ------------------------------------------- signing, saying no, the result
select lives_ok($$ select tests.sign(1, 10, 1) $$, 'a signer signs a vault proposal');
select lives_ok($$ select tests.sign(3, 10, 1) $$, 'and a second one');
select is(tests.signed(10, 1), array[tests.addr(1)::text, tests.addr(3)::text], 'both signatures are stored');
select lives_ok($$ select tests.say_no(2, 10, 2) $$, 'a signer says no to the withdrawal');
select is(tests.status(10, 2), 'open', 'which ends nothing');
select lives_ok($$ select tests.end_it(1, 10, 2, 'withdrawn') $$, 'its proposer withdraws it');
select is(tests.status(10, 2), 'withdrawn', 'and it is closed');

-- ----------------------------------- "carried out without the tool" is not taken
select throws_ok($$ select tests.report(1, 10, 1, 1) $$, 'P0001', 'relay.report_unnumbered',
	'a report about a vault proposal is refused: its action carries no number of its own');
select throws_ok($$ select tests.report(3, 10, 2, 2) $$, 'P0001', 'relay.report_unnumbered',
	'also for one that was withdrawn');
reset role;
select is((select count(*)::int from public.execution_reports), 0, 'no report was stored');
select is((select count(*)::int from private.lookup_queue), 0, 'and nothing was queued for the explorer');
set local role authenticated;
-- ten refused reports later, a real one is still taken: a refusal does not count against the limit
select throws_ok(format($$ select tests.report(1, 10, 1, %s) $$, 100 + n), 'P0001', 'relay.report_unnumbered',
	'refused again (' || n || ')') from generate_series(1, 10) n;
select lives_ok($$ select tests.report(1, 10, 3, 7) $$,
	'a report about the user-signed proposal is taken as before, after ten refused ones');
reset role;

-- The worker's own rule, whatever row it is handed: a report that names a
-- vault proposal (written here past the trigger, as no client can) is
-- rejected without a transaction ever being compared.
alter table public.execution_reports disable trigger execution_report_before;
insert into public.execution_reports (network, treasury, digest, tx_hash, reported_by)
values ('testnet', tests.addr(10), tests.digest(1), tests.tx_hash(9), tests.addr(1));
alter table public.execution_reports enable trigger execution_report_before;
select is(
	private.apply_report(
		(select id from public.execution_reports where digest = tests.digest(1)),
		'tx', tests.addr(10)::text, tests.action_of(10, 1), null, tests.now_ms(), tests.tx_hash(9)::text),
	'report_rejected', 'the worker rejects it, though account, action and hash all match');
select is((select reason from public.execution_reports where digest = tests.digest(1)), 'unnumbered',
	'with the reason that the action carries no number');
select is(tests.status(10, 1), 'open', 'the vault proposal stays open');
-- the user-signed one is confirmed by the same call
select is(
	private.apply_report(
		(select id from public.execution_reports where digest = tests.digest(3)),
		'tx', tests.addr(10)::text, tests.action_of(10, 3), null, tests.now_ms(), tests.tx_hash(7)::text),
	'report_confirmed', 'a user-signed proposal is still closed by its transaction');
select is(tests.status(10, 3), 'carried_out', 'and reads carried out');

-- the finaliser's own result closes a vault proposal, as it closes any
set local role authenticated;
select lives_ok($$ select tests.receipt(2, 10, 1, '{"status":"ok","response":{"type":"default"}}') $$,
	'the finaliser records Hyperliquid''s answer');
reset role;
select is(tests.status(10, 1), 'accepted', 'and the vault proposal is closed as accepted');

-- -------------------------------------- a deposit in two steps is taken whole
-- A manual treasury's deposit is two proposals in one statement: USDC to
-- perps (user-signed), then the deposit (L1). Both land, or neither.
create function tests.propose_vault_pair(n int, d1 int, d2 int, p_deposit jsonb) returns void
language plpgsql as $$
declare
	nonce bigint := tests.now_ms();
	steps jsonb := jsonb_build_array(tests.digest(d1), tests.digest(d2));
begin
	perform tests.claims(n);
	insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	values
		('testnet', tests.addr(10), tests.digest(d1),
			tests.doc('testnet', 10, 2, d1, nonce,
				jsonb_build_object('meta', jsonb_build_object('kind', 'user-signed', 'title', null, 'note', null, 'steps', steps)),
				'{}', 'usdClassTransfer'),
			tests.addr(2), nonce),
		('testnet', tests.addr(10), tests.digest(d2),
			tests.doc('testnet', 10, 2, d2, nonce + 1,
				jsonb_build_object('meta', jsonb_build_object('kind', 'l1', 'title', null, 'note', null, 'steps', steps)),
				jsonb_build_object('action', p_deposit)),
			tests.addr(2), nonce + 1);
end $$;
set local role authenticated;
select lives_ok($$ select tests.propose_vault_pair(1, 60, 61, tests.vault_action()) $$,
	'a readable step and a vault deposit are shared in one statement');
select is((select count(*)::int from public.proposals where digest in (tests.digest(60), tests.digest(61))), 2,
	'and both are stored');
select throws_ok($$ select tests.propose_vault_pair(1, 62, 63, tests.vault_action('{"usd": 0}')) $$,
	'P0001', 'relay.document_mismatch', 'with a second step the relay refuses, the pair is refused');
select is((select count(*)::int from public.proposals where digest in (tests.digest(62), tests.digest(63))), 0,
	'and its first step was not stored either');
reset role;

-- ------------------------------------------------- "a number of its own"
create function tests.numbered(p_action jsonb, p_nonce bigint) returns boolean
language sql as $$
	select private.has_own_number(row('testnet', tests.addr(10), tests.digest(1),
		jsonb_build_object('payload', jsonb_build_object('action', p_action))::text,
		tests.addr(1), tests.addr(2), p_nonce, now(), 'open', null, now())::public.proposals)
$$;
select ok(tests.numbered('{"type": "sendAsset", "nonce": 1791900000000}', 1791900000000), 'an action with the proposal''s number as its nonce');
select ok(tests.numbered('{"type": "usdSend", "time": 1791900000000}', 1791900000000), 'or as its time');
select ok(not tests.numbered('{"type": "vaultTransfer", "usd": 5}', 1791900000000), 'a vault action has none');
select ok(not tests.numbered('{"type": "sendAsset", "nonce": 1791900000001}', 1791900000000), 'another number is not its number');
select ok(not tests.numbered('{"type": "sendAsset", "nonce": "1791900000000"}', 1791900000000), 'nor is one written as text');
select ok(not tests.numbered('{"type": "sendAsset", "nonce": "soon", "time": null}', 1791900000000), 'and text that is no number raises nothing');

-- ------------------------------------------------------------- the shape rule
select ok(private.is_vault_action(tests.vault_action()), 'the shape rule takes the action as the browser writes it');
select ok(not private.is_vault_action('"vaultTransfer"'), 'not a bare word');
select ok(not private.is_vault_action(null), 'not nothing');
select ok(not private.is_vault_action(tests.vault_action('{"usd": 12345678901234567}')), 'not an amount too large to carry exactly');

select * from finish();
rollback;
