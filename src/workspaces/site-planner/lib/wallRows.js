/* Building panel v2/v3 — the "Docks & walls" section's per-wall rows, as pure functions.
 *
 * ONE list under the wall picker: a row per wall, each carrying its layers outward as ONE strip of
 * pieces (v3; v2 drew wrapping chips) and a dashed "+". This module owns every decision the rows make
 * so the panel is only a drawing of the answers:
 *   - which rows exist, in what order, with what badge/role word (`wallRowPlan`);
 *   - what each piece says (`pieceLabel` / `pieceTooltip`), how wide it and its bar are on a scale
 *     shared by every wall of the building (`stripPlan`), and the legend (`legendKinds`);
 *   - what the "+" may offer on THAT wall (`addOptions`) and what removing a piece does
 *     (`planDockPieceRemoval`: ONLY that piece — everything outside it moves in — plus, forced by the
 *     bond, a truck court's trailer parking);
 *   - the trailer-parking row/aisle depth arithmetic (`trailerTotalDepth` …, and v3's per-row depths
 *     `trailerRowDepths`) the canvas relayout, the panel and the stall count all share;
 *   - the bump-out corner names (`bumpEndLabel`).
 *
 * Rules the owner set (do not relitigate): the REAR wall is never grouped with the ends; EVERY wall is
 * its own row — the two dock walls of a cross-dock building too (NEW-1: the old linked "N·S dock" row and
 * its same/split toggle are gone; a stored `dockStacksLinked` on an old plan is simply ignored).
 * No React, no DOM, no host state. */
import { dockSidesFor, dockSideCompassLabel, compassLabelForBearing, anchoredAlongSpan, normalizeAlongAnchor } from "./dockZones.js";
import { WALLS, OPPOSITE_WALL } from "./loadingWalls.js";

/* ------------------------------------------------------------------ rows */

/**
 * The ordered rows of the wall list: the dock wall(s) — each its OWN row, a cross-dock building's two
 * dock walls included — the rear wall (single-load only — the wall opposite the dock), then each
 * remaining wall as its own row.
 * @returns {{key:string, role:"dock"|"rear"|"ends"|"sides", sides:string[], badge:string}[]}
 */
export function wallRowPlan(b) {
  const rot = (b && b.rot) || 0;
  const { dockSides } = dockSidesFor(b || {});
  const lab = (s) => dockSideCompassLabel(s, rot);
  const rows = [];
  if (dockSides.length === 2) {
    dockSides.forEach((s) => rows.push({ key: `dock:${s}`, role: "dock", sides: [s], badge: lab(s) }));
  } else if (dockSides.length === 1) {
    const rear = OPPOSITE_WALL[dockSides[0]];
    rows.push({ key: "dock", role: "dock", sides: [dockSides[0]], badge: lab(dockSides[0]) });
    rows.push({ key: `rear:${rear}`, role: "rear", sides: [rear], badge: lab(rear) });
  }
  const used = new Set(rows.flatMap((r) => r.sides));
  const role = dockSides.length ? "ends" : "sides";
  WALLS.filter((s) => !used.has(s)).forEach((s) => rows.push({ key: `${role}:${s}`, role, sides: [s], badge: lab(s) }));
  return rows;
}

/* ------------------------------------------------------------------ chips */

/** Layer kinds a wall's stack can carry. */
export const KIND_LABEL = { court: "Court", trailer: "Trailer", buffer: "Buffer", sidewalk: "Walk", parking: "Parking", road: "Road" };
/** The longer name used in the editor box and the "+" catalog. */
export const KIND_NAME = { court: "Truck court", trailer: "Trailer parking", buffer: "Landscape buffer", sidewalk: "Sidewalk", parking: "Car parking", road: "Road" };
/** The ZONE_CATALOG key behind a layer kind. */
export const KIND_CATALOG_KEY = { court: "court", trailer: "trailer", buffer: "buffer", sidewalk: "sidewalk", parking: "parking", road: "road" };

