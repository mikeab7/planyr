/* ONE combine and ONE split for parcels — the panel and the map toolbar both call these.
 *
 * OWNER REQUIREMENT (verbatim): "if I do the split without ever coming into the left-hand menu,
 * just from the right-hand menu, it'll still work, same thing with merge." So there is exactly one
 * planner for each operation and SitePlanner.jsx has exactly one applier for each; the Parcels
 * panel, the map's Merge banner / right-click menu / Enter key and the Split tool all route
 * through them. Nothing outside this file constructs a combined tract or a split piece.
 * `test/parcelOps.test.js` pins the behaviour; `test/parcelOpsParity.test.js` pins that no second
 * implementation can grow back in SitePlanner.jsx.
 *
 * Pure (no React, no DOM). The union geometry (`mergeParcelRings`) is INJECTED rather than imported: it
 * lives in SitePlanner.jsx and belongs to the boundary-detection work, which this file must not
 * fork or restate — one touching test, theirs.
 *
 * DATA SHAPE (all of it rides the parcel record, so it syncs and persists with no schema change):
 *   combined: { from: [<full snapshot of each original>] }           on a combined tract
 *   splitFrom: { group, count, from: <snapshot of the original> }    on every split piece
 * The originals are NOT kept in `parcels` as hidden rows — a hidden row is a row every other
 * reader (Yield, Analysis, Drainage, print, dashboard) would have to remember to skip. They live
 * inside the tract / pieces that replaced them, so nothing can read them as live land. County data
 * is never altered: a snapshot is a copy.
 *
 * INCLUDE (the eye) is the parcel's existing `active` flag, unchanged. The panel checkbox used to
 * write it; it now only selects rows. So no saved plan needs migrating: a parcel with no flag is
 * included, `active:false` is excluded, exactly as before — `test/parcelOps.test.js` proves the
 * included set and site total are identical.
 *
 * LOCKED parcels MAY be combined and split. Every parcel is born locked (county, drawn, deed), so
 * refusing them would make both operations unusable out of the box, and the map's existing
 * merge/split have never refused them. Lock keeps its one meaning: the boundary cannot be dragged
 * or reshaped on the map. The result inherits the sources' lock (a tract is locked only if every
 * source was), and Restore puts each original's lock back exactly. `LOCKED_PARCELS_MAY_COMBINE`
 * is the single switch if that ever changes.
 */
import { splitPolygonByCut, remapEdgeVector, polyArea } from "./polygonSplit.js";
import { parcelNetSqft, SQFT_PER_ACRE, parseAcres } from "./parcelArea.js";
import { dissolvedParcelSqft } from "./polyClip.js";
import { parcelDisplayInfo, parcelSplitNames, parcelOutline } from "./siteModel.js";
import { ownerName } from "./appraisal.js";
import { parcelOrigin, accountOf } from "./parcelOrigin.js";

export const LOCKED_PARCELS_MAY_COMBINE = true;

const clone = (o) => JSON.parse(JSON.stringify(o));
// A snapshot carries the DISPLAY name it had (`snapName`) for the Made-from / Split-from lists; it is not a parcel field.
/* A snapshot keeps the parcel's OWN history one level deep and nothing deeper — otherwise each split/combine
 * cycle nests a full copy of every earlier generation and a parcel's stored size doubles per cycle
 * (measured by the adversarial review: 1.1 KB → 257 KB over 8 cycles). Restoring a restore is bounded by this. */
const stripHistory = (o) => { const c = { ...o }; delete c.combined; delete c.splitFrom; return c; };
const snapshot = (p, name) => {
  const c = clone(p);
  if (c.combined && c.combined.from) c.combined = { ...c.combined, from: c.combined.from.map(stripHistory) };
  if (c.splitFrom && c.splitFrom.from) c.splitFrom = { ...c.splitFrom, from: stripHistory(c.splitFrom.from) };
  c.snapName = name;
  return c;
};
// A cheap fingerprint of an outline, to tell whether a tract / piece was reshaped after it was made.
const sigOf = (pts) => (pts || []).map((q) => `${Math.round(q.x * 100)},${Math.round(q.y * 100)}`).join(";");
const unsnap = (s) => { const c = clone(s); delete c.snapName; return c; };
const letter = (i) => { let s = "", n = i | 0; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

/* The SITE acreage: the included parcels, dissolved so shared ground counts once — the same
 * function every yield figure is built from, so this number and Yield can never disagree. */
export function includedAcres(parcels) {
  const inc = (parcels || []).filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3);
  return dissolvedParcelSqft(inc) / SQFT_PER_ACRE;
}

