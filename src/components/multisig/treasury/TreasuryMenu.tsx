import type { Address, Network } from "@hl-tools/core";
import { Ellipsis, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { useMultisigDrafts } from "#/store/multisigDraftsStore";
import {
	treasuryKey,
	useMultisigPrefs,
	usePrefsHydrated,
} from "#/store/multisigPrefsStore";
import { HIDE_COPY, TOAST_MS } from "../model/toasts";
import { Tag } from "../shell/kit";

/**
 * The "⋯" beside a treasury's name: what concerns this browser's list only.
 * Hiding is one choice in a menu, never a button among sentences, and the
 * toast that says so offers Undo for a few seconds; what was half-filled
 * for the treasury goes only once the hiding stands.
 */
export function TreasuryMenu({
	network,
	address,
}: {
	network: Network;
	address: Address;
}) {
	const hydrated = usePrefsHydrated();
	const key = treasuryKey(network, address);
	const hidden = useMultisigPrefs((s) => s.hidden.includes(key));
	const setHidden = useMultisigPrefs((s) => s.setHidden);
	if (!hydrated) return null;

	const hide = () => {
		setHidden(network, address, true);
		let undone = false;
		// taken out of this browser's list for good: its half-filled forms go too
		const settle = () => {
			if (!undone && useMultisigPrefs.getState().hidden.includes(key))
				useMultisigDrafts.getState().dropFor(network, address);
		};
		toast(HIDE_COPY.hidden, {
			description: HIDE_COPY.hiddenLine,
			duration: TOAST_MS.undo,
			action: {
				label: HIDE_COPY.undo,
				onClick: () => {
					undone = true;
					setHidden(network, address, false);
				},
			},
			onAutoClose: settle,
			onDismiss: settle,
		});
	};
	const show = () => {
		setHidden(network, address, false);
		toast.success(HIDE_COPY.shown, { duration: TOAST_MS.done });
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					aria-label={HIDE_COPY.menuLabel}
					title={HIDE_COPY.menuLabel}
					className="inline-flex size-11 items-center justify-center rounded-md border border-border-strong bg-surface text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:size-[34px]"
				>
					<Ellipsis className="size-4" aria-hidden />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onSelect={hidden ? show : hide}>
					{hidden ? (
						<Eye className="mr-2 size-4" aria-hidden />
					) : (
						<EyeOff className="mr-2 size-4" aria-hidden />
					)}
					{hidden ? HIDE_COPY.show : HIDE_COPY.hide}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Beside the name while the treasury is hidden from this browser's list. */
export function HiddenTag({
	network,
	address,
}: {
	network: Network;
	address: Address;
}) {
	const hydrated = usePrefsHydrated();
	const hidden = useMultisigPrefs((s) =>
		s.hidden.includes(treasuryKey(network, address)),
	);
	if (!hydrated || !hidden) return null;
	return <Tag title={HIDE_COPY.tagTitle}>{HIDE_COPY.tag}</Tag>;
}
