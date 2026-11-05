#!/usr/bin/env node
/* verify-food-live — V1450368 (B2025280). SIGNED-IN, on a real deploy, as the throwaway test account.
 * Checks the /food basemap work with real logged pins: pin legibility on Site Plan + Hybrid, a far-away
 * search jump (no blank map), and the credit not painting through the phone detail sheet.
 * Throwaway data: 4 manual-pin visits prefixed ZZV1450368 on the TEST account only, ALWAYS deleted in `finally`.
 * Usage: node ui-audit/verify-food-live.mjs [base=https://planyr.io] [--shots dir]
 */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const si = args.indexOf("--shots");
const SHOTS = si >= 0 ? args[si + 1] : null;
const BASE = args.find((a, i) => !a.startsWith("--") && i !== si + 1) || "https://planyr.io";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PREFIX = "ZZV1450368";
const results = [];
const check = (label, ok, extra = "") => { results.push({ label, ok }); console.log(`${ok ? "PASS" : "FAIL"} — ${label}${extra ? ` (${extra})` : ""}`); };

// 4 logged pins across the rating ramp, clustered near the default Houston centre (29.76,-95.37).
const PINS = [
  { custom_name: `${PREFIX} low`,  custom_lat: 29.7612, custom_lon: -95.3712, rating: 2 },
  { custom_name: `${PREFIX} mid`,  custom_lat: 29.7606, custom_lon: -95.3692, rating: 5 },
  { custom_name: `${PREFIX} good`, custom_lat: 29.7596, custom_lon: -95.3706, rating: 7.5 },
  { custom_name: `${PREFIX} top`,  custom_lat: 29.7590, custom_lon: -95.3686, rating: 9.5 },
];

async function build(page) {
  return page.evaluate(async () => {
    const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    const chunks = [...document.querySelectorAll("script[src],link[rel=modulepreload]")].map((n) => n.src || n.href).filter((u) => /assets\//.test(u)).map((u) => u.split("/").pop());
    return { build: v && v.build, chunks: chunks.slice(0, 3) };
  });
}
async function cleanup(page) {
  return page.evaluate(async (p) => {
    const sb = window.pfSupabase;
    const del = await sb.from("food_visits").delete().like("custom_name", p + "%");
    const left = await sb.from("food_visits").select("id").like("custom_name", p + "%");
    return { error: del.error ? String(del.error.message) : null, left: (left.data || []).length };
  }, PREFIX);
}
const tilesPainted = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].filter((i) => i.naturalWidth > 0 && i.complete).length);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pressed = async (page, k) => (await page.getAttribute(`[data-testid="food-basemap-${k}"]`, "aria-pressed")) === "true";

