/**
 * Minimal IndexedDB access for the hub. Everything here stays in this browser;
 * nothing is uploaded. One database, one version, every store created in the
 * same upgrade so no page can open the database at a version another page
 * does not know.
 *
 * Stores:
 * - `wsSessions`: recorded WebSocket sessions (bounded to MAX_SESSIONS).
 * - `proposals`: multi-sig proposal documents keyed by digest (see
 *   `src/components/multisig/model/history.ts`).
 */

import type { WsSessionFile } from "@hl-tools/core";

export const DB_NAME = "hl-tools";
export const DB_VERSION = 2;
export type StoreName = "wsSessions" | "proposals";
const MAX_SESSIONS = 20;

export interface StoredSession {
	id?: number;
	savedAt: number;
	file: WsSessionFile;
}

/** Create whatever is missing; safe to run from any earlier version. */
function upgrade(db: IDBDatabase): void {
	if (!db.objectStoreNames.contains("wsSessions"))
		db.createObjectStore("wsSessions", { keyPath: "id", autoIncrement: true });
	if (!db.objectStoreNames.contains("proposals")) {
		const store = db.createObjectStore("proposals", { keyPath: "digest" });
		store.createIndex("updatedAt", "updatedAt");
	}
}

export function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is not available in this browser context."));
			return;
		}
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => upgrade(req.result);
		req.onblocked = () =>
			reject(
				new Error(
					"Another hl-tools tab is holding the local database open. Close other hl-tools tabs and retry.",
				),
			);
		req.onsuccess = () => {
			const db = req.result;
			// let a newer tab upgrade instead of blocking it
			db.onversionchange = () => db.close();
			resolve(db);
		};
		req.onerror = () =>
			reject(req.error ?? new Error("Could not open IndexedDB"));
	});
}

/** Run one request against one store and close the connection afterwards. */
export function idbRequest<T>(
	store: StoreName,
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return openDb().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const t = db.transaction(store, mode);
				const r = fn(t.objectStore(store));
				r.onsuccess = () => resolve(r.result);
				r.onerror = () =>
					reject(r.error ?? new Error("IndexedDB request failed"));
				t.oncomplete = () => db.close();
				t.onabort = () => db.close();
			}),
	);
}

export async function listSessions(): Promise<StoredSession[]> {
	const all = await idbRequest<StoredSession[]>(
		"wsSessions",
		"readonly",
		(s) => s.getAll() as IDBRequest<StoredSession[]>,
	);
	return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveSession(file: WsSessionFile): Promise<number> {
	const id = await idbRequest<IDBValidKey>("wsSessions", "readwrite", (s) =>
		s.add({ savedAt: Date.now(), file } satisfies StoredSession),
	);
	const all = await listSessions();
	for (const old of all.slice(MAX_SESSIONS))
		if (old.id !== undefined) await deleteSession(old.id);
	return Number(id);
}

export function deleteSession(id: number): Promise<undefined> {
	return idbRequest<undefined>(
		"wsSessions",
		"readwrite",
		(s) => s.delete(id) as IDBRequest<undefined>,
	);
}
