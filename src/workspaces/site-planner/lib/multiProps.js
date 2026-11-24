/* NEW-1 (B-multi-props) — bulk-edit PROPERTIES across a same-type multi-selection (Site Planner).
 *
 * Pure helpers (no React, no DOM) so the rules are unit-testable:
 *   - `selectionKinds`   — what a multi-selection holds (one element type? mixed? markups?),
 *   - `readShared`       — a field's uniform value across the members, or "mixed",
 *   - `fieldsFor`        — the editable fields a selection of that type shows (a registry of
 *                          { id, label, read, write }: `write` calls the SAME by-element writers the
 *                          single-element Properties panel uses, via the `ops` object the planner passes),
 *   - `applyBulk`        — run one field write over every unlocked, applicable member.
 *
 * "Derived geometry follows" because nothing here re-implements an edit: a typed Length on three buildings
 * is three calls of the planner's own resize (`resizeElToValue`), which re-fits bonded courts, trailer rows,
 * landscape buffers and relabels, exactly as a single edit does. ONE undo frame is the planner's job
 * (`runBulk` in SitePlanner collapses the pushHistory calls of one bulk edit into one).
 */
import { footprintAxes, footprintDepth, footprintLength } from "./dockZones.js";

const sig = (v) => (v == null ? null : typeof v === "number" ? Math.round(v * 1000) / 1000 : v);

/** { type, members } when every selected ref is an element of ONE type; { type:null, members } for several types. */
export function selectionKinds(multi, els) {
  const members = [];
  let onlyEls = true;
  for (const r of multi || []) {
    if (r.kind !== "el") { onlyEls = false; continue; }
    const el = (els || []).find((x) => x.id === r.id);
    // A bump-out follows its host building; it is not a member of its own.
    if (el && !el.dogEar) members.push(el);
  }
  const types = new Set(members.map((m) => m.type));
  return { members, type: types.size === 1 ? [...types][0] : null, onlyEls, mixedTypes: types.size > 1 };
}

/** { mixed, value, n } over the members the field applies to; value is undefined when mixed or empty. */
export function readShared(members, field, ctx) {
  const ms = members.filter((m) => field.applies(m));
  if (!ms.length) return { mixed: false, value: undefined, n: 0 };
  const first = sig(field.read(ms[0], ctx));
  for (let i = 1; i < ms.length; i++) if (sig(field.read(ms[i], ctx)) !== first) return { mixed: true, value: undefined, n: ms.length };
  return { mixed: false, value: field.read(ms[0], ctx), n: ms.length };
}

const rect = (el) => !el.points;
const num = (id, label, unit, spec) => ({ id, label, unit, kind: "num", applies: rect, ...spec });

// `assemblyWide`: the planner's rotate turns the member's WHOLE bonded assembly (building + every field/row bonded to
// it), so a bulk write turns each assembly ONCE (applyBulk) — two parking fields on one building must not turn it twice.
const ROTATION = num("rotation", "Rotation", "°", {
  min: 0, max: 360, step: 1, coarse: 15, assemblyWide: true,
  read: (el) => Math.round(((el.rot || 0) % 360 + 360) % 360),
  write: (ops, el, v) => ops.rotateTo(el, ((v % 360) + 360) % 360),
});
const WIDTH = num("width", "Width", "ft", { min: 1, max: 5000, step: 1, coarse: 10, read: (el) => Math.round(el.w), write: (ops, el, v) => ops.resizeTo(el, "w", v) });
const DEPTH = num("depth", "Depth", "ft", { min: 1, max: 5000, step: 1, coarse: 10, read: (el) => Math.round(el.h), write: (ops, el, v) => ops.resizeTo(el, "h", v) });

const BUILDING = [
  num("length", "Length", "ft", { min: 1, max: 5000, step: 1, coarse: 10, read: (el) => Math.round(footprintLength(el)), write: (ops, el, v) => ops.resizeTo(el, footprintAxes(el).length, v) }),
  num("bdepth", "Depth", "ft", { min: 1, max: 5000, step: 1, coarse: 10, read: (el) => Math.round(footprintDepth(el)), write: (ops, el, v) => ops.resizeTo(el, footprintAxes(el).depth, v) }),
  ROTATION,
  // An override left blank reads as "auto" (by size, from Standards): a placeholder, never a number we made up.
  num("clearHeight", "Clear height", "ft", { min: 1, max: 200, step: 1, coarse: 5, applies: () => true, auto: true, read: (el) => el.clearHeightOverride ?? undefined, write: (ops, el, v) => ops.patch(el, { clearHeightOverride: v }) }),
  num("slab", "Slab", "in", { min: 1, max: 60, step: 1, coarse: 2, applies: () => true, auto: true, read: (el) => el.slabThicknessOverride ?? undefined, write: (ops, el, v) => ops.patch(el, { slabThicknessOverride: v }) }),
  num("padElev", "Pad elevation", "ft", { min: -1000, max: 20000, step: 0.5, coarse: 1, applies: () => true, auto: true, read: (el) => el.padElevFt ?? undefined, write: (ops, el, v) => ops.patch(el, { padElevFt: v }) }),
];

