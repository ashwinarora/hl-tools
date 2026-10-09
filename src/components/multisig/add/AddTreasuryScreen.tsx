import type { Address, Issue } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Field, TextInput } from "#/components/hub/layout";
import { Callout } from "#/components/hub/status";
import {
	type AccountTarget,
	ADDRESS_RE,
} from "#/components/tools/multisig/model";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";
import { RELAY_COPY } from "../model/relay/copy";
import { shortAddress } from "../model/stage";
import { requestTreasury } from "../relay/api";
import { useRequest, useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Btn, Card, linkButtonSm } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { SignInGate } from "../shell/SignInGate";
import { useMounted } from "../shell/WalletBox";
import { useTreasuryState } from "../useTreasuryState";

const REASONS: Record<string, string> = {
	not_a_signer:
		"The relay looked the account up and your wallet is not one of its signers.",
	not_multisig: "The relay looked the account up and it is not a multi-sig.",
	lookup_failed:
		"The relay could not reach Hyperliquid for this lookup. Try again in a minute.",
};

/**
 * Add a treasury: paste its address once. The browser reads the signer list
 * from Hyperliquid first, so you see what you are adding; the relay then
 * looks it up itself and stores it only if your wallet really is a signer.
 * From then on every co-signer who signs in sees it without doing anything.
 */