const ft = (n) => `${Math.round(Number(n) || 0)}′`;

/** The text on a layer's chip: `Court 135′` · `Trailer 50′` · `Trailer ×2` · `Parking 8 rows` · `Road 24′`. */
export function chipLabel(layer) {
  const name = KIND_LABEL[layer.kind] || "Layer";
  if (layer.kind === "parking") { const n = Math.round(layer.rows || 0); return `${name} ${n} ${n === 1 ? "row" : "rows"}`; }
  if (layer.kind === "trailer" && (layer.rows || 1) > 1) return `${name} ×${layer.rows}`;
  return `${name} ${ft(layer.depth)}`;
}

/** The bump-outs line under the wall picker (v3): `Bump-outs 2 · 55 × 30 ft`, or `Bump-outs none`. */
export function bumpSummary(n, along, proj) {
  if (!(n > 0)) return "Bump-outs none";
  return `Bump-outs ${n} · ${Math.round(along)} × ${Math.round(proj)} ft`;
}

/* ------------------------------------------------------------------ strip (Building panel v3) */

/** Every wall is ONE strip: a bar of pieces, building at the left, layers outward left → right. All
 *  widths are layout guidance in CSS px (never shown to the user). */
export const STRIP = { FULL: 156, FLOOR: 48, MIN_PIECE: 18, GAP: 1, ICON_BASE: 16, ICON_PER_CHAR: 6 };
/** Legend / kind order. */
export const KIND_ORDER = ["court", "trailer", "buffer", "sidewalk", "parking", "road"];

/** A piece's text: `135′` for a depth layer, `×2` for a row count (car parking always; trailer parking from two rows). */
export function pieceLabel(layer) {
  if (layer.kind === "parking") return `×${Math.round(layer.rows || 0)}`;
  if (layer.kind === "trailer" && (layer.rows || 1) > 1) return `×${layer.rows}`;
  return ft(layer.depth);
}
/** A wall's total depth: Σ its layers' depths (a trailer's is its whole zone, a road's its travel width). */
export const wallTotalDepth = (layers) => (layers || []).reduce((t, l) => t + (Number(l.depth) || 0), 0);
/** The piece tooltip: `Truck court 135′ · wall total 339′` (a row-count piece names its rows and depth). */
export function pieceTooltip(layer, total) {
  const name = KIND_NAME[layer.kind] || "Layer";
  const head = layer.kind === "parking" || (layer.kind === "trailer" && (layer.rows || 1) > 1)
    ? `${name} ${pieceLabel(layer)} (${ft(layer.depth)})` : `${name} ${ft(layer.depth)}`;
  return `${head} · wall total ${ft(total)}`;
}
/** Does a piece of width `w` have room for its icon before its value? (the mockup's rule: 16 + 6 × label length) */
export const pieceShowsIcon = (w, label) => w >= STRIP.ICON_BASE + STRIP.ICON_PER_CHAR * String(label).length;

/** Split `avail` across pieces by depth with every piece at least MIN_PIECE: fixed-min pieces first, the rest
 *  shared by depth (water-filling, so a thin layer next to a deep one never reads as a sliver). */
function splitByDepth(depths, avail) {
  const n = depths.length;
  const d = depths.map((x) => Math.max(1, Number(x) || 0));
  const w = new Array(n).fill(0), fixed = new Array(n).fill(false);
  let remaining = avail;
  for (let pass = 0; pass <= n; pass++) {
    const free = d.map((_, i) => i).filter((i) => !fixed[i]);
    if (!free.length) break;
    const sum = free.reduce((t, i) => t + d[i], 0);
    const low = free.filter((i) => (remaining * d[i]) / sum < STRIP.MIN_PIECE);
    if (!low.length) { free.forEach((i) => { w[i] = (remaining * d[i]) / sum; }); break; }
    low.forEach((i) => { w[i] = STRIP.MIN_PIECE; fixed[i] = true; remaining -= STRIP.MIN_PIECE; });
  }
  return w;
}

