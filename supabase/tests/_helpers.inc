-- Shared by every test file through \ir, inside that file's transaction, so
-- nothing here outlives a test run. Tests run against the live local database,
-- which may hold real sign-ins: every address and user id below is synthetic.
create extension if not exists pgtap with schema extensions;

create schema tests;
grant usage on schema tests to anon, authenticated;

-- 0x7e57…000n: no key is known for these, so no real identity can collide.
create function tests.addr(n int) returns public.address
language sql immutable as $$
	select ('0x7e57' || repeat('0', 32) || lpad(to_hex(n), 4, '0'))::public.address
$$;

create function tests.user_id(n int) returns uuid
language sql immutable as $$
	select ('7e570000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
$$;

-- A user as Supabase Auth leaves it after a wallet sign-in. `p_written` is the
-- address as the signed message spelled it (Auth keeps that spelling).
create function tests.make_wallet(n int, p_written text default null) returns public.address
language plpgsql as $$
declare
	a text := coalesce(p_written, tests.addr(n)::text);
begin
	insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
	values (tests.user_id(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
		'{"provider":"web3","providers":["web3"]}',
		jsonb_build_object('sub', 'web3:ethereum:' || a, 'custom_claims', jsonb_build_object('address', a, 'chain', 'ethereum')),
		now(), now());
	insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
	values ('web3:ethereum:' || a, tests.user_id(n),
		jsonb_build_object('sub', 'web3:ethereum:' || a), 'web3', now(), now());
	return lower(a)::public.address;
end $$;

-- The claims PostgREST would set for wallet n's session. Pair it with
-- `set local role authenticated`.
create function tests.claims(n int, p_extra jsonb default '{}') returns void
language sql as $$
	select set_config('request.jwt.claims',
		(jsonb_build_object('sub', tests.user_id(n), 'role', 'authenticated') || p_extra)::text, true)
$$;

create function tests.no_claims() returns void
language sql as $$
	select set_config('request.jwt.claims', '', true)
$$;

-- A treasury as the lookup worker would have stored it.
create function tests.seed_treasury(
	p_network public.network, n int, p_threshold int, p_signers int[], p_added_by int default null
) returns public.address
language plpgsql as $$
declare
	s int;
begin
	insert into public.treasuries (network, address, threshold, added_by)
	values (p_network, tests.addr(n), p_threshold, tests.addr(coalesce(p_added_by, p_signers[1])));
	foreach s in array p_signers loop
		insert into public.treasury_signers (network, treasury, signer)
		values (p_network, tests.addr(n), tests.addr(s));
	end loop;
	return tests.addr(n);
end $$;
