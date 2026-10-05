"""
Snapshot trimmed Hyperliquid metadata for resolver fixtures.

    python3 packages/hl-core/scripts/snapshot_metadata.py

Perp universes are kept whole (a perp's asset ID is its position), spot
tokens/pairs are trimmed (they are keyed by explicit `index`), outcome meta is
trimmed to a handful of outcomes with their question.
"""
import json, time, urllib.request, pathlib

OUT = pathlib.Path(__file__).resolve().parent.parent / "fixtures" / "metadata"
OUT.mkdir(parents=True, exist_ok=True)
HOSTS = {"mainnet": "https://api.hyperliquid.xyz", "testnet": "https://api.hyperliquid-testnet.xyz"}
KEEP_TOKENS = {"USDC", "PURR", "HYPE", "USDT0", "UBTC", "USDH", "USDE"}
KEEP_DEXES = 3

def info(host, body):
    req = urllib.request.Request(host + "/info", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))

for net, host in HOSTS.items():
    perp_dexs = info(host, {"type": "perpDexs"})[:KEEP_DEXES]
    for d in perp_dexs:
        if d:
            for k in ("assetToStreamingOiCap", "subDeployers", "assetToFundingMultiplier", "assetToFundingInterestRate", "assetToFundingClamp"):
                d[k] = d.get(k, [])[:2]
    all_perp = info(host, {"type": "allPerpMetas"})[:KEEP_DEXES]
    for m in all_perp:
        m["marginTables"] = m.get("marginTables", [])[:1]
    spot = info(host, {"type": "spotMeta"})
    keep_idx = {t["index"] for t in spot["tokens"] if t["name"] in KEEP_TOKENS}
    pairs = [p for p in spot["universe"] if p["tokens"][0] in keep_idx and p["tokens"][1] in keep_idx]
    pairs += [p for p in spot["universe"] if p["index"] < 3 and p not in pairs]
    needed = {t for p in pairs for t in p["tokens"]}
    tokens = [t for t in spot["tokens"] if t["index"] in needed]
    outcome = info(host, {"type": "outcomeMeta"})
    qs = [q for q in outcome.get("questions", []) if len(q["namedOutcomes"]) >= 2][:1]
    q_outcomes = {o for q in qs for o in q["namedOutcomes"] + [q["fallbackOutcome"]]}
    outs = [o for o in outcome["outcomes"] if o["outcome"] in q_outcomes] + [o for o in outcome["outcomes"] if o["name"].startswith("template:")][:2]
    mids = info(host, {"type": "allMids"})
    keep_coins = {"BTC", "ETH", "HYPE", "PURR/USDC"} | {p["name"] for p in pairs} | {f"#{o['outcome'] * 10 + s}" for o in outs for s in (0, 1)}
    fixture = {
        "network": net,
        "observedAt": int(time.time() * 1000),
        "perpDexs": perp_dexs,
        "allPerpMetas": all_perp,
        "spotMeta": {"universe": sorted(pairs, key=lambda p: p["index"]), "tokens": tokens},
        "outcomeMeta": {"outcomes": outs, "questions": qs},
        "allMids": {k: v for k, v in mids.items() if k in keep_coins},
    }
    (OUT / f"{net}.json").write_text(json.dumps(fixture, indent=1) + "\n")
    print(net, "pairs", len(pairs), "tokens", len(tokens), "outcomes", len(outs), "dexes", len(perp_dexs))
