/* kmlImport — pure KML parsing for the Google My Maps import path (B849233/NEW-2), plus the
 * .kmz (zipped KML) reader that lets this same path read Planyr's own KMZ export back
 * (NEW-1/B1577424) — a Google Earth "My Places" export is .kmz far more often than bare .kml,
 * and `kmlExport.js` (B711329) writes .kmz too, so without this the app could not import its
 * own file.
 *
 * Deliberately hand-rolled rather than a general XML/zip library: a KML export from My Maps is a
 * small, well-known tag set (Placemark/name/description/Point/Polygon/coordinates), so a real
 * XML parser would buy correctness this narrow a job doesn't need while adding a dependency and
 * (worse) a DOM requirement — `DOMParser` doesn't exist under Node, and this module has to run
 * inside this repo's Node-environment unit tests same as every other pure lib. Regex/string
 * scanning works in both places. The .kmz reader mirrors `docxText.js`'s own ZIP-central-
 * directory reader (a .docx is the same container format) — a plain ZIP central-directory walk
 * + the platform's native `DecompressionStream("deflate-raw")` for a DEFLATE entry — rather than
 * adding JSZip; it handles both STORE (method 0, what this repo's own `kmlExport.js` writes) and
 * DEFLATE (method 8, what Google Earth writes).
 *
 * Per the leasing spec: geometry imports CLEANLY (a point is a point; a polygon becomes a
 * centroid pin, later offered a parcel match by the caller). The DESCRIPTION field does NOT
 * import cleanly — Jordan's My Maps descriptions are prose typed over months, often with no
 * date at all — so this module only ever PROPOSES values (by running the description through
 * `compParse.js`'s single-record extractor, the exact same engine the paste-grid uses for a
 * multi-line abstract), never commits them. A placemark is definitionally ONE deal, so its
 * description is always treated as a single record regardless of how many lines it spans —
 * never split into several rows the way a genuine per-line LIST would be. Every placemark
 * becomes one draft row for the caller to show and confirm.
 */
import { parseSingleRecord } from "./compParse.js";

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
 * a best-effort `proposed` extraction run over the WHOLE description text through the SAME
 * single-record parser the paste-grid uses for an abstract (never a second, drifting extraction
 * engine, and never split line-by-line — one placemark is one deal). */
export function placemarkToDraftRow(placemark, { sourceFile } = {}) {
  const rawGeometry = !placemark.geometry ? null
    : placemark.geometry.kind === "point"
      ? { kind: "point", lat: placemark.geometry.lat, lon: placemark.geometry.lon }
      : { kind: "polygon", ring: placemark.geometry.ring, centroidLat: placemark.geometry.centroid?.lat, centroidLon: placemark.geometry.centroid?.lon };

  const parsed = placemark.description ? parseSingleRecord(placemark.description) : null;

  return {
    source: "kml",
    source_file: sourceFile || null,
    raw_name: placemark.name,
    raw_description: placemark.description || null,
    raw_geometry: rawGeometry,
    proposed: parsed ? { ...parsed.draft, title: parsed.draft.title || placemark.name || "", cellFlags: parsed.cellFlags } : { title: placemark.name || "", cellFlags: {} },
    status: "pending",
  };
}

/** A whole KML document -> the array of draft rows ready for `compDraftsStore.insertDrafts`. */
export function kmlToDraftRows(kmlText, opts) {
  return parseKmlPlacemarks(kmlText).map((p) => placemarkToDraftRow(p, opts));
}

/* ------------------------------- .kmz (zipped KML) ---------------------------- */
const zu16 = (dv, o) => dv.getUint16(o, true);
const zu32 = (dv, o) => dv.getUint32(o, true);

const ZIP_EOCD_SIG = 0x06054b50; // PK\x05\x06 — end of central directory
const ZIP_CEN_SIG = 0x02014b50;  // PK\x01\x02 — central directory file header
const ZIP_LOC_SIG = 0x04034b50;  // PK\x03\x04 — local file header

// Find the End Of Central Directory record by scanning backward from the end (it sits in the
// last 22 bytes + an optional ≤64 KB comment) — same approach `docxText.js` uses for a .docx.
function findZipEOCD(dv) {
  const len = dv.byteLength;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    if (zu32(dv, i) === ZIP_EOCD_SIG && i + 22 + zu16(dv, i + 20) === len) return i;
  }
  return -1;
}

// Inflate raw DEFLATE bytes via the native stream API -> Uint8Array (mirrors docxText.js).
async function kmzInflateRaw(bytes) {
  try {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    throw new Error("Couldn't read that .kmz (a compressed entry inside it failed to unzip).");
  }
}

// Every entry in a ZIP's central directory -> [{name, method, compSize, localOff}]. Throws a
// friendly, specific error for a file that isn't a ZIP at all or whose directory is truncated.
function listZipEntries(dv, bytes) {
  const eocd = findZipEOCD(dv);
  if (eocd < 0) throw new Error("Couldn't read that file as a .kmz (it isn't a valid ZIP archive).");
  const count = zu16(dv, eocd + 10);
  let p = zu32(dv, eocd + 16);
  const dec = new TextDecoder("utf-8");
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) throw new Error("Couldn't read that .kmz (its archive directory is truncated).");
    if (zu32(dv, p) !== ZIP_CEN_SIG) break;
    const method = zu16(dv, p + 10);
    const compSize = zu32(dv, p + 20);
    const nameLen = zu16(dv, p + 28);
    const extraLen = zu16(dv, p + 30);
    const commentLen = zu16(dv, p + 32);
    const localOff = zu32(dv, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readZipEntryBytes(bytes, dv, entry) {
  const { method, compSize, localOff } = entry;
  if (localOff + 30 > bytes.length || zu32(dv, localOff) !== ZIP_LOC_SIG) {
    throw new Error("Couldn't read that .kmz (a corrupt entry header).");
  }
  const lNameLen = zu16(dv, localOff + 26);
  const lExtraLen = zu16(dv, localOff + 28);
  const dataStart = localOff + 30 + lNameLen + lExtraLen;
  if (dataStart + compSize > bytes.length) throw new Error("Couldn't read that .kmz (a truncated entry).");
  const data = bytes.subarray(dataStart, dataStart + compSize);
  if (method === 0) return data; // stored
  if (method === 8) return kmzInflateRaw(data); // deflate
  throw new Error(`Couldn't read that .kmz (unsupported compression method ${method}).`);
}

/** A .kmz ArrayBuffer -> the KML text of its `doc.kml` (or first `*.kml`) entry. Every failure
 * mode gets its OWN message rather than sharing one generic "couldn't import" string: not a ZIP
 * at all, a ZIP with no .kml entry inside (a plain .zip renamed to .kmz lands here too), and a
 * corrupt/truncated entry. */
export async function kmzToKmlText(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const entries = listZipEntries(dv, bytes);
  const kmlEntry = entries.find((e) => e.name.toLowerCase() === "doc.kml")
    || entries.find((e) => /\.kml$/i.test(e.name));
  if (!kmlEntry) throw new Error("That .kmz doesn't contain a .kml file inside it.");
  const data = await readZipEntryBytes(bytes, dv, kmlEntry);
  return new TextDecoder("utf-8").decode(data);
}

/** A whole .kmz ArrayBuffer -> the array of draft rows, same shape `kmlToDraftRows` returns —
 * everything downstream of getting the KML text out is identical for either format. */
export async function kmzToDraftRows(arrayBuffer, opts) {
  const kmlText = await kmzToKmlText(arrayBuffer);
  return kmlToDraftRows(kmlText, opts);
}