/**
 * The strips' geometry, on ONE scale for every wall of the building.
 * @param {{key:string, layers:{depth:number}[]}[]} rows
 * @returns {{maxTotal:number, rows:Record<string,{total:number, barW:number, pieces:{x:number,w:number}[]}>}}
 *   bar length ∝ the wall's total depth (deepest wall = FULL, a shallow one never under FLOOR, and never so short
 *   a piece falls under MIN_PIECE); an empty wall has no bar (barW 0).
 */
export function stripPlan(rows) {
  const totals = rows.map((r) => wallTotalDepth(r.layers));
  const maxTotal = Math.max(0, ...totals);
  const out = {};
  rows.forEach((r, i) => {
    const n = r.layers.length;
    if (!n) { out[r.key] = { total: 0, barW: 0, pieces: [] }; return; }
    const needs = n * STRIP.MIN_PIECE + (n - 1) * STRIP.GAP;
    const prop = maxTotal > 0 ? (STRIP.FULL * totals[i]) / maxTotal : STRIP.FULL;
    const barW = Math.round(Math.max(needs, Math.min(STRIP.FULL, Math.max(STRIP.FLOOR, prop))) * 100) / 100;
    const widths = splitByDepth(r.layers.map((l) => l.depth), barW - (n - 1) * STRIP.GAP);
    let x = 0;
    const pieces = widths.map((w) => { const piece = { x: Math.round(x * 100) / 100, w: Math.round(w * 100) / 100 }; x += w + STRIP.GAP; return piece; });
    out[r.key] = { total: totals[i], barW, pieces };
  });
  return { maxTotal, rows: out };
}

/** The kinds present on this building, in legend order (Court, Trailer, Buffer, Walk, Parking, Road). */
export function legendKinds(rows) {
  const present = new Set();
  rows.forEach((r) => (r.layers || []).forEach((l) => present.add(l.kind)));
  return KIND_ORDER.filter((k) => present.has(k)).map((k) => ({ kind: k, name: KIND_LABEL[k] }));
}

/**
 * What the dashed "+" offers on THIS wall.
 * @param {boolean} isDock  the wall is a loaded dock wall
 * @param {{kind:string}[]} layers  its layers, outward (inner → outer)
 * @returns {{key:string, label:string}[]} catalog options (empty after a Road — it is terminal)
 */
export function addOptions(isDock, layers) {
  const kinds = layers.map((l) => l.kind);
  const opt = (k) => ({ key: k, label: KIND_NAME[k] });
  const terminal = kinds[kinds.length - 1] === "road";
  // v3: a dock wall whose court was binned (buffer / walk / road stayed) can take the court back at its head — that
  // is inboard of everything, so even a wall ending in a road may add it. Trailer parking opens off a court, so it
  // is only offered once there is one.
  if (isDock && kinds.length && !kinds.includes("court")) return terminal ? [opt("court")] : [opt("court"), opt("buffer"), opt("sidewalk"), opt("road")];
  if (terminal) return [];                                       // a Road is terminal
  const out = [];
  if (isDock) {
    if (!kinds.length) return [opt("court")];                   // an empty dock wall starts with its court
    out.push(opt("trailer"));                                   // trailer rows repeat — a second / third row is always on offer
    out.push(opt("buffer"), opt("sidewalk"), opt("road"));
    return out;
  }
  if (!kinds.includes("sidewalk")) out.push(opt("sidewalk"));
  // Parking is placed just beyond the sidewalk, so it is offered only before a buffer / road sits there.
  if (!kinds.includes("parking") && !kinds.some((k) => k === "buffer" || k === "road")) out.push(opt("parking"));
  out.push(opt("buffer"), opt("road"));
  return out;
}

/**
 * How many layers a Remove takes. v3: ONLY the piece itself on every wall — dock walls included — and the
 * layers outside it keep their depth and close in. (The one bond the code forces — a truck court's trailer
 * parking goes with it — is `planDockPieceRemoval`'s, because it needs the elements, not the count.)
 */
