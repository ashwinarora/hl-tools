-- An account may register itself as a treasury.
--
-- Until now a multi-sig was stored only when one of its signers asked for it
-- (a row in treasury_requests, answered by the look-up worker). The wallet
-- that converts its own account into a multi-sig is not one of its signers,
-- so the treasury it had just made appeared in nobody's list until a signer
-- pasted its address.
--
-- The worker now also takes an "add" asked by the account itself. Nothing is
-- taken on trust: as before, the account is stored only after Hyperliquid has
-- answered with its signer set, and with exactly that set. Who may ask, the
-- limits on asking, the pings to the signers and every read rule are
-- unchanged: the account itself still reads nothing of its treasury but its
-- own request.
--
-- Two lines of private.apply_lookup() differ from relay_lookups.sql: who may
-- be the adder of an unknown account, and which pending requests an answer
-- settles as done.

create or replace function private.apply_lookup(
	p_network public.network,
	p_address public.address,
	p_outcome text,
	p_signers public.address[] default null,
	p_threshold int default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
	t public.treasuries;
	known boolean;
	adder public.address;
	added public.address[];
	removed public.address[];
	chk private.treasury_checks;
	result text;
begin
	select * into t from public.treasuries
	where network = p_network and address = p_address for update;
	known := found;

	if p_outcome = 'policy' then
		if not known then
			-- stored only if somebody who asked is really one of its signers, or is
			-- the account itself. A signer who asked is credited before the account.
			select r.requested_by into adder
			from public.treasury_requests r
			where r.network = p_network and r.address = p_address
				and r.kind = 'add' and r.status = 'pending'
				and (r.requested_by = any (p_signers) or r.requested_by = p_address)
			order by (r.requested_by = p_address), r.created_at, r.id
			limit 1;
			if adder is null then
				result := 'rejected';
			else
				insert into public.treasuries (network, address, threshold, added_by)
				values (p_network, p_address, p_threshold, adder);
				insert into public.treasury_signers (network, treasury, signer)
				select p_network, p_address, s from unnest(p_signers) s;
				perform private.log_event(p_network, p_address, null, 'treasury_added', adder,
					jsonb_build_object('signers', to_jsonb(p_signers), 'threshold', p_threshold));
				result := 'added';
			end if;
		else
			select coalesce(array_agg(s order by s), '{}') into added
			from unnest(p_signers) s
			where not exists (select 1 from public.treasury_signers ts
				where ts.network = p_network and ts.treasury = p_address and ts.signer = s);
			select coalesce(array_agg(ts.signer order by ts.signer), '{}') into removed
			from public.treasury_signers ts
			where ts.network = p_network and ts.treasury = p_address
				and ts.signer <> all (p_signers);

			delete from public.treasury_signers ts
			where ts.network = p_network and ts.treasury = p_address and ts.signer = any (removed);
			insert into public.treasury_signers (network, treasury, signer)
			select p_network, p_address, s from unnest(added) s;

			result := case
				when cardinality(added) > 0 or cardinality(removed) > 0 or t.threshold <> p_threshold then 'changed'
				when t.frozen_at is not null then 'unfrozen'
				else 'unchanged' end;

			update public.treasuries set
				threshold = p_threshold,
				frozen_at = null,
				checked_at = now(),
				changed_at = case when result = 'unchanged' then changed_at else now() end
			where network = p_network and address = p_address;

			if t.frozen_at is not null then
				perform private.log_event(p_network, p_address, null, 'treasury_unfrozen', null);
			end if;
			if result = 'changed' then
				perform private.log_event(p_network, p_address, null, 'signers_changed', null,
					jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed),
						'threshold_before', t.threshold, 'threshold_after', p_threshold));
			end if;
			delete from private.treasury_checks c where c.network = p_network and c.address = p_address;
		end if;

		update public.treasury_requests r set
			status = case when r.kind = 'check' or r.requested_by = any (p_signers) or r.requested_by = p_address then 'done' else 'rejected' end,
			reason = case when r.kind = 'check' or r.requested_by = any (p_signers) or r.requested_by = p_address then null else 'not_a_signer' end,
			finished_at = now()
		where r.network = p_network and r.address = p_address and r.status = 'pending';
		return result;
	end if;

	if p_outcome = 'none' then
		if known and t.frozen_at is null then
			select * into chk from private.treasury_checks c
			where c.network = p_network and c.address = p_address for update;
			if not found or chk.null_streak = 0 or chk.last_null_at is null then
				insert into private.treasury_checks as c (network, address, null_streak, last_null_at)
				values (p_network, p_address, 1, now())
				on conflict (network, address) do update set null_streak = 1, last_null_at = now();
				return 'recheck';
			end if;
			if chk.last_null_at > now() - interval '30 seconds' then
				return 'recheck'; -- too soon after the first to count as a second
			end if;
			update private.treasury_checks c set null_streak = c.null_streak + 1, last_null_at = now()
			where c.network = p_network and c.address = p_address;
			update public.treasuries set frozen_at = now(), checked_at = now(), changed_at = now()
			where network = p_network and address = p_address;
			perform private.log_event(p_network, p_address, null, 'treasury_frozen', null);
			result := 'frozen';
		elsif known then
			update public.treasuries set checked_at = now()
			where network = p_network and address = p_address;
			result := 'unchanged';
		else
			result := 'rejected';
		end if;

		update public.treasury_requests r set
			status = case when r.kind = 'check' then 'done' else 'rejected' end,
			reason = case when r.kind = 'check' then null else 'not_multisig' end,
			finished_at = now()
		where r.network = p_network and r.address = p_address and r.status = 'pending';
		return result;
	end if;

	raise exception 'apply_lookup: unknown outcome %', p_outcome;
end $$;

revoke execute on all functions in schema private from public;
