/* ⛔ NEW-2 (B648353) — NAMING AN UNDO STEP, WITHOUT TRUSTING ANY OF THE ~190 `pushHistory()` CALL
 * SITES TO SAY WHAT THEY DID.
 *
 * The Excel-style undo dropdown the owner asked for is only useful if its rows are readable
 * ("Deleted callout", "Moved building") rather than 190 identical "Edit"s — `pushHistory(kind =
 * "edit")` defaults to "edit" and only ONE call site (`deleteSel`) passes anything else today
 * (`operationEnvelope.js`'s OP_KINDS vocabulary is real and rich, but wiring it into all ~190 sites
 * by hand, in this one session, across a codebase this heavily-guarded around undo correctness —
 * B32, B315, B1098, B1113, B377888, B505664 — is not a safe bet to make blind).
 *
 * So this module names an operation a different way: it DIFFS the two whole-canvas snapshots
 * `history.js` already stores either side of the step (before/after — the same shape as
 * `stateRef.current`: parcels/els/measures/callouts/markups/underlay/sheetOverlays/origin/
 * layerOverrides/layerAbove) and describes what actually changed. This can never drift out of sync
 * with reality the way a hand-typed label at a call site can (the label is derived from the real
 * before/after content, not asserted by whichever code path happened to run), and it costs zero
 * changes to the 190 call sites or to the push()/undo()/redo() contract.
 *
 * Pure, no DOM. Unit-tested in test/historyLabel.test.js.
 */

const ELEMENT_TYPE_LABEL = {
  building: "building", paving: "paving", parking: "car parking", trailer: "trailer parking",
  pond: "detention pond", road: "road", easement: "easement",
};
const elNoun = (el) => ELEMENT_TYPE_LABEL[el?.type] || "element";

const MARKUP_KIND_LABEL = {
  line: "line", rect: "rectangle", ellipse: "ellipse", polygon: "polygon",
  polyline: "polyline", cloud: "revision cloud",
};
const markupNoun = (m) => MARKUP_KIND_LABEL[m?.kind] || "markup";

const MEASURE_MODE_LABEL = {
  line: "length measurement", polyline: "polyline measurement", area: "area measurement", count: "count measurement",
};
const measureNoun = (m) => MEASURE_MODE_LABEL[m?.mode] || "measurement";

// The same distinction `arrange.js`'s menu wiring uses for this same family (see SitePlanner.jsx's
// `featuresBeneath`/menu rows): a callout with `noLeader:true` is what the Text tool drew.
const calloutNoun = (c) => (c?.noLeader ? "text box" : "callout");

