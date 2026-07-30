/* Setback ROLES — the regulatory layer over the geometric one (NEW-1).
 *
 * ── why this exists ──────────────────────────────────────────────────────────────────────────
 * `edgeRuns.js` groups a boundary into geometric SIDES (±7° chaining) and `setbackChips.js`
 * groups it into labelled RUNS (shared value + a bounded direction spread). Both are honest
 * geometry, and on the owner's Weld County parcel both still produce fifteen rows: "Side 1 · 2
 * seg, Side 2 · 6 seg … Side 15". That is not how a zoning ordinance is written. An ordinance
 * names exactly four setbacks — FRONT, SIDE, STREET SIDE (the second street frontage on a corner
 * lot) and REAR — and the developer types four numbers, not fifteen (owner, 2026-07-30).
 *
 * So this module adds a third, COARSER tier on top of the two that exist:
 *
 *     By role     (default)  4 rows   — the ordinance's own vocabulary
 *     By side               ~N rows   — one per labelled run, the middle tier
 *     Per segment           ~E rows   — one per edge, the exception tier
 *
 * ── the invariant ────────────────────────────────────────────────────────────────────────────
 * A role is a LABEL over edges. It is never an input to any measurement. The canonical store is
 * still the per-edge `pc.setbacks` array that the yield / buildable engine reads, and nothing
 * here writes a setback VALUE — assigning roles to a parcel that has never been touched leaves
 * `setbacks` byte-identical, so no site's computed buildable area can move. (Pinned by
 * `test/setbackRoles.test.js` against the real production snapshot of the owner's Weld County
 * parcel, sites.id sms7v3ua7ksy.)
 *
 * ── how a role is auto-assigned ──────────────────────────────────────────────────────────────
 * Roles resolve from geometry the moment a parcel loads — every side, not just one. The order is
 * deliberate, because each step narrows what the next one can claim:
 *   1. STREET ABUTMENT.  When the plan carries road centerlines outside the lot, a run whose
 *      length mostly lies within `STREET_ABUT_FT` of one abuts a street.
 *   2. FRONT.  The longest street-abutting run (or, with no roads on the plan, simply the longest
 *      run — the frontage heuristic this app has always used). A frontage broken into two runs by
 *      a slight jog is re-joined: a run facing the same way as the front, and standing at
 *      effectively the same depth, is front too.
 *   3. STREET SIDE.  Any OTHER run that abuts a street — the corner-lot case. Only ever assigned
 *      when there is real road geometry to abut; a guess would be worse than a Side.
 *   4. REAR.  Runs facing roughly opposite the front (outward normals ≥ 123° apart).
 *   5. SIDE.  Everything else.
 *
 * The result is a DEFAULT, not a verdict. The user's own assignment is stored per edge in
 * `pc.roles` and always wins — which is the owner's explicit instruction: "a wrong-but-correctable
 * role is fine, fifteen unlabelled sides is not."
 *
 * Pure + dependency-free (bar the sibling run grouper) + unit-tested. Planar feet, the same
 * {x,y} open-ring convention as `edgeRuns` / `setbackChips`: edge i is points[i] → points[i+1].
 */

import { setbackChipRuns } from "./setbackChips.js";

/* Display order is the owner's own: Front / Side / Street side / Rear. */
export const SETBACK_ROLES = ["front", "side", "street", "rear"];

export const ROLE_LABEL = { front: "Front", side: "Side", street: "Street side", rear: "Rear" };
/* The on-canvas chip is a fixed plate on a boundary line, so it takes the short form. */
export const ROLE_SHORT = { front: "Front", side: "Side", street: "St side", rear: "Rear" };

/* A run abuts a street when most of its length lies within this of a road centerline. Generous
 * on purpose: a county road is digitized at its centerline, so a lot line on the right-of-way
 * edge stands half the right-of-way away from it before any shoulder or setback. */
export const STREET_ABUT_FT = 150;

/* Two runs are the "same frontage" when their outward normals agree within this and they stand
 * at the same depth (within DEPTH_TOL of the lot's own extent along the front normal). */
const FRONT_ALIGN_DOT = Math.cos((20 * Math.PI) / 180);   // ≥ 0.94
const FRONT_DEPTH_TOL = 0.15;
/* A run is REAR when its outward normal is at least this far from the front's (dot ≤ −0.55 is
 * ~123°), which keeps a lot's true back line rear while leaving an angled side line a Side. */
const REAR_DOT = -0.55;
/* Fraction of a run's length that must be near a road before the run counts as abutting it. */
const ABUT_FRACTION = 0.5;

export const isRole = (r) => SETBACK_ROLES.includes(r);

const num = (v) => (Number.isFinite(v) ? v : 0);
const hyp = (dx, dy) => Math.hypot(dx, dy);

