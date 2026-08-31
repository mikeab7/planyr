/* siteStatus.js — the Site Model's schema-version + deal-status constants, split out of
 * siteModel.js (B927105) so a caller that only needs a STATUS LABEL or the schema version
 * number doesn't have to import siteModel.js's whole module — which, being one file, drags its
 * top-of-file imports (dogEar.js/dockZones.js/roadGeometry.js/…) along regardless of which
 * export is actually used. `doc-review/lib/reviewStore.js` and the new `siteListLight.js` are
 * exactly that case: they want a status label, never the geometry engine.
 *
 * siteModel.js imports and re-exports all of this, so nothing about its own public surface
 * changes. Pure, dependency-free — no import here may ever reach back into siteModel.js.
 */

export const SITE_MODEL_VERSION = 13;

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
export const DEFAULT_STATUS = "pursuit";       // a brand-new site
export const LEGACY_STATUS = "active";          // pre-feature records (no status yet)
export const normStatus = (s, fallback) => (STATUSES.includes(s) ? s : fallback);
// A record already stamped with an older schemaVersion predates the status feature,
// so a record with NO explicit status is presumed live → "active". Records v3+ carry
// an explicit status, so the version bump (→6 B276 delete-tombstones, →7 B362/B363
// bump-out sizing + bonded-rotation repair, →8 team sharing teamId/ownerId, →9 cross-module
// schedule link hint scheduleProjectId/Name, →10 centerline road model B596 pts/vtx/
// travelW/roadClass, →11 parcel split lineage `parentId` B651) doesn't disturb it. (saveSite re-normalizes
// through this, so the status it reads back is the explicit one when a status was passed in.)
export const isLegacyRecord = (p) => typeof p.schemaVersion === "number" && p.schemaVersion < SITE_MODEL_VERSION;
export const statusOf = (m) => normStatus(m && m.status, DEFAULT_STATUS);
