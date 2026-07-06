/* kmzExport.js (B684) — export the current site geometry to a Google Earth .kmz file.
 *
 * WHY THIS EXISTS: a KMZ opens the drawn site (boundary, buildings, parking, truck court,
 * detention, roads…) directly in Google Earth so a client / investor can walk the site in
 * 3D. KML is REQUIRED by spec to be in WGS84 lat/long, so every foot-space vertex is
 * reprojected on the way out. The reprojection is the SAME one the map render already uses
 * (`feetToLatLng`, passed in as `project`) — there is deliberately no second projection path,
 * so the export can never drift from what's on screen.
 *
 * Pure + dependency-free (no JSZip), mirroring imagePdf.js: the .kmz is a hand-rolled ZIP with
 * a single STORED (uncompressed) entry `doc.kml`, so it adds zero bundle weight and is fully
 * unit-testable. This module knows only the KML/KMZ FORMAT and the site→layer MAPPING; the
 * projection lives at the call site (the shared `feetToLatLng`).
 *
 * ⚠ #1 KML gotcha (regression-tested): KML coordinate order is lon,lat,alt — the REVERSE of
 * Leaflet's [lat, lng]. `project(ptFeet)` must return [lon, lat]; every emitter here writes
 * lon before lat. A flipped pair silently plants the whole site in the wrong hemisphere.
 *
 * LOUD-FAILURE: if any vertex reprojects to a non-finite number, `siteToFeatures` THROWS —
 * the caller aborts and surfaces a banner rather than writing a KMZ that's silently missing
 * or misregistered geometry.
 */

import { elStyle, elRingFeet, byZ, TYPE, toHex6 } from "./planStyle.js";
import { isBuilding, buildingNumbers } from "./siteModel.js";
import { effectiveBuildingProps, normalizeRules } from "./buildingProps.js";
import { roadCenterline } from "./roadGeometry.js";
import { bufferPolyline } from "./metesAndBounds.js";
import { dockSidesFor } from "./dockZones.js";
import { placeDockDoors } from "./buildingGrid.js";

export const KMZ_MIME = "application/vnd.google-earth.kmz";
const US_FT_M = 1200 / 3937; // 1 US survey foot in metres (matches the EPSG:2278 grid)
const arr = (v) => (Array.isArray(v) ? v : []);
const ftToMeters = (ft) => ft * US_FT_M;

/* ------------------------------- CRC-32 (IEEE) ------------------------------- */
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
// CRC-32 of a byte array → unsigned 32-bit int (crc32 of "123456789" === 0xCBF43926).
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

// Build a ZIP archive (Uint8Array) with every entry STORED (compression method 0). entries:
// [{ name, bytes:Uint8Array }]. A .kmz is exactly this with one entry named `doc.kml`.
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
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0), // sig, ver, flags, method(0=store), time, date
      u32(crc), u32(data.length), u32(data.length),            // crc, compSize, uncompSize
      u16(nameBytes.length), u16(0), nameBytes, data,          // nameLen, extraLen, name, data
    ]);
    locals.push(local);
    offset += local.length;
    centrals.push(concatBytes([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), // sig, madeBy, needed, flags, method, time, date
      u32(crc), u32(data.length), u32(data.length),                     // crc, compSize, uncompSize
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0),            // nameLen, extraLen, commentLen, diskStart, intAttr
      u32(0), u32(localOffset), nameBytes,                              // extAttr, localHeaderOffset, name
    ]));
  }
  const cd = concatBytes(centrals);
  const eocd = concatBytes([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), // sig, disk, cdDisk, entriesThisDisk, totalEntries
    u32(cd.length), u32(offset), u16(0),                                       // cdSize, cdOffset, commentLen
  ]);
  return concatBytes([...locals, cd, eocd]);
}

/* -------------------------------- KML helpers -------------------------------- */
// XML-escape text used in element content OR attribute values.
export function xmlEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
// Trim a coordinate to 8 decimals (~1 mm) without trailing-zero / exponent noise.
const num = (n) => Number((+n).toFixed(8)).toString();
// A KML <coordinates> string. `coords` = [[lon,lat],…]; `alt` (metres) appended when finite.
function coordStr(coords, alt) {
  const withAlt = Number.isFinite(alt);
  return coords.map(([lon, lat]) => (withAlt ? `${num(lon)},${num(lat)},${Number(alt.toFixed(2))}` : `${num(lon)},${num(lat)}`)).join(" ");
}
// #rrggbb (+ alpha 0..1) → KML color, which is aabbggrr (alpha, blue, green, red).
function hexToKmlColor(hex, alpha = 1) {
  const h = toHex6(hex).replace("#", "");
  const aa = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
  return `${aa}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`;
}

