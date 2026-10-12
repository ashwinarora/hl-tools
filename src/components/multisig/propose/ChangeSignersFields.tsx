import type { Address, AgentInfo, Policy, SignerSet } from "@hl-tools/core";
import { Check, Loader2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "#/lib/utils";
import { CHANGE, convertBackLines } from "../model/change";
import { CREATE } from "../model/create";
import {
	addEntries,
	changeSummary,
	judgeSet,
	type OnRecord,
	parsePasted,
	SIGNERS_MAX,
	type SignerCheck,
	type SignerRow,
	sameSet,
	signerRows,
	signersField,
	thresholdLines,
	wantedSet,
} from "../model/signerSet";
import { Who } from "../names/Names";
import { Sentence } from "../names/Sentence";
import { Help } from "../shell/Help";
import { Btn, Tag } from "../shell/kit";
import { AffectedList } from "../signers/AffectedList";
import {
	HowMany,
	LevelLine,
	Lines,
	PasteBox,
	ThresholdMeaning,
} from "../signers/parts";
import { useAffected } from "../signers/useAffected";
import type { KnownState } from "../treasury/useKnownProposals";

/**
 * "Change signers": the treasury's list and number as they are, to be edited
 * into what they should become. The form's only value is the action's own
 * `signers` string (see `wantedSet`); everything shown is derived from it and
 * from the signers Hyperliquid reports now.
 */
export function ChangeSignersFields({
	signers,
	onChange,
	current,
	treasury,
	checks,
	recheck,
	me,
	finaliser,
	known,
	knownState,
	relayInUse,
	agents,
}: {
	signers: string;
	onChange(signers: string): void;
	/** The treasury's signers as Hyperliquid reports them; null while not read. */
	current: Policy | null;
	treasury: Address;
	checks: ReadonlyMap<string, SignerCheck>;
	recheck(address: Address): void;
	/** The connected wallet, to say "you are removing yourself". */
	me: string | null;
	/** Who will submit the proposal, to say when the change removes them. */
	finaliser: string;
	/** The treasury's proposals on record, to say which waiting ones the change touches. */
	known: readonly OnRecord[];
	knownState: KnownState;
	relayInUse: boolean;
	/** The treasury's API wallets, for the conversion back; null when not read. */
	agents: readonly AgentInfo[] | null;
}) {
	// as typed, for the checksum check only: the form itself holds lowercase
	const [typed, setTyped] = useState<Readonly<Record<string, string>>>({});
	const [pasteNote, setPasteNote] = useState("");
	// before the early return below: hooks run on every render
	const change = useMemo<SignerSet | null>(() => {
		const asked = wantedSet(signers, current);
		if (
			!current ||
			asked.threshold === null ||
			asked.entries.length === 0 ||
			asked.threshold > asked.entries.length
		)
			return null;
		const set = { authorizedUsers: asked.entries, threshold: asked.threshold };
		return sameSet(current, set) ? null : set;
	}, [signers, current]);
	const revert = signers.trim() === "null";
	const touched = useAffected(known, current, revert ? "revert" : change);
	// read once when the form opens: only for "this approval has run out"
	const [openedAt] = useState(() => Date.now());

	if (!current || current.authorizedUsers.length === 0) {
		return (
			<p
				className="flex items-center gap-2 text-sm text-muted-foreground"
				aria-busy="true"
			>
				<Loader2 className="size-4 animate-spin" aria-hidden />
				Reading the treasury's signers…
			</p>
		);
	}

	if (revert) {
		// nothing to fill in: what it means, what comes along, and the way back
		return (
			<div className="flex flex-col gap-4">
				<section className="flex flex-col gap-2.5">
					<h3 className="flex items-center gap-1.5 text-sm font-semibold">
						{CHANGE.backTitle}
						<Help k="convertBack" />
					</h3>
					<p className="text-sm">{CHANGE.backLead}</p>
					<Lines lines={convertBackLines({ agents, now: openedAt })} />
				</section>
				<section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
					<AffectedList
						affected={touched.affected}
						computing={touched.computing}
						state={knownState}
						relayInUse={relayInUse}
					/>
					{touched.affected.length > 0 && (
						<ul>
							<LevelLine
								line={{
									level: "warning",
									code: "back.waiting",
									text: CHANGE.backWaiting(touched.affected.length),
								}}
							/>
						</ul>
					)}
					<p className="text-xs text-muted-foreground">
						{CHANGE.whoDecides(
							current.threshold,
							current.authorizedUsers.length,
						)}{" "}
						{CHANGE.takesEffect}
					</p>
				</section>
				<button
					type="button"
					onClick={() => onChange("")}
					className="self-start text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
				>
					{CHANGE.backUndo}
				</button>
			</div>
		);
	}

	const wanted = wantedSet(signers, current);
	const entries = wanted.entries.map((a) => typed[a] ?? a);
	const n = wanted.entries.length;
	const k = wanted.threshold;
	const now = current.authorizedUsers;
	const rows = signerRows({ entries, self: treasury, checks, current: now });
	// the signers of now in their own order, kept or going; then the new ones
	const at = (r: SignerRow) =>
		r.kind === "added" ? now.length : now.indexOf(r.address);
	const ordered = [...rows].sort((a, b) => at(a) - at(b));
	const judged = judgeSet({
		entries,
		threshold: k,
		self: treasury,
		checks,
		current,
		me,
		leader: finaliser.trim() || null,
	});
	const next: SignerSet | null =
		k === null ? null : { authorizedUsers: wanted.entries, threshold: k };
	const meaning = k === null ? null : thresholdLines(n, k);

	const write = (list: readonly string[], number: number | null) => {
		const lower = [...new Set(list.map((a) => a.toLowerCase() as Address))];
		// a number that no longer fits is cleared, never adjusted
		const fits = number !== null && number <= lower.length ? number : null;
		const same =
			fits !== null &&
			sameSet(current, { authorizedUsers: lower, threshold: fits });
		// back to what the treasury has: the form is untouched again
		onChange(same ? "" : signersField(lower, fits));
	};
	const add = (text: string) => {
		const pasted = parsePasted(text);
		const added = addEntries(wanted.entries, pasted.addresses);
		setTyped((t) => ({
			...t,
			...Object.fromEntries(pasted.addresses.map((a) => [a.toLowerCase(), a])),
		}));
		setPasteNote(
			CREATE.pasted(added.duplicates, added.overMax, pasted.rejected),
		);
		write(added.entries, k);
	};
	const remove = (address: Address) => {
		setPasteNote("");
		write(
			wanted.entries.filter((a) => a !== address),
			k,
		);
	};

	return (
		<div className="flex flex-col gap-5">
			<section className="flex flex-col gap-3">
				<div className="flex items-baseline justify-between gap-2">
					<h3 className="flex items-center gap-1.5 text-xs font-medium">
						{CHANGE.signersTitle}
						<Help k="changeSigners" />
					</h3>
					<span className="text-xs tabular-nums text-muted-foreground">
						{n} of at most {SIGNERS_MAX}
					</span>
				</div>
				<ul className="flex flex-col">
					{ordered.map((r) => (
						<li
							key={r.address}
							className="flex items-start justify-between gap-2.5 border-t border-border py-2.5 first:border-t-0 first:pt-0"
						>
							<div className="min-w-0">
								{r.kind === "added" ? (
									<span className="flex flex-wrap items-center gap-x-2 gap-y-1">
										<span className="font-mono text-[13px] [overflow-wrap:anywhere]">
											{r.address}
										</span>
										<Tag tone="info">{CHANGE.added}</Tag>
									</span>
								) : (
									<span
										className={cn(
											"flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]",
											r.kind === "removed" &&
												"text-muted-foreground line-through",
										)}
									>
										<Who address={r.address} />
										{r.address === me && r.kind === "kept" && (
											<Tag tone="you">{CHANGE.you}</Tag>
										)}
									</span>
								)}
								{r.level === "pending" ? (
									<span
										className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground"
										aria-busy="true"
									>
										<Loader2 className="size-3 animate-spin" aria-hidden />
										Checking on Hyperliquid…
									</span>
								) : (
									r.lines.length > 0 && (
										<ul className="mt-1 flex flex-col gap-1">
											{r.lines.map((l) =>
												l.code === "signer.ok" ? (
													<li
														key={l.code}
														className="flex items-center gap-1.5 text-[13px] text-muted-foreground"
													>
														<Check
															className="size-3.5 text-success"
															aria-hidden
														/>
														{l.text}
													</li>
												) : (
													<LevelLine key={l.code} line={l} />
												),
											)}
										</ul>
									)
								)}
								{r.recheck && r.level !== "pending" && (
									<Btn
										size="sm"
										variant="outline"
										className="mt-1.5"
										onClick={() => recheck(r.address)}
									>
										{CREATE.checkAgain}
									</Btn>
								)}
							</div>
							{r.kind === "removed" ? (
								<Btn
									size="sm"
									variant="outline"
									onClick={() => write([...wanted.entries, r.address], k)}
									aria-label={`${CHANGE.undo}: keep ${r.address}`}
								>
									{CHANGE.undo}
								</Btn>
							) : r.kind === "kept" ? (
								<Btn
									size="sm"
									variant="outline"
									onClick={() => remove(r.address)}
									aria-label={`${CHANGE.remove} ${r.address}`}
								>
									{CHANGE.remove}
								</Btn>
							) : (
								<Btn
									size="sm"
									variant="ghost"
									onClick={() => remove(r.address)}
									aria-label={`Remove ${r.address}`}
									title={CHANGE.remove}
								>
									<X className="size-3.5" aria-hidden />
								</Btn>
							)}
						</li>
					))}
				</ul>
				<PasteBox disabled={false} note={pasteNote} onAdd={add} />
				<p className="text-xs text-subtle-foreground">{CREATE.signersNote}</p>
			</section>

			<section className="flex flex-col gap-3">
				<h3 className="flex items-center gap-1.5 text-xs font-medium">
					{CREATE.howManyTitle}
					<Help k="stolenLost" />
				</h3>
				{n === 0 ? (
					<p className="text-[13px] text-muted-foreground">
						{CREATE.pickFirst}
					</p>
				) : (
					<HowMany
						n={n}
						value={k}
						disabled={false}
						onChange={(v) => write(wanted.entries, v)}
					/>
				)}
				{meaning && <ThresholdMeaning lines={meaning} />}
			</section>

			<section className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3">
				<h3 className="text-xs font-medium">{CHANGE.whatChanges}</h3>
				{judged.unchanged ? (
					<p className="text-sm text-muted-foreground">{CHANGE.nothing}</p>
				) : judged.blockedBy ? (
					<ul>
						<LevelLine
							line={{
								level: "blocked",
								code: "blocked",
								text: judged.blockedBy,
							}}
						/>
					</ul>
				) : next ? (
					<p className="text-sm [overflow-wrap:anywhere]">
						<Sentence parts={changeSummary(current, next)} />
					</p>
				) : null}
				<Lines
					lines={judged.lines.filter(
						(l) =>
							l.level !== "blocked" &&
							// said with the number, a few lines up
							l.code !== "lockout.all_keys_required",
					)}
				/>
				{change && !judged.blockedBy && (
					<AffectedList
						affected={touched.affected}
						computing={touched.computing}
						state={knownState}
						relayInUse={relayInUse}
					/>
				)}
				<p className="text-xs text-muted-foreground">
					{CHANGE.whoDecides(current.threshold, now.length)}{" "}
					{rows.some((r) => r.kind === "removed") &&
						`${CHANGE.removedCanSign} `}
					{CHANGE.takesEffect}
				</p>
			</section>

			<button
				type="button"
				onClick={() => onChange("null")}
				className="self-start text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
			>
				{CHANGE.backLink}
			</button>
		</div>
	);
}
