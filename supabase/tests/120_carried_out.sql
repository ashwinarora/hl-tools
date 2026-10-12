-- A proposal carried out without the tool: who may report it, what the worker
-- checks before believing it, and what happens when the finaliser's own
-- result arrives late. The explorer is replaced by scripted answers; the real
-- call is covered by the integration suite.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();
-- inside one transaction every call falls in the same minute: the cap has a section of its own below
update private.settings set value = '1000' where key = 'worker.per_minute';

create table tests.tx_answers (
	id serial primary key, hash public.hash32, outcome text,
	tx_user text, tx_action jsonb, tx_error text, tx_time bigint, tx_hash text, http_status int);
create table tests.tx_calls (id serial primary key, network public.network, hash public.hash32);

create or replace function private.fetch_tx(p_network public.network, p_hash public.hash32)
returns table (outcome text, tx_user text, tx_action jsonb, tx_error text, tx_time bigint, tx_hash text, http_status int)
language plpgsql security definer set search_path = ''
as $$
declare
	a tests.tx_answers;
begin
	insert into tests.tx_calls (network, hash) values (p_network, p_hash);
	select * into a from tests.tx_answers t where t.hash = p_hash order by t.id limit 1;
	if not found then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, null::int;
		return;
	end if;
	delete from tests.tx_answers t where t.id = a.id;
	return query select a.outcome, a.tx_user, a.tx_action, a.tx_error, a.tx_time, a.tx_hash, a.http_status;
end $$;

-- The explorer's answer for hash h: by default exactly proposal d of treasury
-- n_treasury, accepted by the chain.
create function tests.tx_is(
	h int, n_treasury int, d int,
	p_user public.address default null, p_action jsonb default null, p_error text default null, p_hash int default null
) returns void
language sql as $$
	insert into tests.tx_answers (hash, outcome, tx_user, tx_action, tx_error, tx_time, tx_hash, http_status)
	values (tests.tx_hash(h), 'tx', coalesce(p_user, tests.addr(n_treasury)),
		coalesce(p_action, tests.action_of(n_treasury, d)), p_error, 1791400180792,
		tests.tx_hash(coalesce(p_hash, h)), 200)
$$;
create function tests.tx_says(h int, p_outcome text) returns void
language sql as $$
	insert into tests.tx_answers (hash, outcome, http_status)
	values (tests.tx_hash(h), p_outcome, case p_outcome when 'rate_limited' then 429 when 'unknown' then 200 else 500 end)
$$;
-- A report is looked at 30 seconds after it was filed; this is those 30 seconds.
create function tests.due() returns void
language sql as $$ update public.execution_reports set not_before = now() - interval '1 second' where status = 'pending' $$;
create function tests.report_of(d int) returns text
language sql as $$
	-- in the order the tests file them: each uses a larger transaction number than the last
	select coalesce(string_agg(status || coalesce(':' || reason, ''), ',' order by tx_hash, finished_at is null, reason desc), 'none')
	from public.execution_reports where digest = tests.digest(d)
$$;
create function tests.pinged() returns text[]
language sql as $$
	select coalesce(array_agg(distinct replace(topic, 'wallet:', '') order by replace(topic, 'wallet:', '')), '{}')
	from realtime.messages
	where topic like 'wallet:0x7e57%' and inserted_at >= now()
$$;
create function tests.forget_pings() returns void
language sql as $$ delete from realtime.messages where topic like 'wallet:0x7e57%' $$;

select tests.make_wallet(n) from generate_series(1, 5) n;
-- T10: wallets 1, 2, 3. T11: wallet 4. Wallet 5: nothing.
-- (Every proposal below gets a number of its own: inside one transaction
-- now() stands still, and two proposals with the same action and number are
-- twins, which is a case of its own further down.)
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);

-- ----------------------------------------------------------- reading an answer
select results_eq(
	$$ select outcome, tx_user, tx_action ->> 'type', tx_error, tx_time, tx_hash, http_status from private.parse_tx(200,
		'{"type":"txDetails","tx":{"time":1791400180792,"user":"0xF8365a35694f401a554e4ffa51b5afe3b203d148","action":{"type":"usdSend","amount":"110"},"block":723825086,"hash":"0x722D2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":null}}') $$,
	$$ values ('tx', '0xf8365a35694f401a554e4ffa51b5afe3b203d148', 'usdSend', null::text, 1791400180792::bigint,
		'0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049', 200) $$,
	'a transaction is read with its account and hash lowercased');
