/* B325 regression guard — the Site Planner map/planner must behave EXACTLY as before after its
 * pan/zoom math was migrated to the shared viewport engine. Seeds a site into localStorage so the
 * app boots straight into the planner (no auth, no tiles), then asserts:
 *
 *   1. The planner SVG canvas renders (the migrated SitePlanner mounts cleanly).
 *   2. Wheel-up over the canvas zooms IN — the px/ft readout increases (shared zoomAround drives it).
 *   3. Wheel-down zooms back OUT — the readout decreases.
 *   4. The Pan (hand) tool drags the canvas without changing zoom (px/ft unchanged), and content moves.
 *   5. No uncaught page errors.
 *
 * Run:  npx vite preview --port 4173   (one shell)   ·   node ui-audit/verify-siteplanner-viewport.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e6", type: "trailer", cx: 330, cy: -40, w: 150, h: 200, rot: 0 },
];
const demoSite = { id: "vp-demo", groupId: "vp-demo", site: "Viewport Demo", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

const results = [];
const ok = (name, pass, detail) => { results.push({ pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };
const ppf = (page) => page.evaluate(() => { const m = document.body.innerText.match(/([\d.]+)\s*px\/ft/); return m ? parseFloat(m[1]) : null; });
// union bbox of the planner SVG's rendered shapes — used to see the content move on a pan
const contentBox = (page) => page.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll("svg"));
  const svg = svgs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  if (!svg) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
  for (const el of svg.querySelectorAll("rect,polygon,path,polyline,line")) {
    const r = el.getBoundingClientRect(); if (r.width < 1 && r.height < 1) continue;
    minX = Math.min(minX, r.left); minY = Math.min(minY, r.top); maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom); n++;
  }
  return n ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.addInitScript(seed);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500); // let the planner boot + lay out
  const haveSvg = await page.evaluate(() => Array.from(document.querySelectorAll("svg")).some((s) => s.clientWidth > 400 && s.clientHeight > 300));
  ok("1 planner SVG canvas renders", haveSvg, haveSvg ? "large planner svg present" : "no planner svg found");

  const cx = 720, cy = 470; // viewport centre, over the canvas

  // ---- 2/3. wheel zoom in then out changes the px/ft readout ----
  const p0 = await ppf(page);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
  const p1 = await ppf(page);
  await page.mouse.wheel(0, 300); await page.mouse.wheel(0, 300); await page.waitForTimeout(200);
  const p2 = await ppf(page);
  ok("2 wheel-up zooms the map in", p0 != null && p1 != null && p1 > p0 * 1.05, `px/ft ${p0} → ${p1}`);
  ok("3 wheel-down zooms the map out", p1 != null && p2 != null && p2 < p1, `px/ft ${p1} → ${p2}`);

  // ---- 4. Pan drags the canvas without zooming. Drive it via hold-Space (the most reliable
  // path; the Pan rail button needs the rail open). The pan-drag code is untouched by B325 —
  // this just confirms the migrated module still pans + that pan never changes zoom. ----
  const b0 = await contentBox(page); const pp0 = await ppf(page);
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Space"); await page.waitForTimeout(80);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 80, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up("Space");
  await page.waitForTimeout(200);
  const b1 = await contentBox(page); const pp1 = await ppf(page);
  const movedX = b0 && b1 ? b1.x - b0.x : 0, movedY = b0 && b1 ? b1.y - b0.y : 0;
  ok("4a pan tool moves the canvas content", b0 && b1 && Math.hypot(movedX, movedY) > 60, `content moved (${Math.round(movedX)}, ${Math.round(movedY)})px`);
  ok("4b pan does not change zoom", pp0 != null && pp1 != null && Math.abs(pp1 - pp0) < 1e-6, `px/ft ${pp0} → ${pp1}`);

  ok("5 no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 2).join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