/* Names already in play on this plan — current parcels plus everything held inside a tract's or a
 * piece's restore snapshots — so a new "Tract A" can never collide with one a Restore would bring back. */
function namesInUse(parcels) {
  const used = new Set();
  const info = parcelDisplayInfo(parcels);
  const walk = (p) => {
    if (!p) return;
    if (p.label) used.add(p.label);
    for (const s of (p.combined && p.combined.from) || []) walk(s);
    if (p.splitFrom && p.splitFrom.from) walk(p.splitFrom.from);
  };
  for (const p of parcels || []) { const i = info.get(p.id); if (i) used.add(i.name); walk(p); }
  return used;
}
/* "Tract A", "Tract B", … then "Tract AA" past Z — the next free one in the project. Never asks. */
export function nextTractName(parcels) {
  const used = namesInUse(parcels);
  for (let i = 0; i < 100000; i++) { const n = `Tract ${letter(i)}`; if (!used.has(n)) return n; }
  return `Tract ${Date.now()}`;
}

const refuse = (code, message) => ({ ok: false, code, message });

/* Dry-run AND plan in one: the panel calls this on every selection change to decide whether
 * Combine is enabled (and what to say if not); the appliers call it again to act. Same function,
 * so the button can never promise what the action then refuses. */
export function planCombine(parcels, ids, { unionRings, newId }) {
  const list = parcels || [];
  const want = new Set(ids || []);
  const chosen = list.filter((p) => want.has(p.id));
  const info = parcelDisplayInfo(list);
  const nm = (p) => (info.get(p.id) && info.get(p.id).name) || "A parcel";
  if (chosen.length < 2) return refuse("pick-two", "Pick at least two parcels to combine.");
  const bad = chosen.find((p) => !Array.isArray(p.points) || p.points.length < 3);
  if (bad) return refuse("no-geometry", `${nm(bad)} has no boundary to combine.`);
  if (!LOCKED_PARCELS_MAY_COMBINE) {
    const lk = chosen.find((p) => p.locked);
    if (lk) return refuse("locked", `${nm(lk)} is locked — unlock it first, then combine.`);
  }
  const off = chosen.filter((p) => p.active === false);
  if (off.length) return refuse("excluded", `${nm(off[0])} is excluded from the site total (eye off) — include it or deselect it, then combine.`);
  // The touching test + union is the injected `unionRings` (polyClip.js `mergeParcelRings`, B2090352) — never restated here.
  const merged = unionRings(chosen.map((p) => p.points));
  if (!merged.ok) {
    if (merged.code === "apart") {
      const odd = chosen.filter((_, i) => !merged.groups[0].includes(i));
      const names = odd.map(nm);
      return refuse("not-touching", merged.groups[0].length < 2
        ? "These parcels don't touch edge-to-edge — pick parcels that share a boundary."
        : `${names.join(", ")} ${odd.length === 1 ? "doesn't" : "don't"} touch the other picked parcels — unpick ${odd.length === 1 ? "it" : "them"} or pick the lots in between.`);
    }
    if (merged.code === "hole") return refuse("hole", "Combining those would enclose a lot that isn't picked — pick that one too, or combine them in pieces.");
    // B2090352 amendment — say what actually happened (the old text blamed the outlines even when the safety net fired).
    return refuse("bad-outline", merged.code === "invalid"
      ? "Those outlines couldn't be combined — check each picked parcel has a closed outline."
      : "Combining would have changed the combined area by more than survey slop allows, so nothing was combined — the parcels are untouched.");
  }
  const result = merged.ring;
  const name = nextTractName(list);
  const holes = chosen.flatMap((p) => (Array.isArray(p.exceptions) ? clone(p.exceptions) : []));
  const tract = {
    id: newId(), points: result, active: true, label: name,
    locked: chosen.every((p) => !!p.locked), ...(chosen.every((p) => !!p.locked) ? { lockSem: 2 } : {}),
    ...(holes.length ? { exceptions: holes } : {}),
    combined: { sig: sigOf(result), from: chosen.map((p) => snapshot(p, nm(p))) },
  };
  const firstIdx = list.findIndex((p) => want.has(p.id));
  const next = [];
  list.forEach((p, i) => { if (i === firstIdx) next.push(tract); if (!want.has(p.id)) next.push(p); });
  return { ok: true, tract, name, parcels: next, removeIds: chosen.map((p) => p.id), count: chosen.length };
}

