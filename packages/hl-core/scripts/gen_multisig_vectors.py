"""
Generate multi-sig signing vectors with the official hyperliquid-python-sdk.

Usage (no checkout needed, uv fetches the SDK into a throwaway environment):
    uv run --with hyperliquid-python-sdk python packages/hl-core/scripts/gen_multisig_vectors.py \
        > packages/hl-core/fixtures/signing/python-sdk-multisig-vectors.json

The private keys are the SDK's own public test key plus five tiny keys; they
only exist here and in the test helper, offline, to produce vectors.
"""
import json
import sys
from importlib.metadata import version as pkg_version

import eth_account
import msgpack
from eth_account.messages import _hash_eip191_message, encode_typed_data
from eth_utils import to_hex

from hyperliquid.utils.signing import (
    CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES,
    MULTI_SIG_ENVELOPE_SIGN_TYPES,
    USD_SEND_SIGN_TYPES,
    action_hash,
    add_multi_sig_fields,
    add_multi_sig_types,
    construct_phantom_agent,
    l1_payload,
    sign_multi_sig_action,
    sign_multi_sig_l1_action_payload,
    sign_multi_sig_user_signed_action_payload,
    user_signed_payload,
)

# The SDK defines approveAgent's struct inline (exchange.approve_agent); mirrored here.
APPROVE_AGENT_SIGN_TYPES = [
    {"name": "hyperliquidChain", "type": "string"},
    {"name": "agentAddress", "type": "address"},
    {"name": "agentName", "type": "string"},
    {"name": "nonce", "type": "uint64"},
]

KEYS = [
    "0x0123456789012345678901234567890123456789012345678901234567890123",
    "0x0000000000000000000000000000000000000000000000000000000000000001",
    "0x0000000000000000000000000000000000000000000000000000000000000002",
    "0x0000000000000000000000000000000000000000000000000000000000000003",
]
wallets = [eth_account.Account.from_key(k) for k in KEYS]
addresses = [w.address.lower() for w in wallets]
TREASURY, A, B, C = addresses
NONCE = 1791399781235
VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303"
vectors = []


def digest_of(data):
    return to_hex(_hash_eip191_message(encode_typed_data(full_message=data)))


def sig_dict(sig):
    return {"r": sig["r"], "s": sig["s"], "v": sig["v"]}


def l1_inner(name, action, nonce, vault=None, expires=None, leader=A, signers=(1, 2)):
    for is_mainnet in (True, False):
        envelope = [TREASURY, leader, action]
        h = action_hash(envelope, vault, nonce, expires)
        data = l1_payload(construct_phantom_agent(h, is_mainnet))
        sigs = []
        for i in signers:
            sig = sign_multi_sig_l1_action_payload(wallets[i], action, is_mainnet, vault, nonce, expires, TREASURY, leader)
            sigs.append({"signer": addresses[i], **sig_dict(sig)})
        vectors.append({
            "name": name,
            "kind": "l1",
            "network": "mainnet" if is_mainnet else "testnet",
            "multiSigUser": TREASURY,
            "outerSigner": leader,
            "action": action,
            "nonce": nonce,
            "vaultAddress": vault,
            "expiresAfter": expires,
            "msgpackHex": "0x" + msgpack.packb(envelope).hex(),
            "connectionId": to_hex(h),
            "digest": digest_of(data),
            "signatures": sigs,
        })
        outer(name, action, nonce, vault, expires, leader, sigs, is_mainnet)


def user_inner(name, action, sign_types, tx_type, leader=A, signers=(1, 2)):
    for is_mainnet in (True, False):
        act = dict(action)
        act["hyperliquidChain"] = "Mainnet" if is_mainnet else "Testnet"
        env = add_multi_sig_fields(act, TREASURY, leader)
        types = add_multi_sig_types(sign_types)
        data = user_signed_payload(tx_type, types, env)
        sigs = []
        for i in signers:
            sig = sign_multi_sig_user_signed_action_payload(wallets[i], act, is_mainnet, sign_types, tx_type, TREASURY, leader)
            sigs.append({"signer": addresses[i], **sig_dict(sig)})
        vectors.append({
            "name": name,
            "kind": "user-signed",
            "network": "mainnet" if is_mainnet else "testnet",
            "multiSigUser": TREASURY,
            "outerSigner": leader,
            "action": act,
            "nonce": act.get("nonce", act.get("time")),
            "vaultAddress": None,
            "expiresAfter": None,
            "primaryType": tx_type,
            "digest": digest_of(data),
            "signatures": sigs,
        })
        outer(name, act, act.get("nonce", act.get("time")), None, None, leader, sigs, is_mainnet)


