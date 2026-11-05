/* planStore.js — WHERE THE DEVICE COPY OF EVERY PLAN LIVES (B2165120; legacy entry retired by B2200384).
 *
 * ⛔ THE PROBLEM. The device store used to be ONE localStorage entry (`planarfit:sites:v1`, or `planarfit:sites:cloud:<uid>` when signed
 * in) holding every plan on the device. An edit to one plan therefore rewrote ALL of them: the native `setItem` of a 3-4 MB blob
 * (30-60 ms, with ~290 ms flush spikes) was the floor under every paste / move / resize, and it grew with the LIBRARY, not with
 * the plan being edited. B217540 (x2, x3) removed every multiplier around that write; B2165120 removed the write; B2200384 removed the
 * whole-library copy that B2165120 kept beside the new entries.
 *
 * THE LAYOUT, per store key `K` (K = the old whole-library key, unchanged):
 *   K:p:<planId>     one entry per plan  (JSON of exactly the record the old blob held under that id) — THE TRUTH for which plans exist
 *                    (enumerated by key scan; the index never lists ids, so it can never disagree with them).
 *   K:idx            a ~100-byte INDEX: { v:1, ok:true, gen, mig?, migrating?, del?, legacyRetired? } — the layout marker, a unique change
 *                    stamp (every write gets a new `gen`, so a reader can tell "nothing changed" from ONE tiny read), and the two
 *                    migration facts below.
 *   K (itself)       the LEGACY whole-library entry. It exists only (a) on a device that has not yet been moved to per-plan entries, and
 *                    (b) transiently, while a migration is in flight (the plans not yet moved), and (c) if an OLDER build's tab that was
 *                    still open writes it after retirement. This build NEVER writes it as a mirror — a device never again writes the
 *                    whole library. `K:led` (the old mirror's ledger) is deleted wherever it is found.
 *
 * MIGRATION IS PLAN BY PLAN (B2200384). The old all-at-once copy needed the library's size AGAIN in free localStorage next to the kept
 * original, which a device near the ~5.2M-character cap does not have (the owner's: refused on every load; two team members' mirrors
 * failing every load). Now, for each plan: write its entry → read it back and compare → only then drop it from the legacy entry (a
 * rewrite of K with a SMALLER string needs no extra room). The peak extra room is ONE plan's entry. Roomy devices skip the blob rewrites
 * and just delete K once every entry has been read back. The index is written FIRST in a `migrating` state, so a crash at any point
 * resumes: a plan present in both places = the entry wins (it was verified, and may have been edited since); a plan only in the legacy
 * entry = still to move. `readShared` during a migration is entries ∪ the plans still in K. `idx.del` records plans deleted while
 * migrating, so a delete is never undone by the plan still sitting in K.
 *
 * RETIRING THE LEGACY ENTRY on a device the previous build had already split (B2165120 kept K as a mirror): on load, every per-plan
 * entry is read back from disk and counted against the plans K holds — every plan in K must exist as an entry or be a known-deleted id
 * (`idx.del`, or a tombstone via the injected `isDeleted`). A plan only K holds and nobody deleted is RECOVERED into an entry (never
 * dropped); a plan K holds more recently than its entry is merged (`mergeSiteContent`, union). Only then are K and K:led removed and
 * `idx.legacyRetired` written (`plan-store-legacy-retired {plans, freedChars}`). A device whose read-back fails or whose count still
 * disagrees keeps K and says why (`plan-store-legacy-kept`). Nothing here ever DELETES an entry because K lacks it: the old ledger
 * inference ("K held it before, K lacks it now, so an older tab deleted it") removed live plans on devices whose mirror write was
 * failing — measured on production client_errors, 2026-11 — and is gone.
 *
 * ONE-WAY RE-ADOPT (the mixed-build safety net, kept for one release). If K REAPPEARS on a device whose index says `legacyRetired` (an old
 * tab that was open during the deploy wrote it), each plan in it is folded in exactly as above (adopt what is new and not tombstoned, merge
 * what both edited, keep what this build has) and K is deleted again (`plan-store-legacy-readopted`). It is its own follow-up to remove.
 *
 * ⛔ A REVERT TO AN OLDER BUILD IS NO LONGER SUPPORTED once a device has retired its entry: an older build reads only K, which is gone.
 * (B2165120 promised the opposite; B2200384 deliberately ends that one rule, with the owner's go, 2026-11-03.)
 *
 * NO KILL SWITCH. The `planarfit:planStore:layout = "blob"` switch is deleted: with the legacy entry retired there is no old layout to
 * fall back to, and "rebuild the whole blob from entries" is exactly the whole-library write this item exists to end. The un-split
 * ("blob") code path remains only as the state of a store whose index this code does not understand, and as the harness red-proof arm
 * (`globalThis.__PLANYR_PLANSTORE_UNSPLIT = true`, set by test code only).
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
/* B2200385 — the real cap is engine-specific and not queryable (Chromium accepts ~5.2M characters; the iPhone failures in `client_errors` threw
 * "quota" although the 5.2M pre-check had passed). A quota failure brackets it: the store accepted `usedAtFail` characters and refused one
 * more write of `tried`. Remember the UPPER end for the rest of this page load so a retry never re-attempts a copy that cannot fit. */
