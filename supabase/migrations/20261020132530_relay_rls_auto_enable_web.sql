-- Nobody calls the automatic-RLS function over the web.
--
-- The hosted project has Supabase's own "enable RLS on every new table"
-- option: a function `public.rls_auto_enable()` behind the event trigger
-- `ensure_rls`, made in the dashboard, not here (Supabase's documented
-- snippet, docs/guides/database/postgres/event-triggers). Being in `public`
-- and a definer, it is listed by the API as `/rest/v1/rpc/rls_auto_enable`,
-- callable by anyone, and the security advisors warn about it twice. An
-- event-trigger function cannot run when called that way, so this changes
-- nothing anyone could do; it makes the advisors clean again and keeps the
-- rule of 100_matrix.sql (no client may run a function the repo does not
-- grant) true on the hosted project too.
--
-- An event trigger fires without asking for EXECUTE, so the new tables of
-- `public` keep getting RLS. Where the function does not exist (the local
-- stack, a project without the option) this does nothing.

do $$
begin
	if to_regprocedure('public.rls_auto_enable()') is not null then
		revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;
	end if;
end $$;
