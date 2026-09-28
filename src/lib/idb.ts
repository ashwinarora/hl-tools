/**
 * Minimal IndexedDB store for recorded WebSocket sessions. Local to this
 * browser; nothing is uploaded. Bounded: the oldest sessions are dropped
 * beyond MAX_SESSIONS.
 */

import type { WsSessionFile } from "@hl-tools/core";

const DB_NAME = "hl-tools";
const STORE = "wsSessions";
const MAX_SESSIONS = 20;

export interface StoredSession {
	id?: number;
	savedAt: number;
	file: WsSessionFile;
}

function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		if (typeof indexedDB === "undefined") {
			reject(new Error("IndexedDB is not available in this browser context."));
			return;
		}
		const req = indexedDB.open(DB_NAME, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE))
				db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () =>
			reject(req.error ?? new Error("Could not open IndexedDB"));
	});
}

function tx<T>(
	mode: IDBTransactionMode,
	fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	return open().then(
		(db) =>
			new Promise<T>((resolve, reject) => {
				const t = db.transaction(STORE, mode);
				const r = fn(t.objectStore(STORE));
				r.onsuccess = () => resolve(r.result);
				r.onerror = () =>
					reject(r.error ?? new Error("IndexedDB request failed"));
				t.oncomplete = () => db.close();
			}),
	);
}

export async function listSessions(): Promise<StoredSession[]> {
	const all = await tx<StoredSession[]>(
		"readonly",
		(s) => s.getAll() as IDBRequest<StoredSession[]>,
	);
	return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveSession(file: WsSessionFile): Promise<number> {
	const id = await tx<IDBValidKey>("readwrite", (s) =>
		s.add({ savedAt: Date.now(), file } satisfies StoredSession),
	);
	const all = await listSessions();
	for (const old of all.slice(MAX_SESSIONS))
		if (old.id !== undefined) await deleteSession(old.id);
	return Number(id);
}

export function deleteSession(id: number): Promise<undefined> {
	return tx<undefined>(
		"readwrite",
		(s) => s.delete(id) as IDBRequest<undefined>,
	);
}
