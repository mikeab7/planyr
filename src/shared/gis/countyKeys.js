/* County ROUTING KEYS — normalise once, in one place (NEW-4).
 *
 * WHAT WENT WRONG. `public.sites.county` is a free-text column that every county-scoped
 * lookup in the app uses as an OBJECT KEY (`COUNTIES_MAP[county]`, `COUNTY_DISTRICT[county]`,
 * `defaultJurForCounty(county)`, …). Measured on production 2026-08-09: 38 rows store
 * `"harris"` and 2 rows store `"Harris"` (capital H, last written 2026-07-04). A raw
 * `MAP[key]` lookup misses those two rows, so on those plans the county-scoped sources
 * resolve to NOTHING — and because a miss returns `undefined` rather than throwing, the
 * app shows no error at all. A silent wrong answer, which is the failure LOUD-FAILURE
 * exists to prevent.
 *
 * THE RULE: a routing key is lower-case, trimmed, and internally single-underscored. Every
 * READ normalises (so a legacy mixed-case row still resolves) and every WRITE normalises
 * (so no new mixed-case row is created). The data migration fixes the rows already stored;
 * this function is what stops the class from coming back, including from an import, a
 * hand-edited row, or a future writer that forgets.
 *
 * ⛔ THIS IS NOT `floodGroup.countyKey`. That one canonicalises a DISPLAY NAME ("Fort Bend
 * County", "FORT BEND") to letters-only, which would destroy the Colorado prefix — it turns
 * `co_larimer` into `colarimer`, a key that exists nowhere. The two vocabularies are
 * different: this file normalises the app's own ROUTING KEY (`harris`, `fortbend`,
 * `co_larimer`); `floodGroup.countyKey` maps an agency's county NAME into a comparable slug.
 * Keep them apart.
 *
 * Pure — no imports, no DOM. */

/* Normalise a county routing key. Returns null for anything empty, so a caller can
 * distinguish "no county on this plan" from "a county we do not recognise". */
export function normCountyKey(value) {
  if (value == null) return null;
  /* ⛔ WHITESPACE IS REMOVED, NOT TURNED INTO AN UNDERSCORE, and that is a decision about THIS
   * vocabulary rather than a general slug rule. The underscore in a routing key is a STATE
   * PREFIX separator (`co_larimer`), never a word separator: the two-word counties in this app
   * are keyed `fortbend` and `sanjacinto`, run together. So "Fort Bend" must normalise to
   * `fortbend` — mapping the space to `_` would produce `fort_bend`, a key that exists nowhere,
   * and would silently reintroduce exactly the miss this module was written to close. */
  const k = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "")  // spaces, hyphens, punctuation — gone; the `_` prefix survives
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return k || null;
}

/* Look a county key up in a plain object map, normalising first. The one-liner every
 * `MAP[county]` call site becomes, so a mixed-case key can never silently miss. */
export function countyLookup(map, value, fallback = undefined) {
  if (!map) return fallback;
  const k = normCountyKey(value);
  if (k == null) return fallback;
  return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : fallback;
}

/* ⛔ THE DURABLE HALF OF THE FIX. Wrapping the county-keyed CONFIG MAPS themselves means no
 * lookup can miss — including one written next year by someone who never read this file. Patching
 * call sites one at a time is what let this class exist: `defaultFloodJurForCounty` normalised and
 * `defaultJurForCounty`, three lines away in a sibling module, did not.
 *
 * A Proxy is the right tool here and a wrong one in a hot loop: these are small, frozen CONFIG
 * objects read a handful of times per interaction, never per frame. `has`/`ownKeys`/`Object.keys`/
 * `Object.entries` all behave exactly as before (the trap is `get`, and only for a key that is
 * absent under its literal spelling but present under its normalised one).
 *
 * Deliberately NOT applied to sets/maps keyed by anything other than a county routing key. */
export function byCountyKey(map) {
  return new Proxy(map, {
    get(target, prop, recv) {
      if (typeof prop !== "string" || Reflect.has(target, prop)) return Reflect.get(target, prop, recv);
      const k = normCountyKey(prop);
      return k != null && Object.prototype.hasOwnProperty.call(target, k) ? target[k] : undefined;
    },
    has(target, prop) {
      if (typeof prop !== "string" || Reflect.has(target, prop)) return Reflect.has(target, prop);
      const k = normCountyKey(prop);
      return k != null && Object.prototype.hasOwnProperty.call(target, k);
    },
  });
}

/* The Set counterpart — `SNAPSHOT_COUNTIES.has("Harris")` must answer like `has("harris")`. */
export function countyKeySet(keys) {
  const inner = new Set([...keys].map(normCountyKey).filter(Boolean));
  return { has: (v) => inner.has(normCountyKey(v)), get size() { return inner.size; }, values: () => inner.values(), [Symbol.iterator]: () => inner[Symbol.iterator]() };
}

/* True when two county keys name the same county regardless of how they were spelled. */
export const sameCounty = (a, b) => {
  const ka = normCountyKey(a);
  return ka != null && ka === normCountyKey(b);
};
