/* kmlExport — B711329: export a SITE RECORD (a `sites` group + everything Planyr holds on it —
 * the leasing comps attached to it) to a Google Earth .kmz, triggered by a right-click on one of
 * its comp markers (the green diamond and its siblings).
 *
 * Deliberately NOT folded into `site-planner/lib/kmzExport.js` (B684's site-PLAN KMZ writer) —
 * that module exports a drawn plan's geometry (buildings, parking, roads…); this exports a
 * DIFFERENT subject (the property's own parcel boundary + its recorded leasing comps, never the
 * plan/concept elements). Per its own scope note, this mirrors its ZIP/KML-writer conventions
 * (hand-rolled, no JSZip — parse/build only, so it stays dependency-free and Node-testable) but
 * hand-rolls its own copy rather than importing across the shared/comps ↔ site-planner-workspace
 * boundary: `shared/` code must not statically depend on a workspace module (see
 * `src/shared/CLAUDE.md`), and this keeps `kmlImport.js`'s established precedent of a
 * self-contained comps KML module.
 *
 * PROJECTION CONTRACT (mirrors kmzExport.js's — one path, not two): every geometry this module
 * receives must ALREADY be WGS84 lon/lat. A site's own parcels are recorded in the planner's
 * foot-space, so the CALLER reprojects them (the same `feetToLatLng` the map already renders
 * with) before calling in — this module never touches a projection. A comp's own anchor
 * (`anchor.lat/lon`, `anchor.parcelGeom`'s GeoJSON coordinates) is already WGS84 by the time it
 * reaches here (real-estate comps are stored/rendered in lon/lat throughout this app), so no
 * reprojection is needed for those.
 *
 * GEOMETRY RULE (owner, explicit): every polygon this module draws is paired with a PIN AT ITS
 * CENTRE (`polygonCentroid`, the same area-weighted centroid `kmlImport.js` already uses and
 * ships unit-tested — reused, never re-derived). The balloon (the placemark's clickable info
 * card) rides on the PIN, never the polygon — a Google Earth polygon balloon is awkward to open,
 * per the owner's own build note.
 */
import { polygonCentroid } from "./kmlImport.js";

export const KMZ_MIME = "application/vnd.google-earth.kmz";

/* ------------------------------- CRC-32 (IEEE) ------------------------------- */
// Hand-rolled, mirroring site-planner/lib/kmzExport.js's own table-driven implementation — kept
// as a second small copy rather than a cross-workspace import (see this file's own header).
let _crcTable = null;
function crcTable() {
  if (_crcTable) return _crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  _crcTable = t;
  return t;
}
export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------- hand-rolled ZIP (STORE only) ---------------------- */
const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
const u32 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// entries: [{ name, bytes:Uint8Array }] -> a ZIP archive (Uint8Array), every entry STORED
// (uncompressed) — a .kmz is exactly this with one entry named `doc.kml`.
export function zipStore(entries) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = e.bytes instanceof Uint8Array ? e.bytes : enc.encode(String(e.bytes));
    const crc = crc32(data);
    const localOffset = offset;
    const local = concatBytes([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), nameBytes, data,
    ]);
    locals.push(local);
    offset += local.length;
    centrals.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(localOffset), nameBytes,
    ]));
  }
  const cd = concatBytes(centrals);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return concatBytes([...locals, cd, eocd]);
}

/* -------------------------------- KML helpers -------------------------------- */
export function xmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// A `<description>` payload is HTML wrapped in CDATA so tags render in Earth's balloon. The one
// thing CDATA cannot carry literally is its own closing token — split it apart if it ever occurs
// (it never should in our own generated markup, only conceivably inside free-typed owner text).
function cdata(html) {
  return `<![CDATA[${String(html || "").replace(/\]\]>/g, "]]" + "&gt;")}]]>`;
}

const num = (n) => Number((+n).toFixed(8)).toString();
function ringCoordStr(ring) {
  return ring.map(([lon, lat]) => `${num(lon)},${num(lat)}`).join(" ");
}
function pointCoordStr([lon, lat]) {
  return `${num(lon)},${num(lat)}`;
}