/* Signed shoelace area — its SIGN is the ring's winding, which is what tells us which side of an
 * edge is "outside". Orientation is not assumed anywhere: parcels arrive from deeds, county GIS
 * and freehand drawing, and they wind both ways. */
function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/* Unit OUTWARD normal of edge a→b for a ring of the given winding. */
function outwardNormal(a, b, ccw) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = hyp(dx, dy);
  if (!(len > 0)) return null;
  return ccw ? { x: dy / len, y: -dx / len } : { x: -dy / len, y: dx / len };
}

/* Nearest point on any of `lines` to p, with its distance — the DIRECTION matters as much as the
 * distance (see `abutFraction`), so this returns the point, not just how far away it is. */
function nearestOnPolylines(p, lines) {
  let best = null, bd = Infinity;
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      const q = { x: a.x + dx * t, y: a.y + dy * t };
      const d = hyp(p.x - q.x, p.y - q.y);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return { point: best, dist: bd };
}

/* The GEOMETRIC run partition roles reason over: `setbackChipRuns` fed a FLAT value vector, so
 * the grouping depends on shape alone. Deliberate — roles must not reshuffle the moment the user
 * types a different setback on one side (which does re-break the value-aware runs the panel and
 * the chips are drawn from). */
export function roleRuns(points) {
  const n = points ? points.length : 0;
  if (n < 2) return [];
  return setbackChipRuns(points, new Array(n).fill(0));
}

/* Per-run facts the assignment reads: length, unit outward normal, and centroid. */
function runFacts(points, runs) {
  const n = points.length;
  const ccw = signedArea(points) > 0;
  return runs.map((run) => {
    let nx = 0, ny = 0, cx = 0, cy = 0, len = 0;
    for (const e of run.edges) {
      const a = points[e], b = points[(e + 1) % n];
      const l = hyp(b.x - a.x, b.y - a.y);
      const nrm = outwardNormal(a, b, ccw);
      if (nrm) { nx += nrm.x * l; ny += nrm.y * l; }
      cx += ((a.x + b.x) / 2) * l; cy += ((a.y + b.y) / 2) * l;
      len += l;
    }
    const nl = hyp(nx, ny);
    return {
      run,
      lengthFt: len,
      normal: nl > 0 ? { x: nx / nl, y: ny / nl } : { x: 0, y: 0 },
      centroid: len > 0 ? { x: cx / len, y: cy / len } : { x: points[run.edges[0]].x, y: points[run.edges[0]].y },
    };
  });
}

/* Length-weighted fraction of a run that genuinely FACES a street.
 *
 * Two conditions, and the second is what makes this useful rather than merely near: the sample
 * must be within `tolFt` of a road AND the road must lie on the sample's OUTWARD side (within
 * ~60° of its outward normal). Distance alone marks a lot's whole side street-abutting merely
 * because its far end reaches the corner — the deep side of a shallow lot is within a right-of-way
 * of the road it runs away from, and would otherwise be read as frontage.
 *
 * Sampled at a fixed stride rather than per edge, so one long edge and twenty short ones
 * digitizing the same line give the same answer. */
function abutFraction(points, run, streets, tolFt, ccw) {
  if (!streets.length) return 0;
  const n = points.length;
  const STRIDE_FT = 25;
  let near = 0, total = 0;
  for (const e of run.edges) {
    const a = points[e], b = points[(e + 1) % n];
    const l = hyp(b.x - a.x, b.y - a.y);
    if (!(l > 0)) continue;
    total += l;
    const nrm = outwardNormal(a, b, ccw);
    if (!nrm) continue;
    const steps = Math.max(1, Math.ceil(l / STRIDE_FT));
    for (let k = 0; k < steps; k++) {
      const t = (k + 0.5) / steps;
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const { point, dist } = nearestOnPolylines(m, streets);
      if (!point || dist > tolFt) continue;
      const vx = point.x - m.x, vy = point.y - m.y;
      const vl = hyp(vx, vy);
      // Dead on the line counts (a lot line drawn along the centerline of its road).
      if (vl === 0 || (vx / vl) * nrm.x + (vy / vl) * nrm.y >= 0.5) near += l / steps;
    }
  }
  return total > 0 ? near / total : 0;
}

/**
 * Auto-assign a role to EVERY edge of a parcel.
 *
 * @param points   ring of {x,y} (open ring, planner feet)
 * @param opts     { streets = [], streetAbutFt = STREET_ABUT_FT }
 *                 `streets` is an array of road centerline polylines ([{x,y}…]) in the SAME feet
 *                 frame, already filtered by the caller to roads that lie outside the lot. Pass
 *                 none and the front falls back to the longest run.
 * @returns an array of role ids, one per edge (never null — an unclassified edge is "side").
 */
