/* Undo history that SURVIVES LEAVING A PLAN (NEW-1, 2026-11-13 — owner: "Do I lose the ability to do the
 * control Z whenever I get out of the page? I'd like to have some amount of undo abilities, even if I go to
 * an old page or a page I wasn't on in a minute.").
 *
 * WHY IT WAS LOST. `SitePlannerApp` mounts the planner with `key={activeSiteId:loadEpoch}`, so switching
 * plans (or a cloud-pull remount, or a reload) builds a NEW planner whose history stack (`histRef` in
 * SitePlanner.jsx, lib/history.js) starts empty. The old stack died with the old component.
 *
 * THE RULES (each is a decision, not an accident):
 *  1. PER PLAN. Everything is keyed by (account scope, plan id). Plan B's Ctrl+Z can never reach plan A's
 *     frames: the only way in is `takeMemory`/`loadDisk` for the plan being mounted.
 *  2. TWO TIERS.  (a) A module-level in-memory vault keeps the live frames by reference while Planyr stays
 *     open — plan switches and cloud-pull remounts. (b) A shorter tail is written to IndexedDB (the LARGE
 *     tier, TIER-BY-REBUILDABILITY — never localStorage, which is for saved plans) so a reload / reopened
 *     tab still has it. A failed or full write is swallowed: the cost is "no history after a reload".
 *  3. STALE-HISTORY GUARD. Every saved set carries `baseKey` — a hash of the plan's content at the moment
 *     it was saved. The carried frames are used ONLY while the plan still equals that (checked lazily at the
 *     first Ctrl+Z / first new edit, never at boot). If the plan changed in the meantime — another tab,
 *     another computer, a teammate, a cloud pull — the frames are DROPPED, never replayed over newer work.
 *  4. NEVER SYNCED. Nothing here touches Supabase, the sync engine or the cloud; it is this browser's.
 *  5. CAPS (stated, not implied): memory — 8 plans × the stack's own 80 steps; disk — 8 plans × the newest
 *     15 undo steps × at most ~1.5 MB per plan (oldest steps dropped first), kept 3 days. Redo steps are
 *     carried in memory only.
 *
 * Pure apart from the injected `io` (idbPut/idbGet/idbDelete) and a module Map, so it unit-tests in Node. */

export const CARRY_LIMITS = {
  MEM_PLANS: 8,
  DISK_PLANS: 8,
  DISK_STEPS: 15,
  DISK_CHARS: 1_500_000,
  DISK_MAX_AGE_MS: 3 * 24 * 60 * 60 * 1000,
};

const DISK_PREFIX = "undo:v1:";
const DISK_INDEX = "undo:v1:index";

