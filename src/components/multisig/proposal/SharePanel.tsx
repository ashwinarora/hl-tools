import {
	encodeProposal,
	hasErrors,
	type Issue,
	type Proposal,
} from "@hl-tools/core";
import { useNavigate } from "@tanstack/react-router";
import { Download, Link2, Search, ShieldAlert, Upload } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { CopyButton } from "#/components/hub/CopyButton";
import { Field, Panel, TextArea } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { download } from "#/lib/download";
import { useHandoffStore } from "#/store/handoffStore";
import { RELAY_COPY } from "../model/relay/copy";
import {
	fileTransport,
	linkTransport,
	openText,
	type Published,
} from "../model/transport";
import type { StoreResult } from "./useProposalDoc";

/** The link, behind an acknowledgement: it carries the whole proposal. */
function LinkDialog({ proposal }: { proposal: Proposal }) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [confirmed, setConfirmed] = useState(false);
	const [published, setPublished] = useState<Published | null>(null);
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				setOpen(o);
				if (!o) {
					setConfirmed(false);
					setPublished(null);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Link2 className="size-3.5" aria-hidden /> Get link
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>A link to this proposal</DialogTitle>
					<DialogDescription>
						The link carries the whole document, signatures included, in its
						fragment. Fragments are not sent to servers and signatures are not
						secrets, but anyone holding the link can read what this treasury
						intends to do.
					</DialogDescription>
				</DialogHeader>
				<label
					htmlFor={id}
					className="flex cursor-pointer items-start gap-2.5 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"
				>
					<input
						id={id}
						type="checkbox"
						checked={confirmed}
						onChange={(e) => {
							setConfirmed(e.target.checked);
							setPublished(
								e.target.checked
									? linkTransport(() => window.location.origin).publish(
											proposal,
										)
									: null,
							);
						}}
						className="mt-0.5 size-4 accent-[var(--brand)]"
					/>
					<span className="flex items-center gap-1.5 font-medium">
						<ShieldAlert className="size-3.5 text-warning" aria-hidden /> I am
						sending this only to the other signers
					</span>
				</label>
				{published?.url && (
					<>
						<div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
							<code className="min-w-0 flex-1 truncate font-mono text-xs">
								{published.url}
							</code>
							<CopyButton value={published.url} label="Copy link" />
						</div>
						<p className="text-xs text-muted-foreground">
							{published.bytes} characters.
						</p>
						<IssueList issues={published.issues} />
					</>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={() => setOpen(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * Take the proposal to the other signers and bring their copies back. Link and
 * file today; both end in the same strict decoder and the same merge.
 */
export function SharePanel({
	proposal,
	store,
	secondary = false,
}: {
	proposal: Proposal;
	store: (p: Proposal) => Promise<StoreResult>;
	/**
	 * The proposal is shared through the relay, so this is the way around it
	 * rather than the way: folded away under "Export / Import".
	 */
	secondary?: boolean;
}) {
	const navigate = useNavigate();
	const send = useHandoffStore((s) => s.send);
	const fileRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [result, setResult] = useState<
		| { kind: "merged"; added: number; total: number; issues: readonly Issue[] }
		| { kind: "other"; digest: string }
		| { kind: "failed"; issues: readonly Issue[] }
		| null
	>(null);
	const pretty = useMemo(
		() => encodeProposal(proposal, { pretty: true }),
		[proposal],
	);

	const merge = async (source: string) => {
		const decoded = openText(source);
		if (!decoded.proposal) {
			setResult({ kind: "failed", issues: decoded.issues });
			return;
		}
		if (decoded.proposal.digest !== proposal.digest) {
			// a different proposal: keep it, and offer to open it
			await store(decoded.proposal);
			setResult({ kind: "other", digest: decoded.proposal.digest });
			return;
		}
		const before = proposal.signatures.length;
		const stored = await store(decoded.proposal);
		if (hasErrors(stored.issues)) {
			// e.g. the same digest with a different vault address or expiry: refused, not merged
			setResult({ kind: "failed", issues: stored.issues });
			return;
		}
		setText("");
		setResult({
			kind: "merged",
			added: stored.proposal.signatures.length - before,
			total: stored.proposal.signatures.length,
			issues: stored.issues,
		});
	};

	const body = (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<LinkDialog proposal={proposal} />
				<Button
					variant="outline"
					size="sm"
					onClick={() => fileTransport(download).publish(proposal)}
				>
					<Download className="size-3.5" aria-hidden /> Download file
				</Button>
				<CopyButton value={pretty} label="Copy JSON" />
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						// handed over in memory, like every pasted payload in the hub
						send("multisig", pretty);
						void navigate({ to: "/tools/multisig" });
					}}
				>
					<Search className="size-3.5" aria-hidden /> Inspect
				</Button>
			</div>
			<Field
				label="Merge a returned copy"
				htmlFor="ms-merge"
				hint="Paste the link or document a signer sent back, or upload their file. Signatures are verified before they are added."
			>
				<TextArea
					id="ms-merge"
					value={text}
					onChange={(e) => setText(e.target.value)}
					rows={3}
					className="min-h-20"
					data-private
				/>
			</Field>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					size="sm"
					variant="outline"
					disabled={!text.trim()}
					onClick={() => void merge(text)}
				>
					Merge
				</Button>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => fileRef.current?.click()}
				>
					<Upload className="size-3.5" aria-hidden /> Upload file
				</Button>
				<input
					ref={fileRef}
					name="returned-copy"
					type="file"
					accept="application/json,.json"
					className="hidden"
					onChange={async (e) => {
						const f = e.target.files?.[0];
						e.target.value = "";
						if (f) await merge(await f.text());
					}}
				/>
			</div>
			{result?.kind === "merged" && (
				<Callout
					tone={result.added > 0 ? "success" : "info"}
					title={
						result.added > 0
							? `Added ${result.added} signature${result.added === 1 ? "" : "s"}; ${result.total} in total`
							: `Nothing new: still ${result.total} signature${result.total === 1 ? "" : "s"}`
					}
				>
					<IssueList issues={result.issues} />
				</Callout>
			)}
			{result?.kind === "other" && (
				<Callout
					tone="warning"
					title="That is a different proposal"
					action={
						<Button
							size="sm"
							variant="outline"
							onClick={() =>
								void navigate({
									to: "/multisig/proposal",
									search: { digest: result.digest },
								})
							}
						>
							Open it
						</Button>
					}
				>
					Its digest is {result.digest.slice(0, 18)}…, not this one's. It was
					saved to this browser's history.
				</Callout>
			)}
			{result?.kind === "failed" && (
				<Callout tone="danger" title="Not a proposal this page can merge">
					<IssueList issues={result.issues} />
				</Callout>
			)}
		</div>
	);

	if (secondary) {
		return (
			<details className="group min-w-0 rounded-[10px] border border-border bg-surface shadow-[var(--shadow-card)]">
				<summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
					<span className="text-sm font-semibold">Export / Import</span>
					<span className="text-xs text-muted-foreground">
						{RELAY_COPY.withoutUs}
					</span>
				</summary>
				<div className="border-t border-border p-4">
					<p className="mb-4 text-xs text-muted-foreground">
						The document is the whole proposal. A link or a file carries it to a
						signer who does not use the relay; what they send back is merged
						here, with every signature verified first.
					</p>
					{body}
				</div>
			</details>
		);
	}
	return (
		<Panel
			title="Pass it on"
			description="Send the proposal to the other signers; merge what they send back. You can always do this without us: the document is the whole proposal."
		>
			{body}
		</Panel>
	);
}
