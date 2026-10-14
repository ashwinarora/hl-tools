/** Wallet failures in plain words. Pure: takes whatever a wallet call threw. */

function chain(e: unknown): unknown[] {
	const out: unknown[] = [];
	let cur: unknown = e;
	for (let i = 0; cur && i < 6; i++) {
		out.push(cur);
		cur = (cur as { cause?: unknown }).cause;
	}
	return out;
}

const nameOf = (e: unknown) => String((e as { name?: unknown })?.name ?? "");
const codeOf = (e: unknown) => (e as { code?: unknown })?.code;
const messageOf = (e: unknown) =>
	e instanceof Error
		? e.message
		: typeof (e as { message?: unknown })?.message === "string"
			? String((e as { message: string }).message)
			: String(e);

export type WalletErrorKind =
	| "rejected"
	| "switch-unsupported"
	| "chain-unknown"
	| "other";

export interface WalletError {
	readonly kind: WalletErrorKind;
	readonly message: string;
}

/** `chainLabel` names the chain a switch was heading for, when there was one. */
export function describeWalletError(
	e: unknown,
	chainLabel?: string,
): WalletError {
	const links = chain(e);
	const to = chainLabel ? ` to ${chainLabel}` : "";
	if (
		links.some(
			(x) =>
				codeOf(x) === 4001 ||
				nameOf(x) === "UserRejectedRequestError" ||
				/user (rejected|denied)/i.test(messageOf(x)),
		)
	)
		return { kind: "rejected", message: "You declined in the wallet." };
	if (links.some((x) => nameOf(x) === "SwitchChainNotSupportedError"))
		return {
			kind: "switch-unsupported",
			message: `This wallet cannot switch chains from a page. Switch${to} in the wallet, then retry.`,
		};
	if (
		links.some(
			(x) => codeOf(x) === 4902 || nameOf(x) === "ChainNotConfiguredError",
		)
	)
		return {
			kind: "chain-unknown",
			message: `The wallet does not know this chain and would not add it. Add it${to ? ` (${chainLabel})` : ""} in the wallet, then retry.`,
		};
	const short = (links[0] as { shortMessage?: unknown })?.shortMessage;
	return {
		kind: "other",
		message: typeof short === "string" && short ? short : messageOf(e),
	};
}

const DECLINED = /user (rejected|denied)|rejected the request|declined|denied/i;
const SIGNER_PREFIX = /^The signer refused or failed: /;

/**
 * A signature the wallet did not give, as the core reports it ("The signer
 * refused or failed: …"), said once and plainly: a refusal or a closed
 * window as that, with what it means for the page (`after`); anything else
 * with the wallet's own words.
 */
export function signerFailure<
	T extends { readonly code: string; readonly message: string },
>(issues: readonly T[], after: string): T[] {
	return issues.map((i) =>
		i.code !== "signer.failed"
			? i
			: {
					...i,
					message: DECLINED.test(i.message)
						? `Your wallet did not sign (declined or closed). ${after}`
						: `Your wallet did not sign: ${i.message.replace(SIGNER_PREFIX, "")}`,
				},
	);
}