let learnedCapHi = Infinity;
export function _learnedCap() { return learnedCapHi; }
function lsInventory(top = 8) {
  const rows = [], l = lsNow();
  try { for (let i = 0; i < l.length; i++) { const k = l.key(i); if (k == null) continue; rows.push([k.length > 48 ? k.slice(0, 45) + "…" : k, k.length + ((l.getItem(k) || "").length)]); } } catch (_) {}
  rows.sort((a, b) => b[1] - a[1]);
  return { keys: rows.length, top: rows.slice(0, top).map(([k, n]) => k + "=" + n).join(" · ") };
}
const IDX = ":idx", LED = ":led", PFX = ":p:";

const cfg = { persistForm: (x) => x, slim: (x) => x, merge: null, onForeignMerge: null, makeRoom: null, isDeleted: null };
/** storage.js injects the model-aware pieces: `persistForm(rec)` (drop IndexedDB-backed rasters), `slim(rec)` (the over-quota
 *  retry: shed every inline raster), `merge(mine, theirs)` (mergeSiteContent), `onForeignMerge()` (announce on the sites channel),
 *  `isDeleted(base, id)` (a durable tombstone says this plan was deleted — a legacy entry may not resurrect it) and
 *  `makeRoom({ base, reason, shortBy })` (B2200385 — async: free localStorage that is PROVEN safe to free, resolve `{ freedChars }`; called at
 *  most once per store per page load when the move cannot proceed for room, after which it is resumed). */
export function configure(c) {
  Object.assign(cfg, c || {});
  if (cfg.merge) for (const [base, s] of states) if (s.legacyPending) { s.legacyPending = false; if (s.mode === "plan" && s.hasIdx) legacyWatch(base, s); }
}

const lsNow = () => { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (_) { return null; } };
const get = (k) => { try { return lsNow().getItem(k); } catch (_) { return null; } };
const set = (k, v) => lsNow().setItem(k, v);
const del = (k) => { try { lsNow().removeItem(k); } catch (_) {} };
const toMs = (v) => (typeof v === "string" ? (Date.parse(v) || 0) : (v || 0));
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pkey = (base, id) => base + PFX + id;

