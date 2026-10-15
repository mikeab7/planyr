/* NEW-1 (Memphis 100-mile radius, B2289168; recurrence ×2) — the LIVE audit of every county in the radius, on the DEPLOYED bundle,
 * in BOTH lot-picking flows the owner can reach:
 *
 *   (a) MAP, no project selected — Select parcels ("Selecting… / Drop a pin / Cancel"), the flow in the owner's 2026-10-15
 *       screenshot ("No parcel right there — zoom in and click directly on a lot." at Memphis airport east).
 *   (b) INSIDE A PROJECT — a throwaway plan on the test account, ＋ Add parcels ▾ → "Add by address", which runs the planner's
 *       ONE identify-and-add path (`quickAddAt`, the same one a click in "Click a lot on the map" runs). The geocoder is the
 *       only thing stubbed — it answers each county's point exactly, so the planner asks the REAL county servers at that point.
 *
 * Every county in test/fixtures/memphisRadiusCounties.json (all 71, not a sample), plus the owner's exact spot, the 100-mile edge,
 * and the Texas known-good arms (Harris/Katy, Fort Bend, Chambers, Waller). A Texas arm failing VOIDS the run (exit 2).
 * Per county per flow the row is: LOT (parcel id · owner · acreage, read off the app's own point query on the wire) or GAP
 * (the exact county-named sentence). The one forbidden outcome for a county with no source is the generic "No parcel right there".
 * /version.json is read IN THE SAME CALL as every row's assertion. Results → --out <file.json> (default: scratch JSON next to cwd).
 *
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-memphis-radius-live.mjs [https://planyr.io] [--only a|b] [--states TN,MS] [--out f.json]
 * The throwaway plan (id zz-livechk-memphis-…) is deleted at the end and the deletion is re-read (owner rule 15). */
import { readFileSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const ONLY = flag("--only");
const STATES = flag("--states") ? new Set(flag("--states").split(",")) : null;
const OUT = flag("--out") || "memphis-radius-live.json";

const FX = JSON.parse(readFileSync(new URL("../test/fixtures/memphisRadiusCounties.json", import.meta.url), "utf8"));
// The honest gaps (no public source wired) — must SAY so; everything else must select a lot. Kept in step with test/memphisRadius.test.js.
const NO_SOURCE = new Set((process.env.MEMPHIS_NO_SOURCE || "TN:Chester County,KY:Fulton County,MO:Butler County,MO:Dunklin County,MO:New Madrid County,MO:Pemiscot County,MO:Ripley County").split(",").filter(Boolean));
const NUDGE = { "MO:Dunklin County": [36.30, -90.05] };
const ARMS = [
  { name: "TX Harris (Katy)", state: "TX", lat: 29.786, lng: -95.825, expect: "lot", control: true },
  { name: "TX Fort Bend (Sugar Land)", state: "TX", lat: 29.5944, lng: -95.6143, expect: "lot", control: true },
  { name: "TX Chambers (Anahuac)", state: "TX", lat: 29.7691, lng: -94.6783, expect: "lot", control: true },
  { name: "TX Waller (Brookshire)", state: "TX", lat: 29.786, lng: -95.951, expect: "lot", control: true },
  { name: "TN Shelby — owner's spot (airport east)", state: "TN", lat: 35.03, lng: -89.95, expect: NO_SOURCE.has("TN:Shelby County") ? "gap" : "lot", county: "Shelby County" },
  ...FX.counties.map((c) => {
    const k = `${c.state}:${c.name}`; const [lat, lng] = NUDGE[k] || [c.lat, c.lng];
    return { name: `${c.state} ${c.name}`, state: c.state, lat, lng, expect: NO_SOURCE.has(k) ? "gap" : "lot", county: c.name };
  }),
  { name: "MS Webster (just OUTSIDE 100 mi)", state: "MS", lat: 33.5409, lng: -89.2631, expect: "gap", county: "Webster County" },
].filter((a) => !STATES || a.control || STATES.has(a.state));
// Interior offsets (degrees) tried until one lands on a lot — a centroid can sit on a road, river or lake.
const DOFF = [[0, 0], [0.002, 0.002], [-0.002, -0.002], [0.004, -0.003], [-0.004, 0.003], [0.008, 0], [0, -0.008]];

let s = null;
for (let attempt = 1; attempt <= 8 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 8) throw e; console.log(`  sign-in attempt ${attempt} → ${e.message.slice(0, 80)}; retrying in 25 s`); await new Promise((r) => setTimeout(r, 25000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-memphis-radius-live");
console.log(`signed in as ${s.proof.email} · build ${JSON.stringify(s.build)}`);

// Every parcel /query the app makes, captured off the wire (attrs + rings of point queries).
const wire = [];
page.on("response", async (r) => {
  const raw = r.url();
  if (!/\/query(\?|$)/.test(raw)) return;
  const u = decodeURIComponent(raw + " " + (r.request().postData() || ""));
  if (!/esriGeometryPoint/.test(u)) return;
  try { const j = await r.json(); const f = (j.features || [])[0]; wire.push({ t: Date.now(), base: raw.split("?")[0], n: (j.features || []).length, attrs: f ? f.attributes : null, geom: f ? f.geometry : null, sr: j.spatialReference }); } catch (_e) { /* non-JSON */ }
});
// Flow (b) geocoder stub — answers exactly the point the arm is testing.
let geoTarget = null;
await page.route(/geocode\.arcgis\.com\/.*findAddressCandidates/, (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ candidates: geoTarget ? [{ address: `${geoTarget.lat},${geoTarget.lng}`, location: { x: geoTarget.lng, y: geoTarget.lat }, score: 100 }] : [] }) }));

