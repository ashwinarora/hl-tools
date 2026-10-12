-- A session that was ended stops working at once.
--
-- An access token is good for an hour. Until now the relay asked a token one
-- thing only: whose it is. It never asked whether the session the token was
-- issued for still exists, so after "Sign out" (which ends the session and
-- its renewal token) an access token already issued went on working until
-- its hour was up. The browser that signed out holds nothing by then; a copy
-- of the token taken earlier would still have read and written as the wallet.
--
-- Supabase Auth removes a session's row from auth.sessions when the session
-- is signed out, and every access token names its session in the `session_id`
-- claim, so "is this session still there" is one look-up by primary key
-- (https://supabase.com/docs/guides/auth/sessions).
--
-- Two things change, and nothing else:
--
-- 1. private.current_wallet(), which every policy, guard and trigger of the
--    relay goes through (the channel rule on realtime.messages included),
--    answers only for a session that exists. An ended session has no wallet:
--    it reads nothing and may write nothing.
-- 2. The API refuses a signed-in request whose session is gone before it runs
--    (PostgREST's pre-request function), with HTTP 401 and the stable message
--    `relay.session_ended`. Without it such a request would come back empty
--    rather than refused, and a page could not tell "this wallet has no
--    treasuries" from "this wallet is no longer signed in".

-- The session of the request, when it still exists. Null for a request with
-- no session (the anonymous key, the service key, the database's own jobs),
-- for a session that was signed out, and for one past its time box.
create function private.current_session() returns uuid
language sql stable security definer set search_path = ''
as $$
	select s.id
	from auth.sessions s
	where s.id = (
			-- a claim that is not a UUID names no session; it must not raise
			select case
				when c.sid ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
				then c.sid::uuid
			end
			from (select (select auth.jwt()) ->> 'session_id' as sid) c
		)
		-- the session is the token's own user's, not merely somebody's
		and s.user_id = (select auth.uid())
		and (s.not_after is null or s.not_after > now())
$$;

create or replace function private.current_wallet() returns public.address
language sql stable security definer set search_path = ''
as $$
	select case
		when (select private.current_session()) is not null
		then private.wallet_of((select auth.uid()))
	end
$$;

-- What PostgREST runs before every request. It lives in a schema of its own:
-- every role that can make a request has to be able to run it, and `private`
-- stays closed to the anonymous role.
create schema gate;
revoke all on schema gate from public;
grant usage on schema gate to anon, authenticated, service_role;

create function gate.live_session() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
	-- only a signed-in user's request is tied to a session
	if ((select auth.jwt()) ->> 'role') is distinct from 'authenticated' then
		return;
	end if;
	if (select private.current_session()) is null then
		raise sqlstate 'PGRST' using
			message = json_build_object(
				'code', 'relay.session_ended',
				'message', 'relay.session_ended',
				'details', 'This session has ended: it was signed out, or it has run out.',
				'hint', 'Sign in again.')::text,
			detail = json_build_object(
				'status', 401,
				'headers', json_build_object())::text;
	end if;
end $$;

revoke execute on function gate.live_session() from public;
grant execute on function gate.live_session() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'gate.live_session';
notify pgrst, 'reload config';

revoke execute on all functions in schema private from public;