/* ---- per-store state, reset whenever the underlying localStorage instance changes (test isolation) ---- */
const states = new Map();
function stateOf(base) {
  const l = lsNow();
  let s = states.get(base);
  if (!s || s.ls !== l) {
    s = { ls: l, base, mode: null, hasIdx: false, booted: false, stamp: null, plans: new Map(), shared: null,
      blobFails: 0, migrating: false, rest: null, migStuck: false, migTimer: null, legacyKept: false, folding: false };
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

/* ================================ migration (plan by plan; the legacy entry shrinks as entries are verified) ================================ */
const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
/** Parse the legacy entry into { raw, objs, frags } — `frags` are each plan's own JSON text (what its entry will hold, byte for byte). */
function parseLegacy(raw) {
  let src; try { src = JSON.parse(raw); } catch (_) { return { err: "unreadable" }; }
  if (!isObj(src)) return { err: "unreadable" };
  const objs = new Map(), frags = new Map();
  for (const id of Object.keys(src)) { if (!isObj(src[id])) return { err: "malformed", id }; objs.set(id, src[id]); frags.set(id, JSON.stringify(src[id])); }
  return { raw, objs, frags };
}
const readIdx = (base) => { const raw = get(idxKeyOf(base)); if (!raw) return null; try { const o = JSON.parse(raw); return o && o.v === 1 && o.ok ? o : null; } catch (_) { return null; } };
const roomy = (legacyLen, plans, base, used0) => { const cap = Math.min(lsCapChars(), learnedCapHi); return cap === Infinity || used0 + legacyLen + plans * (base.length + 12) + 600 + HEADROOM_AFTER_CHARS <= cap; };

/** First sight of a legacy entry with no index: validate it, write the index in its `migrating` state (the switch), then move the plans. */
function beginMigration(base, s, legacyRaw) {
  const t0 = Date.now();
  const p = parseLegacy(legacyRaw);
  if (p.err) { s.lastAbort = { reason: p.err, shortBy: 0 }; reportClientEvent("plan-store-migration-aborted", p.err === "malformed" ? "a stored plan is not an object — staying on the legacy store" : "the legacy store could not be read as a plan map — staying on it", { reason: p.err, len: legacyRaw.length, ...(p.id ? { id: p.id } : {}) }); return false; }
  const used0 = lsUsedChars();
  /* An entry left by an interrupted B2165120 attempt that is OLDER than the legacy record is a stale partial copy: remove it so the move re-copies the newer one.
   * (Never one that is newer or equal — that is the plan as last edited.) */
  for (const id of listEntryIds(base)) {
    const o = p.objs.get(id); if (!o) continue;
    try { const e = JSON.parse(get(pkey(base, id))); if (isObj(e) && toMs(o.updatedAt) > toMs(e.updatedAt)) del(pkey(base, id)); } catch (_) { del(pkey(base, id)); }
  }
  const idx = { v: 1, ok: true, gen: uniq(), migrating: { at: Date.now(), total: p.objs.size, len: legacyRaw.length, used0, roomy: roomy(legacyRaw.length, p.objs.size, base, used0) } };
  try { set(idxKeyOf(base), JSON.stringify(idx)); if (get(idxKeyOf(base)) !== JSON.stringify(idx)) throw new Error("index read-back differs"); }
  catch (e) {
    del(idxKeyOf(base));
    const isQuota = !!e && /quota/i.test(String(e.name || e.message));
    s.lastAbort = { reason: isQuota ? "quota" : "error", shortBy: 1000 };
    reportClientEvent("plan-store-migration-aborted", "the per-plan index could not be written — staying on the legacy store (nothing was changed or lost)", { reason: s.lastAbort.reason, plans: p.objs.size, legacyLen: legacyRaw.length, usedChars: used0, capChars: lsCapChars(), error: String((e && e.message) || e).slice(0, 120), afterRoom: !!s.roomDone, ...lsInventory() });
    return false;
  }
  s.mode = "plan"; s.hasIdx = true; s.booted = true; s.plans = new Map(); s.stamp = null; s.shared = null; s.migrating = true; s.rest = p; s.migT0 = t0;
  runMigration(base, s, idx.migrating.roomy ? Infinity : 150);
  return true;
}

function scheduleMigrationStep(base, s) {
  if (s.migTimer || s.migStuck) return;
  const go = () => { s.migTimer = null; if (states.get(base) === s && s.ls === lsNow() && s.migrating) runMigration(base, s, 150); };
  try { if (typeof requestIdleCallback === "function") { s.migTimer = requestIdleCallback(go, { timeout: 1500 }); return; } } catch (_) {}
  s.migTimer = setTimeout(go, 0);
}

/** Rewrite the legacy entry WITHOUT the plans already moved (a SMALLER string: it needs no extra room). A failure here is harmless — the entries win. */
function shrinkLegacy(base, s, moved) {
  const rest = s.rest; if (!rest) return false;
  const keep = [...rest.objs.keys()].filter((id) => !moved.has(id));
  const text = "{" + keep.map((id) => JSON.stringify(id) + ":" + rest.frags.get(id)).join(",") + "}";
  try {
    set(base, text);
    if (get(base) !== text) return false;
  } catch (_) { return false; }
  for (const id of moved) { rest.objs.delete(id); rest.frags.delete(id); }
  rest.raw = text; moved.clear();
  return true;
}

/** Move plans from the legacy entry into entries until done or the time budget is spent. Safe to call again at any time (a reload, another tab). */
function runMigration(base, s, budgetMs) {
  if (s.migrunning) return { done: false };
  s.migrunning = true;
  const t0 = now();
  try {
    const idx0 = readIdx(base);
    if (!idx0 || !idx0.migrating) { s.migrating = false; return { done: true }; }
    const legacyRaw = get(base);
    if (legacyRaw == null) return finishMigration(base, s, idx0);
    if (!s.rest || s.rest.raw !== legacyRaw) {
      const p = parseLegacy(legacyRaw);
      if (p.err) { s.migStuck = true; reportClientEvent("plan-store-migration-aborted", "the legacy entry became unreadable mid-migration — the moved plans are safe in their entries; the rest stay where they are", { reason: p.err, moved: listEntryIds(base).length }); return { done: false, stuck: true }; }
      s.rest = p;
    }
    const rest = s.rest, gone = new Set(idx0.del || []);
    const moved = new Set();      // moved (entry verified) but still in the legacy text
    /* A plan that already has an entry (moved before a reload, or edited since the move began) is a duplicate in the legacy text — the entry wins — so give that
     * room back FIRST: on a tight device the room those duplicates hold is exactly what the next plan's entry needs. */
    for (const id of rest.objs.keys()) if (get(pkey(base, id)) != null) moved.add(id);
    if (moved.size) shrinkLegacy(base, s, moved);
    let tried = 0;
    const put = (k, v) => { tried = k.length + v.length; set(k, v); };
    for (const id of [...rest.objs.keys()]) {
      if (gone.has(id)) { moved.add(id); continue; }                          // deleted while migrating — drop it from the legacy text, never copy it
      const frag = rest.frags.get(id), k = pkey(base, id);
      if (get(k) == null) {
        const cap = Math.min(lsCapChars(), learnedCapHi);
        if (cap !== Infinity && moved.size && cap - lsUsedChars() < k.length + frag.length + 400) shrinkLegacy(base, s, moved);   // make the room BEFORE asking for it
        try { put(k, frag); }
        catch (e) {
          if (!/quota/i.test(String((e && (e.name || e.message)) || ""))) return stuck(base, s, "error", e, rest, moved, tried);
          if (!(moved.size && shrinkLegacy(base, s, moved))) return stuck(base, s, "quota", e, rest, moved, tried);
          try { put(k, frag); } catch (e2) { return stuck(base, s, "quota", e2, rest, moved, tried); }
        }
        const back = get(k);
        if (back !== frag) { del(k); return stuck(base, s, "readback-mismatch", null, rest, moved, tried, id); }
        let rt; try { rt = JSON.stringify(JSON.parse(back)); } catch (_) { rt = null; }
        if (rt !== frag) { del(k); return stuck(base, s, "roundtrip-mismatch", null, rest, moved, tried, id); }
      }
      moved.add(id);
      if (now() - t0 > budgetMs && moved.size < rest.objs.size) {
        if (moved.size) shrinkLegacy(base, s, moved);
        touchIdx(base, s, {}); s.stamp = null; s.shared = null;
        scheduleMigrationStep(base, s);
        return { done: false };
      }
    }
    return finishMigration(base, s, readIdx(base) || idx0);                    // K is deleted outright by the finish — no last rewrite
  } finally { s.migrunning = false; }
}

function stuck(base, s, reason, e, rest, moved, tried, id) {
  const isQuota = reason === "quota";
  const usedAtFail = lsUsedChars();
  if (isQuota) learnedCapHi = Math.min(learnedCapHi, usedAtFail + tried);
  if (moved.size) shrinkLegacy(base, s, moved);
  s.migStuck = true; s.lastAbort = { reason, shortBy: tried + 400 };
  s.stamp = null; s.shared = null;
  reportClientEvent("plan-store-migration-aborted", "the per-plan move could not finish — every plan is still readable (moved ones from their entries, the rest from the legacy entry); it resumes on the next load", { reason, remaining: rest.objs.size, entries: listEntryIds(base).length, needChars: tried, usedChars: usedAtFail, capChars: lsCapChars(), ...(isQuota ? { usedAtFail, capHiChars: usedAtFail + tried } : {}), ...(e ? { error: String((e && e.message) || e).slice(0, 120) } : {}), ...(id ? { id } : {}), afterRoom: !!s.roomDone, ...lsInventory() });
  askForRoom(base, s);
  return { done: false, stuck: true };
}

/** Every plan has a verified entry: read ALL of them back, count them, then (and only then) mark the store retired and delete the legacy entry. */
function finishMigration(base, s, idx) {
  const rest = s.rest || { objs: new Map() };
  const gone = new Set(idx.del || []);
  const expect = new Set(listEntryIds(base));
  for (const id of rest.objs.keys()) if (!gone.has(id)) expect.add(id);
  for (const id of expect) {
    const raw = get(pkey(base, id)); let ok = false;
    if (raw != null) { try { ok = isObj(JSON.parse(raw)); } catch (_) { ok = false; } }
    if (!ok) { s.migStuck = true; reportClientEvent("plan-store-migration-aborted", "a moved plan could not be read back — the legacy entry is kept", { reason: "final-readback", id, plans: expect.size }); return { done: false, stuck: true }; }
  }
  const legacyRaw = get(base), ledRaw = get(base + LED);
  const m = idx.migrating || {};
  /* What the device gets back is the ORIGINAL entry (the shrinks along the way already returned part of it): report the whole of it. */
  const freedChars = (legacyRaw != null || m.len ? base.length + Math.max(m.len || 0, legacyRaw ? legacyRaw.length : 0) : 0) + (ledRaw ? base.length + LED.length + ledRaw.length : 0);
  const next = { ...idx }; delete next.migrating; delete next.del; delete next.stale;
  next.v = 1; next.ok = true; next.gen = uniq(); next.legacyRetired = new Date().toISOString();
  next.mig = { at: m.at || Date.now(), count: expect.size, len: m.len || 0, ms: Date.now() - (s.migT0 || Date.now()) };
  try { set(idxKeyOf(base), JSON.stringify(next)); } catch (e) { s.migStuck = true; reportClientEvent("plan-store-migration-aborted", "the index could not be finalised — the legacy entry is kept", { reason: "index-final", error: String((e && e.message) || e).slice(0, 100) }); return { done: false, stuck: true }; }
  del(base); del(base + LED);
  s.migrating = false; s.rest = null; s.stamp = null; s.shared = null; s.plans = new Map();
  reportClientEvent("plan-store-migrated", "device store moved to one entry per plan (the whole-library entry was removed after every plan was read back)", { plans: expect.size, legacyLen: m.len || 0, ms: next.mig.ms, usedChars: m.used0 || 0, incremental: !m.roomy, afterRoom: !!s.roomDone, ...(s.roomFreed ? { freedChars: s.roomFreed } : {}) });
  reportClientEvent("plan-store-legacy-retired", "the whole-library device entry was removed", { plans: expect.size, freedChars, via: "migration" });
  return { done: true };
}

/** Decide (once per page load, or until an index exists) which layout this store is in; migrate when needed. */
function ensureMode(base) {
  const s = stateOf(base);
  if (s.mode === "blob") return s;
  if (s.mode === null && typeof globalThis !== "undefined" && globalThis.__PLANYR_PLANSTORE_UNSPLIT === true) { s.mode = "blob"; s.hasIdx = false; return s; }   // harness red-proof arm only
  if (s.mode === "plan" && s.hasIdx) { legacyWatch(base, s); return s; }
  const idxRaw = get(idxKeyOf(base));
  if (idxRaw) {
    let idx = null; try { idx = JSON.parse(idxRaw); } catch (_) {}
    if (idx && idx.v === 1 && idx.ok) {
      s.mode = "plan"; s.hasIdx = true; s.migrating = !!idx.migrating;
      if (!s.booted) {
        s.booted = true;
        if (idx.migrating) runMigration(base, s, idx.migrating.roomy ? Infinity : 150);
        else legacyWatch(base, s);
      }
      return s;
    }
    reportClientEvent("plan-store-index-unrecognised", "the per-plan index is not a version this code understands — reading the legacy store", { idx: idxRaw.slice(0, 80) });
    s.mode = "blob"; return s;
  }
  const legacy = get(base);
  if (legacy == null && !listEntryIds(base).length) { s.mode = "plan"; s.hasIdx = false; return s; }   // nothing stored yet
  if (legacy == null) {                                          // entries but no legacy and no index: adopt them as the store
    s.mode = "plan"; touchIdx(base, s, {}); s.hasIdx = !!get(idxKeyOf(base)); return s;
  }
  if (!beginMigration(base, s, legacy)) { s.mode = "blob"; s.blobFails++; askForRoom(base, s); }
  return s;
}

/* B2200385 — when the move cannot proceed for ROOM (a plan's entry will not fit even after the legacy text shrank, or the index could not be
 * written), ask storage.js to free localStorage that is proven safe to free: first the legacy entry itself if one exists and the entries verify,
 * then the version-history mirror (once IndexedDB holds a verified identical copy), then re-fetchable caches. Then resume, in the same page load.
 * At most once per store per page load; every outcome is reported. */
function askForRoom(base, s) {
  const a = s.lastAbort;
  if (!cfg.makeRoom || s.roomAsked || !a || (a.reason !== "headroom" && a.reason !== "quota")) return;
  s.roomAsked = true;
  const ls = s.ls;
  Promise.resolve().then(() => cfg.makeRoom({ base, reason: a.reason, shortBy: a.shortBy })).then((res) => {
    if (states.get(base) !== s || s.ls !== ls) return;            // the store instance was replaced under us (test isolation / a reset)
    s.roomDone = true; s.roomFreed = (res && res.freedChars) || 0;
    if (!res || !(res.freedChars > 0)) { reportClientEvent("plan-store-room-none", "no localStorage could be freed safely — the move stays unfinished", { base: base.slice(0, 40), reason: a.reason, shortBy: a.shortBy, learnedCapHi: learnedCapHi === Infinity ? null : learnedCapHi, ...(res || {}) }); return; }
    retryMigration(base);
  }).catch((e) => reportClientEvent("plan-store-room-failed", "making room for the per-plan move failed — nothing was changed", { error: String((e && e.message) || e).slice(0, 120) }));
}
/** Resume a move that stopped for room (or run the first move again for a store whose index could not be written). */
export function retryMigration(base) {
  const s = states.get(base);
  if (!s) return null;
  if (s.migrating && s.migStuck) { s.migStuck = false; runMigration(base, s, 150); return s.mode; }
  if (s.mode !== "blob") return s.mode;
  s.mode = null; s.shared = null;
  const r = ensureMode(base);
  if (r.mode === "plan") { r.shared = null; r.plans = new Map(); r.stamp = null; }
  return r.mode;
}
/** For tests and the harness: run a started migration to completion synchronously. */
export function _drainMigration(base, maxRounds = 10000) {
  const s = states.get(base); if (!s) return false;
  for (let i = 0; s.migrating && i < maxRounds; i++) { s.migStuck = false; runMigration(base, s, Infinity); if (s.migStuck) break; }
  return !s.migrating;
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
  let idx = null; try { idx = idxRaw ? JSON.parse(idxRaw) : null; } catch (_) {}
  s.migrating = !!(idx && idx.migrating);
  if (s.migrating) {
    /* A move is in flight: the plans not yet moved are still in the legacy entry. An entry (verified, maybe edited since) always wins over the legacy copy. */
    const legacyRaw = get(base);
    if (legacyRaw != null) {
      if (!s.rest || s.rest.raw !== legacyRaw) { const pl = parseLegacy(legacyRaw); if (!pl.err) s.rest = pl; }
      const gone = new Set(idx.del || []);
      if (s.rest) for (const [id, o] of s.rest.objs) if (!next.has(id) && !gone.has(id)) { const frag = s.rest.frags.get(id); planJsonCache.set(o, frag); next.set(id, { raw: frag, obj: o }); }
    }
  } else s.rest = null;
  s.plans = next; s.stamp = idxRaw; s.shared = null;
}

/** Bump the index (a new unique `gen`). Keeps this tab's cache stamp honest: if ANOTHER writer touched the index since this tab's last
 *  scan, the stamp is dropped so the next read rescans instead of trusting a cache that missed their write. */
function touchIdx(base, s, patch) {
  const key = idxKeyOf(base);
  const cur = get(key);
  let o = null; try { o = cur ? JSON.parse(cur) : null; } catch (_) {}
  const inSync = cur === s.stamp;
  /* A brand-new index on a device with no legacy entry: there is nothing to retire, so say so — a whole-library entry that appears later was written by an older tab. */
  const fresh = !(o && o.v === 1);
  const next = { ...(o && o.v === 1 ? o : { v: 1, ok: true, mig: null }), v: 1, ok: true, gen: uniq(), ...(fresh && get(base) == null ? { legacyRetired: new Date().toISOString() } : {}), ...(patch || {}) };
  delete next.stale;
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
function blobWrite(base, obj, ctxId = null) {
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
    rememberSnapshot(base, str, persist); pendingRetry.clear(); return true;
  }
  catch (_) {
    try {
      const slim = {};
      for (const [id, x] of Object.entries(persist)) slim[id] = cfg.slim(x);
      const str = JSON.stringify(slim); set(base, str); rememberSnapshot(base, str, slim); pendingRetry.clear(); return true;
    } catch (err) { clearSnapshot(); refuseWrite({ base, id: ctxId, rec: ctxId ? obj[ctxId] : null, frag: null, rawChars: 0, err, mode: "blob", plans: Object.keys(obj).length, existed: !!(ctxId && prevObj && prevObj[ctxId]) }); return false; }
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
  if (get(pkey(base, id)) != null) return true;
  if (s.migrating) { loadPlans(base, s); return s.plans.has(id); }   // a move is in flight: the plan may still be in the legacy entry
  return false;
}
/** What the persistence verifier reads back: in plan mode the plan's REAL entry (parsed from disk, not from a cache), else the blob's. */
export function readBack(base, id) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const w = currentSnapshot(); if (w && w.key === base && w.obj[id] && (() => { try { return lsNow().getItem(base) === w.str; } catch (_) { return false; } })()) return w.obj[id]; return blobShared(base)[id] || null; }
  let raw = get(pkey(base, id));
  if (raw == null && s.migrating) { loadPlans(base, s); const e = s.plans.get(id); raw = e ? e.raw : null; }
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

/* ⛔ NEW-1 (2026-11-03) — A REFUSED DEVICE WRITE IS REPORTED, NEVER RETURNED SILENTLY (LOUD-FAILURE; docs/DATA.md §5).
 * `writeEntry` / `blobWrite` used to `return false` on the second (slimmed) failure with no telemetry, and `duplicatePlan` ignored the boolean: a
 * teammate's copy was written nowhere, the app said "saved on this device", navigated into it, and a reload said "This project doesn't exist".
 * Now: (1) the refusal is an event (`plan-store-write-refused`) carrying the reason and the same inventory the migration abort uses; (2) the FIRST
 * refusal of a page load asks `cfg.makeRoom` (history ring → IndexedDB, rebuildable caches) once, and — when room was freed — re-attempts the write of
 * an EXISTING plan (an edit, never a brand-new record: a new record's caller decides, so no ghost plan can appear later); (3) `lastRefusal(id)` lets
 * `saveSite` and the mint flows say WHY. The function still returns false when it really cannot write. */
let lastRefusalInfo = null;
export function lastRefusal(id) { return lastRefusalInfo && (id == null || lastRefusalInfo.id === id) ? lastRefusalInfo : null; }
const isQuotaError = (e) => !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014 || /quota/i.test(String(e.message || "")));
export const refusalReason = (e) => (!lsNow() ? "unavailable" : isQuotaError(e) ? "quota" : String((e && e.name) || "error").slice(0, 40));

const roomState = { promise: null, done: false };
const pendingRetry = new Map();     // plan id → { base, rec } — an EXISTING plan whose edit was refused; re-attempted once if room is made
let inRetry = false;
function runRoom({ base, reason, shortBy }) {
  roomState.done = false;
  roomState.promise = Promise.resolve().then(() => cfg.makeRoom({ base, reason, shortBy })).then((res) => {
    const freedChars = (res && res.freedChars) || 0;
    reportClientEvent("plan-store-write-room", freedChars > 0 ? "made room after a refused device write" : "no room could be made after a refused device write", { reason, shortBy, freedChars, ...(res && res.steps ? { steps: res.steps } : {}) });
    if (freedChars > 0 && pendingRetry.size) {
      const todo = [...pendingRetry]; pendingRetry.clear(); inRetry = true;
      try { for (const [id, p] of todo) { let ok = false; try { ok = writeOne(p.base, id, p.rec); } catch (_) { ok = false; } reportClientEvent("plan-store-write-retried", "re-attempted a refused plan write after making room", { id, ok }); } }
      finally { inRetry = false; }
    }
    roomState.done = true;
    return { freedChars, steps: (res && res.steps) || "" };
  }).catch((e) => {
    roomState.done = true;
    reportClientEvent("plan-store-write-room-failed", "making room after a refused device write failed — nothing was changed", { error: String((e && e.message) || e).slice(0, 120) });
    return { freedChars: 0, error: true };
  });
  return roomState.promise;
}
/** Ask for room: shares the in-flight (or already-run) attempt — `makeRoom` runs ONCE per page load — unless `force` (an explicit user Retry). */
export function requestRoom({ base = null, reason = "quota", shortBy = 0, force = false } = {}) {
  if (!cfg.makeRoom) return Promise.resolve({ freedChars: 0, skipped: "no-hook" });
  if (roomState.promise && (!roomState.done || !force)) return roomState.promise;
  return runRoom({ base, reason, shortBy });
}
export function _resetRoomForTest() { roomState.promise = null; roomState.done = false; pendingRetry.clear(); lastRefusalInfo = null; inRetry = false; }

function refuseWrite({ base, id, rec, frag, rawChars, err, mode, plans, existed }) {
  try {
    const reason = refusalReason(err);
    const used = lsUsedChars(), cap = Math.min(lsCapChars(), learnedCapHi);
    const need = (frag ? frag.length : 0) + base.length + PFX.length + String(id).length;
    const shortBy = Number.isFinite(cap) ? Math.max(need - Math.max(0, cap - used), 0) || need : need;
    lastRefusalInfo = { reason, id, mode, shortBy, at: Date.now() };
    reportClientEvent("plan-store-write-refused", "the device refused to store a plan — nothing was written", {
      reason, error: String((err && err.name) || "").slice(0, 40), id, mode, fragChars: frag ? frag.length : 0, rawChars, usedChars: used,
      capChars: Number.isFinite(cap) ? cap : null, shortBy, plans, existed: !!existed, ...lsInventory(),
    });
    if (!inRetry) {
      if (existed && rec) pendingRetry.set(id, { base, rec });
      if (!roomState.promise && cfg.makeRoom) runRoom({ base, reason, shortBy });
    }
  } catch (_) { /* reporting a refusal must never throw into the save path */ }
}

function writeEntry(base, s, id, rec) {
  let form = cfg.persistForm(rec), frag = JSON.stringify(form);
  const rawChars = frag.length;
  try { set(pkey(base, id), frag); }
  catch (_) {                                                   // over quota — shed every inline raster (geometry still persists), as the blob always did
    try { form = cfg.slim(form); frag = JSON.stringify(form); set(pkey(base, id), frag); }
    catch (err) { refuseWrite({ base, id, rec, frag, rawChars, err, mode: "plan", plans: s.plans.size, existed: s.plans.has(id) }); return false; }
  }
  pendingRetry.delete(id);
  s.plans.set(id, { raw: frag, obj: form }); s.shared = null;
  return true;
}
/** Persist ONE plan. Plan mode: one small entry + the ~60-byte index. Returns false only if the device refused it. */
export function writeOne(base, id, rec) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const all = blobShared(base); all[id] = rec; return blobWrite(base, all, id); }
  loadPlans(base, s);
  if (!writeEntry(base, s, id, rec)) return false;
  touchIdx(base, s);
  return true;
}
export function removeOne(base, id) {
  const s = ensureMode(base);
  if (s.mode === "blob") { const all = blobShared(base); if (!(id in all)) return true; delete all[id]; return blobWrite(base, all); }
  del(pkey(base, id)); s.plans.delete(id); s.shared = null;
  touchIdx(base, s, s.migrating ? deletedWhileMigrating(base, [id]) : undefined);
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
  const dropped = [];
  for (const id of [...s.plans.keys()]) if (!(id in next)) { del(pkey(base, id)); s.plans.delete(id); s.shared = null; changed = true; dropped.push(id); }
  if (changed) touchIdx(base, s, s.migrating && dropped.length ? deletedWhileMigrating(base, dropped) : undefined);
  return ok;
}
/** While a move is in flight a plan deleted here may still sit in the legacy entry: remember it in the index so it is never copied back. */
function deletedWhileMigrating(base, ids) {
  const idx = readIdx(base);
  return { del: [...new Set([...((idx && idx.del) || []), ...ids])] };
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
  return { mode: s.mode, hasIdx: s.hasIdx, idx, entries: listEntryIds(base).length, migrating: !!s.migrating };
}
export function _resetForTest() { for (const s of states.values()) { try { clearTimeout(s.migTimer); if (typeof cancelIdleCallback === "function") cancelIdleCallback(s.migTimer); } catch (_) {} } states.clear(); clearSnapshot(); learnedCapHi = Infinity; }

