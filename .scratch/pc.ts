import { keccak256, toHex } from "viem";
import { PRECOMPILES, RAW_ACTION_TOPIC, SEND_RAW_ACTION_SELECTOR } from "/Users/ashwin/work/hl-tools/packages/hl-core/src/rules/index.ts";
import { encodePrecompileInput, queryPrecompile } from "/Users/ashwin/work/hl-tools/packages/hl-core/src/corewriter/precompiles.ts";
console.log("topic ok", keccak256(toHex("RawAction(address,bytes)")) === RAW_ACTION_TOPIC, "selector", keccak256(toHex("sendRawAction(bytes)")).slice(0,10), SEND_RAW_ACTION_SELECTOR);
const HLP = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";
const inputs: Record<string, Record<string,string>> = {
  position: { user: HLP, perp: "0" }, spotBalance: { user: HLP, token: "0" }, vaultEquity: { user: "0x677d831aef5328190852e24f13c46cac05f984e7", vault: HLP },
  withdrawable: { user: HLP }, delegations: { user: "0x5ac99df645f3414876c816caa18b2d234024b487" }, delegatorSummary: { user: "0x5ac99df645f3414876c816caa18b2d234024b487" },
  markPx: { perp: "0" }, oraclePx: { perp: "0" }, spotPx: { spot: "107" }, l1BlockNumber: {}, perpAssetInfo: { perp: "0" }, spotInfo: { spot: "107" },
  tokenInfo: { token: "150" }, tokenSupply: { token: "150" }, bbo: { asset: "0" }, accountMarginSummary: { perpDexIndex: "0", user: HLP }, coreUserExists: { user: HLP }, position2: { user: HLP, perp: "0" },
};
for (const spec of PRECOMPILES) {
  const enc = encodePrecompileInput(spec, inputs[spec.key] ?? {});
  const q = await queryPrecompile("https://rpc.hyperliquid.xyz/evm", spec, enc.data!, { perpSzDecimals: 5, spotBaseSzDecimals: 2, tokenWeiDecimals: 8 });
  const d = q.decoded;
  console.log(spec.key, q.exchange.failure ? JSON.stringify(q.exchange.failure) : d?.kind === "error" ? "DECODE " + d.message : JSON.stringify(d?.kind === "tuple" ? d.values.map(v=>`${v.name}=${v.human ?? v.raw}`) : d?.kind==="array" ? `${d.rows.length} rows ${JSON.stringify(d.rows[0]?.map(v=>v.raw))}` : d).slice(0, 300));
  await new Promise(r => setTimeout(r, 700));
}