export function removalCount() {
  return 1;
}

/**
 * Remove ONE piece from a dock wall's chain and say how the rest re-bonds, as data (pure).
 * @param {object[]} chain  the wall's zone ELEMENTS, head (court) → outward
 * @param {number} index    the piece to remove
 * @param {string} side     the wall ("top" | …) — stamped on a layer that becomes the new head
 * @returns {{removeIds:string[], patches:{id:string, set:object, drop:string[]}[], court:boolean}|null}
 *   removeIds: the piece, plus — when it is a truck court — the trailer parking that opens off it;
 *   patches: survivors whose inboard neighbour changed (`prevZone` re-pointed to the nearest SURVIVING layer
 *   inboard, `null` + `stackSide` when it now sits against the wall; a legacy `forTrailer` naming a removed
 *   layer is dropped). Survivors keep their depth (`zd` is untouched), so the caller's relayout closes the gap.
 */
export function planDockPieceRemoval(chain, index, side) {
  const gone = chain && chain[index];
  if (!gone) return null;
  const remove = new Set([gone.id]);
  const isCourt = !!gone.truckCourt;
  if (isCourt) chain.forEach((z) => { if (z.forCourt === gone.id || z.type === "trailer") remove.add(z.id); });
  const patches = [];
  let pred = null;
  chain.forEach((z, i) => {
    if (remove.has(z.id)) return;
    const oldPred = i > 0 ? chain[i - 1] : null;
    if ((oldPred ? oldPred.id : null) !== (pred ? pred.id : null)) {
      const set = { prevZone: pred ? pred.id : null };
      if (!pred) set.stackSide = side;
      const drop = [];
      if (z.forTrailer && remove.has(z.forTrailer)) drop.push("forTrailer");
      if (z.forCourt && remove.has(z.forCourt)) drop.push("forCourt");
      patches.push({ id: z.id, set, drop });
    }
    pred = z;
  });
  return { removeIds: [...remove], patches, court: isCourt };
}

/** Apply a `planDockPieceRemoval` plan to an element list (pure; same array when it names nothing present). */
export function applyDockPieceRemoval(els, plan) {
  if (!plan) return els;
  const gone = new Set(plan.removeIds);
  const byId = new Map(plan.patches.map((p) => [p.id, p]));
  return els.filter((x) => !gone.has(x.id)).map((x) => {
    const p = byId.get(x.id);
    if (!p) return x;
    const next = { ...x, ...p.set };
    p.drop.forEach((k) => { delete next[k]; });
    return next;
  });
}

/* ------------------------------------------------------------------ trailer rows */

/* ---- Along-wall extent of a layer (its LENGTH and POSITION along the wall).
 * A dock-wall layer outside the court tracks the court's span by default; `alongLen` + `alongAnchor` + `alongOff`
 * (dockZones.anchoredAlongSpan) let it run shorter / sit elsewhere. These helpers are the one place the panel and the
 * "+" decide what a layer's extent is, so a NEW layer can inherit it and an edit can change it. `ctx` =
 * { chainAlong, chainShift, fullAlong }: the court's resolved span (what a plain layer tracks) and the whole wall. */

/** A layer's resolved { along, shift } — exactly what `layoutZoneByKind` will draw. The head (court) IS the chain span. */
export function resolveLayerExtent(el, isHead, ctx) {
  if (isHead || !el) return { along: ctx.chainAlong, shift: ctx.chainShift || 0 };
  return anchoredAlongSpan({ stored: el.alongLen, anchor: el.alongAnchor, off: el.alongOff, chainAlong: ctx.chainAlong, chainShift: ctx.chainShift || 0, fullAlong: ctx.fullAlong });
}
/** The extent fields a NEW layer takes from the layer immediately before it (the one it sits outside of): the same
 *  length AND position along the wall. A previous layer that simply tracks the court (or is the court) hands over
 *  nothing — the new layer tracks it too, so it keeps following bump-out and building changes. Depth is never copied. */