/* ================================ the legacy entry on a device that has per-plan entries ================================ */
const safe = (fn, dflt) => { try { return fn(); } catch (_) { return dflt; } };
/** Write one plan's entry and prove it landed: the text on disk is exactly what the store now hands out. */
function putVerified(base, s, id, rec) {
  if (!writeEntry(base, s, id, rec)) return false;
  const e = s.plans.get(id);
  return !!e && get(pkey(base, id)) === e.raw;
}
/** Cheap, called from every entry point: is there a legacy entry on a store that has per-plan entries? (A missing key costs one failed lookup.) */
function legacyWatch(base, s) {
  if (s.migrating || s.legacyKept || s.folding) return;
  if (!s.legacyCleaned) { s.legacyCleaned = true; if (get(base + LED) != null && get(base) == null) del(base + LED); }
  const cur = get(base);
  if (cur == null) return;
  const idx = readIdx(base);
  if (!idx || idx.migrating) return;
  foldLegacy(base, s, cur, idx);
}
/** Bring a legacy entry's content into the per-plan entries, then remove it. NEVER deletes an entry because the legacy entry lacks it.
 *  RETIRE (idx has no `legacyRetired`: the entry is the previous build's mirror): the entry is removed only after every plan it holds is verified
 *  as a readable per-plan entry (recovering any that are missing and not known-deleted). READ-ADOPT (`legacyRetired` is set: an older tab wrote it):
 *  the same fold, reported as such. */
