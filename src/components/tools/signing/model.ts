import {
	type Inspection,
	inspectAction,
	type JsonNode,
	JsonParseError,
	type Network,
	parseJson,
	splitRequestBody,
} from "@hl-tools/core";
import { useEffect, useState } from "react";

export interface SigningInput {
	/** Action JSON or a full exchange request body. */
	text: string;
	nonce: string;
	vaultAddress: string;
	expiresAfter: string;
	signature: string;
	expectedSigner: string;
}

export const EMPTY_INPUT: SigningInput = {
	text: "",
	nonce: "",
	vaultAddress: "",
	expiresAfter: "",
	signature: "",
	expectedSigner: "",
};

export interface Effective {
	action: JsonNode;
	nonce: bigint | null;
	vaultAddress: string | null;
	expiresAfter: bigint | null;
	signature: unknown;
	/** Which values came from a pasted request body rather than the fields. */
	fromBody: {
		nonce: boolean;
		vaultAddress: boolean;
		expiresAfter: boolean;
		signature: boolean;
	};
	isEnvelope: boolean;
}

export type Parsed =
	| { kind: "empty" }
	| { kind: "json-error"; error: JsonParseError }
	| { kind: "field-error"; field: keyof SigningInput; message: string }
	| { kind: "ok"; effective: Effective };

const INT_RE = /^\d+$/;

function parseSignatureField(text: string): unknown {
	const t = text.trim();
	if (!t) return undefined;
	if (t.startsWith("{")) {
		try {
			return JSON.parse(t);
		} catch {
			return t;
		}
	}
	return t;
}

export function parseInput(input: SigningInput): Parsed {
	if (!input.text.trim()) return { kind: "empty" };
	let node: JsonNode;
	try {
		node = parseJson(input.text);
	} catch (e) {
		if (e instanceof JsonParseError) return { kind: "json-error", error: e };
		throw e;
	}
	const parts = splitRequestBody(node);
	const nonceText = input.nonce.trim();
	if (nonceText && !INT_RE.test(nonceText)) {
		return {
			kind: "field-error",
			field: "nonce",
			message: "Nonce must be a non-negative integer (milliseconds).",
		};
	}
	const expText = input.expiresAfter.trim();
	if (expText && !INT_RE.test(expText)) {
		return {
			kind: "field-error",
			field: "expiresAfter",
			message: "expiresAfter must be a non-negative integer (milliseconds).",
		};
	}
	const vault = input.vaultAddress.trim();
	if (vault && !/^0x[0-9a-fA-F]{40}$/.test(vault)) {
		return {
			kind: "field-error",
			field: "vaultAddress",
			message: "vaultAddress must be a 0x-prefixed 20-byte address.",
		};
	}
	const sigField = parseSignatureField(input.signature);
	return {
		kind: "ok",
		effective: {
			action: parts.action,
			nonce: nonceText ? BigInt(nonceText) : (parts.nonce ?? null),
			vaultAddress: vault || parts.vaultAddress || null,
			expiresAfter: expText ? BigInt(expText) : (parts.expiresAfter ?? null),
			signature: sigField ?? parts.signature,
			fromBody: {
				nonce: !nonceText && parts.nonce !== undefined,
				vaultAddress: !vault && !!parts.vaultAddress,
				expiresAfter:
					!expText &&
					parts.expiresAfter !== undefined &&
					parts.expiresAfter !== null,
				signature: sigField === undefined && parts.signature !== undefined,
			},
			isEnvelope: parts.isEnvelope,
		},
	};
}

/** Run the inspection whenever the parsed input or network changes. */
export function useInspection(
	parsed: Parsed,
	network: Network,
): Inspection | null {
	const [result, setResult] = useState<Inspection | null>(null);
	useEffect(() => {
		if (parsed.kind !== "ok") {
			setResult(null);
			return;
		}
		let cancelled = false;
		const e = parsed.effective;
		void inspectAction({
			action: e.action,
			nonce: e.nonce,
			network,
			vaultAddress: e.vaultAddress,
			expiresAfter: e.expiresAfter,
			signature: e.signature,
		}).then((r) => {
			if (!cancelled) setResult(r);
		});
		return () => {
			cancelled = true;
		};
	}, [parsed, network]);
	return result;
}

/** JSON.stringify that renders bigint as a decimal string. */
export function stringifyTyped(value: unknown): string {
	return JSON.stringify(
		value,
		(_k, v) => (typeof v === "bigint" ? v.toString() : v),
		2,
	);
}
