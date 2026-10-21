/* Parcel-ID search for the Site search box (NEW-2, TN non-state counties, 2026-10-21).
 *
 * `resolveParcelId(text)` answers "which lot is this id?" for text that parses as a Tennessee parcel id (tnParcelId.js), by asking each
 * county's OWN layer through the one id/address query (`lookupParcels`). It returns a typed outcome the caller can never mistake for
 * another — LOUD-FAILURE: a missing id is `notfound` (a clear sentence, naming where it looked), a server that did not answer is
 * `unavailable` (a different sentence — the id may well exist), and neither is ever a silent no-op.
 *
 *   { status: "none" }                                         — the text is not an id; the caller geocodes it as before
 *   { status: "found", county, name, canonical, feature, point, label, ambiguous? }
 *   { status: "notfound", tried: ["Davidson", "Rutherford"], canonical }
 *   { status: "unavailable", tried, failed: ["Rutherford"], canonical }
 *
 * `point` is { lat, lng } INSIDE the lot (pole of inaccessibility of its largest outer ring — never a vertex average, which can sit off a
 * strip or an L), so the shared identify-at-a-point selection that follows lands on this lot and no neighbour. Pure but for the injected
 * `lookup`, which tests replace with recorded answers. */
import { COUNTIES } from "./counties.js";
import { lookupParcels, idAttrFor } from "./parcelQuery.js";
import { outerRingsLngLat } from "./esriRings.js";
import { polylabel } from "./polylabel.js";
import { tnParcelIdPlan, pickIdMatch } from "./tnParcelId.js";

/** The point inside a looked-up lot (WGS84 rings in `feature.geometry.rings`), or null when it has no usable polygon. */
export function interiorPointOf(feature) {
  const rings = outerRingsLngLat(feature);
  if (!rings.length) return null;
  const largest = rings.reduce((best, r) => (ringSpan(r) > ringSpan(best) ? r : best), rings[0]);
  const c = polylabel(largest.map(([x, y]) => ({ x, y })), 1e-7);
  return c ? { lat: c.y, lng: c.x } : null;
}
const ringSpan = (r) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return (x1 - x0) * (y1 - y0);
};

export async function resolveParcelId(text, { lookup = lookupParcels, plan = tnParcelIdPlan(text) } = {}) {
  if (!plan.length) return { status: "none" };
  const canonical = plan[0].canonical;
  const settled = await Promise.allSettled(plan.map((p) => lookup({
    county: p.county, lookupUrl: COUNTIES[p.county]?.layerUrl || "", mode: "id", value: p.value,
  })));
  const tried = plan.map((p) => p.name);
  const failed = [];
  const found = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") { failed.push(plan[i].name); return; }
    const feats = (r.value && r.value.feats) || [];
    const pick = pickIdMatch(feats, plan[i].canonical, (f) => idAttrFor(plan[i].county, f.attributes || {}));
    if (pick) found.push({ p: plan[i], feature: pick, ambiguous: false });
    else if (feats.length > 1) found.push({ p: plan[i], feature: feats[0], ambiguous: true });
  });
  /* Nothing found: if any county did not ANSWER, the id may live there — say "couldn't check", never "doesn't exist". */
  if (!found.length) return { status: failed.length ? "unavailable" : "notfound", tried, canonical, ...(failed.length ? { failed } : {}) };
  /* An exact id beats a partial one; between counties, the one whose own id column holds the text exactly wins. */
  const exact = found.find((f) => !f.ambiguous);
  const hit = exact || found[0];
  const point = interiorPointOf(hit.feature);
  if (!point) return { status: "notfound", tried, canonical, reason: "no-geometry" };
  const id = idAttrFor(hit.p.county, hit.feature.attributes || {}) || hit.p.canonical;
  return {
    status: "found", county: hit.p.county, name: hit.p.name, canonical: hit.p.canonical, feature: hit.feature, point,
    label: `Parcel ${id} · ${hit.p.name} County, TN`, ambiguous: hit.ambiguous,
  };
}

/** The owner-facing sentence for a non-found outcome. Plain words, names the counties it asked. */
export function parcelIdMessage(res, typed) {
  const t = String(typed || "").trim();
  const names = res.tried || [];
  const where = names.length > 1 ? `${names.join(" and ")} counties` : `${names[0] || "Tennessee"} County`;
  if (res.status === "unavailable") return `Couldn't reach the ${(res.failed || res.tried || []).join(" / ")} County parcel server just now, so parcel ID "${t}" could not be checked. Try again in a moment.`;
  if (res.status === "notfound") return `No Tennessee parcel with ID "${t}" in ${where}. Check the control map, parcel and special-interest numbers — or type the site address instead.`;
  return "";
}
