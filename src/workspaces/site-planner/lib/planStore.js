/* planStore.js — WHERE THE DEVICE COPY OF EVERY PLAN LIVES (B2165120).
 *
 * ⛔ THE PROBLEM. The device store was ONE localStorage entry (`planarfit:sites:v1`, or `planarfit:sites:cloud:<uid>` when signed
 * in) holding every plan on the device. An edit to one plan therefore rewrote ALL of them: the native `setItem` of a 3-4 MB blob
 * (30-60 ms, with ~290 ms flush spikes) was the floor under every paste / move / resize, and it grew with the LIBRARY, not with
 * the plan being edited. B217540 (x2, x3) removed every multiplier around that write; this removes the write.
 *
 * THE LAYOUT, per store key `K` (K = the old whole-library key, unchanged):
 *   K                one entry per plan  →  K:p:<planId>   (JSON of exactly the record the old blob held under that id)
 *   K:idx            a ~60-byte INDEX: { v:1, ok:true, gen, stale, mig }  — the layout marker, a unique change stamp (every write
 *                    gets a new `gen`, so a reader can tell "nothing changed" from ONE tiny read), and `stale` = "the legacy
 *                    entry K is behind the per-plan entries". The per-plan ENTRIES are the truth for which plans exist (enumerated
 *                    by key scan) — the index never lists ids, so it can never disagree with them.
 *   K:led            the LEGACY LEDGER { sig, len, ids, at }: what K held the last time this code and K agreed — its signature and
 *                    the ids in it. Written only at migration / mirror time, never per edit.
 *   K (itself)       KEPT, never deleted here. It is (a) the migration's untouched source, (b) the ROLLBACK COPY — an older build
 *                    reads only this — and (c) how a not-yet-reloaded older tab keeps working. See "THE MIRROR".
 *
 * MIGRATION IS COPY-THEN-VERIFY, NEVER MOVE. On the first read of a store with no index: every plan is copied into its own entry,
 * every entry is read back and compared with the source, and ONLY THEN is the index written (the index is the switch — before it
 * exists everything still reads K). Anything wrong — a quota error, a malformed record, a failed readback — and the entries this
 * attempt created are removed, no index is written, and the session keeps reading K exactly as before (reported as
 * `plan-store-migration-aborted`). A crash mid-way leaves entries without an index; the next load re-runs the migration, which
 * never deletes an entry it finds (it keeps the newer of entry/source per plan).
 *
 * THE MIRROR (rollback + older tabs). After a per-plan write, K is brought up to date OFF the edit path: on a quiet period, on
 * `pagehide` / tab-hidden, and at the latest every MIRROR_MAX_WAIT_MS — one coalesced write of the already-serialised entries (no
 * re-stringify), so an edit costs one small entry write plus a ~60-byte index write, flat in library size. COST OF ROLLBACK, stated:
 * the blob write has not gone away, it has moved from "every edit" to "once per quiet period / tab hide". A build reverted to the old
 * code sees everything up to the last mirror; an edit made in the last few seconds of a tab that was killed (not closed) is still in
 * the per-plan entries but not yet in K, and is picked up when the new code next loads. `index.stale` records that debt across a crash.
 *
 * MIXED BUILDS (the rule, in one paragraph). An older-build tab keeps writing K whole. We detect it by K's signature no longer
 * matching `led.sig` (on load, on focus / visibility, on a `storage` event for K, and before each mirror). Then, PER PLAN: a plan in
 * K that we never had and that was not in the ledger → ADOPTED (an older tab created it); a plan we have whose `updatedAt` is
 * strictly older than K's → MERGED with the injected `mergeSiteContent` (union of content, newest scalars — nothing of ours is
 * dropped); equal or newer here → KEPT; a plan the ledger says K held but K no longer does → the older tab DELETED it, so we delete it;
 * a plan the ledger never listed that K lacks → ours, not yet mirrored, KEPT. Then the mirror rewrites K from the merged result.
 * Delete wins over an edit made on the other side after it (the product's standing delete-vs-edit rule).
 *
 * If a store cannot be migrated (quota: the copy needs room next to the kept original) the store stays in "blob" mode for that page
 * load — the OLD behaviour, byte for byte — and the failure is reported; nothing is lost and nothing is half-switched.
 *
 * ⛔ A LEAF. Imports only the telemetry reporter. The site model's persist/slim/merge rules are INJECTED by storage.js (`configure`),
 * so the light project-list reader can use this without pulling in the geometry engine.
 */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { rememberSnapshot, currentSnapshot, clearSnapshot, snapshotIfCurrent } from "./sitesSnapshot.js";

