import { Link2, ShieldAlert } from "lucide-react";
import { useId, useState } from "react";
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
import { buildShareUrl } from "#/lib/share";
import { CopyButton } from "./CopyButton";

/**
 * Share with an explicit confirmation that the content is public. The link
 * is only built after the box is ticked.
 */
export function ShareButton({
	tool,
	getState,
	what,
	disabled,
}: {
	tool: string;
	getState: () => Record<string, unknown>;
	what: string;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [confirmed, setConfirmed] = useState(false);
	const [url, setUrl] = useState<string | null>(null);
	const id = useId();
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				setOpen(o);
				if (!o) {
					setConfirmed(false);
					setUrl(null);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" disabled={disabled}>
					<Link2 className="size-3.5" aria-hidden /> Share
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Share this {what}</DialogTitle>
					<DialogDescription>
						The link will contain the full {what} — including any signature —
						encoded in the URL fragment. Fragments are not sent to servers, but
						anyone you give the link to can read it.
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
							setUrl(e.target.checked ? buildShareUrl(tool, getState()) : null);
						}}
						className="mt-0.5 size-4 accent-[var(--brand)]"
					/>
					<span>
						<span className="flex items-center gap-1.5 font-medium">
							<ShieldAlert className="size-3.5 text-warning" aria-hidden /> I
							confirm this content is public
						</span>
						<span className="text-muted-foreground">
							It contains no secrets I wouldn't post publicly.
						</span>
					</span>
				</label>
				{url && (
					<div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-2 p-2">
						<code className="min-w-0 flex-1 truncate font-mono text-xs">
							{url}
						</code>
						<CopyButton value={url} label="Copy link" />
					</div>
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
