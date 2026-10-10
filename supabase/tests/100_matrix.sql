-- Who can see and do what, role by role, and the invariants every later
-- migration has to keep.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select tests.make_wallet(n) from generate_series(1, 5) n;
-- T10: wallets 1, 2, 3. T11: wallet 4. T12: wallet 1 (frozen below). Wallet 5: nothing.
select tests.seed_treasury('testnet', 10, 2, array[1, 2, 3]);
select tests.seed_treasury('testnet', 11, 1, array[4]);
select tests.seed_treasury('testnet', 12, 1, array[1]);

-- T10: proposal 1 open with two signatures, 2 withdrawn, 3 with a rejected attempt. T12: proposal 4.
select tests.propose(1, 10, 2, 1);
select tests.sign(1, 10, 1);
select tests.sign(3, 10, 1);
select tests.propose(1, 10, 2, 2);
select tests.end_it(1, 10, 2, 'withdrawn');
select tests.propose(1, 10, 2, 3);
select tests.receipt(2, 10, 3, '{"status":"err","response":"x"}');
select tests.propose(1, 12, 1, 4);
select tests.propose(1, 12, 1, 5);
select tests.request(5, 'add', 'testnet', 30);

-- wallet 3 is removed from T10 by a lookup; T12 stops being a multi-sig
select private.apply_lookup('testnet', tests.addr(10), 'policy', tests.addrs(1, 2), 2);
update public.treasuries set frozen_at = now() where address = tests.addr(12);

create function tests.sees(n int) returns text
language plpgsql as $$
declare
	out text;
begin
	perform tests.claims(n);
	select format('treasuries=%s signers=%s proposals=%s signatures=%s endings=%s receipts=%s events=%s requests=%s',
		(select count(*) from public.treasuries),
		(select count(*) from public.treasury_signers),
		(select count(*) from public.proposals),
		(select count(*) from public.signatures),
		(select count(*) from public.endings),
		(select count(*) from public.receipts),
		(select count(*) from public.events),
		(select count(*) from public.treasury_requests)) into out;
	return out;
end $$;

set local role authenticated;

-- ------------------------------------------------------------------------ reads
select is(tests.sees(1), 'treasuries=2 signers=3 proposals=5 signatures=2 endings=1 receipts=1 events=10 requests=0',
	'a signer reads everything in its treasuries, the frozen one included');
select is(tests.sees(2), 'treasuries=1 signers=2 proposals=3 signatures=2 endings=1 receipts=1 events=8 requests=0',
	'a co-signer reads the shared treasury only');
select is(tests.sees(3), 'treasuries=0 signers=0 proposals=0 signatures=0 endings=0 receipts=0 events=0 requests=0',
	'a removed signer reads nothing, not even the proposal it signed');
select is(tests.sees(4), 'treasuries=1 signers=1 proposals=0 signatures=0 endings=0 receipts=0 events=0 requests=0',
	'another treasury''s signer reads only its own treasury');
select is(tests.sees(5), 'treasuries=0 signers=0 proposals=0 signatures=0 endings=0 receipts=0 events=0 requests=1',
	'a stranger reads nothing but its own request');
select is(tests.sees(99), 'treasuries=0 signers=0 proposals=0 signatures=0 endings=0 receipts=0 events=0 requests=0',
	'a session with no wallet reads nothing');

-- ----------------------------------------------------------------------- writes
-- the removed signer
select throws_ok($$ select tests.propose(3, 10, 2, 50) $$, '42501', null, 'removed signer: cannot propose');
select throws_ok($$ select tests.sign(3, 10, 2) $$, '42501', null, 'removed signer: cannot sign');
select throws_ok($$ select tests.end_it(3, 10, 1, 'withdrawn') $$, '42501', null, 'removed signer: cannot end');
select throws_ok($$ select tests.receipt(3, 10, 1, '{}') $$, '42501', null, 'removed signer: cannot record a result');
select throws_ok($$ select tests.request(3, 'check', 'testnet', 10) $$, '42501', null, 'removed signer: cannot ask for a re-check');
select tests.claims(3);
delete from public.signatures where signer = tests.addr(3);
select tests.claims(1);
select is((select count(*)::int from public.signatures where signer = tests.addr(3)), 1,
	'removed signer: its old signature is out of its reach (browsers stop counting it; the copy keeps it)');

-- strangers and other treasuries' signers
select throws_ok($$ select tests.propose(5, 10, 2, 51) $$, '42501', null, 'stranger: cannot propose');
select throws_ok($$ select tests.sign(5, 10, 1) $$, '42501', null, 'stranger: cannot sign');
select throws_ok($$ select tests.end_it(5, 10, 1, 'declined') $$, '42501', null, 'stranger: cannot end');
select throws_ok($$ select tests.receipt(5, 10, 1, '{}') $$, '42501', null, 'stranger: cannot record a result');
select throws_ok($$ select tests.propose(4, 10, 2, 52) $$, '42501', null, 'other treasury''s signer: cannot propose here');
select throws_ok($$ select tests.sign(4, 10, 1) $$, '42501', null, 'other treasury''s signer: cannot sign here');
select throws_ok($$ select tests.propose(99, 10, 2, 53) $$, '42501', null, 'no wallet: cannot propose');
select throws_ok($$ select tests.sign(99, 10, 1) $$, '42501', null, 'no wallet: cannot sign');

