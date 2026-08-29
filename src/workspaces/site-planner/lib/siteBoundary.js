// B849344 — the ONE answer to "does this site have a boundary, and how big is it" for the Sites
// panel and the map pin (MapFinder.jsx). Split out as a pure module (rather than left as
// MapFinder.jsx locals) so it's unit-testable like every other geometry decision in this repo.
//
// The trap this closes: `site.parcels` is a mirror of the site row's jsonb `data.parcels` — for
// a signed-in, element-synced plan that field has been kept EMPTY on every cloud push since the
// B672 element-sync cutover (see cloudSync.js's slimForCloud). The real geometry lives in
// `site_elements` rows (kind='parcel'); `parcelSummary` (built once per session by
// cloudSync.cloudParcelSummary, from those exact rows) is the canonical source whenever it has
// loaded. A site absent from a successfully-loaded summary genuinely has no live parcel rows —
// `site.parcels` is then the right fallback for BOTH remaining cases: a genuinely blank cloud
// site (whose jsonb mirror is correctly empty too) and a signed-out / local-only site, which has
// no `site_elements` at all and for which `parcels` IS the live store.
import { dissolvedParcelSqft } from "./polyClip.js";

// Acreage of a stored site from its planner-feet parcels. B715: dissolve the ACTIVE parcels so
// overlapping ground counts once (matches the planner's siteSqft), instead of an additive sum over
// EVERY parcel — the old version double-counted overlaps AND summed inactive/superseded parcels too.
export function siteAcres(site) {
  if (!site.parcels?.length) return 0;
  return dissolvedParcelSqft(site.parcels) / 43560;
}

// `parcelSummary` is `null` until it has loaded at least once (never fetched, or every attempt
// so far has failed) — in that state the answer is UNKNOWN, never a confident "no boundary" /
// 0.0 AC (LOUD-FAILURE). Once loaded, `parcelSummary[site.id]` (from summarizeParcelRows) wins
// when present; otherwise `site.parcels` is used, which is correct for both remaining cases.
export function siteBoundaryInfo(site, parcelSummary) {
  if (!parcelSummary) return { known: false, hasBoundary: false, acres: 0 };
  const canon = parcelSummary[site.id];
  const acres = canon ? canon.acres : siteAcres(site);
  return { known: true, hasBoundary: acres > 0, acres };
}

// The parcel geometry to actually DRAW for a site — same canonical-over-legacy precedence as
// siteBoundaryInfo, so the map picture and the acreage number it's asked to match (rule: a
// number the user acts on must never come from a different source than the picture) never
// disagree. Returns [] (never null) so callers can iterate unconditionally.
export function siteDrawParcels(site, parcelSummary) {
  const canon = parcelSummary && parcelSummary[site.id];
  if (canon) return canon.parcels;
  return site.parcels || [];
}
