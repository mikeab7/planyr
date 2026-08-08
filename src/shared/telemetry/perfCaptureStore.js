/* The on-device copy of a performance capture (NEW-1) — bounded, visible, and in the RIGHT TIER.
 *
 * ⛔ WHY INDEXEDDB AND NOT localStorage, and this is TIER-BY-REBUILDABILITY applied rather than
 * quoted. localStorage is the SMALL tier — a hard ~5 MB per-origin cap, measured 78% full on the
 * owner's own machine — and it holds his saved plans, his version ring and his autosave. A
 * diagnostic that competed with those for room would be the B1427 priority inversion committed a
 * second time, deliberately, by the very feature written to find performance problems. So the
 * captures live in the LARGE store (a gigabyte-scale quota, 0.3% used) alongside the map cache.
 *
 * ⛔ AND WHY IT IS BOUNDED ANYWAY. The large store is PERSISTENT for this origin — the browser
 * will never evict it for us — which makes the app solely responsible for its own size. Every
 * write prunes to `MAX_CAPTURES`, and the storage panel shows the class with its own clear
 * control, so this can never grow without being visible. That is rule 3 of the tier rule, not an
 * optional nicety.
 *
 * ⛔ AND WHY THE CLASS IS `reclaimable: false` (see storageCensus.js). Nothing can rebuild a
 * capture: the moment it describes is gone. Under the tier rule, a class with no rehydration
 * source is never reclaimable at any pressure — it is kept small by its own writer instead, which
 * is what the prune below is. Three captures of a few tens of kilobytes cannot matter against a
 * ten-gigabyte quota; losing the one recording of the symptom would.
 *
 * The FULL capture is stored here. The copy that travels to Supabase is compressed and trimmed to
 * fit one telemetry row (perfCapture.js) — so trimming costs fidelity only on the copy that has
 * to fit through a 2000-character column, never on the copy on the machine that had the problem.
 */
import { putOriginRecord, deleteOriginKey, walkOriginStore } from "../storage/originStore.js";

export const CAPTURE_PREFIX = "perfcap:";
/** How many captures the device keeps. Three: the current episode and the two before it, which is
 *  enough to tell a one-off from a pattern and small enough to state without qualification. */
export const MAX_CAPTURES = 3;

/* Keys embed a zero-padded WALL-CLOCK stamp, so lexical order is chronological order ACROSS page
 * loads — `atMs` is relative to its own page load and would sort two sessions into each other. */
const keyFor = (cap, seq) => `${CAPTURE_PREFIX}${String(cap && cap.atWall != null ? cap.atWall : 0).padStart(14, "0")}-${seq}`;

/* Save one capture and prune to MAX_CAPTURES, newest kept. Resolves a small result object; never
 * throws. A failed write is REPORTED to the caller (LOUD-FAILURE) rather than returning a
 * success-shaped value — a "saved" that did not save is the exact bug class this repo's rule
 * exists to prevent. */
export async function savePerfCapture(cap, { seq = 0 } = {}) {
  const out = { ok: false, key: null, pruned: 0 };
  try {
    if (!cap) return out;
    const key = keyFor(cap, seq);
    out.key = key;
    out.ok = await putOriginRecord(key, JSON.stringify(cap));
    if (!out.ok) return out;
    const keys = await listCaptureKeys();
    const excess = keys.length - MAX_CAPTURES;
    for (let i = 0; i < excess; i++) { if (await deleteOriginKey(keys[i])) out.pruned++; }
  } catch (_) { /* telemetry storage must never throw into the app */ }
  return out;
}

/* Every capture key, oldest → newest. Keys embed a zero-padded timestamp, so lexical order is
 * chronological order and no parse is needed to prune. */
export async function listCaptureKeys() {
  const keys = [];
  try { await walkOriginStore(CAPTURE_PREFIX, (k) => keys.push(String(k))); } catch (_) { /* ignore */ }
  return keys.sort();
}

/* Summary for the storage panel: how many, how big, and when the newest was taken. Never throws. */
export async function perfCaptureSummary() {
  const out = { count: 0, bytes: 0, newestAt: null };
  try {
    await walkOriginStore(CAPTURE_PREFIX, (k, v) => {
      out.count++;
      out.bytes += (typeof v === "string" ? v.length : 0) + String(k).length;
      try {
        const at = JSON.parse(v).atWall;
        if (Number.isFinite(at) && (out.newestAt == null || at > out.newestAt)) out.newestAt = at;
      } catch (_) { /* a malformed record still counts toward the size */ }
    });
  } catch (_) { /* ignore */ }
  return out;
}

/* Read them back, newest first — the offline fallback path, and what a console read uses when
 * the cloud row never made it out. */
export async function readPerfCaptures() {
  const rows = [];
  try {
    await walkOriginStore(CAPTURE_PREFIX, (k, v) => {
      try { rows.push({ key: String(k), capture: JSON.parse(v) }); } catch (_) { /* skip */ }
    });
  } catch (_) { /* ignore */ }
  return rows.sort((a, b) => (a.key < b.key ? 1 : -1));
}

/* Owner-visible clear, from the storage panel. */
export async function clearPerfCaptures() {
  let removed = 0;
  try { for (const k of await listCaptureKeys()) if (await deleteOriginKey(k)) removed++; } catch (_) { /* ignore */ }
  return removed;
}