function foldLegacy(base, s, cur, idx) {
  const retire = !idx.legacyRetired;
  if (!cfg.merge) { s.legacyPending = true; return { ok: false, reason: "merge-not-injected" }; }   // the model's merge rule is not injected yet (a light route booted first) — redone the moment it is
  s.folding = true;
  const keep = (reason, extra) => { s.legacyKept = true; reportClientEvent("plan-store-legacy-kept", retire ? "the whole-library entry was NOT removed — it is kept and will be retried on the next load" : "an older build's whole-library write could not be folded in — it is kept", { reason, retire, len: cur.length, ...(extra || {}) }); return { ok: false, reason }; };
  try {
    let obj; try { obj = JSON.parse(cur); } catch (_) { obj = undefined; }
    if (!isObj(obj)) return keep("unreadable");
    for (const id of Object.keys(obj)) if (!isObj(obj[id])) return keep("malformed", { id });
    s.stamp = null; loadPlans(base, s);
    const gone = new Set(idx.del || []);
    const isGone = (id) => gone.has(id) || (cfg.isDeleted ? !!safe(() => cfg.isDeleted(base, id), false) : false);
    let adopted = 0, merged = 0, keptN = 0, skipped = 0;
    for (const [id, rec] of Object.entries(obj)) {
      const mine = s.plans.get(id);
      if (!mine) {
        if (isGone(id)) { skipped++; continue; }                       // known-deleted: not resurrected
        if (!putVerified(base, s, id, rec)) return keep("entry-write-failed", { id, adopted, merged });
        adopted++; continue;                                           // RECOVERED / adopted — a plan is never dropped for being absent from its entries
      }
      if (JSON.stringify(rec) === mine.raw) continue;
      if (toMs(rec.updatedAt) >= toMs(mine.obj.updatedAt)) {
        const m = cfg.merge(plainCopy(mine.obj), rec);
        if (!m) { keptN++; continue; }
        if (!putVerified(base, s, id, m)) return keep("entry-write-failed", { id, adopted, merged });
        merged++;
      } else keptN++;
    }
    if (retire) {
      /* THE COUNT: read every plan K holds back from disk, parsed — each must be an entry (or known-deleted). Only then may K go. */
      let ok = 0, expected = 0;
      for (const id of Object.keys(obj)) {
        if (isGone(id)) continue;
        expected++;
        const raw = get(pkey(base, id)); let good = false;
        if (raw != null) { try { good = isObj(JSON.parse(raw)); } catch (_) { good = false; } }
        if (good) ok++; else return keep("entry-readback", { id, ok, expected });
      }
      if (ok !== expected) return keep("count-mismatch", { ok, expected });
    }
    const led = get(base + LED);
    const freedChars = base.length + cur.length + (led != null ? base.length + LED.length + led.length : 0);
    const stamp = new Date().toISOString();
    const next = touchIdx(base, s, retire ? { legacyRetired: stamp } : {});
    if (retire && !next) return keep("index-write-failed");
    del(base); del(base + LED);
    s.stamp = null; s.shared = null;
    if (retire) reportClientEvent("plan-store-legacy-retired", "the whole-library device entry was removed after every plan was read back from its own entry", { plans: s.plans.size, freedChars, via: "mirror", recovered: adopted, merged });
    else reportClientEvent("plan-store-legacy-readopted", "an older build's whole-library write was folded in per plan and removed", { adopted, merged, kept: keptN, skipped, freedChars });
    if (adopted || merged) { try { cfg.onForeignMerge && cfg.onForeignMerge(); } catch (_) {} }
    return { ok: true, adopted, merged, kept: keptN, skipped, freedChars };
  } finally { s.folding = false; }
}
/** For storage.makeRoomForPlanStore: retire the legacy entry NOW if one exists and the entries verify. Resolves what it freed and why not. */
export function retireLegacy(base) {
  const before = get(base);                                      // what is on the device NOW (loading the store may itself retire it)
  const s = ensureMode(base);
  if (s.mode !== "plan" || !s.hasIdx) return { ok: false, freedChars: 0, reason: "not-split" };
  if (s.migrating) return { ok: false, freedChars: 0, reason: "migrating" };
  const gone = () => (before != null && get(base) == null ? { ok: true, freedChars: base.length + before.length, reason: "retired" } : null);
  const done = gone(); if (done) return done;
  const cur = get(base);
  if (cur == null) return { ok: true, freedChars: 0, reason: "none" };
  const idx = readIdx(base);
  if (!idx) return { ok: false, freedChars: 0, reason: "no-index" };
  s.legacyKept = false;
  const r = foldLegacy(base, s, cur, idx);
  return { ok: !!r.ok, freedChars: r.ok ? r.freedChars : 0, reason: r.ok ? "retired" : r.reason };
}

let hooked = false;
function hookPageEvents() {
  if (hooked || typeof window === "undefined") return;
  hooked = true;
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") for (const [base, s] of [...states]) { s.legacyKept = false; if (s.mode === "plan" && s.hasIdx) legacyWatch(base, s); }
    });
    /* Only REAL cross-tab events (storageArea is the localStorage): an older tab writing the legacy entry is folded in. */
    window.addEventListener("storage", (e) => {
      if (!e || !e.key || e.storageArea !== lsNow()) return;
      const s = states.get(e.key);
      if (s && s.mode === "plan" && s.hasIdx) { s.legacyKept = false; legacyWatch(e.key, s); }
    });
  } catch (_) {}
}
