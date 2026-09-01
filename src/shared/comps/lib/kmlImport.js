/* kmlImport — pure KML parsing for the Google My Maps import path (B849233/NEW-2).
 *
 * Deliberately hand-rolled rather than a general XML library: a KML export from My Maps is a
 * small, well-known tag set (Placemark/name/description/Point/Polygon/coordinates), so a real
 * XML parser would buy correctness this narrow a job doesn't need while adding a dependency and
 * (worse) a DOM requirement — `DOMParser` doesn't exist under Node, and this module has to run
 * inside this repo's Node-environment unit tests same as every other pure lib. Regex/string
 * scanning works in both places.
 *
 * Per the leasing spec: geometry imports CLEANLY (a point is a point; a polygon becomes a
 * centroid pin, later offered a parcel match by the caller). The DESCRIPTION field does NOT
 * import cleanly — Jordan's My Maps descriptions are prose typed over months, often with no
 * date at all — so this module only ever PROPOSES values (by running the description through
 * `compParse.js`'s prose extractor, the exact same engine the paste-grid uses), never commits
 * them. Every placemark becomes one draft row for the caller to show and confirm.
 */
import { parseProseLine } from "./compParse.js";

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return null;
  let text = m[1];
  const cdata = text.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdata) text = cdata[1];
  return text;
}

/** Description text -> readable plain text: <br> becomes a line break, every other tag is
 * stripped, and the common HTML entities are decoded. Never attempts more than that — a My Maps
 * balloon is usually plain text or a couple of <br>-joined lines, and this is a best-effort
 * reader, not an HTML renderer. */
export function kmlDescriptionToText(raw) {
  if (raw == null) return "";
  return decodeEntities(
    String(raw)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  ).replace(/\n{3,}/g, "\n\n").trim();
}

function parseCoordinatePairs(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tuple) => tuple.split(",").map(Number))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .map(([lon, lat]) => [lon, lat]);
}

/** Area-weighted centroid (shoelace formula) of a polygon ring given as [lon,lat] pairs — the
 * geometrically correct "centre" of an irregular shape, unlike a plain vertex average (which
 * skews toward whichever edge was digitized with more points). Falls back to the vertex average
 * on a degenerate (zero-area / collinear) ring. */
export function polygonCentroid(ringLonLat) {
  if (!ringLonLat?.length) return null;
  let pts = ringLonLat;
  const first = pts[0], last = pts[pts.length - 1];
  if (pts.length > 1 && (first[0] !== last[0] || first[1] !== last[1])) pts = [...pts, first];
  if (pts.length < 4) { // fewer than 3 distinct vertices — nothing to compute an area over
    const n = pts.length - (pts.length > 1 ? 1 : 0) || pts.length;
    const sample = pts.slice(0, n || pts.length);
    const lon = sample.reduce((s, p) => s + p[0], 0) / sample.length;
    const lat = sample.reduce((s, p) => s + p[1], 0) / sample.length;
    return { lon, lat };
  }
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-12) {
    const n = pts.length - 1;
    const lon = pts.slice(0, n).reduce((s, p) => s + p[0], 0) / n;
    const lat = pts.slice(0, n).reduce((s, p) => s + p[1], 0) / n;
    return { lon, lat };
  }
  return { lon: cx / (6 * a), lat: cy / (6 * a) };
}

function extractGeometry(block) {
  const pointBlock = extractTag(block, "Point");
  if (pointBlock) {
    const coordText = extractTag(pointBlock, "coordinates");
    const pairs = parseCoordinatePairs(coordText);
    if (pairs.length) return { kind: "point", lon: pairs[0][0], lat: pairs[0][1] };
  }
  const polyBlock = extractTag(block, "Polygon");
  if (polyBlock) {
    const outer = extractTag(polyBlock, "outerBoundaryIs") || polyBlock;
    const ringBlock = extractTag(outer, "LinearRing") || outer;
    const coordText = extractTag(ringBlock, "coordinates");
    const ring = parseCoordinatePairs(coordText);
    if (ring.length >= 3) {
      const centroid = polygonCentroid(ring);
      return { kind: "polygon", ring, centroid };
    }
  }
  return null;
}

/** Every `<Placemark>` in a KML document -> `{ name, description, geometry }`. Geometry is null
 * for a placemark with neither a Point nor a Polygon (a folder marker, a line-only feature the
 * app has no use for yet, etc) — the caller decides what to do with a geometry-less placemark
 * (currently: still shown as a draft, flagged as needing a location, same as a hand-typed row
 * with no anchor). */
export function parseKmlPlacemarks(kmlText) {
  const text = String(kmlText || "");
  const blocks = text.match(/<Placemark[^>]*>[\s\S]*?<\/Placemark>/gi) || [];
  return blocks.map((block) => ({
    name: extractTag(block, "name")?.trim() || null,
    description: kmlDescriptionToText(extractTag(block, "description")),
    geometry: extractGeometry(block),
  }));
}

/** One parsed placemark -> the shape `comp_import_drafts` stores: the raw facts untouched, plus
 * a best-effort `proposed` extraction run over the description text through the SAME prose
 * parser the paste-grid uses (never a second, drifting extraction engine). */
export function placemarkToDraftRow(placemark, { sourceFile } = {}) {
  const rawGeometry = !placemark.geometry ? null
    : placemark.geometry.kind === "point"
      ? { kind: "point", lat: placemark.geometry.lat, lon: placemark.geometry.lon }
      : { kind: "polygon", ring: placemark.geometry.ring, centroidLat: placemark.geometry.centroid?.lat, centroidLon: placemark.geometry.centroid?.lon };

  const parsed = placemark.description ? parseProseLine(placemark.description) : { draft: null, cellFlags: {} };

  return {
    source: "kml",
    source_file: sourceFile || null,
    raw_name: placemark.name,
    raw_description: placemark.description || null,
    raw_geometry: rawGeometry,
    proposed: parsed.draft ? { ...parsed.draft, title: parsed.draft.title || placemark.name || "", cellFlags: parsed.cellFlags } : { title: placemark.name || "", cellFlags: {} },
    status: "pending",
  };
}

/** A whole KML document -> the array of draft rows ready for `compDraftsStore.insertDrafts`. */
export function kmlToDraftRows(kmlText, opts) {
  return parseKmlPlacemarks(kmlText).map((p) => placemarkToDraftRow(p, opts));
}
