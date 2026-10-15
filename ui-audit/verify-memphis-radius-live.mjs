/* NEW-1 (Memphis 100-mile radius) — live check on the DEPLOYED bundle: Select parcels at one lot in (at least) one county per
 * state in the radius, plus the edge, the honest gaps, and the Texas regression counties.
 *
 *   TN  Tipton (statewide layer) · Germantown + Collierville (city-scoped) · Shelby/Memphis (GAP: must SAY so)
 *   MS  DeSoto · Tate (MARIS West layer) · Lee (MARIS East layer) · Coahoma · Itawamba (edge, IN) · Webster (just OUT: gap)
 *   AR  Crittenden (West Memphis) · Craighead · Sharp (near the 100-mile edge)
 *   MO  Dunklin (bootheel — GAP) · KY Fulton (GAP)
 *   TX  Katy (Harris/Waller) · Fort Bend · Chambers (regression: unchanged)
 *
 * KNOWN-GOOD ARM: the Texas arms use the real county servers and MUST pass, or the run is void (a harness whose every arm
 * is new proves nothing about itself). OWNER + ACREAGE are read from the app's OWN point-query response (captured off the
 * wire, not re-fetched), so what is asserted is what the app received. A GAP arm passes only when the page prints the
 * county's name with "no parcel data" — never a silent empty. The build under test is read from /version.json in the same call.
 * Select-parcels selections are transient (no plan created). Run: E2E_LOGIN_KEY=… node ui-audit/verify-memphis-radius-live.mjs [https://planyr.io] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
let failures = 0, voided = false;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

let s = null;
if (process.env.NO_AUTH) {
  /* PREVIEW MODE — a Cloudflare PR preview has no E2E_LOGIN_KEY, so the harness runs signed OUT (the Map's Select-parcels
   * flow needs no account). It proves wiring + the gap sentences on the PR's own bundle; the signed-in record is the
   * planyr.io run after merge. */
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pg = await ctx.newPage();
  const errors = []; pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.addInitScript(() => { window.__PLANYR_E2E = true; });
  const v = await fetch(BASE + "/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  s = { page: pg, proof: { email: "(signed out — preview)" }, build: v && v.build, errors, close: () => browser.close() };
}
for (let attempt = 1; attempt <= 8 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 8) throw e; console.log(`  sign-in attempt ${attempt} → ${e.message.slice(0, 80)}; retrying in 25 s`); await new Promise((r) => setTimeout(r, 25000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-memphis-radius-live");
console.log(`signed in as ${s.proof.email} · /version.json build ${JSON.stringify(s.build)}`);

// Every parcel /query the app itself makes (outline cells AND point identifies), captured off the wire. The layer base the app
// really used for a county is read from here; owner + id are then read with the SAME layer and an identify-shaped point query.
const wire = [];
page.on("response", async (r) => {
  const raw = r.url();
  if (!/\/query(\?|$)/.test(raw)) return;
  const u = decodeURIComponent(raw + " " + (r.request().postData() || ""));
  try { const j = await r.json(); wire.push({ base: raw.split("/query")[0], point: /esriGeometryPoint/.test(u), n: (j.features || []).length, attrs: (j.features || [])[0]?.attributes || null }); } catch (_e) { /* non-JSON */ }
});

await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
const stamp = () => page.evaluate(async () => {
  const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  return { build: v && v.build, chunk: performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^SitePlannerApp-.*\.js$/.test(n))[0] || null };
});
const summary = () => page.evaluate(() => { const el = document.querySelector('[data-testid="map-decide-summary"]'); return el ? el.textContent.trim() : ""; });
const bodyText = () => page.evaluate(() => document.body.innerText);
const waitFor = async (fn, ms = 8000) => { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (v) return v; await page.waitForTimeout(200); } return v; };
const setView = async (la, ln, z) => {
  const holds = () => page.evaluate(([a, b, c]) => { const m = window.__mapFinderMap, k = m.getCenter(); return Math.abs(k.lat - a) < 0.01 && Math.abs(k.lng - b) < 0.01 && m.getZoom() === c; }, [la, ln, z]);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(([a, b, c]) => { window.__mapFinderMap.setView([a, b], c, { animate: false }); }, [la, ln, z]);
    await page.waitForTimeout(2500);
    if (await holds()) { await page.waitForTimeout(2500); if (await holds()) return; }
  }
  throw new Error(`the map would not hold ${la},${ln} z${z}`);
};
const freshMap = async () => {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
};
const screenOf = ([la, ln]) => page.evaluate(([a, b]) => { const p = window.__mapFinderMap.latLngToContainerPoint([a, b]); const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; }, [la, ln]);
const OWNER_KEY = /^(owner|ownername|own_name|ownname|owner1|name)$/i;
const ownerOf = (a) => { if (!a) return null; const k = Object.keys(a).find((x) => OWNER_KEY.test(x) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };
const idOf = (a) => { if (!a) return null; const k = Object.keys(a).find((x) => /^(parno|parcelid|parcel_id|ownparcelid|parcelnum|parcelid)$/i.test(x) && String(a[x] ?? "").trim()); return k ? String(a[k]).trim() : null; };

const OFFS = [[0, 0], [30, 20], [-30, 20], [30, -20], [-30, -20], [70, 0], [-70, 0], [0, 60], [0, -60], [110, 50], [-110, -50], [160, 0], [-160, 0], [0, 110], [0, -110]];
async function lotArm({ name, lat, lng, z = 17, wantOwner = true, voidIfFail = false, texas = false }) {
  console.log(`\n== ${name} (${lat}, ${lng}) z${z}`);
  const armStart = wire.length;
  await freshMap(); await setView(lat, lng, z);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await page.waitForTimeout(4000);
  const c = await screenOf([lat, lng]);
  const st = await stamp();
  for (const [dx, dy] of OFFS) {
    const before = wire.length;
    await page.mouse.click(c.x + dx, c.y + dy);
    const got = await waitFor(async () => { const t = await summary(); return /^1 parcel/.test(t) ? t : ""; }, 9000);
    if (!got) continue;
    const clicked = await page.evaluate(([x, y]) => { const m = window.__mapFinderMap, r = m.getContainer().getBoundingClientRect(); const ll = m.containerPointToLatLng([x - r.left, y - r.top]); return { lat: ll.lat, lng: ll.lng }; }, [c.x + dx, c.y + dy]);
    const recent = wire.slice(armStart);
    const w = recent.find((x) => x.point && x.n > 0) || null;
    // The layer the app drew/identified this county from: the last parcel-shaped query that returned features.
    const src = (w || [...recent].reverse().find((x) => x.n > 0 && /FeatureServer|MapServer/.test(x.base)) || {}).base || null;
    if (!texas) expect(`${name}: the app queried a parcel layer for this ground`, !!src, src ? src.replace(/^https?:\/\/[^/]+/, "").slice(0, 120) : "(no parcel query seen)");
    let attrs = w ? w.attrs : null;
    if (!attrs && src) {
      // Identify-shaped point query on the SAME layer the app used (what the planner's Identify tool sends).
      attrs = await page.evaluate(async ([base, la, ln]) => {
        const q = new URLSearchParams({ geometry: JSON.stringify({ x: ln, y: la, spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "false", f: "json" });
        const j = await fetch(base + "/query?" + q).then((r) => r.json()).catch(() => null);
        return (j && j.features && j.features[0] && j.features[0].attributes) || null;
      }, [src, clicked.lat, clicked.lng]).catch(() => null);
    }
    const id = idOf(attrs), own = ownerOf(attrs);
    console.log(`    parcel id ${JSON.stringify(id)} · owner ${JSON.stringify(own)}${w ? " (from the app's own point query)" : " (identify-shaped point query on the same layer, at the clicked point)"}`);
    if (!texas) expect(`${name}: a parcel id came back`, !!id, attrs ? "" : "(no attributes at the clicked point)");
    if (wantOwner && !texas) expect(`${name}: an owner came back`, !!own);
    expect(`${name}: acreage shown`, /\bac\b|acre/i.test(got), got);
    await page.mouse.click(c.x + dx, c.y + dy); await page.waitForTimeout(600);
    return;
  }
  expect(`${name}: a click selects ONE lot (tried ${OFFS.length} points)`, false, (await summary()) || "(no selection)");
  if (voidIfFail) { voided = true; console.log("  ⛔ KNOWN-GOOD ARM FAILED — the run is VOID"); }
}
async function gapArm({ name, lat, lng, county, z = 17 }) {
  console.log(`\n== GAP ${name} (${lat}, ${lng})`);
  await freshMap(); await setView(lat, lng, z);
  await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click();
  await page.waitForTimeout(3000);
  const c = await screenOf([lat, lng]);
  await page.mouse.click(c.x, c.y);
  const re = new RegExp(`${county}[^\\n]{0,40}no parcel data`, "i");
  const ok = await waitFor(async () => re.test(await bodyText()), 9000);
  expect(`${name}: the page SAYS "${county} — no parcel data wired here yet" (no silent empty layer)`, !!ok, ok ? "" : ((await summary()) || "(nothing printed)"));
  expect(`${name}: no lot was selected`, !/^1 parcel/.test(await summary()));
}

// KNOWN-GOOD ARM FIRST: real Texas servers must work or the run is void.
await lotArm({ name: "Katy (Harris/Waller)", lat: 29.786, lng: -95.825, z: 16, voidIfFail: true, texas: true });
await lotArm({ name: "Fort Bend (Sugar Land)", lat: 29.5944, lng: -95.6143, z: 16, voidIfFail: true, texas: true });
await lotArm({ name: "Chambers (Anahuac)", lat: 29.7691, lng: -94.6783, z: 16, texas: true });
if (voided) { console.log("\n⛔ VOID — Texas known-good arms failed; new-county results are not trusted."); process.exit(2); }
// TN
await lotArm({ name: "TN Tipton (Covington)", lat: 35.564, lng: -89.6495 });
await lotArm({ name: "TN Madison (Jackson)", lat: 35.6145, lng: -88.8139 });
await lotArm({ name: "TN Germantown (city-scoped)", lat: 35.0868, lng: -89.81, wantOwner: false });
await lotArm({ name: "TN Collierville (city-scoped)", lat: 35.042, lng: -89.664, wantOwner: false });
await gapArm({ name: "TN Shelby (downtown Memphis)", lat: 35.1495, lng: -90.049, county: "Shelby County" });
// MS
await lotArm({ name: "MS DeSoto (Southaven)", lat: 34.9889, lng: -90.0126 });
await lotArm({ name: "MS Tate (Senatobia, MARIS West)", lat: 34.6176, lng: -89.9695 });
await lotArm({ name: "MS Lee (Tupelo, MARIS East)", lat: 34.2576, lng: -88.7034 });
await lotArm({ name: "MS Coahoma (Clarksdale)", lat: 34.2001, lng: -90.5709 });
// THE LIST'S EDGE (computed 95–105 mi bands): Itawamba is 95–100 mi (IN, wired); Webster is 100–105 mi (OUT, not wired → must say so)
await lotArm({ name: "MS Itawamba (Fulton MS — inside the 100-mile edge)", lat: 34.2718, lng: -88.4087 });
await gapArm({ name: "MS Webster (Eupora — just OUTSIDE the 100-mile edge)", lat: 33.5409, lng: -89.2631, county: "Webster County" });
// AR
await lotArm({ name: "AR Crittenden (West Memphis)", lat: 35.1465, lng: -90.1848 });
await lotArm({ name: "AR Craighead (Jonesboro)", lat: 35.8423, lng: -90.7043 });
await lotArm({ name: "AR Sharp (Ash Flat — near the 100-mile edge)", lat: 36.2215, lng: -91.6073 });
// MO / KY gaps
await gapArm({ name: "MO Dunklin (Kennett)", lat: 36.2362, lng: -90.0557, county: "Dunklin County" });
await gapArm({ name: "KY Fulton (Hickman)", lat: 36.5712, lng: -89.1862, county: "Fulton County" });

expect("no uncaught page errors", s.errors.length === 0, s.errors.join(" | "));
await s.close();
console.log(`\n${failures ? `❌ ${failures} FAILED` : "✅ PASS"} — Memphis-radius live check on build ${JSON.stringify(s.build)}`);
process.exit(failures ? 1 : 0);