select is((select tx_error from private.parse_tx(200,
	'{"type":"txDetails","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{"type":"usdSend"},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":"Insufficient balance for withdrawal."}}')),
	'Insufficient balance for withdrawal.', 'a rejected attempt keeps the chain''s error');
select is((select outcome from private.parse_tx(200, '{"type":"error","message":"invalid block height: 0"}')), 'unknown',
	'"no such transaction" is an answer of its own');
select is((select outcome || ':' || http_status from private.parse_tx(429, 'slow down')), 'rate_limited:429', 'HTTP 429 is "slow down"');
select is((select outcome || ':' || http_status from private.parse_tx(422, 'Failed to deserialize the JSON body')), 'error:422', 'any other status is an error');
select is((select outcome from private.parse_tx(null, null)), 'error', 'no answer at all is an error');
select is(
	(select array_agg(p.outcome order by t.n) from (values
		(1, '<html>'),
		(2, 'null'),
		(3, '[]'),
		(4, '{"type":"txDetails"}'),
		(5, '{"type":"txDetails","tx":5}'),
		-- no `error` field: it must say null or why, never be absent
		(6, '{"type":"txDetails","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{"type":"usdSend"},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049"}}'),
		(7, '{"type":"txDetails","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":"usdSend","hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":null}}'),
		(8, '{"type":"txDetails","tx":{"time":1,"user":"nobody","action":{},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":null}}'),
		(9, '{"type":"txDetails","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{},"hash":"0x12","error":null}}'),
		(10, '{"type":"txDetails","tx":{"time":"soon","user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":null}}'),
		(11, '{"type":"txDetails","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":5}}'),
		(12, '{"type":"somethingElse","tx":{"time":1,"user":"0xf8365a35694f401a554e4ffa51b5afe3b203d148","action":{},"hash":"0x722d2b195f94365e73a6042b24b1be01030042fefa97553015f5d66c1e981049","error":null}}')
	) t(n, body), lateral private.parse_tx(200, t.body) p),
	array_fill('error'::text, array[12]),
	'anything that is not exactly a transaction is an error: never a pass, never "unknown"');

-- ------------------------------------------------------------------- reporting
select tests.propose(1, 10, 2, 1, tests.now_ms() + 1);
select tests.sign(1, 10, 1);
select tests.forget_pings();

set local role authenticated;
select lives_ok($$ select tests.report(3, 10, 1, 1) $$, 'a signer reports a transaction for a proposal of its treasury');
select results_eq(
	$$ select reported_by::text, status, reason, attempts, not_before > now() + interval '29 seconds', not_before <= now() + interval '30 seconds'
	   from public.execution_reports $$,
	$$ values (tests.addr(3)::text, 'pending', null::text, 0, true, true) $$,
	'it is filed under the reporter, pending, to be looked at in 30 seconds');
select is(tests.pinged(), '{}', 'filing a report tells nobody anything');

select tests.claims(1);
select is((select count(*)::int from public.execution_reports), 0, 'a co-signer does not read another signer''s report');
select throws_ok($$ select tests.report(1, 10, 1, 2) $$, '23505', null, 'one question at a time per proposal');
select throws_ok($$ select tests.report(5, 10, 1, 3) $$, '42501', null, 'a stranger cannot report');
select throws_ok($$ select tests.report(4, 10, 1, 3) $$, '42501', null, 'nor another treasury''s signer');
select throws_ok($$ select tests.report(99, 10, 1, 3) $$, '42501', null, 'nor a session with no wallet');
select throws_ok($$ select tests.report(1, 10, 77, 3) $$, '23503', null, 'a proposal the relay does not have cannot be reported');
select tests.claims(1);
select throws_ok($$ insert into public.execution_reports (network, treasury, digest, tx_hash, status)
	values ('testnet', tests.addr(10), tests.digest(1), tests.tx_hash(4), 'confirmed') $$, '42501', null,
	'nobody states the answer: only the four asked-for columns can be written');
