import {
	type Address,
	accountMode,
	infoClient,
	issue,
	type Network,
	type Policy,
	type SignerSet,
	signUserAction,
} from "@hl-tools/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Ban, Check, Loader2, TriangleAlert, X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CopyButton } from "#/components/hub/CopyButton";
import { TextInput } from "#/components/hub/layout";
import { Callout } from "#/components/hub/status";
import type { AccountTarget } from "#/components/tools/multisig/model";
import { modeQueryOptions } from "#/components/tools/multisig/policyQuery";
import { useAccount } from "#/components/tools/multisig/useAccount";
import { cn } from "#/lib/utils";
import { useNetwork, useNetworkHydrated } from "#/store/networkStore";
import { rememberSelfTreasury } from "../live/useSelfTreasury";
import { useSignerChecks } from "../live/useSignerChecks";
import {
	type ConvertOutcome,
	convertChain,
	runConvert,
} from "../model/convert";
import {
	type AccountFacts,
	accountLines,
	CREATE,
	outcomeText,
} from "../model/create";
import { modeLabel } from "../model/mode";
import { RELAY_COPY } from "../model/relay/copy";
import { registerStep } from "../model/relay/register";
import {
	addEntries,
	judgeSet,
	type Level,
	type Line,
	parsePasted,
	SIGNERS_MAX,
	type SignerRow,
	sameSet,
	signerRows,
	thresholdLines,
	toLookUp,
} from "../model/signerSet";
import { submitUserAction } from "../model/submit";
import { requestTreasury } from "../relay/api";
import { useRequest } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { Help } from "../shell/Help";
import { Btn, Card, linkButton, NetTag, SignsTag } from "../shell/kit";
import { ShellPage } from "../shell/ShellPage";
import { SignInGate } from "../shell/SignInGate";
import { useMounted, useShellWallet } from "../shell/WalletBox";
import { useWalletSigner } from "../useWalletSigner";

const TONE: Record<Level, string> = {
	blocked: "text-danger",
	warning: "text-warning",
	shown: "text-muted-foreground",
};

/** One line of the three levels: what stops the conversion, what to know, a plain fact. */
function LevelLine({ line }: { line: Line }) {
	const Icon =
		line.level === "blocked"
			? Ban
			: line.level === "warning"
				? TriangleAlert
				: null;
	return (
		<li
			className={cn("flex items-start gap-1.5 text-[13px]", TONE[line.level])}
		>
			{Icon && <Icon className="mt-[3px] size-3.5 shrink-0" aria-hidden />}
			<span>
				{line.level === "blocked" && (
					<span className="sr-only">Stops this: </span>
				)}
				{line.level === "warning" && <span className="sr-only">Note: </span>}
				{line.text}
			</span>
		</li>
	);
}

function Lines({
	lines,
	className,
}: {
	lines: readonly Line[];
	className?: string;
}) {
	if (lines.length === 0) return null;
	return (
		<ul className={cn("flex flex-col gap-1", className)}>
			{lines.map((l) => (
				<LevelLine key={l.code} line={l} />
			))}
		</ul>
	);
}

/** The head every state of the screen shares. */
function Page({
	network,
	children,
}: {
	network: Network;
	children: ReactNode;
}) {
	return (
		<ShellPage
			title={CREATE.title}
			meta={
				<>
					<NetTag network={network} />
					<SignsTag />
				</>
			}
		>
			<p className="-mt-2 mb-4 max-w-[70ch] text-sm text-muted-foreground">
				{CREATE.meta}
			</p>
			<div className="flex max-w-[780px] flex-col gap-4">{children}</div>
		</ShellPage>
	);
}

/**
 * Create a treasury: the wallet's own account becomes a multi-sig. One
 * identity throughout: with a relay the account is the wallet signed in (and
 * connected); in a build without one it is the connected wallet. Nothing here
 * asks for a second account, and nothing asks for a confirmation: what stops
 * the conversion is said next to the button, the rest is said in place.
 */
