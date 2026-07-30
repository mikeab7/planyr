/* The Site Model — ONE canonical schema for a site/plan: the source of truth the
 * whole app reads from and writes to. See CLAUDE.md "## Site Model" for the spec.
 *
 * Design (Option A): the PERSISTED record keeps its existing flat, back-compatible
 * field names (parcels, els, markups, measures, callouts, settings, underlay,
 * origin, county) so every saved localStorage site keeps working untouched. This
 * module gives that shape a NAME, a VERSION, an additive MIGRATION, and SELECTORS
 * that classify the flat arrays into semantic buckets — constraints, utilities,
 * elevation, annotations — so the pages, tools, and a future buildable-area / cost
 * synthesis can all read from one place instead of re-deriving it ad hoc.
 *
 * The drawn collections stay `els` (layout elements) and `markups` (a mix of
 * neutral annotations + semantic shapes). Rather than physically splitting them
 * (a riskier canvas rewrite, deferred), the selectors below classify markups by
 * `kind` into their semantic meaning.
 */

import { dogEarGeom, dogEarSize, isDogEarSide,
  wallStripBox, wallKidBox, wallKidAlong, hostAxisExtents, ownExtents, bumpsOfHost,
  sideOfBondedBox, localToWorld } from "./dogEar.js";
import { layoutZoneByKind, boxExtentAlong, zoneAlongExtent, zoneDepthExtent, alongLenIsChainEcho } from "./dockZones.js";
import { roadCenterline, dedupeRoadVertices, repairBakedRadii, simplifyRoadVertices, ROAD_SIMPLIFY_TOL_FT, ROAD_VERTEX_COLLAPSE_FT } from "./roadGeometry.js";
import { bufferPolyline } from "./metesAndBounds.js";
import { DEFAULT_ROAD_CLASS, roadClassOf } from "./roadClasses.js";
import { ensureZ } from "./zOrder.js";

// v12 (B671): every drawn element carries an explicit `z` — the within-type-layer stacking
// tiebreak that used to be IMPLICIT array position (see planStyle.byZ). `ensureZ` assigns a gapped
// z (idx*Z_GAP, matching the site_elements SQL backfill) to any collection MISSING it, and returns
// the same reference untouched when every element already has a distinct z — so a re-load of
// already-migrated data churns nothing (no new objects, no spurious version bump). The array is
// left in place (not reordered): render/hit-test read order from byZ (type layer, then z), and
// leaving order alone keeps element object identity and the fixtures stable.

export const SITE_MODEL_VERSION = 12;

// Markup `kind`s grouped by what they MEAN (used by the selectors).
export const EASEMENT_KINDS = ["encumbrance", "easement"];        // title metes-and-bounds tracts/corridors + first-class easement objects (NEW-1)
export const UTILITY_KINDS = ["utilRoute", "traced", "infwater"]; // service routes, traced overhead lines, inferred mains
export const ANNOTATION_KINDS = ["line", "polyline", "rect", "ellipse", "polygon"]; // neutral drawing markups

/* Project lifecycle status — the deal stage of a site, shown on the map markers.
 * Ordered pursuit → active → onhold → complete → dead (deal funnel order). New
 * sites default to "pursuit"; pre-feature records (no status) migrate to "active"
 * (they predate the field and are presumed live). `STATUSES` is the ordered key
 * list; `STATUS_META` carries the label used across the UI (legend/menu/counts). */
export const STATUSES = ["pursuit", "active", "onhold", "complete", "dead"];
export const STATUS_META = {
  pursuit: { label: "Pursuit" },
  active: { label: "Active" },
  onhold: { label: "On Hold" },
  complete: { label: "Complete" },
  dead: { label: "Dead" },
};
const DEFAULT_STATUS = "pursuit";       // a brand-new site
const LEGACY_STATUS = "active";          // pre-feature records (no status yet)
const normStatus = (s, fallback) => (STATUSES.includes(s) ? s : fallback);
// A record already stamped with an older schemaVersion predates the status feature,
// so a record with NO explicit status is presumed live → "active". Records v3+ carry
// an explicit status, so the version bump (→6 B276 delete-tombstones, →7 B362/B363
// bump-out sizing + bonded-rotation repair, →8 team sharing teamId/ownerId, →9 cross-module
// schedule link hint scheduleProjectId/Name, →10 centerline road model B596 pts/vtx/
// travelW/roadClass, →11 parcel split lineage `parentId` B651) doesn't disturb it. (saveSite re-normalizes
// through this, so the status it reads back is the explicit one when a status was passed in.)
const isLegacyRecord = (p) => typeof p.schemaVersion === "number" && p.schemaVersion < SITE_MODEL_VERSION;
// Type-confusion guards: a tampered/legacy/bad-sync record can carry a non-array where an array is
// expected (e.g. `parcels` as a string), which then throws on `.reduce`/`.map` and blanks the app.
// Coerce every collection so one malformed record can't crash the planner on load.
const arr = (v) => (Array.isArray(v) ? v : []);
// Collection entries must be objects. A null entry (JSON.stringify turns an undefined entry or an
// array hole into null) used to survive normalization and then either crash a migration pass
// (null.attachedTo) or get spread by normalizeZ into a `{z}` husk that crashed every points-reader
// (the husk-parcel crash — the planner error-boundaried on EVERY load once one null was persisted).
// Reference-stable: returns the input array untouched when it's already clean, so an unchanged
// record never churns React state or re-triggers a save.
const isEntry = (el) => !!el && typeof el === "object" && !Array.isArray(el);
const objArr = (v) => {
  const a = arr(v);
  for (const el of a) if (!isEntry(el)) return a.filter(isEntry);
  return a;
};
// A parcel is GEOMETRY — one with no usable `points` array is unrenderable, unselectable dead
// weight that crashes acreage/canvas math (there is no legitimate points-less parcel: every
// creation path — map hand-off, in-planner draw, split — is born with points). Drop them here at
// the one funnel every load/save/merge passes through; dropping BEFORE the cross-copy union also
// lets a sibling copy's healthy same-id parcel win the merge instead of being shadowed by a husk.
const validParcel = (pc) => Array.isArray(pc.points) && pc.points.length > 0;
const parcelArr = (v) => {
  const a = objArr(v);
  for (const pc of a) if (!validParcel(pc)) return a.filter(validParcel);
  return a;
};
// LOUD-FAILURE hook: how many entries the funnel above would drop from a RAW record — callers
// that read persisted stores (loadSitesList/loadSite) report a nonzero count as a telemetry
// event, so sanitization is a visible signal, never a silent data edit.
export function countJunkEntries(p) {
  if (!p || typeof p !== "object") return 0;
  let n = 0;
  for (const f of ["els", "markups", "measures", "callouts", "sheetOverlays", "parcelDrawings"])
    for (const el of arr(p[f])) if (!isEntry(el)) n++;
  for (const pc of arr(p.parcels)) if (!isEntry(pc) || !validParcel(pc)) n++;
  for (const cs of arr(p.elevation && p.elevation.crossSections)) if (!isEntry(cs)) n++;
  return n;
}

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

// NEW-1 — per-site GIS Layers-panel toggle memory: a sparse `{ layerKey: boolean }` map of overlay
// layers the user toggled AWAY from their default on/off (see lib/layerPrefs.js). Kept light HERE
// (no layer-registry import — siteModel stays DOM/deps-free for the Node tests): coerce to booleans
// only. The planner ignores any key not in the current registry on apply, and a later toggle rewrites
// the map from the live registry, so a stale key can't render and self-prunes. Reference-stable when
// already clean, so an unchanged record never churns.
const layerOverridesObj = (v) => {
  const src = obj(v);
  let changed = false;
  const out = {};
  for (const [k, on] of Object.entries(src)) {
    if (typeof on === "boolean") out[k] = on; else changed = true;
  }
  return changed ? out : src;
};

