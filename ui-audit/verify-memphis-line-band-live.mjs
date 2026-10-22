/* NEW-1 (Memphis line band, recurrence ×3 of B2289168) — the LIVE check that clicks lots AT the county and state lines, which is
 * exactly what the ×2 harness (verify-memphis-radius-live.mjs) never did: it clicked one interior point per county, so a lot
 * refused because the bundled county geometry sits ≈550 m off the Tennessee–Mississippi line could not show up in it.
 *
 * Points (test/fixtures/memphisLineBand.json, the same list the unit test reads):
 *   · the owner's spots — five real Shelby lots on the north side of Stateline Rd East between Swinnea and Tchulahoma;
 *   · every line the brief names (Shelby/DeSoto both ends, Fayette/Marshall, Shelby/Fayette, Shelby/Tipton, Shelby/Crittenden
 *     across the river, DeSoto/Tate, DeSoto/Marshall, Tate/Marshall): the asset's line point by bisection, then 600/250/75 m
 *     either side of it;
 *   · KNOWN-GOOD interior arms (airport east, downtown Memphis, Harris/Katy) — one failing VOIDS the run (exit 2).
 * GROUND TRUTH is independent of the app's routing: before each click the harness asks BOTH sides' own parcel servers (from
 * the page, through the same relay the app uses) which lot is at the point. Expected: the app selects THAT lot (id match); a
 * point neither server holds (a road, the river) must NOT select anything. Unreadable truth (both servers silent) is VOID for
 * that row, never a pass.
 * Both flows: (a) Map, no project — Select parcels click; (b) a throwaway plan's ＋ Add parcels → Add by address (quickAddAt),
 * geocoder stubbed to the exact point. /version.json is read in the same call as every row's assertion.
 *
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-memphis-line-band-live.mjs [https://planyr.io] [--only a|b] [--out f.json] [--expect-build <sha>]
 * The throwaway plan (zz-livechk-lineband-…) is deleted at the end and the deletion re-read (owner rule 15). */
import { readFileSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { COUNTIES_MAP, countyIdentity } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const ONLY = flag("--only");
const OUT = flag("--out") || "memphis-line-band-live.json";
const EXPECT_BUILD = flag("--expect-build");

await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
const FX = JSON.parse(readFileSync(new URL("../test/fixtures/memphisLineBand.json", import.meta.url), "utf8"));
const srcOf = (lat, lng) => { const id = countyIdentity(lat, lng); return id.key || id.statewideKey || null; };
function linePoint(a, b) {
  const sa = srcOf(...a); let lo = a, hi = b;
  for (let i = 0; i < 40; i++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (srcOf(...m) === sa) lo = m; else hi = m; }
  return lo;
}
const urlOf = (k) => { const u = COUNTIES_MAP[k].layerUrl; return /^https?:/.test(u) ? u : BASE + u; };
const POINTS = [
  { name: "CONTROL TX Harris (west Houston)", lat: 29.80, lng: -95.54, sources: ["harris"], control: true },
  { name: "CONTROL Shelby — airport east", lat: 35.03, lng: -89.95, sources: ["tn_shelby"], control: true },
  { name: "CONTROL Shelby — downtown Memphis", lat: 35.1460, lng: -90.0510, sources: ["tn_shelby"], control: true },
  ...FX.ownerSpots.map((s) => ({ name: `OWNER'S SPOT ${s.name}`, lat: s.lat, lng: s.lng, sources: ["tn_shelby", "ms_desoto"] })),
  ...FX.lines.flatMap((l) => {
    const p = linePoint(l.a, l.b);
    const d = [l.b[0] - l.a[0], l.b[1] - l.a[1]], n = Math.hypot(...d), u = [d[0] / n, d[1] / n];
    return [-600, -250, -75, 75, 250, 600].map((m) => ({ name: `${l.name} ${m > 0 ? "+" : ""}${m} m`, lat: +(p[0] + u[0] * m / 111000).toFixed(6), lng: +(p[1] + u[1] * m / 111000).toFixed(6), sources: [l.A, l.B] }));
  }),
];
const CONTROL_NUDGE = [[0, 0], [0.0015, 0.0015], [-0.0015, -0.0015], [0.003, -0.002], [-0.003, 0.002]];

let s = null;
for (let attempt = 1; attempt <= 8 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 8) throw e; await new Promise((r) => setTimeout(r, 25000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-memphis-line-band-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)} · ${POINTS.length} points`);
if (EXPECT_BUILD && s.build && !String(s.build.build || s.build).startsWith(EXPECT_BUILD)) console.log(`⚠ build ${JSON.stringify(s.build)} is not the expected ${EXPECT_BUILD}`);

let geoTarget = null;
await page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: geoTarget ? [{ address: `${geoTarget.lat},${geoTarget.lng}`, location: { x: geoTarget.lng, y: geoTarget.lat }, score: 100 }] : [] }) }));
const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };
const ID_KEY = /^(hcad_num|parno|parcelid|parcel_id|pin|gispin|parcelnum|parcel_num|parid|parcelnumb|parcel|apn|parcelno|parcel_no|account|acct)$/i;
const idOf = (a) => { if (!a) return null; const k = Object.keys(a).find((x) => ID_KEY.test(x.split(".").pop()) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };

/* Ground truth: ask each side's own server (from the page, so the relay and CORS are the app's) what lot is at the point. */
async function truthAt(pt) {
  const ans = await page.evaluate(async ([list, lng, lat]) => {
    const out = [];
    for (const { key, url } of list) {
      const q = new URLSearchParams({ geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", f: "json", where: "1=1" });
      try {
        const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
        const j = await (await fetch(url + "/query?" + q, { signal: ctrl.signal })).json(); clearTimeout(t);
        out.push({ key, ok: !j.error, attrs: (j.features || []).map((f) => f.attributes) });
      } catch (e) { out.push({ key, ok: false, err: String(e).slice(0, 60) }); }
    }
    return out;
  }, [pt.sources.map((k) => ({ key: k, url: urlOf(k) })), pt.lng, pt.lat]);
  return { answered: ans.filter((a) => a.ok).length === ans.length, ids: ans.flatMap((a) => (a.attrs || []).map((x) => ({ key: a.key, id: idOf(x) }))).filter((x) => x.id), raw: ans.map((a) => `${a.key}:${a.ok ? (a.attrs || []).length : "ERR"}`).join(" ") };
}

const rows = [];
const record = (r) => { rows.push(r); console.log(`  [${r.pass ? "PASS" : r.void ? "VOID" : "FAIL"}] ${r.flow} · ${r.name} · truth ${r.truth} · ${r.outcome}${r.got ? ` · got ${JSON.stringify(r.got)}` : ""}${r.message ? ` · "${r.message}"` : ""} · build ${r.build}`); };

async function freshMap() {
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(1200);
}
const setView = async (la, ln, z) => { await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]); await sleep(900); };
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);
/* ⛔ INSTRUMENT TRAP, found on this harness's first run (2026-10-16, edb5811): the Map paints an OPTIMISTIC outline from the
 * drawn layer the instant you click (B441) and rolls it back when the county answers "no lot". Reading the selection while the
 * point query is still in flight read that flash as a PASS on the very build that refuses the lot. So a click is judged only
 * once every point query it caused has settled (none in flight for 2 s). */
let inflight = 0, lastNet = Date.now(), seenQueries = 0;
const isPointQuery = (r) => { const u = r.url(); return /\/query(\?|$)/.test(u) && /esriGeometryPoint/.test(decodeURIComponent(u)); };
let lastQueryPt = null; // the point the APP actually asked about (a click lands on a whole screen pixel, not the exact coordinate)
page.on("request", (r) => {
  if (!isPointQuery(r)) return;
  inflight++; seenQueries++; lastNet = Date.now();
  const m = decodeURIComponent(r.url()).match(/"x":\s*(-?[\d.]+),\s*"y":\s*(-?[\d.]+)/);
  if (m) lastQueryPt = { lng: +m[1], lat: +m[2] };
});
const netDone = (r) => { if (isPointQuery(r)) { inflight = Math.max(0, inflight - 1); lastNet = Date.now(); } };
page.on("requestfinished", netDone); page.on("requestfailed", netDone);
async function settle(maxMs = 45000) {
  const t0 = Date.now();
  await sleep(800);
  while (Date.now() - t0 < maxMs) { if (inflight === 0 && Date.now() - lastNet > 2000) return true; await sleep(250); }
  return false;
}
const held = () => page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : [])).catch(() => []);
const NOLOT = /No parcel right there|parcel map, but it isn't open|paid subscription|hasn't found a public parcel map|isn't reachable from Planyr/i; // NEW-1 (2026-10-22) — a county gap says why now
const OUTAGE = /isn't responding|Couldn't reach|still loading/i;

async function resolvePoint(pt) {
  for (const [dy, dx] of pt.control ? CONTROL_NUDGE : [[0, 0]]) {
    const p = { ...pt, lat: +(pt.lat + dy).toFixed(6), lng: +(pt.lng + dx).toFixed(6) };
    const t = await truthAt(p);
    if (!pt.control || t.ids.length) return { p, t };
  }
  return { p: pt, t: await truthAt(pt) };
}
const judge = (t, gotId) => {
  if (!t.answered) return { void: true, pass: false };
  if (!t.ids.length) return { pass: !gotId };                 // nobody holds a lot here → nothing may be selected
  return { pass: !!gotId && t.ids.some((x) => x.id === gotId) };
};

async function flowA(pt) {
  const { p, t } = await resolvePoint(pt);
  await freshMap();
  await setView(p.lat, p.lng, 17);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
  const c = await screenOf([p.lat, p.lng]);
  lastQueryPt = null;
  await page.mouse.click(c.x, c.y);
  const settled = await settle();
  await sleep(500);
  const got = await (async () => {
    const h = await held(); const x = h[h.length - 1];
    if (x && idOf(x.attrs)) return { kind: "lot", id: idOf(x.attrs) };
    const txt = await page.evaluate(() => document.body.innerText);
    const m = txt.match(NOLOT) || txt.match(OUTAGE);
    return m ? { kind: "msg", msg: (txt.split("\n").find((l) => l.includes(m[0])) || m[0]).slice(0, 140) } : (settled ? null : { kind: "msg", msg: "still querying after 45 s" });
  })();
  const build = await stamp();
  const gotId = got && got.kind === "lot" ? got.id : null;
  let v = judge(t, gotId);
  /* A click lands on a whole screen pixel (≈1 m at z17), so beside a lot boundary the app can rightly ask about the lot next
   * door. On a mismatch, re-ask the truth AT THE POINT THE APP QUERIED and judge against that (recorded in the row). */
  let tq = null;
  if (!v.pass && !v.void && gotId && lastQueryPt) { tq = await truthAt({ ...pt, lat: lastQueryPt.lat, lng: lastQueryPt.lng }); const v2 = judge(tq, gotId); if (v2.pass) v = { ...v2, atAppPoint: lastQueryPt }; }
  if (pt.control && !t.ids.length) v.pass = false; // a control with no lot to find proves nothing
  record({ flow: "map (no project)", name: pt.name, point: [p.lat, p.lng], truth: t.ids.map((x) => `${x.key}=${x.id}`).join(",") || `none (${t.raw})`, outcome: gotId ? "lot selected" : got ? "message" : "nothing happened", got: gotId, message: got && got.msg, build, ...v, control: !!pt.control });
}

const PLAN_ID = `${LIVE_PREFIX}lineband-${Date.now().toString(36)}`;
async function openPlan() {
  const plan = { ...throwawayPlan(PLAN_ID), origin: { lat: 35.0, lon: -89.93 }, site: "ZZ Live Check — Memphis line band" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.goto(`${BASE}/?planyrDiag=1#/project/${PLAN_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 60000 }).catch(async () => {
    await page.getByRole("button", { name: /^Land$/ }).first().click().catch(() => {});
    await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 30000 });
  });
  await sleep(2000);
}
async function addAt(p) {
  geoTarget = { lat: p.lat, lng: p.lng };
  await page.locator('[data-testid="land-add-btn"]').first().click();
  const input = page.locator('input[placeholder="123 Main St, Katy TX"]').first();
  await input.waitFor({ timeout: 8000 });
  await input.fill(`${p.lat}, ${p.lng}`);
  await input.press("Enter");
  await sleep(400);
  return (await waitFor(async () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="identify-result"]'); if (!el) return null;
    const x = el.innerText.trim(); if (/Finding address|Querying county GIS/.test(x)) return null; return x;
  }), 25000)) || "";
}
async function flowB(pt) {
  const { p, t } = await resolvePoint(pt);
  let txt = await addAt(p);
  // Consecutive points can sit on the SAME lot: the second add toggles the first off (by design — "click it again to re-add").
  // That proves the app identified the same lot; add it once more so the row reads the identified record itself.
  if (/^Removed /.test(txt)) txt = await addAt(p);
  const build = await stamp();
  let gotId = null;
  if (/Added|already in this plan/.test(txt)) {
    const r = await page.evaluate(() => (window.__plannerIdentifyResult ? window.__plannerIdentifyResult() : null)).catch(() => null);
    gotId = r && r.attrs ? idOf(r.attrs) : null;
    if (!gotId && /already in this plan/.test(txt)) gotId = "(already in plan)";
  }
  const v = judge(t, gotId === "(already in plan)" ? (t.ids[0] && t.ids[0].id) : gotId);
  if (pt.control && !t.ids.length) v.pass = false;
  record({ flow: "in project", name: pt.name, point: [p.lat, p.lng], truth: t.ids.map((x) => `${x.key}=${x.id}`).join(",") || `none (${t.raw})`, outcome: gotId ? "lot added" : txt ? "message" : "nothing happened", got: gotId, message: gotId ? null : txt.split("\n")[0], build, ...v, control: !!pt.control });
}