export function CreateScreen() {
	const relay = useRelay();
	const w = useShellWallet();
	const network = useNetwork();
	const mounted = useMounted();
	const hydrated = useNetworkHydrated();
	const ready = mounted && hydrated;

	if (!ready) {
		return (
			<Page network={network}>
				<Card>
					<div className="h-24" aria-hidden />
				</Card>
			</Page>
		);
	}
	// Signed out, another wallet connected than the one signed in, or the relay
	// unreachable: the section's ordinary pause, and no wizard behind it.
	if (relay.mode !== "on" && relay.mode !== "off") {
		return (
			<Page network={network}>
				<SignInGate what="this" say={RELAY_COPY.createSignIn} />
			</Page>
		);
	}
	const account =
		relay.mode === "on" ? relay.wallet : (w.address as Address | null);
	if (!account) {
		return (
			<Page network={network}>
				<Card>
					<div className="flex flex-col items-start gap-3">
						<p className="text-sm text-muted-foreground">{CREATE.connect}</p>
						<Btn
							variant="brand"
							disabled={!w.connect}
							onClick={() => w.connect?.()}
						>
							Connect wallet
						</Btn>
					</div>
				</Card>
			</Page>
		);
	}
	return (
		<Page network={network}>
			{/* another account or network is another conversion: nothing carries over */}
			<Wizard
				key={`${network}:${account}`}
				network={network}
				account={account}
			/>
		</Page>
	);
}

type Step = "wallet" | "sending" | "reading";

