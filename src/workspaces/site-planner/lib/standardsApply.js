/* NEW-3 — "Apply now": push a Standards value onto the objects that ALREADY exist.
 *
 * The gap this closes: Standards only ever seeded NEW objects ("Defaults for new elements"), so
 * changing the parcel outline color left every parcel already on the plan untouched, and the only
 * way to restyle them was Shift-selecting them all through the multi-select panel.
 *
 * The two object families need OPPOSITE mechanics, which is why this is a module and not a one-liner:
 *
 *  · PARCELS are STAMPED at creation (`parcelDefaultStyle` copies the default onto the parcel), so
 *    an existing parcel carries its own copy of the value. Applying = WRITE the new value onto each
 *    parcel.
 *  · ELEMENTS resolve their type style at RENDER (`typeStyle` reads settings each frame), so a
 *    changed type default already shows on every element — EXCEPT ones carrying a per-element
 *    override from the Properties panel. Applying = CLEAR that override, so the element falls back
 *    to the (new) default. Writing the value onto each element instead would freeze today's default
 *    onto them forever and defeat the next Standards change.
 *
 * Both return the changed rows plus a COUNT, so the caller can push one undo frame, do one state
 * update, and report "Applied to 12 parcels · Undo" honestly (a count of what actually changed —
 * objects already matching are not counted, so the toast never overstates).
 *
 * Pure; unit tests in test/standardsApply.test.js.
 */

// The parcel style keys Standards → Parcels can set, in panel order.
export const PARCEL_STD_KEYS = ["stroke", "weight", "dash", "fill", "fillOpacity"];
// The per-element-type keys Standards → Colors can set.
export const TYPE_STD_KEYS = ["fill", "stroke"];

const same = (a, b) => a === b || (a == null && b == null);

/**
 * Apply one parcel standard to every existing parcel.
 * @param parcels the current parcel list
 * @param key     one of PARCEL_STD_KEYS
 * @param value   the new value; `null` clears the key (back to the theme built-in)
 * @returns { parcels, count } — `parcels` is the SAME array reference when nothing changed.
 */
export function applyParcelStandard(parcels, key, value) {
  const list = parcels || [];
  let count = 0;
  const next = list.map((p) => {
    if (same(p[key], value)) return p;
    count++;
    if (value === null || value === undefined) { const { [key]: _drop, ...rest } = p; return rest; }
    return { ...p, [key]: value };
  });
  return count ? { parcels: next, count } : { parcels: list, count: 0 };
}

/**
 * Apply one element-type standard: drop the per-element override of `key` on every element of
 * `type`, so they follow the type default again.
 * @returns { els, count } — `els` is the SAME array reference when nothing changed.
 */
export function applyTypeStandard(els, type, key) {
  const list = els || [];
  let count = 0;
  const next = list.map((e) => {
    if (e.type !== type || e[key] === undefined) return e;
    count++;
    const { [key]: _drop, ...rest } = e;
    return rest;
  });
  return count ? { els: next, count } : { els: list, count: 0 };
}

/** How many objects an "Apply now" would actually change — drives the chip's count + disabled state. */
export function parcelStandardImpact(parcels, key, value) {
  return (parcels || []).reduce((n, p) => n + (same(p[key], value) ? 0 : 1), 0);
}
export function typeStandardImpact(els, type, key) {
  return (els || []).reduce((n, e) => n + (e.type === type && e[key] !== undefined ? 1 : 0), 0);
}

/** Toast copy: what changed, in the owner's plain terms. Never a sentence with a number of pixels. */
export function appliedLabel(count, noun) {
  return `Applied to ${count} ${noun}${count === 1 ? "" : "s"}`;
}
