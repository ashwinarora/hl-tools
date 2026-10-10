-- Live updates and schedules.
--
-- Live: when anything a signer can see changes, the database sends an empty
-- "changed" message to that signer's own private channel, `wallet:<address>`,
-- and the open page re-reads through the access rules. The message carries no
-- data on purpose: channel access is checked when a browser joins and cached
-- for the connection, and a dropped connection can miss messages, so a ping is
-- only ever a hint to look again.

-- Never raises: a missed ping delays a refresh, it must not fail the write
-- that caused it.
create function private.ping_wallets(p_wallets public.address[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
	w text;
begin
	for w in select distinct x::text from unnest(coalesce(p_wallets, '{}')) x where x is not null loop
		begin
			perform realtime.send('{}'::jsonb, 'changed', 'wallet:' || w, true);
		exception when others then
			null;
		end;
	end loop;
end $$;

-- Every entry in the history pings the treasury's current signers. A signer
-- change also pings whoever was just removed, so their open page lets go.
create function private.event_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	targets public.address[];
begin
	begin
		select array_agg(x) into targets from (
			select s.signer as x
			from public.treasury_signers s
			where s.network = new.network and s.treasury = new.treasury
			union
			select (j.value #>> '{}')::public.address
			from jsonb_array_elements(
				case when new.kind = 'signers_changed' and jsonb_typeof(new.data -> 'removed') = 'array'
					then new.data -> 'removed' else '[]'::jsonb end) j
		) t;
		perform private.ping_wallets(targets);
	exception when others then
		null;
	end;
	return null;
end $$;

create trigger event_after after insert on public.events
	for each row execute function private.event_after();

-- The worker's answer to "add this treasury" reaches the asker at once.
create function private.treasury_request_answered() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	perform private.ping_wallets(array[new.requested_by]);
	return null;
end $$;

create trigger treasury_request_answered after update of status on public.treasury_requests
	for each row when (old.status is distinct from new.status)
	execute function private.treasury_request_answered();

-- Who may join which channel. Realtime asks "may this user read a message on
-- the topic being joined"; the row's own topic is checked as well, so the
-- rule also holds for anyone reading the table by other means. There is no
-- INSERT policy: only the database puts messages on these channels (a
-- browser's own send is dropped).
create policy "a wallet hears its own pings" on realtime.messages
	for select to authenticated
	using (
		extension = 'broadcast'
		and topic = 'wallet:' || (select private.current_wallet())
		and topic = (select realtime.topic())
	);

-- ------------------------------------------------------------------- schedules

create extension if not exists pg_cron with schema pg_catalog;

-- Housekeeping. pg_cron records every run; the lookup job alone adds 43,200
-- rows a day.
create function private.prune() returns void
language plpgsql security definer set search_path = ''
as $$
begin
	begin
		delete from cron.job_run_details where end_time < now() - interval '6 hours';
	exception when others then
		null; -- not ours to fail on
	end;
	delete from private.lookup_log where at < now() - interval '7 days';
	delete from private.session_marks where at < now() - interval '1 hour';
	delete from public.treasury_requests
	where status <> 'pending' and finished_at < now() - interval '7 days';
	-- a request left waiting for a day with nothing queued for it will never be answered
	update public.treasury_requests r set status = 'failed', reason = 'lookup_failed', finished_at = now()
	where r.status = 'pending' and r.created_at < now() - interval '1 day'
		and not exists (select 1 from private.lookup_queue q
			where q.network = r.network and q.address = r.address);
end $$;

revoke execute on all functions in schema private from public;

select cron.schedule('relay-lookups', '2 seconds', 'select private.run_lookups()');
select cron.schedule('relay-sweep', '* * * * *', 'select private.sweep()');
select cron.schedule('relay-prune', '7 * * * *', 'select private.prune()');
