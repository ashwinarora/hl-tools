-- Nicknames: a readable name for an address, inside one treasury.
--
-- A nickname belongs to one treasury and is shown nowhere else: the same
-- address may be "Alice" in one treasury, "Ops lead" in a second and unnamed
-- in a third, and none of the three can see the others. The treasury's own
-- address can have one too.
--
-- Who may name what:
--   a signer's own address   that signer, and nobody else
--   any other address        any signer of the treasury
-- A nickname needs no wallet signature and no approval. It is a label on a
-- screen, never part of what anybody signs: the address is always shown next
-- to it.
--
-- Like everything a browser asks of the relay, a change is an inserted row
-- (`nickname_changes`, which is also the record of who changed what); the
-- database checks it and writes the current state (`nicknames`) itself.

-- ------------------------------------------------------------------ the rules

-- A nickname as it is stored: compatibility forms folded (NFKC), runs of
-- white space made one space, none at the ends.
create function private.nickname_text(p_name text) returns text
language sql immutable security definer set search_path = ''
as $$
	select btrim(regexp_replace(normalize(p_name, NFKC), '\s+', ' ', 'g'))
$$;

-- What two nicknames are compared by: one may not differ from another only
-- in capitals.
create function private.nickname_key(p_name text) returns text
language sql immutable security definer set search_path = ''
as $$
	select lower(private.nickname_text(p_name))
$$;

-- Why a (stored-form) nickname cannot be used; null when it can.
--   An address is always shown beside its nickname, so a nickname that itself
--   reads like an address would put two addresses side by side: refused.
--   "You" and "Someone" are what the screens call the reader and the unknown.
--   Characters that hide or reorder text are refused.
create function private.nickname_problem(p_text text) returns text
language sql immutable security definer set search_path = ''
as $$
	select case
		when p_text is null or char_length(p_text) = 0 then 'A nickname cannot be empty.'
		when p_text ~ '[[:cntrl:]]' or p_text ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
			then 'A nickname cannot contain invisible or direction-changing characters.'
		when p_text ~* '0x[0-9a-f]' then 'A nickname cannot look like an address.'
		when char_length(p_text) > 40 then 'A nickname can be at most 40 characters.'
		when lower(p_text) in ('you', 'someone') then 'That word is used by the screens themselves.'
		else null end
$$;

-- --------------------------------------------------------------------- tables

create table public.nicknames (
	network public.network not null,
	treasury public.address not null,
	-- the address being named: a signer, a destination, an API wallet, or the treasury itself
	address public.address not null,
	name text not null check (private.nickname_problem(name) is null and name = private.nickname_text(name)),
	name_key text not null,
	set_by public.address not null,
	set_at timestamptz not null default now(),
	primary key (network, treasury, address),
	check (name_key = lower(name)),
	foreign key (network, treasury) references public.treasuries (network, address)
);
-- One name, one address, inside a treasury. An index, not a check in a
-- trigger: two signers choosing the same name at the same moment must not
-- both succeed.
create unique index nicknames_one_address_per_name on public.nicknames (network, treasury, name_key);

alter table public.nicknames enable row level security;
create policy "signers read their treasuries' nicknames" on public.nicknames
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

-- Every change asked for and applied. `name` null takes the nickname away.
create table public.nickname_changes (
	id uuid primary key default gen_random_uuid(),
	network public.network not null,
	treasury public.address not null,
	address public.address not null,
	name text,
	changed_by public.address not null,
	changed_at timestamptz not null default now(),
	foreign key (network, treasury) references public.treasuries (network, address)
);
create index nickname_changes_by_treasury on public.nickname_changes (network, treasury, changed_at);
create index nickname_changes_by_wallet on public.nickname_changes (changed_by, changed_at);

alter table public.nickname_changes enable row level security;
create policy "signers read their treasuries' nickname changes" on public.nickname_changes
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));
create policy "a signer changes a nickname, as itself" on public.nickname_changes
	for insert to authenticated
	with check (
		changed_by = (select private.current_wallet())
		and private.is_signer(network, treasury)
	);

-- -------------------------------------------------------------------- changes

create function private.nickname_change_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	why text;
begin
	-- Everything but the four asked-for columns is ours to set.
	new.id := gen_random_uuid();
	new.changed_by := me;
	new.changed_at := now();
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;

	if new.name is not null then
		new.name := private.nickname_text(new.name);
		why := private.nickname_problem(new.name);
		if why is not null then
			raise exception 'relay.nickname_invalid' using detail = why;
		end if;
	end if;

	-- a signer's own address is theirs to name, or to leave unnamed
	if new.address <> me and exists (select 1 from public.treasury_signers s
			where s.network = new.network and s.treasury = new.treasury and s.signer = new.address) then
		raise exception 'relay.nickname_not_yours'
			using detail = 'Only that signer can choose the nickname of their own address.';
	end if;

	if (select count(*) from public.nickname_changes c
			where c.changed_by = me and c.changed_at > now() - interval '1 hour') >= 60 then
		raise exception 'relay.rate_limited'
			using detail = 'A wallet may change 60 nicknames an hour.';
	end if;
	return new;
end $$;

create function private.nickname_change_after() returns trigger
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

	-- every signer's open page reads the names again
	select array_agg(s.signer) into targets
	from public.treasury_signers s
	where s.network = new.network and s.treasury = new.treasury;
	perform private.ping_wallets(targets);
	return null;
end $$;

create trigger nickname_change_before before insert on public.nickname_changes
	for each row execute function private.nickname_change_before();
create trigger nickname_change_after after insert on public.nickname_changes
	for each row execute function private.nickname_change_after();

-- An address that becomes a signer owns its nickname from then on: one that
-- somebody else gave it is dropped, and the new signer may choose their own.
create function private.signer_added_nickname() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	delete from public.nicknames n
	where n.network = new.network and n.treasury = new.treasury
		and n.address = new.signer and n.set_by <> new.signer;
	return null;
end $$;

create trigger signer_added_nickname after insert on public.treasury_signers
	for each row execute function private.signer_added_nickname();

-- ---------------------------------------------------------------------- grants

revoke all on public.nicknames, public.nickname_changes from anon, authenticated, service_role;
grant select on public.nicknames, public.nickname_changes to authenticated;
grant insert (network, treasury, address, name) on public.nickname_changes to authenticated;

revoke execute on all functions in schema private from public;