let voided = false;
try {
  if (ONLY !== "b") {
    console.log("\n=== FLOW (a) — Map, no project selected ===");
    for (const pt of POINTS) {
      try { await flowA(pt); } catch (e) { record({ flow: "map (no project)", name: pt.name, truth: "?", outcome: "harness error", message: String(e.message).slice(0, 160), build: await stamp().catch(() => null), pass: false }); }
      if (pt.control && !rows[rows.length - 1].pass) voided = true;
    }
  }
  if (ONLY !== "a" && !voided) {
    console.log(`\n=== FLOW (b) — inside throwaway project ${PLAN_ID} ===`);
    await openPlan();
    for (const pt of POINTS) {
      try { await flowB(pt); } catch (e) { record({ flow: "in project", name: pt.name, truth: "?", outcome: "harness error", message: String(e.message).slice(0, 160), build: await stamp().catch(() => null), pass: false }); }
      if (pt.control && !rows[rows.length - 1].pass) voided = true;
    }
  }
} catch (e) {
  console.log(`\n⛔ harness error outside any row: ${String(e && e.stack || e).slice(0, 400)}`);
  rows.push({ flow: "harness", name: "run", outcome: "harness error", message: String(e && e.message || e).slice(0, 200), pass: false });
} finally {
  for (const [flow, on] of [["map (no project)", ONLY !== "b"], ["in project", ONLY !== "a"]]) {
    const n = rows.filter((r) => r.flow === flow).length;
    if (on && !voided && n < POINTS.length) rows.push({ flow, name: "coverage", outcome: `only ${n} of ${POINTS.length} rows ran`, pass: false });
  }
  // A run where no line point had a lot on EITHER side proves nothing about line routing.
  const lineLots = rows.filter((r) => !r.control && r.truth && !/^none/.test(r.truth) && r.truth !== "?").length;
  if (!voided && lineLots < 10) rows.push({ flow: "harness", name: "vacuity", outcome: `only ${lineLots} line rows had a lot to find`, pass: false });
  if (ONLY !== "a") {
    const cl = await cleanupLive(page, { planId: PLAN_ID }).catch((e) => ({ errors: [String(e)], left: {} }));
    console.log(`\ncleanup: throwaway plan ${PLAN_ID} → left ${JSON.stringify(cl.left)}${cl.errors && cl.errors.length ? " errors " + cl.errors.join("; ") : ""}`);
  }
  writeFileSync(OUT, JSON.stringify({ base: BASE, build: s.build, at: new Date().toISOString(), rows }, null, 1));
  const failed = rows.filter((r) => !r.pass && !r.void);
  const voids = rows.filter((r) => r.void).length;
  console.log(`\n${voided ? "⛔ VOID — a known-good control failed" : failed.length ? `❌ ${failed.length} of ${rows.length} rows FAILED` : `✅ PASS — ${rows.length - voids} rows`}${voids ? ` · ${voids} row(s) VOID (truth unreadable)` : ""} · results → ${OUT}`);
  await s.close();
  process.exit(voided ? 2 : failed.length ? 1 : 0);
}
