// Built-in samples for the Multisig Inspector. The envelope bodies are real
// testnet requests copied verbatim from fixtures/multisig/lab-envelopes.json
// (labels in `source`); regenerate from the fixture rather than editing.
import type { Network } from "../network.ts";

export interface MultisigSample {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly network: Network;
	readonly kind: "account" | "envelope";
	/** account: the address; envelope: the exchange request body as JSON text. */
	readonly input: string;
	readonly source: string;
}

export const LAB_TREASURY = "0xf8365a35694f401a554e4ffa51b5afe3b203d148";

export const MULTISIG_SAMPLES: readonly MultisigSample[] = [
	{
		id: "lab-treasury",
		label: "Lab treasury (testnet 2-of-3)",
		description:
			"The testnet account used for the multi-sig lab: a 2-of-3 with one approved API wallet.",
		network: "testnet",
		kind: "account",
		input: LAB_TREASURY,
		source: "labs/multisig/FINDINGS.md",
	},
	{
		id: "lab-envelope",
		label: "Valid envelope: resting order (2 signatures)",
		description:
			"A real testnet request that placed a resting BTC order through the lab treasury; both signatures recover to authorized users.",
		network: "testnet",
		kind: "envelope",
		input:
			'{\n  "action": {\n    "type": "multiSig",\n    "signatureChainId": "0x66eee",\n    "signatures": [\n      {\n        "r": "0xdb9d4d14ab5a555124b39cadd1cbaf7cad52c88a61a1ead32478a6c7097f5f5",\n        "s": "0x17ac7e2854a41a10706c2748747b5bc4b1df0fd5376b25dc03398edc1096b5be",\n        "v": 27\n      },\n      {\n        "r": "0xdd6c591bc942ac92bce42170347645ad3385bf9b37bc7db0e80d6e71229b1560",\n        "s": "0x11a74259a5f961744243beb2b3c91d60e17d6942816f83333f1f02d82a0db204",\n        "v": 28\n      }\n    ],\n    "payload": {\n      "multiSigUser": "0xf8365a35694f401a554e4ffa51b5afe3b203d148",\n      "outerSigner": "0x5e7c3420160987d04db5e8ed6d5bc14f61237216",\n      "action": {\n        "type": "order",\n        "orders": [\n          {\n            "a": 3,\n            "b": true,\n            "p": "50000",\n            "s": "0.001",\n            "r": false,\n            "t": {\n              "limit": {\n                "tif": "Gtc"\n              }\n            }\n          }\n        ],\n        "grouping": "na"\n      }\n    }\n  },\n  "nonce": 1791399781235,\n  "signature": {\n    "r": "0x6ae37366f1ecffcc30df9489cfd1541ba0a72d8c1af5376e5b5b1656a3e3081d",\n    "s": "0x2e656a7a6967db040aa1b7dee2205e713b305a032777fe5efa3a84aa2801289a",\n    "v": 28\n  },\n  "vaultAddress": null\n}',
		source: "lab-envelopes.json: ms-order-resting",
	},
	{
		id: "lab-broken-envelope",
		label: "Broken envelope: one signer used another nonce",
		description:
			'The chain answered "Invalid multi-sig inner signer"; the inspector names which signature diverged and how.',
		network: "testnet",
		kind: "envelope",
		input:
			'{\n  "action": {\n    "type": "multiSig",\n    "signatureChainId": "0x66eee",\n    "signatures": [\n      {\n        "r": "0x16f9d8f8a0759089ae7965af7eb834d63f10908d2a79f46137dadbab864ccf17",\n        "s": "0xd47adae5e3eacd666c65d31db5f5a471239bf3da19361924f730a4da9d58caa",\n        "v": 28\n      },\n      {\n        "r": "0xf4ebc39b8af24ab173b1cc9a1169d2ec56521ccbb304a3dbc5282eef434f23b9",\n        "s": "0x143c86f3f36c466b49627534e2a5c9d4c5db5c39652594d2d4fe50aee2e9f007",\n        "v": 27\n      }\n    ],\n    "payload": {\n      "multiSigUser": "0xf8365a35694f401a554e4ffa51b5afe3b203d148",\n      "outerSigner": "0x5e7c3420160987d04db5e8ed6d5bc14f61237216",\n      "action": {\n        "type": "order",\n        "orders": [\n          {\n            "a": 3,\n            "b": true,\n            "p": "50000",\n            "s": "0.001",\n            "r": false,\n            "t": {\n              "limit": {\n                "tif": "Gtc"\n              }\n            }\n          }\n        ],\n        "grouping": "na"\n      }\n    }\n  },\n  "nonce": 1791399875146,\n  "signature": {\n    "r": "0xaace4302c78f8163f5adb4b4b79e394d24c1f588093d7a8057c09305c04ae45f",\n    "s": "0x6ea4a9c150c946d1adbcd857e2992fc4a3311377f766e998a2cd68bc75237121",\n    "v": 28\n  },\n  "vaultAddress": null\n}',
		source: "lab-envelopes.json: neg-B-signed-different-nonce",
	},
];
