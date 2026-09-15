// Building properties derived from square footage — clear height and slab
// thickness (B198). These are FIRST-CLASS building properties (stored on the
// element, available to any module), not print-only fields: the print data table
// (B197) reads them, and the Standards panel's "Buildings — program" section
// (NEW-1) is the editable home for the tier table itself.
//
// Each property has an auto-computed default (a function of the building's
// footprint sf, via an editable tiered rule) plus an OPTIONAL manual override.
// Override always wins; with no override the auto value recomputes whenever the
// building's sf changes. So a resized building self-updates unless the owner has
// pinned a value.
//
// Tier model: a list of `{ upTo, value }`, at most one of which carries
// `upTo: null` ("and above" — the terminal/universal tier). `evalTier` is
// deliberately ORDER-INDEPENDENT (NEW-1): it picks the tier with the SMALLEST
// `upTo` that the sf still qualifies under (`sf < upTo`), never "the first match
// walking the array". This is what makes the Standards panel's row REORDER a
// purely cosmetic action — swapping two rows' on-screen position can never
// change which tier a given sf resolves to, which a naive first-match walk
// would get wrong the moment rows aren't kept in ascending order. Strict `<`
// makes the UPPER tier inclusive at each boundary, exactly as the spec calls out:
//   clear height: <140k → 32′ · [140k, 600k) → 36′ · ≥600k → 40′
//   slab:         <140k → 6″  · ≥140k → 7″
// (so 140,000 sf → 36′ / 7″, and 600,000 sf → 40′.)

// Pure default rules. Persisted per-plan in `settings.buildingRules`; the print
// options interface (B199) edits a copy of this shape.
export const DEFAULT_BUILDING_RULES = {
  clearHeight: [
    { upTo: 140000, value: 32 },
    { upTo: 600000, value: 36 },
    { upTo: null, value: 40 },
  ],
  slab: [
    { upTo: 140000, value: 6 },
    { upTo: null, value: 7 },
  ],
};

// Finite-number coercion: returns a finite number or null (so "", null, NaN,
// ±Infinity all read as "not set" — the override-absent sentinel).
const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

// Evaluate a tiered rule for a given sf — ORDER-INDEPENDENT (see header). Tolerant
// of partial/garbled input (falls back to the last tier's value, or null if there
// are no tiers at all).
export function evalTier(tiers, sf) {
  const list = Array.isArray(tiers) ? tiers : [];
  if (!list.length) return null;
  const s = num(sf) ?? 0;
  let bestUpTo = Infinity, bestValue = null, hasTerminal = false, terminalValue = null;
  for (const t of list) {
    const up = num(t && t.upTo);
    const v = num(t && t.value);
    if (up == null) { hasTerminal = true; terminalValue = v; continue; }
    if (s < up && up < bestUpTo) { bestUpTo = up; bestValue = v; }
  }
  if (bestValue != null) return bestValue;
  if (hasTerminal) return terminalValue;
  return num(list[list.length - 1].value); // malformed (no terminal) — last entry, unchanged fallback
}

// Shared shape-fixer for ONE tier array: coerce to finite numbers, and guarantee a
// terminal "and above" tier so every sf resolves. Never mutates the input. Used by
// `normalizeRules` and by the CRUD helpers below so they can never disagree about
// what a "valid" tier list looks like.
function normalizeTierList(tiers, fallback) {
  let list = Array.isArray(tiers) && tiers.length ? tiers.map((t) => ({ upTo: num(t && t.upTo), value: num(t && t.value) })) : fallback.map((t) => ({ ...t }));
  if (list.every((t) => t.upTo != null)) list = [...list, { upTo: null, value: list[list.length - 1].value }];
  return list;
}

// Normalize a (possibly user-edited / partial) rules object into a complete,
// safe shape: both keys present, each an array carrying exactly one `upTo: null`
// tier so every sf resolves. Never mutates the input.
export function normalizeRules(rules) {
  const r = rules || {};
  return {
    clearHeight: normalizeTierList(r.clearHeight, DEFAULT_BUILDING_RULES.clearHeight),
    slab: normalizeTierList(r.slab, DEFAULT_BUILDING_RULES.slab),
  };
}

