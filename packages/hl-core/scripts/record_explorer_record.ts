/**
 * Build fixtures/multisig/explorer-record.json: what Hyperliquid's explorer
 * lists for a multi-sig account's own actions (`userDetails`), as the
 * "Hyperliquid's record" check reads it. Taken from two lab multi-sigs
 * whose lists are complete (under the explorer's cap), on testnet: for each
 * action type, the newest entry that was carried out and the newest that
 * was refused, and the entries of the mode switches posted in
 * mode-switch.json.
 *
 * Only public data is copied. An entry that names one of the personal
 * wallets used in testing (listed in labs/multisig/secrets, gitignored) is
 * left out, and the output is checked for them once more.
 *
 *   bun packages/hl-core/scripts/record_explorer_record.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ExplorerTx, explorerUserDetails } from "../src/index.ts";

const here = new URL(".", import.meta.url).pathname;
const SECRETS = join(here, "../../../labs/multisig/secrets");
const OUT = join(here, "../fixtures/multisig/explorer-record.json");

const ACCOUNTS = [
	"0xd821b07fbc8f718ff1eaaf041c284c631674b0d7",
	"0x0459f1862840f18fc3ae7f6872f4e499ad6ba8e7",
];

const read = (f: string) => JSON.parse(readFileSync(join(SECRETS, f), "utf8"));
/** Every address a personal wallet has: never written out. */
const personal = new Set<string>(
	JSON.stringify(read("rabby-accounts.json"))
		.toLowerCase()
		.match(/0x[0-9a-f]{40}/g) ?? [],
);

/** The posted mode switches of mode-switch.json: their entries are kept too, to be compared as posted. */
const pinned = new Set<number>(
	(
		JSON.parse(
			readFileSync(join(here, "../fixtures/multisig/mode-switch.json"), "utf8"),
		) as {
			requests: { request: { action: { payload: { action: { nonce: number } } } } }[];
		}
	).requests.map((r) => r.request.action.payload.action.nonce),
);

const accounts = [];
for (const account of ACCOUNTS) {
	const r = await explorerUserDetails("testnet", account);
	const own = r.data.txs.filter((t) => t.user === account);
	const kept: ExplorerTx[] = [];
	const seen = new Set<string>();
	for (const tx of own) {
		const named = JSON.stringify(tx).toLowerCase().match(/0x[0-9a-f]{40}(?![0-9a-f])/g) ?? [];
		if (named.some((a) => personal.has(a))) continue;
		const slot = `${tx.action.type}:${tx.error === null ? "ok" : "refused"}`;
		const paired = pinned.has(tx.action.nonce as number);
		if (seen.has(slot) && !paired) continue;
		seen.add(slot);
		kept.push(tx);
	}
	accounts.push({
		account,
		listed: r.data.txs.length,
		truncated: r.data.truncated,
		oldest: r.data.txs.at(-1)?.time ?? null,
		txs: kept,
	});
	await new Promise((done) => setTimeout(done, 1_500));
}

const text = JSON.stringify(
	{
		description:
			"Hyperliquid testnet explorer, `userDetails` for two lab multi-sig accounts (complete lists, under the cap), recorded by scripts/record_explorer_record.ts. Per account: how many entries the explorer listed, whether the list may be cut, the oldest entry's time, and for each action type the newest entry carried out and the newest refused (`error` set), as listed, plus the entries of the requests in mode-switch.json. A multi-sig's action is listed as its inner action under the multi-sig account. A mode switch is listed with its one-letter code (`abstraction` \"u\" or \"i\"), as Hyperliquid hashes it (mode-switch.json). Entries naming a non-lab wallet are left out.",
		network: "testnet",
		recordedAt: new Date().toISOString(),
		accounts,
	},
	null,
	"\t",
);
for (const a of personal)
	if (text.toLowerCase().includes(a)) throw new Error("a personal address made it into the fixture");
writeFileSync(OUT, `${text}\n`);
console.log(
	accounts.map((a) => `${a.account}: ${a.listed} listed, ${a.txs.length} kept`).join("\n"),
);
