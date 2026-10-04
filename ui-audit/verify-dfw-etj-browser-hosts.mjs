#!/usr/bin/env node
/* verify-dfw-etj-browser-hosts — the DFW ETJ hosts the BUILD SANDBOX cannot reach, asked from a BROWSER on planyr.io.
 *
 * NEW-2 (2026-09-30). `gis.dentoncounty.gov`, `mapit.fortworthtexas.gov`, `mapit.tarrantcounty.com` and
 * `geospatial.nctcog.org` are denied by the Claude Code cloud environment's egress policy, so no server-side
 * script here can fetch them. The owner probed all four from a planyr.io tab on 2026-09-30 and each answers and is
 * CORS-clean from that origin. This harness is the repeatable form of that probe: it opens a real page on the
 * planyr.io ORIGIN (so CORS is exercised as the app will exercise it) and runs every fetch from inside the page.
 *
 *   BASE_URL=https://planyr.io node ui-audit/verify-dfw-etj-browser-hosts.mjs
 *
 * WHAT IT ASSERTS (Denton County, Fort Worth — the wired rows):
 *   • Denton `CityETJPermits_GC/MapServer/3`: 40 polygons, fields NAME/TYPE/CITY/INC_MUNI, 5 with NAME='Undetermined'
 *     (all TYPE 'ETJ'), 1 with TYPE 'DIV 2', newest `last_edited_date` ≥ 2026-09-24;
 *   • Fort Worth `OpenData_Boundaries/MapServer/1`: 81 polygons, newest DATESTAMP ≥ 2026-09-01, no name column;
 *   • Fort Worth release areas `PlanningDevelopment/MapServer/120`: answers; its FIELDS are printed (they were unread
 *     when the row was written — tighten `etj_release_fortworth` once you have read them);
 *   • every fixture point in `SOURCE_FIXTURES` for etj_denton / etj_fortworth returns ≥ its expected count.
 * WHAT IT ONLY REPORTS (discovery, never fails):
 *   • NCTCOG (`/map/rest/services`, NOT `/arcgis/`): every folder → service → layer whose name, alias or description
 *     looks ETJ-like, INCLUDING the `Boundaries/Boundaries` layer ids 7, 8 and 10 that the hub's catalogue omits
 *     (its catalogue lists 0-6, 9, 11, 12) — the one concrete lead that was not yet read;
 *   • Tarrant County: `Transportation/ETJ/MapServer` (an ArcGIS Online item points at it, edited 2020) and the
 *     `Dynamic/CityBoundaries` layer, with their fields and counts.
 *
 * ⛔ Needs open internet (a browser with the four hosts reachable). From the build sandbox it degrades: every blocked
 * host reports UNREACHABLE and the run exits 2 (not 1) so nobody reads it as a pass.
 */
import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE_URL || "https://planyr.io";
const { GIS_SOURCES } = await import(path.join(ROOT, "src/shared/gis/sources.js"));
const { SOURCE_FIXTURES } = await import(path.join(ROOT, "src/shared/gis/sourceFixtures.js"));

