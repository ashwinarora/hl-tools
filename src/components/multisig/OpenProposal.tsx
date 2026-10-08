import type { Issue } from "@hl-tools/core";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Field, Panel, TextArea } from "#/components/hub/layout";
import { Callout, IssueList } from "#/components/hub/status";
import { Button } from "#/components/ui/button";
import { errorMessage } from "#/hooks/useHyperliquid";
import { saveProposal } from "./model/history";
import { openText } from "./model/transport";

/**
 * Open a proposal someone sent: paste the document or the link, or upload the
 * file. It is decoded strictly, merged into this browser's history and shown
 * on the proposal page; nothing is sent anywhere.
 */
export function OpenProposal({
	handed = null,
}: {
	/** Text handed over from the paste box or the inspector: opened on arrival. */
	handed?: string | null;
}) {
	const navigate = useNavigate();
	const client = useQueryClient();
	const fileRef = useRef<HTMLInputElement>(null);
	const [text, setText] = useState("");
	const [issues, setIssues] = useState<readonly Issue[]>([]);
	const [failure, setFailure] = useState<string | null>(null);

	const open = async (source: string) => {
		setFailure(null);
		const decoded = openText(source);
		if (!decoded.proposal) {
			setIssues(decoded.issues);
			return;
		}
		try {
			const saved = await saveProposal(decoded.proposal);
			if (!saved.saved) {
				setIssues(saved.issues);
				return;
			}
			setIssues([]);
			await client.invalidateQueries({ queryKey: ["multisig-proposals"] });
			await client.invalidateQueries({
				queryKey: ["multisig-proposal", saved.proposal.digest],
			});
			void navigate({
				to: "/multisig/proposal",
				search: { digest: saved.proposal.digest },
			});
		} catch (e) {
			setFailure(errorMessage(e));
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: a hand-off is opened once, when it arrives
	useEffect(() => {
		if (!handed) return;
		// kept in the box so a document that does not open can be seen and corrected
		setText(handed);
		void open(handed);
	}, [handed]);

	return (
		<Panel
			title="Open a proposal"
			description="Paste the document or the link you were sent, or upload the file. Links you click open directly."
		>
			<div className="space-y-3">
				<Field
					label="Proposal document or link"
					htmlFor="ms-open"
					hint="Decoded in this browser; nothing is sent anywhere."
				>
					<TextArea
						id="ms-open"
						value={text}
						onChange={(e) => setText(e.target.value)}
						rows={5}
						className="min-h-24"
						placeholder='{"v":1,"payload":{"network":"testnet","multiSigUser":"0x…", …}}  or  https://…/multisig/proposal#share=…'
						data-private
					/>
				</Field>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						size="sm"
						variant="brand"
						disabled={!text.trim()}
						onClick={() => void open(text)}
					>
						Open
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => fileRef.current?.click()}
					>
						<Upload className="size-3.5" aria-hidden /> Upload file
					</Button>
					<input
						ref={fileRef}
						type="file"
						accept="application/json,.json"
						className="hidden"
						onChange={async (e) => {
							const f = e.target.files?.[0];
							e.target.value = "";
							if (f) await open(await f.text());
						}}
					/>
				</div>
				{issues.length > 0 && (
					<Callout tone="danger" title="Not a proposal this page can open">
						<IssueList issues={issues} />
					</Callout>
				)}
				{failure && (
					<Callout tone="warning" title="Local storage unavailable">
						{failure}
					</Callout>
				)}
			</div>
		</Panel>
	);
}
