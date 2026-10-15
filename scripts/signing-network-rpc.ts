/**
 * Serves the stand-in behind the signing network on this machine.
 *
 *   bun run rpc:1337              → http://localhost:3337/rpc
 *   PORT=4000 bun run rpc:1337    → another port
 *
 * Put the link in `.env` as VITE_CHAIN_1337_RPC_URL and restart the dev
 * server. It answers "I am chain 1337" and a few fixed reads, refuses every
 * transaction and logs nothing (see src/lib/signingRpc.ts).
 */
import { createServer } from "node:http";
import { answerSigningRpc } from "../src/lib/signingRpc.ts";

const port = Number(process.env.PORT ?? 3337);
const cors = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "content-type",
	"access-control-allow-methods": "POST, OPTIONS",
};

createServer((req, res) => {
	if (req.method === "OPTIONS") {
		res.writeHead(204, cors).end();
		return;
	}
	if (req.method !== "POST") {
		res
			.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...cors })
			.end("The hl-tools signing network (chain 1337). Wallets post JSON-RPC here; nothing can be sent on it.\n");
		return;
	}
	const chunks: Buffer[] = [];
	req.on("data", (c: Buffer) => {
		// a wallet's questions are a few hundred bytes; anything large is not one
		if (chunks.reduce((n, x) => n + x.length, 0) < 100_000) chunks.push(c);
	});
	req.on("end", () => {
		let body: unknown = null;
		try {
			body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			body = null;
		}
		res
			.writeHead(200, { "content-type": "application/json", ...cors })
			.end(JSON.stringify(answerSigningRpc(body)));
	});
}).listen(port, "localhost", () => {
	console.log(`signing network (chain 1337): http://localhost:${port}/rpc`);
});
