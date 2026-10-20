-- The explorer's daily allowance is a refusal, never "not found".
--
-- Once a network address has asked the explorer for too much in a day, every
-- `txDetails` is answered with HTTP 200 and `{"type":"error","message":"More
-- than 100 archived blocks queried in one day"}`, a transaction seconds old
-- included (measured on testnet 2026-10-12 and 13; the browser's rule is
-- `ExplorerAllowanceError` in the core's adapter/explorer.ts, which matches the
-- same words). The relay read that as "no such transaction", so five of them
-- closed a true report as `failed: not_found` (audit F-059).
--
-- It is now an answer of its own, `allowance`. It says nothing about the
-- transaction, so it is not counted as an attempt: the report waits ten
-- minutes, as the browser rests ten minutes after the same refusal, and is
-- asked again. It is not "slow down" (HTTP 429), which leaves the whole
-- network alone for a minute: signer look-ups go to Hyperliquid's info
-- server, not to the explorer, and keep going. A report that has waited a
-- whole day gives up as `failed: lookup_failed`, so none waits for ever.

-- Reads one answer of the explorer's `txDetails`. Never raises:
--   tx            a transaction: who it acted for, the action as signed, the
--                 chain's error if it was rejected, its time and its hash
--   unknown       a well-formed "no such transaction" (HTTP 200, type "error")
--   allowance     the day's allowance is spent (HTTP 200, type "error", its
--                 message says "queried in one day")
--   rate_limited  HTTP 429
--   error         anything else. Written as one conjunction that has to come
--                 out true, so a missing field is an error and never a pass.
create or replace function private.parse_tx(p_status int, p_content text)
returns table (outcome text, tx_user text, tx_action jsonb, tx_error text, tx_time bigint, tx_hash text, http_status int)
language plpgsql immutable security definer set search_path = ''
as $$
declare
	body jsonb;
	tx jsonb;
	ok boolean;
begin
	if p_status = 429 then
		return query select 'rate_limited'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 429;
		return;
	end if;
	if p_status is distinct from 200 then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, p_status;
		return;
	end if;

	begin
		body := p_content::jsonb;
		if jsonb_typeof(body) = 'object' and body -> 'type' = '"error"'::jsonb then
			-- the day's allowance is spent: a refusal, never "no such transaction"
			if body ->> 'message' ~* 'queried in one day' then
				return query select 'allowance'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 200;
				return;
			end if;
			return query select 'unknown'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 200;
			return;
		end if;
		tx := body -> 'tx';
		ok := jsonb_typeof(body) = 'object'
			and body -> 'type' = '"txDetails"'::jsonb
			and jsonb_typeof(tx) = 'object'
			and jsonb_typeof(tx -> 'user') = 'string'
			and lower(tx ->> 'user') ~ '^0x[0-9a-f]{40}$'
			and jsonb_typeof(tx -> 'action') = 'object'
			and jsonb_typeof(tx -> 'hash') = 'string'
			and lower(tx ->> 'hash') ~ '^0x[0-9a-f]{64}$'
			and jsonb_typeof(tx -> 'time') = 'number'
			-- `error` must be there and say one of two things: null, or why it failed
			and tx ? 'error'
			and jsonb_typeof(tx -> 'error') in ('null', 'string');
	exception when others then
		ok := false;
	end;
	if ok is not true then
		return query select 'error'::text, null::text, null::jsonb, null::text, null::bigint, null::text, 200;
		return;
	end if;

	return query select 'tx'::text, lower(tx ->> 'user'), tx -> 'action', tx ->> 'error',
		(tx ->> 'time')::numeric::bigint, lower(tx ->> 'hash'), 200;
end $$;

-- What a report becomes for each answer, as before, and for `allowance`:
--   report_resting  the explorer refused for the day; asked again in ten
--                   minutes, nothing counted
create or replace function private.apply_report(
	p_id uuid,
	p_outcome text,
	p_user text default null,
	p_action jsonb default null,
	p_error text default null,
	p_time bigint default null,
	p_hash text default null
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
	rep public.execution_reports;
	p public.proposals;
	why text;
	give_up_after int;
begin
	select * into rep from public.execution_reports where id = p_id for update;
	if not found or rep.status <> 'pending' then
		return 'report_gone';
	end if;
	select * into p from public.proposals
	where network = rep.network and treasury = rep.treasury and digest = rep.digest
	for update;

	-- closed while the report waited: the finaliser's own result, or another report
	if p.status = 'accepted' then
		why := 'accepted';
	elsif p.status = 'carried_out' then
		why := 'closed';
	elsif not private.has_own_number(p) then
		why := 'unnumbered';
	elsif p_outcome = 'allowance' then
		-- the explorer said nothing about the transaction: not an attempt. A
		-- report that has waited through a whole day of refusals gives up as a
		-- look-up that failed, and may be filed again.
		if rep.created_at < now() - interval '1 day' then
			update public.execution_reports set
				status = 'failed', reason = 'lookup_failed', finished_at = now()
			where id = rep.id;
			return 'report_failed';
		end if;
		update public.execution_reports set not_before = now() + interval '10 minutes'
		where id = rep.id;
		return 'report_resting';
	elsif p_outcome in ('unknown', 'error') then
		-- "not known yet" a few times is normal right after a transaction; a
		-- call that fails is tried a little longer
		give_up_after := case p_outcome when 'unknown' then 5 else 6 end;
		if rep.attempts + 1 >= give_up_after then
			update public.execution_reports set
				status = 'failed',
				reason = case p_outcome when 'unknown' then 'not_found' else 'lookup_failed' end,
				attempts = rep.attempts + 1,
				finished_at = now()
			where id = rep.id;
			return 'report_failed';
		end if;
		update public.execution_reports set
			attempts = rep.attempts + 1,
			not_before = now() + least(interval '15 seconds' * power(2, rep.attempts), interval '10 minutes')
		where id = rep.id;
		return 'report_retry';
	elsif p_outcome <> 'tx' then
		raise exception 'apply_report: unknown outcome %', p_outcome;
	elsif p_hash is distinct from rep.tx_hash::text or p_user is distinct from rep.treasury::text then
		why := 'other_account';
	elsif p_error is not null then
		why := 'tx_failed';
	elsif p_action is null or p_action <> p.document::jsonb #> '{payload,action}' then
		why := 'other_action';
	elsif private.has_twin(p) then
		why := 'ambiguous';
	end if;

	if why is not null then
		update public.execution_reports set status = 'rejected', reason = why, finished_at = now()
		where id = rep.id;
		return 'report_rejected';
	end if;

	-- from open (expired or not), withdrawn or declined: what happened on chain wins
	update public.proposals set status = 'carried_out', closed_at = now()
	where network = p.network and treasury = p.treasury and digest = p.digest;
	update public.execution_reports set status = 'confirmed', finished_at = now()
	where id = rep.id;
	-- queue first, write history second (see receipt_after)
	if p_action ->> 'type' = 'convertToMultiSigUser' then
		perform private.enqueue(p.network, p.treasury, 0, 'refresh');
	end if;
	-- no actor: who sent it is exactly what nobody here knows
	perform private.log_event(p.network, p.treasury, p.digest, 'proposal_carried_out', null,
		jsonb_build_object('tx_hash', rep.tx_hash, 'tx_time', p_time, 'reported_by', rep.reported_by));
	return 'report_confirmed';
end $$;

revoke execute on all functions in schema private from public;
