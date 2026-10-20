import { useNavigate } from "@tanstack/react-router";
import { CornerDownLeft } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { detectInput } from "#/lib/detect";
import { tool } from "#/lib/tools";
import { cn } from "#/lib/utils";
import { useHandoffStore } from "#/store/handoffStore";
import { TOOLS_TILE } from "./copy";

/**
 * The paste-anything box: detection is local (`detectInput`), the value is
 * handed to the tool through the handoff store, never through the URL.
 */
export function PasteBox({ className }: { className?: string }) {
	const id = useId();
	const [value, setValue] = useState("");
	const detection = useMemo(() => detectInput(value), [value]);
	const navigate = useNavigate();
	const send = useHandoffStore((s) => s.send);
	const go = () => {
		if (!detection) return;
		send(detection.tool, value.trim());
		void navigate({ to: tool(detection.tool).path });
	};
	return (
		<form
			className={cn("min-w-0", className)}
			onSubmit={(e) => {
				e.preventDefault();
				go();
			}}
		>
			<label htmlFor={id} className="sr-only">
				Paste a symbol, address, transaction hash, CoreWriter bytes, signed
				payload, multi-sig request or proposal, exchange response or RPC URL
			</label>
			<div className="flex items-center gap-1.5 rounded-xl border border-border-strong bg-background p-1 transition-colors focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
				<input
					id={id}
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={TOOLS_TILE.placeholder}
					className="h-9 min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] outline-none placeholder:text-subtle-foreground focus-visible:outline-none"
					spellCheck={false}
					autoComplete="off"
					data-private
				/>
				<button
					type="submit"
					disabled={!detection}
					className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-foreground px-3 text-[13px] font-medium text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
				>
					{detection ? `Open ${tool(detection.tool).short}` : "Open"}
					<CornerDownLeft className="size-3.5" aria-hidden />
				</button>
			</div>
			<p
				className="mt-1.5 min-h-4 text-[11px] sm:truncate leading-4 text-muted-foreground"
				aria-live="polite"
			>
				{value.trim()
					? detection
						? // the detector's own line, in the Multisig's word for sending
							detection.reason.replace(/\bsubmit\b/, "send")
						: TOOLS_TILE.unknown
					: TOOLS_TILE.idle}
			</p>
		</form>
	);
}
