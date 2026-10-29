/* NEW-1 (B2507136, Missouri second pass 2026-10-29) — the LIVE signed-in check: click real lots in the four counties the second pass wired
 * (Franklin, Cass, Clinton, Hickory) on planyr.io and require the app to select THE lot the county's own source holds there, with the copy
 * line on Cass, then click a still-gap county (Carroll, Pike) and require the plain-words reason and the request link.
 *
 * GROUND TRUTH is independent of the app's code path: every expected parcel id below was read DIRECTLY from the source on 2026-10-29
 * (Franklin: the county's ArcGIS Online layer; Cass: MARC's layer; Clinton / Hickory: GIS Cloud's own public API, point decided by exact
 * point-in-polygon) at a point chosen to be inside a lot — not from the adapter or the app. KNOWN-GOOD CONTROL arm: a long-wired Missouri
 * county (Callaway) must select a lot; if it does not, the run is VOID (exit 2), never a score.
 * /version.json is read in the same call as every row.
 *
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-missouri-second-pass-live.mjs [https://planyr.io] [--out f.json] [--expect-build <sha>]
 * Creates nothing (Map flow only, no plan), so there is nothing to clean up. */
import { readFileSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { COUNTIES_MAP } from "../src/workspaces/site-planner/lib/counties.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const OUT = flag("--out") || "missouri-second-pass-live.json";
const EXPECT_BUILD = flag("--expect-build");

const POINTS = [
  { name: "CONTROL Callaway (wired 2026-10-19)", key: "mo_callaway", lat: 38.8465, lng: -91.9487, control: true },
  { name: "Franklin — Union", key: "mo_franklin", lat: 38.45131213859222, lng: -91.0149807758061, expect: "17-8-27.0-1-015-313.000" },
  { name: "Franklin — Washington", key: "mo_franklin", lat: 38.5581, lng: -91.0123, expect: "10-5-22.0-1-050-205.000" },
  { name: "Franklin — Sullivan (rural)", key: "mo_franklin", lat: 38.2081, lng: -91.1605, expect: "35-5-16.0-2-000-004.000" },
  { name: "Cass — Harrisonville", key: "mo_cass", lat: 38.653, lng: -94.35, expect: "132141301000060000", copy: true },
  { name: "Cass — Raymore", key: "mo_cass", lat: 38.805, lng: -94.452, expect: "040515200003002055", copy: true },
  { name: "Cass — rural, near Archie", key: "mo_cass", lat: 38.49, lng: -94.35, expect: "180828000000011000", copy: true },
  { name: "Clinton — Plattsburg", key: "mo_clinton", lat: 39.5654, lng: -94.4505, expect: "11-06.0-24-002-039-007.000" },
  { name: "Clinton — Cameron", key: "mo_clinton", lat: 39.74146008632101, lng: -94.23695153526326, expect: "01-06.0-23-002-030-005.000" },
  { name: "Hickory — Hermitage", key: "mo_hickory", lat: 37.945307671896856, lng: -93.3234807222167, expect: "06-6.0-23-002-003-001.000" },
  { name: "Hickory — Wheatland", key: "mo_hickory", lat: 37.936070941421285, lng: -93.40689822721653, expect: "05-7.0-25-000-000-002.000" },
  { name: "GAP Carroll — Carrollton", key: null, lat: 39.3586, lng: -93.4994, gap: "Carroll" },
  { name: "GAP Pike — Bowling Green", key: null, lat: 39.3425, lng: -91.1953, gap: "Pike" },
];

let s = null;
for (let attempt = 1; attempt <= 8 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 8) throw e; await new Promise((r) => setTimeout(r, 25000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-missouri-second-pass-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · ${POINTS.length} points`);
if (EXPECT_BUILD && s.build && !String(s.build.build || s.build).startsWith(EXPECT_BUILD)) console.log(`⚠ build ${JSON.stringify(s.build)} is not the expected ${EXPECT_BUILD}`);

const sleep = (ms) => page.waitForTimeout(ms);
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(1200);
}
const setView = async (la, ln, z) => { await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]); await sleep(900); };
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);

/* A click is judged only once every point query it caused has settled (the Map paints an optimistic outline first — B441 — and rolls it back on "no lot"). */
let inflight = 0, lastNet = Date.now();
const isPointQuery = (r) => { const u = r.url(); return /\/query(\?|$)/.test(u) && /esriGeometryPoint/.test(decodeURIComponent(u)); };
page.on("request", (r) => { if (isPointQuery(r)) { inflight++; lastNet = Date.now(); } });
const netDone = (r) => { if (isPointQuery(r)) { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); } };
page.on("requestfinished", netDone); page.on("requestfailed", netDone);
async function settle(maxMs = 45000) {
  const t0 = Date.now(); await sleep(800);
  while (Date.now() - t0 < maxMs) { if (inflight === 0 && Date.now() - lastNet > 2000) return true; await sleep(250); }
  return false;
}
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : [])).catch(() => []);
const idOf = (attrs, field) => { if (!attrs) return null; const k = Object.keys(attrs).find((x) => x.split(".").pop().toLowerCase() === String(field).toLowerCase()); return k && String(attrs[k] ?? "").trim() ? String(attrs[k]).trim() : null; };

const rows = [];
const record = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : "FAIL"}] ${r.name} · expect ${r.expect || r.gap || "a lot"} · got ${r.got || r.message || "nothing"}${r.note ? " · " + r.note : ""}`); };

async function clickPoint(pt) {
  await freshMap();
  await setView(pt.lat, pt.lng, 17);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
  const c = await screenOf([pt.lat, pt.lng]);
  await page.mouse.click(c.x, c.y);
  const settled = await settle();
  await sleep(600);
  const text = await page.evaluate(() => document.body.innerText);
  const h = await held(); const x = h[h.length - 1];
  return { settled, text, attrs: x ? x.attrs : null };
}

let voided = false;
try {
  for (const pt of POINTS) {
    try {
      const r = await clickPoint(pt);
      const build = await stamp();
      if (pt.gap) {
        const said = /no parcel data wired here yet|hasn't found a public parcel map|couldn't find/i.test(r.text) || new RegExp(pt.gap + " County", "i").test(r.text);
        const link = /Email Michael to request it/i.test(r.text);
        const lot = r.attrs && Object.keys(r.attrs).length;
        record({ name: pt.name, gap: pt.gap, got: lot ? "A LOT (should be none)" : said ? "reason sentence" : "nothing", message: link ? "request link shown" : "NO request link", build, pass: !lot && said && link });
        continue;
      }
      const field = COUNTIES_MAP[pt.key].idField;
      const got = idOf(r.attrs, field);
      let pass = !!got && (pt.control || got === pt.expect);
      let note = null;
      if (pass && pt.copy) {
        const copyLine = /Mid-America Regional Council/.test(r.text) && /not the county/i.test(r.text);
        if (!copyLine) { pass = false; note = "the copy line (Mid-America Regional Council … not the county's own) is missing from the card"; }
      }
      if (pass && pt.key !== "mo_cass" && !pt.control && /not the county.s own/i.test(r.text)) { pass = false; note = "a copy line appeared on a county's own source"; }
      if (!r.settled) note = (note ? note + " · " : "") + "still querying after 45 s";
      record({ name: pt.name, expect: pt.expect, got, build, note, pass });
      if (pt.control && !pass) voided = true;
    } catch (e) {
      record({ name: pt.name, expect: pt.expect, message: "harness error: " + String(e.message).slice(0, 140), pass: false });
      if (pt.control) voided = true;
    }
  }
} finally {
  const wiredRows = rows.filter((r) => r.expect && !String(r.name).startsWith("CONTROL"));
  if (!voided && wiredRows.length < 10) rows.push({ name: "coverage", message: `only ${wiredRows.length} wired-county rows ran`, pass: false });
  writeFileSync(OUT, JSON.stringify({ base: BASE, build: s.build, at: new Date().toISOString(), rows }, null, 1));
  const failed = rows.filter((r) => !r.pass);
  console.log(`\n${voided ? "⛔ VOID — the known-good control failed" : failed.length ? `❌ ${failed.length} of ${rows.length} rows FAILED` : `✅ PASS — ${rows.length} rows`} · results ${OUT}`);
  await s.close();
  process.exit(voided ? 2 : failed.length ? 1 : 0);
}
