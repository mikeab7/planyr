/* NEW-1 — WHAT THE DRAWING IS SHOWING RIGHT NOW. The View menu's content model.
 *
 * ─── THE OWNER'S WORDS, because they contain the whole design ────────────────────────────────
 * "for the view, it's kind of pointless, most of those items - like show dock doors or not show
 *  dock doors. If I have dock doors there, I always want them to show. … What it really should be
 *  is being able to hide a whole set of stuff. Like buildings and pond and roads … but maybe that
 *  should just get grouped into elements. And when I say remove, I don't mean remove, I just mean
 *  hide temporarily. And then another one for markups - I should be able to hide all markups."
 *
 * Two separate asks. The first is a LEVEL complaint: the old menu toggled ORNAMENT (dock doors,
 * column grid, dimension callouts, area lines) when what he reaches for is "get this class of
 * thing out of my way so I can see what is underneath". The second is the promise that makes it
 * safe — HIDE, NEVER DELETE.
 *
 * ─── ⛔ THE INVARIANT, and why it is structural rather than a promise ────────────────────────
 * A hidden building is still a building for every number the app reports. That is not enforced by
 * care here; it is true BY CONSTRUCTION, and the construction is worth stating so nobody
 * "optimises" it away:
 *
 *   The metrics pass (`SitePlanner.jsx`, the `els.forEach` that builds bldg / paving / parkArea /
 *   trailArea / pondArea / stalls / trailers / providedDetCf, and `dissolvedParcelSqft(parcels…)`)
 *   iterates the MODEL — `els`, `parcels` — and never the draw sets. This module's filter is
 *   applied ONLY where `cullToView` is already applied: `drawEls`, `drawParcels`, `drawMarkupsZ`,
 *   `measureBands`, `calloutBands`. Viewport culling has always meant "drawn ≠ exists" in this
 *   codebase, and it has never moved a number. Hiding is the same operation with a different
 *   predicate, at the same seam.
 *
 * So: this module returns a PREDICATE. It never returns a mutated model, it holds no geometry, it
 * cannot tombstone (TOMBSTONE-DELETES has nothing to do here — nothing is removed), and the state
 * it reads lives in `settings`, which is plan-level and never touches `site_elements`. If a future
 * calculation is ever written against a draw set instead of the model, THAT is the bug — not this.
 *
 * ─── THE STORAGE SHAPE: sparse, and only ever names what is HIDDEN ───────────────────────────
 * `settings.hidden` is `{ [key]: true }` — a key is present only while that group is hidden.
 * Absent ⇒ visible. Three consequences, all deliberate: a plan saved before this feature existed
 * gains no keys and renders byte-identically; "show everything" is a DELETE of keys rather than a
 * write of eight `false`s; and a key this version does not recognise is ignored rather than
 * guessed at, so a plan touched by a newer build degrades to "visible" — the safe direction. A
 * hidden group can never be the reason something is missing without a key SAYING so.
 *
 * ─── THE GROUPING, argued rather than picked ─────────────────────────────────────────────────
 * The owner floated both shapes ("buildings and pond and roads … but maybe that should just get
 * grouped into elements"), so this decides deliberately: BOTH, in the shape the app already uses
 * next door. The GIS Layers panel has "Show all flood & drainage" — one master checkbox, tri-state,
 * over rows that are also individually toggleable (`LayerPanel.jsx`'s `floodMasterRow`, fed by a
 * `{ all, any, onCount, ids }` object). `groupState()` below returns THAT EXACT SHAPE for the same
 * reason: the owner asked for the plan-content version of a thing he already has, and two
 * mechanisms that look different would read as two ideas. One master "Elements" row for the sweep
 * he named, per-type rows under it for the times one type is the problem.
 *
 * Per-type rows are emitted ONLY for types the plan actually contains (`groupsFor`), which is also
 * how the Layers panel behaves — a row for a type you have never drawn is a row that can only
 * confuse, and it makes the counts on each row mean something.
 *
 * Parcels, markups, measurements and callouts are each ONE row and get no sub-rows: their internal
 * variety (a rect markup vs a cloud, an area measure vs a length) is not a thing the owner reasons
 * about when he wants them out of the way. Parcels stay a row of their own rather than joining
 * "elements" because a parcel is the site boundary, not something drawn on the site.
 *
 * ─── WHAT IS *NOT* IN THIS MODEL, and why ────────────────────────────────────────────────────
 * The label/detail toggles (`showGrid`, `showDims`, `showAreas`) keep their own existing settings
 * keys and their own existing consumers. They are a different KIND of switch — they thin ornament
 * on content that is still there — and rewriting three shipped keys into this map would be churn
 * with a migration attached and no behaviour gained. The View menu presents them in their own
 * sections; that is a layout decision, not a model one.
 *
 * The ONE label tier that DOES live here is `labels:parcelAcreage`, because it is a plan-wide
 * master over a per-object choice that already shipped (`parcel.chipHidden`, B1404) and the two
 * have to compose. See `parcelAcreageHidden`.
 */