export function inheritExtentFields(prev, isHead, ctx) {
  const r = resolveLayerExtent(prev, isHead, ctx);
  const sameLen = Math.abs(r.along - ctx.chainAlong) < 0.01, sameAt = Math.abs(r.shift - (ctx.chainShift || 0)) < 0.01;
  if (sameLen && sameAt) return {};
  return { alongLen: Math.round(r.along * 100) / 100, alongAnchor: 0, alongOff: Math.round((r.shift - (ctx.chainShift || 0)) * 100) / 100 };
}
/** The zone patch (`undefined` drops a key) after editing ONE layer's extent: a typed length keeps the layer's anchor
 *  (a layer pulled in from one end keeps that end), an align (-1 start · 0 centre · 1 end) pins that end of the court's
 *  span, and `full` hands the layer back to tracking the court. Only that layer's keys — never a neighbour's. */
export function layerExtentPatch(el, { len, align, full } = {}, ctx) {
  const clear = { alongLen: undefined, alongAnchor: undefined, alongOff: undefined };
  if (full) return clear;
  const cur = resolveLayerExtent(el, false, ctx);
  const cap = Math.max(1, Number(ctx.fullAlong) || Number(ctx.chainAlong) || 1);
  const length = len == null ? cur.along : Math.max(1, Math.min(cap, Math.round(Number(len))));
  const anchor = align == null ? normalizeAlongAnchor(el && el.alongAnchor) : normalizeAlongAnchor(align);
  const off = align == null ? (Number(el && el.alongOff) || 0) : 0;
  if (align == null && Math.abs(length - ctx.chainAlong) < 0.01) return clear;                      // typed the court's own length ⇒ track the court again
  if (anchor === 0 && Math.abs(off) < 0.01 && Math.abs(length - ctx.chainAlong) < 0.01) return clear;
  return { alongLen: length, alongAnchor: anchor, alongOff: off };
}

/** Another trailer row on a dock wall, as the fields of a new chain element — or null when the wall can't take one
 *  (no truck court at its head, or it ends in a Road, which is terminal). The row is its own piece, bonded to the
 *  OUTERMOST layer (`prevZone`, like a Walk or Road). Its DEPTH is the standard trailer depth (never copied from a
 *  neighbour); its LENGTH and POSITION along the wall are the layer immediately before it. No `forCourt` — that bond
 *  names a court's FIRST trailer parking; a repeat row is found by walking the chain. */
export function planTrailerRowAdd(chain, { standardDepth, trailerW, side, ctx }) {
  const c = chain || [];
  const court = c[0], outer = c[c.length - 1];
  if (!court || !court.truckCourt || !outer || outer.type === "road") return null;
  const depth = Math.max(TRAILER_MIN_ROW_DEPTH, roundFt(Number(standardDepth) > 0 ? standardDepth : 50));
  return { depth, fields: { type: "trailer", prevZone: outer.id, stackSide: side, noFit: true, zd: depth,
    cfg: { trailerW, trailerL: depth, trailerAisle: 0, single: true }, ...(ctx ? inheritExtentFields(outer, c.length === 1, ctx) : {}) } };
}

export const TRAILER_MAX_ROWS = 4;
export const TRAILER_MIN_ROW_DEPTH = 8;
export const clampTrailerRows = (n) => Math.max(1, Math.min(TRAILER_MAX_ROWS, Math.round(Number(n)) || 1));

/** The depth of `rows` stall rows with a drive aisle between each PAIR — the band/aisle pattern
 *  `siteGeometry.trailerStalls` draws: rows × row + ⌊rows / 2⌋ × aisle. */
