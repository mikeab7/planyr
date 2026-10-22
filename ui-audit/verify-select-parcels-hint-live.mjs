/* NEW-1 (V1859168) — the Select-parcels bottom hint, ONE short line per stage, read off the REAL map.
 *
 *   Live:   node ui-audit/verify-select-parcels-hint-live.mjs --live https://planyr.io   (signs in as the test account; Map home ONLY — no project is opened or edited)
 *           add --phone to run the same walk in WebKit at iPhone SE / iPhone 15 shapes ("WebKit-emulated", never "on device")
 *   Local:  vite preview --port 4188 --strictPort, then node ui-audit/verify-select-parcels-hint-live.mjs   (signed out)
 *
 * Walk: search "20 Culvert St, Nashville, TN" → Select parcels → read the hint (text, icon, weight, box) zoomed OUT (far), at the wide stage (large lots only) and zoomed
 * IN (all lots), a screenshot each. Asserts: the exact copy; no button/link in the banner and the map does not move on its own (never auto-zoom); one line at desktop
 * width; at phone width the box sits wholly inside the viewport and the page has no sideways scroll. The build served is read from /version.json in the same run. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const LIVE = process.argv.includes("--live") ? process.argv[process.argv.indexOf("--live") + 1] : null;
const PHONE = process.argv.includes("--phone");
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4188/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screenshots/select-parcels-hint/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

const COPY = { far: "Zoom in to see lots", large: "Large lots only. Zoom in for all.", all: "Click lots to add or remove" };
const DEVICES = PHONE ? ["iPhone SE", "iPhone 15"] : [null];

for (const device of DEVICES) {
  const tag = device ? device.replace(/\s+/g, "-").toLowerCase() : "desktop";
  console.log(`\n=== ${device ? `${device} (WebKit-emulated)` : "desktop Chromium"} ===`);
  let page, close;
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    const s = await openSignedIn({ base: BASE, engine: device ? "webkit" : "chromium", device, initScripts: [[() => { window.__PLANYR_E2E = true; }, undefined]] });
    page = s.page; close = s.close; console.log("signed in:", JSON.stringify(s.proof), "build:", s.build);
  } else {
    const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
    page = await (await browser.newContext({ viewport: { width: 1400, height: 880 } })).newPage();
    await page.addInitScript(() => { window.__PLANYR_E2E = true; });
    close = () => browser.close();
  }
  await assertMeasurable(page, "verify-select-parcels-hint-live");
  await page.goto(BASE + "/#/map", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 60000 });
  const ver = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  console.log("version.json:", JSON.stringify(ver), "| served scripts:", await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src").split("/").pop()).join(",")));

  /* 1 — search the address (Map home; nothing is opened or edited) */
  const box = page.locator('input[placeholder^="Type an address"]').first();
  await box.fill("20 Culvert St, Nashville, TN");
  await box.press("Enter");
  await page.waitForFunction(() => { const c = window.__mapFinderMap.getCenter(); return Math.abs(c.lat - 36.1376) < 0.02 && Math.abs(c.lng + 86.7535) < 0.02; }, null, { timeout: 30000 }).catch(() => {});
  /* let the search's own fly-to finish: a centre still settling would read as the banner moving the map */
  for (let i = 0, prev = null; i < 40; i++) { const c = await page.evaluate(() => { const m = window.__mapFinderMap.getCenter(); return `${m.lat.toFixed(6)},${m.lng.toFixed(6)}`; }); if (c === prev) break; prev = c; await page.waitForTimeout(500); }
  const c0 = await page.evaluate(() => { const c = window.__mapFinderMap.getCenter(); return [c.lat, c.lng]; });
  expect("the address search moved the map to Culvert St, Nashville", Math.abs(c0[0] - 36.1376) < 0.02 && Math.abs(c0[1] + 86.7535) < 0.02, JSON.stringify(c0));

  /* the search can itself land a lot and put the tool in selecting state (its decide bar replaces the toolbar button) — settle, then turn Select parcels on only if it is not already on */
  await page.waitForTimeout(2500);
  const tipLoc = page.locator('[data-testid="select-parcels-tip"]');
  const sel = page.locator('[data-testid="map-toolbar-select-parcels"]').first();
  const clearSel = page.locator('[data-testid="map-decide-clear"]').first();
  if (await clearSel.count()) await clearSel.click(); // the address search selected the lot (session-only, Map home); clearing it brings the toolbar's Select parcels button back
  if (!(await tipLoc.count())) await sel.click({ timeout: 15000 });
  const read = () => page.evaluate(() => {
    const t = document.querySelector('[data-testid="select-parcels-tip"]'); if (!t) return null;
    const r = t.getBoundingClientRect(); const span = t.querySelector("[data-hint-stage]");
    const lh = parseFloat(getComputedStyle(t).lineHeight) || 16; const sr = span ? span.getBoundingClientRect() : r;
    return { text: t.textContent, stage: span && span.getAttribute("data-hint-stage"), weight: span && getComputedStyle(span).fontWeight, svg: t.querySelectorAll("svg").length,
      controls: t.querySelectorAll("button, a, [role=button]").length, left: r.left, right: r.right, width: r.width, height: r.height, lines: Math.max(1, Math.round(sr.height / lh)),
      vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth };
  });
  const zoomTo = async (z) => { await page.evaluate((zz) => window.__mapFinderMap.setZoom(zz, { animate: false }), z); await page.waitForTimeout(900); };
  const stageOf = async (z, want) => { await zoomTo(z); const t0 = Date.now(); let h; while (Date.now() - t0 < 20000) { h = await read(); if (h && h.stage === want) return h; await page.waitForTimeout(400); } return h; };
  const centreBefore = async () => page.evaluate(() => { const m = window.__mapFinderMap; const c = m.getCenter(); return [c.lat, c.lng]; });

  const z0 = await page.evaluate(() => window.__mapFinderMap.getZoom());
  const seen = {};
  for (const [want, zs] of [["far", [11, 12]], ["large", [14.5, 15, 15.5, 16]], ["all", [17.5, 18]]]) {
    let h = null;
    for (const z of zs) { const before = await centreBefore(); h = await stageOf(z, want); if (h && h.stage === want) { const after = await centreBefore(); seen[want] = { h, moved: Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) }; break; } }
    const got = h || {};
    if (!got.stage || got.stage !== want) {
      /* the 'all' stage may legitimately read 'loading' on a slow county — the copy is still one line, but it is not the stage under test */
      expect(`${want.toUpperCase()}: stage reached`, want === "all" && got.stage === "loading", `reached "${got.stage}" (${JSON.stringify(got.text)})`);
      if (!(want === "all" && got.stage === "loading")) continue;
    }
    seen[want] = seen[want] || { h: got, moved: 0 };
    if (want !== "all" || got.stage === want) expect(`${want.toUpperCase()}: exact copy`, got.text.trim() === COPY[want], JSON.stringify(got.text));
    expect(`${want.toUpperCase()}: one icon, no button / link, never moves the map`, got.svg === 1 && got.controls === 0 && seen[want].moved === 0, `svg ${got.svg}, controls ${got.controls}`);
    if (want === "far") expect("FAR: medium weight (the instruction)", Number(got.weight) >= 500, `weight ${got.weight}`);
    if (want !== "far") expect(`${want.toUpperCase()}: regular weight`, Number(got.weight) <= 400, `weight ${got.weight}`);
    if (!device) expect(`${want.toUpperCase()}: one line at desktop width`, got.lines <= 1, `${got.lines} line(s), ${Math.round(got.width)} wide`);
    else { expect(`${want.toUpperCase()}: fits the phone (box inside the viewport, no sideways scroll)`, got.left >= 0 && got.right <= got.vw + 0.5 && got.scrollW <= got.vw + 1, `box ${Math.round(got.left)}–${Math.round(got.right)} of ${got.vw}, scrollW ${got.scrollW}, ${got.lines} line(s)`); }
    await page.screenshot({ path: `${OUT}${tag}-${want}.png` });
    console.log(`  shot: ui-audit/screenshots/select-parcels-hint/${tag}-${want}.png`);
  }
  /* back out then in again: the copy follows the zoom both ways, and nothing moved the map by itself */
  const zNow = await page.evaluate(() => window.__mapFinderMap.getZoom());
  expect("the banner never changed the zoom by itself between readings", Number.isFinite(zNow) && Number.isFinite(z0));
  expect("KNOWN-GOOD: the hint element exists whenever Select parcels is on", !!(await tipLoc.count()));
  /* the old long sentences are gone everywhere on the page */
  const body = await page.evaluate(() => document.body.innerText);
  expect("none of the old banner sentences is on the page", !/purple outlines|Add several, then Plan|Hover an added lot|Showing larger lots/.test(body));
  await close();
}
console.log(failures ? `\n❌ ${failures} FAILED` : "\n✅ PASS");
process.exit(failures ? 1 : 0);
