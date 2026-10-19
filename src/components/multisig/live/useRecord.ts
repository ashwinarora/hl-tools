/**
 * Hyperliquid's record of proposals that read as accepted: each treasury's
 * newest transactions, read from the explorer in the reader's own browser
 * (the request "On Hyperliquid" makes, shared with it), and judged by
 * `model/chain/record.ts`. Read once per session; again only when a list was
 * read too soon after a submission to tell, and then at most once a minute.
 */
import type { Network } from "@hl-tools/core";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
	type OnRecord,
	onRecord,
	type RecordList,
	type RecordQuestion,
	recordRereadDue,
} from "../model/chain/record";
import { useNow } from "../shell/live";
import { listQuery } from "./explorerList";

/** What a screen shows for one proposal, and how to ask once more. */
export type RecordView = OnRecord & { readonly retry: () => void };

/** One question per key (a digest); the answers are keyed the same way. */
export function useRecords(
	network: Network,
	questions: ReadonlyMap<string, RecordQuestion>,
): ReadonlyMap<string, RecordView> {
	const accounts = useMemo(
		() => [
			...new Set([...questions.values()].map((q) => q.account.toLowerCase())),
		],
		[questions],
	);
	const lists = useQueries({
		queries: accounts.map((account) => listQuery(network, account)),
	});
	// "just sent" turns into an answer as time passes
	const now = useNow(15_000);
	const states = useMemo(() => {
		const out = new Map<string, RecordList>();
		accounts.forEach((account, i) => {
			const q = lists[i];
			out.set(
				account,
				q?.data
					? { state: "read", txs: q.data, readAt: q.dataUpdatedAt }
					: q?.isError
						? { state: "failed" }
						: { state: "reading" },
			);
		});
		return out;
	}, [accounts, lists]);

	// read again what was read too soon after a submission to tell
	useEffect(() => {
		accounts.forEach((account, i) => {
			const q = lists[i];
			const list = states.get(account);
			if (!q || !list || q.isFetching) return;
			const lastTry = Math.max(q.dataUpdatedAt, q.errorUpdatedAt);
			const due = [...questions.values()].some(
				(question) =>
					question.account.toLowerCase() === account &&
					recordRereadDue(question, list, now, lastTry),
			);
			if (due) void q.refetch();
		});
	}, [accounts, lists, states, questions, now]);

	return useMemo(() => {
		const out = new Map<string, RecordView>();
		for (const [key, question] of questions) {
			const account = question.account.toLowerCase();
			const i = accounts.indexOf(account);
			const list = states.get(account) ?? { state: "reading" };
			out.set(key, {
				...onRecord(question, list, now),
				retry: () => void lists[i]?.refetch(),
			});
		}
		return out;
	}, [questions, accounts, states, lists, now]);
}

/** The same for a single proposal; null asks for nothing. */
export function useRecord(
	network: Network,
	question: RecordQuestion | null,
): RecordView | null {
	const questions = useMemo(
		() =>
			question
				? new Map([["one", question]])
				: new Map<string, RecordQuestion>(),
		[question],
	);
	return useRecords(network, questions).get("one") ?? null;
}
