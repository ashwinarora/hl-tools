import type { Address } from "@hl-tools/core";
import { useEffect, useState } from "react";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { RELAY_COPY } from "../model/relay/copy";
import type { TreasuryRow } from "../model/relay/rows";
import { shortAddress } from "../model/stage";
import { ago, Btn, Card, PersonRow, Tag } from "../shell/kit";
import type { TreasuryState } from "../useTreasuryState";

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Who signs for the treasury (the relay's stored copy of Hyperliquid's list)
 * and which API wallets can trade without them (read live). The stored copy
 * only decides who sees what here; nothing is signed or counted against it.
 */
export function SignersTab({
	treasury,
	live,
	me,
	checking,
	onCheck,
}: {
	treasury: TreasuryRow;
	live: TreasuryState;
	me: Address | null;
	/** A re-check was asked for and has not been answered yet. */
	checking: boolean;
	onCheck: () => void;
}) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 15_000);
		return () => clearInterval(t);
	}, []);
	const hydrated = usePrefsHydrated();
	const key = treasuryKey(treasury.network, treasury.address);
	const hidden = useMultisigPrefs((s) => s.hidden.includes(key));
	const setHidden = useMultisigPrefs((s) => s.setHidden);
	const addedByMe = treasury.addedBy === me;

	return (
		<div className="grid grid-cols-1 items-start gap-4 min-[861px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
			<Card
				title="Signers"
				actions={
					<Tag>
						{treasury.threshold} of {treasury.signers.length} must sign
					</Tag>
				}
			>
				{treasury.signers.map((a) => (
					<PersonRow
						key={a}
						trailing={a === me ? <Tag tone="you">you</Tag> : null}
					>
						<span className="font-mono text-[13px]" title={a}>
							<span className="hidden sm:inline">{a}</span>
							<span className="sm:hidden">{shortAddress(a)}</span>
						</span>
					</PersonRow>
				))}
			</Card>

			<div className="flex flex-col gap-4">
				<Card title="API wallets">
					{live.agents === null ? (
						<span className="text-sm text-muted-foreground">
							{live.error
								? "Could not be read from Hyperliquid."
								: "Reading from Hyperliquid…"}
						</span>
					) : live.agents.length === 0 ? (
						<span className="text-sm text-muted-foreground">
							None approved. Every action needs the signers.
						</span>
					) : (
						<>
							{live.agents.map((g) => (
								<PersonRow
									key={g.address}
									trailing={
										g.validUntil <= now ? (
											<Tag tone="gray">expired</Tag>
										) : (
											<Tag tone="warn">until {day(g.validUntil)}</Tag>
										)
									}
								>
									<b className="text-sm font-semibold">
										{g.name || "(unnamed)"}
									</b>{" "}
									<span
										className="font-mono text-[13px] text-muted-foreground"
										title={g.address}
									>
										{shortAddress(g.address)}
									</span>
								</PersonRow>
							))}
							<p className="mt-2.5 text-xs text-subtle-foreground">
								An API wallet can trade for this treasury without the signers.
								It cannot withdraw.
							</p>
						</>
					)}
				</Card>

				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
					<span>
						Signer list read from Hyperliquid {ago(treasury.checkedAt, now)}.
						Your browser also checks it live before anything is signed.
					</span>
					<div className="flex flex-wrap items-center gap-2">
						<Btn
							size="sm"
							variant="outline"
							disabled={checking}
							onClick={onCheck}
						>
							{checking ? "Checking…" : "Check now"}
						</Btn>
					</div>
				</div>

				<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3.5 py-3 text-xs text-muted-foreground">
					<span>
						Added by{" "}
						<span
							className="font-mono text-foreground"
							title={treasury.addedBy}
						>
							{addedByMe ? "you" : shortAddress(treasury.addedBy)}
						</span>{" "}
						on {day(treasury.createdAt)}.
						{!addedByMe && ` ${RELAY_COPY.addedByOther}`}
					</span>
					{hydrated && (
						<div className="flex flex-wrap items-center gap-2">
							<Btn
								size="sm"
								variant="outline"
								onClick={() =>
									setHidden(treasury.network, treasury.address, !hidden)
								}
							>
								{hidden ? "Show in my list again" : "Hide from my list"}
							</Btn>
							<span>
								{hidden
									? "Hidden in this browser. It stays reachable by its address."
									: "Hiding is for this browser only; nothing changes for your co-signers."}
							</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
