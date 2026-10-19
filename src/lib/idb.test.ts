import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
	DB_NAME,
	DB_VERSION,
	deleteSession,
	idbRequest,
	listSessions,
	openDb,
	saveSession,
} from "./idb";

const FILE = { format: "hl-tools-ws-session", version: 1 } as never;

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
});

/** A version-1 database as shipped before the proposals store existed. */
function seedV1(): Promise<void> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () =>
			req.result.createObjectStore("wsSessions", {
				keyPath: "id",
				autoIncrement: true,
			});
		req.onsuccess = () => {
			const db = req.result;
			const t = db.transaction("wsSessions", "readwrite");
			t.objectStore("wsSessions").add({ savedAt: 5, file: FILE });
			t.oncomplete = () => {
				db.close();
				resolve();
			};
		};
		req.onerror = () => reject(req.error);
	});
}

describe("idb", () => {
	it("creates both stores on a fresh database", async () => {
		const db = await openDb();
		expect(db.version).toBe(DB_VERSION);
		expect([...db.objectStoreNames].sort()).toEqual([
			"proposals",
			"wsSessions",
		]);
		expect([
			...db.transaction("proposals").objectStore("proposals").indexNames,
		]).toEqual(["updatedAt"]);
		db.close();
	});

	it("upgrades a version-1 database and keeps its sessions", async () => {
		await seedV1();
		const sessions = await listSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.savedAt).toBe(5);
		const db = await openDb();
		expect(db.objectStoreNames.contains("proposals")).toBe(true);
		db.close();
	});

	it("saves, lists newest first, bounds to 20 and deletes sessions", async () => {
		for (let i = 0; i < 22; i++) await saveSession(FILE);
		const all = await listSessions();
		expect(all).toHaveLength(20);
		expect(all[0]?.savedAt).toBeGreaterThanOrEqual(all[19]?.savedAt ?? 0);
		await deleteSession(all[0]?.id as number);
		expect(await listSessions()).toHaveLength(19);
	});

	it("rejects when a request fails, and when IndexedDB is missing", async () => {
		await idbRequest("proposals", "readwrite", (s) => s.add({ digest: "0x1" }));
		await expect(
			idbRequest("proposals", "readwrite", (s) => s.add({ digest: "0x1" })),
		).rejects.toBeTruthy();
		// @ts-expect-error simulate a context without IndexedDB
		globalThis.indexedDB = undefined;
		await expect(openDb()).rejects.toThrow("IndexedDB is not available");
	});
});
