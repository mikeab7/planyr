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

import { dogEarGeom, dogEarSize, isDogEarSide } from "./dogEar.js";
import { roadCenterline } from "./roadGeometry.js";
import { bufferPolyline } from "./metesAndBounds.js";
import { DEFAULT_ROAD_CLASS } from "./roadClasses.js";

export const SITE_MODEL_VERSION = 11;

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

const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
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
function normalizeDogEarPositions(list) {
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
    return { ...e, cx: g.cx, cy: g.cy, w: g.w, h: g.h, rot: g.rot };
  });
  return changed ? out : els;
}

/* Build / normalize a Site Model from a (possibly legacy / partial) record.
 * Additive only — never renames or drops the legacy flat fields, so it is also a
 * lossless, idempotent migration. */
export function createSiteModel(p = {}) {
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
    parcels: arr(p.parcels),
    underlay: p.underlay || null,
    // placed site-plan overlays (B72): backdrop PDFs/images positioned on the map by
    // hand. Each: {id,name,src,imgW,imgH,page,pageCount,x,y,ftPerPx,rotation,opacity,locked}
    sheetOverlays: arr(p.sheetOverlays),
    // parcel-attached drawings (B67): a PDF/JPEG attached to a parcel as an IMMUTABLE
    // backdrop, marked up on an editable layer above it in PIXEL-RELATIVE (0..1) coords
    // so zoom/pan can't corrupt geometry. Each: {id,parcelId,name,kind:'pdf'|'image',
    // page,pageCount,intrinsic:{w,h},src(local raster dataURL),markups:[],createdAt,updatedAt}.
    parcelDrawings: arr(p.parcelDrawings),
    settings: obj(p.settings),
    // drawn layout + shapes (kept flat; selectors classify markups). Three idempotent passes,
    // each only touching records that need it: legacy rect roads → centerline model (B596);
    // bonded children re-anchored to their host's angle (B363); dog-ear children snapped to
    // their host's current edge (B487, Jacintoport orphan-bumpout).
    els: normalizeDogEarPositions(normalizeBondedRotations(migrateRoads(Array.isArray(p.els) ? p.els : arr(p.elements)))),
    markups: arr(p.markups),
    measures: arr(p.measures),
    callouts: arr(p.callouts),
    // Delete-tombstones (B276): ids the user DELIBERATELY deleted. The cross-copy merge
    // (mergeSiteContent) unions drawn collections by id, which would otherwise RESURRECT a
    // deleted item from a stale/other copy that still has it (the documented B126 trade-off
    // — "a delete in only one copy can reappear once"). A tombstone makes a deletion win over
    // presence in either copy, so a deleted overlay stays deleted across reload / tab / device.
    // Ids are never reused (fresh uid() per add), so a plain id list is safe; bounded + deduped.
    deletedIds: [...new Set(arr(p.deletedIds).filter((x) => typeof x === "string"))].slice(-MAX_TOMBSTONES),
    // elevation references (newly persisted; empty for legacy records)
    elevation: { crossSections: arr(p.elevation && p.elevation.crossSections) },
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
function migrateRoad(el) {
  if (!el || el.type !== "road" || el.attachedTo != null) return el;
  if (Array.isArray(el.pts) && el.pts.length >= 2) return el; // already a centerline
  if (!Number.isFinite(el.cx) || !Number.isFinite(el.cy) ||
      !Number.isFinite(el.w) || !Number.isFinite(el.h)) return el;
  const curb = Number.isFinite(el.curb) ? el.curb : 0.5;
  const travelW = Math.max(1, roadTravelWidth(el.w, el.h, curb));
  return { ...el, pts: rectRoadEndpoints(el), vtx: [], travelW, curb, roadClass: el.roadClass || DEFAULT_ROAD_CLASS };
}
function migrateRoads(els) {
  let changed = false;
  const out = (els || []).map((e) => { const m = migrateRoad(e); if (m !== e) changed = true; return m; });
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