/** The browser's per-origin localStorage cap is not queryable; ~5.2M characters is what Chromium actually accepts (measured). Node / tests have no cap
 *  unless `globalThis.__PLANYR_LS_CAP` says so. */
export const LS_CAP_CHARS = 5_200_000;
export const HEADROOM_AFTER_CHARS = 250_000;   // free room that must remain AFTER the split — a few big edits and a history snapshot
const lsCapChars = () => { const g = typeof globalThis !== "undefined" ? globalThis : {}; if (g.__PLANYR_LS_CAP != null) return g.__PLANYR_LS_CAP; return typeof document === "undefined" ? Infinity : LS_CAP_CHARS; };
function lsUsedChars() {
  let n = 0; const l = lsNow();
  try { for (let i = 0; i < l.length; i++) { const k = l.key(i); if (k == null) continue; n += k.length + ((l.getItem(k) || "").length); } } catch (_) {}
  return n;
}
export const MIRROR_QUIET_MS = 15000;      // mirror once edits have been quiet this long…
export const MIRROR_MAX_WAIT_MS = 120000;  // …and never let the older copy fall further behind than this
const IDX = ":idx", LED = ":led", PFX = ":p:";
export const LAYOUT_SWITCH = "planarfit:planStore:layout";   // = "blob" → run the un-split layout (kill switch / harness A-B lever)

const cfg = { persistForm: (x) => x, slim: (x) => x, merge: null, onForeignMerge: null };
/** storage.js injects the model-aware pieces: `persistForm(rec)` (drop IndexedDB-backed rasters), `slim(rec)` (the over-quota
 *  retry: shed every inline raster), `merge(mine, theirs)` (mergeSiteContent) and `onForeignMerge()` (announce on the sites channel). */
export function configure(c) {
  Object.assign(cfg, c || {});
  if (cfg.merge) for (const [base, s] of states) if (s.reconcilePending) { s.reconcilePending = false; reconcileLegacy(base); }
}

const lsNow = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; } };
const get = (k) => { try { return lsNow().getItem(k); } catch (_) { return null; } };
const set = (k, v) => lsNow().setItem(k, v);
const del = (k) => { try { lsNow().removeItem(k); } catch (_) {} };
const toMs = (v) => (typeof v === "string" ? (Date.parse(v) || 0) : (v || 0));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pkey = (base, id) => base + PFX + id;

/** A 53-bit string signature + length (cyrb53). Used only to tell "is the legacy entry still the one we wrote"; ~10 ms at 4 MB, so
 *  it runs on load / focus / a storage event / before a mirror — never on an edit. */
