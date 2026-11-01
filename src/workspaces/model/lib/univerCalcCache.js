/* Model workspace — the CALCULATION CACHE: formula results remembered ON THIS DEVICE so the grid's first paint does not wait on a recalculation
 * (NEW-1, B2604xxx — docs/SPREADSHEET-UNIVER-SPIKE.md "Load time").
 *
 * THE COST IT REMOVES. Univer calculates a workbook's formulas only after its Rendered stage, in the worker, and shows blanks until the answer
 * lands: measured on the real app, 0.2–0.35 s of a ~0.9 s open on 1,000 formulas, ~1 s on 5,000. With `initialFormulaComputing: WHEN_EMPTY`
 * Univer skips any formula cell that already holds a value — so handing it the value from last time makes the first paint complete.
 *
 * ⛔ WHY IT LIVES ON THE DEVICE AND NOT IN THE SAVED WORKBOOK (the owner asked for the saved workbook; this is the deliberate deviation).
 * A derived value stored beside its source is exactly what the one-source-of-truth rule forbids, and here it would also BREAK the sync:
 * `migrateWorkbook` rebuilds a workbook field by field (an unknown field is dropped at every migration), and the cloud copy, the device
 * copy, the "different copy" bar (`sheetsDiverge`), the echo guard and the CAS push all compare WHOLE workbooks — so a cache field that
 * differs between two copies of identical content would raise the false conflict bar B2450528 spent a week removing. A cache beside the
 * workbook, in the LARGE tier (TIER-BY-REBUILDABILITY; storageCensus class `calccache`, rebuild = recompute), touches none of that.
 * Cost of the choice: the FIRST open on a device calculates as today; every open after it does not.
 *
 * CORRECT BY CONSTRUCTION. An entry is used only when its `h` equals the hash of EXACTLY what is about to load — the whole workbook (every
 * cell, every sheet) plus the project names that become defined names — and the workbook holds no volatile function. Any edit, from any
 * source (this grid, the owner's regular-grid hatch, another device's cloud copy, an import), changes the hash, so a stale value can never
 * be shown. A wrong guess costs nothing: the entry is ignored and Univer calculates as before.
 * THE NAMES ARE KEYED AS THE LOAD SAW THEM. Site.* / Plan.* arrive synchronously with the workbook, Comp.* only after a network fetch, so a key
 * that included the names present at WRITE time would never match the names present at the next LOAD. The key holds the names the load could
 * see; names that arrive later are applied the way they always were — as a defined-name change, which recalculates exactly their dependents.
 * The one visible consequence: a formula that reads a late-arriving name shows its last settled answer until that name lands (it used to show
 * #NAME? or blank), and then the live answer.
 * NEVER SEEDED: a workbook with a volatile function (NOW/TODAY/RAND…: its answer changes without an edit) or an array/spilling formula
 * (Univer keeps spilled cells apart from the cell the formula sits in; seeding only the anchor would lose the spill).
 * Pure functions + a tiny async store; no Univer import (the Model chunk primes the read, the Univer chunk consumes it). */
import { idbGet, idbPut } from "../../site-planner/lib/localDb.js";