/* ── a small, dependency-free content hash (two FNV-1a lanes → 16 hex chars) ─────────────────────── */
export function hashString(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c; h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i; h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

const noSrc = (list) => (list || []).map((o) => (o && o.src ? { ...o, src: undefined } : o));

/* The plan's content key for the stale-history guard: the planner's own `histKey` (the same signature that
 * dedups no-op undo frames) with each overlay's raster `src` blanked — a `src` is a runtime object URL /
 * data URI that is rebuilt on every load, so it would make an identical plan look "changed" after a reload. */
export function carryKeyOf(snapshot, keyOf) {
  const s = snapshot || {};
  const hasSrc = (s.sheetOverlays || []).some((o) => o && o.src);
  return hashString(keyOf(hasSrc ? { ...s, sheetOverlays: noSrc(s.sheetOverlays) } : s));
}

/* A frame restored from disk has no raster `src` (never persisted). Graft the LIVE one by overlay id so an
 * undo does not blank a placed reference; an overlay the plan no longer holds keeps none and rehydrates from
 * its stored copy like any freshly loaded one. Returns the SAME object when nothing needs grafting. */
export function graftOverlaySrc(snapshot, liveOverlays) {
  const list = snapshot && snapshot.sheetOverlays;
  if (!list || !list.length || !list.some((o) => o && !o.src)) return snapshot;
  const byId = new Map();
  for (const o of liveOverlays || []) if (o && o.id != null && o.src) byId.set(o.id, o.src);
  if (!byId.size) return snapshot;
  let changed = false;
  const next = list.map((o) => {
    if (!o || o.src || !byId.has(o.id)) return o;
    changed = true;
    return { ...o, src: byId.get(o.id) };
  });
  return changed ? { ...snapshot, sheetOverlays: next } : snapshot;
}

/* ── tier (a): the in-memory vault ───────────────────────────────────────────────────────────────── */
const memory = new Map(); // `${scope}|${planId}` → { past, future, baseKey }
const memKey = (scope, id) => `${scope}|${id}`;

export function stashMemory(scope, id, entry) {
  const k = memKey(scope, id);
  memory.delete(k);
  if (!entry || (!entry.past.length && !entry.future.length)) return;
  memory.set(k, { past: entry.past, future: entry.future, baseKey: entry.baseKey });
  while (memory.size > CARRY_LIMITS.MEM_PLANS) memory.delete(memory.keys().next().value);   // oldest-used first
}
export function takeMemory(scope, id) {
  const k = memKey(scope, id);
  const e = memory.get(k) || null;
  memory.delete(k);
  return e;
}
export const clearMemory = () => memory.clear();           // tests
export const memoryPlanCount = () => memory.size;          // tests / diagnostics

/* ── tier (b): the disk tail ─────────────────────────────────────────────────────────────────────── */
const jsonCache = new WeakMap(); // pooled value (an array/object, by identity) → its JSON text

function jsonOf(v) {
  if (v && typeof v === "object") {
    let s = jsonCache.get(v);
    if (s === undefined) { s = JSON.stringify(v); jsonCache.set(v, s); }
    return s;
  }
  return JSON.stringify(v);
}

/* Encode the newest `maxSteps` undo frames into ONE string. Collections a frame shares with its neighbours
 * (an edit replaces only the array it changed) are written once and referenced by index, and each pooled
 * value's JSON text is remembered by identity, so a repeat save re-serialises only what is new.
 * Returns null when there is nothing to save. Overlay rasters (`src`) are never written. */
export function encodeCarry({ past, baseKey, now = Date.now(), maxSteps = CARRY_LIMITS.DISK_STEPS, maxChars = CARRY_LIMITS.DISK_CHARS }) {
  if (!past || !past.length) return null;
  const pool = [];                     // JSON texts, in pool order
  const index = new Map();             // pooled source value → pool index
  const frames = [];                   // newest first while collecting
  let chars = 0;
  const poolIdx = (key, val) => {
    if (val === undefined) return undefined;
    const src = val;
    if (index.has(src)) return index.get(src);
    const text = key === "sheetOverlays" && Array.isArray(val) ? jsonOf(noSrcCached(val)) : jsonOf(val);
    index.set(src, pool.length);
    pool.push(text);
    chars += text.length;
    return pool.length - 1;
  };
  for (let i = past.length - 1; i >= 0 && frames.length < maxSteps; i--) {
    const fr = past[i];
    if (!fr || typeof fr !== "object") continue;
    const before = { n: pool.length, chars };
    const row = {};
    for (const k of Object.keys(fr)) { const p = poolIdx(k, fr[k]); if (p !== undefined) row[k] = p; }
    if (chars > maxChars) {                            // this step would not fit: stop at the newest ones that do
      if (!frames.length) return null;                 // even the newest alone is over the cap → no disk tail for this plan
      pool.length = before.n; chars = before.chars;
      break;
    }
    frames.push(row);
  }
  if (!frames.length) return null;
  frames.reverse();                                    // oldest → newest
  return `{"v":1,"savedAt":${now},"baseKey":${JSON.stringify(baseKey)},"pool":[${pool.join(",")}],"frames":${JSON.stringify(frames)}}`;
}
const noSrcMemo = new WeakMap();
function noSrcCached(arr) {
  let v = noSrcMemo.get(arr);
  if (!v) { v = noSrc(arr); noSrcMemo.set(arr, v); }
  return v;
}

/* The inverse of `encodeCarry`. Returns `{ past, baseKey, savedAt }` or null on anything unreadable —
 * a corrupt / foreign / older-format entry is simply "no history". */
export function decodeCarry(text) {
  try {
    const d = typeof text === "string" ? JSON.parse(text) : null;
    if (!d || d.v !== 1 || !Array.isArray(d.pool) || !Array.isArray(d.frames) || typeof d.baseKey !== "string") return null;
    const past = d.frames.map((row) => {
      const fr = {};
      for (const k of Object.keys(row)) {
        const idx = row[k];
        if (!Number.isInteger(idx) || idx < 0 || idx >= d.pool.length) throw new Error("bad pool index");
        fr[k] = d.pool[idx];
      }
      return fr;
    });
    return past.length ? { past, baseKey: d.baseKey, savedAt: Number(d.savedAt) || 0 } : null;
  } catch (_) { return null; }
}

const diskKey = (scope, id) => `${DISK_PREFIX}${scope}:${id}`;

async function readIndex(io) {
  try { const raw = await io.get(DISK_INDEX); const a = raw ? JSON.parse(raw) : []; return Array.isArray(a) ? a.filter((r) => r && typeof r.k === "string") : []; }
  catch (_) { return []; }
}

/* Save (or clear) the disk tail for one plan. Never throws and never rejects; resolves true when written.
 * ORDER MATTERS: the entry itself is the FIRST store operation, issued before any `await` of ours, because
 * this is called from `pagehide` — a page that is going away gets one turn, and a read-the-index-first
 * sequence (measured) never reached its write. The LRU index is housekeeping and runs after. */
export async function persistDisk(io, scope, id, { past, baseKey, now = Date.now() }) {
  try {
    const k = diskKey(scope, id);
    const text = encodeCarry({ past, baseKey, now });
    const wrote = text ? io.put(k, text) : io.del(k);
    const ok = await wrote;
    const idx = (await readIndex(io)).filter((r) => r.k !== k);
    if (text && ok) idx.push({ k, at: now });
    while (idx.length > CARRY_LIMITS.DISK_PLANS) { const old = idx.shift(); try { await io.del(old.k); } catch (_) {} }
    await io.put(DISK_INDEX, JSON.stringify(idx));
    return !!(text && ok);
  } catch (_) { return false; }
}

/* Read the disk tail for one plan: `{ past, future: [], baseKey }` or null (none, too old, unreadable). */
export async function loadDisk(io, scope, id, now = Date.now()) {
  try {
    const text = await io.get(diskKey(scope, id));
    const d = decodeCarry(text);
    if (!d) return null;
    if (d.savedAt && now - d.savedAt > CARRY_LIMITS.DISK_MAX_AGE_MS) return null;
    return { past: d.past, future: [], baseKey: d.baseKey };
  } catch (_) { return null; }
}