const ROAD = [
  num("roadWidth", "Road width", "ft", { min: 1, max: 5000, step: 1, coarse: 10, applies: () => true, read: (el, ctx) => Math.round(ctx.roadTravel(el)), write: (ops, el, v) => ops.setRoadTravel(el, v) }),
];

const PARKING = [
  WIDTH,
  num("stallDepth", "Stall depth", "ft", { min: 8, max: 60, step: 1, coarse: 2, read: (el, ctx) => ctx.cfgOf(el).stallDepth, write: (ops, el, v) => ops.setParkCfg(el, { stallDepth: v }) }),
  num("aisle", "Drive aisle", "ft", { min: 8, max: 80, step: 1, coarse: 2, read: (el, ctx) => ctx.cfgOf(el).aisle, write: (ops, el, v) => ops.setParkCfg(el, { aisle: v }) }),
  ROTATION,
];

const TRAILER = [
  num("trailerL", "Stall depth", "ft", { min: 8, max: 200, step: 1, coarse: 5, applies: () => true, read: (el, ctx) => ctx.cfgOf(el).trailerL, write: (ops, el, v) => ops.setTrailerSpec(el.id, "trailerL", v) }),
  num("trailerW", "Stall width", "ft", { min: 4, max: 40, step: 0.5, coarse: 1, applies: () => true, read: (el, ctx) => ctx.cfgOf(el).trailerW, write: (ops, el, v) => ops.setTrailerSpec(el.id, "trailerW", v) }),
  num("trailerAisle", "Drive lane", "ft", { min: 12, max: 200, step: 1, coarse: 5, applies: (el) => !(el.cfg && el.cfg.single), read: (el, ctx) => ctx.cfgOf(el).trailerAisle, write: (ops, el, v) => ops.setTrailerSpec(el.id, "trailerAisle", v) }),
  { id: "labelShown", label: "Label", kind: "toggle", applies: () => true, onText: "Shown on the plan", offText: "Hidden", read: (el) => !el.labelHidden,
    write: (ops, el, v) => { if (!el.labelHidden !== !!v) ops.toggleLabel(el.id); } },
  ROTATION,
];

// Paving / sidewalk / landscape and anything else that is a plain rotated strip.
const STRIP = [WIDTH, DEPTH, ROTATION];

/** The editable fields for a single-type selection (or the mixed-type fallback). Ponds and ramps have bespoke panels: none yet. */
export function fieldsFor(type) {
  if (type == null) return [ROTATION];
  if (type === "building") return BUILDING;
  if (type === "road") return ROAD;
  if (type === "parking") return PARKING;
  if (type === "trailer") return TRAILER;
  if (type === "pond" || type === "driveInRamp") return [];
  return STRIP;
}

/** Run a field write over every applicable, UNLOCKED member. Returns { done, skippedLocked }. */
export function applyBulk(members, field, value, ops) {
  let done = 0, skippedLocked = 0;
  const turnedRoots = new Set(); // assembly roots an `assemblyWide` field already moved in this batch
  for (const el of members) {
    if (!field.applies(el)) continue;
    if (el.locked) { skippedLocked++; continue; }
    if (field.assemblyWide) {
      const root = el.attachedTo || el.id;
      if (turnedRoots.has(root)) continue; // already turned with an earlier member of the same assembly
      turnedRoots.add(root);
    }
    field.write(ops, el, value);
    done++;
  }
  return { done, skippedLocked };
}

/** Total stalls across a multi-selection: { car, trailer } each { count, n, est } or null when none of that kind is selected.
 *  `ctx.carCount(el)` / `ctx.trailerCount(el)` return { count, est } for ONE member through the SAME counters the single-element
 *  panel and the on-plan label read, so the total can never disagree with the sum of what each row shows. Pure, recomputed per render. */
export function stallTotals(members, ctx) {
  const tally = (type, counter) => {
    const ms = (members || []).filter((m) => m.type === type && !m.dogEar);
    if (!ms.length) return null;
    let count = 0, est = false;
    for (const m of ms) { const r = counter(m); count += r.count || 0; if (r.est) est = true; }
    return { count, n: ms.length, est };
  };
  return { car: tally("parking", ctx.carCount), trailer: tally("trailer", ctx.trailerCount) };
}
