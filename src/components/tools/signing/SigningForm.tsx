import { SIGNING_SAMPLES, stringifyJson, tryParseJson } from "@hl-tools/core";
import { useId } from "react";
import { Field, Select, TextArea, TextInput } from "#/components/hub/layout";
import { Button } from "#/components/ui/button";
import type { Parsed, SigningInput } from "./model";

export function sampleInput(id: string): SigningInput | null {
	const s = SIGNING_SAMPLES.find((x) => x.id === id);
	if (!s) return null;
	return {
		text: s.requestBody,
		nonce: "",
		vaultAddress: "",
		expiresAfter: "",
		signature: "",
		expectedSigner: s.expectedSigner,
	};
}

export function SigningForm({
	value,
	onChange,
	parsed,
	compact = false,
	label = "Action or request body",
	onSample,
}: {
	value: SigningInput;
	onChange: (v: SigningInput) => void;
	parsed: Parsed;
	compact?: boolean;
	label?: string;
	onSample?: (id: string) => void;
}) {
	const id = useId();
	const set = <K extends keyof SigningInput>(k: K, v: SigningInput[K]) =>
		onChange({ ...value, [k]: v });
	const fromBody = parsed.kind === "ok" ? parsed.effective.fromBody : null;
	const eff = parsed.kind === "ok" ? parsed.effective : null;
	const formattable = tryParseJson(value.text).ok;
	const reformat = (indent: number) => {
		const r = tryParseJson(value.text);
		if (r.ok) set("text", stringifyJson(r.node, indent));
	};
	const fieldErr = (k: keyof SigningInput) =>
		parsed.kind === "field-error" && parsed.field === k
			? parsed.message
			: undefined;
	return (
		<div className="space-y-4">
			{onSample && (
				<Field
					label="Load a known-good sample"
					htmlFor={`${id}-sample`}
					hint="Each sample is a Python SDK signing vector; its signature recovers to the SDK's public test address."
				>
					<Select
						id={`${id}-sample`}
						value={
							SIGNING_SAMPLES.find((x) => x.requestBody === value.text)?.id ??
							""
						}
						onChange={(e) => {
							if (e.target.value) onSample(e.target.value);
						}}
					>
						<option value="">Choose a sample…</option>
						{SIGNING_SAMPLES.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label} · {s.network}
							</option>
						))}
					</Select>
				</Field>
			)}
			<Field
				label={label}
				trailing={
					<span className="flex gap-1">
						{/* Both keep key order and number lexemes, so the bytes hashed never change. */}
						<Button
							type="button"
							size="xs"
							variant="outline"
							disabled={!formattable}
							onClick={() => reformat(2)}
							title="Pretty-print the JSON (key order and number spelling are kept)"
						>
							Format
						</Button>
						<Button
							type="button"
							size="xs"
							variant="outline"
							disabled={!formattable}
							onClick={() => reformat(0)}
							title="Put the JSON on one line"
						>
							Minify
						</Button>
					</span>
				}
				htmlFor={`${id}-text`}
				error={parsed.kind === "json-error" ? parsed.error.message : undefined}
				hint={
					eff?.isEnvelope
						? "Full request body detected: nonce, signature, vaultAddress and expiresAfter are read from it unless set below."
						: "Paste the `action` object or the whole POST /exchange body. Parsed locally, keeping key order and number lexemes."
				}
			>
				<TextArea
					id={`${id}-text`}
					value={value.text}
					onChange={(e) => set("text", e.target.value)}
					rows={compact ? 10 : 14}
					placeholder={
						'{\n  "type": "order",\n  "orders": [ … ],\n  "grouping": "na"\n}'
					}
					aria-invalid={parsed.kind === "json-error"}
					data-private
				/>
			</Field>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field
					label="Nonce"
					htmlFor={`${id}-nonce`}
					error={fieldErr("nonce")}
					hint={
						fromBody?.nonce && eff?.nonce !== null
							? `From request body: ${eff?.nonce}`
							: "ms timestamp; L1 actions hash it"
					}
					trailing={
						!value.nonce && !fromBody?.nonce ? (
							<Button
								type="button"
								size="xs"
								variant="outline"
								onClick={() => set("nonce", String(Date.now()))}
								title="Fill in the current time in milliseconds, as a client would"
							>
								Use now
							</Button>
						) : undefined
					}
				>
					<TextInput
						id={`${id}-nonce`}
						mono
						inputMode="numeric"
						value={value.nonce}
						onChange={(e) => set("nonce", e.target.value)}
						placeholder={fromBody?.nonce ? String(eff?.nonce) : "1790000000000"}
					/>
				</Field>
				<Field
					label="expiresAfter (optional)"
					htmlFor={`${id}-exp`}
					error={fieldErr("expiresAfter")}
					hint={
						fromBody?.expiresAfter
							? `From request body: ${eff?.expiresAfter}`
							: "L1 only; appended to the hash preimage"
					}
				>
					<TextInput
						id={`${id}-exp`}
						mono
						inputMode="numeric"
						value={value.expiresAfter}
						onChange={(e) => set("expiresAfter", e.target.value)}
						placeholder="—"
					/>
				</Field>
				<Field
					label="vaultAddress (optional)"
					htmlFor={`${id}-vault`}
					error={fieldErr("vaultAddress")}
					hint={
						fromBody?.vaultAddress
							? `From request body: ${eff?.vaultAddress}`
							: "Vault or sub-account the master signs for"
					}
					className="sm:col-span-2"
				>
					<TextInput
						id={`${id}-vault`}
						mono
						value={value.vaultAddress}
						onChange={(e) => set("vaultAddress", e.target.value)}
						placeholder="0x…"
					/>
				</Field>
			</div>
			{!compact && (
				<div className="grid grid-cols-1 gap-3">
					<Field
						label="Signature (optional)"
						htmlFor={`${id}-sig`}
						hint={
							fromBody?.signature
								? "From request body."
								: 'Paste {"r","s","v"} or a 65-byte hex signature to recover the signer.'
						}
					>
						<TextArea
							id={`${id}-sig`}
							rows={3}
							className="min-h-0"
							value={value.signature}
							onChange={(e) => set("signature", e.target.value)}
							placeholder='{"r":"0x…","s":"0x…","v":27}'
							data-private
						/>
					</Field>
					<Field
						label="Expected signer (optional)"
						htmlFor={`${id}-expected`}
						hint="Your wallet or agent address — compared with the recovered signer."
					>
						<TextInput
							id={`${id}-expected`}
							mono
							value={value.expectedSigner}
							onChange={(e) => set("expectedSigner", e.target.value)}
							placeholder="0x…"
						/>
					</Field>
				</div>
			)}
		</div>
	);
}