/* ----------------------------- geometry helpers ------------------------------ */
// Shoelace area (ft²) of a ring of {x,y} — used to size a building for its clear-height rule.
function polyAreaFeet(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; a += ring[i].x * ring[j].y - ring[j].x * ring[i].y; }
  return Math.abs(a) / 2;
}
// An element's outline in planner feet. A centreline road (B596) exports its true pavement+curb
// STRIP (buffered centreline); every other element uses the shared box/points ring the map draws.
export function elToRingFeet(el) {
  if (el && el.type === "road" && Array.isArray(el.pts) && el.pts.length >= 2) {
    const dense = roadCenterline(el.pts, el.vtx || [], {});
    if (dense && dense.length >= 2) {
      const width = Math.max(1, (+el.travelW || 0) + 2 * (+el.curb || 0));
      const ring = bufferPolyline(dense, width);
      if (ring && ring.length >= 3) return ring;
    }
  }
  return elRingFeet(el);
}
// Measure records are {mode, pts} (new) or {a,b} (legacy) — normalize to a feet point list.
const measPtsFeet = (m) => (m && m.pts ? m.pts : m && m.a && m.b ? [m.a, m.b] : []);

// Dock-door CENTRE points for a box building, in planner feet. Mirrors the canvas dock-door
// placement (dockSidesFor → dockDoorRun → placeDockDoors): doors sit on each validated dock
// wall, evenly spaced at the door o.c., with any corner bump-out span removed. Column-line
// snapping is dropped for the export (lengthLines = []) — the o.c. spacing is what matters here.
function buildingDockDoorPoints(el, els, settings) {
  if (!el || el.points || !Number.isFinite(el.w) || !Number.isFinite(el.h)) return [];
  const { dockSides } = dockSidesFor(el);
  if (!dockSides.length) return [];
  const doorOC = Math.max(2, +settings.doorOC || 12);
  const doorWidth = Math.max(1, +settings.doorWidth || 9);
  const dogEars = arr(els).filter((x) => x && x.attachedTo === el.id && x.dogEar);
  const hw = el.w / 2, hh = el.h / 2;
  const r = ((el.rot || 0) * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const toWorld = (lx, ly) => ({ x: el.cx + lx * cos - ly * sin, y: el.cy + lx * sin + ly * cos });
  const out = [];
  for (const side of dockSides) {
    const horiz = side === "top" || side === "bottom";
    const L = horiz ? el.w : el.h;
    const bump = (sign) => { const d = dogEars.find((x) => x.dogEar.side === side && x.dogEar.sign === sign); return d ? (horiz ? d.w : d.h) : 0; };
    const startF = bump(-1), endF = L - bump(1);
    if (endF - startF < doorWidth) continue;
    for (const cF of placeDockDoors(startF, endF, [], { doorOC, doorWidth })) {
      const lx = horiz ? -hw + cF : (side === "left" ? -hw : hw);
      const ly = horiz ? (side === "top" ? -hh : hh) : -hh + cF;
      out.push(toWorld(lx, ly));
    }
  }
  return out;
}

/* --------------------------- site → KML feature list ------------------------- */
/* A normalized, projection-agnostic feature:
 *   { geom:"polygon", name, folder:[…], rings:[outer,…holes], style, height?, extrude? }
 *   { geom:"point",   name, folder:[…], coord:[lon,lat], style? }
 *   { geom:"line",    name, folder:[…], coords:[[lon,lat],…], style? }
 * rings/coords/coord are ALREADY [lon,lat] (WGS84). `style` = {line, fill|null, fillOpacity}. */

// Map a site model's drawn geometry to KML features, reprojecting every foot vertex through
// `project(ptFeet) -> [lon, lat]`. Throws (LOUD-FAILURE) if any vertex reprojects to NaN.
// opts: { extrudeBuildings, includeDimensions, prefix:[…outer folder…] }.
export function siteToFeatures(model, project, opts = {}) {
  const parcels = arr(model && model.parcels);
  const els = arr(model && model.els);
  const measures = arr(model && model.measures);
  const settings = (model && model.settings) || {};
  const { extrudeBuildings = false, includeDimensions = false, prefix = [] } = opts;
  const rules = normalizeRules(settings.buildingRules);
  const features = [];
  const F = (...names) => [...prefix, ...names];

  const projPt = (p) => {
    const ll = project(p);
    const lon = ll && ll[0], lat = ll && ll[1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      throw new Error("a vertex could not be reprojected to a valid lat/long (got a non-number) — export aborted so the file can't be silently misregistered");
    }
    return [lon, lat];
  };
  const projClosed = (ringFeet) => {
    const out = ringFeet.map(projPt);
    if (out.length && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
    return out;
  };

  // Boundary (active parcels) — outline only, no fill, so overlays underneath stay visible.
  const boundaryStyle = { line: "#33302b", fill: null, fillOpacity: 0 };
  parcels
    .filter((p) => p && p.active !== false && Array.isArray(p.points) && p.points.length >= 3)
    .forEach((p, i) => features.push({ geom: "polygon", name: p.addr || `Boundary ${i + 1}`, folder: F("Boundary"), rings: [projClosed(p.points)], style: boundaryStyle }));

  // Drawn elements — buildings, parking, trailer, paving, road, pond, sidewalk, landscape.
  const bNums = buildingNumbers(els);
  [...els].sort(byZ).forEach((el) => {
    if (!el || !el.type) return;
    const ring = elToRingFeet(el);
    if (!ring || ring.length < 3) return;
    const st = elStyle(el, settings);
    const style = { line: st.stroke, fill: st.fill, fillOpacity: Math.min(0.92, st.fillOpacity ?? 1) };
    const layer = (TYPE[el.type] && TYPE[el.type].label) || (el.type.charAt(0).toUpperCase() + el.type.slice(1));
    let name = layer, height, extrude = false;
    if (el.type === "building") {
      name = isBuilding(el) ? `Building ${bNums.get(el.id) || ""}`.trim() : "Bump-out";
      if (extrudeBuildings) {
        const h = effectiveBuildingProps(el, polyAreaFeet(ring), rules).clearHeight.value;
        if (Number.isFinite(h) && h > 0) { height = ftToMeters(h); extrude = true; }
      }
    }
    features.push({ geom: "polygon", name, folder: F(layer), rings: [projClosed(ring)], style, height, extrude });

    // Dock doors as point markers (buildings only).
    if (isBuilding(el) && settings.showDocks !== false) {
      for (const pt of buildingDockDoorPoints(el, els, settings)) {
        features.push({ geom: "point", name: "Dock door", folder: F("Dock doors"), coord: projPt(pt) });
      }
    }
  });

  // Dimension lines — optional, default OFF (they clutter a 3D walkthrough).
  if (includeDimensions) {
    measures.forEach((m) => {
      const pts = measPtsFeet(m);
      if (pts.length >= 2) features.push({ geom: "line", name: "Dimension", folder: F("Dimensions"), coords: pts.map(projPt) });
    });
  }
  return features;
}

/* ------------------------------- KML / KMZ build ----------------------------- */
const styleKey = (s) => (s ? `${s.line || ""}|${s.fill == null ? "none" : s.fill}|${s.fillOpacity ?? 1}` : "");

// Build a KML document (string) from a doc name + a normalized feature list.
export function buildKml(name, features) {
  // De-dupe styles → one <Style id> each, referenced by placemarks (keeps the file small).
  const styleMap = new Map();
  for (const f of features) {
    if (!f.style) continue;
    const k = styleKey(f.style);
    if (!styleMap.has(k)) styleMap.set(k, { id: `s${styleMap.size + 1}`, style: f.style });
  }
  const styleDefs = [...styleMap.values()].map(({ id, style }) => {
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
    if (f.geom === "point") return `<Placemark>${nm}${su}<Point><coordinates>${coordStr([f.coord])}</coordinates></Point></Placemark>`;
    if (f.geom === "line") return `<Placemark>${nm}${su}<LineString><tessellate>1</tessellate><coordinates>${coordStr(f.coords)}</coordinates></LineString></Placemark>`;
    const alt = f.extrude ? f.height : undefined;
    const rings = (f.rings || []).map((ring, i) => {
      const c = `<LinearRing><coordinates>${coordStr(ring, alt)}</coordinates></LinearRing>`;
      return i === 0 ? `<outerBoundaryIs>${c}</outerBoundaryIs>` : `<innerBoundaryIs>${c}</innerBoundaryIs>`;
    }).join("");
    const mode = f.extrude ? `<extrude>1</extrude><altitudeMode>relativeToGround</altitudeMode>` : `<altitudeMode>clampToGround</altitudeMode>`;
    return `<Placemark>${nm}${su}<Polygon>${mode}${rings}</Polygon></Placemark>`;
  };

  // Group placemarks into a nested <Folder> tree from each feature's folder-path array.
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

// Assemble a .kmz (Uint8Array): a single STORED `doc.kml` entry.
export function buildKmz(name, features) {
  const kml = buildKml(name, features);
  return zipStore([{ name: "doc.kml", bytes: new TextEncoder().encode(kml) }]);
}

// A safe download filename ("Katy — Site A" → "katy-site-a.kmz").
export function kmzFilename(name) {
  const slug = String(name || "planyr-export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "planyr-export";
  return `${slug}.kmz`;
}