export function trailerTotalDepth(rows, rowDepth, aisle) {
  const r = clampTrailerRows(rows);
  return r * rowDepth + Math.floor(r / 2) * Math.max(0, aisle || 0);
}
/** The same total when each row has its OWN depth (v3): Σ row depths + ⌊rows / 2⌋ × aisle. */
export function trailerTotalDepthOf(rowDepths, aisle) {
  const d = Array.isArray(rowDepths) ? rowDepths : [];
  return d.reduce((s, x) => s + (Number(x) || 0), 0) + Math.floor(d.length / 2) * Math.max(0, aisle || 0);
}
/** The inverse: one row's depth given the zone's total depth. Never below the stall minimum. */
export function trailerRowDepth(total, rows, aisle) {
  const r = clampTrailerRows(rows);
  if (r === 1) return total;                       // one row IS the zone — never second-guess a typed depth
  return Math.max(TRAILER_MIN_ROW_DEPTH, (total - Math.floor(r / 2) * Math.max(0, aisle || 0)) / r);
}
/** A zone's stored per-row depths (`trailerRowDepths`, row 1 nearest the court), resolved to `rows` entries —
 *  padded with the last depth / truncated — or null when absent or unusable (⇒ every row uses the single depth). */
export function storedRowDepths(zone, rows) {
  const raw = zone && zone.trailerRowDepths;
  if (!Array.isArray(raw) || !raw.length) return null;
  const nums = raw.map(Number);
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return null;
  const out = nums.slice(0, rows).map((n) => Math.max(TRAILER_MIN_ROW_DEPTH, n));
  while (out.length < rows) out.push(out[out.length - 1]);
  return out;
}
/** A trailer zone's resolved shape: rows (1–4), aisle between rows, per-row depth(s), total depth.
 *  `rowDepths` always has `rows` entries; `custom` says they came from `trailerRowDepths`. */
export function trailerSpec(zone, defaultAisle = 60) {
  const rows = clampTrailerRows(zone && zone.trailerRows);
  const aisleRaw = Number(zone && zone.trailerAisleFt);
  const aisle = Number.isFinite(aisleRaw) && aisleRaw >= 0 ? aisleRaw : (Number.isFinite(defaultAisle) ? defaultAisle : 60);
  const given = storedRowDepths(zone, rows);
  if (given) return { rows, aisle, rowDepth: given[0], rowDepths: given, total: trailerTotalDepthOf(given, aisle), custom: true };
  const total = Number(zone && zone.zd) > 0 ? Number(zone.zd) : 50;
  const rowDepth = trailerRowDepth(total, rows, aisle);
  return { rows, aisle, rowDepth, rowDepths: Array.from({ length: rows }, () => rowDepth), total: rows > 1 ? trailerTotalDepth(rows, rowDepth, aisle) : total, custom: false };
}
/** The `cfg` the trailer element draws with, for a spec: a single row is the flush "single" strip, two or
 *  more are `trailerStalls`' double-loaded bands with the drive aisle between. `side` (v3) lets a zone with
 *  its own row depths keep row 1 against the court on a top / right wall, where the element's local y=0
 *  edge is the outer one. */
export function trailerCfg(prevCfg, spec, trailerW, side) {
  const cfg = { ...(prevCfg || {}), trailerW, trailerL: spec.rowDepth, trailerAisle: spec.rows > 1 ? spec.aisle : 0, single: spec.rows === 1 };
  if (spec.custom && spec.rows > 1) {
    cfg.trailerRowDepths = spec.rowDepths.slice();
    if (side === "top" || side === "right") cfg.trailerFlip = true; else delete cfg.trailerFlip;
  } else { delete cfg.trailerRowDepths; delete cfg.trailerFlip; }
  return cfg;
}
/** Apply a zone patch where `undefined` means "drop that key" (so an absent `trailerRowDepths` stays absent). */
export function applyZonePatch(el, patch) {
  const next = { ...el, ...patch };
  Object.keys(patch).forEach((k) => { if (patch[k] === undefined) delete next[k]; });
  return next;
}
const roundFt = (n) => Math.round(Number(n) * 100) / 100;
const allEqual = (a) => a.every((x) => x === a[0]);
/** The zone patch after changing the ROW COUNT (1–4). Adding a row copies the last row's depth; removing
 *  drops the last. A zone with a single depth for every row keeps holding that one depth (today's rule). */
