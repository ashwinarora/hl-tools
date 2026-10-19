/**
 * Serves the stand-in behind the signing network on this machine, apart from
 * the app (which serves the same answers at `/rpc/1337`).
 *
 *   bun run rpc:1337              → http://localhost:3337/rpc
 *   PORT=4000 bun run rpc:1337    → another port
 *
 * It answers "I am chain 1337" and a few fixed reads, refuses every
 * transaction and logs nothing (see src/lib/signingRpc.ts).
 */
import { createServer } from "node:http";
import { signingRpcResponse } from "../src/lib/signingRpc.ts";

const port = Number(process.env.PORT ?? 3337);

createServer((req, res) => {
	const chunks: Buffer[] = [];
	req.on("data", (c: Buffer) => chunks.push(c));
	req.on("end", async () => {
		const method = req.method ?? "GET";
		const request = new Request(`http://localhost:${port}${req.url ?? "/"}`, {
			method,
			body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
		});
		const answer = await signingRpcResponse(request);
		res.writeHead(answer.status, Object.fromEntries(answer.headers));
		res.end(Buffer.from(await answer.arrayBuffer()));
	});
}).listen(port, "localhost", () => {
	console.log(`signing network (chain 1337): http://localhost:${port}/rpc`);
});
