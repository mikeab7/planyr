/* sitesSnapshot.js — the parsed device store, held with the EXACT string it was parsed from. A leaf: it imports nothing, so the
 * light project-list reader (which rides every route) and storage.js can share one parse without either importing the other.
 *
 * NEW-1 (B217540 ×3 / B1317824 ×3). `storage.js` already remembered `{ key, str, obj }` for its own two autosave questions
 * (B217540). The same parse is exactly what the header's names index needs after every edit, and it was parsing the whole
 * store again to get it — so the remembered pair lives here instead, and a reader asks `snapshotIfCurrent(key, rawStringItHolds)`:
 * the object comes back ONLY while that string is byte-for-byte the one it was parsed from or written as. Any other writer
 * changes the bytes, the answer is `null`, and the reader does the real parse it always did.
 *
 * The objects are SHARED. Contract: read-only. `test/storageSharedReads.test.js` runs every shared reader against a deep-frozen
 * copy so a mutation is a thrown error, never a quietly corrupted cache. */
let snap = null;   // { key, str, obj }
export function rememberSnapshot(key, str, obj) { snap = { key, str, obj }; return snap; }
export function currentSnapshot() { return snap; }
export function clearSnapshot() { snap = null; }
export function snapshotIfCurrent(key, raw) { return snap && snap.key === key && typeof raw === "string" && snap.str === raw ? snap : null; }