export function sigOf(str) {
  const n = str.length;
  let h1 = 0xdeadbeef ^ n, h2 = 0x41c6ce57 ^ n;
  for (let i = 0; i < n; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ":" + n;
}

/* ---- per-store state, reset whenever the underlying localStorage instance changes (test isolation) ---- */
const states = new Map();
function stateOf(base) {
  const l = lsNow();
  let s = states.get(base);
  if (!s || s.ls !== l) {
    s = { ls: l, base, mode: null, hasIdx: false, booted: false, stamp: null, plans: new Map(), shared: null,
      blobFails: 0, dirtySince: 0, quietTimer: null, maxTimer: null };
    states.set(base, s);
    hookPageEvents();
  }
  return s;
}
const idxKeyOf = (base) => base + IDX;
function listEntryIds(base) {
  const out = [], l = lsNow(), p = base + PFX;
  if (!l) return out;
  try { for (let i = 0; i < l.length; i++) { const k = l.key(i); if (k && k.startsWith(p)) out.push(k.slice(p.length)); } } catch (_) {}
  return out;
}

/* ================================ migration (copy → verify → switch) ================================ */
function migrate(base, s, legacyRaw) {
  const t0 = Date.now();
  let src;
  try { src = JSON.parse(legacyRaw); } catch (_) { src = undefined; }
  if (!isObj(src)) { reportClientEvent("plan-store-migration-aborted", "the legacy store could not be read as a plan map — staying on it", { reason: "unreadable", len: legacyRaw.length }); return false; }
  const ids = Object.keys(src);
  for (const id of ids) if (!isObj(src[id])) { reportClientEvent("plan-store-migration-aborted", "a stored plan is not an object — staying on the legacy store", { reason: "malformed", id }); return false; }
  /* HEADROOM FIRST. The copy sits NEXT TO the kept original, so it needs roughly the library's size again. The browser's per-origin cap is ~5.2M
   * characters (measured), and a device that is already most of the way there (the owner's was 3.88 MB used) would "fit" the copy by a hair and then
   * be one edit from "storage full". So the split is refused, before writing anything, unless it leaves real room afterwards. This is NOT an error:
   * the store keeps the old layout, unchanged, and the numbers are reported so the next step is data-driven. */
  const cap = lsCapChars();
  if (cap !== Infinity) {
    const used = lsUsedChars(), need = legacyRaw.length + ids.length * (base.length + 12) + 600;
    if (used + need + HEADROOM_AFTER_CHARS > cap) {
      reportClientEvent("plan-store-migration-aborted", "not enough free room beside the original to split the store safely — staying on the original (nothing was changed)", { reason: "headroom", plans: ids.length, legacyLen: legacyRaw.length, usedChars: used, needChars: need, capChars: cap, shortBy: used + need + HEADROOM_AFTER_CHARS - cap });
      return false;
    }
  }
  const created = [];               // keys THIS attempt created (so an abort removes only those)
  const want = new Map();           // id → the text the entry must hold when we are done
  const abort = (reason, extra) => {
    for (const k of created) del(k);
    reportClientEvent("plan-store-migration-aborted", "per-plan copy did not complete — staying on the legacy store (nothing was changed or lost)", { reason, plans: ids.length, legacyLen: legacyRaw.length, ...(extra || {}) });
    return false;
  };
  try {
    for (const id of ids) {
      const frag = JSON.stringify(src[id]);
      const k = pkey(base, id);
      const prior = get(k);
      let text = frag;
      if (prior != null && prior !== frag) {                    // an entry left by an interrupted attempt / another tab: keep the NEWER, never destroy
        try { if (toMs(JSON.parse(prior).updatedAt) > toMs(src[id].updatedAt)) text = prior; } catch (_) {}
      }
      if (prior !== text) { set(k, text); if (prior == null) created.push(k); }
      want.set(id, text);
    }
    for (const [id, text] of want) {                            // READ EVERY ONE BACK and compare with the source
      const back = get(pkey(base, id));
      if (back !== text) return abort("readback-mismatch", { id });
      if (text === JSON.stringify(src[id]) && JSON.stringify(JSON.parse(back)) !== JSON.stringify(src[id])) return abort("roundtrip-mismatch", { id });
    }
    const led = { sig: sigOf(legacyRaw), len: legacyRaw.length, ids, at: Date.now() };
    set(base + LED, JSON.stringify(led)); created.push(base + LED);
    const idx = { v: 1, ok: true, gen: uniq(), stale: false, mig: { at: Date.now(), count: ids.length, len: legacyRaw.length, ms: Date.now() - t0 } };
    set(idxKeyOf(base), JSON.stringify(idx));
    if (get(idxKeyOf(base)) !== JSON.stringify(idx)) { del(idxKeyOf(base)); return abort("index-readback"); }
  } catch (e) {
    del(idxKeyOf(base));
    return abort(e && /quota/i.test(String(e.name || e.message)) ? "quota" : "error", { error: String((e && e.message) || e).slice(0, 120) });
  }
  reportClientEvent("plan-store-migrated", "device store split into one entry per plan (the original entry was kept untouched)", { plans: ids.length, legacyLen: legacyRaw.length, ms: Date.now() - t0 });
  return true;
}

/** Decide (once per page load, or until an index exists) which layout this store is in; migrate when needed. */
function ensureMode(base) {
  const s = stateOf(base);
  if (s.mode === "blob") return s;
  if (s.mode === null && get(LAYOUT_SWITCH) === "blob") {
    /* THE KILL SWITCH (`localStorage["planarfit:planStore:layout"] = "blob"`): run the pre-B2165120 layout without a redeploy. It is also the
     * harness's A/B lever ("same build, only the change toggled"). Honouring it never leaves the legacy entry BEHIND the per-plan entries:
     * if a split store exists, the legacy entry is refreshed first, so the old layout opens on everything. Turning it off again folds
     * whatever the blob layout wrote back in (the mixed-build rule). */
    const idxRaw = get(idxKeyOf(base)); let idx = null; try { idx = idxRaw ? JSON.parse(idxRaw) : null; } catch (_) {}
    if (idx && idx.v === 1 && idx.ok) { s.mode = "plan"; s.hasIdx = true; flushMirror(base); }
    s.mode = "blob"; s.hasIdx = false;
    return s;
  }
  if (s.mode === "plan" && s.hasIdx) {
    if (mirrorPolicy() === "sync") reconcileLegacy(base);        // behaviour suites plant data in the raw legacy key mid-test: notice it (cheap — pointer-equal to what we wrote)
    return s;
  }
  const idxRaw = get(idxKeyOf(base));
  if (idxRaw) {
    let idx = null; try { idx = JSON.parse(idxRaw); } catch (_) {}
    if (idx && idx.v === 1 && idx.ok) {
      s.mode = "plan"; s.hasIdx = true;
      if (!s.booted) { s.booted = true; reconcileLegacy(base); if (idx.stale) scheduleMirror(base); }
      return s;
    }
    reportClientEvent("plan-store-index-unrecognised", "the per-plan index is not a version this code understands — reading the legacy store", { idx: idxRaw.slice(0, 80) });
    s.mode = "blob"; return s;
  }
  const legacy = get(base);
  if (legacy == null && !listEntryIds(base).length) { s.mode = "plan"; s.hasIdx = false; return s; }   // nothing stored yet
  if (legacy == null) {                                          // entries but no legacy and no index: adopt them as the store
    s.mode = "plan"; touchIdx(base, s, { stale: true }); s.hasIdx = !!get(idxKeyOf(base)); return s;
  }
  if (migrate(base, s, legacy)) { s.mode = "plan"; s.hasIdx = true; s.booted = true; s.plans = new Map(); s.stamp = null; }
  else { s.mode = "blob"; s.blobFails++; }
  return s;
}

/* ================================ plan-mode reads ================================ */
function loadPlans(base, s) {
  const idxRaw = get(idxKeyOf(base));
  if (s.stamp !== null && idxRaw === s.stamp) return;
  const next = new Map(), p = base + PFX;
  for (const id of listEntryIds(base)) {
    const raw = get(p + id);
    if (raw == null) continue;
    const prev = s.plans.get(id);
    if (prev && prev.raw === raw) { next.set(id, prev); continue; }
    let obj; try { obj = JSON.parse(raw); } catch (_) { obj = undefined; }
    if (!isObj(obj)) { reportClientEvent("plan-entry-unreadable", "a per-plan entry could not be read — that plan is left out of this read, not deleted", { id, len: raw.length }); continue; }
    planJsonCache.set(obj, raw);   // B2236000 — the entry's own text IS this object's JSON (it was written by jsonOf): plainCopy / textOf reuse it
    next.set(id, { raw, obj });
  }
  s.plans = next; s.stamp = idxRaw; s.shared = null;
}

/** Bump the index (a new unique `gen`). Keeps this tab's cache stamp honest: if ANOTHER writer touched the index since this tab's last
 *  scan, the stamp is dropped so the next read rescans instead of trusting a cache that missed their write. */
function touchIdx(base, s, patch) {
  const key = idxKeyOf(base);
  const cur = get(key);
  let o = null; try { o = cur ? JSON.parse(cur) : null; } catch (_) {}
  const inSync = cur === s.stamp;
  const next = { ...(o && o.v === 1 ? o : { v: 1, ok: true, mig: null }), v: 1, ok: true, gen: uniq(), stale: true, ...(patch || {}) };
  const raw = JSON.stringify(next);
  try { set(key, raw); } catch (e) { reportClientEvent("plan-store-index-failed", "the per-plan index could not be written (the plan entry itself was)", { error: String((e && e.message) || e).slice(0, 100) }); s.stamp = null; return null; }
  s.hasIdx = true;
  s.stamp = inSync ? raw : null;
  return raw;
}

/* ================================ blob mode (the pre-B2165120 behaviour, unchanged) ================================ */
const planJsonCache = new WeakMap();   // plan object → the JSON text it serialised to (valid while that object is not mutated)
export function jsonOf(obj) {
  if (obj && typeof obj === "object") { let t = planJsonCache.get(obj); if (t === undefined) { t = JSON.stringify(obj); if (t !== undefined) planJsonCache.set(obj, t); } return t; }
  return JSON.stringify(obj);
}
function plansToJson(persist) {
  const parts = [];
  for (const [id, sObj] of Object.entries(persist)) { const frag = jsonOf(sObj); if (frag !== undefined) parts.push(JSON.stringify(id) + ":" + frag); }
  return "{" + parts.join(",") + "}";
}
/** The exact stored text of a SHARED plan object handed out by this store (undefined when not known — e.g. blob mode). Read-only. */
export function textOf(rec) { return rec && typeof rec === "object" ? planJsonCache.get(rec) : undefined; }
/** A private, mutable copy of ONE stored record — what a caller that will change a record must take from a shared read. */
export function plainCopy(rec) {
  if (!rec || typeof rec !== "object") return rec;
  try { const t = planJsonCache.get(rec); return JSON.parse(t !== undefined ? t : JSON.stringify(rec)); } catch (_) { return rec; }
}
function blobShared(base) {
  let raw; try { raw = lsNow().getItem(base); } catch (_) { return {}; }
  if (raw == null) return {};
  const w = snapshotIfCurrent(base, raw);
  if (w) return { ...w.obj };
  let obj; try { obj = JSON.parse(raw) || {}; } catch (_) { return {}; }
  rememberSnapshot(base, raw, obj);
  return { ...obj };
}
function blobWrite(base, obj) {
  /* B2236000 (round 6) — a device that could not be split (the owner's: 76 plans, 2.29M characters — `plan-store-migration-aborted`, reason headroom, on
   * every load) writes the WHOLE library on every write. Two things no longer happen when nothing changed: (1) a plan whose content equals what the
   * current snapshot already holds keeps that SAME object (so everything keyed on it — the list read's model memory — still recognises it), and
   * (2) a library text identical to what is stored is not written again (a cloud pull that changed nothing used to re-write all 2.3 MB). */
  const prev = currentSnapshot();
  const prevObj = prev && prev.key === base && (() => { try { return lsNow().getItem(base) === prev.str; } catch (_) { return false; } })() ? prev.obj : null;
  const persist = {};
  for (const [id, x0] of Object.entries(obj)) {
    let x = cfg.persistForm(x0);
    const was = prevObj && prevObj[id];
    if (was && was !== x && jsonOf(was) === jsonOf(x)) x = was;
    persist[id] = x;
  }
  try {
    const str = plansToJson(persist);
    let cur = null; try { cur = lsNow().getItem(base); } catch (_) { /* unreadable: write */ }
    if (cur !== str) set(base, str);
    rememberSnapshot(base, str, persist); return true;
  }
  catch (_) {
    try {
      const slim = {};
      for (const [id, x] of Object.entries(persist)) slim[id] = cfg.slim(x);
      const str = JSON.stringify(slim); set(base, str); rememberSnapshot(base, str, slim); return true;
    } catch (_2) { clearSnapshot(); return false; }
  }
}

/* ================================ the public surface ================================ */
/** The store as a shallow map of SHARED plan objects — READ-ONLY by contract (take `plainCopy` of a record you will change). */
export function readShared(base) {
  const s = ensureMode(base);
  if (s.mode === "blob") return blobShared(base);
  if (!s.hasIdx && !listEntryIds(base).length) return {};
  loadPlans(base, s);
  if (!s.shared) { const o = {}; for (const [id, e] of s.plans) o[id] = e.obj; s.shared = o; }
  return { ...s.shared };
}
/** The store as PRIVATE objects the caller may mutate freely (a rare whole-library read; costs a parse per plan). */
export function readFresh(base) {
  const sh = readShared(base), o = {};
  for (const [id, v] of Object.entries(sh)) o[id] = plainCopy(v);
  return o;
}
/** A cheap token that changes whenever ANY plan changes (a unique index `gen`; in blob mode the blob's own text). */
export function changeStamp(base) {
  const s = ensureMode(base);
  if (s.mode === "blob") { let r = null; try { r = lsNow().getItem(base); } catch (_) {} return r; }
  return "p:" + (get(idxKeyOf(base)) || "");
}
/** Does the store hold a record for `id`? Identical answer in both layouts; no parse. */
export function has(base, id) {
  if (!id) return false;
  const s = ensureMode(base);
  if (s.mode === "blob") { const w = currentSnapshot(); if (w && w.key === base && (() => { try { return lsNow().getItem(base) === w.str; } catch (_) { return false; } })()) return !!w.obj[id]; return !!blobShared(base)[id]; }
  return get(pkey(base, id)) != null;
}
/** What the persistence verifier reads back: in plan mode the plan's REAL entry (parsed from disk, not from a cache), else the blob's. */
export function readBack(base, id) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const w = currentSnapshot(); if (w && w.key === base && w.obj[id] && (() => { try { return lsNow().getItem(base) === w.str; } catch (_) { return false; } })()) return w.obj[id]; return blobShared(base)[id] || null; }
  const raw = get(pkey(base, id));
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}
/** An opaque stamp of THIS module's latest write, and whether the store still holds exactly it (the settle tick skips a re-write). */
export function writeStamp(base) {
  const s = ensureMode(base);
  if (s.mode === "blob") return currentSnapshot();
  return { base, raw: get(idxKeyOf(base)) };
}
export function writeStillCurrent(base, stamp) {
  if (!stamp) return false;
  const s = ensureMode(base);
  if (s.mode === "blob") { try { return stamp === currentSnapshot() && lsNow().getItem(stamp.key) === stamp.str; } catch (_) { return false; } }
  return stamp.base === base && !!stamp.raw && get(idxKeyOf(base)) === stamp.raw;
}