const COLLECTIONS = [
  { key: "parcels", noun: "parcel", nounOf: () => "parcel" },
  { key: "els", noun: "element", nounOf: elNoun },
  { key: "measures", noun: "measurement", nounOf: measureNoun },
  { key: "callouts", noun: "callout", nounOf: calloutNoun },
  { key: "markups", noun: "markup", nounOf: markupNoun },
  { key: "sheetOverlays", noun: "reference image", nounOf: () => "reference image" },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function diffCollection(before, after) {
  const b = before || [], a = after || [];
  const beforeById = new Map(b.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const afterById = new Map(a.filter((x) => x && x.id != null).map((x) => [x.id, x]));
  const added = [], removed = [], changed = [];
  for (const [id, item] of afterById) {
    if (!beforeById.has(id)) added.push(item);
    else if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(item)) changed.push({ before: beforeById.get(id), after: item });
  }
  for (const [id, item] of beforeById) if (!afterById.has(id)) removed.push(item);
  return { added, removed, changed };
}

// Distinguish Moved / Resized / Rotated / Reshaped for a single changed `el` — falls back to the
// generic "Edited" when more than one of those axes moved at once, or the change is something else
// entirely (a style/attribute-only edit).
function describeElChange(before, after) {
  const noun = elNoun(after);
  const moved = before.cx !== after.cx || before.cy !== after.cy;
  const resized = before.w !== after.w || before.h !== after.h;
  const rotated = before.rot !== after.rot;
  const reshaped = JSON.stringify(before.points) !== JSON.stringify(after.points)
    || JSON.stringify(before.pts) !== JSON.stringify(after.pts);
  const axes = [moved, resized, rotated, reshaped].filter(Boolean).length;
  if (axes === 1) {
    if (moved) return `Moved ${noun}`;
    if (resized) return `Resized ${noun}`;
    if (rotated) return `Rotated ${noun}`;
    if (reshaped) return `Reshaped ${noun}`;
  }
  return `Edited ${noun}`;
}

/* Describe ONE undo step from its `{ before, after }` snapshot pair (as returned by
 * `history.js`'s `recentUndoSteps`/`recentRedoSteps`). Never throws on a legacy/partial snapshot —
 * a field this doesn't recognize just falls out of every diff and the description degrades to the
 * generic "Edited plan" rather than crashing the dropdown. */
export function describeHistoryStep(before, after) {
  if (!before || !after) return "Edited plan";

  const diffs = {};
  let totalAdded = 0, totalRemoved = 0, totalChanged = 0;
  for (const c of COLLECTIONS) {
    const d = diffCollection(before[c.key], after[c.key]);
    diffs[c.key] = d;
    totalAdded += d.added.length; totalRemoved += d.removed.length; totalChanged += d.changed.length;
  }
  const touched = COLLECTIONS.filter((c) => {
    const d = diffs[c.key];
    return d.added.length || d.removed.length || d.changed.length;
  });

  if (!touched.length) {
    if (JSON.stringify(before.origin) !== JSON.stringify(after.origin)) return "Set location";
    if (JSON.stringify(before.layerOverrides) !== JSON.stringify(after.layerOverrides)) return "Changed layer visibility";
    if (JSON.stringify(before.layerAbove) !== JSON.stringify(after.layerAbove)) return "Changed layer order";
    if (JSON.stringify(before.underlay) !== JSON.stringify(after.underlay)) return "Adjusted reference image";
    return "Edited plan";
  }

  // The common case: exactly one collection touched.
  if (touched.length === 1) {
    const c = touched[0];
    const d = diffs[c.key];
    const onlyAdded = d.added.length && !d.removed.length && !d.changed.length;
    const onlyRemoved = d.removed.length && !d.added.length && !d.changed.length;
    const onlyChanged = d.changed.length && !d.added.length && !d.removed.length;
    if (onlyAdded) return d.added.length === 1 ? `Added ${c.nounOf(d.added[0])}` : `Added ${plural(d.added.length, c.noun)}`;
    if (onlyRemoved) return d.removed.length === 1 ? `Deleted ${c.nounOf(d.removed[0])}` : `Deleted ${plural(d.removed.length, c.noun)}`;
    if (onlyChanged) {
      if (d.changed.length === 1) {
        const { before: b, after: a } = d.changed[0];
        return c.key === "els" ? describeElChange(b, a) : `Edited ${c.nounOf(a)}`;
      }
      return `Edited ${plural(d.changed.length, c.noun)}`;
    }
    // Mixed add/remove/change within one collection (e.g. a parcel merge/split).
    return `Edited ${plural(d.added.length + d.removed.length + d.changed.length, c.noun)}`;
  }

  // Several collections touched at once — a paste, a bonded-assembly move, a cross-family delete.
  if (totalAdded && !totalRemoved && !totalChanged) return `Added ${plural(totalAdded, "object")}`;
  if (totalRemoved && !totalAdded && !totalChanged) return `Deleted ${plural(totalRemoved, "object")}`;
  return "Edited plan";
}

/* Label a whole ordered list of steps (as returned by `recentUndoSteps`/`recentRedoSteps`) —
 * newest first, matching the order the dropdown renders. */
export function describeHistorySteps(steps) {
  return (steps || []).map((s) => describeHistoryStep(s.before, s.after));
}

/* The dropdown footer text for hovering N rows deep — "Undo 1 Action" / "Undo 3 Actions". */
export function historyRunLabel(verb, n) {
  return `${cap(verb)} ${plural(n, "Action")}`;
}