/* The element types, in the order the View menu lists them. Deliberately NOT derived from
 * `planStyle.TYPE`'s key order: that object's order is a paint concern and could be reordered by
 * someone reasoning about z-bands, which would silently reshuffle this menu. The order here is
 * "what the owner names first" — he said buildings, ponds, roads. */
export const EL_GROUPS = [
  { type: "building", label: "Buildings" },
  { type: "parking", label: "Car parking" },
  { type: "trailer", label: "Trailer parking" },
  { type: "pond", label: "Ponds" },
  { type: "road", label: "Roads" },
  { type: "paving", label: "Paving / drive" },
  { type: "sidewalk", label: "Sidewalks" },
  { type: "landscape", label: "Landscape" },
];

export const EL_KEY_PREFIX = "el:";
export const elKey = (type) => `${EL_KEY_PREFIX}${type}`;
export const EL_KEYS = EL_GROUPS.map((g) => elKey(g.type));

/* The non-element families, each one row. `collection` names the planner state array a row counts,
 * so the menu never hard-codes a second copy of that mapping. */
export const OTHER_GROUPS = [
  { key: "parcels", label: "Parcels", collection: "parcels" },
  { key: "markups", label: "Markups", collection: "markups" },
  { key: "measures", label: "Measurements", collection: "measures" },
  { key: "callouts", label: "Text & callouts", collection: "callouts" },
];

/* Every key this version understands. An unknown key in a stored map is IGNORED (never deleted —
 * a newer build may own it, and silently dropping another version's state is how a round-trip
 * through an older client loses a setting). */
export const KNOWN_KEYS = [...EL_KEYS, ...OTHER_GROUPS.map((g) => g.key), "labels:parcelAcreage"];

/* ---------------------------------------------------------------- reading */

/** Is `key` hidden? The only reader of the raw map's shape. */
export function isHidden(hidden, key) {
  return !!(hidden && hidden[key] === true);
}

/** Is this element hidden — by its own type's row? */
export function elHidden(hidden, el) {
  return !!el && isHidden(hidden, elKey(el.type));
}

/**
 * The acreage chip's TWO independent authorities, composed in one place.
 *
 * `parcel.chipHidden` (B1404) is the per-lot choice made from the parcel's right-click menu and it
 * is MODEL state — it persists on the parcel and is what the owner already had. `labels:parcelAcreage`
 * is a plan-wide VIEW master added here so the same intent is reachable from the View menu (the
 * owner asked to "delete the chips that show the acreage for parcels" without knowing the per-lot
 * control existed — a discoverability failure, not a missing feature).
 *
 * ⛔ The master must not WRITE `chipHidden` on every parcel to do its job: that would be a model
 * mutation dressed as a view toggle, it would sync, and turning the master back off could not know
 * which lots the user had hidden by hand. So they compose with OR, exactly the way a layer's
 * per-plan override composes with its registry default, and each remembers its own answer.
 */
