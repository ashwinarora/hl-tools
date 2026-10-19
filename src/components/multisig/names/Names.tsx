/**
 * The nicknames of one treasury, for everything rendered inside it. A screen
 * about a treasury (its page, a proposal of it, the propose form) wraps
 * itself in `TreasuryNames`; `Who` then shows an address with its nickname.
 * Outside such a screen `Who` shows the plain address: a nickname is never
 * carried from one treasury to another.
 */
import type { Address, Network } from "@hl-tools/core";
import { Pencil, Tag as TagIcon } from "lucide-react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { cn } from "#/lib/utils";
import { RELAY_COPY } from "../model/relay/copy";
import { canNickname, type Nickname } from "../model/relay/nicknames";
import { shortAddress } from "../model/stage";
import { localDateTime } from "../model/time";
import { useTreasuries } from "../relay/queries";
import { useRelay } from "../relay/useRelay";
import { NicknameDialog } from "./NicknameDialog";
import { useNicknames } from "./useNicknames";

export interface NamesValue {
	readonly network: Network;
	readonly treasury: Address;
	/** The signed-in wallet, when the relay is in use. */
	readonly me: Address | null;
	/** The nickname of an address in this treasury, if it has one. */
	of(address: string): Nickname | null;
	/** Whether the signed-in wallet may give this address a nickname here. */
	canName(address: string): boolean;
	/** Open the nickname dialog for an address. */
	edit(address: Address, suggestion?: string): void;
	/** Every nicknamed address of the treasury, for pickers. */
	readonly all: ReadonlyMap<Address, Nickname>;
}

const NamesContext = createContext<NamesValue | null>(null);

export function useNames(): NamesValue | null {
	return useContext(NamesContext);
}

export function TreasuryNames({
	network,
	treasury,
	signers,
	children,
}: {
	network: Network;
	treasury: Address;
	/** The signer list the page trusts: the chain's when it is known, the relay's copy until then. */
	signers: readonly Address[];
	children: ReactNode;
}) {
	const relay = useRelay();
	const me = relay.wallet;
	const all = useNicknames(network, treasury, signers);
	const [editing, setEditing] = useState<{
		address: Address;
		suggestion?: string;
	} | null>(null);
	const of = useCallback(
		(address: string) => all.get(address.toLowerCase() as Address) ?? null,
		[all],
	);
	const canName = useCallback(
		(address: string) =>
			canNickname(me, address.toLowerCase() as Address, signers),
		[me, signers],
	);
	const edit = useCallback(
		(address: Address, suggestion?: string) =>
			setEditing({ address: address.toLowerCase() as Address, suggestion }),
		[],
	);
	const value = useMemo<NamesValue>(
		() => ({ network, treasury, me, of, canName, edit, all }),
		[network, treasury, me, of, canName, edit, all],
	);
	return (
		<NamesContext.Provider value={value}>
			{children}
			{editing && (
				<NicknameDialog
					network={network}
					treasury={treasury}
					address={editing.address}
					suggestion={editing.suggestion}
					own={editing.address === me}
					current={all}
					onClose={() => setEditing(null)}
				/>
			)}
		</NamesContext.Provider>
	);
}

/** Who gave a nickname and when, for the hover text and the full form. */
export function nicknameOrigin(
	n: Nickname,
	address: string,
	names: NamesValue,
): string {
	const by =
		n.setBy === names.me
			? "by you"
			: n.setBy === address.toLowerCase()
				? "by this address itself"
				: `by ${names.of(n.setBy)?.name ?? shortAddress(n.setBy)}`;
	return `Nickname given ${by} on ${localDateTime(n.setAt)}. ${RELAY_COPY.nicknameWhere}`;
}

/**
 * An address, with its nickname in this treasury when it has one. The address
 * is always there: a nickname is a label somebody typed, and it is the
 * address that gets signed.
 *
 * `full` is for the places where a wallet prompt follows: the whole address
 * and who gave the nickname are spelled out instead of left to a hover.
 */
export function Who({
	address,
	full = false,
	editable = false,
	className,
}: {
	address: string;
	full?: boolean;
	/** Offer the small button that gives or changes the nickname. */
	editable?: boolean;
	className?: string;
}) {
	const names = useNames();
	const nick = names?.of(address) ?? null;
	const can = editable && !!names?.canName(address);
	const shown = full ? address : shortAddress(address);
	return (
		<span
			className={cn(
				"inline-flex max-w-full flex-wrap items-baseline gap-x-1.5",
				className,
			)}
		>
			{nick && names && (
				<span
					className="font-medium [overflow-wrap:anywhere]"
					title={nicknameOrigin(nick, address, names)}
				>
					{nick.name}
				</span>
			)}
			<span
				className={cn(
					"font-mono [overflow-wrap:anywhere]",
					nick ? "text-[0.92em] text-muted-foreground" : undefined,
				)}
				title={full ? undefined : address}
			>
				{shown}
			</span>
			{can && names && (
				<button
					type="button"
					onClick={(e) => {
						e.preventDefault();
						e.stopPropagation();
						names.edit(address as Address);
					}}
					aria-label={
						nick
							? `Change the nickname of ${address}`
							: `Give ${address} a nickname`
					}
					title={nick ? "Change the nickname" : "Give this address a nickname"}
					className="inline-flex size-5 shrink-0 items-center justify-center self-center rounded text-subtle-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
				>
					{nick ? (
						<Pencil className="size-3" aria-hidden />
					) : (
						<TagIcon className="size-3" aria-hidden />
					)}
				</button>
			)}
			{full && nick && names && (
				<span className="basis-full text-xs text-subtle-foreground">
					{nicknameOrigin(nick, address, names)}
				</span>
			)}
		</span>
	);
}

/**
 * `TreasuryNames` for a place that only knows which treasury a row belongs
 * to (a list spanning treasuries): the signer list is the relay's stored copy.
 */
export function NamesFor({
	network,
	treasury,
	children,
}: {
	network: Network;
	treasury: Address;
	children: ReactNode;
}) {
	const { rows } = useTreasuries();
	const signers =
		rows.find((t) => t.network === network && t.address === treasury)
			?.signers ?? NO_SIGNERS;
	return (
		<TreasuryNames network={network} treasury={treasury} signers={signers}>
			{children}
		</TreasuryNames>
	);
}

const NO_SIGNERS: readonly Address[] = [];