const NCTCOG = "https://geospatial.nctcog.org/map/rest/services";
const TARRANT = "https://mapit.tarrantcounty.com/arcgis/rest/services";
const ETJ_LIKE = /etj|extra.?territorial|planning.?jurisdiction|city.?limit|annex|release/i;

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const results = []; let unreachable = 0;
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };
try {
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  await assertMeasurable(page, "verify-dfw-etj-browser-hosts");
  // Everything below runs INSIDE the page, so the browser (origin = planyr.io) makes the request and CORS is real.
  const j = (url) => page.evaluate(async (u) => {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(40000) }); return await r.json(); } catch (e) { return { __err: String(e).slice(0, 120) }; }
  }, url);
  const q = (base, params) => `${base}/query?` + new URLSearchParams({ f: "json", ...params });
  const blocked = (o) => { if (o && o.__err) { unreachable++; return true; } return false; };

  // ── Denton County ───────────────────────────────────────────────────────────────────────────────────────────
  const D = GIS_SOURCES.etj_denton.serviceUrl;
  const dInfo = await j(D + "?f=json");
  if (blocked(dInfo)) console.log(`?  Denton County — UNREACHABLE from this browser (${dInfo.__err})`);
  else {
    const fields = (dInfo.fields || []).map((f) => f.name);
    check("Denton: fields NAME / TYPE / CITY / INC_MUNI present", ["NAME", "TYPE", "CITY", "INC_MUNI"].every((f) => fields.includes(f)), fields.join(","));
    const all = await j(q(D, { where: "1=1", outFields: "NAME,TYPE,CITY", returnGeometry: "false", resultRecordCount: "2000" }));
    const feats = (all.features || []).map((f) => f.attributes);
    check("Denton: 40 polygons", feats.length === 40, String(feats.length));
    const undet = feats.filter((a) => String(a.NAME).trim().toLowerCase() === "undetermined");
    check("Denton: 5 'Undetermined', all TYPE 'ETJ'", undet.length === 5 && undet.every((a) => a.TYPE === "ETJ"), JSON.stringify(undet.map((a) => a.CITY)));
    check("Denton: 1 'DIV 2'", feats.filter((a) => a.TYPE === "DIV 2").length === 1, JSON.stringify(feats.filter((a) => a.TYPE === "DIV 2")));
    const stats = await j(q(D, { where: "1=1", outStatistics: JSON.stringify([{ statisticType: "max", onStatisticField: "last_edited_date", outStatisticFieldName: "m" }]) }));
    const m = stats.features && stats.features[0] && stats.features[0].attributes.m;
    check("Denton: newest last_edited_date ≥ 2026-09-24", !!m && m >= Date.parse("2026-09-24T00:00:00Z"), m ? new Date(m).toISOString().slice(0, 10) : "no stat");
    console.log("   city names carried:", [...new Set(feats.filter((a) => a.NAME !== "Undetermined").map((a) => a.NAME))].sort().join(", "));
  }
  // ── Fort Worth ──────────────────────────────────────────────────────────────────────────────────────────────
  const F = GIS_SOURCES.etj_fortworth.serviceUrl;
  const fInfo = await j(F + "?f=json");
  if (blocked(fInfo)) console.log(`?  Fort Worth — UNREACHABLE from this browser (${fInfo.__err})`);
  else {
    const c = await j(q(F, { where: "1=1", returnCountOnly: "true" }));
    check("Fort Worth ETJ: 81 polygons", c.count === 81, String(c.count));
    const stats = await j(q(F, { where: "1=1", outStatistics: JSON.stringify([{ statisticType: "max", onStatisticField: "DATESTAMP", outStatisticFieldName: "m" }]) }));
    const m = stats.features && stats.features[0] && stats.features[0].attributes.m;
    check("Fort Worth ETJ: newest DATESTAMP ≥ 2026-09-01", !!m && m >= Date.parse("2026-09-01T00:00:00Z"), m ? new Date(m).toISOString().slice(0, 10) : "no stat");
    check("Fort Worth ETJ: no name column (nameConst supplies 'Fort Worth')", !(fInfo.fields || []).some((f) => /^(name|city|city_name)$/i.test(f.name)), (fInfo.fields || []).map((f) => f.name).join(","));
  }
  const R = GIS_SOURCES.etj_release_fortworth.serviceUrl;
  const rInfo = await j(R + "?f=json");
  if (blocked(rInfo)) console.log(`?  Fort Worth release areas — UNREACHABLE from this browser (${rInfo.__err})`);
  else {
    const c = await j(q(R, { where: "1=1", returnCountOnly: "true" }));
    check("Fort Worth release areas: layer answers", typeof c.count === "number", `count=${c.count}; FIELDS: ${(rInfo.fields || []).map((f) => `${f.name}:${f.type.replace("esriFieldType", "")}`).join(", ")}`);
    console.log("   ⚠ read these fields and tighten `etj_release_fortworth` (effective vs petitioned) — its attributes were unread when the row was written.");
  }
  // ── fixtures for the wired browser-only rows ────────────────────────────────────────────────────────────────
  for (const id of ["etj_denton", "etj_fortworth"]) {
    for (const f of SOURCE_FIXTURES[id].fixtures) {
      const u = q(GIS_SOURCES[id].serviceUrl, { where: "1=1", geometry: JSON.stringify({ x: f.point[0], y: f.point[1], spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", returnCountOnly: "true" });
      const r = await j(u);
      if (blocked(r)) continue;
      check(`${id} fixture · ${f.label}`, (r.count || 0) >= f.expectMinCount, `count=${r.count} (need ≥ ${f.expectMinCount})`);
    }
  }
  // ── discovery: NCTCOG ───────────────────────────────────────────────────────────────────────────────────────
  const root = await j(NCTCOG + "?f=json");
  if (blocked(root)) console.log(`?  NCTCOG — UNREACHABLE from this browser (${root.__err})`);
  else {
    console.log(`\n── NCTCOG ${NCTCOG} — folders: ${(root.folders || []).join(", ")}`);
    const dirs = ["", ...(root.folders || [])];
    for (const d of dirs) {
      const idx = d ? await j(`${NCTCOG}/${d}?f=json`) : root;
      for (const s of (idx.services || [])) {
        if (!/MapServer|FeatureServer/.test(s.type)) continue;
        const svcUrl = `${NCTCOG}/${s.name}/${s.type}`;
        const svc = await j(svcUrl + "?f=json");
        for (const l of ((svc && svc.layers) || [])) {
          const hay = `${l.name} ${svc.serviceDescription || ""} ${svc.mapName || ""}`;
          if (ETJ_LIKE.test(hay)) console.log(`   • ${s.name}/${s.type}/${l.id} "${l.name}"`);
        }
        if (/^Boundaries\/Boundaries$/.test(s.name)) console.log(`   ▸ Boundaries/Boundaries layer list: ${((svc && svc.layers) || []).map((l) => `${l.id}=${l.name}`).join(" | ")}`);
      }
    }
  }
  // ── discovery: Tarrant County ───────────────────────────────────────────────────────────────────────────────
  const tRoot = await j(TARRANT + "?f=json");
  if (blocked(tRoot)) console.log(`?  Tarrant County — UNREACHABLE from this browser (${tRoot.__err})`);
  else {
    console.log(`\n── Tarrant ${TARRANT} — folders: ${(tRoot.folders || []).join(", ")}`);
    for (const p of ["Transportation/ETJ/MapServer/0", "Dynamic/CityBoundaries/MapServer/0"]) {
      const info = await j(`${TARRANT}/${p}?f=json`);
      if (info.__err || info.error) { console.log(`   • ${p}: ${info.__err || JSON.stringify(info.error).slice(0, 80)}`); continue; }
      const c = await j(q(`${TARRANT}/${p}`, { where: "1=1", returnCountOnly: "true" }));
      console.log(`   • ${p} "${info.name}" count=${c.count} fields=${(info.fields || []).map((f) => f.name).join(",")}`);
    }
  }
} finally { await browser.close(); }

const failed = results.filter((r) => !r.ok);
if (unreachable) { console.log(`\n${unreachable} host(s) UNREACHABLE — this run proves nothing about them. Re-run from a browser with the hosts reachable.`); process.exit(failed.length ? 1 : 2); }
console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED.` : `\nAll ${results.length} browser-host checks passed.`);
process.exit(failed.length ? 1 : 0);