export function AddTreasuryScreen() {
	const relay = useRelay();
	const network = useNetwork();
	const hydrated = useNetworkHydrated();
	const mounted = useMounted();
	const ready = mounted && hydrated;
	const navigate = useNavigate();
	const queries = useQueryClient();
	const { rows } = useTreasuries();

	const [input, setInput] = useState("");
	const [checked, setChecked] = useState<AccountTarget | null>(null);
	const [requestId, setRequestId] = useState<string | null>(null);
	const [issue, setIssue] = useState<Issue | null>(null);
	const [sending, setSending] = useState(false);
	const [askedAt, setAskedAt] = useState<number | null>(null);
	const [slow, setSlow] = useState(false);

	const state = useTreasuryState(checked);
	const { request } = useRequest(requestId);
	const value = input.trim().toLowerCase();
	const valid = ADDRESS_RE.test(value);
	// a lookup belongs to the network it was made on
	const current =
		checked && checked.network === network && checked.address === value
			? checked
			: null;
	const me = relay.wallet;
	const signers = current && state.policy ? state.policy.authorizedUsers : [];
	const isSigner = !!me && signers.includes(me);
	const known = current
		? rows.find(
				(t) => t.network === current.network && t.address === current.address,
			)
		: undefined;
	const who = (a: Address) => (a === me ? "you" : shortAddress(a));

	// the worker answered
	useEffect(() => {
		if (!request || !current) return;
		if (request.status === "done") {
			void queries.invalidateQueries({ queryKey: ["relay", me, "treasuries"] });
			void navigate({
				to: "/multisig/t/$network/$address",
				params: { network: request.network, address: request.address },
				search: { tab: "signers" },
			});
		}
	}, [request, current, queries, me, navigate]);

	// "queued" after ten seconds without an answer
	useEffect(() => {
		if (askedAt === null || request?.status !== "pending") {
			setSlow(false);
			return;
		}
		const t = setTimeout(
			() => setSlow(true),
			Math.max(0, askedAt + 10_000 - Date.now()),
		);
		return () => clearTimeout(t);
	}, [askedAt, request?.status]);

	const add = async () => {
		if (!relay.client || !me || !current) return;
		setSending(true);
		setIssue(null);
		const r = await requestTreasury(
			relay.client,
			me,
			current.network,
			current.address as Address,
			"add",
		);
		setSending(false);
		if (!r.data) {
			setIssue(r.issue);
			return;
		}
		queries.setQueryData(["relay", me, "request", r.data.id], r.data);
		setAskedAt(Date.now());
		setRequestId(r.data.id);
	};

	const waiting = sending || request?.status === "pending";

	return (
		<ShellPage title="Add a treasury" meta={<span>{RELAY_COPY.addMeta}</span>}>
			{relay.mode !== "on" ? (
				<SignInGate what="and add your treasuries" />
			) : (
				<Card className="max-w-[640px]">
					<form
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (!valid || !ready) return;
							setInput(value);
							setRequestId(null);
							setIssue(null);
							setChecked({ address: value as Address, network });
						}}
					>
						<Field
							label={`Multi-sig account address on ${ready ? network : "…"}`}
							htmlFor="ms-add"
							error={
								input.trim() && !valid
									? "A 20-byte hex address: 0x followed by 40 hex digits."
									: undefined
							}
						>
							<TextInput
								id="ms-add"
								mono
								value={input}
								onChange={(e) => setInput(e.target.value)}
								placeholder="0x…"
								aria-invalid={!!input.trim() && !valid}
							/>
						</Field>
						<div className="flex flex-wrap items-center gap-2">
							<Btn type="submit" variant="brand" disabled={!valid || !ready}>
								Check on {ready ? network : "…"}
							</Btn>
						</div>

						{current && state.loading && (
							<Callout
								tone="neutral"
								title="Reading the signer list from Hyperliquid…"
							/>
						)}
						{current && state.error && (
							<Callout
								tone="danger"
								title="Could not read the signer list"
								action={
									<Btn
										size="sm"
										variant="outline"
										type="button"
										onClick={state.refetch}
									>
										Try again
									</Btn>
								}
							>
								{state.error}
							</Callout>
						)}
						{current && state.isMultiSig === false && (
							<Callout
								tone="warning"
								title={`This account is not a multi-sig on ${current.network}`}
							>
								Only a native multi-sig account can be added. Check the address
								and the network selected in the header.
							</Callout>
						)}
						{current && state.isMultiSig && state.policy && known && (
							<Callout
								tone="info"
								title="This treasury is already in your list"
								action={
									<Link
										to="/multisig/t/$network/$address"
										params={{ network: known.network, address: known.address }}
										className={linkButtonSm}
									>
										Open it
									</Link>
								}
							/>
						)}
						{current &&
							state.isMultiSig &&
							state.policy &&
							!known &&
							!isSigner && (
								<Callout
									tone="warning"
									title="This account is a multi-sig, but your wallet is not one of its signers"
								>
									Only a signer can add a treasury. Ask a signer to add it, or
									switch wallets.
								</Callout>
							)}
						{current &&
							state.isMultiSig &&
							state.policy &&
							!known &&
							isSigner && (
								<Callout
									tone="success"
									title={`${state.policy.threshold} of ${signers.length} multi-sig · you are one of its signers`}
									action={
										<Btn
											size="sm"
											variant="brand"
											type="button"
											disabled={waiting}
											onClick={() => void add()}
										>
											{waiting ? "Adding…" : "Add to my treasuries"}
										</Btn>
									}
								>
									Signers: {signers.map(who).join(", ")}.{" "}
									{state.agents && state.agents.length > 0
										? `${state.agents.length} API wallet${state.agents.length === 1 ? "" : "s"} approved.`
										: state.agents
											? "No API wallets approved."
											: ""}
								</Callout>
							)}

						{request?.status === "pending" && slow && (
							<Callout tone="neutral" title="Queued behind other lookups">
								The relay looks accounts up one at a time. This page moves on by
								itself when yours is done.
							</Callout>
						)}
						{request &&
							(request.status === "rejected" ||
								request.status === "failed") && (
								<Callout
									tone={request.status === "failed" ? "warning" : "danger"}
									title="The treasury was not added"
								>
									{REASONS[request.reason ?? ""] ??
										"The relay refused the request."}
								</Callout>
							)}
						{issue && (
							<Callout
								tone={issue.severity === "error" ? "danger" : "warning"}
								title={issue.message}
							>
								{issue.fix}
							</Callout>
						)}
					</form>
				</Card>
			)}
		</ShellPage>
	);
}
