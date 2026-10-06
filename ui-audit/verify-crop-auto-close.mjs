/* verify-crop-auto-close — B2088096: three points is a polygon; Done lights up and closes+saves it itself.
 * Throwaway plan seeded into localStorage (logged out, never a real plan). Real pointer events only.
 * Walks: 2 points -> Done off, reason shown · 3 points -> Done on · Done saves the triangle drawn ·
 * 6 points -> Done saves the hexagon · undo 3->2 -> Done off again · explicit Enter-close still works. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const imgW = 3000, imgH = 1800; // a landscape survey-sized sheet, far bigger than any dialog
const grid = [];
for (let x = 0; x <= imgW; x += 250) grid.push(`<line x1='${x}' y1='0' x2='${x}' y2='${imgH}' stroke='#8a7a55' stroke-width='3'/>`);
for (let y = 0; y <= imgH; y += 250) grid.push(`<line x1='0' y1='${y}' x2='${imgW}' y2='${y}' stroke='#8a7a55' stroke-width='3'/>`);
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#e8dcb5'/>${grid.join("")}<text x='40' y='140' font-size='120' fill='#333'>TOP-LEFT</text><text x='${imgW - 560}' y='${imgH - 40}' font-size='120' fill='#333'>BOTTOM-RIGHT</text></svg>`;
const ov = { id: "ovW", name: "walkthrough-sheet.png", imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg) };
const site = { id: "W1", groupId: "W1", site: "CropWalk", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -1700, y: -1000 }, { x: 1700, y: -1000 }, { x: 1700, y: 1000 }, { x: -1700, y: 1000 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [ov], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ W1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-crop-auto-close");

const openPlan = async (url) => {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  if (!(await page.locator("text=Overlays").count())) {
    await page.locator('[data-testid="module-tab-site-planner"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator("text=CropWalk").first().dblclick();
    await page.waitForTimeout(2200);
  }
  await page.locator("text=Overlays").first().click();
  await page.waitForTimeout(500);
};
const stored = () => page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const o = raw.W1 && raw.W1.sheetOverlays.find((x) => x.id === "ovW");
  return o ? (o.crop ?? null) : undefined;
});
const waitStored = async (pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await stored(); if (pred(s)) return s; await page.waitForTimeout(150); } return s; };
const dlg = page.locator('[data-testid="overlay-crop-dialog"]');
const openCrop = async () => {
  if (!(await page.locator('[data-testid="overlay-crop-open"]').count())) await page.locator("button", { hasText: ov.name }).first().click();
  await page.locator('[data-testid="overlay-crop-open"]').click();
  await page.waitForTimeout(600);
};
const imgBox = () => dlg.locator("img").first().boundingBox();
const viewBox = () => dlg.locator("img").first().evaluate((img) => { const r = img.parentElement.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const pct = async () => parseInt(await dlg.locator('[data-testid="crop-zoom-pct"]').textContent(), 10);
const vertexCount = () => dlg.locator('[data-testid^="crop-poly-vertex-"]').count();
// screen position of an IMAGE FRACTION, read from the image's own live box — valid at any pan/zoom
const at = async (fx, fy) => { const b = await imgBox(); return { x: b.x + fx * b.width, y: b.y + fy * b.height }; };
const inView = async (p) => { const v = await viewBox(); return p.x > v.x + 8 && p.x < v.x + v.w - 8 && p.y > v.y + 8 && p.y < v.y + v.h - 8; };
const clickAt = async (fx, fy, label) => {
  const p = await at(fx, fy);
  if (!(await inView(p))) throw new Error(`${label}: target (${fx},${fy}) is off screen at ${JSON.stringify(p)} — a user could not click it either`);
  await page.mouse.click(p.x, p.y); await page.waitForTimeout(250);
};
const done = () => dlg.locator('[data-testid="crop-done"]');

await openPlan(BASE);

/* ---- KNOWN-GOOD ARM ------------------------------------------------------------------------- */
await openCrop();
{
  const rectMode = await dlg.locator("button", { hasText: "Rectangle" }).count();
  const ok = (await dlg.count()) === 1 && rectMode === 1 && (await done().isEnabled()) && (await stored()) === null;
  check("[known-good arm] uncropped overlay opens the tool in Rectangle mode with Done enabled and no crop stored", ok);
  if (!ok) { console.log("  ⛔ VOID — the probe cannot see a known answer; no score reported."); await browser.close(); process.exit(2); }
}
check("tab is foreground", await page.evaluate(() => document.visibilityState === "visible"));
const poly = () => dlg.getByRole("button", { name: "Polygon", exact: true });
const T = [[0.2, 0.2], [0.8, 0.25], [0.5, 0.85]];
const near = (a, b) => Math.abs(a - b) < 0.02 * imgW;
const matches = (pts, fr) => Array.isArray(pts) && pts.length === fr.length && fr.every((f, i) => near(pts[i][0], f[0] * imgW) && Math.abs(pts[i][1] - f[1] * imgH) < 0.02 * imgH);

