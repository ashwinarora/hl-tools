/**
 * Submitting a signed envelope: one POST to the exchange endpoint from the
 * browser, and the receipt that goes back into the proposal document.
 */
import {
	type EnvelopeRequest,
	type ErrorExplanation,
	exchangeRequestBody,
	explainExchangeError,
	fromPlain,
	type Network,
	networkConfig,
	type PlainJson,
	type PlainObject,
	type Proposal,
	type Receipt,
	type Sig,
	stringifyJson,
	toPlain,
	tryParseJson,
	userActionBody,
} from "@hl-tools/core";

export function exchangeUrl(network: Network): string {
	return `${networkConfig(network).apiUrl}/exchange`;
}

/** The exact text POSTed: bigint-safe, canonical envelope, trimmed inner signatures. */
export function exchangeBodyText(
	request: EnvelopeRequest,
	outerSignature: Sig,
): string {
	return stringifyJson(
		fromPlain(exchangeRequestBody(request, outerSignature)),
		0,
	);
}

export interface SubmitResult {
	readonly receipt: Receipt;
	readonly explained: ErrorExplanation;
}

/**
 * HTTP errors and error bodies never throw: they become a receipt the page can
 * explain. Only a request that never got an answer rejects.
 */
export async function submitEnvelope(
	network: Network,
	request: EnvelopeRequest,
	outerSignature: Sig,
	deps: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<SubmitResult> {
	const doFetch = deps.fetch ?? fetch;
	const res = await doFetch(exchangeUrl(network), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: exchangeBodyText(request, outerSignature),
	});
	const text = await res.text();
	const parsed = tryParseJson(text);
	// the exchange answers with JSON; anything else (a proxy's HTML, an empty body) is kept verbatim
	const response: PlainJson = parsed.ok ? toPlain(parsed.node) : text;
	const receipt: Receipt = {
		submittedAt: (deps.now ?? Date.now)(),
		signatureChainId: request.action.signatureChainId,
		outerSignature,
		httpStatus: res.status,
		response,
	};
	return { receipt, explained: explainExchangeError(response, res.status) };
}

/**
 * What one answer to a send means for its proposal:
 *
 *   accepted  Hyperliquid carried it out.
 *   refused   Hyperliquid answered with a reason: the number is used up.
 *   used      Hyperliquid answered that the number was used already
 *             ("duplicate nonce"): an earlier attempt most likely went
 *             through, its answer lost on the way.
 *   unclear   No answer, or not Hyperliquid's (an HTTP status other than 200,
 *             a body that is not its answer): whether it went through is not
 *             known. Sending the same proposal again is safe, because
 *             Hyperliquid takes a proposal's number once.
 */
export type SendAnswer = "accepted" | "refused" | "used" | "unclear";

export function sendAnswer(e: ErrorExplanation): SendAnswer {
	if (e.id === "ok") return "accepted";
	if (e.source === "http") return "unclear";
	if (e.id === "nonce-duplicate") return "used";
	return "refused";
}

/** What came back instead of Hyperliquid's answer, in a few words. */
export function unclearDetail(receipt: Receipt | null): string {
	if (!receipt) return "No answer reached this page.";
	const body =
		typeof receipt.response === "string"
			? receipt.response.trim()
			: receipt.response === null
				? ""
				: stringifyJson(fromPlain(receipt.response), 0);
	const said =
		body && body.length <= 80 && !/[<>]/.test(body) ? `: ${body}` : "";
	return receipt.httpStatus === 200
		? "What came back was not Hyperliquid's answer."
		: `The answer was HTTP ${receipt.httpStatus}${said}.`;
}

export function withReceipt(p: Proposal, receipt: Receipt): Proposal {
	return { ...p, receipt };
}

export interface UserActionResult {
	readonly httpStatus: number;
	readonly response: PlainJson;
	readonly explained: ErrorExplanation;
	/** Hyperliquid took it. */
	readonly ok: boolean;
}

/**
 * Submitting a user-signed action for the account that signed it (no
 * envelope): one POST. As with `submitEnvelope`, an HTTP error or an error
 * body is an answer, not a throw. A request that never got an answer rejects,
 * and then nobody knows whether Hyperliquid took it: the caller has to look.
 */
export async function submitUserAction(
	network: Network,
	action: PlainObject,
	signature: Sig,
	deps: { fetch?: typeof fetch } = {},
): Promise<UserActionResult> {
	const doFetch = deps.fetch ?? fetch;
	const res = await doFetch(exchangeUrl(network), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: stringifyJson(fromPlain(userActionBody(action, signature)), 0),
	});
	const text = await res.text();
	const parsed = tryParseJson(text);
	const response: PlainJson = parsed.ok ? toPlain(parsed.node) : text;
	const explained = explainExchangeError(response, res.status);
	return {
		httpStatus: res.status,
		response,
		explained,
		ok: explained.id === "ok",
	};
}
