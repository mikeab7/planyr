// Audit M3 (I3, B2671310): every ArcGIS JSON request in site-planner goes through gisFetch.fetchArcgisJson (one place for
// source-scan: the guard IS a scan for raw fetch( calls; there is no runtime to exercise for "a file nobody wrote yet".
// the timeout, the GET/POST URL-length switch, typed errors). A NEW raw fetch() to an ArcGIS REST URL fails this test.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../src/workspaces/site-planner");
// Files allowed a raw fetch, each with the reason. Everything else that calls fetch( is not an ArcGIS REST JSON call.
const EXEMPT = {
  "lib/gisFetch.js": "the helper itself",
  "lib/parcelQueryWorker.js": "worker half of the parcel outline engine; its done-messages use esri-leaflet's own error shapes",
  "lib/parcelQueryTransport.js": "main-thread fallback of that same worker (esri-leaflet error shapes, per-tile abort)",
  "lib/siteChecksWorker.js": "the worker end of fetchArcgisJson's own transport (siteChecksTransport)",
  "lib/siteChecksTransport.js": "the fetchImpl handed to fetchArcgisJson",
  "lib/parcelSnapshotWorker.js": "same-origin saved-copy files, not an ArcGIS REST URL",
  "lib/floodArchiveSource.js": "injected fetchImpl for the flood archive (static files)",
  "lib/adminBoundaryLayer.js": "static boundary files", "lib/floodManifest.js": "static manifest", "lib/harrisTaxRates.js": "static rates file",
  "lib/evidenceLayers.js": "Overpass / Mapillary, not ArcGIS", "lib/placeSuggest.js": "geocoder, not ArcGIS",
  "lib/layers.js": "tile metadata probe (B445 proxy), not a JSON query", "lib/exportSheet.js": "image blobs",
  "lib/elementApi.js": "Supabase RPC, not ArcGIS",
};

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== "node_modules") walk(p, out); }
    else if (/\.(js|jsx)$/.test(f.name)) out.push(p);
  }
  return out;
}

describe("GIS fetch routing (audit M3)", () => {
  it("no raw fetch() outside the exempt list", () => {
    const bad = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).split(path.sep).join("/");
      if (EXEMPT[rel]) continue;
      const src = fs.readFileSync(file, "utf8").split("\n");
      src.forEach((line, i) => {
        if (/(^|[^.\w])fetch\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) bad.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad, "route this through gisFetch.fetchArcgisJson, or add the file to EXEMPT with a reason").toEqual([]);
  });
  it("every exempt file still exists (no stale exemptions)", () => {
    for (const rel of Object.keys(EXEMPT)) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });
});
