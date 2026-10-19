-- A wallet's markers get their ids in the order they are written.
--
-- The newest row per (wallet, treasury) is the marker, and "newest" is the
-- highest id (relay_attention). The row trigger takes a lock so that two
-- "Got it" from one wallet at the same moment (two tabs, two devices) are
-- written one after the other, each seeing the one before it. But a row has
-- its id before a row trigger runs. So the two writes could take that lock in
-- the other order than their ids: the one that went second, and so held the
-- true marker, could carry the lower id, and the marker read back was one
-- entry behind. A notice already read then showed once more. Seen in the
-- relay's integration test "takes two at once", once in four runs.
--
-- The turn is now taken per statement, before any of its rows has an id, and
-- per wallet: a wallet's markers are written one statement at a time, and
-- their ids follow that order. The row trigger keeps its own lock; within one
-- transaction it costs nothing.

create function private.read_mark_turn() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
	me public.address := private.current_wallet();
begin
	-- nobody signed in: the row's own checks and the policy refuse the write
	if me is not null then
		perform pg_advisory_xact_lock(hashtextextended('hl-tools.relay.marks:' || me::text, 0));
	end if;
	return null;
end $$;

create trigger read_mark_turn before insert on public.read_marks
	for each statement execute function private.read_mark_turn();

revoke execute on all functions in schema private from public;
