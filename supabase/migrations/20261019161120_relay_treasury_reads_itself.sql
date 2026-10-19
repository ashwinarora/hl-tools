-- The treasury account itself reads its treasury.
--
-- Until now only the current signers read what the relay holds for a
-- treasury; the account itself, signed in with its own wallet, read nothing
-- but its own request to be added. It now reads what its signers read: the
-- treasury, its signer list, its proposals with their signatures, nos,
-- endings and results, its nicknames, who has seen what, and its history.
-- Whatever is carried out shows on Hyperliquid's public record anyway, and
-- the account's own key still controls the address everywhere outside
-- Hyperliquid's trading side.
--
-- It still writes nothing: every insert is checked by private.is_signer(),
-- in its policy and again in its BEFORE trigger, and that function looks at
-- the signer list only. What is kept per wallet stays with that wallet: a
-- signer's read marks and execution reports are read by their own wallet
-- alone (those policies also require `wallet = me` / `reported_by = me`).

create or replace function private.my_treasuries()
returns table (network public.network, treasury public.address)
language sql stable security definer set search_path = ''
as $$
	select s.network, s.treasury
	from public.treasury_signers s
	where s.signer = (select private.current_wallet())
	union
	select t.network, t.address
	from public.treasuries t
	where t.address = (select private.current_wallet())
$$;

-- Every entry in the history pings the treasury's current signers and the
-- treasury account itself. A signer change also pings whoever was just
-- removed, so their open page lets go.
create or replace function private.event_after() returns trigger
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
			select new.treasury
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

-- A nickname: every signer's open page, and the account's own, reads the names again.
create or replace function private.nickname_change_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	targets public.address[];
begin
	if new.name is null then
		delete from public.nicknames n
		where n.network = new.network and n.treasury = new.treasury and n.address = new.address;
	else
		begin
			insert into public.nicknames as n (network, treasury, address, name, name_key, set_by, set_at)
			values (new.network, new.treasury, new.address, new.name, lower(new.name), new.changed_by, new.changed_at)
			on conflict (network, treasury, address) do update set
				name = excluded.name, name_key = excluded.name_key,
				set_by = excluded.set_by, set_at = excluded.set_at;
		exception when unique_violation then
			raise exception 'relay.nickname_taken'
				using detail = 'Another address in this treasury already has that nickname.';
		end;
		if (select count(*) from public.nicknames n
				where n.network = new.network and n.treasury = new.treasury) > 500 then
			raise exception 'relay.nickname_cap'
				using detail = 'A treasury keeps at most 500 nicknames.';
		end if;
	end if;

	select array_agg(x) into targets from (
		select s.signer as x
		from public.treasury_signers s
		where s.network = new.network and s.treasury = new.treasury
		union
		select new.treasury
	) t;
	perform private.ping_wallets(targets);
	return null;
end $$;

-- A first view tells the treasury's signers and the account itself.
create or replace function private.proposal_view_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	targets public.address[];
begin
	select array_agg(x) into targets from (
		select s.signer as x
		from public.treasury_signers s
		where s.network = new.network and s.treasury = new.treasury
		union
		select new.treasury
	) t;
	perform private.ping_wallets(targets);
	return null;
end $$;