select throws_ok($$ insert into public.execution_reports (network, treasury, digest, tx_hash, reported_by)
	values ('testnet', tests.addr(10), tests.digest(1), tests.tx_hash(4), tests.addr(2)) $$, '42501', null,
	'nor who is asking');
select throws_ok($$ update public.execution_reports set status = 'confirmed' $$, '42501', null, 'nor edits a report');
select throws_ok($$ delete from public.execution_reports $$, '42501', null, 'nor removes one');
reset role;
set local role anon;
select throws_ok($$ select 1 from public.execution_reports $$, '42501', null, 'anon cannot read reports');
select throws_ok($$ select tests.report(1, 10, 1, 5) $$, '42501', null, 'nor file one, whatever claims it carries');
reset role;

-- ---------------------------------------------------------------- the worker
select is(private.lookup_step(), 'idle', 'a report is not looked at before its 30 seconds are up');
select is((select count(*)::int from tests.tx_calls), 0, 'so nobody was asked');
select tests.due();
select tests.tx_is(1, 10, 1);
select is(private.lookup_step(), 'report_confirmed', 'the transaction is the proposal''s action, for its treasury, accepted: confirmed');
select results_eq($$ select network::text, hash::text from tests.tx_calls $$,
	$$ values ('testnet', tests.tx_hash(1)::text) $$, 'the explorer was asked for exactly that transaction');
select is(tests.status(10, 1), 'carried_out', 'the proposal is closed as carried out');
select isnt((select closed_at from public.proposals where digest = tests.digest(1)), null, 'with the time');
select is(tests.report_of(1), 'confirmed', 'the report is answered');
select results_eq(
	$$ select kind, actor, data from public.events where digest = tests.digest(1) order by id desc limit 1 $$,
	$$ values ('proposal_carried_out', null::public.address,
		jsonb_build_object('tx_hash', tests.tx_hash(1), 'tx_time', 1791400180792, 'reported_by', tests.addr(3))) $$,
	'the history names the transaction and who noticed; nobody is named as having sent it');
select is(tests.pinged(), tests.addrs(1, 2, 3)::text[], 'every signer of the treasury is told');
select results_eq($$ select kind, units, outcome from private.lookup_log order by id desc limit 1 $$,
	$$ values ('tx', 2, 'tx') $$, 'the call is logged as an explorer call, counting double');
select is((select last_kind from private.worker_state), 'tx', 'and the worker remembers what it did last');

set local role authenticated;
select throws_ok($$ select tests.sign(2, 10, 1) $$, 'P0001', 'relay.proposal_closed', 'nothing more can be signed for it');
select throws_ok($$ select tests.end_it(1, 10, 1, 'withdrawn') $$, 'P0001', 'relay.proposal_closed', 'nor can it be withdrawn');
select throws_ok($$ select tests.report(2, 10, 1, 9) $$, 'P0001', 'relay.proposal_closed', 'nor reported again');
reset role;
select is((select m from (select private.require_open('testnet', tests.addr(10), tests.digest(2)) as m) x), null,
	'(a proposal that does not exist is nobody''s to refuse)');
select throws_like($$ select private.require_open('testnet', tests.addr(10), tests.digest(1)) $$, '%relay.proposal_closed%',
	'the refusal is the usual one');
do $$
declare d text;
begin
	begin
		perform private.require_open('testnet', tests.addr(10), tests.digest(1));
	exception when others then
		get stacked diagnostics d = pg_exception_detail;
	end;
	perform set_config('tests.detail', d, true);
end $$;
select is(current_setting('tests.detail'), 'This proposal was carried out without being reported here.', 'and says so in words');

-- ------------------------------------------------- what the worker will not believe
select tests.propose(1, 10, 2, 2, tests.now_ms() + 2);
select tests.report(1, 10, 2, 20);
select tests.due();
select tests.tx_is(20, 10, 2, p_user => tests.addr(11));
select is(private.lookup_step(), 'report_rejected', 'another account''s transaction');
select is(tests.report_of(2), 'rejected:other_account', 'is refused as such');
select is(tests.status(10, 2), 'open', 'and the proposal is untouched');
select is(tests.pinged() @> array[tests.addr(1)::text], true, 'the reporter hears the answer');

