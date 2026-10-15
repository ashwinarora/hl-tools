import type { Address, Network } from "@hl-tools/core";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { RELAY_COPY } from "../model/relay/copy";
import {
	NICKNAME_MAX,
	type Nickname,
	nicknameRefusal,
	nicknameText,
} from "../model/relay/nicknames";
import { useSetNickname } from "./useNicknames";

/**
 * Give an address a nickname inside one treasury, change it, or take it
 * away. Nothing is signed: the nickname is a label the treasury's signers
 * share, and the address stays visible wherever the nickname is shown.
 */
export function NicknameDialog({
	network,
	treasury,
	address,
	suggestion,
	own,
	current,
	onClose,
}: {
	network: Network;
	treasury: Address;
	address: Address;
	/** Offered when the address has no nickname yet (a name the reader already used in this browser). */
	suggestion?: string;
	/** The address is the signed-in wallet's own. */
	own: boolean;
	current: ReadonlyMap<Address, Nickname>;
	onClose: () => void;
}) {
	const had = current.get(address) ?? null;
	const [draft, setDraft] = useState(had?.name ?? suggestion ?? "");
	const [busy, setBusy] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	const save = useSetNickname();
	const isTreasury = address === treasury;
	const text = nicknameText(draft);
	const problem =
		text.length === 0
			? null
			: nicknameRefusal({ raw: draft, address, current });

	const send = async (name: string | null) => {
		setBusy(true);
		setRefused(null);
		const issue = await save({ network, treasury, address, name });
		setBusy(false);
		if (issue) setRefused(issue.message);
		else onClose();
	};

	return (
		<Dialog open onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="w-[calc(100%-2rem)] max-w-md">
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						if (text.length > 0 && !problem && !busy) void send(text);
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{isTreasury
								? "Nickname for this treasury"
								: own
									? "Your nickname in this treasury"
									: "Nickname for this address"}
						</DialogTitle>
						<DialogDescription asChild>
							<div className="grid gap-2 text-left">
								<span className="font-mono text-xs [overflow-wrap:anywhere]">
									{address}
								</span>
								<span>
									{RELAY_COPY.nicknameScope}{" "}
									{own
										? RELAY_COPY.nicknameOwn
										: isTreasury
											? RELAY_COPY.nicknameTreasury
											: RELAY_COPY.nicknameOther}
								</span>
							</div>
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-1.5">
						<label
							htmlFor="nickname"
							className="text-xs font-medium text-muted-foreground"
						>
							Nickname
						</label>
						<Input
							id="nickname"
							name="nickname"
							autoComplete="off"
							autoFocus
							value={draft}
							maxLength={NICKNAME_MAX * 2}
							aria-invalid={!!problem || !!refused}
							aria-describedby="nickname-note"
							onChange={(e) => {
								setDraft(e.target.value);
								setRefused(null);
							}}
							placeholder={isTreasury ? "Operations" : "Auditor"}
						/>
						<p
							id="nickname-note"
							className={
								problem || refused
									? "text-xs text-danger"
									: "text-xs text-subtle-foreground"
							}
						>
							{refused ?? problem ?? RELAY_COPY.nicknameHint}
						</p>
					</div>
					<DialogFooter className="gap-2 sm:justify-between">
						{had ? (
							<Button
								type="button"
								variant="ghost"
								disabled={busy}
								onClick={() => void send(null)}
							>
								Remove the nickname
							</Button>
						) : (
							<span />
						)}
						<span className="flex gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={busy}
								onClick={onClose}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={busy || text.length === 0 || !!problem}
							>
								{busy ? "Saving…" : "Save"}
							</Button>
						</span>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
