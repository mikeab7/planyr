/* V1947696 / B2497472 — Oklahoma's 52 state-layer counties answer a click through the REAL deployed adapter (/okparcels), signed in on planyr.io.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-ok-statewide-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Reads /version.json (cache:'no-store') IN THE SAME CALL as every assertion (merged ≠ live; a stale tab can serve the old bundle).
 *
 * TWO HALVES, because they prove different things:
 *   1. MECHANISM (Node, no browser): the SHIPPED `COUNTIES` rows + the SHIPPED `queryAtPoint` against the production adapter, for a spread of
 *      state-layer counties (the layer's odd spellings — Le Flore → "LeFlore", Roger Mills — the panhandle, the far south-east). Each must
 *      return a polygon whose own `county` column is that county, a parcel id and an owner. KNOWN-ANSWER ARM: the recorded Mayes lot
 *      (parcel 490010509, 39.29 acres per the server). NEGATIVE CONTROL: a point in the Gulf returns nothing. Also an outline-tile-sized
 *      envelope (must return several lots, with polygons) and the documented limit: a county-wide account search is a LOUD error that
 *      says to click the lot, never an empty list.
 *   2. UI (signed-in browser): Select parcels → click a lot in two state-layer counties → the selection panel appears ("1 parcel").
 * Click-only: nothing is created, so there is nothing to clean up. A run whose known-good arm fails is VOID, not scored. */
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { COUNTIES } from "../src/workspaces/site-planner/lib/counties.js";
import { queryAtPoint } from "../src/workspaces/site-planner/lib/arcgis.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const wantBuild = process.argv[3] || null;
/* [county key, county name, lat, lng (a point inside a real lot, recorded 2026-10-29), that lot's parcel id] */
const CASES = [
  ["ok_mayes", "Mayes", 36.51, -95.16228, "490010509"],
  ["ok_leflore", "Le Flore", 35.02915, -94.49347, "400062417"],
  ["ok_rogermills", "Roger Mills", 35.62531, -99.63517, "650001956"],
  ["ok_pottawatomie", "Pottawatomie", 35.03544, -96.88456, "630002660"],
  ["ok_texas", "Texas", 36.86829, -101.12523, "700013189"],
  ["ok_woods", "Woods", 36.47329, -98.78608, "760000407"],
  ["ok_cimarron", "Cimarron", 36.89429, -102.45791, "130004330"],
  ["ok_coal", "Coal", 34.58154, -96.32271, "150000309"],
  ["ok_latimer", "Latimer", 34.92781, -95.23665, "390004856"],
  ["ok_sequoyah", "Sequoyah", 35.44377, -94.98728, "680001239"],
  ["ok_carter", "Carter", 34.15761, -97.2066, "100061095"],
  ["ok_mcintosh", "McIntosh", 35.50329, -95.62, "460034805"],
];
const rows = [];
const rec = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} — ${r.detail}`); };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const abs = (u) => (u.startsWith("/") ? base + u : u);
const retry = async (fn, n = 3) => { let last; for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2500)); } } throw last; };

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
try {
  await assertMeasurable(s.page, "verify-ok-statewide-live");
  console.log("signed in as", s.proof.email, "| build", JSON.stringify(s.build));
  if (wantBuild && !String(s.build && s.build.build).startsWith(wantBuild)) throw new Error(`served build ${s.build && s.build.build} is not ${wantBuild} — merged ≠ live, aborting`);

  /* ── 1. mechanism ───────────────────────────────────────────────────────────── */
  for (const [key, name, lat, lng, pid] of CASES) {
    const row = COUNTIES[key];
    if (!row || row.layerUrl !== "/okparcels/FeatureServer/0") { rec({ name: `${name} — wired to the adapter`, pass: false, detail: `row=${JSON.stringify(row && row.layerUrl)}` }); continue; }
    const t0 = Date.now();
    let f = null, err = null;
    try { f = await retry(() => queryAtPoint(abs(row.layerUrl), lng, lat, { timeoutMs: 45000 })); } catch (e) { err = e; }
    const a = f && f.attributes;
    const r = a ? countyRecord(a, { idField: row.idField, addrField: row.addrField }) : null;
    const ok = !!a && norm(a.county) === norm(name) && String(a.parcelid) === pid && !!r && !!r.account && !!r.owner && !!(f.geometry && f.geometry.rings && f.geometry.rings.length);
    rec({ name: `${name} County — click returns its own lot`, pass: ok, detail: err ? `error: ${err.message}` : a ? `parcel ${a.parcelid} · ${a.county} · owner "${String(a.owner).slice(0, 28)}" · ${a.acres} ac · updated ${String(a.dataupdate).slice(0, 10)} · ${Date.now() - t0} ms` : "no feature" });
    if (key === "ok_mayes") {
      const ac = a && Number(a.acres);
      if (!ok || !(ac > 39 && ac < 39.6)) throw new Error("VOID — the known-answer arm (the recorded Mayes lot, 39.29 acres) did not come back; nothing below is scored");
    }
  }
  const gulf = await queryAtPoint(abs("/okparcels/FeatureServer/0"), -90.0, 28.0, { timeoutMs: 45000 }).catch((e) => ({ err: e.message }));
  rec({ name: "negative control — a point in the Gulf returns nothing", pass: gulf === null, detail: JSON.stringify(gulf) });

  const env = { xmin: -95.3193, ymin: 36.3057, xmax: -95.3138, ymax: 36.3112, spatialReference: { wkid: 4326 } };
  const qs = new URLSearchParams({ f: "json", where: "county='Mayes'", geometry: JSON.stringify(env), geometryType: "esriGeometryEnvelope", inSR: "4326", outSR: "4326", spatialRel: "esriSpatialRelIntersects", returnGeometry: "true", outFields: "parcelid" });
  const ej = await retry(async () => { const r = await fetch(base + "/okparcels/FeatureServer/0/query?" + qs, { headers: { accept: "application/json" } }); if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  rec({ name: "an outline-tile-sized window returns several lots with polygons", pass: Array.isArray(ej.features) && ej.features.length >= 5 && ej.features.every((x) => x.geometry && x.geometry.rings.length), detail: ej.error ? JSON.stringify(ej.error) : `${(ej.features || []).length} lots` });

  const sq = new URLSearchParams({ f: "json", where: "(county='Mayes') AND (UPPER(parcelid) LIKE UPPER('%4900%'))", outFields: "*", returnGeometry: "true", outSR: "4326" });
  const sj = await (await fetch(base + "/okparcels/FeatureServer/0/query?" + sq)).json();
  rec({ name: "a county-wide account search is a LOUD error that says to click the lot (never an empty list)", pass: !!(sj.error && /click the lot/.test(sj.error.message)) && !sj.features, detail: JSON.stringify(sj).slice(0, 160) });

  /* ── 2. UI ───────────────────────────────────────────────────────────────────── */
  const page = s.page;
  await page.goto(base + "/#/site", { waitUntil: "domcontentloaded" });
  await page.getByTestId("map-toolbar-select-parcels").waitFor({ timeout: 45000 });
  await page.waitForTimeout(3000);
  let armed = false;
  for (const [, name, lat, lng] of [CASES[0], CASES[2]]) {
    await page.evaluate(([a, b]) => window.__mapFinderMap.setView([a, b], 17, { animate: false }), [lat, lng]);
    await page.waitForTimeout(600);
    if (!armed) { await page.getByTestId("map-toolbar-select-parcels").click(); armed = true; await page.waitForTimeout(400); }
    const pt = await page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [lat, lng]);
    await page.mouse.click(pt.x, pt.y);
    const ok = await page.getByText(/\b1 parcel\b/).first().waitFor({ timeout: 40000 }).then(() => true, () => false);
    const gap = await page.getByText(/no parcel data wired here yet|couldn't reach/i).first().isVisible().catch(() => false);
    rec({ name: `${name} County — Select parcels selects the lot in the browser`, pass: ok && !gap, detail: ok ? "selection panel shows '1 parcel'" : "no selection appeared" });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: process.env.OK_SHOT || "/tmp/ok-statewide-live.png" });
  const failed = rows.filter((r) => !r.pass);
  console.log(failed.length ? `FAIL ${failed.length}/${rows.length}` : `PASS ${rows.length}/${rows.length}`, "| build", s.build && s.build.build);
  await s.close();
  process.exit(failed.length ? 1 : 0);
} catch (e) { console.error("FAIL", e.message); await s.close().catch(() => {}); process.exit(1); }
