/* siteRecordKml — B2010352 (NEW-1/2/3): the PURE assembler behind "Export KMZ" on a comp marker's
 * right-click. It used to live as closures inside MapFinder.jsx, where no test could reach it —
 * which is how three defects shipped in one balloon. It turns a resolved site record + its sibling
 * comps into the `features` array `kmlExport.js` writes; MapFinder.jsx only gathers the inputs.
 *
 * THREE RULES, each one an owner-measured defect (2026-10-01, a parcel-anchored lease comp):
 *  1. LOCATION IS THE PANEL'S LOCATION. A comp balloon's "Location" row is whatever the comp detail
 *     panel shows (`compLocationFor`, the one resolver), never a second derivation — the export's
 *     own had put the raw APN there. The APN has its own row, from `compFieldRows`.
 *  2. THE BALLOON IS THE PANEL'S ROWS, ONCE. Location first, then `compFieldRows` verbatim, in the
 *     panel's order. This module adds no row of its own (it used to add "Executed", which
 *     `compFieldRows` already carries — so the balloon said it twice).
 *  3. OUTLINES WORK WHETHER THEY LIVE ON THE SITE RECORD, ON THE COMP, OR BOTH (owner direction,
 *     2026-10-01). A site's own drawn/selected boundary goes in the Parcel folder in the site style.
 *     A parcel-anchored comp's outline goes with the comp (Comps folder, comp colour), NAMED as the
 *     comp's parcel. When both exist and are the same parcel it is drawn ONCE (the site's). The site
 *     balloon never claims "No boundary drawn yet" while the file holds an outline for that record:
 *     it reports the acreage it can compute, labelled for what it is ("Comp parcel: 22.48 AC").
 *  4. NOTES: the record's map notes (linked by project, or anchored inside the exported outlines /
 *     on their APN) are a Notes folder of pins — title + body in the balloon, escaped like every
 *     other balloon string.
 */
import { compFieldRows, compHeadline, compDateLabel } from "./comps.js";
import { compMarkerColor } from "./compMarkerIcon.js";
import { balloonHtml, buildKml, siteRecordFeatures, pointFeature, polygonFeature } from "./kmlExport.js";
import { polygonCentroid } from "./kmlImport.js";
import { mapNoteHeadline } from "../../mapNotes/lib/mapNotes.js";

/** Outer ring(s) of a comp's parcel-anchor GeoJSON (Polygon | MultiPolygon), WGS84 lon/lat. Holes
 * are dropped; a malformed shape contributes nothing (the comp degrades to its plain pin). */
export function compParcelRings(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return geom.coordinates?.[0] ? [geom.coordinates[0]] : [];
  if (geom.type === "MultiPolygon") return (geom.coordinates || []).map((poly) => poly?.[0]).filter(Boolean);
  return [];
}

// Equirectangular acres for a lon/lat ring — fallback only, for an anchor that recorded no acreage.
function ringAcres(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mPerLat = 111320, mPerLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = [ring[i][0] * mPerLon, ring[i][1] * mPerLat];
    const [x2, y2] = [ring[(i + 1) % ring.length][0] * mPerLon, ring[(i + 1) % ring.length][1] * mPerLat];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2 / 4046.8564224;
}

/** One comp -> the balloon's sections: its heading, then the panel's rows (Location first). */
export function compBalloonSections(comp, { locationText = null, ratePeriod } = {}) {
  const rows = [];
  if (locationText) rows.push({ label: "Location", value: locationText });
  for (const r of compFieldRows(comp, ratePeriod)) rows.push({ label: r.label, value: r.value });
  return [{ heading: comp.title || compHeadline(comp, ratePeriod), rows }];
}

/** One comp -> its `siteRecordFeatures` input: ALWAYS a bare pin (never a polygon — the outline is
 * the site record's, see rule 3). */
export function compKmlInput(comp, { locationText = null, ratePeriod } = {}) {
  return {
    name: comp.title || compHeadline(comp, ratePeriod),
    point: [comp.anchor.lon, comp.anchor.lat],
    iconColor: compMarkerColor(comp.compType),
    balloon: balloonHtml(compBalloonSections(comp, { locationText, ratePeriod })),
  };
}

/** The parcels the comps sit on, de-duplicated (two comps on one property are one parcel):
 * [{ ring, apn, acres, comp }] (comp = the first comp that sits on it). Keyed on APN when there is one, else on the ring's own coordinates. */
export function compParcels(comps) {
  const seen = new Set();
  const out = [];
  for (const c of comps || []) {
    const a = c?.anchor;
    if (a?.kind !== "parcel" || !a.parcelGeom) continue;
    const rings = compParcelRings(a.parcelGeom);
    rings.forEach((ring, i) => {
      const key = a.parcelApn ? `${a.parcelApn}#${i}` : JSON.stringify(ring);
      if (seen.has(key)) return;
      seen.add(key);
      const acres = rings.length === 1 && Number.isFinite(a.acreageAc) ? a.acreageAc : ringAcres(ring);
      out.push({ ring, apn: a.parcelApn || null, acres, comp: c });
    });
  }
  return out;
}

const inRing = (lon, lat, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Is this comp parcel the SAME ground as one of the site's own rings? Same APN (the site parcel's
 * `acct`), or geometrically the same lot: the comp ring's centroid sits inside the site ring and
 * the two areas agree within ~18%. */
export function sameParcel(compParcel, siteRing) {
  if (compParcel.apn && siteRing.acct) {
    const accts = String(siteRing.acct).split(",").map((x) => x.trim());
    if (compParcel.apn.split(",").map((x) => x.trim()).some((x) => accts.includes(x))) return true;
  }
  const c = polygonCentroid(compParcel.ring);
  if (!c || !inRing(c.lon, c.lat, siteRing.ring)) return false;
  const a1 = ringAcres(compParcel.ring), a2 = ringAcres(siteRing.ring);
  return a1 > 0 && a2 > 0 && a1 / a2 > 0.85 && a1 / a2 < 1.18;
}

