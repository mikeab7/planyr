/* elsProof — "this exact stored plan text, under this exact build, needs no bonded-element repair" remembered across page loads (B2236000, round 6).
 *
 * WHY. A fresh page load models every plan on the device (the list read), and modelling a plan runs the bonded-child heal over its elements
 * (siteModel `normalizedEls`). On an owner-sized device (76 plans, 30 carrying their drawing) that first pass is ~290 ms of one main-thread task
 * at 2× CPU, and on a reload it re-proves exactly what the previous page load already proved: the stored text has not changed, the code has
 * not changed, and the heal is a pure function of the two. siteModel already remembers a proven-clean element list for the life of a page
 * (`CLEAN_ELS`); this carries the SAME fact across a reload, keyed so it can only ever be re-used for the identical input:
 *   • the BUILD (`__BUILD_ID__`, the commit) — any deploy, i.e. any change to the heal code, invalidates every proof at once;
 *   • the plan id AND a 64-bit hash + the length of the plan's exact stored text — any edit, pull or repair of that plan invalidates its proof.
 * A proof is only ever WRITTEN for a list the heal returned untouched (f(x) === x), so a list that needed a repair is never recorded and is
 * re-healed on every load until its repaired form is stored. Off where the build has no stable id (a dev server) unless a test opts in.
 *
 * STORAGE (TIER-BY-REBUILDABILITY, stated): this is a rebuildable cache in localStorage, the small store. It has to be read synchronously
 * before the first render, which IndexedDB cannot do; it is BOUNDED to one short entry per plan currently on the device (~40 bytes each, ~3 KB
 * for 76 plans), pruned to the live ids on every write, and losing it costs one slower load — never data. The same shape as `canvasGuess`. */
/* global __BUILD_ID__ */
export const ELS_PROOF_KEY = "planarfit:elsProof:v1";
const BUILD = typeof __BUILD_ID__ !== "undefined" ? String(__BUILD_ID__) : "";

/** 64 bits of hash (two independent 32-bit FNV-1a variants) + the length, as one short string. */
export function textHash(text) {
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  return (a >>> 0).toString(36) + "." + (b >>> 0).toString(36) + "." + text.length.toString(36);
}

const enabled = () => {
  try { if (typeof globalThis !== "undefined" && globalThis.__PLANYR_ELS_PROOF != null) return !!globalThis.__PLANYR_ELS_PROOF; } catch (_) {}
  try { if (import.meta.env && import.meta.env.DEV) return false; } catch (_) {}
  return !!BUILD && BUILD !== "dev";
};
const lsNow = () => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch (_) { return null; } };

let mem = null;          // { b, h: { id: hash } } as read from storage
let memLs = null;        // the storage instance `mem` was read from (a test swaps it)
let writeTimer = null;
function state() {
  const ls = lsNow();
  if (mem && memLs === ls) return mem;
  memLs = ls; mem = { b: BUILD, h: {} };
  try { const o = JSON.parse(ls && ls.getItem(ELS_PROOF_KEY)); if (o && o.b === BUILD && o.h && typeof o.h === "object") mem = { b: BUILD, h: { ...o.h } }; } catch (_) {}
  return mem;
}
/** Is this exact text of plan `id` proven to need no element repair under this build? */
export function elsProven(id, text) {
  if (!id || typeof text !== "string" || !enabled()) return false;
  const h = state().h[id];
  return typeof h === "string" && h === textHash(text);
}
/** Record that plan `id`'s exact stored `text` modelled with its element list untouched. Coalesced; written off the calling task. `liveIds`
 *  (optional) prunes the proofs of plans no longer on the device. */
export function recordElsProof(id, text, liveIds) {
  if (!id || typeof text !== "string" || !enabled()) return;
  const st = state();
  const hash = textHash(text);
  if (st.h[id] === hash && !liveIds) return;
  st.h[id] = hash;
  if (liveIds) for (const k of Object.keys(st.h)) if (!liveIds.has(k)) delete st.h[k];
  scheduleWrite();
}
function scheduleWrite() {
  if (writeTimer) return;
  const flush = () => { writeTimer = null; const ls = lsNow(); if (!ls || ls !== memLs) return; try { ls.setItem(ELS_PROOF_KEY, JSON.stringify(mem)); } catch (_) { /* a full store only costs the next load its re-proof */ } };
  writeTimer = setTimeout(flush, 0);
}
/** Tests: forget the in-memory copy (the next read re-reads storage). */
export function _resetElsProofForTest() { mem = null; memLs = null; if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; } }
