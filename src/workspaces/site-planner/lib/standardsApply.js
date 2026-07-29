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

/* ------------------------------------------------------------------ ONE Apply for the panel
 *
 * The per-FIELD Apply + scope row was the owner's complaint: every setting carried its own chip
 * stack, and that stack was most of the panel's height. Standards is now ONE control set for the
 * whole panel — one Apply that pushes EVERY standard onto what's already drawn, in ONE undo frame.
 *
 * The count is DISTINCT OBJECTS, not the sum of per-key impacts: a parcel whose outline colour and
 * line weight both change is one object, so "Applied to 12 objects" is honest rather than inflated.
 * Built on the two per-key primitives above, so there is one engine, not two.
 */

/**
 * Apply every standard at once.
 * @param parcels       current parcels
 * @param els           current elements
 * @param parcelValues  { key: value } for the PARCEL_STD_KEYS currently in force
 * @param types         element types whose per-element overrides should be cleared
 * @returns { parcels, els, count } — the SAME array references when nothing changed.
 */
export function applyAllStandards(parcels, els, parcelValues = {}, types = []) {
  const touched = new Set();
  let nextParcels = parcels || [];
  PARCEL_STD_KEYS.forEach((key) => {
    if (!(key in parcelValues)) return;
    const before = nextParcels;
    const res = applyParcelStandard(before, key, parcelValues[key] ?? null);
    if (!res.count) return;
    // Identity comparison finds exactly the rows this key rewrote (the primitives return the same
    // object for an untouched row), so an object changed by two keys is still counted once.
    res.parcels.forEach((p, i) => { if (p !== before[i]) touched.add(p.id); });
    nextParcels = res.parcels;
  });
  let nextEls = els || [];
  (types || []).forEach((type) => {
    TYPE_STD_KEYS.forEach((key) => {
      const before = nextEls;
      const res = applyTypeStandard(before, type, key);
      if (!res.count) return;
      res.els.forEach((e, i) => { if (e !== before[i]) touched.add(e.id); });
      nextEls = res.els;
    });
  });
  const count = touched.size;
  return count ? { parcels: nextParcels, els: nextEls, count } : { parcels: parcels || [], els: els || [], count: 0 };
}

/** How many OBJECTS the single Apply would change — drives its count + disabled state. */
export function allStandardsImpact(parcels, els, parcelValues, types) {
  return applyAllStandards(parcels, els, parcelValues, types).count;
}

/** Toast copy for the whole-panel Apply — objects, because it spans parcels AND elements. */
export function appliedObjectsLabel(count) {
  return `Applied to ${count} object${count === 1 ? "" : "s"}`;
}

/**
 * Where the ONE panel-level scope control starts, DERIVED from the per-key scopes already stored.
 *
 * Migration rule (the hazard): collapsing per-key scopes into one control must not move anything.
 * So nothing is written on the way in — the control simply REPORTS where the account already
 * carries a default ("all" if any standard is account-level), and from then on governs where
 * SUBSEQUENT changes are stored. An explicit choice is remembered and wins over this.
 */
export function derivedPanelScope(scopes) {
  return (scopes || []).some((s) => s === "all") ? "all" : "project";
}
