-- A session that was ended stops working at once: the relay answers only for
-- a session that still exists, and the API refuses a signed-in request whose
-- session is gone.
begin;
\ir _helpers.inc
select no_plan();

select tests.make_wallet(n) from generate_series(1, 4) n;
-- T10: wallets 1 and 2
select tests.seed_treasury('testnet', 10, 2, array[1, 2]);
-- wallet 3's session is time-boxed and has run out; wallet 4's is time-boxed and has not
update auth.sessions set not_after = now() - interval '1 second' where id = tests.session_id(3);
update auth.sessions set not_after = now() + interval '1 hour' where id = tests.session_id(4);

-- ------------------------------------------------------------ a live session
set local role authenticated;
select tests.claims(1);
select is(private.current_wallet(), tests.addr(1), 'a session that exists speaks for its wallet');
select is(public.whoami(), tests.addr(1), 'whoami reports it');
select isnt_empty('select 1 from public.treasuries', 'and reads what its wallet may read');
select lives_ok('select gate.live_session()', 'the gate lets a live session through');

select tests.claims(4);
select is(private.current_wallet(), tests.addr(4), 'a time-boxed session speaks until its time is up');
select lives_ok('select gate.live_session()', 'and passes the gate');
reset role;

-- ------------------------------------------------------- the session is ended
-- what Supabase Auth does on "Sign out": the session's row is removed
delete from auth.sessions where id = tests.session_id(1);

set local role authenticated;
select tests.claims(1);
select is(private.current_wallet(), null, 'an ended session has no wallet, though its token is still within its hour');
select is(public.whoami(), null, 'whoami names nobody');
select is_empty('select 1 from public.treasuries', 'it reads no treasury');
select is_empty('select 1 from public.treasury_signers', 'and no signer list');
select is_empty('select * from private.my_treasuries()', 'my_treasuries is empty for it');
select ok(not private.is_signer('testnet', tests.addr(10)), 'it signs for nothing');
select throws_ok(
	$$ insert into public.treasury_requests (network, address, kind) values ('testnet', tests.addr(10), 'check') $$,
	null, null, 'it may ask for nothing');
select throws_ok(
	$$ insert into public.proposals (network, treasury, digest, document, finaliser, nonce)
	   values ('testnet', tests.addr(10), tests.digest(1), tests.doc('testnet', 10, 2, 1, tests.now_ms()), tests.addr(2), tests.now_ms()) $$,
	null, null, 'and share nothing');
select throws_ok('select gate.live_session()', 'PGRST', null, 'the gate refuses it');

-- the other signer of the same treasury is untouched
select tests.claims(2);
select is(private.current_wallet(), tests.addr(2), 'another wallet''s session is as it was');
select isnt_empty('select 1 from public.treasuries', 'and still reads the treasury');
reset role;

-- what the gate says, exactly: PostgREST turns this into the HTTP answer
do $$
declare
	said text;
	how text;
begin
	set local role authenticated;
	perform tests.claims(1);
	begin
		perform gate.live_session();
	exception when sqlstate 'PGRST' then
		get stacked diagnostics said = message_text, how = pg_exception_detail;
	end;
	reset role;
	perform set_config('tests.said', coalesce(said, ''), true);
	perform set_config('tests.how', coalesce(how, ''), true);
end $$;
select is(current_setting('tests.said')::jsonb ->> 'message', 'relay.session_ended', 'the refusal carries the stable message the page knows');
select is(current_setting('tests.said')::jsonb ->> 'code', 'relay.session_ended', 'and the same as its code');
select is((current_setting('tests.how')::jsonb ->> 'status')::int, 401, 'as HTTP 401');

-- ------------------------------------------------ sessions that are not there
set local role authenticated;
select tests.claims(3);
select is(private.current_wallet(), null, 'a session past its time box has no wallet');
select throws_ok('select gate.live_session()', 'PGRST', null, 'and is refused at the gate');

-- the token names wallet 2's user and somebody else's session
select tests.claims(2, jsonb_build_object('session_id', tests.session_id(4)));
select is(private.current_wallet(), null, 'another user''s session does not count as one''s own');
select tests.claims(2, jsonb_build_object('session_id', gen_random_uuid()));
select is(private.current_wallet(), null, 'nor does a session that never existed');

-- a token with no session in it, or with something that is not one
select tests.claims(2, '{"session_id": null}');
select is(private.current_wallet(), null, 'a token that names no session has no wallet');
select tests.claims(2, '{"session_id": ""}');
select is(private.current_wallet(), null, 'an empty session id names none');
select tests.claims(2, '{"session_id": "not-a-uuid"}');
select is(private.current_wallet(), null, 'a session id that is not a UUID names none, and raises nothing');
select throws_ok('select gate.live_session()', 'PGRST', null, 'the gate refuses it like any other');
select tests.claims(2, '{"session_id": 7}');
select is(private.current_wallet(), null, 'nor does a number');
select tests.claims(2, jsonb_build_object('session_id', upper(tests.session_id(2)::text)));
select is(private.current_wallet(), tests.addr(2), 'the same session spelled in capitals is the same session');

-- a deleted user's session row cannot outlive the user, but if it did: no identity, no wallet
select tests.claims(99, jsonb_build_object('session_id', tests.session_id(2)));
select is(private.current_wallet(), null, 'a session is only its own user''s');
reset role;

-- ------------------------------------------ requests that are tied to no session
-- the publishable key by itself, the service key, the database's own jobs
select tests.no_claims();
select lives_ok('select gate.live_session()', 'the gate has nothing to ask of a request with no token');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select lives_ok('select gate.live_session()', 'nor of the anonymous role');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok('select gate.live_session()', 'nor of the service role');
reset role;
select tests.no_claims();

-- --------------------------------------------------------------------- wiring
select is(
	(select split_part(c, '=', 2) from pg_roles r, unnest(r.rolconfig) c
	 where r.rolname = 'authenticator' and c like 'pgrst.db_pre_request=%'),
	'gate.live_session',
	'PostgREST is told to run the gate before every request');

select set_eq(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname = 'gate' $$,
	array['gate.live_session()'],
	'the gate schema holds the gate and nothing else');
select ok(has_function_privilege('anon', 'gate.live_session()', 'execute')
	and has_function_privilege('authenticated', 'gate.live_session()', 'execute')
	and has_function_privilege('service_role', 'gate.live_session()', 'execute'),
	'every role that can make a request can run it');
select ok(not has_function_privilege('authenticated', 'private.current_session()', 'execute'),
	'a signed-in user cannot ask which session a request is');
select ok(not has_function_privilege('anon', 'private.current_session()', 'execute'), 'nor can anon');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon still has no access to the private schema');
select is_empty(
	$$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
	   where n.nspname = 'gate' and c.relkind in ('r', 'p', 'v', 'm') $$,
	'the gate schema holds no table or view');

-- Every rule goes through current_wallet(), so every rule asks for a live
-- session. A policy or function that read the user straight from the token
-- would not.
select is_empty(
	$$ select schemaname || '.' || tablename || ': ' || policyname from pg_policies
	   where schemaname in ('public', 'private', 'realtime')
	     and (coalesce(qual, '') || coalesce(with_check, '')) ~ 'auth\.(uid|jwt|role)\(' $$,
	'no policy reads the user from the token by itself');
select set_eq(
	$$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	   where n.nspname in ('public', 'private', 'gate') and p.prosrc ~ 'auth\.(uid|jwt)\(' $$,
	array['private.current_session()', 'private.current_wallet()', 'gate.live_session()'],
	'and only the identity functions and the gate read the token');

select * from finish();
rollback;