-- the frozen treasury: read and wind down, nothing new
select throws_ok($$ select tests.propose(1, 12, 1, 54) $$, 'P0001', 'relay.treasury_frozen', 'frozen: cannot propose');
select throws_ok($$ select tests.sign(1, 12, 4) $$, 'P0001', 'relay.treasury_frozen', 'frozen: cannot sign');
select lives_ok($$ select tests.end_it(1, 12, 4, 'withdrawn') $$, 'frozen: an open proposal can still be withdrawn');
select lives_ok($$ select tests.receipt(1, 12, 5, '{"status":"err","response":"x"}') $$, 'frozen: a result can still be recorded');
select lives_ok($$ select tests.request(1, 'check', 'testnet', 12) $$, 'frozen: a signer can ask for a re-check');

-- the history is written by the database alone
select tests.claims(1);
select throws_ok($$ insert into public.events (network, treasury, kind) values ('testnet', tests.addr(10), 'proposal_created') $$, '42501', null, 'events cannot be inserted');
select throws_ok($$ update public.events set kind = 'proposal_withdrawn' $$, '42501', null, 'nor edited');
select throws_ok($$ delete from public.events $$, '42501', null, 'nor deleted');
reset role;

-- ------------------------------------------------------------------------- anon
set local role anon;
select throws_ok(format('select 1 from public.%I', t), '42501', null, 'anon cannot read ' || t)
from unnest(array['treasuries', 'treasury_signers', 'treasury_requests', 'events', 'proposals', 'signatures', 'endings', 'receipts']) t;
select throws_ok($$ select tests.sign(1, 10, 1) $$, '42501', null, 'anon cannot sign, whatever claims it carries');
reset role;

-- ------------------------------------------------------------------- invariants
select is_empty(
	$$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
	   where n.nspname in ('public', 'private') and c.relkind in ('r', 'p') and not c.relrowsecurity $$,
	'every table in public and private has row level security on');

select is_empty(
	$$ select table_schema || '.' || table_name || ':' || privilege_type from information_schema.role_table_grants
	   where grantee in ('anon', 'service_role', 'PUBLIC') and table_schema in ('public', 'private') $$,
	'anon, service_role and PUBLIC hold nothing on any table');
select is_empty(
	$$ select table_name || '.' || column_name || ':' || privilege_type from information_schema.column_privileges
	   where grantee in ('anon', 'service_role', 'PUBLIC') and table_schema in ('public', 'private') $$,
	'nor on any column');

select set_eq(
	$$ select table_name || ':' || privilege_type from information_schema.role_table_grants
	   where grantee = 'authenticated' and table_schema in ('public', 'private') $$,
	array['treasuries:SELECT', 'treasury_signers:SELECT', 'treasury_requests:SELECT', 'events:SELECT',
		'proposals:SELECT', 'signatures:SELECT', 'signatures:DELETE', 'endings:SELECT', 'receipts:SELECT'],
	'authenticated holds exactly these table privileges: SELECT everywhere, DELETE on its own signatures');

select set_eq(
	$$ select table_name || ':' || string_agg(column_name, ',' order by column_name) from information_schema.column_privileges
	   where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'INSERT' group by table_name $$,
	array['treasury_requests:address,kind,network',
		'proposals:digest,document,finaliser,network,nonce,treasury',
		'signatures:digest,network,r,s,treasury,v',
		'endings:digest,kind,network,treasury',
		'receipts:digest,http_status,network,outer_r,outer_s,outer_v,response,signature_chain_id,submitted_at,treasury'],
	'and may insert exactly these columns: never who acted, never a status');

select is_empty(
	$$ select table_name || '.' || column_name from information_schema.column_privileges
	   where grantee = 'authenticated' and table_schema in ('public', 'private') and privilege_type = 'UPDATE' $$,
	'nothing anywhere can be updated through the API');

select is_empty(
	$$ select tablename || ': ' || policyname from pg_policies
	   where schemaname in ('public', 'private') and roles <> '{authenticated}' $$,
	'every policy is for signed-in users only');

select set_eq(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname in ('public', 'private') and has_function_privilege('authenticated', p.oid, 'execute') $$,
	array['whoami()', 'private.current_wallet()', 'private.my_treasuries()', 'private.is_signer(network,address,boolean)'],
	'authenticated may run exactly: whoami and the three policy helpers');
select is_empty(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname in ('public', 'private')
	     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')) $$,
	'anon and service_role may run none');
select is_empty(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname = 'private' and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig))) $$,
	'every private function is a definer with an empty search path');
select is_empty(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname = 'public' and p.prosecdef $$,
	'no definer function is exposed through the API schema');
select is_empty(
	$$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
	   where n.nspname = 'public' and c.relkind in ('v', 'm') $$,
	'no views in the API schema');
select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('service_role', 'private', 'usage'),
	'anon and service_role cannot enter the private schema');

select * from finish();
rollback;
