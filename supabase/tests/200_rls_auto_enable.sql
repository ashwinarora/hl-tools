-- Supabase's "enable RLS on every new table" option, as the hosted project has
-- it (relay_rls_auto_enable_web): nobody runs its function over the web, and
-- new tables of `public` still get RLS. The function and its event trigger are
-- Supabase's documented snippet, made here inside the test's transaction
-- because the local stack does not have them.
begin;
\ir _helpers.inc
select no_plan();
select tests.quiet();

-- the migration's own statement, run where the function does not exist
create function tests.revoke_auto_rls() returns void
language plpgsql as $$
begin
	if to_regprocedure('public.rls_auto_enable()') is not null then
		revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
	end if;
end $$;
select lives_ok($$ select tests.revoke_auto_rls() $$, 'without the option the statement does nothing');

-- docs/guides/database/postgres/event-triggers, "auto enable Row Level Security"
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
	cmd record;
begin
	for cmd in
		select *
		from pg_event_trigger_ddl_commands()
		where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
			and object_type in ('table', 'partitioned table')
	loop
		if cmd.schema_name is not null and cmd.schema_name in ('public') and cmd.schema_name not in ('pg_catalog', 'information_schema') and cmd.schema_name not like 'pg_toast%' and cmd.schema_name not like 'pg_temp%' then
			begin
				execute format('alter table if exists %s enable row level security', cmd.object_identity);
				raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
			exception
				when others then
					raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
					raise;
			end;
		else
			raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
		end if;
	end loop;
end;
$$;
drop event trigger if exists ensure_rls;
create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function public.rls_auto_enable();

-- what the hosted advisors warned about
select ok(has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'),
	'as Supabase makes it, anyone may call it');

select tests.revoke_auto_rls();

select ok(not has_function_privilege('anon', 'public.rls_auto_enable()', 'execute'), 'anon may not run it');
select ok(not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'), 'a signed-in wallet may not run it');
select ok(not has_function_privilege('service_role', 'public.rls_auto_enable()', 'execute'), 'service_role may not run it');
set local role authenticated;
select throws_ok($$ select public.rls_auto_enable() $$, '42501', null, 'calling it is refused for want of the right, before anything else');
reset role;

-- and the option still works: an event trigger asks for no EXECUTE
create table public.t200_probe (id int);
select ok((select relrowsecurity from pg_class where oid = 'public.t200_probe'::regclass),
	'a table made in public afterwards gets RLS');
create table private.t200_probe (id int);
select ok(not (select relrowsecurity from pg_class where oid = 'private.t200_probe'::regclass),
	'outside public it does nothing, as before');

select * from finish();
rollback;