// B682 — every parcel MUST carry a stable `id`. The map-finder hand-off (MapFinder.computeAssembly)
// and legacy saved sites can hold id-LESS parcels ({points, addr, acct, attrs} with no id). Two bugs
// flow from that. (1) The acreage-chip drag matches parcels by `pc.id === draggedId`; with both
// undefined it moves EVERY id-less parcel at once. (2) Worse, the cross-copy union merge
// (mergeSiteContent → unionById) can only dedupe id-less items by JSON value, so the instant a drag
// adds a `labelOffset` the edited copy no longer equals its stored twin and the union keeps BOTH — a
// phantom parcel that MULTIPLIES with each further drag (the owner's "moved the 69.48 ac label and it
// made a bunch of copies"). Fix at the one funnel every load/save/merge passes through: backfill a
// DETERMINISTIC id derived from the parcel GEOMETRY only, so the same parcel hashes identically before
// and after any mutable-field edit (labelOffset / active / locked / setbacks) and the union dedupes it
// by id; two genuinely-distinct parcels differ in points → distinct ids. Only a MISSING id is filled
// (parcels drawn/imported in-planner already carry a unique uid()), so it's additive + idempotent and
// never rewrites an existing id. Exact-geometry id-less duplicates collapse to one — which also HEALS
// the phantom copies this bug already persisted, on the very next load.
const hashPoints = (pts) => {
  let h = 5381 >>> 0; // djb2-xor over rounded coords; stability (same points → same hash) is what matters
  for (const p of pts) {
    const x = p && typeof p.x === "number" && Number.isFinite(p.x) ? p.x : 0;
    const y = p && typeof p.y === "number" && Number.isFinite(p.y) ? p.y : 0;
    h = (((h << 5) + h) ^ (Math.round(x * 1000) | 0)) >>> 0; // 1e-3 ft rounding kills float re-projection noise
    h = (((h << 5) + h) ^ (Math.round(y * 1000) | 0)) >>> 0;
  }
  return h.toString(36);
};
const withStableParcelIds = (list) => {
  let changed = false;
  const seen = new Set();
  const out = [];
  for (const pc of list) {
    if (pc && pc.id == null && Array.isArray(pc.points) && pc.points.length) {
      const id = `pcg_${pc.points.length}_${hashPoints(pc.points)}`;
      changed = true;
      if (seen.has(id)) continue; // exact-geometry duplicate of an already-kept id-less parcel → drop (heals prior phantom copies)
      seen.add(id);
      out.push({ ...pc, id });
    } else {
      out.push(pc);
    }
  }
  return changed ? out : list; // reference-stable when nothing was id-less (no churn on already-migrated data)
};
// B559: coerce a timestamp to milliseconds for comparison. `updatedAt` is normally a number
// (Date.now()), but createSiteModel keeps whatever it's given (p.updatedAt || Date.now()), so an
// imported/legacy record can carry an ISO STRING — and `"2025-…" >= 1718…` is a silent false,
// which would pick the OLDER copy as "newer" in a merge (data loss) or skip a legacy-prune.
export const toMs = (v) => (typeof v === "string" ? (Date.parse(v) || 0) : (v || 0));
// Cap on retained delete-tombstones (B276). Each is just an id string, so this is generous
// headroom — a real plan deletes a handful of items, never thousands.
const MAX_TOMBSTONES = 5000;

/* ---- Bonded-child rotation invariant (B363) + dog-ear edge re-anchor (NEW-6) ----
 * Every box element bonded to a host building (`attachedTo` set) is axis-aligned to that
 * host at a FIXED quarter-turn offset (0/90/180/270): sidewalks, truck courts, and corner
 * bump-outs share the host's angle; side-parking rows and wall trailers sit at a +90/180/270
 * turn. So a bonded child's angle is a DERIVED value — host.rot + its quarter-turn offset —
 * never an independent one. If a child's stored angle has drifted off that (the host was
 * re-angled by a path that didn't carry the child — e.g. Jacintoport: host 0°, all four
 * children 359.035°), it is repaired below.
 *
 * A corner bump-out (`dogEar`) is bound even tighter: BOTH its angle AND its POSITION are
 * derived — it must sit flush at the host's CURRENT corner from its {side, sign}. The B363
 * rotation repair fixes angle drift but not a host that was RESIZED after the bump was placed,
 * so a bump on a since-widened host straddled the OLD edge (Jacintoport Building 1: host
 * widened ~27′; its truck court re-anchored but the bumps were skipped, leaving ~13.5′ of each
 * bump INSIDE the building). The dog-ear branch re-derives the whole box via dogEarGeom against
 * the host's current footprint so the record self-heals on load. dogEarGeom IS the placement
 * function, so a correctly-anchored bump re-derives to itself (idempotent, no churn). */
const norm360 = (a) => ((a % 360) + 360) % 360;
// The quarter turn (0/90/180/270) a child sits at relative to its host — its fixed offset
// with any sub-90° drift rounded away.
export const quarterOffset = (childRot, hostRot) => norm360(Math.round(norm360(childRot - hostRot) / 90) * 90);
// The angle a bonded child SHOULD have: host angle + its quarter-turn offset.
export const bondedChildRot = (childRot, hostRot) => norm360(hostRot + quarterOffset(childRot, hostRot));

// One-time repair: re-anchor any drifted bonded child to its host's CURRENT frame. A child
// placed when the host was at angle θ keeps θ in both its angle and its position; if the host
// later moved to host.rot without carrying the child, BOTH are stale by the same delta. So we
// rotate the child's centre about the host centre by that delta AND snap its angle to
// host.rot + offset. Idempotent (a correctly-bonded child re-anchors to itself, delta 0) and
// safe — a bonded box child is only ever at a quarter turn, so any other angle is drift, not
// intent. Points-based children carry geometry in their points (no single rot/centre) → skipped.
function normalizeBondedRotations(list) {
  const els = arr(list);
  if (els.length < 2) return els;
  const byId = new Map();
  for (const e of els) if (e && e.id != null) byId.set(e.id, e);
  let changed = false;
  const out = els.map((e) => {
    if (!e || e.attachedTo == null || e.points ||
        typeof e.rot !== "number" || typeof e.cx !== "number" || typeof e.cy !== "number") return e;
    const host = byId.get(e.attachedTo);
    if (!host || host.points ||
        typeof host.rot !== "number" || typeof host.cx !== "number" || typeof host.cy !== "number") return e;
    // Corner bump-out (dog-ear): re-flush its WHOLE box to the host's CURRENT edge + angle
    // (NEW-6). Guard the side (a malformed `side` would throw in dogEarGeom's SIDE_N destructure
    // and blank the planner) and require finite host/child w·h (dogEarGeom reads them; a NaN box
    // would never compare equal → churn every load). The stored span (along/proj) is honored when
    // the tag carries it (preserving a user resize + its clamp/spring-back); a bare tag recovers
    // its current rendered size from the box so ONLY the position moves — recovery stays LOCAL to
    // `desc`, the tag is never rewritten (a bare tag stays bare, so a box clamped at save time can
    // still spring back later). Tolerance compare returns the SAME object when nothing moves.
    if (e.dogEar && isDogEarSide(e.dogEar.side) &&
        Number.isFinite(host.w) && Number.isFinite(host.h) &&
        Number.isFinite(e.w) && Number.isFinite(e.h)) {
      const de = e.dogEar;
      const desc = de.along != null && de.proj != null ? de : { ...de, ...dogEarSize(de, e.w, e.h) };
      const g = dogEarGeom(host, desc);
      const near = (a, b) => Math.abs(a - b) <= 1e-6;
      if (near(g.cx, e.cx) && near(g.cy, e.cy) && near(g.w, e.w) && near(g.h, e.h) &&
          near(norm360(g.rot), norm360(e.rot))) return e;
      changed = true;
      return { ...e, cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot };
    }
    const offset = quarterOffset(e.rot, host.rot);
    const wantRot = norm360(host.rot + offset);
    // delta = how far the host has moved since the child was placed (the stale skew), as a
    // signed angle in (−180, 180].
    const delta = ((norm360(host.rot - norm360(e.rot - offset)) + 180) % 360) - 180;
    if (Math.abs(delta) < 1e-6) {
      if (Math.abs(norm360(e.rot) - wantRot) < 1e-6) return e;
      changed = true;
      return { ...e, rot: wantRot };
    }
    const rad = (delta * Math.PI) / 180, cs = Math.cos(rad), sn = Math.sin(rad);
    const dx = e.cx - host.cx, dy = e.cy - host.cy;
    changed = true;
    return { ...e, cx: host.cx + dx * cs - dy * sn, cy: host.cy + dx * sn + dy * cs, rot: wantRot };
  });
  return changed ? out : els;
}

// One-time repair: snap any drifted dog-ear child to its host's CURRENT box (B487).
// The correct position/size of a corner bump-out is a PURE function of the host box + its
// `{side, sign, along, proj}` tag — `dogEarGeom(host, dogEar)`. The runtime resize path already
// calls this on every host resize (SitePlanner.refitChildren), but a legacy record whose host was
// widened via a path that missed refitChildren keeps its dog-ears at the OLD edge → they orphan
// into the truck-court band (real Jacintoport bug, 2026-06-26 Cowork audit). We snap them back at
// load-time; idempotent (a correctly-anchored dog-ear re-anchors to itself with no change). Only
// touches children with a `dogEar` tag; leaves everything else alone.
function normalizeDogEarPositions(list, onHeal) {
  const els = arr(list);
  if (els.length < 2) return els;
  const byId = new Map();
  for (const e of els) if (e && e.id != null) byId.set(e.id, e);
  let changed = false;
  const out = els.map((e) => {
    if (!e || !e.dogEar || e.attachedTo == null) return e;
    // Crash-safety: a malformed `side` would blow up dogEarGeom's SIDE_N[side] destructure and blank the
    // planner on load. Skip such records (they fall through to the rotation pass and stay as stored).
    if (!isDogEarSide(e.dogEar.side)) return e;
    const host = byId.get(e.attachedTo);
    if (!host || typeof host.cx !== "number" || typeof host.cy !== "number" ||
        typeof host.w !== "number" || typeof host.h !== "number") return e;
    const g = dogEarGeom(host, e.dogEar);
    if (Math.abs((e.cx || 0) - g.cx) < 1e-6 && Math.abs((e.cy || 0) - g.cy) < 1e-6 &&
        Math.abs((e.w || 0) - g.w) < 1e-6 && Math.abs((e.h || 0) - g.h) < 1e-6) return e;
    changed = true;
    if (onHeal) onHeal({ id: e.id, host: host.id, kind: "dog-ear", type: e.type, from: { cx: e.cx, cy: e.cy }, to: { cx: g.cx, cy: g.cy } });
    return { ...e, cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot };
  });
  return changed ? out : els;
}