function writeEntry(base, s, id, rec) {
  let form = cfg.persistForm(rec), frag = JSON.stringify(form);
  try { set(pkey(base, id), frag); }
  catch (_) {                                                   // over quota — shed every inline raster (geometry still persists), as the blob always did
    try { form = cfg.slim(form); frag = JSON.stringify(form); set(pkey(base, id), frag); } catch (_2) { return false; }
  }
  s.plans.set(id, { raw: frag, obj: form }); s.shared = null;
  return true;
}
/** Persist ONE plan. Plan mode: one small entry + the ~60-byte index. Returns false only if the device refused it. */
export function writeOne(base, id, rec) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const all = blobShared(base); all[id] = rec; return blobWrite(base, all); }
  loadPlans(base, s);
  if (!writeEntry(base, s, id, rec)) return false;
  touchIdx(base, s);
  scheduleMirror(base);
  return true;
}
export function removeOne(base, id) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const all = blobShared(base); if (!(id in all)) return true; delete all[id]; return blobWrite(base, all); }
  del(pkey(base, id)); s.plans.delete(id); s.shared = null;
  touchIdx(base, s);
  scheduleMirror(base);
  return true;
}
/** Make the store equal `next` (id → record): writes only the plans whose content changed, removes the ones absent from `next`. */
export function writeMap(base, next) {
  const s = ensureMode(base);
  if (s.mode === "blob") return blobWrite(base, next);
  loadPlans(base, s);
  let ok = true, changed = false;
  for (const [id, rec] of Object.entries(next)) {
    const prev = s.plans.get(id);
    if (prev && prev.obj === rec) continue;
    const form = cfg.persistForm(rec);
    const frag = jsonOf(form);
    /* B2236000 (round 6) — the stored text is unchanged: KEEP the shared object this store already hands out (it is content-identical by
     * construction), so everything keyed on it (the list read's model cache) still recognises the plan. Swapping in `form` made every cloud
     * pull look like a rewrite of every plan. */
    if (prev && prev.raw === frag) continue;
    if (!writeEntry(base, s, id, rec)) ok = false; else changed = true;
  }
  for (const id of [...s.plans.keys()]) if (!(id in next)) { del(pkey(base, id)); s.plans.delete(id); s.shared = null; changed = true; }
  if (changed) { touchIdx(base, s); scheduleMirror(base); }
  return ok;
}
/** Remove the whole store (every entry, the index, the ledger, the legacy entry). */
export function clearStore(base) {
  for (const id of listEntryIds(base)) del(pkey(base, id));
  del(idxKeyOf(base)); del(base + LED); del(base);
  states.delete(base); clearSnapshot();
}
/** Test/diagnostic: which layout is this store in, and what does the index say. */
export function describe(base) {
  const s = ensureMode(base);
  let idx = null; try { idx = JSON.parse(get(idxKeyOf(base))); } catch (_) {}
  return { mode: s.mode, hasIdx: s.hasIdx, idx, entries: listEntryIds(base).length };
}
export function _resetForTest() { for (const s of states.values()) { clearTimeout(s.quietTimer); clearTimeout(s.maxTimer); } states.clear(); clearSnapshot(); }

