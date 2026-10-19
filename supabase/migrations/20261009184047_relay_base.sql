-- Wallet identity and the treasury registry.
--
-- The relay knows people only as wallet addresses (Sign in with Ethereum). A
-- treasury is a native Hyperliquid multi-sig account; the relay keeps a copy of
-- its signer list and threshold, written only by the lookup worker, and every
-- access rule in this project reduces to "is this wallet in that copy".
--
-- The relay stores and gates; it never decides whether a signature counts.
-- Browsers verify every signature themselves and judge readiness against the
-- live chain, so a stale or wrong copy here can hide or delay, never forge.

-- ------------------------------------------------------------------ privileges

-- Supabase's defaults grant everything on new objects in `public` to the API
-- roles. Nothing in this project is granted implicitly: each table and
-- function gets exactly what its access rule needs, further down.
alter default privileges for role postgres in schema public
	revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
	revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
	revoke all on sequences from anon, authenticated, service_role;

-- Helpers, queues and the worker live here. The schema is not exposed through
-- the Data API; `authenticated` may enter it only to run the policy helpers.
create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ----------------------------------------------------------------------- types

create type public.network as enum ('mainnet', 'testnet');

-- Addresses and hashes are lowercase everywhere, as the chain reports them.
create domain public.address as text check (value ~ '^0x[0-9a-f]{40}$');
create domain public.hash32 as text check (value ~ '^0x[0-9a-f]{64}$');

-- -------------------------------------------------------------------- identity

-- The wallet a user signed in with, read from the identity Supabase Auth wrote
-- after verifying the signature. Never from the JWT: the token repeats the
-- address under user_metadata, which the user can edit. Auth keeps the address
-- as it was written in the signed message, so the same wallet may own two
-- users (checksummed and lowercase); both resolve to one lowercase address.
-- A user with any other identity attached resolves to nothing.
create function private.wallet_of(p_user uuid) returns public.address
language sql stable security definer set search_path = ''
as $$
	select case when x.a ~ '^0x[0-9a-f]{40}$' then x.a::public.address end
	from (
		select lower(split_part(i.provider_id, ':', 3)) as a
		from auth.identities i
		where i.user_id = p_user
			and i.provider = 'web3'
			and i.provider_id like 'web3:ethereum:%'
			and (select count(*) from auth.identities j where j.user_id = p_user) = 1
	) x
$$;

create function private.current_wallet() returns public.address
language sql stable security definer set search_path = ''
as $$
	select private.wallet_of((select auth.uid()))
$$;

-- Lets a client confirm which wallet its session speaks for.
create function public.whoami() returns public.address
language sql stable security invoker set search_path = ''
as $$
	select private.current_wallet()
$$;

-- ------------------------------------------------------------------ treasuries

-- One row per multi-sig account somebody has added. `threshold` and the rows
-- of treasury_signers are the last answer of `userToMultiSigSigners`.
create table public.treasuries (
	network public.network not null,
	address public.address not null,
	threshold smallint not null check (threshold between 1 and 10),
	-- Set when the account stopped being a multi-sig. Its last known signers
	-- keep reading the history; nothing new can be proposed.
	frozen_at timestamptz,
	checked_at timestamptz not null default now(),
	changed_at timestamptz not null default now(),
	added_by public.address not null,
	created_at timestamptz not null default now(),
	primary key (network, address)
);

create table public.treasury_signers (
	network public.network not null,
	treasury public.address not null,
	signer public.address not null,
	primary key (network, treasury, signer),
	foreign key (network, treasury)
		references public.treasuries (network, address) on delete cascade
);
create index treasury_signers_by_signer
	on public.treasury_signers (signer, network, treasury);

-- The treasuries the current wallet is a signer of, per the stored copy.
create function private.my_treasuries()
returns table (network public.network, treasury public.address)
language sql stable security definer set search_path = ''
as $$
	select s.network, s.treasury
	from public.treasury_signers s
	where s.signer = (select private.current_wallet())
$$;

-- Per-row form for WITH CHECK. `p_active` also requires the treasury not to
-- be frozen.
create function private.is_signer(
	p_network public.network,
	p_treasury public.address,
	p_active boolean default false
) returns boolean
language sql stable security definer set search_path = ''
as $$
	select exists (
		select 1
		from public.treasury_signers s
		join public.treasuries t
			on t.network = s.network and t.address = s.treasury
		where s.network = p_network
			and s.treasury = p_treasury
			and s.signer = (select private.current_wallet())
			and (not p_active or t.frozen_at is null)
	)
$$;

alter table public.treasuries enable row level security;
alter table public.treasury_signers enable row level security;

create policy "signers read their treasuries" on public.treasuries
	for select to authenticated
	using ((network, address) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "signers read their treasuries' signers" on public.treasury_signers
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

-- ---------------------------------------------------------------------- grants

revoke all on public.treasuries, public.treasury_signers from anon, authenticated, service_role;
grant select on public.treasuries, public.treasury_signers to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function
	private.current_wallet(),
	private.my_treasuries(),
	private.is_signer(public.network, public.address, boolean)
	to authenticated;

revoke execute on function public.whoami() from public, anon, service_role;
grant execute on function public.whoami() to authenticated;
