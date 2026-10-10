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
	type Proposal,
	type Receipt,
	type Sig,
	stringifyJson,
	toPlain,
	tryParseJson,
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

export function withReceipt(p: Proposal, receipt: Receipt): Proposal {
	return { ...p, receipt };
}