select tests.report(2, 10, 2, 21);
select tests.due();
select tests.tx_is(21, 10, 2, p_error => 'Insufficient balance for withdrawal.');
select is(private.lookup_step(), 'report_rejected', 'a rejected attempt');
select is(tests.report_of(2), 'rejected:other_account,rejected:tx_failed', 'did not carry anything out');

select tests.report(2, 10, 2, 22);
select tests.due();
select tests.tx_is(22, 10, 2, p_action => tests.action_of(10, 2) || '{"amount":"2"}');
select is(private.lookup_step(), 'report_rejected', 'a real transaction of another action');
select tests.report(2, 10, 2, 23);
select tests.due();
select tests.tx_is(23, 10, 2, p_action => tests.action_of(10, 2) || jsonb_build_object('time', tests.now_ms() + 5));
select is(private.lookup_step(), 'report_rejected', 'the same send with another number');
select tests.report(2, 10, 2, 24);
select tests.due();
select tests.tx_is(24, 10, 2, p_action => tests.action_of(10, 2) || '{"extra":true}');
select is(private.lookup_step(), 'report_rejected', 'the same action with a field more');
select tests.report(2, 10, 2, 25);
select tests.due();
select tests.tx_is(25, 10, 2, p_hash => 26);
select is(private.lookup_step(), 'report_rejected', 'an answer about another transaction than the one asked for');
select is(tests.report_of(2),
	'rejected:other_account,rejected:tx_failed,rejected:other_action,rejected:other_action,rejected:other_action,rejected:other_account',
	'each refused, each final');
select is(tests.status(10, 2), 'open', 'and the proposal is still open');
set local role authenticated;
select throws_ok($$ select tests.report(3, 10, 2, 22) $$, '23505', null, 'a claim that was refused is not looked at again, whoever makes it');
reset role;

-- key order does not matter to the comparison; values do
select tests.report(3, 10, 2, 27);
select tests.due();
select tests.tx_is(27, 10, 2, p_action => (
	select jsonb_object_agg(key, value order by key desc) from jsonb_each(tests.action_of(10, 2))));
select is(private.lookup_step(), 'report_confirmed', 'the same action is the same action however its keys are ordered');
select is(tests.status(10, 2), 'carried_out', 'closed');

-- ------------------------------------------------------- not known yet, no answer
select tests.propose(1, 10, 2, 3, tests.now_ms() + 3);
select tests.report(1, 10, 3, 30);
select tests.due();
select tests.tx_says(30, 'unknown') from generate_series(1, 5);
select is(private.lookup_step(), 'report_retry', 'a transaction the explorer does not know yet is asked for again');
select results_eq($$ select attempts, status, not_before > now() + interval '14 seconds' from public.execution_reports where digest = tests.digest(3) $$,
	$$ values (1, 'pending', true) $$, 'later, and the attempt is counted');
select is(private.lookup_step(), 'idle', 'not at once');
select tests.due();
select private.lookup_step();
select results_eq($$ select attempts, not_before > now() + interval '29 seconds' from public.execution_reports where digest = tests.digest(3) $$,
	$$ values (2, true) $$, 'each time waiting twice as long');
select tests.due();
select private.lookup_step();
select tests.due();
select private.lookup_step();
select tests.due();
select is(private.lookup_step(), 'report_failed', 'after five times it gives up');
select is(tests.report_of(3), 'failed:not_found', 'and says the transaction was not found');
select is(tests.status(10, 3), 'open', 'the proposal stays as it was');
set local role authenticated;
select lives_ok($$ select tests.report(2, 10, 3, 30) $$, 'a look-up that failed may be asked for again');
reset role;
select tests.due();
select is(array(select private.lookup_step() from generate_series(1, 1)), array['report_retry'], 'a call that fails is tried again');
select tests.due();
select private.lookup_step();
select tests.due();
select private.lookup_step();
select tests.due();
select private.lookup_step();
select tests.due();
select private.lookup_step();
select tests.due();
select is(private.lookup_step(), 'report_failed', 'six times');
select is(tests.report_of(3), 'failed:not_found,failed:lookup_failed', 'then given up as a failed look-up');