/** The map notes that belong to this record: linked by project, or anchored on one of the exported
 * outlines (inside the ring, or carrying its APN). Deleted notes never export. */
export function notesForRecord({ notes = [], projectId = null, rings = [], apns = [] }) {
  const apnSet = new Set(apns.filter(Boolean));
  return (notes || []).filter((n) => {
    if (!n || n.deletedAt) return false;
    if (projectId && n.projectId === projectId) return true;
    const a = n.anchor;
    if (a?.parcelApn && [...apnSet].some((x) => String(a.parcelApn).split(",").map((y) => y.trim()).includes(x))) return true;
    return Number.isFinite(a?.lon) && Number.isFinite(a?.lat) && rings.some((r) => inRing(a.lon, a.lat, r));
  });
}

/**
 * @param {object} p
 * @param {string} p.siteName
 * @param {object|null} p.site  { role, status, county, origin:{lat,lon} } labels already resolved; null = no record
 * @param {object} p.boundary   { known, hasBoundary, acres, rings:[{ring,name,acct?}] } — the site's OWN drawn boundary
 * @param {object[]} p.comps    the comps to export (the site's siblings)
 * @param {(c:object)=>string|null} p.locationFor  the panel's Location text for a comp
 * @param {string} [p.ratePeriod]
 * @param {object[]} [p.notes]  map notes (rowToMapNote shape); filtered to this record here
 * @param {string|null} [p.projectId]
 * @param {{name:string}[]|null} [p.documents]
 */
export function siteRecordKmlFeatures({ siteName, site = null, boundary = {}, comps = [], locationFor = () => null, ratePeriod, notes = [], projectId = null, documents = null }) {
  const ownRings = Array.isArray(boundary.rings) ? boundary.rings : [];
  const allParcels = compParcels(comps);
  // Comp outlines that are NOT the same ground as a site ring — these are drawn, with their comp.
  const compOnly = allParcels.filter((cp) => !ownRings.some((r) => sameParcel(cp, r)));

  let acreage;
  if (ownRings.length && boundary.known !== false) acreage = { label: "Acreage", value: `${boundary.acres.toFixed(2)} AC` };
  else if (ownRings.length) acreage = { label: "Acreage", value: "Unknown" };
  else if (compOnly.length) acreage = { label: "Comp parcel", value: `${compOnly.reduce((t, p) => t + (p.acres || 0), 0).toFixed(2)} AC` };
  else acreage = { label: "Acreage", value: boundary.known ? "No boundary drawn yet" : "Unknown" };

  const siteRows = [];
  if (site?.role) siteRows.push({ label: "Role", value: site.role });
  if (site?.status) siteRows.push({ label: "Status", value: site.status });
  if (site?.county) siteRows.push({ label: "County", value: site.county });
  siteRows.push(acreage);
  if (site?.origin) siteRows.push({ label: "Coordinates", value: `${site.origin.lat.toFixed(5)}, ${site.origin.lon.toFixed(5)}` });
  const sections = [{ heading: siteName, rows: siteRows }];
  if (documents) {
    sections.push(documents.length
      ? { heading: "Documents", links: documents.map((d) => ({ label: d.name, url: null })) }
      : { heading: "Documents", lines: ["No documents on file."] });
  }
  sections.push({
    heading: `Comps on this site record (${comps.length})`,
    lines: comps.map((c) => `${c.title || compHeadline(c, ratePeriod)} — ${compDateLabel(c.compDate)}`),
  });

  const features = siteRecordFeatures({
    parcel: {
      rings: ownRings,
      fallbackPoint: !ownRings.length && site?.origin ? [site.origin.lon, site.origin.lat] : null,
      name: siteName,
      balloon: balloonHtml(sections),
    },
    comps: comps.map((c) => compKmlInput(c, { locationText: locationFor(c), ratePeriod })),
  });

  // The comp's own parcel outline: with the comp (Comps folder, comp colour), named as the comp's parcel.
  for (const cp of compOnly) {
    const color = compMarkerColor(cp.comp.compType);
    features.push(polygonFeature({
      name: `${cp.comp.title || compHeadline(cp.comp, ratePeriod)} — comp parcel`,
      folder: ["Comps"], rings: [cp.ring],
      style: { line: color, fill: color, fillOpacity: 0.18 },
    }));
  }

  // The record's map notes: pins in a Notes folder, title + body in the balloon.
  const noteRings = [...ownRings.map((r) => r.ring), ...allParcels.map((p) => p.ring)];
  const apns = [...ownRings.map((r) => r.acct), ...allParcels.map((p) => p.apn)].flatMap((x) => String(x || "").split(","));
  for (const n of notesForRecord({ notes, projectId, rings: noteRings, apns: apns.map((x) => x.trim()) })) {
    if (!Number.isFinite(n.anchor?.lon) || !Number.isFinite(n.anchor?.lat)) continue;
    features.push(pointFeature({
      name: mapNoteHeadline(n), folder: ["Notes"], coord: [n.anchor.lon, n.anchor.lat],
      style: { iconColor: "#a16207" },
      description: balloonHtml([{ heading: mapNoteHeadline(n), lines: String(n.body || "").split("\n").filter((l) => l.trim()) }]),
    }));
  }
  return features;
}

/** The finished doc.kml text — what the .kmz carries. */
export function buildSiteRecordKml(args) {
  return buildKml(args.siteName, siteRecordKmlFeatures(args));
}