export function trailerPatchRows(zone, nextRows, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  const rows = clampTrailerRows(nextRows);
  if (cur.custom) {
    const depths = cur.rowDepths.slice(0, rows);
    while (depths.length < rows) depths.push(depths[depths.length - 1]);
    return { trailerRows: rows, trailerAisleFt: cur.aisle, trailerRowDepths: depths, zd: trailerTotalDepthOf(depths, cur.aisle) };
  }
  return { trailerRows: rows, trailerAisleFt: cur.aisle, trailerRowDepths: undefined, zd: trailerTotalDepth(rows, cur.rowDepth, cur.aisle) };
}
/** The zone patch after typing ONE row's depth (index 0 = row 1, nearest the court). */
export function trailerPatchRowDepth(zone, index, depth, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  const i = Math.max(0, Math.min(cur.rows - 1, Math.round(Number(index)) || 0));
  const depths = cur.rowDepths.slice();
  depths[i] = Math.max(TRAILER_MIN_ROW_DEPTH, roundFt(depth));
  if (allEqual(depths)) {                          // every row alike again ⇒ back to the single-depth form
    return { trailerRows: cur.rows, trailerAisleFt: cur.aisle, trailerRowDepths: undefined, zd: trailerTotalDepth(cur.rows, depths[0], cur.aisle) };
  }
  return { trailerRows: cur.rows, trailerAisleFt: cur.aisle, trailerRowDepths: depths, zd: trailerTotalDepthOf(depths, cur.aisle) };
}
/** The zone patch after typing the aisle between facing rows. */
export function trailerPatchAisle(zone, aisle, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  const a = Math.max(0, roundFt(aisle));
  return { trailerAisleFt: a, zd: cur.custom ? trailerTotalDepthOf(cur.rowDepths, a) : trailerTotalDepth(cur.rows, cur.rowDepth, a) };
}
/** The total depth (`zd`) to store after changing the row count, holding the row depth(s). */
export function zdAfterRowChange(zone, nextRows, defaultAisle = 60) {
  return trailerPatchRows(zone, nextRows, defaultAisle).zd;
}
/** The total depth to store after typing one depth for EVERY row. */
export function zdAfterRowDepth(zone, rowDepth, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  return trailerTotalDepth(cur.rows, Math.max(TRAILER_MIN_ROW_DEPTH, rowDepth), cur.aisle);
}
/** The total depth to store after typing the aisle between rows. */
export function zdAfterAisle(zone, aisle, defaultAisle = 60) {
  return trailerPatchAisle(zone, aisle, defaultAisle).zd;
}

/* ------------------------------------------------------------------ bump-outs */

/** Local-frame bearing of a wall's end (sign ±1 along the wall) before rotation: top/bottom walls run
 *  along +x (east, 90°), left/right along +y (south, 180°). */
const END_BASE_BEARING = { top: 90, bottom: 90, left: 180, right: 180 };

/** The compass label of one END of a dock wall (the corner a bump-out sits at), at the building's rotation. */
export function bumpEndLabel(side, sign, rot = 0) {
  const base = END_BASE_BEARING[side];
  if (base == null) return "";
  const deg = (((base + (sign < 0 ? 180 : 0) + (Number(rot) || 0)) % 360) + 360) % 360;
  return compassLabelForBearing(deg);
}

/** The two bump-out corners of a wall: `[{sign:-1,label}, {sign:1,label}]`. */
export const bumpEnds = (side, rot = 0) => [-1, 1].map((sign) => ({ sign, label: bumpEndLabel(side, sign, rot) }));

/** Building footprint + its bump-outs, square feet. */
export function areaWithBumps(footprintSf, bumps) {
  const extra = (bumps || []).reduce((s, x) => s + (Number(x.w) || 0) * (Number(x.h) || 0), 0);
  return { footprint: footprintSf, extra, total: footprintSf + extra };
}
