/* headerMerge.js — per-key THREE-WAY merge for the plan-HEADER fields (B1953797, H1).
 *
 * THE FACT. A plan's header row (`public.sites`) carries a few whole-object facts that are NOT
 * element rows: `settings` (setback, stalls, Standards, floodMitigation.jurKey, drainage.*,
 * printPreparedBy, …), `origin`, `layerOverrides`, `layerAbove`. They used to move as WHOLE OBJECTS,
 * last write wins: two tabs/devices holding the same plan each push their own copy of `settings`, so
 * tab A choosing Flood-mitigation jurisdiction = Waller was silently undone the next time tab B (whose
 * copy predates that choice) changed the setback — B's stale CAS conflict "self-healed" by refetching
 * only the version token and re-pushing B's whole, older settings.
 *
 * THE RULE (one home, used by the cloud push, the cloud refresh, and the local-mirror save):
 *   for every leaf, with BASE = the copy this writer last saw in sync, MINE = this writer's copy,
 *   THEIRS = the other writer's copy —
 *     · mine === theirs                     → that value.
 *     · mine === base   (I did not touch it)→ THEIRS   (adopt the other writer's change).
 *     · theirs === base (they did not)      → MINE     (a local dirty edit is NEVER lost).
 *     · both moved, differently             → recurse into plain objects; on a true same-leaf clash
 *                                             MINE wins (this writer's deliberate, most recent edit)
 *                                             and the clash is reported, never silent.
 *   Arrays and scalars are atoms (a list is replaced whole by whichever side changed it).
 *
 * This module is PURE (no I/O, no React). The header keys it governs are `MERGEABLE_HEADER_KEYS`;
 * everything else in the header (name, site, status, dates, …) keeps its existing last-write-wins
 * behaviour — see B1953797 on BACKLOG.md for what that leaves.
 */
// Own tiny key-order-independent serialiser: this module is imported by siteModel.js, and elementSync.js
// (where the repo's other stableStringify lives) sits in a cycle back into siteModel via elementRows.js.
function stableStringify(v) {
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined;
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => { const s = stableStringify(x); return s === undefined ? "null" : s; }).join(",") + "]";
  const parts = [];
  for (const k of Object.keys(v).sort()) { const s = stableStringify(v[k]); if (s !== undefined) parts.push(JSON.stringify(k) + ":" + s); }
  return "{" + parts.join(",") + "}";
}

export const MERGEABLE_HEADER_KEYS = ["settings", "origin", "layerOverrides", "layerAbove"];

// True when two header slices are content-identical (key-order independent).
export function sameHeader(a, b) { return stableStringify(a || {}) === stableStringify(b || {}); }

// The slice of a model this module governs. Absent keys stay absent (never fabricated as `{}`).
export function headerSlice(model) {
  const out = {};
  if (!model || typeof model !== "object") return out;
  for (const k of MERGEABLE_HEADER_KEYS) if (model[k] !== undefined) out[k] = model[k];
  return out;
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const eq = (a, b) => a === b || (a !== undefined && b !== undefined && stableStringify(a) === stableStringify(b));

// Recursive per-leaf three-way. Returns the merged value (undefined ⇒ the key is absent).
function merge3(base, mine, theirs, path, acc) {
  if (eq(mine, theirs)) return mine;
  if (eq(mine, base)) { acc.adopted.push({ path, value: theirs }); return theirs; }
  if (eq(theirs, base)) { acc.keptMine.push(path); return mine; }
  if (isPlain(mine) && isPlain(theirs)) {
    const b = isPlain(base) ? base : {};
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
      const v = merge3(b[k], mine[k], theirs[k], [...path, k], acc);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  // Same leaf, both sides moved to different values: this writer's edit stands — and is REPORTED.
  acc.conflicts.push(path);
  acc.keptMine.push(path);
  return mine;
}

/* mergeHeader(base, mine, theirs) — all three are header SLICES (see headerSlice).
 *   → { merged, adopted:[{path,value}], keptMine:[path], conflicts:[path], changedFromMine }
 * `adopted` are exactly the leaves whose value moved from MINE to THEIRS (what a live UI must apply);
 * `keptMine` are the leaves this writer changed relative to BASE and that therefore still have to be
 * pushed. `base` may be null/undefined (this writer never saw a synced copy): with no base nothing can
 * be attributed to the other writer, so the merge degenerates to MINE and says so via `noBase`. */
export function mergeHeader(base, mine, theirs) {
  const acc = { adopted: [], keptMine: [], conflicts: [] };
  const m = mine || {}, t = theirs || {};
  if (!base) {
    return { merged: { ...m }, adopted: [], keptMine: [], conflicts: [], changedFromMine: false, noBase: true };
  }
  const merged = {};
  for (const k of MERGEABLE_HEADER_KEYS) {
    const v = merge3(base[k], m[k], t[k], [k], acc);
    if (v !== undefined) merged[k] = v;
  }
  return { merged, adopted: acc.adopted, keptMine: acc.keptMine, conflicts: acc.conflicts, changedFromMine: acc.adopted.length > 0, noBase: false };
}

// Apply `adopted` leaf patches to a model's header keys immutably (only the leaves that moved).
// Used by a live UI so an adoption never overwrites an edit made in the same instant on OTHER leaves.
export function applyLeafPatches(obj, patches) {
  let out = obj;
  for (const { path, value } of patches || []) out = setPath(out, path, value);
  return out;
}
function setPath(obj, path, value) {
  if (!path.length) return value;
  const [k, ...rest] = path;
  const cur = isPlain(obj) ? obj : {};
  const next = setPath(cur[k], rest, value);
  if (next === undefined) { const { [k]: _drop, ...others } = cur; return others; }
  return { ...cur, [k]: next };
}
