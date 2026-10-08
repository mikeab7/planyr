/* Building panel v2 — the Loading section's per-wall rows, as pure functions.
 *
 * ONE list under the wall picker: a row per wall (or per linked dock pair), each carrying its layers
 * outward as compact chips and a dashed "+". This module owns every decision the rows make so the
 * panel is only a drawing of the answers:
 *   - which rows exist, in what order, with what badge/role word (`wallRowPlan`);
 *   - what each chip says (`chipLabel`) and what the "+" may offer on THAT wall (`addOptions`);
 *   - what removing a layer takes with it (`removalCount`);
 *   - the trailer-parking row/aisle depth arithmetic (`trailerTotalDepth` …) the canvas relayout,
 *     the panel and the stall count all share;
 *   - the bump-out chip's corner names (`bumpEndLabel`).
 *
 * Rules the owner set (do not relitigate): the REAR wall is never grouped with the ends; END walls
 * (and the two long walls of a no-dock building) are ALWAYS separate rows — there is no link option
 * for them; only a cross-dock PAIR can be linked, and it is linked by default.
 * No React, no DOM, no host state. */
import { dockSidesFor, dockSideCompassLabel, compassLabelForBearing } from "./dockZones.js";
import { WALLS, OPPOSITE_WALL } from "./loadingWalls.js";

/* ------------------------------------------------------------------ rows */

/** Is a cross-dock building's wall pair editing as one ("same")? Absent = linked. */
export const dockLinked = (b) => !b || b.dockStacksLinked !== false;

/**
 * The ordered rows of the wall list: dock wall(s), the rear wall (single-load only — the wall
 * opposite the dock), then each remaining wall as its own row.
 * @returns {{key:string, role:"dock"|"rear"|"ends"|"sides", sides:string[], badge:string,
 *            pair:boolean, linked:boolean}[]}
 */
export function wallRowPlan(b) {
  const rot = (b && b.rot) || 0;
  const { dockSides } = dockSidesFor(b || {});
  const lab = (s) => dockSideCompassLabel(s, rot);
  const rows = [];
  if (dockSides.length === 2) {
    if (dockLinked(b)) {
      rows.push({ key: "dock", role: "dock", sides: [...dockSides], badge: dockSides.map(lab).join("·"), pair: true, linked: true });
    } else {
      dockSides.forEach((s) => rows.push({ key: `dock:${s}`, role: "dock", sides: [s], badge: lab(s), pair: true, linked: false }));
    }
  } else if (dockSides.length === 1) {
    const rear = OPPOSITE_WALL[dockSides[0]];
    rows.push({ key: "dock", role: "dock", sides: [dockSides[0]], badge: lab(dockSides[0]), pair: false, linked: false });
    rows.push({ key: `rear:${rear}`, role: "rear", sides: [rear], badge: lab(rear), pair: false, linked: false });
  }
  const used = new Set(rows.flatMap((r) => r.sides));
  const role = dockSides.length ? "ends" : "sides";
  WALLS.filter((s) => !used.has(s)).forEach((s) => rows.push({ key: `${role}:${s}`, role, sides: [s], badge: lab(s), pair: false, linked: false }));
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

/** The first chip of a dock row: `Bump-outs 2` · `Bump-outs none`. */
export const bumpChipLabel = (n) => `Bump-outs ${n > 0 ? n : "none"}`;

/**
 * What the dashed "+" offers on THIS wall.
 * @param {boolean} isDock  the wall is a loaded dock wall
 * @param {{kind:string}[]} layers  its layers, outward (inner → outer)
 * @returns {{key:string, label:string}[]} catalog options (empty after a Road — it is terminal)
 */
export function addOptions(isDock, layers) {
  const kinds = layers.map((l) => l.kind);
  if (kinds[kinds.length - 1] === "road") return [];
  const opt = (k) => ({ key: k, label: KIND_NAME[k] });
  const out = [];
  if (isDock) {
    if (!kinds.includes("court")) return [opt("court")];       // everything else stacks outside a court
    if (!kinds.includes("trailer")) out.push(opt("trailer"));
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
 * How many layers a Remove takes, counting from `index` outward. On a dock wall the stack is a
 * chain (a layer cannot float off the wall), so Remove takes the layer AND everything outside it;
 * on any other wall it takes just that layer.
 */
export function removalCount(isDock, layers, index) {
  return isDock ? Math.max(0, layers.length - index) : 1;
}

/* ------------------------------------------------------------------ trailer rows */

export const TRAILER_MAX_ROWS = 4;
export const TRAILER_MIN_ROW_DEPTH = 8;
export const clampTrailerRows = (n) => Math.max(1, Math.min(TRAILER_MAX_ROWS, Math.round(Number(n)) || 1));

/** The depth of `rows` stall rows with a drive aisle between each PAIR — the band/aisle pattern
 *  `siteGeometry.trailerStalls` draws: rows × row + ⌊rows / 2⌋ × aisle. */
export function trailerTotalDepth(rows, rowDepth, aisle) {
  const r = clampTrailerRows(rows);
  return r * rowDepth + Math.floor(r / 2) * Math.max(0, aisle || 0);
}
/** The inverse: one row's depth given the zone's total depth. Never below the stall minimum. */
export function trailerRowDepth(total, rows, aisle) {
  const r = clampTrailerRows(rows);
  if (r === 1) return total;                       // one row IS the zone — never second-guess a typed depth
  return Math.max(TRAILER_MIN_ROW_DEPTH, (total - Math.floor(r / 2) * Math.max(0, aisle || 0)) / r);
}
/** A trailer zone's resolved shape: rows (1–4), aisle between rows, per-row depth, total depth. */
export function trailerSpec(zone, defaultAisle = 60) {
  const rows = clampTrailerRows(zone && zone.trailerRows);
  const aisleRaw = Number(zone && zone.trailerAisleFt);
  const aisle = Number.isFinite(aisleRaw) && aisleRaw >= 0 ? aisleRaw : (Number.isFinite(defaultAisle) ? defaultAisle : 60);
  const total = Number(zone && zone.zd) > 0 ? Number(zone.zd) : 50;
  const rowDepth = trailerRowDepth(total, rows, aisle);
  return { rows, aisle, rowDepth, total: rows > 1 ? trailerTotalDepth(rows, rowDepth, aisle) : total };
}
/** The `cfg` the trailer element draws with, for a spec: a single row is the flush "single" strip, two or
 *  more are `trailerStalls`' double-loaded bands with the drive aisle between. */
export function trailerCfg(prevCfg, spec, trailerW) {
  return { ...(prevCfg || {}), trailerW, trailerL: spec.rowDepth, trailerAisle: spec.rows > 1 ? spec.aisle : 0, single: spec.rows === 1 };
}
/** The total depth (`zd`) to store after changing the row count, holding one row's depth. */
export function zdAfterRowChange(zone, nextRows, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  return trailerTotalDepth(nextRows, cur.rowDepth, cur.aisle);
}
/** The total depth to store after typing one row's depth. */
export function zdAfterRowDepth(zone, rowDepth, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  return trailerTotalDepth(cur.rows, Math.max(TRAILER_MIN_ROW_DEPTH, rowDepth), cur.aisle);
}
/** The total depth to store after typing the aisle between rows. */
export function zdAfterAisle(zone, aisle, defaultAisle = 60) {
  const cur = trailerSpec(zone, defaultAisle);
  return trailerTotalDepth(cur.rows, cur.rowDepth, Math.max(0, aisle));
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