// ---- Standards-panel tier CRUD (NEW-1) — pure, so the owner's "add, edit, remove
// and reorder" ask is unit-testable without touching React. Each takes/returns ONE
// key's tier array (`rules.clearHeight` or `rules.slab`); the caller re-normalizes
// the whole rules object and commits it.

// Append a new tier just before the terminal, at a boundary above every existing
// finite one (never colliding with one), carrying the terminal's current value —
// so a fresh row starts as a no-op split of the top band until the owner edits it.
export function addTier(tiers) {
  const list = normalizeTierList(tiers, DEFAULT_BUILDING_RULES.clearHeight);
  const finiteUpTos = list.map((t) => t.upTo).filter((u) => u != null);
  let newUpTo = finiteUpTos.length ? Math.max(...finiteUpTos) + 50000 : 100000;
  while (finiteUpTos.includes(newUpTo)) newUpTo += 50000;
  const terminal = list.find((t) => t.upTo == null);
  const value = terminal ? terminal.value : list[list.length - 1].value;
  return [...list, { upTo: newUpTo, value }];
}

// Remove the tier at `idx`. Never drops below one tier (there must always be an
// answer for every sf); removing the terminal promotes the highest remaining
// boundary to the new terminal so the list stays resolvable.
export function removeTier(tiers, idx) {
  const list = normalizeTierList(tiers, DEFAULT_BUILDING_RULES.clearHeight);
  if (list.length <= 1) return list;
  const removingTerminal = list[idx] && list[idx].upTo == null;
  let next = list.filter((_, i) => i !== idx);
  if (removingTerminal && next.length && next.every((t) => t.upTo != null)) {
    let hi = 0;
    for (let i = 1; i < next.length; i++) if (next[i].upTo > next[hi].upTo) hi = i;
    next = next.map((t, i) => (i === hi ? { ...t, upTo: null } : t));
  }
  return next;
}

// Swap the tier at `idx` with its neighbor (`dir` -1 = up, +1 = down). Purely
// cosmetic — see the header note on `evalTier`'s order-independence.
export function moveTier(tiers, idx, dir) {
  const list = normalizeTierList(tiers, DEFAULT_BUILDING_RULES.clearHeight);
  const j = idx + dir;
  if (j < 0 || j >= list.length) return list;
  const next = list.slice();
  [next[idx], next[j]] = [next[j], next[idx]];
  return next;
}

// The largest finite boundary across a tier list — what the terminal ("and above")
// row's own label reads off, since after a reorder it can no longer assume the
// PREVIOUS array entry is the tier immediately below it (NEW-1).
export function maxFiniteUpTo(tiers) {
  const list = Array.isArray(tiers) ? tiers : [];
  const finite = list.map((t) => num(t && t.upTo)).filter((u) => u != null);
  return finite.length ? Math.max(...finite) : null;
}

export const autoClearHeight = (sf, rules = DEFAULT_BUILDING_RULES) => evalTier((rules || {}).clearHeight, sf);
export const autoSlab = (sf, rules = DEFAULT_BUILDING_RULES) => evalTier((rules || {}).slab, sf);

// Effective properties for one building element: { clearHeight, slab }, each
// `{ value, auto, overridden }`. `value` is what to show/print (override if set,
// else auto); `auto` is the rule-derived default; `overridden` flags a manual pin.
// Reads `el.clearHeightOverride` / `el.slabThicknessOverride` (null/absent = auto).
export function effectiveBuildingProps(el, sf, rules = DEFAULT_BUILDING_RULES) {
  const chAuto = autoClearHeight(sf, rules);
  const slAuto = autoSlab(sf, rules);
  const chOv = num(el && el.clearHeightOverride);
  const slOv = num(el && el.slabThicknessOverride);
  return {
    clearHeight: { value: chOv != null ? chOv : chAuto, auto: chAuto, overridden: chOv != null },
    slab: { value: slOv != null ? slOv : slAuto, auto: slAuto, overridden: slOv != null },
  };
}

// Display helpers: clear height in feet (32 → `32'`), slab in inches (7 → `7"`).
export const fmtClearHeight = (v) => (v == null ? "—" : `${Math.round(v * 10) / 10}'`);
export const fmtSlab = (v) => (v == null ? "—" : `${Math.round(v * 10) / 10}"`);