// #rrggbb (+alpha 0..1) -> KML color (aabbggrr).
function hexToKmlColor(hex, alpha = 1) {
  const h = String(hex || "#000000").replace("#", "").padEnd(6, "0").slice(0, 6);
  const aa = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return `${aa}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

function closeRing(ring) {
  if (!ring || ring.length < 2) return ring || [];
  const [f, l] = [ring[0], ring[ring.length - 1]];
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, f];
}

/* ------------------------------ balloon builder ------------------------------ */
// sections: [{ heading?, rows?: [{label,value}], lines?: [string], links?: [{label,url}] }].
// Plain, inline-styled HTML (an Earth balloon ignores an external stylesheet) — deliberately
// simple: this is a data card, not a designed surface.
export function balloonHtml(sections) {
  const parts = [`<div style="font-family:Arial,sans-serif;font-size:12px;color:#222;line-height:1.45;max-width:320px">`];
  for (const sec of sections || []) {
    if (!sec) continue;
    const hasContent = (sec.rows?.length) || (sec.lines?.length) || (sec.links?.length);
    if (!hasContent && !sec.heading) continue;
    if (sec.heading) parts.push(`<div style="font-weight:bold;font-size:13px;margin:8px 0 3px">${xmlEscape(sec.heading)}</div>`);
    if (sec.rows?.length) {
      parts.push(sec.rows.map((r) => `<div><b>${xmlEscape(r.label)}:</b> ${xmlEscape(r.value)}</div>`).join(""));
    }
    if (sec.lines?.length) {
      parts.push(sec.lines.map((l) => `<div>${xmlEscape(l)}</div>`).join(""));
    }
    if (sec.links?.length) {
      parts.push(sec.links.map((l) => (
        l.url ? `<div><a href="${xmlEscape(l.url)}">${xmlEscape(l.label)}</a></div>` : `<div>${xmlEscape(l.label)}</div>`
      )).join(""));
    }
  }
  parts.push("</div>");
  return parts.join("");
}

/* ----------------------------- feature builders ------------------------------ */
/* A normalized feature (mirrors site-planner/lib/kmzExport.js's shape, plus `description`):
 *   { geom:"point",   name, folder:[…], coord:[lon,lat], style, description? }
 *   { geom:"polygon", name, folder:[…], rings:[outer,…holes], style, description? } */

export function pointFeature({ name, folder, coord, style, description }) {
  return { geom: "point", name, folder: folder || [], coord, style, description };
}
export function polygonFeature({ name, folder, rings, style, description }) {
  return { geom: "polygon", name, folder: folder || [], rings: (rings || []).map(closeRing), style, description };
}

/* A closed ring (already WGS84 lon/lat) -> its own polygon feature PLUS a pin at its centroid —
 * the owner's "every parcel exports as its polygon and a pin at its centre" rule. The two share a
 * name and folder so they read as one thing; the description (balloon) rides the PIN only. Ring
 * degenerate (<3 pts before closing) -> pin alone, no polygon, so a bad ring can't produce an
 * invalid ordinary export failure — the pin is still useful. */
export function ringWithCentroidPin({ name, folder, ring, lineColor, fillColor, fillOpacity = 0.15, iconColor, description }) {
  const closed = closeRing(ring);
  const features = [];
  if (closed.length >= 4) {
    features.push(polygonFeature({
      name, folder,
      rings: [closed],
      style: { line: lineColor || "#33302b", fill: fillColor || null, fillOpacity },
    }));
  }
  const centroid = closed.length >= 3 ? polygonCentroid(closed) : (ring?.[0] ? { lon: ring[0][0], lat: ring[0][1] } : null);
  if (centroid && Number.isFinite(centroid.lon) && Number.isFinite(centroid.lat)) {
    features.push(pointFeature({
      name, folder,
      coord: [centroid.lon, centroid.lat],
      style: { iconColor: iconColor || lineColor || "#33302b" },
      description,
    }));
  }
  return features;
}

/* ------------------------------- KML / KMZ build ----------------------------- */
const styleKey = (s) => (s ? `${s.iconColor || ""}|${s.line || ""}|${s.fill == null ? "none" : s.fill}|${s.fillOpacity ?? 1}` : "");

export function buildKml(name, features) {
  const styleMap = new Map();
  for (const f of features) {
    if (!f.style) continue;
    const k = styleKey(f.style);
    if (!styleMap.has(k)) styleMap.set(k, { id: `s${styleMap.size + 1}`, style: f.style });
  }
  const styleDefs = [...styleMap.values()].map(({ id, style }) => {
    if (style.iconColor) {
      // A colour-tinted circle marker — a lightweight, always-available icon (no separate PNG
      // per hue to keep in sync with compMarkerColor's palette).
      return `<Style id="${id}"><IconStyle><color>${hexToKmlColor(style.iconColor, 1)}</color><scale>1.1</scale>` +
        `<Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle></Style>`;
    }
    const line = `<LineStyle><color>${hexToKmlColor(style.line || "#000000", 1)}</color><width>2</width></LineStyle>`;
    const noFill = style.fill == null || (style.fillOpacity ?? 1) <= 0;
    const poly = noFill
      ? `<PolyStyle><fill>0</fill><outline>1</outline></PolyStyle>`
      : `<PolyStyle><color>${hexToKmlColor(style.fill, style.fillOpacity ?? 1)}</color><outline>1</outline></PolyStyle>`;
    return `<Style id="${id}">${line}${poly}</Style>`;
  }).join("");

  const placemark = (f) => {
    const nm = `<name>${xmlEscape(f.name || "")}</name>`;
    const su = f.style ? `<styleUrl>#${styleMap.get(styleKey(f.style)).id}</styleUrl>` : "";
    const desc = f.description ? `<description>${cdata(f.description)}</description>` : "";
    if (f.geom === "point") return `<Placemark>${nm}${su}${desc}<Point><coordinates>${pointCoordStr(f.coord)}</coordinates></Point></Placemark>`;
    const rings = (f.rings || []).map((ring, i) => {
      const c = `<LinearRing><coordinates>${ringCoordStr(ring)}</coordinates></LinearRing>`;
      return i === 0 ? `<outerBoundaryIs>${c}</outerBoundaryIs>` : `<innerBoundaryIs>${c}</innerBoundaryIs>`;
    }).join("");
    return `<Placemark>${nm}${su}${desc}<Polygon><altitudeMode>clampToGround</altitudeMode>${rings}</Polygon></Placemark>`;
  };

  const root = { sub: new Map(), items: [] };
  for (const f of features) {
    let node = root;
    for (const seg of f.folder || []) {
      if (!node.sub.has(seg)) node.sub.set(seg, { name: seg, sub: new Map(), items: [] });
      node = node.sub.get(seg);
    }
    node.items.push(f);
  }
  const renderNode = (node) =>
    node.items.map(placemark).join("") +
    [...node.sub.values()].map((c) => `<Folder><name>${xmlEscape(c.name)}</name>${renderNode(c)}</Folder>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEscape(name)}</name>${styleDefs}${renderNode(root)}</Document></kml>`;
}

