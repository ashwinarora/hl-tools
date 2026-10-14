/**
 * Tells the relay that the signed-in signer has opened a proposal, once.
 * Whether this page may say so is decided by `shouldRecordView`; this hook
 * supplies the one thing only a browser knows, whether somebody is looking:
 * the tab has been in front for a moment, not flicked past and not loaded in
 * the background.
 */
import { useEffect, useRef, useState } from "react";
import { shouldRecordView, type ViewRow } from "../model/relay/views";
import { type ProposalKey, recordView } from "../relay/api";
import { useRelay } from "../relay/useRelay";

/** How long the tab has to stay in front before a look counts. */
export const LOOK_MS = 1_000;

/** True once the tab has been in front for `dwellMs` without a break. */
export function useLooking(dwellMs = LOOK_MS): boolean {
	const [looking, setLooking] = useState(false);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | null = null;
		const check = () => {
			if (timer) clearTimeout(timer);
			timer = null;
			if (document.visibilityState === "visible") {
				timer = setTimeout(() => setLooking(true), dwellMs);
			} else {
				setLooking(false);
			}
		};
		check();
		document.addEventListener("visibilitychange", check);
		return () => {
			if (timer) clearTimeout(timer);
			document.removeEventListener("visibilitychange", check);
		};
	}, [dwellMs]);
	return looking;
}

export function useViewRecorder(i: {
	readonly network: ProposalKey["network"];
	readonly treasury: ProposalKey["treasury"];
	readonly digest: ProposalKey["digest"];
	/** The relay has the proposal and its copy verified here. */
	readonly known: boolean;
	/** Open on the relay and inside its signing window. */
	readonly open: boolean;
	/** The relay lists the signed-in wallet as a signer of the treasury. */
	readonly signer: boolean;
	readonly views: readonly ViewRow[] | null;
	readonly proposer: ProposalKey["treasury"] | null;
}): void {
	const relay = useRelay();
	const client = relay.client;
	// set only while the connected wallet is the one signed in
	const me = relay.wallet;
	const looking = useLooking();
	const due = shouldRecordView({
		visible: looking,
		known: i.known,
		open: i.open,
		me,
		signer: i.signer,
		views: i.views,
		proposer: i.proposer,
	});
	const sent = useRef<string | null>(null);
	const { network, treasury, digest } = i;
	useEffect(() => {
		if (!due || !client || !me) return;
		const id = `${me}:${network}:${treasury}:${digest}`;
		if (sent.current === id) return;
		sent.current = id;
		// the relay pings every signer about a first view, this wallet included,
		// and that ping re-reads the proposal
		void recordView(client, me, { network, treasury, digest }).then((r) => {
			// not the reader's problem: the next change on the page tries again
			if (r.issue) sent.current = null;
		});
	}, [due, client, me, network, treasury, digest]);
}