const stamp = () => page.evaluate(async () => { const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); return v && v.build; });
const bodyText = () => page.evaluate(() => document.body.innerText);
const sleep = (ms) => page.waitForTimeout(ms);
const waitFor = async (fn, ms = 10000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await sleep(250); } return v; };

const OWNER_KEY = /^(owner|ownername|own_name|ownname|owner1|ownernme1|own1|ownersname|name)$/i;
const ownerOf = (a) => { if (!a) return null; const k = Object.keys(a).find((x) => OWNER_KEY.test(x) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
const ID_KEY = /^(parno|parcelid|parcel_id|ownparcelid|parcelnum|parcel_num|parid|pin|gispin|geo_id|account|acct|acct_num|hcad_num|prop_id|propertyid|quickrefid|parcelnumb|parcel|camapin|apn|parcelno|parcel_no|gis_pin|tax_id)$/i;
const idOf = (a) => { if (!a) return null; const k = Object.keys(a).find((x) => ID_KEY.test(x.split(".").pop()) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
// Geodesic-enough polygon area (spherical excess) of the returned rings, in acres — what the app received.
function ringsAcres(g, sr) {
  if (!g || !g.rings) return null;
  const merc = sr && (sr.wkid === 102100 || sr.wkid === 3857 || sr.latestWkid === 3857);
  const toLL = ([x, y]) => merc ? [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI] : [x, y];
  if (!merc && sr && sr.wkid && sr.wkid !== 4326 && sr.wkid !== 4269) return null;
  const R = 6378137; let tot = 0;
  for (const ring of g.rings) {
    const p = ring.map(toLL); let a = 0;
    for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += (q[0] - p[i][0]) * Math.PI / 180 * (2 + Math.sin(p[i][1] * Math.PI / 180) + Math.sin(q[1] * Math.PI / 180)); } // wraps, so open or closed rings both work
    tot += a * R * R / 2;
  }
  return Math.abs(tot) / 4046.8564224;
}
const lotFromWire = (since) => { const w = wire.filter((x) => x.t >= since && x.n > 0).pop(); return w ? { id: idOf(w.attrs), owner: ownerOf(w.attrs), acres: ringsAcres(w.geom, w.sr), layer: w.base.replace(/^https?:\/\/[^/]+/, "").replace(/\/query$/, "").slice(-90) } : null; };
const GENERIC = /No parcel right there/i;
const gapRe = (county) => new RegExp(`${county.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]{0,8}no parcel data wired here yet`, "i");

const rows = [];
const record = (r) => { rows.push(r); const ok = r.pass ? "PASS" : "FAIL"; console.log(`  [${ok}] ${r.flow} · ${r.name} · ${r.outcome}${r.lot ? ` · id ${JSON.stringify(r.lot.id)} · owner ${JSON.stringify(r.lot.owner)} · ${r.lot.acres != null ? r.lot.acres.toFixed(2) + " ac" : "ac ?"}` : ""}${r.message ? ` · "${r.message}"` : ""} · build ${r.build}`); };

/* ── Flow (a): Map, no project ─────────────────────────────────────────────────────────────────────────────────────────── */
async function freshMap() {
  // A goto to the SAME url+hash is a same-document navigation (no reload) — reload instead, so the tool state resets.
  if (page.url().startsWith(BASE + "/?planyrDiag=1#/site")) await page.reload({ waitUntil: "domcontentloaded" });
  else await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 45000 });
  await sleep(1200);
}
const setView = async (la, ln, z) => { await page.evaluate(([a, b, c]) => window.__mapFinderMap.setView([a, b], c, { animate: false }), [la, ln, z]); await sleep(900); };
const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const m = window.__mapFinderMap, p = m.latLngToContainerPoint([a, b]), r = m.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);

