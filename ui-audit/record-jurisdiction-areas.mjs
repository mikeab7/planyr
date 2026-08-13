#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * record-jurisdiction-areas — THE AREA FIXTURES, RECORDED LIVE.
 *
 * ⛔ NEW-2/NEW-3 — the five fixtures in `test/fixtures/jurisdictionShapes.json` were recorded before
 * the identify asked for boundary GEOMETRY, so they carry attribute rows only and can exercise the
 * point-probe fallback and nothing else. A share is an area fraction on the real ring, so a fixture
 * that can fail on a wrong share has to carry the real polygons — including their interior holes,
 * which is the whole of rule 1 (Baytown's main body has 18 of them).
 *
 * WHAT IT RECORDS, per site: the site's own active parcel rings AS STORED (feet, plan frame, with
 * their production element ids), plus every jurisdiction polygon within a 3 km margin of the site,
 * from each source the app routes there.
 *
 * ⚠ THE POLYGONS ARE CLIPPED TO THAT MARGIN BOX, and that is a deliberate, bounded reduction:
 * TxGIO's Baytown feature alone is 335 KB as published and the fixture would be most of a megabyte.
 * The clip cannot change any share (the parcels are nowhere near the box edge) and cannot change any
 * distance the tests assert (the furthest is under 1.5 km, the margin is 3 km). It is recorded on
 * the fixture as `clippedToMarginKm` so no later reader mistakes a box edge for a jurisdiction line.
 *
 * Usage:  node ui-audit/record-jurisdiction-areas.mjs [--out test/fixtures/jurisdictionAreas.json]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ClipperLib from "clipper-lib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const { feetToLatLngPair } = await import(path.join(ROOT, "src/workspaces/site-planner/lib/mapLock.js"));
const { GIS_SOURCES } = await import(path.join(ROOT, "src/shared/gis/sources.js"));

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : path.join(ROOT, "test/fixtures/jurisdictionAreas.json");
const MARGIN_KM = 3;

/* The two sites, with their production element rows as read from `public.site_elements` on
 * 2026-08-12. `active` mirrors the column exactly ("" = the field is absent, which the model reads
 * as active — `activeParcelsOf` is `p.active !== false`). */
const SITES = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/jurisdiction-area-parcels.json"), "utf8"));

const SOURCES = {
  city: GIS_SOURCES.city.serviceUrl,
  city_baytown: GIS_SOURCES.city_baytown.serviceUrl,
  etj_baytown: GIS_SOURCES.etj_baytown.serviceUrl,
  county: GIS_SOURCES.county.serviceUrl,
};

const q = async (url, params) => {
  const u = new URL(url + "/query");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
      const j = await r.json();
      if (!j.error) return j;
      if (attempt === 3) throw new Error(JSON.stringify(j.error));
    } catch (e) { if (attempt === 3) throw e; }
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  return null;
};

const SCALE = 1e7;
const box = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]];
const toPath = (r) => r.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) }));
const fromPath = (p) => p.map(({ X, Y }) => [Math.round((X / SCALE) * 1e6) / 1e6, Math.round((Y / SCALE) * 1e6) / 1e6]);

/* Clip one ESRI polygon to the margin box, preserving the outer/hole winding the reader depends on
 * (`esriPolygons` splits on it). Clipper's PolyTree gives the nesting back explicitly. */
function clipRings(rings, bbox) {
  const c = new ClipperLib.Clipper();
  for (const r of rings) c.AddPath(toPath(r), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toPath(box(...bbox)), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  const out = [];
  const walk = (node) => {
    for (const child of node.Childs()) {
      const ring = fromPath(child.Contour());
      if (ring.length >= 3) {
        // ESRI convention: outer clockwise (negative shoelace), hole counter-clockwise.
        let a = 0;
        for (let i = 0; i < ring.length; i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
          a += x1 * y2 - x2 * y1;
        }
        const wantNeg = !child.IsHole();
        out.push(a < 0 === wantNeg ? ring : ring.slice().reverse());
      }
      walk(child);
    }
  };
  walk(tree);
  return out;
}

const shapes = [];
for (const site of SITES.sites) {
  const rings = site.parcels.map((p) => p.pts.split(",").map((s) => {
    const [x, y] = s.trim().split(" ").map(Number);
    const [lat, lon] = feetToLatLngPair({ x, y }, site.origin.lat, site.origin.lon);
    return [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
  }));
  const flat = rings.flat();
  const mLat = MARGIN_KM * 1000 / 111132;
  const mLon = mLat / Math.cos((site.origin.lat * Math.PI) / 180);
  const bbox = [
    Math.min(...flat.map((p) => p[0])) - mLon, Math.min(...flat.map((p) => p[1])) - mLat,
    Math.max(...flat.map((p) => p[0])) + mLon, Math.max(...flat.map((p) => p[1])) + mLat,
  ];
  const answers = {};
  for (const [id, url] of Object.entries(SOURCES)) {
    const j = await q(url, {
      geometry: JSON.stringify({ rings: [box(...bbox)], spatialReference: { wkid: 4326 } }),
      geometryType: "esriGeometryPolygon", inSR: 4326, outSR: 4326,
      spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: true,
      geometryPrecision: 6, f: "json",
    });
    answers[id] = {
      features: (j.features || []).map((f) => ({
        attributes: f.attributes,
        geometry: f.geometry && f.geometry.rings ? { rings: clipRings(f.geometry.rings, bbox) } : f.geometry || null,
      })).filter((f) => !f.geometry || !f.geometry.rings || f.geometry.rings.length),
    };
    process.stderr.write(`${site.site} ${id}: ${answers[id].features.length} features\n`);
  }
  shapes.push({ ...site, bbox, answers });
}

const out = {
  _note: "AREA fixtures — real parcel rings from public.site_elements, real jurisdiction polygons from the agencies' own services, WITH geometry (the shapes fixtures carry attributes only and predate the area pass).",
  _clippedToMarginKm: MARGIN_KM,
  _clipCaveat: "Jurisdiction polygons are clipped to a margin box around each site. A box edge is NOT a jurisdiction line; no assertion in the suite reads a distance beyond the margin.",
  _queriedAt: new Date().toISOString().slice(0, 10),
  sites: shapes,
};
fs.writeFileSync(OUT, JSON.stringify(out));
process.stderr.write(`✓ ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)\n`);