/* Put a tract's originals back exactly — same outlines, names, include and lock state. They get
 * fresh ids: the combine tombstoned the old ones (so a merge from another device can't resurrect
 * them beside the tract), and tombstones are never lifted. */
export function planRestoreCombined(parcels, tractId, { newId }) {
  const list = parcels || [];
  const tract = list.find((p) => p.id === tractId);
  if (!tract || !tract.combined || !(tract.combined.from || []).length) return refuse("nothing-to-restore", "This parcel wasn't made by combining, so there is nothing to restore.");
  const restored = tract.combined.from.map((s) => ({ ...unsnap(s), id: newId() }));
  const idx = list.findIndex((p) => p.id === tractId);
  const next = [];
  list.forEach((p, i) => { if (i === idx) next.push(...restored); if (p.id !== tractId) next.push(p); });
  const edited = (tract.combined.sig != null && sigOf(tract.points) !== tract.combined.sig) || tract.active === false;
  return { ok: true, parcels: next, removeIds: [tractId], restored, name: tract.label || "the tract", edited };
}

/* Which piece of the cut a save-and-except hole belongs to: the one that fully contains it. */
function ringContains(ring, pt) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function distributeExceptions(holes, rings) {
  const out = rings.map(() => []);
  for (const h of holes) {
    const pts = h && Array.isArray(h.pts) ? h.pts : Array.isArray(h) ? h : null;
    if (!pts || pts.length < 3) continue;
    const k = rings.findIndex((r) => pts.every((p) => ringContains(r, p)));
    if (k < 0) return null;
    out[k].push(h);
  }
  return out;
}

/* Plan a split of ONE parcel by a drawn cut. `targetId` (panel entry) aims it at that parcel only;
 * without it (the map tool) the selected parcel is tried first, then every other — the long-standing
 * behaviour of the Split tool. Everything else is identical, which is the point. */
export function planSplit(parcels, path, { targetId = null, selId = null, newId, baseSetback = 0 }) {
  const list = parcels || [];
  const pts = (path || []).filter((p, i) => i === 0 || Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) > 0.01);
  if (pts.length < 2) return refuse("no-cut", "Draw a line across the parcel, then double-click to finish.");
  const ordered = targetId
    ? list.filter((p) => p.id === targetId)
    : selId ? [list.find((p) => p.id === selId), ...list.filter((p) => p.id !== selId)].filter(Boolean) : list;
  if (!ordered.length) return refuse("no-parcel", "That parcel is no longer on the plan.");
  let first = null;
  for (const pc of ordered) {
    if (!Array.isArray(pc.points) || pc.points.length < 3) continue;
    // Edge to edge, as designed: a line that stops inside the lot is REFUSED (extendEnds off), never silently carried on.
    const res = splitPolygonByCut(pc.points, pts, { extendEnds: false });
    if (!res.ok) { if (!first) first = res; continue; }
    const pieces = res.pieces;
    // CONSERVATION — the pieces must add up to the parcel (a self-overlapping outline is reported
    // by the engine as `outlineDrift` and is exempt: its stated area was never the enclosed land).
    const parentArea = Math.abs(polyArea(pc.points));
    const sum = pieces.reduce((s, p) => s + Math.abs(polyArea(p.ring)), 0);
    if (!res.outlineDrift && Math.abs(sum - parentArea) > Math.max(2, parentArea * 0.0005)) {
      return refuse("not-conserved", "That line didn't divide the parcel cleanly — the pieces didn't add up to the original, so nothing was changed. Try drawing it again.");
    }
    const holes = Array.isArray(pc.exceptions) ? pc.exceptions : [];
    const exc = holes.length ? distributeExceptions(holes, pieces.map((p) => p.ring)) : pieces.map(() => []);
    if (!exc) return refuse("cuts-exception", "That line runs through a save-and-except carve-out on this parcel, so the acreage couldn't be divided exactly. Draw it so the carve-out stays whole on one side.");
    const born = parcelSplitNames(list, pc.id, pieces.length);
    const group = newId();
    const info0 = parcelDisplayInfo(list);
    const snap = snapshot(pc, (info0.get(pc.id) || {}).name || "the parcel");
    const made = pieces.map(({ ring, edgeSrc }, i) => ({
      id: newId(), points: ring, active: pc.active !== false, locked: !!pc.locked, ...(pc.locked ? { lockSem: 2 } : {}), parentId: pc.id,
      addr: pc.addr || null, acct: pc.acct || null, attrs: pc.attrs || null,
      splitName: born[i] && born[i].name, splitDepth: born[i] && born[i].depth,
      setbacks: remapEdgeVector(pc.setbacks, edgeSrc, baseSetback),
      roleOverrides: remapEdgeVector(pc.roleOverrides, edgeSrc, null),
      roles: remapEdgeVector(pc.roles, edgeSrc, null),
      ...(exc[i].length ? { exceptions: exc[i] } : {}),
      splitFrom: { group, count: pieces.length, sig: sigOf(ring), from: snap },
    }));
    const next = list.flatMap((p) => (p.id === pc.id ? made : [p]));
    const info = parcelDisplayInfo(list);
    return { ok: true, parent: pc, parentName: (info.get(pc.id) || {}).name || "the parcel", made, parcels: next, removeIds: [pc.id], res };
  }
  return first ? { ok: false, code: "bad-cut", message: first.message, res: first } : refuse("bad-cut", "That line doesn't cross a parcel.");
}

