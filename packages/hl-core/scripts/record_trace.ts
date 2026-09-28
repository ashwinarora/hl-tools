/**
 * Record a live trace into fixtures/trace/<name>.json for replay tests.
 *   bun packages/hl-core/scripts/record_trace.ts <name> <network> <txHash>
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildUniverse, InfoClient, type Network, networkConfig, rpcCall, traceTransaction } from "../src/index.ts";

const [name, network, tx] = process.argv.slice(2) as [string, Network, string];
const rpcUrl = networkConfig(network).evmRpcUrl;
const rpc: Record<string, unknown> = {};
const info: Record<string, unknown> = {};
const client = new InfoClient(network);
const meta = await client.metadata();
const universe = buildUniverse(network, meta.data, meta.observedAt);
const trace = await traceTransaction(network, tx, {
	rpc: async (m, p) => {
		const r = await rpcCall(rpcUrl, m, p);
		rpc[JSON.stringify([m, p])] = r.result ?? null;
		return r;
	},
	info: async (body) => {
		const res = await fetch(`${networkConfig(network).apiUrl}/info`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
		const json = await res.json();
		// Full-history ledger queries only need their earliest entries (responses
		// are ascending from startTime); keep fixtures small.
		info[JSON.stringify(body)] = body.startTime === 0 && Array.isArray(json) ? json.slice(0, 10) : json;
		return { body, response: json, error: null };
	},
	universe,
});
// Keep only the metadata the trace touched: the assets and tokens it referenced.
writeFileSync(
	join(import.meta.dir, "..", "fixtures", "trace", `${name}.json`),
	`${JSON.stringify({ network, tx, recordedAt: new Date().toISOString(), rpc, info, universeAssets: trace.kind === "ok" ? [...new Set(trace.actions.flatMap((a) => (a.decode.kind === "decoded" ? a.decode.fields.filter((f) => f.field.unit.kind === "asset").map((f) => Number(f.raw)) : [])))] : [] }, null, 1)}\n`,
);
console.log(name, trace.kind, trace.kind === "ok" ? trace.actions.map((a) => [a.decode.kind, a.observed?.evidence, a.observed?.headline, a.findings.map((f) => f.title)]) : "");
