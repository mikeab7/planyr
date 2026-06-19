// Building properties derived from square footage — clear height and slab
// thickness (B198). These are FIRST-CLASS building properties (stored on the
// element, available to any module), not print-only fields: the print data table
// (B197) reads them, the print options interface (B199) edits them.
//
// Each property has an auto-computed default (a function of the building's
// footprint sf, via an editable tiered rule) plus an OPTIONAL manual override.
// Override always wins; with no override the auto value recomputes whenever the
// building's sf changes. So a resized building self-updates unless the owner has
// pinned a value.
//
// Tier model: an ascending list of `{ upTo, value }`. A building of `sf` square
// feet uses the first tier whose `upTo` it falls strictly under (`sf < upTo`);
// the final tier carries `upTo: null` ("and above"). Strict `<` makes the UPPER
// tier inclusive at each boundary, exactly as the spec calls out:
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

// Evaluate a tiered rule for a given sf. Tolerant of partial/garbled input
// (returns the last tier's value, or null if there are no tiers).
export function evalTier(tiers, sf) {
  const list = Array.isArray(tiers) ? tiers : [];
  const s = num(sf) ?? 0;
  for (const t of list) {
    const up = num(t && t.upTo);
    if (up == null || s < up) return num(t && t.value);
  }
  return list.length ? num(list[list.length - 1].value) : null;
}

// Normalize a (possibly user-edited / partial) rules object into a complete,
// safe shape: both keys present, each an array ending in an `upTo: null` tier so
// every sf resolves. Never mutates the input.
export function normalizeRules(rules) {
  const fix = (tiers, fallback) => {
    let list = Array.isArray(tiers) && tiers.length ? tiers.map((t) => ({ upTo: num(t && t.upTo), value: num(t && t.value) })) : fallback.map((t) => ({ ...t }));
    // Guarantee a terminal "and above" tier.
    if (list.every((t) => t.upTo != null)) list = [...list, { upTo: null, value: list[list.length - 1].value }];
    return list;
  };
  const r = rules || {};
  return {
    clearHeight: fix(r.clearHeight, DEFAULT_BUILDING_RULES.clearHeight),
    slab: fix(r.slab, DEFAULT_BUILDING_RULES.slab),
  };
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