/* One-time repair: re-flush a building's WALL-HUGGING children — sidewalk / landscape strips and
 * side-parking rows — to the host's CURRENT footprint (NEW-2 / NEW-3). Same shape and the same
 * idempotency contract as the dog-ear pass above, and the same reason: the runtime now derives
 * these on every host geometry change, but a record written BEFORE that fix carries the drift on
 * disk, so it would keep rendering wrong until something happened to be resized.
 *
 * The two axes are healed differently, deliberately (owner rule + owner amendment):
 *   • A wall STRIP is fully derived — it spans exactly the extended side (building depth + the
 *     projection of any corner bump-out that lengthens that wall), centred on that span, flush to
 *     the wall. The span rule is absolute, so this is a pure function of the host + its bumps.
 *   • A SIDE-PARKING row is healed ONLY on the perpendicular axis — pulled flush against the
 *     sidewalk on its side (or the wall when there is none). Its position and run ALONG the wall
 *     are user intent (the owner slides a field to get a curb return right where a drive ties in)
 *     and are never normalised here.
 * Only touches children of a real building host; a stack member (truck court / trailer / buffer /
 * appended "Add layer" zone, all `noFit`) is positioned by its own layout and is left alone. */
const WALL_STRIP_TYPES = new Set(["sidewalk", "landscape"]);
const isStackMember = (e) => !!(e.noFit || e.truckCourt || e.forCourt || e.forTrailer || e.prevZone);
function normalizeWallKids(list, onHeal) {
  const els = arr(list);
  if (els.length < 2) return els;
  const byId = new Map();
  for (const e of els) if (e && e.id != null) byId.set(e.id, e);
  const finiteBox = (o) => o && ["cx", "cy", "w", "h"].every((k) => Number.isFinite(o[k]));
  // The building host a wall kid hangs off, or null if it isn't one.
  const hostOf = (e) => {
    if (!e || e.points || e.attachedTo == null || isStackMember(e) || !finiteBox(e)) return null;
    const isStrip = WALL_STRIP_TYPES.has(e.type), isPark = !!e.sideParkSide;
    if (!isStrip && !isPark) return null;
    const host = byId.get(e.attachedTo);
    return host && host.type === "building" && !host.dogEar && !host.points && finiteBox(host) ? host : null;
  };
  const sideOf = (host, e) => (e.sideParkSide || e.sidewalkSide || sideOfBondedBox(host, e));
  // The strip a parking row on `side` of `host` has to clear (first one wins, as on the canvas).
  const stripFor = (host, side) => els.find((x) => {
    const h = hostOf(x);
    return h && h.id === host.id && WALL_STRIP_TYPES.has(x.type) && sideOf(h, x) === side;
  });
  let changed = false;
  const out = els.map((e) => {
    const host = hostOf(e);
    if (!host) return e;
    const side = sideOf(host, e);
    const { cross, dimBX, dimBY } = hostAxisExtents(host, e);
    const isVert = side === "left" || side === "right";
    const depth = isVert ? dimBX : dimBY;
    let box;
    if (WALL_STRIP_TYPES.has(e.type)) {
      box = wallStripBox(host, side, bumpsOfHost(els, host), depth);
    } else {
      const strip = stripFor(host, side);
      const gap = strip ? (isVert ? hostAxisExtents(host, strip).dimBX : hostAxisExtents(host, strip).dimBY) : 0;
      const cur = wallKidAlong(host, side, e);            // along-wall position + run kept verbatim
      // NEW-4 — …unless the row has been TORN off its host (a parking field left behind when its
      // building's move committed in a separate transaction). The owner's along-wall placement is
      // intent worth preserving only while the row still OVERLAPS the wall it is bonded to; past
      // that the number is wreckage, so the re-fit re-centres it. NEW-2: the bound is the COMPUTED
      // overlap limit, not an absolute distance — a 200 ft displacement is every bit as impossible
      // as a 2,000 ft one, and the old magnitude test let the smaller one through.
      const alongLimit = (isVert ? host.h : host.w) / 2 + (Number(cur.run) || 0) / 2;
      const alongShift = Math.abs(cur.alongShift) > alongLimit ? 0 : cur.alongShift;
      box = wallKidBox(host, side, { depth, gap, run: cur.run, alongShift });
    }
    const c = localToWorld(host, box.lx, box.ly);
    const g = { cx: c.x, cy: c.y, ...ownExtents(cross, box.dimBX, box.dimBY) };
    const near = (a, b) => Math.abs(a - b) <= 1e-6;
    if (near(e.cx, g.cx) && near(e.cy, g.cy) && near(e.w, g.w) && near(e.h, g.h)) return e;
    changed = true;
    if (onHeal) onHeal({ id: e.id, host: host.id, kind: WALL_STRIP_TYPES.has(e.type) ? "wall-strip" : "side-parking", type: e.type, side, from: { cx: e.cx, cy: e.cy }, to: { cx: g.cx, cy: g.cy } });
    return { ...e, ...g };
  });
  return changed ? out : els;
}

/* ---- NEW-4: heal a bonded child that has been TORN AWAY from its host ---------------------
 * The three passes above re-derive a child that has DRIFTED — a stale angle, an old edge, a host
 * resized behind its back. None of them can see a child that is simply somewhere ELSE: the write
 * path was able to commit a host's move in one transaction and part of its bonded assembly in
 * another (NEW-1), leaving the building ~2,000 ft from its own truck court — an empty drive loop
 * with orphaned dock squares where it used to be. That state survived every reload, because the
 * `site_elements` read path healed nothing (NEW-4).
 *
 * "Impossible for its kind" is MEASURED, never guessed. A dock-stack member (truck court →
 * trailer parking → buffer → any appended layer) sits flush OUTWARD from its host's wall, so its
 * centre can never be further from the host centre than
 *     host half-diagonal + the whole chain's depth + its own half-diagonal + slack
 * and a wall kid can never be further than host half-diagonal + its own half-diagonal + slack.
 * Past THAT is a tear, not a placement. Only members past the reach are re-fitted (through the
 * same pure `layoutZoneByKind` the canvas lays the stack out with); everything inside it is
 * returned BY IDENTITY, so a correct record churns nothing — the idempotency contract B499 asks
 * for, and the reason this can run on every load and every refetch. */
// Generous: the reach below is already the maximum geometrically legal separation, so the slack
// only has to swallow rounding + a hand-nudged zone. A real tear is orders of magnitude past it.
const STRAND_SLACK_FT = 100;
/* NEW-2 — the ABSOLUTE-distance test above is a blunt fallback, and it let a real tear through: an
 * apron 218 ft off its host's centreline and its trailer strip 218 ft west / 223 ft north both
 * loaded and rendered unhealed, because a big building's own half-diagonal plus the chain depth
 * plus the slack is comfortably more than 300 ft. The V508 case that PASSED used 2,086 ft, so the
 * threshold sat somewhere between — which is the tell that magnitude is the wrong question.
 *
 * A bond's legal position is COMPUTABLE, so compare against the computed anchor instead, and the
 * magnitude stops mattering:
 *   • ACROSS the wall (the outward normal) a stack member's offset is fully determined —
 *     host_depth/2 + the depths of everything inboard of it + its own depth/2. There is no user
 *     freedom on this axis at all, so any error beyond a small tolerance is a tear.
 *   • ALONG the wall there IS user freedom (the owner slides a field to line up a curb return —
 *     B1039), but it is bounded: the member must still OVERLAP the wall it is bonded to.
 * Tolerance is generous enough to absorb stored rounding and a legacy record's sub-foot drift, and
 * far tighter than any real displacement. */
const ANCHOR_TOL_FT = 10;
/** Is a bonded child off its COMPUTED anchor? `across` is the signed outward-normal offset it has
 *  vs. the one its bond dictates; `along`/`alongLimit` bound its slide to the wall. Pure. */