async function flowA(arm) {
  await freshMap();
  await setView(arm.lat, arm.lng, 17);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await sleep(1500);
  let last = null;
  for (const [dy, dx] of DOFF) {
    const pt = [arm.lat + dy, arm.lng + dx];
    if (dy || dx) { await setView(pt[0], pt[1], 17); }
    const c = await screenOf(pt);
    const since = Date.now();
    const before = await bodyText();
    await page.mouse.click(c.x, c.y);
    const got = await waitFor(async () => {
      const sm = await summary(); if (/^1 parcel/.test(sm)) return { kind: "lot", sm };
      const t = await bodyText();
      if (arm.county && gapRe(arm.county).test(t)) return { kind: "gap", msg: t.match(gapRe(arm.county))[0] };
      if (GENERIC.test(t) && !GENERIC.test(before)) return { kind: "generic", msg: (t.match(/No parcel right there[^\n]*/) || [""])[0] };
      const other = t.match(/[^\n]*(isn't responding|Couldn't reach|still loading)[^\n]*/);
      if (other && !before.includes(other[0])) return { kind: "other", msg: other[0] };
      return null;
    }, 14000);
    const build = await stamp();
    if (got && got.kind === "lot") {
      // The lot as the app holds it (read-only hook); the wire is only the fallback for a build without the hook.
      const held = await page.evaluate(() => (window.__mapSelectedParcels ? window.__mapSelectedParcels() : null)).catch(() => null);
      const h = held && held[held.length - 1];
      const lot = h ? { id: h.acct || idOf(h.attrs), owner: ownerOf(h.attrs), acres: ringsAcres({ rings: h.rings }, { wkid: 4326 }), layer: h.county } : lotFromWire(since);
      const acresShown = /\bac\b/i.test(got.sm);
      return record({ flow: "map (no project)", name: arm.name, build, point: pt, outcome: "lot selected", summary: got.sm, lot, pass: arm.expect === "lot" && acresShown && (arm.control || !!(lot && lot.id)) });
    }
    if (got && got.kind === "gap") return record({ flow: "map (no project)", name: arm.name, build, point: pt, outcome: "county gap message", message: got.msg, pass: arm.expect === "gap" });
    last = { got, build, pt };
    if (arm.expect === "gap") break; // a gap county must answer with its sentence at the first point — anything else is the defect
    await page.keyboard.press("Escape").catch(() => {});
  }
  const g = last && last.got;
  record({ flow: "map (no project)", name: arm.name, build: last ? last.build : await stamp(), point: last && last.pt, outcome: g ? (g.kind === "generic" ? "GENERIC no-parcel message" : g.kind) : "nothing happened", message: g && g.msg, pass: false });
}

