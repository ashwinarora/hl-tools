-- One answer, one state change: the only code that writes the signer copy.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 6) n;

create function tests.signers_of(n int) returns text[]
language sql as $$
	select coalesce(array_agg(signer::text order by signer), '{}') from public.treasury_signers
	where network = 'testnet' and treasury = tests.addr(n)
$$;
create function tests.req_status(p_id uuid) returns text
language sql as $$ select status || coalesce(':' || reason, '') from public.treasury_requests where id = p_id $$;

-- 1. a signer adds an unknown multi-sig; a stranger asks for the same one
create temp table r on commit drop as
select tests.request(1, 'add', 'testnet', 20) as by_signer, null::uuid as by_stranger, null::uuid as other;
update r set by_stranger = tests.request(4, 'add', 'testnet', 20);
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 3), 2), 'added',
	'an unknown multi-sig is stored when one of the askers is in its signer list');
select results_eq(
	$$ select threshold::int, added_by::text, frozen_at is null from public.treasuries where address = tests.addr(20) $$,
	$$ values (2, tests.addr(1)::text, true) $$, 'with its threshold and who added it');
select is(tests.signers_of(20), tests.addrs(1, 2, 3)::text[], 'and its signers');
select is(tests.req_status((select by_signer from r)), 'done', 'the signer''s request is done');
select is(tests.req_status((select by_stranger from r)), 'rejected:not_a_signer', 'the stranger''s is rejected');
select results_eq(
	$$ select kind, actor::text, (data ->> 'threshold')::int, jsonb_array_length(data -> 'signers') from public.events where treasury = tests.addr(20) $$,
	$$ values ('treasury_added', tests.addr(1)::text, 2, 3) $$, 'the history records who added it');

-- 2. only strangers ask
update r set other = tests.request(4, 'add', 'testnet', 21);
select is(private.apply_lookup('testnet', tests.addr(21), 'policy', tests.addrs(1, 2), 1), 'rejected',
	'a multi-sig nobody asking signs for is not stored');
select is_empty($$ select 1 from public.treasuries where address = tests.addr(21) $$, 'no treasury row');
select is_empty($$ select 1 from public.events where treasury = tests.addr(21) $$, 'no history');
select is(tests.req_status((select other from r)), 'rejected:not_a_signer', 'the request says why');

-- 3. nobody asked at all (a stale queue row)
select is(private.apply_lookup('testnet', tests.addr(22), 'policy', tests.addrs(1, 2), 1), 'rejected',
	'an answer nobody asked for stores nothing');
select is_empty($$ select 1 from public.treasuries where address = tests.addr(22) $$, 'no treasury row');

-- 4. two signers add the same account at the same moment
update r set by_signer = tests.request(2, 'add', 'testnet', 23), by_stranger = tests.request(3, 'add', 'testnet', 23);
-- (one transaction here, so both carry the same timestamp; in life they differ)
update public.treasury_requests set created_at = now() - interval '1 second' where id = (select by_signer from r);
select is(private.apply_lookup('testnet', tests.addr(23), 'policy', tests.addrs(2, 3), 2), 'added', 'two askers, one answer');
select is((select count(*)::int from public.treasuries where address = tests.addr(23)), 1, 'one treasury');
select is((select added_by::text from public.treasuries where address = tests.addr(23)), tests.addr(2)::text, 'credited to the first to ask');
select is(tests.req_status((select by_signer from r)) || ' ' || tests.req_status((select by_stranger from r)), 'done done', 'both requests are done');

-- 5. not a multi-sig
update r set other = tests.request(1, 'add', 'testnet', 24);
select is(private.apply_lookup('testnet', tests.addr(24), 'none'), 'rejected', 'an account that is not a multi-sig is not stored');
select is(tests.req_status((select other from r)), 'rejected:not_multisig', 'and the request says so');

-- 6. a known treasury, nothing changed
update public.treasuries set checked_at = now() - interval '1 hour', changed_at = now() - interval '1 hour' where address = tests.addr(20);
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(3, 2, 1), 2), 'unchanged', 'the same list in another order is no change');
select ok((select checked_at > now() - interval '1 minute' and changed_at < now() - interval '30 minutes' from public.treasuries where address = tests.addr(20)),
	'checked_at moves, changed_at does not');
select is((select count(*)::int from public.events where treasury = tests.addr(20)), 1, 'and nothing is added to the history');

-- 7. a signer replaced and the threshold raised
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 5), 3), 'changed', 'a different list is a change');
select is(tests.signers_of(20), tests.addrs(1, 2, 5)::text[], 'the copy follows the chain');
select is((select threshold::int from public.treasuries where address = tests.addr(20)), 3, 'so does the threshold');
select results_eq(
	$$ select actor is null, data -> 'added', data -> 'removed', (data ->> 'threshold_before')::int, (data ->> 'threshold_after')::int
	   from public.events where treasury = tests.addr(20) and kind = 'signers_changed' $$,
	$$ values (true, to_jsonb(array[tests.addr(5)::text]), to_jsonb(array[tests.addr(3)::text]), 2, 3) $$,
	'the history records who came, who went and both thresholds');
