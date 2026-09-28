"""
Generate signing vectors with the official hyperliquid-python-sdk.

Usage (from a checkout of hyperliquid-python-sdk with its deps installed):
    python packages/hl-core/scripts/gen_signing_vectors.py > packages/hl-core/fixtures/signing/python-sdk-vectors.json

The private key is the SDK's own public test key (tests/signing_test.py).
It is only used here, offline, to produce vectors; hl-core never signs.
"""
import json
import sys

import eth_account
import msgpack
from eth_account.messages import encode_typed_data, _hash_eip191_message
from eth_utils import to_hex

import hyperliquid
from hyperliquid.utils.signing import (
    action_hash,
    construct_phantom_agent,
    l1_payload,
    user_signed_payload,
    sign_l1_action,
    sign_user_signed_action,
    float_to_int_for_hashing,
    order_request_to_order_wire,
    order_wires_to_order_action,
    USD_SEND_SIGN_TYPES,
    WITHDRAW_SIGN_TYPES,
    USD_CLASS_TRANSFER_SIGN_TYPES,
    SEND_ASSET_SIGN_TYPES,
    SPOT_TRANSFER_SIGN_TYPES,
    TOKEN_DELEGATE_TYPES,
)
from hyperliquid.utils.types import Cloid

KEY = "0x0123456789012345678901234567890123456789012345678901234567890123"
wallet = eth_account.Account.from_key(KEY)
vectors = []

def digest_of(data):
    return to_hex(_hash_eip191_message(encode_typed_data(full_message=data)))

def l1(name, action, nonce, vault=None, expires=None, networks=(True, False), source="generated"):
    for is_mainnet in networks:
        h = action_hash(action, vault, nonce, expires)
        data = l1_payload(construct_phantom_agent(h, is_mainnet))
        sig = sign_l1_action(wallet, action, vault, nonce, expires, is_mainnet)
        vectors.append({
            "name": name,
            "source": source,
            "family": "l1",
            "network": "mainnet" if is_mainnet else "testnet",
            "action": action,
            "nonce": nonce,
            "vaultAddress": vault,
            "expiresAfter": expires,
            "msgpackHex": "0x" + msgpack.packb(action).hex(),
            "connectionId": to_hex(h),
            "digest": digest_of(data),
            "signature": sig,
            "signer": wallet.address.lower(),
        })

USER_TYPES = {
    "usdSend": (USD_SEND_SIGN_TYPES, "HyperliquidTransaction:UsdSend"),
    "withdraw3": (WITHDRAW_SIGN_TYPES, "HyperliquidTransaction:Withdraw"),
    "usdClassTransfer": (USD_CLASS_TRANSFER_SIGN_TYPES, "HyperliquidTransaction:UsdClassTransfer"),
    "sendAsset": (SEND_ASSET_SIGN_TYPES, "HyperliquidTransaction:SendAsset"),
    "spotSend": (SPOT_TRANSFER_SIGN_TYPES, "HyperliquidTransaction:SpotSend"),
    "tokenDelegate": (TOKEN_DELEGATE_TYPES, "HyperliquidTransaction:TokenDelegate"),
    "approveAgent": ([
        {"name": "hyperliquidChain", "type": "string"},
        {"name": "agentAddress", "type": "address"},
        {"name": "agentName", "type": "string"},
        {"name": "nonce", "type": "uint64"},
    ], "HyperliquidTransaction:ApproveAgent"),
    "approveBuilderFee": ([
        {"name": "hyperliquidChain", "type": "string"},
        {"name": "maxFeeRate", "type": "string"},
        {"name": "builder", "type": "address"},
        {"name": "nonce", "type": "uint64"},
    ], "HyperliquidTransaction:ApproveBuilderFee"),
}