/* ================================ mixed builds: fold an older tab's whole-blob write back in ================================ */
/** If the legacy entry no longer matches what we last wrote / agreed on, an older build (or a hand edit) wrote it: reconcile PER PLAN. */
export function reconcileLegacy(base) {
  const s = states.get(base);
  if (!s || s.mode !== "plan" || !s.hasIdx) return { changed: 0 };
  const cur = get(base);
  if (cur == null) { return { changed: 0 }; }
  if (s.mirrorStr !== undefined && cur === s.mirrorStr) return { changed: 0 };   // sync-policy fast path: still exactly what we wrote
  let led = null; try { led = JSON.parse(get(base + LED)); } catch (_) {}
  const sig = sigOf(cur);
  if (led && led.sig === sig) { if (mirrorPolicy() === "sync") s.mirrorStr = cur; return { changed: 0 }; }
  let obj; try { obj = JSON.parse(cur); } catch (_) { obj = undefined; }
  if (!cfg.merge) { s.reconcilePending = true; return { changed: 0, deferred: true }; }   // the model's merge rule is not injected yet (a light route booted first) — redo it the moment it is
  if (!isObj(obj)) { reportClientEvent("plan-store-legacy-unreadable", "the legacy entry was rewritten into something unreadable — left alone, per-plan entries unchanged", { len: cur.length }); return { changed: 0 }; }
  loadPlans(base, s);
  const prev = new Set((led && led.ids) || []);
  let adopted = 0, merged = 0, removed = 0, kept = 0;
  for (const [id, rec] of Object.entries(obj)) {
    if (!isObj(rec)) continue;
    const mine = s.plans.get(id);
    if (!mine) { if (prev.has(id)) continue; if (writeEntry(base, s, id, rec)) adopted++; continue; }
    if (JSON.stringify(rec) === mine.raw) continue;
    const a = toMs(rec.updatedAt), b = toMs(mine.obj.updatedAt);
    if (a > b || a === b) {
      const m = cfg.merge ? cfg.merge(plainCopy(mine.obj), rec) : (a > b ? rec : null);
      if (m && writeEntry(base, s, id, m)) merged++; else kept++;
    } else kept++;
  }
  for (const id of [...s.plans.keys()]) if (!(id in obj) && prev.has(id)) { del(pkey(base, id)); s.plans.delete(id); s.shared = null; removed++; }
  try { set(base + LED, JSON.stringify({ sig, len: cur.length, ids: Object.keys(obj), at: Date.now() })); } catch (_) {}
  touchIdx(base, s);
  if (adopted || merged || removed || kept) reportClientEvent("plan-store-legacy-merged", "an older-build write to the legacy entry was folded in per plan", { adopted, merged, removed, kept });
  scheduleMirror(base);
  if (adopted || merged || removed) { try { cfg.onForeignMerge && cfg.onForeignMerge(); } catch (_) {} }
  return { changed: adopted + merged + removed, adopted, merged, removed, kept };
}