function Wizard({ network, account }: { network: Network; account: Address }) {
	const relay = useRelay();
	const wallet = useWalletSigner();
	const queries = useQueryClient();
	const navigate = useNavigate();
	const withRelay = relay.mode === "on";

	// ---- 1 · the account
	const target = useMemo<AccountTarget>(
		() => ({ address: account, network }),
		[account, network],
	);
	const read = useAccount(target);
	const mode = useQuery(modeQueryOptions(network, account));
	const d = read.data;
	const facts = useMemo<AccountFacts | null>(() => {
		if (!d) return null;
		const policy = d.policy.ok ? d.policy.observed.data : null;
		return {
			role: d.role?.ok ? d.role.observed.data.role : null,
			multiSig: policy
				? {
						threshold: policy.threshold,
						signers: policy.authorizedUsers.length,
					}
				: null,
			agents: d.agents.ok ? d.agents.observed.data : null,
			positions: d.perp.ok
				? d.perp.observed.data.assetPositions.filter(
						(p) => Number(p.position.szi) !== 0,
					).length
				: null,
			orders: d.openOrders.ok ? d.openOrders.observed.data.length : null,
			now: d.observedAt,
		};
	}, [d]);
	const aboutAccount = facts ? accountLines(facts) : null;

	// ---- 2 · who signs
	const [entries, setEntries] = useState<readonly string[]>([]);
	const [input, setInput] = useState("");
	const [pasteNote, setPasteNote] = useState("");
	const [threshold, setThreshold] = useState<number | null>(null);
	const wanted = useMemo(() => toLookUp(entries, account), [entries, account]);
	const { checks, recheck } = useSignerChecks(network, wanted);
	const rows = useMemo(
		() => signerRows({ entries, self: account, checks }),
		[entries, account, checks],
	);
	const judged = useMemo(
		() => judgeSet({ entries, threshold, self: account, checks }),
		[entries, threshold, account, checks],
	);
	const n = entries.length;
	const k = threshold;

	const add = (text: string) => {
		const pasted = parsePasted(text);
		const added = addEntries(entries, pasted.addresses);
		setEntries(added.entries);
		setPasteNote(
			CREATE.pasted(added.duplicates, added.overMax, pasted.rejected),
		);
		setInput("");
	};
	const remove = (address: string) => {
		const next = entries.filter((e) => e.toLowerCase() !== address);
		setEntries(next);
		setPasteNote("");
		// a number that no longer fits is cleared, never adjusted
		if (threshold !== null && threshold > next.length) setThreshold(null);
	};

	// ---- the conversion
	const [step, setStep] = useState<Step | null>(null);
	const [outcome, setOutcome] = useState<ConvertOutcome | null>(null);
	const [done, setDone] = useState<Policy | null>(null);
	const [rechecking, setRechecking] = useState(false);

	const set = useMemo<SignerSet | null>(
		() =>
			k === null
				? null
				: {
						authorizedUsers: entries
							.map((e) => e.toLowerCase() as Address)
							.sort(),
						threshold: k,
					},
		[entries, k],
	);
	const accountUnread = !d && read.isError;
	const blockedBy =
		aboutAccount?.blockedBy ??
		judged.blockedBy ??
		(judged.pending ? CREATE.checking : null) ??
		(!d && !accountUnread ? "Reading the account…" : null);

	const readSigners = useCallback(
		async () =>
			(await infoClient(network).multiSigSigners(account, { fresh: true }))
				.data,
		[network, account],
	);

	const succeed = useCallback(
		(policy: Policy) => {
			rememberSelfTreasury(queries, network, account, policy);
			void queries.invalidateQueries({
				queryKey: ["multisig-account", network, account],
			});
			setDone(policy);
		},
		[queries, network, account],
	);

	const convert = () => {
		if (!set || blockedBy) return;
		void wallet.run("Waiting for the wallet…", async () => {
			setOutcome(null);
			const chain = convertChain(wallet.chainId, network);
			const result = await runConvert(
				{
					network,
					account,
					set,
					signatureChainId: chain.hex,
					nonce: Date.now(),
				},
				{
					sign: async (action) => {
						const s = await wallet.signerFor(chain.hex);
						if (!s.ok)
							return {
								signature: null,
								recovered: null,
								digest: null,
								issues: [issue("wallet.failed", "error", s.error)],
							};
						return signUserAction(action, s.signer, {
							expectedSigner: account,
						});
					},
					post: (action, signature) =>
						submitUserAction(network, action, signature),
					readSigners,
					wait: (ms) => new Promise((r) => setTimeout(r, ms)),
					onStep: setStep,
				},
			);
			setStep(null);
			setOutcome(result);
			if (result.kind === "converted") succeed(result.policy);
			else if (result.kind === "unanswered" && result.policy)
				succeed(result.policy);
		});
	};

	/** After "accepted, not confirmed yet" or an unanswered request: look once more. */
	const lookAgain = async () => {
		if (!set) return;
		setRechecking(true);
		try {
			const policy = await readSigners();
			if (policy && sameSet(policy, set)) succeed(policy);
		} catch {
			// what is on screen still stands
		} finally {
			setRechecking(false);
		}
	};

	// ---- telling the relay: the account registers itself, asked up to three times
	const [reg, setReg] = useState<{
		readonly state: "idle" | "asking" | "done" | "failed";
		readonly attempt: number;
		readonly requestId: string | null;
	}>({ state: "idle", attempt: 0, requestId: null });
	const { request } = useRequest(reg.requestId);
	const client = relay.client;
	const register = useCallback(
		async (attempt: number) => {
			if (!client) return;
			setReg({ state: "asking", attempt, requestId: null });
			const r = await requestTreasury(client, account, network, account, "add");
			if (!r.data) {
				setReg({ state: "failed", attempt, requestId: null });
				return;
			}
			queries.setQueryData(["relay", account, "request", r.data.id], r.data);
			setReg({ state: "asking", attempt, requestId: r.data.id });
		},
		[client, account, network, queries],
	);
	const started = useRef(false);
	useEffect(() => {
		if (!done || !withRelay || started.current) return;
		started.current = true;
		void register(1);
	}, [done, withRelay, register]);
	const retried = useRef(0);
	useEffect(() => {
		if (reg.state !== "asking" || !request || request.id !== reg.requestId)
			return;
		const next = registerStep(request, reg.attempt);
		if (next.kind === "done" || next.kind === "failed") {
			setReg((s) => ({ ...s, state: next.kind }));
			return;
		}
		if (next.kind !== "retry" || retried.current >= reg.attempt) return;
		retried.current = reg.attempt;
		// not cleared when this effect runs again: one retry per attempt, whatever re-renders
		setTimeout(() => void register(reg.attempt + 1), next.afterMs);
	}, [reg, request, register]);

	// ---- the success screen
	if (done) {
		const signers = done.authorizedUsers;
		return (
			<>
				<Callout tone="success" title={CREATE.doneTitle}>
					{CREATE.done(account, done.threshold, signers.length)}{" "}
					{CREATE.readBack}
				</Callout>
				<Card>
					<div className="flex flex-col gap-3">
						{withRelay && (
							<p
								className={cn(
									"text-[13px]",
									reg.state === "failed"
										? "text-warning"
										: "text-muted-foreground",
								)}
								aria-busy={reg.state === "asking" || reg.state === "idle"}
							>
								{reg.state === "done"
									? RELAY_COPY.registered
									: reg.state === "failed"
										? RELAY_COPY.registerFailed
										: RELAY_COPY.registering}
							</p>
						)}
						<p className="text-sm">
							{withRelay ? CREATE.switchNow : CREATE.switchNowNoRelay}
						</p>
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">
								{CREATE.signInAs}
							</p>
							<ul className="flex flex-col gap-1">
								{signers.map((a) => (
									<li
										key={a}
										className="font-mono text-[13px] [overflow-wrap:anywhere]"
									>
										{a}
									</li>
								))}
							</ul>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							{withRelay ? (
								<Btn
									variant="brand"
									onClick={() => {
										// the treasury's page is where its signers land after signing in
										void navigate({
											to: "/multisig/t/$network/$address",
											params: { network, address: account },
											search: { tab: "pending" },
										});
										relay.signOut();
									}}
								>
									{CREATE.signOutAndOpen}
								</Btn>
							) : (
								<Link
									to="/multisig/propose"
									search={{ treasury: account }}
									className={linkButton}
								>
									{CREATE.firstProposal}
								</Link>
							)}
						</div>
					</div>
				</Card>
			</>
		);
	}

	const lines = k === null ? null : thresholdLines(n, k);
	const said = outcome ? outcomeText(outcome, account) : null;
	const perp = d?.perp.ok ? d.perp.observed.data : null;
	const spot = d?.spot.ok ? d.spot.observed.data.balances : null;
	const usdc = spot?.find((b) => b.coin === "USDC") ?? null;
	const others = spot
		? spot.filter((b) => b.coin !== "USDC" && Number(b.total) !== 0).length
		: 0;
	const modeText =
		mode.data === undefined ? null : modeLabel(accountMode(mode.data.data));
	const busy = step !== null || wallet.busy;

	return (
		<>
			<Card title={`1 · ${CREATE.accountTitle}`}>
				<div className="flex flex-col gap-3">
					<div>
						<p className="text-sm font-medium">{CREATE.headline(account)}</p>
						<p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
							<span className="font-mono text-[13px] [overflow-wrap:anywhere]">
								{account}
							</span>
							<CopyButton value={account} size="xs" />
						</p>
					</div>
					{read.isPending ? (
						<p
							className="flex items-center gap-2 text-[13px] text-muted-foreground"
							aria-busy="true"
						>
							<Loader2 className="size-3.5 animate-spin" aria-hidden />
							Reading the account on {network}…
						</p>
					) : accountUnread ? (
						<p className="flex flex-wrap items-center gap-2 text-[13px] text-warning">
							{CREATE.unread}
							<Btn
								size="sm"
								variant="outline"
								onClick={() => void read.refetch()}
							>
								Try again
							</Btn>
						</p>
					) : (
						<>
							<dl className="flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
								{modeText && (
									<div className="flex items-center gap-1.5">
										<dt className="text-muted-foreground">Mode</dt>
										<dd>{modeText.tag}</dd>
									</div>
								)}
								{perp && (
									<div className="flex items-center gap-1.5">
										<dt className="text-muted-foreground">
											Perps account value
										</dt>
										<dd className="font-mono tabular-nums">
											{perp.marginSummary.accountValue} USDC
										</dd>
									</div>
								)}
								{spot && (
									<div className="flex items-center gap-1.5">
										<dt className="text-muted-foreground">Spot</dt>
										<dd className="font-mono tabular-nums">
											{usdc ? usdc.total : "0"} USDC
											{others > 0 && (
												<span className="font-sans text-muted-foreground">
													{" "}
													and {others} other {others === 1 ? "token" : "tokens"}
												</span>
											)}
										</dd>
									</div>
								)}
							</dl>
							{aboutAccount && <Lines lines={aboutAccount.lines} />}
							{withRelay && facts?.multiSig && (
								// converted earlier (the tab was closed too soon, or another tool was used)
								<p
									className={cn(
										"flex flex-wrap items-center gap-2 text-[13px]",
										reg.state === "failed"
											? "text-warning"
											: "text-muted-foreground",
									)}
								>
									{reg.state === "done"
										? RELAY_COPY.registered
										: reg.state === "failed"
											? RELAY_COPY.registerFailed
											: reg.state === "asking"
												? RELAY_COPY.registering
												: RELAY_COPY.registerSelfBody}
									{(reg.state === "idle" || reg.state === "failed") && (
										<Btn
											size="sm"
											variant="outline"
											onClick={() => {
												retried.current = 0;
												void register(1);
											}}
										>
											{RELAY_COPY.registerSelfButton}
										</Btn>
									)}
								</p>
							)}
						</>
					)}
					<p className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
						{withRelay ? CREATE.otherAccount : CREATE.otherAccountNoRelay}
						{withRelay && (
							<Btn size="sm" variant="outline" onClick={relay.signOut}>
								{CREATE.signOut}
							</Btn>
						)}
					</p>
				</div>
			</Card>

			<Card
				title={`2 · ${CREATE.signersTitle}`}
				actions={
					<span className="text-xs tabular-nums text-muted-foreground">
						{n} of at most {SIGNERS_MAX}
					</span>
				}
			>
				<div className="flex flex-col gap-3">
					<form
						className="flex flex-wrap items-start gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							if (input.trim()) add(input);
						}}
					>
						<TextInput
							mono
							name="signer-address"
							aria-label="Signer address"
							placeholder="0x…"
							value={input}
							disabled={busy}
							className="min-w-0 flex-1 basis-[280px]"
							onChange={(e) => setInput(e.target.value)}
							onPaste={(e) => {
								// a pasted list goes straight into the rows
								const text = e.clipboardData.getData("text");
								if (parsePasted(text).addresses.length === 0) return;
								e.preventDefault();
								add(text);
							}}
						/>
						<Btn
							type="submit"
							variant="outline"
							disabled={busy || !input.trim()}
						>
							Add
						</Btn>
					</form>
					<p className="-mt-1.5 text-xs text-muted-foreground">
						{CREATE.pasteHint}
					</p>
					{pasteNote && (
						<output className="block text-[13px] text-warning">
							{pasteNote}
						</output>
					)}
					{rows.length === 0 ? (
						<p className="text-[13px] text-muted-foreground">
							{CREATE.noSigners}
						</p>
					) : (
						<ul className="flex flex-col">
							{rows.map((r) => (
								<SignerLine
									key={r.address}
									row={r}
									disabled={busy}
									onRemove={() => remove(r.address)}
									onRecheck={() => recheck(r.address)}
								/>
							))}
						</ul>
					)}
					<p className="text-xs text-subtle-foreground">{CREATE.signersNote}</p>
				</div>
			</Card>

			<Card
				title={
					<span className="inline-flex items-center gap-1.5">
						3 · {CREATE.howManyTitle}
						<Help k="stolenLost" />
					</span>
				}
			>
				<div className="flex flex-col gap-3">
					{n === 0 ? (
						<p className="text-[13px] text-muted-foreground">
							{CREATE.pickFirst}
						</p>
					) : (
						<HowMany n={n} value={k} disabled={busy} onChange={setThreshold} />
					)}
					{lines && (
						<div className="flex flex-col gap-1 text-[13px]">
							<p className="font-medium">{lines.summary}</p>
							<p className="text-muted-foreground">{lines.stolen}</p>
							<p className="text-muted-foreground">{lines.lost}</p>
							{lines.warning && (
								<ul>
									<LevelLine
										line={{
											level: "warning",
											code: "threshold",
											text: lines.warning,
										}}
									/>
								</ul>
							)}
						</div>
					)}
					<p className="text-xs text-subtle-foreground">{CREATE.later}</p>
				</div>
			</Card>

			<section className="rounded-[10px] border border-border bg-surface-2 px-4 py-3.5">
				<h2 className="text-[13px] font-semibold">{CREATE.infoTitle}</h2>
				<ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-[13px] text-muted-foreground">
					{CREATE.info.map((t) => (
						<li key={t}>{t}</li>
					))}
				</ul>
			</section>

			<Card>
				<div className="flex flex-col gap-3">
					{set && !blockedBy && (
						<p className="text-sm">
							{CREATE.before(account, set.threshold, n)}
						</p>
					)}
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<Btn
							variant="brand"
							disabled={!!blockedBy || !set || busy}
							onClick={convert}
						>
							{set && n > 0
								? CREATE.button(account, set.threshold, n)
								: CREATE.buttonIdle}
						</Btn>
						{blockedBy && !step && (
							<span
								className={cn(
									"text-[13px]",
									judged.pending &&
										!aboutAccount?.blockedBy &&
										!judged.blockedBy
										? "text-muted-foreground"
										: "text-danger",
								)}
							>
								{blockedBy}
							</span>
						)}
					</div>
					{step && (
						<p
							className="flex items-start gap-2 text-[13px] text-muted-foreground"
							aria-live="polite"
						>
							<Loader2
								className="mt-0.5 size-3.5 shrink-0 animate-spin"
								aria-hidden
							/>
							{step === "wallet" && set
								? CREATE.inWallet(set.threshold, n)
								: step === "sending"
									? CREATE.sending
									: CREATE.reading}
						</p>
					)}
					{said && !step && (
						<Callout
							tone={said.tone}
							title={said.title}
							action={
								outcome?.kind === "unconfirmed" ||
								(outcome?.kind === "unanswered" &&
									outcome.converted !== true) ? (
									<Btn
										size="sm"
										variant="outline"
										disabled={rechecking}
										onClick={() => void lookAgain()}
									>
										{rechecking ? "Reading…" : CREATE.checkAgain}
									</Btn>
								) : undefined
							}
						>
							{said.body}
						</Callout>
					)}
				</div>
			</Card>
		</>
	);
}