def user(name, action, is_mainnet, nonce_field, drop_after_sign=(), source="generated"):
    types, primary = USER_TYPES[action["type"]]
    action = dict(action)
    sig = sign_user_signed_action(wallet, action, types, primary, is_mainnet)
    data = user_signed_payload(primary, types, action)
    digest = digest_of(data)
    for k in drop_after_sign:
        del action[k]
    vectors.append({
        "name": name,
        "source": source,
        "family": "user-signed",
        "network": "mainnet" if is_mainnet else "testnet",
        "action": action,
        "nonce": action[nonce_field],
        "vaultAddress": None,
        "expiresAfter": None,
        "primaryType": primary,
        "digest": digest,
        "signature": sig,
        "signer": wallet.address.lower(),
    })

# --- Published vectors from tests/signing_test.py (re-derived here so every field is present) ---
l1("dummy action", {"type": "dummy", "num": float_to_int_for_hashing(1000)}, 0, source="python-sdk tests")
eth_gtc = order_wires_to_order_action([order_request_to_order_wire({
    "coin": "ETH", "is_buy": True, "sz": 100, "limit_px": 100, "reduce_only": False,
    "order_type": {"limit": {"tif": "Gtc"}}, "cloid": None}, 1)])
l1("order ETH Gtc", eth_gtc, 0, source="python-sdk tests")
eth_cloid = order_wires_to_order_action([order_request_to_order_wire({
    "coin": "ETH", "is_buy": True, "sz": 100, "limit_px": 100, "reduce_only": False,
    "order_type": {"limit": {"tif": "Gtc"}}, "cloid": Cloid.from_str("0x00000000000000000000000000000001")}, 1)])
l1("order with cloid", eth_cloid, 0, source="python-sdk tests")
l1("dummy action with vault", {"type": "dummy", "num": float_to_int_for_hashing(1000)}, 0,
   vault="0x1719884eb866cb12b2287399b15f7db5e7d775ea", source="python-sdk tests")
eth_sl = order_wires_to_order_action([order_request_to_order_wire({
    "coin": "ETH", "is_buy": True, "sz": 100, "limit_px": 100, "reduce_only": False,
    "order_type": {"trigger": {"triggerPx": 103, "isMarket": True, "tpsl": "sl"}}, "cloid": None}, 1)])
l1("tpsl order", eth_sl, 0, source="python-sdk tests")
l1("createSubAccount", {"type": "createSubAccount", "name": "example"}, 0, source="python-sdk tests")
l1("subAccountTransfer", {"type": "subAccountTransfer", "subAccountUser": "0x1d9470d4b963f552e6f671a81619d395877bf409",
   "isDeposit": True, "usd": 10}, 0, source="python-sdk tests")
l1("scheduleCancel (unset)", {"type": "scheduleCancel"}, 0, source="python-sdk tests")
l1("scheduleCancel (time)", {"type": "scheduleCancel", "time": 123456789}, 0, source="python-sdk tests")
phantom = order_wires_to_order_action([order_request_to_order_wire({
    "coin": "ETH", "is_buy": True, "sz": 0.0147, "limit_px": 1670.1, "reduce_only": False,
    "order_type": {"limit": {"tif": "Ioc"}}, "cloid": None}, 4)])
l1("phantom agent production order", phantom, 1677777606040, networks=(True,), source="python-sdk tests")
user("usdSend testnet", {"type": "usdSend", "destination": "0x5e9ee1089755c3435139848e47e6635505d5a13a",
     "amount": "1", "time": 1687816341423}, False, "time", source="python-sdk tests")
user("withdraw3 testnet", {"type": "withdraw3", "destination": "0x5e9ee1089755c3435139848e47e6635505d5a13a",
     "amount": "1", "time": 1687816341423}, False, "time", source="python-sdk tests")