export const CALC_KEY_PREFIX = "model:calc:v1:";
export const MAX_ENTRY_CHARS = 2_000_000;
/** Functions whose answer can change with no edit at all, or that read what a cell-by-cell cache cannot see. */
export const VOLATILE_RE = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|OFFSET|INDIRECT|CELL|INFO)\s*\(/i;
/** Functions whose result can SPILL into neighbouring cells. */
export const SPILL_RE = /\b(SEQUENCE|FILTER|SORT|SORTBY|UNIQUE|TRANSPOSE|MMULT|MINVERSE|TEXTSPLIT|XLOOKUP|HSTACK|VSTACK|TAKE|DROP|EXPAND|WRAPROWS|WRAPCOLS|CHOOSEROWS|CHOOSECOLS|RANDARRAY|ARRAYFORMULA|FLATTEN)\s*\(/i;

/** 53-bit string hash (cyrb53). Not cryptographic — it only has to make an accidental match between two different workbooks impossible in practice. */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The key of what is about to load: the canonical workbook text + the defined names it will carry. Equal text ⇒ equal inputs. */
export function calcHash(canonicalWorkbook, definedNames) {
  const defs = JSON.stringify(definedNames || {});
  return `${cyrb53(canonicalWorkbook)}.${cyrb53(canonicalWorkbook, 7)}.${canonicalWorkbook.length}.${cyrb53(defs, 3)}`;
}

/** Does any formula in this Planyr workbook make a cache unsafe (volatile or spilling)? */
export function cacheUnsafe(workbook) {
  for (const entry of (workbook && workbook.sheets) || []) {
    const cells = (entry.sheet && entry.sheet.cells) || {};
    for (const raw of Object.values(cells)) {
      if (typeof raw === "string" && raw.charCodeAt(0) === 61 /* = */ && (VOLATILE_RE.test(raw) || SPILL_RE.test(raw))) return true;
    }
  }
  return false;
}

/** From a Univer workbook snapshot (`fWb.save()`): `{ [sheetId]: { "row:col": [v, t] } }` for every formula cell holding a value, or null when
 *  the snapshot carries array-formula data (nothing is cached for a workbook that spills). */
export function collectValues(snap) {
  if (!snap || typeof snap !== "object" || !snap.sheets) return null;
  // a formula that is volatile or can spill (the same rule as `cacheUnsafe`, read from the snapshot's own formula text)
  for (const sheet of Object.values(snap.sheets)) for (const row of Object.values(sheet.cellData || {})) for (const cell of Object.values(row || {})) {
    if (cell && typeof cell.f === "string" && (VOLATILE_RE.test(cell.f) || SPILL_RE.test(cell.f))) return null;
  }
  for (const res of snap.resources || []) {
    if (/ARRAY|SPILL/i.test(String(res.name)) && res.data && !/^\s*(\{\s*\}|\[\s*\]|null|)\s*$/.test(String(res.data))) {
      let empty = false;
      try { const d = JSON.parse(res.data); empty = !d || (typeof d === "object" && Object.values(d).every((x) => !x || (typeof x === "object" && !Object.keys(x).length))); } catch (_) { empty = false; }
      if (!empty) return null;
    }
  }
  const out = {}; let n = 0;
  for (const [sheetId, sheet] of Object.entries(snap.sheets)) {
    const t = {};
    for (const [r, row] of Object.entries(sheet.cellData || {})) {
      for (const [c, cell] of Object.entries(row || {})) {
        if (!cell || (cell.f === undefined && cell.si === undefined)) continue;
        if (cell.v === undefined || cell.v === null) continue;
        t[`${r}:${c}`] = [cell.v, cell.t === undefined ? null : cell.t]; n++;
      }
    }
    if (Object.keys(t).length) out[sheetId] = t;
  }
  return n ? out : null;
}

/** Put the remembered values onto the formula cells of a Univer workbook-data object (mutates `data`). Returns how many cells were seeded. */
export function seedValues(data, values) {
  let n = 0;
  if (!data || !data.sheets || !values) return 0;
  for (const [sheetId, cells] of Object.entries(values)) {
    const cellData = data.sheets[sheetId] && data.sheets[sheetId].cellData;
    if (!cellData) continue;
    for (const [key, pair] of Object.entries(cells)) {
      const i = key.indexOf(":"); const cell = cellData[key.slice(0, i)] && cellData[key.slice(0, i)][key.slice(i + 1)];
      if (!cell || cell.f === undefined) continue;
      cell.v = pair[0]; if (pair[1] !== null && pair[1] !== undefined) cell.t = pair[1];
      n++;
    }
  }
  return n;
}

// ---- the store (device-local, IndexedDB; every method resolves, none throws) ----------------------------------------------------------
const primed = new Map();           // viewKey → { settled: bool, value: entry|null, promise }

/** Start reading this scope's entry now, so it is in memory by the time the grid mounts. Idempotent per key. */
export function primeCalcCache(viewKey) {
  if (!viewKey) return null;
  const hit = primed.get(viewKey); if (hit) return hit.promise;
  const rec = { settled: false, value: null, promise: null };
  rec.promise = idbGet(CALC_KEY_PREFIX + viewKey).then((v) => { rec.value = v && typeof v === "object" ? v : null; rec.settled = true; return rec.value; }, () => { rec.settled = true; return null; });
  primed.set(viewKey, rec);
  return rec.promise;
}
/** Has this scope's read finished (so `peekCalc` is final)? */
export const calcCacheSettled = (viewKey) => { const r = primed.get(viewKey); return !!r && r.settled; };
/** The entry if its read has finished (synchronous — the grid's `load()` cannot wait), else null. */
export const peekCalc = (viewKey) => { const r = primed.get(viewKey); return r && r.settled ? r.value : null; };

/** Remember `values` for the workbook whose hash is `h`. Skipped (and the old entry dropped) when too big. Best-effort. */
export async function writeCalc(viewKey, h, values) {
  if (!viewKey) return false;
  const entry = values ? { h, at: Date.now(), v: values } : null;
  if (entry && JSON.stringify(entry).length > MAX_ENTRY_CHARS) return false;
  const rec = primed.get(viewKey) || { settled: true, value: null, promise: Promise.resolve(null) };
  rec.value = entry; rec.settled = true; primed.set(viewKey, rec);
  try { await idbPut(CALC_KEY_PREFIX + viewKey, entry); return true; } catch (_) { return false; }
}

/** Is `entry` usable for the workbook about to load? (The one rule — hash equal, nothing volatile or spilling.) */
export const entryFits = (entry, h, workbook) => !!entry && entry.h === h && !!entry.v && !cacheUnsafe(workbook);
