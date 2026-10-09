/**
 * The local Supabase stack, for the relay's integration suite: where it is,
 * a database connection for setup and for looking behind the API, wallets
 * that sign in exactly as a browser wallet does, and a stand-in for
 * Hyperliquid's info endpoint so signer lookups are scripted.
 *
 * Every run uses fresh random keys and addresses, so runs never collide with
 * each other or with whatever a developer has in the local database.
 */
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Address } from "@hl-tools/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import {
	generatePrivateKey,
	type PrivateKeyAccount,
	privateKeyToAccount,
} from "viem/accounts";
import { generateSiweNonce } from "viem/siwe";
import { signIn } from "#/components/multisig/relay/session";

/** The site the local stack is configured for (supabase/config.toml). */
export const ORIGIN = "http://localhost:3000";

export interface Stack {
	readonly url: string;
	readonly key: string;
	readonly db: string;
}

let found: Stack | null = null;
export function stack(): Stack {
	if (found) return found;
	let out: string;
	try {
		out = execSync("supabase status -o json", {
			stdio: ["ignore", "pipe", "ignore"],
		}).toString();
	} catch {
		throw new Error(
			"The local Supabase stack is not running. Start it with `bun run db:start`.",
		);
	}
	const j = JSON.parse(out.slice(out.indexOf("{"))) as Record<string, string>;
	found = {
		url: j.API_URL as string,
		key: (j.PUBLISHABLE_KEY ?? j.ANON_KEY) as string,
		db: j.DB_URL as string,
	};
	return found;
}

export type Sql = ReturnType<typeof postgres>;
export function database(): Sql {
	return postgres(stack().db, { max: 2, onnotice: () => {} });
}

/** A client that keeps its session in memory, like a browser tab of its own. */
export function newClient(): SupabaseClient {
	const s = stack();
	const memory = new Map<string, string>();
	return createClient(s.url, s.key, {
		auth: {
			persistSession: true,
			autoRefreshToken: false,
			detectSessionInUrl: false,
			storage: {
				getItem: (k) => memory.get(k) ?? null,
				setItem: (k, v) => void memory.set(k, v),
				removeItem: (k) => void memory.delete(k),
			},
		},
	});
}

export interface TestWallet {
	readonly account: PrivateKeyAccount;
	/** Lowercase. */
	readonly address: Address;
	readonly client: SupabaseClient;
}

export function newAccount(): { account: PrivateKeyAccount; address: Address } {
	const account = privateKeyToAccount(generatePrivateKey());
	return { account, address: account.address.toLowerCase() as Address };
}

/** A fresh wallet, signed in to the relay through the same code the app uses. */
export async function newWallet(): Promise<TestWallet> {
	const { account, address } = newAccount();
	const client = newClient();
	const r = await signIn(
		client,
		{
			address: account.address,
			chainId: 999,
			signMessage: (message) => account.signMessage({ message }),
		},
		{ origin: ORIGIN, nonce: generateSiweNonce() },
	);
	if (!r.ok)
		throw new Error(`sign-in failed: ${r.issue.code} ${r.issue.message}`);
	return { account, address, client };
}

export type StubAnswer =
	| { readonly signers: readonly Address[]; readonly threshold: number }
	| "not-multisig"
	| "rate-limited"
	| "broken";

export interface InfoStub {
	/** As the database container reaches it. */
	readonly url: string;
	/** Every account asked about, in order. */
	readonly calls: Address[];
	answer(address: Address, a: StubAnswer): void;
	close(): Promise<void>;
}

/** Stands in for `POST /info {type: "userToMultiSigSigners"}`. Unknown accounts are "not a multi-sig". */
export async function infoStub(): Promise<InfoStub> {
	const answers = new Map<string, StubAnswer>();
	const calls: Address[] = [];
	const server: Server = createServer((req, res) => {
		let body = "";
		req.on("data", (c) => {
			body += c;
		});
		req.on("end", () => {
			let user = "";
			try {
				user = String((JSON.parse(body) as { user?: unknown }).user ?? "");
			} catch {}
			calls.push(user as Address);
			const a = answers.get(user) ?? "not-multisig";
			if (a === "rate-limited") {
				res.writeHead(429).end();
			} else if (a === "broken") {
				res
					.writeHead(502, { "content-type": "text/html" })
					.end("<html>bad gateway</html>");
			} else {
				res.writeHead(200, { "content-type": "application/json" }).end(
					a === "not-multisig"
						? "null"
						: JSON.stringify({
								authorizedUsers: a.signers,
								threshold: a.threshold,
							}),
				);
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://host.docker.internal:${port}/info`,
		calls,
		answer: (address, a) => void answers.set(address, a),
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

/**
 * Run the lookup worker until `done` holds (cron runs it too, every two
 * seconds; whichever gets the lock does the work).
 */
export async function untilWorker(
	sql: Sql,
	done: () => Promise<boolean>,
	ms = 15_000,
): Promise<void> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await done()) return;
		await sql`select private.run_lookups()`;
		if (await done()) return;
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("the lookup worker did not get there in time");
}

export async function until(
	done: () => boolean | Promise<boolean>,
	ms = 5_000,
): Promise<number> {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (await done()) return Date.now() - start;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error(`condition not met within ${ms} ms`);
}
