/* record-chehaw-screen-polygons — records the REAL FEMA flood-zone and NWI wetland polygons Site Analysis receives for
 * the Chehaw Rd parcel (218 02007, Spalding Co., GA — the owner's "Georgia Test Site"), with the exact query
 * siteChecksRun.fetchPolygons sends, into test/fixtures/chehaw-218-02007.screen.json. That answer is what froze the
 * planner for 6 s on the owner's machine (problem report 6cea9895): a county-scale Zone X polygon measured through
 * clipper unwindowed. The fetch runs inside a planyr.io page (Chromium's trust store; FEMA has no CORS issue there).
 *   node ui-audit/record-chehaw-screen-polygons.mjs */
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { siteWindow, clipRingToWindow } from "../src/workspaces/site-planner/lib/jurisdictionShare.js";

/* The full answer is ~16 MB (one 702,524-vertex Zone X polygon), too big to commit. The fixture keeps every polygon cut to
 * a 1,500 m box around the parcel — real geometry, thirty times the 50 m window siteChecks measures inside — plus the full
 * answer's per-feature vertex counts and the measurement taken on the FULL answer, so the test can prove the cut changes
 * nothing. */
const TRIM_PAD_M = 1500;

const F = new URL("../test/fixtures/chehaw-218-02007", import.meta.url).pathname;
const ring = JSON.parse(readFileSync(F + ".parcel.json", "utf8")).ringLngLat;
const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("https://planyr.io/", { waitUntil: "domcontentloaded" });
await assertMeasurable(page, "record-chehaw-screen-polygons");
const q = (key) => {
  const s = GIS_SOURCES[key];
  const outFields = (s.outFields && s.outFields.join(",")) || Object.values(s.fields).filter(Boolean).join(",");
  return { url: s.serviceUrl, layers: Array.isArray(s.layerId) ? s.layerId : [s.layerId], outFields };
};
const out = { recorded: new Date().toISOString(), parcel: "218 02007", ringLngLat: ring };
for (const key of ["flood", "wetlands"]) {
  const src = q(key);
  out[key] = await page.evaluate(async ({ src, ring }) => {
    const feats = [];
    for (const layer of src.layers) {
      const p = new URLSearchParams({ f: "json", where: "1=1", geometry: JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPolygon",
        spatialRel: "esriSpatialRelIntersects", inSR: "4326", outSR: "4326", outFields: src.outFields, returnGeometry: "true", geometryPrecision: "6", resultRecordCount: "1000" });
      const r = await fetch(`${src.url}/${layer}/query`, { method: "POST", body: p, headers: { "content-type": "application/x-www-form-urlencoded" } });
      const j = await r.json();
      if (!Array.isArray(j.features)) throw new Error(JSON.stringify(j).slice(0, 300));
      if (j.exceededTransferLimit) throw new Error("truncated");
      for (const f of j.features) feats.push({ attrs: f.attributes, rings: f.geometry.rings });
    }
    return feats;
  }, { src, ring });
  console.log(key, out[key].length, "features,", out[key].reduce((a, f) => a + f.rings.reduce((b, r) => b + r.length, 0), 0), "vertices");
}
const { measureFlood, measureWetlands } = await import("../src/workspaces/site-planner/lib/siteChecks.js");
out.fullMeasure = {
  flood: measureFlood([ring], [], out.flood.map((f) => ({ rings: f.rings, zone: f.attrs.FLD_ZONE, subtype: f.attrs.ZONE_SUBTY }))),
  wetlands: measureWetlands([ring], [], out.wetlands.map((f) => ({ rings: f.rings, type: f.attrs.WETLAND_TYPE }))),
};
const w = siteWindow([ring], TRIM_PAD_M);
for (const key of ["flood", "wetlands"]) {
  out[key + "FullVertices"] = out[key].map((f) => f.rings.reduce((a, r) => a + r.length, 0));
  out[key] = out[key].map((f) => ({ attrs: f.attrs, rings: f.rings.map((r) => clipRingToWindow(r, w)).filter(Boolean) }));
}
out.trimPadM = TRIM_PAD_M;
writeFileSync(F + ".screen.json", JSON.stringify(out));
await browser.close();