def outer(name, action, nonce, vault, expires, leader, sigs, is_mainnet):
    multi_sig_action = {
        "type": "multiSig",
        "signatureChainId": "0x66eee",
        "signatures": [sig_dict(s) for s in sigs],
        "payload": {"multiSigUser": TREASURY, "outerSigner": leader, "action": action},
    }
    without_tag = dict(multi_sig_action)
    del without_tag["type"]
    h = action_hash(without_tag, vault, nonce, expires)
    envelope = {"multiSigActionHash": to_hex(h), "nonce": nonce}
    data = user_signed_payload("HyperliquidTransaction:SendMultiSig", MULTI_SIG_ENVELOPE_SIGN_TYPES, {**envelope, "signatureChainId": "0x66eee", "hyperliquidChain": "Mainnet" if is_mainnet else "Testnet"})
    leader_wallet = wallets[addresses.index(leader)]
    sig = sign_multi_sig_action(leader_wallet, multi_sig_action, is_mainnet, vault, nonce, expires)
    vectors.append({
        "name": f"{name} [envelope]",
        "kind": "envelope",
        "network": "mainnet" if is_mainnet else "testnet",
        "request": {"action": multi_sig_action, "nonce": nonce, "vaultAddress": vault, "expiresAfter": expires},
        "actionHash": to_hex(h),
        "digest": digest_of(data),
        "signature": {"signer": leader, **sig_dict(sig)},
    })


ORDER = {"type": "order", "orders": [{"a": 3, "b": True, "p": "50000", "s": "0.001", "r": False, "t": {"limit": {"tif": "Gtc"}}}], "grouping": "na"}
l1_inner("order", ORDER, NONCE)
l1_inner("order vault", ORDER, NONCE, vault=VAULT)
l1_inner("order expires", ORDER, NONCE, expires=NONCE + 60000)
l1_inner("order vault+expires lead C signed by A,B", ORDER, NONCE, vault=VAULT, expires=NONCE + 5, leader=C)
l1_inner("cancel 3 sigs", {"type": "cancel", "cancels": [{"a": 3, "o": 62098164264}]}, NONCE, signers=(1, 2, 3))
l1_inner("unknown shape", {"type": "spotDeployLike", "n": 7, "nested": {"flag": True}}, NONCE)

user_inner("usdSend", {"type": "usdSend", "signatureChainId": "0x66eee", "destination": "0x51d3aaa37dc88af4d4ef846629e7e7f201b47fd9", "amount": "5", "time": NONCE}, USD_SEND_SIGN_TYPES, "HyperliquidTransaction:UsdSend")
user_inner("approveAgent named", {"type": "approveAgent", "signatureChainId": "0x66eee", "agentAddress": B, "agentName": "lab", "nonce": NONCE}, APPROVE_AGENT_SIGN_TYPES, "HyperliquidTransaction:ApproveAgent")
user_inner("approveAgent unnamed", {"type": "approveAgent", "signatureChainId": "0x66eee", "agentAddress": B, "agentName": "", "nonce": NONCE}, APPROVE_AGENT_SIGN_TYPES, "HyperliquidTransaction:ApproveAgent")
user_inner("convert 2of3", {"type": "convertToMultiSigUser", "signatureChainId": "0x66eee", "signers": json.dumps({"authorizedUsers": sorted([A, B, C]), "threshold": 2}), "nonce": NONCE}, CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES, "HyperliquidTransaction:ConvertToMultiSigUser")
user_inner("convert revert", {"type": "convertToMultiSigUser", "signatureChainId": "0x66eee", "signers": "null", "nonce": NONCE}, CONVERT_TO_MULTI_SIG_USER_SIGN_TYPES, "HyperliquidTransaction:ConvertToMultiSigUser")

json.dump({"generator": "scripts/gen_multisig_vectors.py", "pythonSdkVersion": pkg_version("hyperliquid-python-sdk"), "addresses": {"treasury": TREASURY, "A": A, "B": B, "C": C}, "vectors": vectors}, sys.stdout, indent=2)
sys.stdout.write("\n")