/** One signer in the list: the address in full, what Hyperliquid says about it, and the way out. */
function SignerLine({
	row,
	disabled,
	onRemove,
	onRecheck,
}: {
	row: SignerRow;
	disabled: boolean;
	onRemove(): void;
	onRecheck(): void;
}) {
	return (
		<li className="flex items-start justify-between gap-2.5 border-t border-border py-2.5 first:border-t-0 first:pt-0 last:pb-0">
			<div className="min-w-0">
				<span className="block font-mono text-[13px] [overflow-wrap:anywhere]">
					{row.address}
				</span>
				{row.level === "pending" ? (
					<span
						className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground"
						aria-busy="true"
					>
						<Loader2 className="size-3 animate-spin" aria-hidden />
						Checking on Hyperliquid…
					</span>
				) : (
					<ul className="mt-1 flex flex-col gap-1">
						{row.lines.map((l) =>
							l.code === "signer.ok" ? (
								<li
									key={l.code}
									className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
								>
									<Check className="size-3.5 text-success" aria-hidden />
									{l.text}
								</li>
							) : (
								<LevelLine key={l.code} line={l} />
							),
						)}
					</ul>
				)}
				{row.recheck && row.level !== "pending" && (
					<Btn
						size="sm"
						variant="outline"
						className="mt-1.5"
						disabled={disabled}
						onClick={onRecheck}
					>
						{CREATE.checkAgain}
					</Btn>
				)}
			</div>
			<span className="flex shrink-0 items-center gap-1">
				<Btn
					size="sm"
					variant="ghost"
					disabled={disabled}
					onClick={onRemove}
					aria-label={`Remove ${row.address}`}
					title="Remove"
				>
					<X className="size-3.5" aria-hidden />
				</Btn>
			</span>
		</li>
	);
}