/* ── Flow (b): inside a throwaway project ─────────────────────────────────────────────────────────────────────────────── */
const PLAN_ID = `${LIVE_PREFIX}memphis-${Date.now().toString(36)}`;
async function openPlan() {
  const plan = { ...throwawayPlan(PLAN_ID), origin: { lat: 35.1495, lon: -90.049 }, site: "ZZ Live Check — Memphis radius" };
  const err = await page.evaluate(async ([p]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: p.id, group_id: p.groupId, site: p.site, name: p.name, county: null, user_id: u.user.id, version: 1, data: p });
    return error ? String(error.message) : null;
  }, [plan]);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.goto(`${BASE}/?planyrDiag=1#/project/${PLAN_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 60000 }).catch(async () => {
    // the Land tab may not be the open one — open it
    await page.getByRole("button", { name: /^Land$/ }).first().click().catch(() => {});
    await page.waitForSelector('[data-testid="land-add-btn"]', { timeout: 30000 });
  });
  await sleep(2000);
}
async function flowB(arm) {
  let last = null;
  for (const [dy, dx] of DOFF) {
    const pt = [arm.lat + dy, arm.lng + dx];
    geoTarget = { lat: pt[0], lng: pt[1] };
    await page.locator('[data-testid="land-add-btn"]').first().click();
    const input = page.locator('input[placeholder="123 Main St, Katy TX"]').first();
    await input.waitFor({ timeout: 8000 });
    await input.fill(`${pt[0]}, ${pt[1]}`);
    const since = Date.now();
    await input.press("Enter");
    const got = await waitFor(async () => page.evaluate(() => {
      const el = document.querySelector('[data-testid="identify-result"]'); if (!el) return null;
      const t = el.innerText.trim(); if (/Finding address|Querying county GIS/.test(t)) return null; return t;
    }), 20000);
    const build = await stamp();
    const t = got || "";
    if (/^✓\s*Added/m.test(t) || /Added /.test(t) || /already in this plan/.test(t)) {
      const r = await page.evaluate(() => (window.__plannerIdentifyResult ? window.__plannerIdentifyResult() : null)).catch(() => null);
      const lot = r && r.attrs ? { id: idOf(r.attrs), owner: ownerOf(r.attrs), acres: ringsAcres({ rings: r.rings }, { wkid: 4326 }) } : lotFromWire(since);
      return record({ flow: "in project", name: arm.name, build, point: pt, outcome: /already/.test(t) ? "lot (already in plan)" : "lot added", lot, pass: arm.expect === "lot" && (arm.control || (!!(lot && lot.id) && lot.acres != null)) });
    }
    if (arm.county && gapRe(arm.county).test(t)) return record({ flow: "in project", name: arm.name, build, point: pt, outcome: "county gap message", message: t.match(gapRe(arm.county))[0], pass: arm.expect === "gap" });
    last = { t, build, pt };
    if (arm.expect === "gap") break;
  }
  record({ flow: "in project", name: arm.name, build: last.build, point: last.pt, outcome: GENERIC.test(last.t) ? "GENERIC no-parcel message" : (last.t ? "other" : "nothing happened"), message: last.t.split("\n")[0], pass: false });
}

let voided = false;
try {
  if (ONLY !== "b") {
    console.log("\n=== FLOW (a) — Map, no project selected ===");
    for (const arm of ARMS) {
      console.log(`== ${arm.name} (${arm.lat}, ${arm.lng}) expect ${arm.expect}`);
      try { await flowA(arm); } catch (e) { record({ flow: "map (no project)", name: arm.name, build: await stamp().catch(() => null), outcome: "harness error", message: String(e.message).slice(0, 160), pass: false }); }
      if (arm.control && !rows[rows.length - 1].pass) voided = true;
    }
  }
  if (ONLY !== "a" && !voided) {
    console.log(`\n=== FLOW (b) — inside throwaway project ${PLAN_ID} ===`);
    await openPlan();
    for (const arm of ARMS) {
      console.log(`== ${arm.name} (${arm.lat}, ${arm.lng}) expect ${arm.expect}`);
      try { await flowB(arm); } catch (e) { record({ flow: "in project", name: arm.name, build: await stamp().catch(() => null), outcome: "harness error", message: String(e.message).slice(0, 160), pass: false }); }
      if (arm.control && !rows[rows.length - 1].pass) voided = true;
    }
  }
} finally {
  if (ONLY !== "a") {
    const cl = await cleanupLive(page, { planId: PLAN_ID }).catch((e) => ({ errors: [String(e)], left: {} }));
    console.log(`\ncleanup: throwaway plan ${PLAN_ID} → left ${JSON.stringify(cl.left)}${cl.errors && cl.errors.length ? " errors " + cl.errors.join("; ") : ""}`);
  }
  writeFileSync(OUT, JSON.stringify({ base: BASE, build: s.build, at: new Date().toISOString(), rows }, null, 1));
  const failed = rows.filter((r) => !r.pass);
  console.log(`\n${voided ? "⛔ VOID — a Texas known-good arm failed" : failed.length ? `❌ ${failed.length} of ${rows.length} rows FAILED` : `✅ PASS — ${rows.length} rows`} · results → ${OUT}`);
  await s.close();
  process.exit(voided ? 2 : failed.length ? 1 : 0);
}
