import { describe, expect, it } from "vitest";
import { type Config, createConfig, http, injected } from "wagmi";
import { mainnet } from "wagmi/chains";
import { keepConnectorsUnique, uniqueById } from "./uniqueConnectors";

const config = (): Config =>
	createConfig({
		chains: [mainnet],
		transports: { [mainnet.id]: http() },
		connectors: [],
	});

/** A connector for a wallet that announced itself, as wagmi makes one (id = its rdns). */
const announced = (c: Config, rdns: string) =>
	c._internal.connectors.setup(
		injected({ target: { id: rdns, name: rdns, provider: {} as never } }),
	);

describe("one connector per wallet", () => {
	it("keeps the first of each id, in order", () => {
		expect(
			uniqueById([
				{ id: "io.rabby", n: 1 },
				{ id: "io.metamask", n: 2 },
				{ id: "io.rabby", n: 3 },
			]),
		).toEqual([
			{ id: "io.rabby", n: 1 },
			{ id: "io.metamask", n: 2 },
		]);
	});

	it("drops the copies wagmi adds when its provider mounts again", () => {
		const c = config();
		keepConnectorsUnique(c);
		keepConnectorsUnique(c); // once per config
		const rabby = announced(c, "io.rabby");
		const metamask = announced(c, "io.metamask");
		c._internal.connectors.setState([rabby, metamask]);
		// what a second mount does: the same wallets appended again
		c._internal.connectors.setState((now) => [
			...now,
			announced(c, "io.rabby"),
			announced(c, "io.metamask"),
		]);
		expect(c.connectors.map((x) => x.id)).toEqual(["io.rabby", "io.metamask"]);
		// the first, possibly connected, instance is the one kept
		expect(c.connectors[0]?.uid).toBe(rabby.uid);
	});
});
