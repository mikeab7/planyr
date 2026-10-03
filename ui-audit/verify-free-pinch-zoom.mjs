#!/usr/bin/env node
/* NEW-1 (B2016112) — free pinch zoom on the browse maps: Map Finder, Dashboard locations map, Food map.
 *
 *   vite (dev) on :4319   →   node ui-audit/verify-free-pinch-zoom.mjs [--url http://localhost:4319/]
 *   (Dashboard needs a stub Supabase host: start vite with VITE_SUPABASE_URL=https://stub.supabase.co
 *    VITE_SUPABASE_ANON_KEY=stub-anon-key)
 *
 * Per map, against the REAL app (maps exposed read-only via the E2E-gated window.__mapFinderMap /
 * __locationsMap / __foodMap):
 *   · KNOWN-GOOD ARM (clause 6): the double-click and +/- button steps are exactly 1.0 — expected
 *     value known independently of the code under test; the run is VOID if they do not report it.
 *   · a REAL two-finger touch pinch (CDP Input.dispatchTouchEvent) that ends between levels leaves
 *     getZoom() fractional after release — no snap;
 *   · one mouse-wheel notch → exactly ±1.0; a ctrl+wheel trackpad-pinch burst → fractional.
 * Food map extra: from a fractional zoom the long-jump setView (Houston → Maui) paints real tiles
 * (decodable PNGs served for every tile request), no flat grey; the zoom-gate notice flips at
 * MIN_PIN_ZOOM exactly as before. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";
import { fakeTilePng, parseTileUrl } from "./lib/fakeTile.mjs";
const { chromium } = pw;
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";
const jwt = (p) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(p)}.sig`; };
const session = { access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }), refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: UID, aud: "authenticated", role: "authenticated", email: "o@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const sites = [["Alpha", 29.735, -94.977], ["Beta", 29.949, -95.342], ["Gamma", 29.81, -95.56]].map(([name, lat, lon], i) => ({ id: `zz-${i}`, group_id: `zz-${i}`, site: name, name, county: "Harris", status: "active", role: "pursuit", updated_at: new Date().toISOString(), origin: { lat, lon }, user_id: UID, team_id: null, share_locked: false, deleted_at: null, version: 1, parcels: [], els: [], measures: [], settings: {} }));

let fails = 0;
const ok = (name, cond, extra = "") => { if (!cond) fails++; console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;

async function pinch(page, cdp, cx, cy, fromGap, toGap) {
  const pts = (g) => [{ x: cx - g / 2, y: cy, id: 1 }, { x: cx + g / 2, y: cy, id: 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(fromGap) });
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(fromGap + (toGap - fromGap) * i / steps) });
    await pacedWait(page, 30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await pacedWait(page, 900); // let the unsnapped zoom animation finish
}

async function exercise(browser, label, hash, handle, { tileHosts = true, seed = false, food = false } = {}) {
  console.log(`\n== ${label} ==`);
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true, ignoreHTTPSErrors: true });
  if (seed) {
    await installStubSupabase(ctx, { tables: { sites, comps: [] }, session, wire: [], control: {} });
    const local = Object.fromEntries(sites.map((x) => [x.id, { id: x.id, groupId: x.group_id, site: x.site, name: x.name, origin: x.origin, county: x.county, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.parse(x.updated_at) }]));
    await ctx.addInitScript(`try{localStorage.setItem('sb-stub-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('planarfit:sites:cloud:${UID}',${JSON.stringify(JSON.stringify(local))});}catch(e){}`);
  }
  await ctx.addInitScript("window.__PLANYR_E2E = true;");
  let tilesServed = 0;
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|stub\.supabase\.co)[^/]+\/.*/, (route) => {
    const t = parseTileUrl(route.request().url());
    if (t) { tilesServed++; return route.fulfill({ status: 200, contentType: "image/png", body: fakeTilePng(t.z, t.x, t.y) }); }
    return route.abort();
  });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  await page.goto(`${BASE}/${hash}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await assertMeasurable(page, "verify-free-pinch-zoom");
  await page.waitForFunction((h) => !!window[h], handle, { timeout: 30000 });
  await pacedWait(page, 1500);
  const z = () => page.evaluate((h) => window[h].getZoom(), handle);
  const setZ = (v) => page.evaluate(([h, v]) => { window[h].setZoom(v, { animate: false }); }, [handle, v]);
  await page.evaluate((h) => window[h].getContainer().scrollIntoView({ block: "center" }), handle); // in-page scroll so the gesture lands on-screen
  await pacedWait(page, 400);
  const box = await page.evaluate((h) => { const r = window[h].getContainer().getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, handle);
  const cdp = await ctx.newCDPSession(page);

  // KNOWN-GOOD ARM — independent expected values.
  await setZ(10);
  let z0 = await z();
  await page.mouse.dblclick(box.x, box.y); await pacedWait(page, 800);
  const dz = (await z()) - z0;
  ok(`${label}: double-click steps exactly one level (known-good arm)`, near(dz, 1, 0.001), `Δ=${dz}`);
  await setZ(10); z0 = await z();
  const plus = await page.$(".leaflet-control-zoom-in");
  if (plus) { await plus.click({ force: true }); await pacedWait(page, 800); const d = (await z()) - z0; ok(`${label}: + button steps exactly 1.0`, near(d, 1, 0.001), `Δ=${d}`);
    const minus = await page.$(".leaflet-control-zoom-out"); await minus.click({ force: true }); await pacedWait(page, 800); const d2 = (await z()) - z0; ok(`${label}: − button steps back exactly`, near(d2, 0, 0.001), `Δ=${d2}`); }

  // Real touch pinch landing between levels.
  await setZ(10); z0 = await z();
  await pinch(page, cdp, box.x, box.y, 120, 120 * 1.55);
  const zp = await z();
  ok(`${label}: touch pinch zooms in`, zp > z0 + 0.3, `${z0} → ${zp}`);
  ok(`${label}: pinch settles FRACTIONAL, no snap to a whole level`, Math.abs(zp - Math.round(zp)) > 0.05, `zoom=${zp}`);
  await pinch(page, cdp, box.x, box.y, 200, 200 * 0.7);
  const zp2 = await z();
  ok(`${label}: pinch-out settles fractional too`, zp2 < zp - 0.2 && Math.abs(zp2 - Math.round(zp2)) > 0.05, `${zp} → ${zp2}`);

  // Wheel notch: exactly one level, both directions, from an integer start AND from a fractional one.
  for (const start of [10, 10.37]) {
    await setZ(start); await page.mouse.move(box.x, box.y);
    await page.mouse.wheel(0, -100); await pacedWait(page, 900);
    const up = (await z()) - start;
    ok(`${label}: one wheel notch up from ${start} is exactly +1.0`, near(up, 1, 0.001), `Δ=${up}`);
    await page.mouse.wheel(0, 100); await pacedWait(page, 900);
    const dn = (await z()) - start;
    ok(`${label}: one wheel notch down returns to ${start}`, near(dn, 0, 0.001), `Δ=${dn}`);
  }
  // Trackpad pinch = ctrl+wheel with small deltas → continuous.
  await setZ(10); await page.mouse.move(box.x, box.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -4.3); await pacedWait(page, 16); }
  await page.keyboard.up("Control"); await pacedWait(page, 400);
  const zt = await z();
  ok(`${label}: trackpad-style pinch is continuous (fractional, moved)`, zt > 10.2 && Math.abs(zt - Math.round(zt)) > 0.03, `zoom=${zt}`);

  if (food) {
    // zoom-gate notice flips at MIN_PIN_ZOOM (15) exactly as before, fractional included
    await setZ(14.7); await pacedWait(page, 400);
    const noticeLow = await page.locator('[data-testid="food-zoomed-out-notice"]').count();
    await setZ(15.2); await pacedWait(page, 400);
    const noticeHigh = await page.locator('[data-testid="food-zoomed-out-notice"]').count();
    ok("Food: pin gate — notice at 14.7, gone at 15.2", noticeLow > 0 && noticeHigh === 0, `low=${noticeLow} high=${noticeHigh}`);
    // long jump from a fractional zoom: Houston → Maui, same call the search-select effect makes.
    await setZ(12.6); await pacedWait(page, 300);
    tilesServed = 0;
    const res = await page.evaluate(async () => {
      const m = window.__foodMap; const tz = Math.max(m.getZoom(), 15);
      m.invalidateSize({ animate: false, pan: false });
      m.setView([20.8783, -156.6825], tz, { animate: false });
      await new Promise((r) => setTimeout(r, 2500));
      const imgs = [...m.getContainer().querySelectorAll("img.leaflet-tile")];
      const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0);
      return { tz, n: imgs.length, loaded: loaded.length, c: m.getCenter() };
    });
    ok("Food: long jump from fractional zoom paints (no flat grey)", res.n > 0 && res.loaded === res.n, JSON.stringify(res));
  }
  ok(`${label}: no page errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
await exercise(browser, "Map Finder", "#/map", "__mapFinderMap");
await exercise(browser, "Food map", "#/food", "__foodMap", { food: true });
await exercise(browser, "Dashboard locations map", "#/", "__locationsMap", { seed: true });
await browser.close();
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