/* ================================ the mirror ================================ */
export function mirrorPolicy() {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  if (g.__PLANYR_LEGACY_MIRROR === "sync" || g.__PLANYR_LEGACY_MIRROR === "idle") return g.__PLANYR_LEGACY_MIRROR;
  if (typeof document === "undefined") return "sync";
  /* Automation (Playwright / Puppeteer set navigator.webdriver) and the e2e flags default to "sync": ~160 behaviour suites and audit harnesses read the raw
   * legacy key to check what was saved, and with "sync" that key is as current as it ever was. Real users are never webdriver, so production is "idle". The
   * perf / verify harnesses that must measure the PRODUCTION policy opt in explicitly with `window.__PLANYR_LEGACY_MIRROR = "idle"`. */
  if (g.__PLANYR_E2E || g.__E2E || (typeof navigator !== "undefined" && navigator.webdriver === true)) return "sync";
  return "idle";
}
function scheduleMirror(base) {
  const s = states.get(base);
  if (!s || s.mode !== "plan") return;
  if (mirrorPolicy() === "sync") { flushMirror(base); return; }
  const now = Date.now();
  if (!s.dirtySince) s.dirtySince = now;
  clearTimeout(s.quietTimer);
  const wait = Math.max(0, Math.min(MIRROR_QUIET_MS, s.dirtySince + MIRROR_MAX_WAIT_MS - now));
  s.quietTimer = setTimeout(() => runIdle(() => flushMirror(base)), wait);
}
function runIdle(fn) {
  try { if (typeof requestIdleCallback === "function") { requestIdleCallback(fn, { timeout: 4000 }); return; } } catch (_) {}
  fn();
}
/** Bring the legacy entry up to date from the per-plan entries (already-serialised text, concatenated — no re-stringify). */
export function flushMirror(base) {
  const s = states.get(base);
  if (!s || s.mode !== "plan" || !s.hasIdx) return false;
  clearTimeout(s.quietTimer); s.quietTimer = null; s.dirtySince = 0;
  reconcileLegacy(base);                                       // never overwrite an older tab's write we have not folded in
  loadPlans(base, s);
  const ids = [...s.plans.keys()];
  const str = "{" + ids.map((id) => JSON.stringify(id) + ":" + s.plans.get(id).raw).join(",") + "}";
  try {
    set(base + LED, JSON.stringify({ sig: sigOf(str), len: str.length, ids, at: Date.now() }));   // ledger FIRST: a crash between leaves a signature that fails to match → a harmless equal-content merge
    set(base, str);
    s.mirrorStr = mirrorPolicy() === "sync" ? str : undefined;
  } catch (e) {
    reportClientEvent("plan-store-mirror-failed", "the legacy copy could not be refreshed (the per-plan entries are intact)", { error: String((e && e.message) || e).slice(0, 100), len: str.length });
    return false;
  }
  touchIdx(base, s, { stale: false });
  return true;
}
export function flushAllMirrors() { for (const base of [...states.keys()]) flushMirror(base); }

let hooked = false;
function hookPageEvents() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  try {
    window.addEventListener("pagehide", () => flushAllMirrors());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushAllMirrors();
      else for (const base of [...states.keys()]) reconcileLegacy(base);
    });
    /* Only REAL cross-tab events (storageArea is the localStorage) — the app's own synthetic same-tab "sites changed" events carry no storageArea and fire on every rename / list change; hashing a multi-MB entry for each of those would put the cost back on the UI path. */
    window.addEventListener("storage", (e) => { if (e && e.key && e.storageArea === lsNow() && states.has(e.key)) reconcileLegacy(e.key); });
  } catch (_) {}
}