export function offAnchor({ acrossHave, acrossWant, alongHave, alongLimit, tol = ANCHOR_TOL_FT }) {
  if (![acrossHave, acrossWant].every((v) => Number.isFinite(v))) return false; // nothing to compare → never claim a tear
  if (Math.abs(acrossHave - acrossWant) > tol) return true;
  if (Number.isFinite(alongHave) && Number.isFinite(alongLimit) && Math.abs(alongHave) > alongLimit) return true;
  return false;
}
const halfDiagOf = (b) => Math.hypot(Number(b && b.w) || 0, Number(b && b.h) || 0) / 2;
/** Is `child` further from `host` than its bond could ever legally put it? `extraReach` is the
 *  kind-specific allowance (a dock stack's cumulative depth); pure + exported for the tests. */
export function strandedFromHost(host, child, extraReach = 0) {
  if (!host || !child) return false;
  const pts = [host.cx, host.cy, child.cx, child.cy];
  if (!pts.every((v) => Number.isFinite(v))) return false; // no centre to reason about → never claim a tear
  const reach = halfDiagOf(host) + halfDiagOf(child) + (Number(extraReach) || 0) + STRAND_SLACK_FT;
  return Math.hypot(child.cx - host.cx, child.cy - host.cy) > reach;
}

const rot2d = (x, y, deg) => {
  const r = ((deg || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};
const SIDE_NORMAL = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const finiteBoxEl = (o) => o && ["cx", "cy", "w", "h"].every((k) => Number.isFinite(o[k]));

// Re-fit every dock-stack member that has been torn off its host. Walks each host's per-side
// chain exactly as the canvas does (`prevZone` first, falling back to the legacy forCourt /
// forTrailer bonds), re-derives the chain's geometry from the members' OWN stored depths, and
// writes back ONLY the stranded ones. `onHeal` receives one record per re-fitted element.
function normalizeStrandedZones(list, onHeal) {
  const els = arr(list);
  if (els.length < 2) return els;
  const patch = new Map();
  const nextInChain = (el) => els.find((x) => x && !x.points && !patch.has(x.id) && (
    x.prevZone === el.id ||
    (el.truckCourt && x.forCourt === el.id) ||
    (el.type === "trailer" && x.forTrailer === el.id))) || null;

  for (const host of els) {
    if (!host || host.type !== "building" || host.dogEar || !finiteBoxEl(host)) continue;
    // NEW-2 (round 4) — every stack-like bonded child of this host, not just ones heading a
    // recognised dock chain. The reported tear translated ALL eleven children of an 882×510
    // building and survived a reload: the coarse `strandedFromHost` reach is
    // `halfDiag(host) + halfDiag(child) + …`, and that host's half-diagonal ALONE is over 500 ft —
    // so the bigger the building, the bigger the tear it tolerates, which is backwards. The
    // COMPUTED anchor below does not scale with host size, so it is now the primary test, and a
    // stack member belonging to no chain is walked as a chain of ONE rooted at its own side
    // instead of being skipped entirely.
    const heads = els.filter((x) => x && x.attachedTo === host.id && !x.points && finiteBoxEl(x) &&
      isStackMember(x) && !x.dogEar &&
      !els.some((y) => y && y.id != null && (y.id === x.prevZone || y.id === x.forCourt || y.id === x.forTrailer)));
    const sideOfHead = (x) => (x.truckCourt && SIDE_NORMAL[x.truckCourt.side] ? x.truckCourt.side
      : (SIDE_NORMAL[x.sidewalkSide] ? x.sidewalkSide : sideOfBondedBox(host, x)));
    for (const head of heads) {
      const side = sideOfHead(head);
      if (!SIDE_NORMAL[side]) continue;
      const chain = [];
      const seen = new Set();
      for (let cur = head; cur && !seen.has(cur.id); cur = nextInChain(cur)) { seen.add(cur.id); chain.push(cur); }
      if (!chain.every(finiteBoxEl)) continue;
      const [nx, ny] = SIDE_NORMAL[side];
      const horiz = ny !== 0;
      const u = rot2d(nx, ny, host.rot || 0);                       // outward normal, world feet
      const tan = rot2d(horiz ? 1 : 0, horiz ? 0 : 1, host.rot || 0); // along-wall unit
      // Each member's own DEPTH survives a translation, so read it off the stored box — that is
      // the user's intent (a resized court keeps its depth) and it is what makes the re-fit a pure
      // re-placement rather than a re-design.
      const depths = chain.map((z) => boxExtentAlong(z, u));
      const fullAlong = horiz ? host.w : host.h;
      const halfAcross = (horiz ? host.h : host.w) / 2;
      // NEW-2 — each member against its COMPUTED anchor, not an absolute distance. The across-axis
      // offset is dictated entirely by the chain's own depths; the along-axis offset only has to
      // keep the member overlapping the wall it is bonded to.
      const strandedAt = chain.map((z, i) => offAnchor({
        acrossHave: (z.cx - host.cx) * u.x + (z.cy - host.cy) * u.y,
        acrossWant: halfAcross + depths.slice(0, i).reduce((s, d) => s + (d || 0), 0) + (depths[i] || 0) / 2,
        alongHave: (z.cx - host.cx) * tan.x + (z.cy - host.cy) * tan.y,
        alongLimit: fullAlong / 2 + boxExtentAlong(z, tan) / 2,
      }));
      if (!strandedAt.some(Boolean)) continue;                      // nothing torn on this side
      const kinds = chain.map((z) => (z.type === "trailer" || z.forCourt ? "trailer" : "strip"));
      // Span along the wall: taken from the HEAD when the head is still where it belongs (that
      // span is the B492 clear-face intent); a torn head falls back to the full wall.
      const headOk = !strandedAt[0];
      const opts = headOk
        ? { along: boxExtentAlong(head, tan),
            alongShift: (head.cx - host.cx) * tan.x + (head.cy - host.cy) * tan.y,
            alongs: chain.map((z, i) => (i === 0 || strandedAt[i] ? null : boxExtentAlong(z, tan))) }
        : { alongs: chain.map(() => null) };
      chain.forEach((z, i) => {
        if (!strandedAt[i]) return;                                 // in reach → untouched, same object
        const g = layoutZoneByKind(host, side, i, depths, kinds, opts);
        patch.set(z.id, g);
        if (onHeal) onHeal({ id: z.id, host: host.id, kind: "dock-zone", type: z.type, side, from: { cx: z.cx, cy: z.cy }, to: { cx: g.cx, cy: g.cy } });
      });
    }
  }
  if (!patch.size) return els;
  return els.map((e) => (e && patch.has(e.id) ? { ...e, ...patch.get(e.id) } : e));
}

/* ---- B1123: drop a SPURIOUS per-zone along-wall length ------------------------------------------
 * `alongLen` is the deliberate escape from the shared chain span: a trailer the owner actually gave
 * a length keeps it, clamped but never reset. The stamp that WRITES it used to compare world-space
 * projections of a rotated box, which drift by h·|sin θ| — so on a building at 178.543° any refit
 * could pin a length nobody set, and the zone stopped tracking its court permanently.
 *
 * The write path is fixed (see dockZones `resizedZoneAlongLen`), but plans already poisoned would
 * stay broken forever, because a pinned length is by design never reset. So on load: an `alongLen`
 * indistinguishable from the chain span the zone would derive anyway carries no intent — it is what
 * the zone would render regardless — and is DROPPED, with the chain re-laid so the geometry catches
 * up in the same pass. A length genuinely different from the span is real intent and is preserved.
 * Only OUTWARD zones are considered: the court head's own `alongLen` is the B492 typed-length path,
 * capped to the clear bump-out face, and is never touched here. */
export function normalizeZoneAlongLen(list, onHeal) {
  const els = arr(list);
  if (els.length < 2) return els;
  const nextInChain = (el) => els.find((x) => x && !x.points && x.id !== el.id && (
    x.prevZone === el.id ||
    (el.truckCourt && x.forCourt === el.id) ||
    (el.type === "trailer" && x.forTrailer === el.id))) || null;
  const drop = new Set();
  const patch = new Map();
  for (const host of els) {
    if (!host || host.type !== "building" || host.dogEar || !finiteBoxEl(host)) continue;
    const courts = els.filter((x) => x && x.attachedTo === host.id && x.truckCourt && !x.points && finiteBoxEl(x));
    for (const head of courts) {
      const side = head.truckCourt.side;
      if (!SIDE_NORMAL[side]) continue;
      const chain = [head];
      const seen = new Set([head.id]);
      for (let z = nextInChain(head); z && !seen.has(z.id); z = nextInChain(z)) { seen.add(z.id); chain.push(z); }
      if (!chain.every(finiteBoxEl)) continue;
      const chainAlong = zoneAlongExtent(head, host.rot || 0, side);
      if (!Number.isFinite(chainAlong) || chainAlong <= 0) continue;
      const echoes = chain.map((z, i) => i > 0 && alongLenIsChainEcho(z.alongLen, chainAlong));
      if (!echoes.some(Boolean)) continue;                     // nothing spurious on this side
      const [, ny] = SIDE_NORMAL[side];   // only the ACROSS component is read here (B1128 ratchet)
      const horiz = ny !== 0;
      const tan = rot2d(horiz ? 1 : 0, horiz ? 0 : 1, host.rot || 0);
      const kinds = chain.map((z) => (z.type === "trailer" || z.forCourt ? "trailer" : "strip"));
      // Depth is the member's own stored intent; the fallback is the EXACT host-local across extent,
      // never a world-space projection (the very error this pass exists to undo).
      const depths = chain.map((z) => (Number.isFinite(z.zd) && z.zd > 0 ? z.zd : zoneDepthExtent(z, host.rot || 0, side)));
      const opts = {
        along: chainAlong,
        alongShift: (head.cx - host.cx) * tan.x + (head.cy - host.cy) * tan.y,
        // The surviving genuine overrides still win; the dropped ones go back to tracking the chain.
        alongs: chain.map((z, i) => (i === 0 || echoes[i] || !(Number.isFinite(z.alongLen) && z.alongLen > 0) ? null : z.alongLen)),
      };
      chain.forEach((z, i) => {
        if (!echoes[i]) return;
        drop.add(z.id);
        patch.set(z.id, layoutZoneByKind(host, side, i, depths, kinds, opts));
        if (onHeal) onHeal({ id: z.id, host: host.id, kind: "zone-along-len", type: z.type, side, from: { alongLen: z.alongLen }, to: { alongLen: null, chainAlong } });
      });
    }
  }
  if (!drop.size) return els;
  return els.map((e) => {
    if (!e || !drop.has(e.id)) return e;
    const { alongLen: _dropped, ...rest } = e;
    return { ...rest, ...(patch.get(e.id) || {}) };
  });
}

/* ---- B1124: re-bond a dock zone whose back-reference points at ANOTHER building's stack ----------
 * A duplicate used to remap only `attachedTo`, so the copy's trailer parking stayed bonded (via
 * `forCourt` / `forTrailer` / `prevZone`) to the ORIGINAL building's courts. A trailer bonded to a
 * court on a different building can never track its own host — that is the owner's "trailer parking
 * just hovering by itself". The write path is fixed (lib/bondRemap.js), but every plan already
 * duplicated carries the cross-link, so repair it on load.
 *
 * The repair is by SIDE, which is the only stable identity a dock zone has: a zone whose bond names
 * an element that is NOT a child of the zone's own host is re-pointed at the corresponding member of
 * the same-side chain on its own host. When no such member exists the dangling reference is DROPPED
 * rather than left pointing at a foreign element — a bond nobody can walk is strictly better than a
 * bond that walks somewhere impossible. */
export function normalizeCrossHostBonds(list, onHeal) {
  const els = arr(list);
  if (els.length < 2) return els;
  const byId = new Map();
  for (const e of els) if (e && e.id != null) byId.set(e.id, e);
  const ID_BONDS = ["forCourt", "forTrailer", "prevZone"];
  // Element ids are always strings; a legacy record's `forTrailer: true` is an inert flag, not a
  // bond, so it points at nothing, cannot cross hosts, and is left alone (mirrors lib/bondRemap.js).
  const isRef = (v) => typeof v === "string" && v.length > 0;
  // The side a stack member sits on, resolved WITHOUT following the (possibly broken) bonds: a court
  // carries it outright, everything else falls back to the geometric side of its own host's box.
  const sideOfMember = (host, z) => (z.truckCourt && SIDE_NORMAL[z.truckCourt.side] ? z.truckCourt.side : sideOfBondedBox(host, z));
  const patch = new Map();
  for (const z of els) {
    if (!z || z.points || z.attachedTo == null) continue;
    if (!ID_BONDS.some((k) => isRef(z[k]))) continue;
    const host = byId.get(z.attachedTo);
    if (!host || host.type !== "building" || host.dogEar || host.points || !finiteBoxEl(host)) continue;
    const fix = {};
    for (const k of ID_BONDS) {
      const refId = z[k];
      if (!isRef(refId)) continue;
      const ref = byId.get(refId);
      if (ref && ref.attachedTo === host.id) continue;         // already bonded inside its own host
      // Find the same-side counterpart on THIS host: a forCourt wants that side's court, a
      // forTrailer wants that side's trailer, a prevZone wants whatever the previous member is.
      const side = finiteBoxEl(z) ? sideOfMember(host, z) : null;
      const wantCourt = k === "forCourt" || (k === "prevZone" && ref && ref.truckCourt);
      const cand = els.find((x) => x && x.attachedTo === host.id && !x.points && x.id !== z.id
        && (wantCourt ? !!x.truckCourt : (k === "forTrailer" ? x.type === "trailer" : (ref ? x.type === ref.type : false)))
        && (!side || !finiteBoxEl(x) || (x.truckCourt ? x.truckCourt.side === side : sideOfBondedBox(host, x) === side)));
      if (cand) fix[k] = cand.id;
      else fix[k] = null;                                      // drop rather than dangle abroad
      if (onHeal) onHeal({ id: z.id, host: host.id, kind: "cross-host-bond", type: z.type, side, from: { [k]: refId }, to: { [k]: fix[k] } });
    }
    if (Object.keys(fix).length) patch.set(z.id, fix);
  }
  if (!patch.size) return els;
  return els.map((e) => {
    if (!e || !patch.has(e.id)) return e;
    const fix = patch.get(e.id);
    const out = { ...e };
    for (const [k, v] of Object.entries(fix)) { if (v == null) delete out[k]; else out[k] = v; }
    return out;
  });
}

/* The ONE bonded-child heal, shared by BOTH read paths (NEW-4). `createSiteModel` (the site-record
 * blob) and `rowsToModel` (the signed-in `site_elements` rows) used to disagree: the blob path ran
 * the normalizers, the rows path ran only `migrateRoads` — so an element-synced plan whose assembly
 * had been torn stayed broken across every reload. Same function, both paths, so they can never
 * drift again. `onHeal` is optional telemetry (LOUD-FAILURE: a silent repair is a repair nobody
 * can audit). */
export function normalizeBondedChildren(els, onHeal) {
  // Order matters: the cross-host bond repair (B1124) runs FIRST, so every later pass walks a chain
  // that actually belongs to its host; the spurious-length drop (B1123) then runs on the repaired
  // chain; the stranded re-fit stays last (it re-places whatever is still geometrically impossible).
  return normalizeStrandedZones(
    normalizeZoneAlongLen(
      normalizeWallKids(normalizeDogEarPositions(normalizeBondedRotations(normalizeCrossHostBonds(els, onHeal)), onHeal), onHeal),
      onHeal,
    ),
    onHeal,
  );
}

/* Build / normalize a Site Model from a (possibly legacy / partial) record.
 * Additive only — never renames or drops the legacy flat fields, so it is also a
 * lossless, idempotent migration. */
export function createSiteModel(p = {}, { onHeal } = {}) {
  return {
    schemaVersion: SITE_MODEL_VERSION,
    // identity
    id: p.id || null,
    groupId: p.groupId || p.id || null,
    site: p.site || p.name || "Untitled site",
    name: p.name || "Concept A",
    updatedAt: p.updatedAt || Date.now(),
    // team sharing (additive; null = private). teamId = the team this plan is shared with;
    // ownerId = the creating user (overlaid from the DB user_id column by cloudList). Persisted
    // flat + back-compatible: an old record has neither → both null → behaves exactly as before.
    teamId: p.teamId || null,
    ownerId: p.ownerId || null,
    // cross-module connection hint (B-cross-module, schema v9; additive). A project (= site
    // group) and a Schedule (Sequence Planyr) project live in SEPARATE cloud backends that
    // can't read each other, so the canonical pairing is stored on the schedule record
    // (`linkedSiteId`). This is a lightweight MIRROR of that pairing kept on the site so the
    // Site Planner can answer "does this site have a schedule?" instantly — without booting the
    // hidden Schedule iframe. `scheduleProjectId` = the schedule's numeric project id;
    // `scheduleProjectName` = its name cached for display. Both null = no linked schedule
    // (every existing record). Never the source of truth — the Shell re-mirrors it whenever the
    // schedule reports a link change, so a stale hint self-heals on the next visit.
    scheduleProjectId: p.scheduleProjectId != null ? p.scheduleProjectId : null,
    scheduleProjectName: p.scheduleProjectName || null,
    // geo anchor + jurisdiction
    origin: p.origin || null,
    county: p.county || null,
    // deal stage. Honor an explicit status; otherwise a record stamped with an
    // older schemaVersion is a pre-feature site (→ "active", presumed live), while
    // a fresh record (no prior version) starts in "pursuit".
    status: normStatus(p.status, isLegacyRecord(p) ? LEGACY_STATUS : DEFAULT_STATUS),
    // inputs
    parcels: ensureZ(withStableParcelIds(parcelArr(p.parcels))),
    underlay: p.underlay || null,
    // placed site-plan overlays (B72): backdrop PDFs/images positioned on the map by
    // hand. Each: {id,name,src,imgW,imgH,page,pageCount,x,y,ftPerPx,rotation,opacity,locked}
    sheetOverlays: objArr(p.sheetOverlays),
    // parcel-attached drawings (B67): a PDF/JPEG attached to a parcel as an IMMUTABLE
    // backdrop, marked up on an editable layer above it in PIXEL-RELATIVE (0..1) coords
    // so zoom/pan can't corrupt geometry. Each: {id,parcelId,name,kind:'pdf'|'image',
    // page,pageCount,intrinsic:{w,h},src(local raster dataURL),markups:[],createdAt,updatedAt}.
    parcelDrawings: objArr(p.parcelDrawings),
    settings: obj(p.settings),
    // drawn layout + shapes (kept flat; selectors classify markups). Idempotent passes, each only
    // touching records that need it: legacy rect roads → centerline model (B596); then the shared
    // bonded-child heal — angle re-anchor (B363), dog-ears snapped to the host's current edge
    // (B487), wall kids re-flushed (B1038/B1039), assemblies torn across transactions re-fitted
    // (NEW-4). `normalizeBondedChildren` is the SAME function the rows read path runs.
    els: ensureZ(normalizeBondedChildren(migrateRoads(objArr(Array.isArray(p.els) ? p.els : p.elements)), onHeal)),
    markups: ensureZ(objArr(p.markups)),
    measures: ensureZ(objArr(p.measures)),
    callouts: ensureZ(objArr(p.callouts)),
    // Delete-tombstones (B276): ids the user DELIBERATELY deleted. The cross-copy merge
    // (mergeSiteContent) unions drawn collections by id, which would otherwise RESURRECT a
    // deleted item from a stale/other copy that still has it (the documented B126 trade-off
    // — "a delete in only one copy can reappear once"). A tombstone makes a deletion win over
    // presence in either copy, so a deleted overlay stays deleted across reload / tab / device.
    // Ids are never reused (fresh uid() per add), so a plain id list is safe; bounded + deduped.
    deletedIds: [...new Set(arr(p.deletedIds).filter((x) => typeof x === "string"))].slice(-MAX_TOMBSTONES),
    // elevation references (newly persisted; empty for legacy records)
    elevation: { crossSections: objArr(p.elevation && p.elevation.crossSections) },
    // Per-site GIS Layers-panel toggle memory (NEW-1): a SPARSE { layerKey: boolean } map of overlay
    // layers toggled away from their default on/off (see lib/layerPrefs.js). Absent field / empty map
    // = today's default behavior (every session rebuilds from defaultOverlayState()). Additive +
    // back-compatible; carried newer-wins by mergeSiteContent's `...newer` spread, like any scalar field.
    layerOverrides: layerOverridesObj(p.layerOverrides),
    // constraint metadata. `liveLayers` is RESERVED for future per-site layer
    // memory — populated later; today layer state is a global app preference.
    constraints: { liveLayers: arr(p.constraints && p.constraints.liveLayers) },
  };
}

// Idempotent migration: upgrade any record to the current schema. (Additive, so
// just (re)normalizing is sufficient and lossless.)
export const migrate = (record) => createSiteModel(record || {});

/* ----------------------- cross-copy reconciliation -----------------------
 * Combining TWO independent copies of the same site (the local cache + the cloud, or
 * two devices) WITHOUT dropping drawn work. This is the data-loss cure: the old sync
 * kept whichever whole record was saved last, so a thinner copy could erase a fuller
 * one. These helpers union the copies by element id instead, so a building present in
 * EITHER copy is always kept. */

// Union two collections of objects by `id`: `primary` wins on id conflicts, then any
// item from `secondary` whose id isn't already present is appended. Items with no id
// are de-duped by value so none are lost or doubled.
function unionById(primary, secondary) {
  const out = [];
  const ids = new Set();
  const vals = new Set();
  const take = (it) => {
    if (!it || typeof it !== "object") return;
    if (it.id != null) { if (ids.has(it.id)) return; ids.add(it.id); out.push(it); }
    else { const k = JSON.stringify(it); if (vals.has(k)) return; vals.add(k); out.push(it); }
  };
  arr(primary).forEach(take);
  arr(secondary).forEach((it) => { if (it && it.id != null && ids.has(it.id)) return; take(it); });
  return out;
}

// If the chosen copy lost an inline image (it was stripped for the cloud) but the other
// copy still has the real raster, carry it back — so a merge can't blank a drawing/aerial.
function healSrc(chosen, other) {
  const otherById = {};
  for (const o of arr(other)) if (o && o.id != null) otherById[o.id] = o;
  return arr(chosen).map((n) => {
    if (n && n.id != null && (!n.src || n.strippedForCloud)) {
      const o = otherById[n.id];
      if (o && o.src && !o.strippedForCloud) return { ...n, src: o.src, strippedForCloud: false };
    }
    return n;
  });
}

// Reconcile two copies of the SAME site without ever dropping drawn work: scalar/meta
// fields come from the NEWER copy; every drawn collection is UNIONED by id, so a
// building (or markup, parcel, measure, overlay, cross-section) in EITHER copy survives.
// Deletions are honored via tombstones (B276): a `deletedIds` id from EITHER copy wins,
// so a deliberate delete is NOT undone by a stale/other copy that still has the item.
// (Items not yet wired to record a tombstone keep the old union behavior — still no data
// loss, just the recoverable "delete can reappear once" trade-off until they adopt it.)
export function mergeSiteContent(a, b) {
  const A = createSiteModel(a || {});
  const B = createSiteModel(b || {});
  const newer = toMs(A.updatedAt) >= toMs(B.updatedAt) ? A : B; // B559: type-safe (ISO string OR ms number)
  const older = newer === A ? B : A;
  // Union the tombstones from BOTH copies, then drop any tombstoned id from every unioned
  // collection so a deleted item can't be resurrected by the copy that still holds it.
  const tomb = new Set([...arr(A.deletedIds), ...arr(B.deletedIds)]);
  const live = (list) => (tomb.size ? arr(list).filter((it) => !(it && it.id != null && tomb.has(it.id))) : arr(list));
  const merged = {
    ...newer,
    parcels: live(unionById(newer.parcels, older.parcels)),
    els: live(unionById(newer.els, older.els)),
    markups: live(unionById(newer.markups, older.markups)),
    measures: live(unionById(newer.measures, older.measures)),
    callouts: live(unionById(newer.callouts, older.callouts)),
    sheetOverlays: live(healSrc(unionById(newer.sheetOverlays, older.sheetOverlays), older.sheetOverlays)),
    parcelDrawings: live(healSrc(unionById(newer.parcelDrawings, older.parcelDrawings), older.parcelDrawings)),
    elevation: { crossSections: live(unionById(
      newer.elevation && newer.elevation.crossSections,
      older.elevation && older.elevation.crossSections)) },
    deletedIds: [...tomb].slice(-MAX_TOMBSTONES),
  };
  // single-object underlay: keep the newer placement, but don't blank a real image with a stripped one
  if (newer.underlay && (!newer.underlay.src || newer.underlay.strippedForCloud) &&
      older.underlay && older.underlay.src && !older.underlay.strippedForCloud) {
    merged.underlay = { ...newer.underlay, src: older.underlay.src, strippedForCloud: false };
  }
  return createSiteModel(merged);
}

// Cheap "how much drawn work is here" tally — used to tell when a merge produced MORE
// than a copy had (so the fuller, merged result gets pushed back rather than stranded).
export const contentCount = (m) =>
  arr(m && m.els).length + arr(m && m.markups).length + arr(m && m.measures).length +
  arr(m && m.callouts).length + arr(m && m.parcels).length +
  arr(m && m.sheetOverlays).length + arr(m && m.parcelDrawings).length;

/* --------------------------- selectors --------------------------- */
const byKind = (markups, kinds) => (markups || []).filter((m) => kinds.includes(m.kind));

export const parcelsOf = (m) => m.parcels || [];
// Parcels counted in the yield/area math: a parcel is ACTIVE unless explicitly flagged inactive
// (`active === false`). Missing = active, so existing sites are unaffected (B100).
export const activeParcelsOf = (m) => (m.parcels || []).filter((p) => p.active !== false);

/* ---- Parcel split lineage (B651) ----
 * Splitting a parcel KEEPS the original as a SUPERSEDED, inactive (non-counting) parent and
 * activates its pieces as CHILDREN, each carrying `parentId` = the parent's id. That is the
 * ONLY new per-parcel field; it rides through createSiteModel untouched (like `active`, above).
 * "Superseded" is DERIVED (a parcel some other parcel names as its parent) so there is one
 * source of truth. Because a superseded parent is inactive, it drops out of every active-parcel
 * area sum automatically — no yield-math change needed. The active set must stay spatially
 * NON-OVERLAPPING, so a parent and its split children can never both be active (enforced at the
 * Active toggle via `lineageConflicts`). Display names are derived + lineage-aware (below). */

// parentId → [childId…] in array order. Only counts children whose parent is present in `parcels`.
export function parcelChildrenMap(parcels) {
  const list = arr(parcels);
  const has = new Set(list.map((p) => p && p.id));
  const m = new Map();
  for (const p of list) {
    if (p && p.parentId != null && has.has(p.parentId)) {
      if (!m.has(p.parentId)) m.set(p.parentId, []);
      m.get(p.parentId).push(p.id);
    }
  }
  return m;
}
// All descendant ids of `id` (children, grandchildren, …).
export function parcelDescendants(parcels, id) {
  const kids = parcelChildrenMap(parcels);
  const out = new Set();
  const stack = [...(kids.get(id) || [])];
  while (stack.length) {
    const cur = stack.pop();
    if (out.has(cur)) continue;
    out.add(cur);
    for (const k of kids.get(cur) || []) stack.push(k);
  }
  return out;
}
// All ancestor ids of `id` (parent, grandparent, …), cycle-guarded.
export function parcelAncestors(parcels, id) {
  const byId = new Map(arr(parcels).map((p) => [p && p.id, p]));
  const out = new Set();
  let cur = byId.get(id), guard = 0;
  while (cur && cur.parentId != null && byId.has(cur.parentId) && guard++ < 10000) {
    if (out.has(cur.parentId)) break; // defend against a corrupt parentId cycle
    out.add(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}
// The ids that spatially overlap `id` by split lineage — its ancestors + descendants (a parent
// covers all of its children's ground). Siblings/cousins partition the parent, so they are
// disjoint and excluded. The mutual-exclusion guard: activating a parcel deactivates exactly these.
export function lineageConflicts(parcels, id) {
  const out = new Set([...parcelAncestors(parcels, id), ...parcelDescendants(parcels, id)]);
  out.delete(id);
  return out;
}

// Spreadsheet-style letter for a birth-order index (0→A, 25→Z, 26→AA…).
function birthLetter(i) {
  let s = "", n = i | 0;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}
// Derived, lineage-aware display info per parcel id → { tag, depth, superseded, name, parentId }.
// Roots number among roots in array order ("Parcel 3"); a child's tag = the parent's tag + a
// birth-order suffix, alternating letters (odd depth) / digits (even depth) — so 3 → 3A/3B and
// 3A → 3A1/3A2. A parcel with a street address keeps the address as its name.
export function parcelDisplayInfo(parcels) {
  const list = arr(parcels);
  const byId = new Map(list.map((p) => [p && p.id, p]));
  const kids = parcelChildrenMap(list);
  const isRoot = (p) => !(p && p.parentId != null && byId.has(p.parentId));
  const rootNum = new Map();
  let rn = 0;
  for (const p of list) if (isRoot(p)) rootNum.set(p.id, ++rn);
  const memo = new Map();
  const compute = (p, seen) => {
    if (!p) return { tag: "?", depth: 0 };
    if (memo.has(p.id)) return memo.get(p.id);
    if (seen.has(p.id)) return { tag: "?", depth: 0 }; // cycle guard
    seen.add(p.id);
    let res;
    if (isRoot(p)) res = { tag: String(rootNum.get(p.id) || "?"), depth: 0 };
    else {
      const pr = compute(byId.get(p.parentId), seen);
      const idx = Math.max(0, (kids.get(p.parentId) || []).indexOf(p.id));
      const depth = pr.depth + 1;
      res = { tag: pr.tag + (depth % 2 === 1 ? birthLetter(idx) : String(idx + 1)), depth };
    }
    memo.set(p.id, res);
    return res;
  };
  const out = new Map();
  for (const p of list) {
    const { tag, depth } = compute(p, new Set());
    out.set(p.id, {
      tag, depth,
      superseded: (kids.get(p.id) || []).length > 0,
      name: (p && p.addr) || `Parcel ${tag}`,
      parentId: isRoot(p) ? null : p.parentId,
    });
  }
  return out;
}
// Render-ready ordering for the Parcel panel: each root (array order) immediately followed by
// its descendants depth-first, carrying `depth` (for indentation) + the display info — so the
// panel shows children nested under a greyed, superseded parent.
export function parcelOutline(parcels) {
  const list = arr(parcels);
  const byId = new Map(list.map((p) => [p && p.id, p]));
  const kids = parcelChildrenMap(list);
  const info = parcelDisplayInfo(list);
  const isRoot = (p) => !(p && p.parentId != null && byId.has(p.parentId));
  const order = [];
  const seen = new Set();
  const visit = (id) => {
    const p = byId.get(id);
    if (!p || seen.has(id)) return;
    seen.add(id);
    order.push({ pc: p, ...(info.get(id) || { tag: "?", depth: 0, superseded: false, name: "Parcel ?", parentId: null }) });
    for (const k of kids.get(id) || []) visit(k);
  };
  for (const p of list) if (isRoot(p)) visit(p.id);
  for (const p of list) if (!seen.has(p.id)) visit(p.id); // safety: any parcel orphaned by a cycle
  return order;
}
export const elementsOf = (m) => m.els || [];
// B122 — a "building" element that is an actual standalone building, excluding the
// attached dog-ear / bump-out pieces (stored as type "building" too, flagged `dogEar`).
export const isBuilding = (el) => !!el && el.type === "building" && !el.dogEar;
// B122 — map of building id → its sequential display number ("Building N"), assigned in
// placement order (the order buildings appear in `els`). DERIVED from list position and
// never stored: deleting a building renumbers the rest 1…N in one pass. Identity stays
// `el.id` (what every cross-reference such as `attachedTo` binds to); the number is a
// display label only, so renumbering can never silently re-point a reference.
export const buildingNumbers = (els) => {
  const m = new Map();
  let n = 0;
  (els || []).forEach((el) => { if (isBuilding(el)) m.set(el.id, ++n); });
  return m;
};
// Road travel width (ft) from CURRENT geometry: the cross-width minus a curb each side.
// Derived live from w/h so a road's dimension callout always tracks a resize — it used to
// read a frozen `travelW` snapshot that went stale when the road was dragged bigger.
export const roadTravelWidth = (w, h, curb) => Math.max(0, Math.min(w, h) - 2 * curb);

/* ---- Centerline road model (B596 / NEW-1) ----
 * A road evolves from a rotated rectangle to a CENTERLINE polyline:
 *   { type:"road", pts:[{x,y}…], travelW, curb, roadClass, vtx:[{treatment,radius?}…] }
 * The surface, curbs and dimension all derive from `pts` (B598); per-vertex curve
 * treatments come from `vtx` (B597). A 2-point road is the old straight road. */

// Endpoints A/B of a legacy rotated-rect road from its cx,cy,w,h,rot. The LONG axis
// (max(w,h)) is the centerline; the cross axis carries travelW + a curb each side. So a
// migrated straight road's centerline is exactly the old rectangle's midline.
export function rectRoadEndpoints(el) {
  const w = +el.w || 0, h = +el.h || 0;
  const rot = ((+el.rot || 0) * Math.PI) / 180;
  const lengthAlongW = w >= h;                       // which axis is the road's length
  const halfLen = (lengthAlongW ? w : h) / 2;
  const ang = lengthAlongW ? rot : rot + Math.PI / 2; // direction of the length axis
  const dx = Math.cos(ang) * halfLen, dy = Math.sin(ang) * halfLen;
  return [{ x: el.cx - dx, y: el.cy - dy }, { x: el.cx + dx, y: el.cy + dy }];
}

// AABB (rot:0) bounding box of a centerline road's strip, kept synced on the element so
// every GENERIC geometry consumer (zoom-to-fit, flush-snap, group bbox, ring tests) keeps
// working unchanged — while the road-specific render/area/handles read `pts`. The box is
// the AABB of the actual pavement+curb strip ring (bufferPolyline of the tessellated
// centerline at travelW + 2 curbs), so a straight road's box is tight (== the old rect).
export function roadStripBBox(pts, vtx, travelW, curb, opts = {}) {
  const dense = roadCenterline(pts, vtx, opts);
  if (!dense.length) return { cx: 0, cy: 0, w: 1, h: 1, rot: 0 };
  const ring = bufferPolyline(dense, Math.max(0, (+travelW || 0) + 2 * (+curb || 0))) || dense;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return {
    cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
    w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), rot: 0,
  };
}

// Convert a legacy rotated-rect road into the centerline model. Idempotent (skips a road
// that already carries `pts`) and additive (keeps cx/cy/w/h/rot as the tight bbox of the
// straight road, so it renders identically). A BONDED dock-layer road (attachedTo set) is
// left as a rect — the relayout engine still owns its geometry.
function migrateRoad(el, opts) {
  if (!el || el.type !== "road" || el.attachedTo != null) return el;
  let out = el;
  if (!(Array.isArray(el.pts) && el.pts.length >= 2)) {       // legacy rotated-rect → centerline
    if (!Number.isFinite(el.cx) || !Number.isFinite(el.cy) ||
        !Number.isFinite(el.w) || !Number.isFinite(el.h)) return el;
    const curb = Number.isFinite(el.curb) ? el.curb : 0.5;
    const travelW = Math.max(1, roadTravelWidth(el.w, el.h, curb));
    out = { ...el, pts: rectRoadEndpoints(el), vtx: [], travelW, curb, roadClass: el.roadClass || DEFAULT_ROAD_CLASS };
  }
  // NEW-3 — collapse near-duplicate control-point clutter left by earlier connect attempts (the
  // B1005/B1006 root cause), keeping pts/vtx index-aligned. Idempotent: a clean road returns null → no
  // churn, so `out === el` stays reference-stable for already-migrated data.
  // NEW-5 — plus the deflection test: a stub shorter than a quarter of the road's own width that the
  // alignment TURNS through is connect debris, not geometry (see dedupeRoadVertices). `pinned` carries
  // every other road's endpoints so cleaning debris can never drop a vertex a tee is welded to.
  const deduped = dedupeRoadVertices(out.pts, out.vtx, ROAD_VERTEX_COLLAPSE_FT, {
    deflectFt: Math.max(ROAD_VERTEX_COLLAPSE_FT, (+out.travelW || 0) / 4),
    pinned: opts && Array.isArray(opts.pinned) ? opts.pinned : [],
  });
  if (deduped) out = { ...out, pts: deduped.pts, vtx: deduped.vtx };
  // NEW-6 — undo a radius the PRE-B1013 auto-fixer baked onto a vertex. It wrote the clamped value
  // back, so the corner drew as a blob forever and read as a radius the owner had chosen. Only a
  // BELOW-CLASS, non-round value is touched (see repairBakedRadii) and no point ever moves, so this
  // can only improve a drawn corner. Lives in migrateRoad, not a call site, so BOTH read paths get it
  // (the B1012 lesson: two code paths for the same data drift unless they share the function).
  // B1052 — drop control points the owner never placed. Every connect SPLICES a vertex into the target
  // road and nothing ever took one back out, so a redrawn or re-dragged side road left a trail of grips
  // that bend the alignment by nothing. B1008 (near-duplicates) and B1010 (turning stubs) both judged a
  // COLLINEAR stub harmless — it distorts no geometry, but it is still clutter he has to look at and
  // avoid dragging, which is the actual complaint. `simplifyRoadVertices` bounds its own removals
  // against the polyline it is handed, so however many points come out the alignment stays put. It runs
  // AFTER the two debris passes above, which are justified differently: those drop vertices that
  // provably are NOT geometry (a near-duplicate; a stub too short to carry the turn it holds), and
  // B1010 accepts a couple of feet of correction on one of them precisely because the vertex was
  // mis-aimed connect debris. The passes compose as: remove what is provably wrong, then remove what
  // adds nothing.
  // The pin radius scales with the road's own width, matching the junction-coincidence rule, and only
  // the vertex NEAREST each pin is protected — so a junction keeps its node while its debris goes.
  const simplified = simplifyRoadVertices(out.pts, out.vtx, ROAD_SIMPLIFY_TOL_FT, {
    pinned: opts && Array.isArray(opts.pinned) ? opts.pinned : [],
    pinTolFt: Math.max(0.75, Math.min((+out.travelW || 0) / 8, 4)),
  });
  if (simplified) out = { ...out, pts: simplified.pts, vtx: simplified.vtx };
  const cls = roadClassOf(opts && opts.settings, out.roadClass);
  const min = cls && cls.minRadius > 0 ? cls.minRadius : 0;
  if (min > 0) {
    const fixed = repairBakedRadii(out.pts, out.vtx, min, { targetRadius: cls.defaultRadius > 0 ? cls.defaultRadius : min });
    if (fixed) out = { ...out, pts: fixed.pts, vtx: fixed.vtx };
  }
  return out;
}
export function migrateRoads(els) {
  let changed = false;
  // Every road ENDPOINT on the site is a pinned point: another road may tee/weld onto it, and a cleanup
  // that dropped one would silently break the junction.
  const pinned = [];
  for (const e of els || []) {
    if (!e || !Array.isArray(e.pts) || e.pts.length < 2) continue;
    pinned.push({ x: e.pts[0].x, y: e.pts[0].y }, { x: e.pts[e.pts.length - 1].x, y: e.pts[e.pts.length - 1].y });
  }
  const out = (els || []).map((e) => { const m = migrateRoad(e, { pinned }); if (m !== e) changed = true; return m; });
  return changed ? out : (els || []);
}
// Placed site-plan overlays (B72) — immutable backdrop sheets over the map.
export const sheetOverlaysOf = (m) => m.sheetOverlays || [];
// Parcel-attached drawings (B67) — immutable backdrop + pixel-relative markup, per parcel.
export const parcelDrawingsOf = (m, parcelId = null) =>
  (m.parcelDrawings || []).filter((d) => parcelId == null || d.parcelId === parcelId);
// Deal stage, always one of STATUSES (defaults to "pursuit" if somehow unset).
export const statusOf = (m) => normStatus(m && m.status, DEFAULT_STATUS);

// Team sharing (team feature). `teamId` = the team this plan is shared with (null = private);
// `ownerId` = the user who created it (set from the DB user_id column by cloudList). Returns a
// small descriptor the UI reads to show a "Shared / Private" badge and "owned by a teammate".
export const teamShareOf = (m) => ({
  teamId: (m && m.teamId) || null,
  shared: !!(m && m.teamId),
  ownerId: (m && m.ownerId) || null,
});

// Everything that constrains development: title easements + routed easement
// corridors (from markups), per-parcel setbacks (derived), and the live GIS
// constraint layers enabled for this site (reserved).
export function constraintsOf(m) {
  return {
    easements: byKind(m.markups, EASEMENT_KINDS),
    setbacks: setbacksOf(m),
    liveLayers: (m.constraints && m.constraints.liveLayers) || [],
  };
}

// Utility runs: electric/water service routes, traced overhead lines, inferred mains.
export const utilitiesOf = (m) => byKind(m.markups, UTILITY_KINDS);

// First-class easement objects (NEW-1) — the kind:"easement" markups specifically
// (a subset of constraintsOf().easements, which also includes legacy encumbrances).
export const easementsOf = (m) => byKind(m && m.markups, ["easement"]);

/* NEW-4 — easement geometry + restriction flags in the shape the buildable-area /
 * yield engine consumes as EXCLUSION ZONES. Each zone carries its drawn ring plus
 * whether it blocks buildings and/or paving, so the future verdict engine can
 * subtract restrictsBuildings zones from the buildable footprint and restrictsPaving
 * zones from the pavable area — without re-deriving any of this. `restrictsBuildings`
 * defaults true, `restrictsPaving` false (missing flag = the default), matching the
 * tool's create-time defaults. */
export function exclusionZonesOf(m) {
  return easementsOf(m).map((e) => ({
    id: e.id,
    ring: (e.pts && e.pts.length >= 3) ? e.pts : [],
    restrictsBuildings: e.restrictsBuildings !== false,
    restrictsPaving: e.restrictsPaving === true,
    status: e.status || "existing",
    easeType: e.easeType || "other",
  })).filter((z) => z.ring.length >= 3);
}

// Neutral annotations (drawing markups + measures + callouts).
export const annotationsOf = (m) => ({
  markups: byKind(m.markups, ANNOTATION_KINDS),
  measures: m.measures || [],
  callouts: m.callouts || [],
});

export const crossSectionsOf = (m) => (m.elevation && m.elevation.crossSections) || [];

// Per-parcel setbacks as a read view (raw per-edge values; null = use settings default).
export const setbacksOf = (m) =>
  (m.parcels || []).map((p) => ({ id: p.id, setbacks: p.setbacks || null }));

/* Reserved for the future buildable-area / cost synthesis: with one model holding
 * boundaries + setbacks + easements + utilities + elevation, this is where the
 * developable envelope and yield will be computed. The envelope math is still a
 * stub, but the easement EXCLUSION ZONES it will subtract are now exposed (NEW-4),
 * so the verdict engine can be dropped in later with no rework — and any caller can
 * already read which areas are off-limits to buildings / paving. */
export function developableArea(m) {
  return {
    available: null,
    exclusions: exclusionZonesOf(m || {}),
    note: "envelope synthesis reserved; easement exclusion zones exposed for the buildable-area engine",
  };
}