export function parcelAcreageHidden(hidden, parcel) {
  return isHidden(hidden, "labels:parcelAcreage") || !!(parcel && parcel.chipHidden);
}

/* ---------------------------------------------------------------- group state */

/**
 * The tri-state master over a set of keys — `{ all, any, onCount, ids }`.
 *
 * ⚠ SHAPE BORROWED ON PURPOSE from `LayerPanel.jsx`'s `floodMaster`, so the plan-content master
 * and the GIS-layer master are visibly one idea. `all`/`any` are stated in terms of SHOWN, not
 * hidden, because that is what a checkbox means when it is ticked, and the flood row reads the
 * same way. Keep them in step if either moves.
 */
export function groupState(hidden, keys) {
  const ids = keys.slice();
  const onCount = ids.filter((k) => !isHidden(hidden, k)).length;
  return { ids, onCount, all: ids.length > 0 && onCount === ids.length, any: onCount > 0 };
}

/* ---------------------------------------------------------------- writing (pure) */

/**
 * Set one key's visibility, returning a NEW sparse map — or the INPUT unchanged when nothing
 * moved. Identity stability is not decoration here: `settings` flows into memo keys all over the
 * render body, and a fresh object holding identical values invalidates every one of them
 * (VIEW-INDEPENDENT-ONCE's §5 trap, and B385040's exact mechanism — `applyOnOverrides` allocating
 * a fresh outer map on every call rebuilt the whole Leaflet overlay stack on every Ctrl+Z).
 */
export function setVisible(hidden, key, visible) {
  const cur = isHidden(hidden, key);
  if (cur === !visible) return hidden || {};
  const next = { ...(hidden || {}) };
  if (visible) delete next[key];
  else next[key] = true;
  return next;
}

/** Set many keys at once (the master row). Same identity rule. */
export function setManyVisible(hidden, keys, visible) {
  let out = hidden || {};
  for (const k of keys) out = setVisible(out, k, visible);
  return out;
}

/** Show everything — returns `{}`, or the input if it was already empty of KNOWN keys. */
export function showAll(hidden) {
  if (!anyHidden(hidden)) return hidden || {};
  const next = { ...(hidden || {}) };
  for (const k of KNOWN_KEYS) delete next[k];
  return next;
}

/** Is anything this version understands currently hidden? */
export function anyHidden(hidden) {
  if (!hidden) return false;
  return KNOWN_KEYS.some((k) => hidden[k] === true);
}

/** Every hidden KNOWN key, in menu order. Unknown keys are not reported — see KNOWN_KEYS. */
export function hiddenKeys(hidden) {
  return KNOWN_KEYS.filter((k) => isHidden(hidden, k));
}

/* ---------------------------------------------------------------- menu model */

const labelForKey = (key) => {
  if (key.startsWith(EL_KEY_PREFIX)) {
    const g = EL_GROUPS.find((x) => elKey(x.type) === key);
    return g ? g.label : key.slice(EL_KEY_PREFIX.length);
  }
  if (key === "labels:parcelAcreage") return "Parcel acreage";
  const o = OTHER_GROUPS.find((x) => x.key === key);
  return o ? o.label : key;
};

/**
 * The rows to render, given what the plan actually contains.
 *
 * `counts` is `{ els: [...], parcels: n, markups: n, measures: n, callouts: n }` — `els` is the
 * element array so per-type counts can be taken here rather than at the render site.
 *
 * A per-type element row appears only when the plan HAS that type. The element master appears when
 * the plan has any element at all. A family row appears when its collection is non-empty. An empty
 * plan therefore shows no content rows, which is correct: there is nothing to hide.
 *
 * ⛔ Counts are of what EXISTS, never of what is drawn — a hidden group must still report how much
 * it is hiding, or the menu becomes a mirror of the canvas and stops being able to say "3 hidden".
 */