export function buildKmz(name, features) {
  const kml = buildKml(name, features);
  return zipStore([{ name: "doc.kml", bytes: new TextEncoder().encode(kml) }]);
}

// A safe download filename ("Katy — Site A" -> "katy-site-a.kmz").
export function kmzFilename(name) {
  const slug = String(name || "site-record").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site-record";
  return `${slug}.kmz`;
}

/* --------------------------- site record -> features -------------------------- */
/* The one place that turns a resolved site record + its comps into the KMZ's two top-level
 * groups. Deliberately knows nothing about `comps.js`'s field shapes or `siteModel.js`'s —
 * the caller (MapFinder.jsx) resolves every fact and balloon string first, so this stays a pure
 * geometry/KML-structure assembler, unit-testable with plain literals.
 *
 * `parcel`: { rings: [{ring, name}], fallbackPoint: [lon,lat]|null, balloon }
 *   - one ring per drawn parcel (already closed WGS84 lon/lat); each gets its own polygon+pin
 *     pair. The FIRST pin only carries `balloon` (the full site-record card) — repeating it on
 *     every parcel of a multi-parcel assemblage would just show the same card several times.
 *   - `fallbackPoint`: used only when `rings` is empty (a tracked site with no drawn boundary
 *     yet) — a single pin at the site's own origin, carrying the full balloon.
 * `comps`: [{ name, point:[lon,lat]|null, polygonRings:[ring,…]|null, iconColor, lineColor,
 *            fillColor, balloon }]
 *   - a comp with `polygonRings` (a parcel-anchored comp carrying `parcelGeom`) gets a
 *     polygon+pin pair per ring, each pin carrying `balloon`; everything else is a bare pin.
 */
export function siteRecordFeatures({ parcel, comps }) {
  const features = [];
  const p = parcel || {};
  const rings = Array.isArray(p.rings) ? p.rings : [];
  if (rings.length) {
    rings.forEach((r, i) => {
      features.push(...ringWithCentroidPin({
        name: r.name, folder: ["Parcel"], ring: r.ring,
        lineColor: "#33302b", fillColor: null, fillOpacity: 0,
        iconColor: "#33302b",
        description: i === 0 ? p.balloon : undefined,
      }));
    });
  } else if (p.fallbackPoint) {
    features.push(pointFeature({ name: p.name, folder: ["Parcel"], coord: p.fallbackPoint, style: { iconColor: "#33302b" }, description: p.balloon }));
  }

  for (const c of comps || []) {
    if (Array.isArray(c.polygonRings) && c.polygonRings.length) {
      c.polygonRings.forEach((ring) => {
        features.push(...ringWithCentroidPin({
          name: c.name, folder: ["Comps"], ring,
          lineColor: c.lineColor, fillColor: c.fillColor, fillOpacity: 0.18,
          iconColor: c.iconColor, description: c.balloon,
        }));
      });
    } else if (c.point) {
      features.push(pointFeature({ name: c.name, folder: ["Comps"], coord: c.point, style: { iconColor: c.iconColor }, description: c.balloon }));
    }
  }
  return features;
}