# --- Additional vectors generated for hl-core ---
N = 1790000000000
l1("cancel", {"type": "cancel", "cancels": [{"a": 4, "o": 123456789}]}, N)
l1("cancelByCloid", {"type": "cancelByCloid", "cancels": [{"asset": 10107, "cloid": "0x0000000000000000000000000000abcd"}]}, N)
bracket = order_wires_to_order_action([
    order_request_to_order_wire({"coin": "BTC", "is_buy": True, "sz": 0.001, "limit_px": 60000, "reduce_only": False,
        "order_type": {"limit": {"tif": "Gtc"}}, "cloid": None}, 0),
    order_request_to_order_wire({"coin": "BTC", "is_buy": False, "sz": 0.001, "limit_px": 66000, "reduce_only": True,
        "order_type": {"trigger": {"triggerPx": 66000, "isMarket": True, "tpsl": "tp"}}, "cloid": None}, 0),
    order_request_to_order_wire({"coin": "BTC", "is_buy": False, "sz": 0.001, "limit_px": 57000, "reduce_only": True,
        "order_type": {"trigger": {"triggerPx": 57000, "isMarket": True, "tpsl": "sl"}}, "cloid": None}, 0),
], builder={"b": "0x8c967e73e7b15087c42a10d344cff4c96d877f1d", "f": 10}, grouping="normalTpsl")
l1("bracket order with builder + expiresAfter", bracket, N, expires=N + 60000)
l1("spot order HYPE/USDC post-only", order_wires_to_order_action([order_request_to_order_wire({
    "coin": "HYPE", "is_buy": False, "sz": 1.5, "limit_px": 42.123, "reduce_only": False,
    "order_type": {"limit": {"tif": "Alo"}}, "cloid": None}, 10107)]), N)
l1("updateLeverage", {"type": "updateLeverage", "asset": 0, "isCross": True, "leverage": 10}, N)
l1("modify", {"type": "modify", "oid": 12345, "order": order_request_to_order_wire({"coin": "ETH", "is_buy": True,
    "sz": 0.5, "limit_px": 2500.5, "reduce_only": False, "order_type": {"limit": {"tif": "Gtc"}}, "cloid": None}, 1)}, N)
l1("vault order", eth_gtc, N, vault="0xdfc24b077bc1425ad1dea75bcb6f8158e10df303")
l1("negative int + big int", {"type": "dummy", "neg": -5, "neg2": -300, "big": 18446744073709551615}, 7)

for net in (True, False):
    user("usdSend", {"type": "usdSend", "destination": "0x5e9ee1089755c3435139848e47e6635505d5a13a",
         "amount": "12.5", "time": N}, net, "time")
    user("approveAgent named", {"type": "approveAgent", "agentAddress": "0x9f5c1a0e1b40e1e7a8ab4f4c8b48d6c6b1ee3a0b",
         "agentName": "bot-1", "nonce": N}, net, "nonce")
    user("approveBuilderFee", {"type": "approveBuilderFee", "maxFeeRate": "0.01%",
         "builder": "0x8c967e73e7b15087c42a10d344cff4c96d877f1d", "nonce": N}, net, "nonce")
    user("usdClassTransfer", {"type": "usdClassTransfer", "amount": "10", "toPerp": True, "nonce": N}, net, "nonce")
user("approveAgent unnamed", {"type": "approveAgent", "agentAddress": "0x9f5c1a0e1b40e1e7a8ab4f4c8b48d6c6b1ee3a0b",
     "agentName": "", "nonce": N}, True, "nonce", drop_after_sign=("agentName",))
user("sendAsset", {"type": "sendAsset", "destination": "0x5e9ee1089755c3435139848e47e6635505d5a13a",
     "sourceDex": "", "destinationDex": "spot", "token": "USDC:0x6d1e7cde53ba9467b783cb7c530ce054",
     "amount": "5", "fromSubAccount": "", "nonce": N}, True, "nonce")
user("spotSend", {"type": "spotSend", "destination": "0x5e9ee1089755c3435139848e47e6635505d5a13a",
     "token": "PURR:0xc1fb593aeffbeb02f85e0308e9956a90", "amount": "100", "time": N}, True, "time")
user("tokenDelegate", {"type": "tokenDelegate", "validator": "0x5ac99df645f3414876c816caa18b2d234024b487",
     "wei": 100000000, "isUndelegate": False, "nonce": N}, True, "nonce")

json.dump({
    "generator": "packages/hl-core/scripts/gen_signing_vectors.py",
    "pythonSdkVersion": "0.24.0",
    "signerAddress": wallet.address.lower(),
    "vectors": vectors,
}, sys.stdout, indent=2)
sys.stdout.write("\n")