export function autoAssignRoles(points, opts = {}) {
  const n = points ? points.length : 0;
  const roles = new Array(Math.max(0, n)).fill("side");
  if (n < 3) return roles;

  const runs = roleRuns(points);
  if (!runs.length) return roles;
  const facts = runFacts(points, runs);
  const streets = (opts.streets || []).filter((s) => Array.isArray(s) && s.length >= 2);
  const tolFt = Number.isFinite(opts.streetAbutFt) ? opts.streetAbutFt : STREET_ABUT_FT;

  // 1 — street abutment.
  const ccw = signedArea(points) > 0;
  const abuts = facts.map((f) => abutFraction(points, f.run, streets, tolFt, ccw) >= ABUT_FRACTION);
  const anyAbut = abuts.some(Boolean);

  // 2 — front: the longest abutting run, or the longest run overall when no road is on the plan.
  let frontIdx = 0;
  let bestLen = -1;
  facts.forEach((f, i) => {
    if (anyAbut && !abuts[i]) return;
    if (f.lengthFt > bestLen) { bestLen = f.lengthFt; frontIdx = i; }
  });
  const nf = facts[frontIdx].normal;
  const depth = (f) => f.centroid.x * nf.x + f.centroid.y * nf.y;
  const depths = facts.map(depth);
  const extent = Math.max(...depths) - Math.min(...depths);
  const frontDepth = depths[frontIdx];

  const out = facts.map((f, i) => {
    if (i === frontIdx) return "front";
    const dot = f.normal.x * nf.x + f.normal.y * nf.y;
    // 2b — the same frontage, broken into two runs by a jog: same facing, same depth.
    if (dot >= FRONT_ALIGN_DOT && (extent <= 0 || Math.abs(depths[i] - frontDepth) <= FRONT_DEPTH_TOL * extent)) return "front";
    // 3 — corner-lot street frontage. Only ever from real road geometry.
    if (abuts[i]) return "street";
    // 4 — the side opposite the front.
    if (dot <= REAR_DOT) return "rear";
    return "side";                                                  // 5
  });

  runs.forEach((run, i) => { for (const e of run.edges) roles[e] = out[i]; });
  return roles;
}

/**
 * NEW-6 — the per-run role OVERRIDE vector in force.
 *
 * The automatic assignment above is a good default and it is frequently wrong in the real world:
 * a corner lot, a flag lot, a double-frontage lot, or simply a reviewer who reads the plat
 * differently (owner, 2026-07-30: "what if their interpretation of the setbacks is different from
 * your interpretation"). Being wrong changes the required dimension, so the user must be able to
 * correct it — and the correction must then be KEPT, not quietly re-derived away.
 *
 * The model is the repo's established derive-by-default / preserve-once-touched pattern (dog-ears,
 * side parking, trailer length): the override vector is SPARSE. `null` at an edge means "keep
 * tracking the automatic inference"; a role means "the user said so". That is the whole difference
 * from the dense `pc.roles` array this replaces — writing one run's role used to stamp EVERY edge
 * with whatever it happened to infer at that moment, freezing the other fourteen sides against
 * every later re-derivation.
 *
 * Legacy plans are migrated in place, without changing a pixel: a dense `pc.roles` array is
 * narrowed to the entries that actually DIFFER from the automatic assignment. An entry equal to
 * auto is a no-op either way, so the rendered roles are identical — but everything the user never
 * actually corrected goes back to tracking the inference.
 *
 * Alignment: an override vector is honoured only when it matches the ring, exactly like
 * `pc.setbacks`. The two in-place reshapes that change the ring length (insert / delete a control
 * point) remap it through `shiftOverridesOnInsert` / `shiftOverridesOnDelete`, so the common
 * reshape — including simply dragging a corner, which never changes the length — keeps the
 * override rather than silently resetting it.
 */
export function resolveOverrides(points, { overrides = null, legacy = null, auto = null } = {}, opts = {}) {
  const n = points ? points.length : 0;
  const out = new Array(Math.max(0, n)).fill(null);
  if (n === 0) return out;
  if (Array.isArray(overrides) && overrides.length === n) {
    for (let i = 0; i < n; i++) if (isRole(overrides[i])) out[i] = overrides[i];
    return out;
  }
  if (Array.isArray(legacy) && legacy.length === n) {
    const base = Array.isArray(auto) && auto.length === n ? auto : autoAssignRoles(points, opts);
    for (let i = 0; i < n; i++) if (isRole(legacy[i]) && legacy[i] !== base[i]) out[i] = legacy[i];
  }
  return out;
}

/**
 * The roles actually in force: the auto assignment, with the user's own overrides on top.
 *
 * `stored` is the LEGACY dense `pc.roles`; `opts.overrides` is the sparse `pc.roleOverrides` that
 * supersedes it (see `resolveOverrides`). Both are only honoured when aligned to the ring.
 */
