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

export const SITE_MODEL_VERSION = 7;

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
// an explicit status, so the version bump (→6 B276 delete-tombstones, →7 B357/B358
// bump-out sizing + bonded-rotation repair) doesn't disturb it. (saveSite re-normalizes
// through this, so the status it reads back is the explicit one when a status was passed in.)
const isLegacyRecord = (p) => typeof p.schemaVersion === "number" && p.schemaVersion < SITE_MODEL_VERSION;
// Type-confusion guards: a tampered/legacy/bad-sync record can carry a non-array where an array is
// expected (e.g. `parcels` as a string), which then throws on `.reduce`/`.map` and blanks the app.
// Coerce every collection so one malformed record can't crash the planner on load.
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
// Cap on retained delete-tombstones (B276). Each is just an id string, so this is generous
// headroom — a real plan deletes a handful of items, never thousands.
const MAX_TOMBSTONES = 5000;

/* ---- Bonded-child rotation invariant (B358) ----
 * Every box element bonded to a host building (`attachedTo` set) is axis-aligned to that
 * host at a FIXED quarter-turn offset (0/90/180/270): sidewalks, truck courts, and corner
 * bump-outs share the host's angle; side-parking rows and wall trailers sit at a +90/180/270
 * turn. So a bonded child's angle is a DERIVED value — host.rot + its quarter-turn offset —
 * never an independent one. If a child's stored angle has drifted off that (the host was
 * re-angled by a path that didn't carry the child — e.g. Jacintoport: host 0°, all four
 * children 359.035°), it is repaired below. */
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
    // drawn layout + shapes (kept flat; selectors classify markups). Bonded children are
    // re-anchored to their host's angle (B358) — idempotent, only touches drifted records.
    els: normalizeBondedRotations(Array.isArray(p.els) ? p.els : arr(p.elements)),
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
  const newer = (A.updatedAt || 0) >= (B.updatedAt || 0) ? A : B;
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
// Placed site-plan overlays (B72) — immutable backdrop sheets over the map.
export const sheetOverlaysOf = (m) => m.sheetOverlays || [];
// Parcel-attached drawings (B67) — immutable backdrop + pixel-relative markup, per parcel.
export const parcelDrawingsOf = (m, parcelId = null) =>
  (m.parcelDrawings || []).filter((d) => parcelId == null || d.parcelId === parcelId);
// Deal stage, always one of STATUSES (defaults to "pursuit" if somehow unset).
export const statusOf = (m) => normStatus(m && m.status, DEFAULT_STATUS);

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
