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

export const SITE_MODEL_VERSION = 4;

// Markup `kind`s grouped by what they MEAN (used by the selectors).
export const EASEMENT_KINDS = ["encumbrance"];                    // title metes-and-bounds tracts / corridors
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
// A record already stamped with an older schemaVersion predates this feature, so
// it's presumed live → "active". Every new record (no prior version) is stamped 4
// here and falls through to "pursuit". (saveSite re-normalizes through this, so the
// status it reads back is the explicit one when a status was passed in.)
const isLegacyRecord = (p) => typeof p.schemaVersion === "number" && p.schemaVersion < SITE_MODEL_VERSION;

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
    name: p.name || "Plan 1",
    updatedAt: p.updatedAt || Date.now(),
    // geo anchor + jurisdiction
    origin: p.origin || null,
    county: p.county || null,
    // deal stage. Honor an explicit status; otherwise a record stamped with an
    // older schemaVersion is a pre-feature site (→ "active", presumed live), while
    // a fresh record (no prior version) starts in "pursuit".
    status: normStatus(p.status, isLegacyRecord(p) ? LEGACY_STATUS : DEFAULT_STATUS),
    // inputs
    parcels: p.parcels || [],
    underlay: p.underlay || null,
    // placed site-plan overlays (B72): backdrop PDFs/images positioned on the map by
    // hand. Each: {id,name,src,imgW,imgH,page,pageCount,x,y,ftPerPx,rotation,opacity,locked}
    sheetOverlays: p.sheetOverlays || [],
    settings: p.settings || {},
    // drawn layout + shapes (kept flat; selectors classify markups)
    els: p.els || p.elements || [],
    markups: p.markups || [],
    measures: p.measures || [],
    callouts: p.callouts || [],
    // elevation references (newly persisted; empty for legacy records)
    elevation: { crossSections: (p.elevation && p.elevation.crossSections) || [] },
    // constraint metadata. `liveLayers` is RESERVED for future per-site layer
    // memory — populated later; today layer state is a global app preference.
    constraints: { liveLayers: (p.constraints && p.constraints.liveLayers) || [] },
  };
}

// Idempotent migration: upgrade any record to the current schema. (Additive, so
// just (re)normalizing is sufficient and lossless.)
export const migrate = (record) => createSiteModel(record || {});

/* --------------------------- selectors --------------------------- */
const byKind = (markups, kinds) => (markups || []).filter((m) => kinds.includes(m.kind));

export const parcelsOf = (m) => m.parcels || [];
export const elementsOf = (m) => m.els || [];
// Placed site-plan overlays (B72) — immutable backdrop sheets over the map.
export const sheetOverlaysOf = (m) => m.sheetOverlays || [];
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
 * developable envelope and yield will be computed. Stub for now. */
export function developableArea(/* m */) {
  return { available: null, note: "not computed — reserved for buildable-area synthesis" };
}
