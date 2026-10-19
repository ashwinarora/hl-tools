import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { firstMark } from "../model/relay/away";
import { listEvents, markRead } from "../relay/api";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { marksQuery, useAway } from "./useAway";

/**
 * Keeps the signer's markers in order, silently, once per page:
 *
 *  - a treasury seen for the first time gets its first marker at the newest
 *    history entry, so "while you were away" starts from now and never
 *    replays what happened before the signer had this feature (or this
 *    treasury);
 *  - a marker that does not yet know the treasury's API wallets is given the
 *    list the first time it has been read, so that later changes can be told.
 *
 * Neither shows anything or asks Hyperliquid anything by itself.
 */
export function AwayKeeper() {
	const relay = useRelay();
	const client = relay.client;
	const me = relay.wallet;
	const queries = useQueryClient();
	const { rows } = useTreasuries();
	const marks = useQuery({
		...(client && me
			? marksQuery(client, me)
			: {
					queryKey: ["relay", me, "marks"] as const,
					queryFn: async () => new Map(),
				}),
		enabled: !!client && !!me,
		retry: 1,
	});
	const { baselines } = useAway("none");
	const started = useRef(new Set<string>());

	const known = marks.data;
	useEffect(() => {
		if (!client || !me || !known) return;
		// a treasury account reading its own treasury keeps no markers: it signs nothing
		const missing = rows.filter((t) => {
			const key = `${t.network}:${t.address}`;
			return (
				t.signers.includes(me) &&
				!known.has(key) &&
				!started.current.has(`${me}:first:${key}`)
			);
		});
		if (missing.length === 0) return;
		for (const t of missing)
			started.current.add(`${me}:first:${t.network}:${t.address}`);
		void (async () => {
			let wrote = false;
			// one by one: a treasury the relay refuses must not hold the others back
			for (const t of missing) {
				const newest = (
					await listEvents(client, t.network, t.address, { limit: 1 })
				).data?.rows[0];
				if (!newest) continue;
				const r = await markRead(client, me, [
					{
						network: t.network,
						treasury: t.address,
						...firstMark({ newestEventId: newest.id, now: Date.now() }),
					},
				]);
				wrote ||= !r.issue;
			}
			if (wrote) void queries.invalidateQueries({ queryKey: ["relay", me] });
		})();
	}, [client, me, known, rows, queries]);

	useEffect(() => {
		if (!client || !me) return;
		const due = baselines.filter(
			(b) => !started.current.has(`${me}:agents:${b.network}:${b.treasury}`),
		);
		if (due.length === 0) return;
		for (const b of due)
			started.current.add(`${me}:agents:${b.network}:${b.treasury}`);
		void markRead(client, me, due).then((r) => {
			if (!r.issue) void queries.invalidateQueries({ queryKey: ["relay", me] });
		});
	}, [client, me, baselines, queries]);

	return null;
}