/**
 * "How many must sign": one button per possible number, none chosen until
 * the reader chooses. (A default would silently decide 2 of 2.)
 */
function HowMany({
	n,
	value,
	disabled,
	onChange,
}: {
	n: number;
	value: number | null;
	disabled: boolean;
	onChange(k: number): void;
}) {
	const numbers = Array.from({ length: n }, (_, i) => i + 1);
	return (
		<div
			role="radiogroup"
			aria-label={`${CREATE.howManyTitle}, out of ${n}`}
			className="flex flex-wrap items-center gap-1.5"
			onKeyDown={(e) => {
				if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
				e.preventDefault();
				const at = value ?? (e.key === "ArrowRight" ? 0 : n + 1);
				const next = Math.min(
					n,
					Math.max(1, at + (e.key === "ArrowRight" ? 1 : -1)),
				);
				onChange(next);
				(
					e.currentTarget.querySelector(
						`[data-k="${next}"]`,
					) as HTMLElement | null
				)?.focus();
			}}
		>
			{numbers.map((i) => (
				// biome-ignore lint/a11y/useSemanticElements: the ARIA radio pattern on buttons, as in the hub's Segmented
				<button
					key={i}
					type="button"
					role="radio"
					data-k={i}
					aria-checked={value === i}
					// with nothing chosen the first number takes the focus
					tabIndex={value === i || (value === null && i === 1) ? 0 : -1}
					disabled={disabled}
					onClick={() => onChange(i)}
					className={cn(
						"h-8 min-w-9 rounded-md border px-2.5 font-mono text-[13px] tabular-nums transition-colors disabled:opacity-60",
						value === i
							? "border-brand bg-brand-soft font-semibold text-brand"
							: "border-border-strong bg-surface text-foreground hover:bg-surface-2",
					)}
				>
					{i}
				</button>
			))}
			<span className="text-[13px] text-muted-foreground">
				of {n} {n === 1 ? "signer" : "signers"}
			</span>
		</div>
	);
}
