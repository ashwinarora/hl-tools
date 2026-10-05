/**
 * Record a short live WebSocket session into fixtures/ws/<name>.json.
 *   bun packages/hl-core/scripts/record_ws.ts <name> <network> <seconds> '<subscription json>'
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Network, networkConfig, SessionRecorder, sanitizeSession, serializeSession } from "../src/index.ts";

const [name, network, seconds, subJson] = process.argv.slice(2) as [string, Network, string, string];
const sub = JSON.parse(subJson) as Record<string, unknown>;
const url = networkConfig(network).wsUrl;
const rec = new SessionRecorder(network, url, String(sub.type), sub);
const ws = new WebSocket(url);
ws.onopen = () => {
	rec.push("event", "open");
	const msg = JSON.stringify({ method: "subscribe", subscription: sub });
	rec.push("out", msg);
	ws.send(msg);
};
ws.onmessage = (e) => rec.push("in", String(e.data));
setTimeout(() => {
	rec.push("event", "close 1000 (recording finished)");
	ws.close();
	const file = sanitizeSession(rec.toFile());
	writeFileSync(join(import.meta.dir, "..", "fixtures", "ws", `${name}.json`), `${serializeSession(file)}\n`);
	console.log(name, rec.size);
	process.exit(0);
}, Number(seconds) * 1000);