-- Hyperliquid says slow down
select tests.report(3, 10, 3, 31);
select tests.due();
select tests.tx_says(31, 'rate_limited');
select is(private.lookup_step(), 'rate_limited', 'HTTP 429 from the explorer');
select results_eq($$ select status, attempts from public.execution_reports where tx_hash = tests.tx_hash(31) $$,
	$$ values ('pending', 0) $$, 'leaves the report waiting, uncounted');
select ok((select blocked_until_testnet > now() + interval '59 seconds' from private.worker_state), 'and that network is left alone for a minute');
select tests.tx_is(31, 10, 3);
select is(private.lookup_step(), 'idle', 'nothing on that network is asked meanwhile');
update private.worker_state set blocked_until_testnet = null;
select is(private.lookup_step(), 'report_confirmed', 'and then it is');

-- --------------------------------------------- the finaliser's own result is late
-- order one: the result is recorded while the report waits its 30 seconds
select tests.propose(1, 10, 2, 4, tests.now_ms() + 4);
select tests.report(3, 10, 4, 40);
select tests.receipt(2, 10, 4, '{"status":"ok","response":{"type":"default"}}');
select is(tests.status(10, 4), 'accepted', 'the finaliser submitted through the tool after all');
select tests.due();
select tests.tx_is(40, 10, 4);
select is(private.lookup_step(), 'report_rejected', 'the report finds the proposal already accepted');
select is(tests.report_of(4), 'rejected:accepted', 'and is closed without changing anything');
select is(tests.status(10, 4), 'accepted', 'it stays accepted');
select is(tests.kinds(10, 4), array['proposal_created', 'submission_recorded'], 'and the history says it once');

-- order two: the report is confirmed first, the result arrives afterwards
select tests.propose(1, 10, 2, 5, tests.now_ms() + 5);
select tests.report(3, 10, 5, 50);
select tests.due();
select tests.tx_is(50, 10, 5);
select is(private.lookup_step(), 'report_confirmed', 'closed as carried out outside');
select lives_ok($$ select tests.receipt(2, 10, 5, '{"status":"ok","response":{"type":"default"}}') $$,
	'the finaliser can still record that it was them');
select is(tests.status(10, 5), 'accepted', 'and then it is a normal accepted proposal');
select is(tests.kinds(10, 5), array['proposal_created', 'proposal_carried_out', 'submission_recorded'],
	'the history keeps both entries, in the order they happened');

-- carried out elsewhere, then the finaliser tries through the tool: the chain refuses the reused number
select tests.propose(1, 10, 2, 6, tests.now_ms() + 6);
select tests.report(3, 10, 6, 60);
select tests.due();
select tests.tx_is(60, 10, 6);
select private.lookup_step();
select tests.receipt(2, 10, 6, '{"status":"err","response":"Nonce already used"}');
select is(tests.status(10, 6), 'carried_out', 'a rejected attempt afterwards changes nothing');

-- ------------------------------------------------------- where it may come from
select tests.propose(1, 10, 2, 7, tests.now_ms() + 7);
select tests.end_it(1, 10, 7, 'withdrawn');
select tests.report(3, 10, 7, 70);
select tests.propose(1, 10, 2, 8, tests.now_ms() + 8);
select tests.declined_before(2, 10, 8);
select tests.report(3, 10, 8, 80);
select tests.propose(1, 10, 2, 9, tests.now_ms() + 9);
update public.proposals set expires_at = now() - interval '1 hour' where digest = tests.digest(9);
select tests.report(3, 10, 9, 90);
select tests.due();
select tests.tx_is(70, 10, 7);
select tests.tx_is(80, 10, 8);
select tests.tx_is(90, 10, 9);
select is(array(select private.lookup_step() from generate_series(1, 3)),
	array['report_confirmed', 'report_confirmed', 'report_confirmed'], 'three reports, three confirmations');