/* Restore a split's original. Only while EVERY piece of that cut is still there, untouched by a
 * further split or combine — otherwise the restore would silently delete work. */
export function planRestoreSplit(parcels, pieceId, { newId }) {
  const list = parcels || [];
  const piece = list.find((p) => p.id === pieceId);
  const sf = piece && piece.splitFrom;
  if (!sf || !sf.from) return refuse("nothing-to-restore", "This parcel wasn't made by a split, so there is no original to restore.");
  const sibs = list.filter((p) => p.splitFrom && p.splitFrom.group === sf.group);
  if (sibs.length !== sf.count) return refuse("pieces-changed", "One of the pieces has since been split, combined or removed. Restore from that one first, or use Undo.");
  const edited = sibs.some((p) => p.splitFrom.sig != null && sigOf(p.points) !== p.splitFrom.sig) || sibs.some((p) => p.active === false) !== (sf.from.active === false);
  const orig = { ...unsnap(sf.from), id: newId() };
  const idx = list.findIndex((p) => p.splitFrom && p.splitFrom.group === sf.group);
  const next = [];
  list.forEach((p, i) => { if (i === idx) next.push(orig); if (!(p.splitFrom && p.splitFrom.group === sf.group)) next.push(p); });
  return { ok: true, parcels: next, removeIds: sibs.map((p) => p.id), restored: orig, count: sibs.length, edited };
}

/* Deed acres of a tract: the sum of its originals' stated acres, or null if any is unknown (a sum
 * with a hole in it would read as a fact). */
export function deedAcresSummed(tract) {
  const from = (tract && tract.combined && tract.combined.from) || [];
  if (!from.length) return null;
  let sum = 0;
  for (const s of from) { const a = parseAcres(s.statedAcres); if (a == null) return null; sum += a; }
  return sum;
}

/* One display row per parcel for the table — everything the row, the filter and the sort read. */
export function buildParcelRows(parcels, { cadName = null, idField = null } = {}) {
  return parcelOutline(parcels).map(({ pc, depth, name, superseded }) => ({
    pc, depth, name, superseded,
    origin: parcelOrigin(pc, { cadName, idField }),
    id: pc.id,
    acres: parcelNetSqft(pc) / SQFT_PER_ACRE,
    included: pc.active !== false,
    locked: !!pc.locked,
    apn: accountOf(pc, { idField }) || null,
    owner: ownerName(pc.attrs) || null,
    combined: !!(pc.combined && pc.combined.from && pc.combined.from.length),
    splitFrom: !!(pc.splitFrom && pc.splitFrom.from),
  }));
}
