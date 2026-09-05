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

// v14 (B848736): the separate `underlay` aerial-backdrop field is retired — folded into
// `sheetOverlays` on read (siteModel.js's `foldAerialIntoOverlays`) as a bottom-pinned
// reference (`fromMap`/legacy-underlay records sort first in the "below" band; see
// lib/overlayOrder.js's `isPinnedMapReference`). One reference model, not two.
// v15 (B843792, NEW-1 — "one site entity with a role") adds `role` (see below). Purely
// additive: an absent `role` on any existing record — legacy or current — normalizes to
// "pursuit", so no existing site changes meaning by this bump alone.
export const SITE_MODEL_VERSION = 15;

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

/* Site ROLE (B843792, NEW-1 — "one site entity with a role; a deal belongs to a site").
 *
 * A `sites` row is one PLAN of one PROJECT (a project = a group of plans sharing `groupId`).
 * Before this, a comp (a comparable transaction, or a piece of market intel with no comp at all —
 * a land site quoting a price, nothing transacted) lived in a completely separate `comps` table
 * with no owning site — so the same physical property could exist as an unrelated Sites-list
 * project AND an unrelated comp, with no link between them (measured on the owner's own data:
 * his "Core 5 - West Hardy" comp is the same building as Building A on his one site plan).
 *
 * `role` collapses that split: every site is ONE entity, distinguished only by ROLE —
 *   "pursuit" — a property the owner is actively working (the existing Sites list; unchanged).
 *   "tracked" — a property he is only recording market evidence/notes about (a comp, an asking
 *               price, a "nothing transacted yet" note) — never shown in the pursuit pipeline.
 *
 * Unlike `status` (which distinguishes a fresh record from a pre-feature legacy one), EVERY
 * existing record — legacy or current — defaults to "pursuit": role never existed before this,
 * so there is no prior population of "tracked" sites to presume. A site becomes "tracked" only
 * when explicitly created that way (the comps backfill, or a future "track this property" action).
 * Flipping a site's role later must not require re-entering anything — see
 * `db/set_site_group_role.sql` (the same one-atomic-statement-over-the-group shape
 * `rename_site_group.sql` uses) + `storage.setSiteGroupRole`. */
export const ROLES = ["pursuit", "tracked"];
export const ROLE_META = {
  pursuit: { label: "Pursuit" },
  tracked: { label: "Tracked" },
};
export const DEFAULT_ROLE = "pursuit";
export const normRole = (r, fallback = DEFAULT_ROLE) => (ROLES.includes(r) ? r : fallback);
export const roleOf = (m) => normRole(m && m.role);