select is(array[tests.status(10, 7), tests.status(10, 8), tests.status(10, 9)],
	array['carried_out', 'carried_out', 'carried_out'],
	'withdrawn, declined or expired: what happened on chain wins');

-- ---------------------------------------------------------------------- twins
-- the same action and number, another finaliser: another digest
select tests.propose(1, 10, 2, 100, tests.now_ms());
select tests.propose(1, 10, 3, 101, (select nonce from public.proposals where digest = tests.digest(100)));
set local role authenticated;
select throws_ok($$ select tests.report(2, 10, 100, 100) $$, 'P0001', 'relay.report_ambiguous',
	'a proposal with a twin is never closed on the explorer''s word');
select throws_ok($$ select tests.report(2, 10, 101, 100) $$, 'P0001', 'relay.report_ambiguous', 'nor its twin');
reset role;
-- the twin appears while a report is waiting
select tests.propose(1, 10, 2, 102, tests.now_ms() + 1000);
select tests.report(2, 10, 102, 102);
select tests.propose(1, 10, 3, 103, (select nonce from public.proposals where digest = tests.digest(102)));
select tests.due();
select tests.tx_is(102, 10, 102);
select is(private.lookup_step(), 'report_rejected', 'a twin shared after the report was filed');
select is(tests.report_of(102), 'rejected:ambiguous', 'stops it just the same');
-- the same number with another action is not a twin
select tests.propose(1, 10, 2, 104, tests.now_ms() + 2000);
select tests.propose(1, 10, 2, 105, (select nonce from public.proposals where digest = tests.digest(104)), 'testnet', 'spotSend');
set local role authenticated;
select lives_ok($$ select tests.report(2, 10, 104, 104) $$, 'the same number with another action is another proposal altogether');
reset role;

-- -------------------------------------------------- a signer change is re-checked
select tests.propose(1, 10, 2, 110, tests.now_ms() + 3000, 'testnet', 'convertToMultiSigUser');
select tests.report(1, 10, 110, 110);
delete from private.lookup_queue;
select tests.due();
select tests.tx_is(104, 10, 104);
select tests.tx_is(110, 10, 110);
select private.lookup_step() from generate_series(1, 2);
select is(tests.status(10, 110), 'carried_out', 'a signer-set change carried out elsewhere is closed like any other');
select results_eq($$ select priority::int, lane from private.lookup_queue where address = tests.addr(10) $$,
	$$ values (0, 'refresh') $$, 'and the signer list is looked up ahead of everything else');

-- ------------------------------------------------------------ turns and pacing
delete from private.lookup_queue;
delete from private.lookup_log;
create table tests.signer_calls (id serial primary key, address public.address);
create or replace function private.fetch_signers(p_network public.network, p_address public.address)
returns table (outcome text, signers public.address[], threshold int, http_status int)
language plpgsql security definer set search_path = ''
as $$
begin
	insert into tests.signer_calls (address) values (p_address);
	-- the chain agrees with the stored copy: a look-up changes nothing
	return query select 'policy'::text,
		(select array_agg(s.signer order by s.signer) from public.treasury_signers s where s.treasury = p_address),
		(select t.threshold::int from public.treasuries t where t.address = p_address), 200;
end $$;
select tests.propose(1, 10, 2, 120, tests.now_ms() + 4000);
select tests.propose(1, 10, 2, 121, tests.now_ms() + 5000);
select tests.report(1, 10, 120, 120);
select tests.report(1, 10, 121, 121);
select tests.due();
select tests.tx_is(120, 10, 120);
select tests.tx_is(121, 10, 121);
select private.enqueue('testnet', tests.addr(10), 3, 'refresh');
select private.enqueue('testnet', tests.addr(11), 3, 'refresh');
update private.worker_state set last_kind = 'tx';
select is(array(select private.lookup_step() from generate_series(1, 4)),
	array['unchanged', 'report_confirmed', 'unchanged', 'report_confirmed'],
	'signer look-ups and reports take turns');
select is((select coalesce(sum(units), 0)::int from private.lookup_log), 6, 'two look-ups and two explorer calls weigh six');