/* triangle: 2 points off, 3 on, Done saves exactly the triangle */
await dlg.locator("button", { hasText: "Cancel" }).click(); await page.waitForTimeout(300);
await openCrop(); await poly().click(); await page.waitForTimeout(200);
await clickAt(...T[0], "t1"); await clickAt(...T[1], "t2");
check("two points: Done is off and says why", (await done().isDisabled()) && /at least 3 points/i.test(await dlg.locator('[data-testid="crop-done-why"]').textContent()));
await clickAt(...T[2], "t3");
check("three points: Done is on, no reason shown, ring still open (3 plain circles)", (await done().isEnabled()) && (await dlg.locator('[data-testid="crop-done-why"]').count()) === 0 && (await dlg.locator("svg circle").count()) === 3 && (await vertexCount()) === 0);
await page.screenshot({ path: OUT + "crop-autoclose-3pts.png" });
/* undo back to two */
await page.keyboard.press("Control+z"); await page.waitForTimeout(200);
check("undo to two points: Done goes off again", (await done().isDisabled()) && (await dlg.locator("svg circle").count()) === 2);
await page.keyboard.press("Control+Shift+z"); await page.waitForTimeout(200);
check("redo to three: Done on again", await done().isEnabled());
await done().click();
let s = await waitStored((c) => c && c.kind === "poly");
check("Done saved a closed 3-point polygon in image px = the triangle drawn", s && s.kind === "poly" && matches(s.pts, T), JSON.stringify(s && s.pts && s.pts.map((p) => p.map(Math.round))));

/* six points */
await openCrop(); await dlg.locator('[data-testid="crop-clear-polygon"]').click(); await page.waitForTimeout(200);
const HEX = [[0.08, 0.30], [0.30, 0.08], [0.70, 0.08], [0.92, 0.30], [0.92, 0.85], [0.08, 0.85]];
for (let i = 0; i < 6; i++) await clickAt(HEX[i][0], HEX[i][1], `h${i + 1}`);
check("six points: Done on, six open circles", (await done().isEnabled()) && (await dlg.locator("svg circle").count()) === 6);
await done().click();
s = await waitStored((c) => c && c.kind === "poly" && c.pts.length === 6);
check("Done saved the 6-point hexagon", s && matches(s.pts, HEX), JSON.stringify(s && s.pts && s.pts.length));

/* explicit close paths still work */
await openCrop(); await dlg.locator('[data-testid="crop-clear-polygon"]').click(); await page.waitForTimeout(200);
for (const p of T) await clickAt(p[0], p[1], "e");
await page.keyboard.press("Enter"); await page.waitForTimeout(250);
check("Enter still closes explicitly (3 draggable vertex handles)", (await vertexCount()) === 3);
await done().click();
s = await waitStored((c) => c && c.kind === "poly" && c.pts.length === 3);
check("…and Done then saves it", s && matches(s.pts, T));
check("no JS errors", jsErrors.length === 0, jsErrors.join("|").slice(0, 200));
await browser.close();
console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED"); process.exit(fail ? 1 : 0);