select ok((select changed_at > now() - interval '1 minute' from public.treasuries where address = tests.addr(20)), 'changed_at moves');

-- 8. threshold only
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 5), 2), 'changed', 'a threshold change alone is a change');
select results_eq(
	$$ select jsonb_array_length(data -> 'added'), jsonb_array_length(data -> 'removed'), (data ->> 'threshold_after')::int
	   from public.events where treasury = tests.addr(20) and kind = 'signers_changed' order by id desc limit 1 $$,
	$$ values (0, 0, 2) $$, 'recorded with empty lists');

-- 9. a wallet newly added on chain adds a treasury the relay already knows
update r set other = tests.request(6, 'add', 'testnet', 20);
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 5, 6), 2), 'changed', 'the lookup it triggers brings the copy up to date');
select is(tests.req_status((select other from r)), 'done', 'and its request is done');
set local role authenticated;
select tests.claims(6);
select isnt_empty($$ select 1 from public.treasuries where address = tests.addr(20) $$, 'the new signer now sees the treasury');
select tests.claims(3);
select is_empty($$ select 1 from public.treasuries where address = tests.addr(20) $$, 'the removed signer no longer does');
reset role;

-- 10. freezing needs two "not a multi-sig" answers at least 30 s apart
update public.treasuries set checked_at = now() - interval '5 minutes' where address = tests.addr(20);
update r set other = tests.request(1, 'check', 'testnet', 20);
select is(private.apply_lookup('testnet', tests.addr(20), 'none'), 'recheck', 'the first one only asks for a second look');
select ok((select frozen_at is null from public.treasuries where address = tests.addr(20)), 'nothing is frozen yet');
select is(tests.req_status((select other from r)), 'pending', 'the re-check request keeps waiting');
select is(private.apply_lookup('testnet', tests.addr(20), 'none'), 'recheck', 'a second one straight away does not count');
select ok((select frozen_at is null from public.treasuries where address = tests.addr(20)), 'still not frozen');

-- a valid answer in between starts the count again
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 5, 6), 2), 'unchanged', 'a valid answer in between');
select is_empty($$ select 1 from private.treasury_checks where address = tests.addr(20) $$, 'clears the count');
select is(private.apply_lookup('testnet', tests.addr(20), 'none'), 'recheck', 'so the next "none" is a first one again');

update private.treasury_checks set last_null_at = now() - interval '31 seconds' where address = tests.addr(20);
select is(private.apply_lookup('testnet', tests.addr(20), 'none'), 'frozen', 'a second one 30 s later freezes the treasury');
select ok((select frozen_at is not null from public.treasuries where address = tests.addr(20)), 'frozen_at is set');
select is(tests.signers_of(20), tests.addrs(1, 2, 5, 6)::text[], 'its last known signers are kept');
select is((select count(*)::int from public.events where treasury = tests.addr(20) and kind = 'treasury_frozen'), 1, 'the history records it');

select is(private.apply_lookup('testnet', tests.addr(20), 'none'), 'unchanged', 'further "none" answers change nothing');
select is((select count(*)::int from public.events where treasury = tests.addr(20) and kind = 'treasury_frozen'), 1, 'and are not logged again');

-- 11. it becomes a multi-sig again
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2, 5, 6), 2), 'unfrozen', 'a valid answer unfreezes it');
select ok((select frozen_at is null from public.treasuries where address = tests.addr(20)), 'frozen_at is cleared');
select is((select count(*)::int from public.events where treasury = tests.addr(20) and kind = 'treasury_unfrozen'), 1, 'the history records it');

-- 12. unfreezing with a different list is a change and an unfreeze
update private.treasury_checks set null_streak = 0 where true;
select private.apply_lookup('testnet', tests.addr(20), 'none');
update private.treasury_checks set last_null_at = now() - interval '31 seconds' where address = tests.addr(20);
select private.apply_lookup('testnet', tests.addr(20), 'none');
select is(private.apply_lookup('testnet', tests.addr(20), 'policy', tests.addrs(1, 2), 1), 'changed', 'frozen, then back with other signers');
select ok((select frozen_at is null from public.treasuries where address = tests.addr(20)), 'it is unfrozen');
select is((select count(*)::int from public.events where treasury = tests.addr(20) and kind = 'treasury_unfrozen'), 2, 'the unfreeze is logged');
select is((select count(*)::int from public.events where treasury = tests.addr(20) and kind = 'signers_changed'), 4, 'and so is the change');

select throws_ok($$ select private.apply_lookup('testnet', tests.addr(20), 'rate_limited') $$, 'P0001', null, 'any other outcome is a programming error');

-- nothing here is callable through the API
select ok(not has_function_privilege('authenticated', 'private.apply_lookup(public.network, public.address, text, public.address[], int)', 'execute'),
	'authenticated cannot call apply_lookup');
select ok(not has_function_privilege('authenticated', 'private.fetch_signers(public.network, public.address)', 'execute'),
	'authenticated cannot make the relay call Hyperliquid');
select ok(not has_function_privilege('authenticated', 'private.enqueue(public.network, public.address, int, text, timestamptz)', 'execute'),
	'authenticated cannot enqueue directly');

select * from finish();
rollback;