async function openFood(page) {
  await page.goto(`${BASE}/#/food`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" }); // hash-only goto does not remount on a signed-in session
  await page.waitForSelector('[data-testid="food-basemap-satellite"]', { timeout: 30000 });
}
const distKm = (a, b) => { const R = 6371, t = Math.PI / 180; const dl = (b[0] - a[0]) * t, dn = (b[1] - a[1]) * t; const x = Math.sin(dl / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

async function main() {
  const s = await openSignedIn({ base: BASE });
  const { page } = s;
  let sp = null;
  try {
    await assertMeasurable(page, "verify-food-live");
    const b0 = await build(page);
    console.log("signed in:", s.proof.email, "| build", JSON.stringify(b0));
    const pre = await page.evaluate(async () => { const r = await window.pfSupabase.from("food_visits").select("id"); return r.error ? String(r.error.message) : (r.data || []).length; });
    console.log("test-account visits before (left untouched):", pre);
    const ins = await page.evaluate(async ({ pins }) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const r = await window.pfSupabase.from("food_visits").insert(pins.map((p) => ({ ...p, user_id: u.user.id }))).select("id");
      return r.error ? { error: String(r.error.message) } : { n: r.data.length };
    }, { pins: PINS });
    check("seeded 4 throwaway logged pins on the test account", ins.n === 4, JSON.stringify(ins));

    await openFood(page);
    await page.evaluate(() => { try { localStorage.removeItem("planyr:food:basemap"); } catch (_) {} });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-basemap-satellite"]', { timeout: 30000 });
    await assertMeasurable(page, "verify-food-live");
    const b1 = await build(page);
    check("served build matches /version.json (same observation)", !!b1.build && b1.build === b0.build, `build ${b1.build}; chunks ${b1.chunks.join(",")}`);
    check("a new user opens on the default (Satellite = the Site Plan imagery)", (await pressed(page, "satellite")) && !(await pressed(page, "hybrid")));
    const buttons = await page.evaluate(() => [...document.querySelectorAll('[data-testid="food-basemap-toggle"] button')].map((b) => b.textContent.trim()));
    check("control offers exactly the two choices", buttons.length === 2, buttons.join(" | "));

    for (let i = 0; i < 5; i++) { await page.click(".leaflet-control-zoom-in"); await sleep(300); }
    await sleep(4000);
    check("imagery tiles painted (default)", (await tilesPainted(page)) > 6);
    check("pin layer present", (await page.evaluate(() => document.querySelectorAll('[data-testid="food-map"] canvas').length)) >= 1);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-default-desktop.png` });
    await page.click('[data-testid="food-basemap-hybrid"]'); await sleep(4500);
    check("imagery tiles painted (Hybrid)", (await tilesPainted(page)) > 6);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-hybrid-desktop.png` });

    // Persistence
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-basemap-hybrid"]', { timeout: 30000 });
    check("Hybrid choice persists across a reload", await pressed(page, "hybrid"));

    // Far-away search jump: a real reference place >20 km from the Midtown centre, found by name through the UI.
    const far = await page.evaluate(async () => {
      const r = await window.pfSupabase.from("food_places").select("name,lat,lon").gt("lat", 29.93).limit(40);
      return (r.data || []).filter((p) => p.name && p.name.length > 5);
    });
    const target = far.map((p) => ({ ...p, km: distKm([29.76, -95.37], [p.lat, p.lon]) })).filter((p) => p.km > 20).sort((a, b) => a.km - b.km)[0];
    check("found a reference place far from the start view", !!target, target ? `${target.name} ${target.km.toFixed(0)} km` : "");
    if (target) {
      const box = page.locator('[data-testid="food-search-box"] input, input[data-testid="food-search-box"]').first();
      await box.click(); await box.fill(target.name);
      await page.waitForSelector('[data-testid="food-search-results"]', { timeout: 15000 });
      await page.locator('[data-testid="food-search-results"] [role="option"], [data-testid="food-search-results"] li, [data-testid="food-search-results"] button').first().click();
      await sleep(9000); // let the jump + tile loads settle; NO pan/zoom by us
      const painted = await tilesPainted(page);
      const covered = await page.evaluate(() => {
        const m = document.querySelector('[data-testid="food-map"]').getBoundingClientRect();
        const t = [...document.querySelectorAll('[data-testid="food-map"] .leaflet-tile-pane img.leaflet-tile')].filter((i) => i.naturalWidth > 0).map((i) => i.getBoundingClientRect());
        let cells = 0, hit = 0; for (let x = 0.1; x < 1; x += 0.2) for (let y = 0.1; y < 1; y += 0.2) { cells++; const px = m.left + m.width * x, py = m.top + m.height * y; if (t.some((r) => px >= r.left && px <= r.right && py >= r.top && py <= r.bottom)) hit++; }
        return hit / cells;
      });
      check("after the far jump the map is filled with tiles without panning (no blank map)", painted > 6 && covered >= 0.95, `painted ${painted}, viewport covered ${(covered * 100).toFixed(0)}%`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-after-jump-desktop.png` });
    }
    return;
  } finally {
    const c = await cleanup(page).catch((e) => ({ error: String(e), left: -1 }));
    check("cleanup: throwaway pins deleted (none left)", c.left === 0 && !c.error, JSON.stringify(c));
    await s.close().catch(() => {});
  }
}

async function phone() {
  const s = await openSignedIn({ base: BASE, device: "iPhone 15" });
  const { page } = s;
  try {
    await assertMeasurable(page, "verify-food-live");
    await openFood(page);
    const far = await page.evaluate(async () => { const r = await window.pfSupabase.from("food_places").select("name,lat,lon").gt("lat", 29.7).lt("lat", 29.8).limit(30); return (r.data || []).filter((p) => p.name && p.name.length > 5)[0]; });
    const box = page.locator('[data-testid="food-search-box"] input, input[data-testid="food-search-box"]').first();
    await box.click(); await box.fill(far.name);
    await page.waitForSelector('[data-testid="food-search-results"]', { timeout: 15000 });
    await page.locator('[data-testid="food-search-results"] [role="option"], [data-testid="food-search-results"] li, [data-testid="food-search-results"] button').first().click();
    await sleep(6000);
    const sheet = await page.locator('[data-testid="food-bottom-sheet"]').boundingBox();
    check("phone (emulated iPhone 15): place card opens in the bottom sheet", !!sheet, sheet ? `sheet top ${Math.round(sheet.y)}` : "no sheet");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/live-sheet-phone.png` });
    if (sheet) {
      const credit = await page.evaluate(() => {
        const vis = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? { x: r.x, y: r.y, w: r.width, h: r.height } : null; };
        const t = vis(document.querySelector('[data-testid="food-attribution-toggle"]')), txt = vis(document.querySelector('[data-testid="food-attribution-text"]'));
        const leaflet = vis(document.querySelector(".leaflet-control-attribution"));
        return { t, txt, leaflet };
      });
      const over = (b) => b && b.y + b.h > sheet.y + 1 && b.y < sheet.y + sheet.height && b.x < sheet.x + sheet.width && b.x + b.w > sheet.x;
      check("credit control does not overlap the sheet (nothing paints through it)", !over(credit.t) && !over(credit.txt) && !over(credit.leaflet), JSON.stringify(credit.t || credit.txt));
      const topEl = await page.evaluate((y) => { const e = document.elementFromPoint(200, y + 20); return e ? (e.closest('[data-testid]') || e).getAttribute("data-testid") : null; }, sheet.y);
      check("what a finger would hit just inside the sheet's top is the sheet, not the map or its credit", /sheet/.test(topEl || ""), String(topEl));
    }
  } finally { await s.close().catch(() => {}); }
}

main().then(() => phone()).then(() => { const ok = results.every((r) => r.ok); console.log(ok ? "\nPASS" : "\nFAIL"); process.exit(ok ? 0 : 1); }).catch((e) => { console.error("FATAL", e); process.exit(1); });