-- an accepted signer change does not wait its turn
select tests.propose(1, 10, 2, 122, tests.now_ms() + 6000);
select tests.report(1, 10, 122, 122);
select tests.due();
select tests.tx_is(122, 10, 122);
select private.enqueue('testnet', tests.addr(10), 0, 'refresh');
update private.worker_state set last_kind = 'signers';
select is(private.lookup_step(), 'unchanged', 'a priority-0 look-up goes before a report whose turn it is');
select is(private.lookup_step(), 'report_confirmed', 'then the report');

-- the cap counts weight, not calls
delete from private.lookup_log;
update private.settings set value = '3' where key = 'worker.per_minute';
select tests.propose(1, 10, 2, 123, tests.now_ms() + 7000);
select tests.propose(1, 10, 2, 124, tests.now_ms() + 8000);
select tests.report(1, 10, 123, 123);
select tests.report(1, 10, 124, 124);
select tests.due();
select tests.tx_is(123, 10, 123);
select tests.tx_is(124, 10, 124);
select private.enqueue('testnet', tests.addr(11), 3, 'refresh');
update private.worker_state set last_kind = 'signers';
select is(array(select private.lookup_step() from generate_series(1, 3)),
	array['report_confirmed', 'unchanged', 'capped'],
	'with room for three a minute: one explorer call (two) and one look-up (one), then it waits');
select is(tests.status(10, 124), 'open', 'the second report waits for the next minute');
update private.settings set value = '1000' where key = 'worker.per_minute';
update private.settings set value = 'false' where key = 'worker.enabled';
select is(private.lookup_step(), 'disabled', 'switched off, the worker looks at no report either');
update private.settings set value = 'true' where key = 'worker.enabled';

-- ------------------------------------------------------------------ rate limit
select tests.seed_treasury('testnet', 12, 1, array[5]);
select tests.propose(5, 12, 5, 200 + n, tests.now_ms() + n) from generate_series(1, 11) n;
set local role authenticated;
select lives_ok(format('select tests.report(5, 12, %s, %s)', 200 + n, 200 + n), 'report ' || n || ' of 10 in an hour')
from generate_series(1, 10) n;
select throws_ok($$ select tests.report(5, 12, 211, 211) $$, 'P0001', 'relay.rate_limited', 'the eleventh is refused');
reset role;
update public.execution_reports set created_at = now() - interval '61 minutes' where reported_by = tests.addr(5);
set local role authenticated;
select lives_ok($$ select tests.report(5, 12, 211, 211) $$, 'an hour later there is room again');

-- a signer who was removed no longer reads the answers to its reports
select tests.claims(3);
select isnt_empty($$ select 1 from public.execution_reports $$, 'a signer reads its own reports');
reset role;
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2), 2);
set local role authenticated;
select tests.claims(3);
select is_empty($$ select 1 from public.execution_reports $$, 'until it is no longer a signer of that treasury');
reset role;

-- ---------------------------------------------------------------- housekeeping
update public.execution_reports set finished_at = now() - interval '31 days' where digest = tests.digest(1);
update public.execution_reports set created_at = now() - interval '40 days' where status = 'pending';
select private.prune();
select is_empty($$ select 1 from public.execution_reports where digest = tests.digest(1) $$, 'answered reports are kept for a month');
select isnt_empty($$ select 1 from public.execution_reports where status = 'pending' $$, 'a report still waiting is never dropped');
select isnt_empty($$ select 1 from public.events where digest = tests.digest(1) and kind = 'proposal_carried_out' and data ? 'tx_hash' $$,
	'the history keeps the transaction for good');

-- --------------------------------------------------------- one treasury at a time
select private.log_event('testnet', tests.addr(11), null, 'treasury_unfrozen', null);
select is((select count(*)::int from pg_locks l
	where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.granted
		and (l.classid::bigint << 32 | l.objid::bigint)
			= hashtextextended('hl-tools.relay.events:testnet:' || tests.addr(11)::text, 0) & x'ffffffffffffffff'::bit(64)::bigint),
	1, 'writing a history entry holds that treasury''s lock until the transaction ends');

select * from finish();
rollback;
