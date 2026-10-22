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
import { COUNTIES, COUNTIES_MAP } from "./counties.js";
import { lookupParcels, lookupParcelsWhere, idAttrFor } from "./parcelQuery.js";
import { outerRingsLngLat } from "./esriRings.js";
import { polylabel } from "./polylabel.js";
import { tnParcelIdPlan, pickIdMatch, linkMatch, parseStoredLink, storedPartsFromColumns } from "./tnParcelId.js";

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

const layerUrlOf = (key) => (COUNTIES[key] && COUNTIES[key].layerUrl) || (COUNTIES_MAP[key] && COUNTIES_MAP[key].layerUrl) || "";
const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const km = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The stored parts of a returned lot for a link-kind plan item (the Comptroller layer's CMAP/GP/PARCEL columns, else the source's own link column). */
const storedLinkOf = (p, attrs) => (p.src && p.src.statewide ? storedPartsFromColumns(attrs) : parseStoredLink(attrs && p.src && attrs[p.src.linkField]));

export async function resolveParcelId(text, { lookup = lookupParcels, lookupWhere = lookupParcelsWhere, plan = tnParcelIdPlan(text), near = null, retryMs = 400 } = {}) {
  if (!plan.length) return { status: "none" };
  const canonical = plan[0].canonical;
  /* A source that does not answer is asked once more: the state's layer is the slowest in the app (a first, cold ask measured 5–6 s against an 8 s limit), and "couldn't check" is the
   * wrong thing to tell someone whose id exists. The retry never turns a failure into a pass — a second failure is `unavailable`. */
  const ask = async (p) => {
    const run = () => (p.where
      ? lookupWhere({ county: p.county, lookupUrl: layerUrlOf(p.county), where: p.where })
      : lookup({ county: p.county, lookupUrl: layerUrlOf(p.county), mode: "id", value: p.value }));
    try { return await run(); } catch (_e) { await sleep(retryMs); return run(); }
  };
  const settled = await Promise.allSettled(plan.map(ask));
  const tried = [...new Set(plan.map((p) => p.name))];
  const failed = [];
  const found = []; // { p, feature, ambiguous, exact, countyName }
  const nameOf = (p, feature) => (p.src && p.src.statewide ? `${titleCase((feature.attributes || {}).COUNTY_NAME) || "Tennessee"}` : p.name);
  settled.forEach((r, i) => {
    const p = plan[i];
    if (r.status === "rejected") { if (!failed.includes(p.name)) failed.push(p.name); return; }
    const feats = (r.value && r.value.feats) || [];
    if (p.kind === "link") {
      /* the id exactly as the card shows it (spaces and punctuation aside) is the strongest reading — it tells apart the condo units of one parcel, which share their link */
      const shown = (f) => String(idAttrFor(p.county, f.attributes || {}) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const scored = feats.map((f) => ({ f, sc: shown(f) && shown(f) === p.typed ? 3 : linkMatch(storedLinkOf(p, f.attributes || {}), p.form) })).filter((x) => x.sc > 0);
      if (!scored.length) return;
      const best = Math.max(...scored.map((x) => x.sc));
      const top = scored.filter((x) => x.sc === best);
      const perCounty = new Map();
      top.forEach((x) => { const c = nameOf(p, x.f); perCounty.set(c, (perCounty.get(c) || 0) + 1); });
      top.forEach((x) => { const c = nameOf(p, x.f); found.push({ p, feature: x.f, ambiguous: perCounty.get(c) > 1 || best < 2, exact: best >= 2 && perCounty.get(c) === 1, countyName: c }); });
      return;
    }
    if (p.kind === "paid") {
      const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const hit = feats.find((f) => norm((f.attributes || {}).PAID) === norm(p.canonical)) || (feats.length === 1 ? feats[0] : null);
      if (hit) found.push({ p, feature: hit, ambiguous: false, exact: true, countyName: p.name });
      return;
    }
    const pick = pickIdMatch(feats, p.canonical, (f) => idAttrFor(p.county, f.attributes || {}));
    if (pick) found.push({ p, feature: pick, ambiguous: false, exact: true, countyName: p.name });
    else if (feats.length > 1) found.push({ p, feature: feats[0], ambiguous: true, exact: false, countyName: p.name });
  });
  /* Nothing found: if any county did not ANSWER, the id may live there — say "couldn't check", never "doesn't exist". */
  if (!found.length) return { status: failed.length ? "unavailable" : "notfound", tried, canonical, ...(failed.length ? { failed } : {}) };
  /* An exact, single match beats a partial one. Several counties may hold the same control-map number (it repeats across the state), so among equals the lot nearest the map wins
   * and the others are named — `alsoIn` — rather than silently dropped. */
  const withPoint = found.map((f) => ({ ...f, point: interiorPointOf(f.feature) })).filter((f) => f.point);
  if (!withPoint.length) return { status: "notfound", tried, canonical, reason: "no-geometry" };
  const tier = (f) => (f.exact ? 0 : f.ambiguous ? 2 : 1);
  withPoint.sort((a, b) => tier(a) - tier(b) || (near ? km(a.point, near) - km(b.point, near) : 0));
  const hit = withPoint[0];
  const alsoIn = [...new Set(withPoint.filter((f) => tier(f) === tier(hit) && f.countyName !== hit.countyName).map((f) => f.countyName))];
  const id = idAttrFor(hit.p.county, hit.feature.attributes || {}) || hit.p.canonical;
  return {
    status: "found", county: hit.p.county, name: hit.countyName, canonical: hit.p.canonical, feature: hit.feature, point: hit.point,
    label: `Parcel ${id} · ${hit.countyName} County, TN${alsoIn.length ? ` · also in ${alsoIn.join(", ")}` : ""}`, ambiguous: hit.ambiguous, ...(alsoIn.length ? { alsoIn } : {}),
  };
}

/** The owner-facing sentence for a non-found outcome. Plain words, names the counties it asked. */
export function parcelIdMessage(res, typed) {
  const t = String(typed || "").trim();
  const names = res.tried || [];
  const where = names.length > 3 ? "any Tennessee county's parcel layer" : names.length > 1 ? `${names.join(" and ")} counties` : `${names[0] || "Tennessee"} County`;
  const nm = (n) => (n === "Tennessee" ? "Tennessee statewide" : `${n} County`);
  if (res.status === "unavailable") return `Couldn't reach the ${(res.failed || res.tried || []).map(nm).join(" / ")} parcel server just now, so parcel ID "${t}" could not be checked. Try again in a moment.`;
  if (res.status === "notfound") return `No Tennessee parcel with ID "${t}" in ${where}. Check the control map, parcel and special-interest numbers — or type the site address instead.`;
  return "";
}
