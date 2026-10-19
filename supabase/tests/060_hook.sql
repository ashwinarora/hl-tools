-- The token hook: it must never be able to stop a sign-in.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

select has_function('private', 'on_token_issued', array['jsonb'], 'the function the Auth config points at exists under that name');
select ok(has_function_privilege('supabase_auth_admin', 'private.on_token_issued(jsonb)', 'execute'), 'Supabase Auth may run it');
select ok(has_schema_privilege('supabase_auth_admin', 'private', 'usage'), 'and may enter its schema');
select ok(not has_function_privilege('authenticated', 'private.on_token_issued(jsonb)', 'execute'), 'a signed-in user may not');
select ok(not has_function_privilege('anon', 'private.on_token_issued(jsonb)', 'execute'), 'nor anon');

-- as Supabase Auth calls it (the test role cannot become supabase_auth_admin;
-- the integration suite signs in for real)
select is(
	private.on_token_issued(jsonb_build_object('user_id', tests.user_id(1), 'authentication_method', 'web3', 'claims', jsonb_build_object('sub', tests.user_id(1), 'role', 'authenticated'))),
	jsonb_build_object('user_id', tests.user_id(1), 'authentication_method', 'web3', 'claims', jsonb_build_object('sub', tests.user_id(1), 'role', 'authenticated')),
	'the event comes back untouched');
select is(
	private.on_token_issued('{"claims":{"role":"authenticated"}}'),
	'{"claims":{"role":"authenticated"}}'::jsonb,
	'an event with no user id comes back untouched too');
select is(
	private.on_token_issued('{"user_id":"not-a-uuid","claims":{}}'),
	'{"user_id":"not-a-uuid","claims":{}}'::jsonb,
	'so does one with a malformed user id');
select ok(not has_table_privilege('supabase_auth_admin', 'private.session_marks', 'select,insert,update,delete'),
	'the Auth role holds nothing on the marks table itself');
select ok(not has_table_privilege('supabase_auth_admin', 'public.treasuries', 'select'), 'nor on the registry');

select results_eq('select user_id from private.session_marks', array[tests.user_id(1)], 'one mark was left, for the one well-formed event');

-- the marks table gone wrong must not matter either
alter table private.session_marks add constraint spoil check (false) not valid;
select is(
	private.on_token_issued(jsonb_build_object('user_id', tests.user_id(2), 'claims', '{}'::jsonb)),
	jsonb_build_object('user_id', tests.user_id(2), 'claims', '{}'::jsonb),
	'when the insert fails, the event still comes back');
select is((select count(*)::int from private.session_marks), 1, 'and no mark is left');

select * from finish();
rollback;
