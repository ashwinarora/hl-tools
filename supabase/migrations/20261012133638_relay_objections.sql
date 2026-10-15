-- Any signer can say no.
--
-- Until now a signer who was against a proposal could say so only by being
-- its proposer (withdraw) or its finaliser (decline). Everybody else could
-- only not sign. A no is now something every signer can record, and it is
-- what its name says: an objection the others see, not a cancellation. The
-- proposal stays open, the threshold decides, and a signature already given
-- stays valid on chain until the window closes, exactly as before.
--
-- A signer has one position on a proposal at a time: nothing yet, a
-- signature, or a no. Saying no takes the signer's own signature back here;
-- signing takes the no back. Positions can be changed for as long as the
-- proposal is open, and every change is an entry in the history.
--
-- The finaliser's "decline" is retired with this: it was one signer closing a
-- proposal for everybody, for good. A finaliser says no like any other signer
-- now. Only the proposer's withdrawal still ends a proposal. Proposals
-- declined before stay as they are.
--
-- No text is stored: a no is a row saying who, to what, and when.

-- ---------------------------------------------------------------------- history

alter table public.events drop constraint events_kind_check;
alter table public.events add constraint events_kind_check check (kind in (
	'treasury_added', 'signers_changed', 'treasury_frozen', 'treasury_unfrozen',
	'proposal_created', 'signature_added', 'signature_removed',
	'proposal_withdrawn', 'proposal_declined', 'submission_recorded',
	'proposal_carried_out', 'objection_added', 'objection_removed'));
-- the hourly limit below counts a wallet's own
create index events_objections_by_actor on public.events (actor, at) where kind = 'objection_added';

-- The page no longer calls this "outside this tool": a proposal submitted
-- from the page while signed out is closed the same way.
create or replace function private.status_words(p_status text) returns text
language sql immutable security definer set search_path = ''
as $$
	select case p_status when 'carried_out' then 'carried out without being reported here' else p_status end
$$;

-- ------------------------------------------------------------------- objections

-- One per signer per proposal. Like a signature it is a claim by its own
-- signer, inserted and deleted by that signer alone.
create table public.objections (
	network public.network not null,
	treasury public.address not null,
	digest public.hash32 not null,
	signer public.address not null,
	created_at timestamptz not null default now(),
	primary key (network, treasury, digest, signer),
	foreign key (network, treasury, digest)
		references public.proposals (network, treasury, digest) on delete cascade
);

alter table public.objections enable row level security;

create policy "signers read their treasuries' objections" on public.objections
	for select to authenticated
	using ((network, treasury) in (select m.network, m.treasury from private.my_treasuries() m));

create policy "a current signer says no, as itself" on public.objections
	for insert to authenticated
	with check (
		signer = (select private.current_wallet())
		and private.is_signer(network, treasury, true)
	);

create policy "a signer takes back its own no" on public.objections
	for delete to authenticated
	using (
		signer = (select private.current_wallet())
		and (network, treasury) in (select m.network, m.treasury from private.my_treasuries() m)
	);

create function private.objection_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
begin
	if tg_op = 'INSERT' then
		new.signer := me;
		new.created_at := now();
		-- a stranger learns nothing here: the policy refuses the row
		if me is not null and private.is_signer(new.network, new.treasury) then
			if not private.is_signer(new.network, new.treasury, true) then
				raise exception 'relay.treasury_frozen'
					using detail = 'This account is no longer a multi-sig, so there is nothing left to say no to.';
			end if;
			perform private.require_open(new.network, new.treasury, new.digest);
			-- A no costs no wallet prompt, and each one writes a history entry
			-- and pings the co-signers.
			if (select count(*) from public.events e
					where e.kind = 'objection_added' and e.actor = me
						and e.at > now() - interval '1 hour') >= 30 then
				raise exception 'relay.rate_limited'
					using detail = 'A wallet may say no 30 times an hour.';
			end if;
			-- one position at a time: saying no takes one's own signature back
			delete from public.signatures s
			where s.network = new.network and s.treasury = new.treasury
				and s.digest = new.digest and s.signer = me;
		end if;
		return new;
	end if;
	-- DELETE: once a proposal is closed or has lapsed, positions stay as they were
	perform private.require_open(old.network, old.treasury, old.digest);
	return old;
end $$;

create function private.objection_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform private.log_event(new.network, new.treasury, new.digest, 'objection_added', new.signer);
	else
		-- not when the whole proposal is being removed by an operator
		if exists (select 1 from public.proposals p
				where p.network = old.network and p.treasury = old.treasury and p.digest = old.digest) then
			perform private.log_event(old.network, old.treasury, old.digest, 'objection_removed', old.signer);
		end if;
	end if;
	return null;
end $$;

create trigger objection_before before insert or delete on public.objections
	for each row execute function private.objection_before();
create trigger objection_after after insert or delete on public.objections
	for each row execute function private.objection_after();

-- As in relay_proposals.sql, with one line more: signing takes one's own no back.
create or replace function private.signature_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
begin
	if tg_op = 'INSERT' then
		new.signer := me;
		new.created_at := now();
		if me is not null and private.is_signer(new.network, new.treasury) then
			if not private.is_signer(new.network, new.treasury, true) then
				raise exception 'relay.treasury_frozen'
					using detail = 'This account is no longer a multi-sig, so nothing new can be signed for it.';
			end if;
			perform private.require_open(new.network, new.treasury, new.digest);
			delete from public.objections o
			where o.network = new.network and o.treasury = new.treasury
				and o.digest = new.digest and o.signer = me;
		end if;
		return new;
	end if;
	-- DELETE: after submission or expiry a signature can no longer be taken back
	perform private.require_open(old.network, old.treasury, old.digest);
	return old;
end $$;

-- ---------------------------------------------------------------------- endings

-- As in relay_proposals.sql, except that a decline is no longer taken.
create or replace function private.ending_before() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
	p public.proposals;
begin
	new.ended_by := me;
	new.ended_at := now();
	if me is null or not private.is_signer(new.network, new.treasury) then
		return new; -- the policy refuses it
	end if;
	if new.kind = 'declined' then
		raise exception 'relay.decline_retired'
			using detail = 'A finaliser says no like any other signer now. Only its proposer ends a proposal, by withdrawing it.';
	end if;
	p := private.require_open(new.network, new.treasury, new.digest);
	if p.digest is null then
		return new; -- the foreign key refuses it
	end if;
	if p.created_by <> me then
		raise exception 'relay.not_proposer'
			using detail = 'Only the wallet that proposed it can withdraw a proposal.';
	end if;
	return new;
end $$;

-- ---------------------------------------------------------------------- grants

revoke all on public.objections from anon, authenticated, service_role;
grant select on public.objections to authenticated;
grant insert (network, treasury, digest) on public.objections to authenticated;
grant delete on public.objections to authenticated;

revoke execute on all functions in schema private from public;