export function resolveRoles(points, stored, opts = {}) {
  const auto = autoAssignRoles(points, opts);
  const ov = resolveOverrides(points, { overrides: opts.overrides, legacy: stored, auto }, opts);
  return auto.map((r, i) => (isRole(ov[i]) ? ov[i] : r));
}

/** Is this run's role a user override rather than the app's inference? */
export const runOverridden = (run, overrides) =>
  !!(run && Array.isArray(overrides) && run.edges.some((e) => isRole(overrides[e])));

/**
 * Set — or CLEAR — a whole run's role override. `role === null` clears it back to automatic.
 * Returns a NEW sparse vector; the input is untouched. Every edge in the run moves together, so
 * a run can never end up internally inconsistent with the label it displays.
 */
export function setRunOverride(overrides, run, role, edgeCount) {
  const len = Number.isFinite(edgeCount) ? edgeCount : (overrides || []).length;
  const next = Array.from({ length: len }, (_, i) => (isRole(overrides?.[i]) ? overrides[i] : null));
  if (!run) return next;
  for (const e of run.edges) if (e >= 0 && e < len) next[e] = isRole(role) ? role : null;
  return next;
}

/** Does the parcel carry ANY role override at all? (Drives the "reset to automatic" affordance.) */
export const hasRoleOverrides = (overrides) => (overrides || []).some((r) => isRole(r));

/* Reshape remaps — keep the sparse vector aligned to the ring across the two edits that change
 * its length, so a correction survives a reshape instead of being dropped on alignment.
 *
 * INSERT: a control point dropped on edge `edgeIndex` splits it into two edges that occupy slots
 * `edgeIndex` and `edgeIndex + 1`. Both halves are still the same side, so both inherit the role.
 * DELETE: removing vertex `index` merges edges `index - 1` and `index` into one, which lands in
 * slot `index - 1` and keeps the first half's role — i.e. drop slot `index`. */
export function shiftOverridesOnInsert(overrides, edgeIndex) {
  if (!Array.isArray(overrides)) return overrides;
  const next = overrides.slice();
  const at = Math.max(0, Math.min(overrides.length - 1, edgeIndex));
  next.splice(at + 1, 0, isRole(overrides[at]) ? overrides[at] : null);
  return next;
}

export function shiftOverridesOnDelete(overrides, index) {
  if (!Array.isArray(overrides)) return overrides;
  return overrides.filter((_, j) => j !== index);
}

/* A run's role is its ANCHOR edge's role — the anchor is the longest edge in the run, the one
 * whose midpoint carries the chip, so the label on the map and the row in the panel agree. */
export function runRole(run, edgeRoles) {
  const r = run && Array.isArray(edgeRoles) ? edgeRoles[run.anchorEdge] : null;
  return isRole(r) ? r : "side";
}

/* Reassign a whole run — every edge in it takes the role, so the run cannot end up internally
 * inconsistent with the label it displays. Returns a NEW array; the input is untouched. */
export function setRunRole(edgeRoles, run, role, edgeCount) {
  const len = Number.isFinite(edgeCount) ? edgeCount : (edgeRoles || []).length;
  const next = Array.from({ length: len }, (_, i) => (isRole(edgeRoles?.[i]) ? edgeRoles[i] : "side"));
  if (!run || !isRole(role)) return next;
  for (const e of run.edges) if (e >= 0 && e < len) next[e] = role;
  return next;
}

/**
 * The four ordinance rows.
 *
 * @param runs       the parcel's labelled runs (`setbackChipRuns` output — the value-aware ones
 *                   the panel and the chips already share)
 * @param edgeRoles  per-edge roles in force (`resolveRoles`)
 * @param sb         per-edge setback array
 * @returns one entry per role in SETBACK_ROLES order:
 *          { role, label, runs, edges, sides, value, mixed, empty }
 *          `value` is the setback shared by the role's edges (or the first one when they differ,
 *          in which case `mixed` is true); `empty` means no side currently carries the role.
 */
export function roleGroups(runs, edgeRoles, sb, eps = 0.05) {
  const list = runs || [];
  return SETBACK_ROLES.map((role) => {
    const mine = list.filter((run) => runRole(run, edgeRoles) === role);
    const edges = mine.flatMap((run) => run.edges);
    const first = edges.length ? num(sb?.[edges[0]]) : null;
    const mixed = edges.length > 0 && !edges.every((i) => Math.abs(num(sb?.[i]) - first) <= eps);
    return {
      role,
      label: ROLE_LABEL[role],
      runs: mine,
      edges,
      sides: mine.length,
      value: first,
      mixed,
      empty: edges.length === 0,
    };
  });
}