export function groupsFor({ els = [], parcels = 0, markups = 0, measures = 0, callouts = 0 } = {}) {
  const byType = new Map();
  for (const el of els) {
    if (!el || el.dogEar) continue;   // a bump-out is part of its building, not a thing of its own
    byType.set(el.type, (byType.get(el.type) || 0) + 1);
  }
  const elRows = EL_GROUPS
    .filter((g) => byType.get(g.type))
    .map((g) => ({ key: elKey(g.type), label: g.label, count: byType.get(g.type) }));
  const counts = { parcels, markups, measures, callouts };
  const otherRows = OTHER_GROUPS
    .filter((g) => counts[g.collection] > 0)
    .map((g) => ({ key: g.key, label: g.label, count: counts[g.collection] }));
  return { elRows, otherRows, elTotal: elRows.reduce((n, r) => n + r.count, 0) };
}

/**
 * The one-line "you are looking at a filtered view" summary, or null when nothing is hidden.
 *
 * The owner's requirement, verbatim: "if something is hidden, the owner must be able to tell at a
 * glance that he is looking at a filtered view rather than an empty site. A plan that silently
 * hides half its content is worse than one that never hid anything." So this NAMES what is hidden
 * rather than counting it — "Buildings, Markups hidden" tells you what to go turn back on, while
 * "2 hidden" makes you open the menu to find out. Past three, it degrades to a count so the chip
 * cannot grow without bound.
 */
export function hiddenSummary(hidden) {
  const keys = hiddenKeys(hidden);
  if (!keys.length) return null;
  const labels = keys.map(labelForKey);
  const text = labels.length <= 3 ? labels.join(", ") : `${labels.length} groups`;
  return { count: keys.length, keys, labels, text };
}

/* ---------------------------------------------------------------- migration */

/**
 * ⛔ "Show dock doors" IS GONE FROM THE MENU, AND THIS IS THE HALF THAT MAKES THAT SAFE.
 *
 * The owner: "like show dock doors or not show dock doors. If I have dock doors there, I always
 * want them to show." Removing the control is the right call, but removing a control that has been
 * shipping since B653 STRANDS any plan saved with `showDocks: false` — the doors would be off
 * forever with nothing left in the UI to turn them back on. That is a data-stranding bug wearing a
 * simplification's clothes, and it is exactly the failure mode a "just delete the checkbox" change
 * ships by accident.
 *
 * So a stored `false` is normalised to `true` on load, ONCE, and the caller reports it. This is a
 * one-way door and it is the owner's stated preference; the column grid — the toggle he did NOT
 * complain about, and which his own block calls "genuinely a drafting aid" — is untouched.
 *
 * Returns `null` when there is nothing to do, so the caller can skip the write entirely (an
 * unconditional patch would dirty every plan on open).
 */
export function normalizeRetiredToggles(settings) {
  if (!settings || settings.showDocks !== false) return null;
  return { showDocks: true };
}

/* ---------------------------------------------------------------- the visible subset
 *
 * ⛔ B494048–B494050 — THE SEAMS B3296 DID NOT REACH, and one helper so they cannot drift apart.
 *
 * B3296 filtered the dissolved road pavement and raised the obvious question: who else reads the
 * whole model where the drawing wants the visible subset? The audit
 * (`ui-audit/audit-hidden-content-reads.mjs`, and the declaration table in `hiddenContentReads.js`)
 * answered it, and the answer was five more — an extent, a print crop and three magnets.
 *
 * ⚠ THESE ARE FOR PICTURES AND MAGNETS ONLY. Every count, save, undo frame, ledger and regulatory
 * inference still reads the raw collections, deliberately, and the declaration table records which
 * is which. Reaching for `visibleEls` inside a metrics pass would silently drop hidden objects out
 * of the owner's yield numbers — a worse bug than the one this closes.
 */
export const visibleEls = (hidden, els) => (hidden ? (els || []).filter((e) => !elHidden(hidden, e)) : (els || []));
export const visibleParcels = (hidden, parcels) => (isHidden(hidden, "parcels") ? [] : (parcels || []));
export const visibleMeasures = (hidden, measures) => (isHidden(hidden, "measures") ? [] : (measures || []));
