/* verify-crop-leftovers — the four leftovers from the 2026-09-29 crop-tool owner walk (B2066224–B2066227),
 * walked as a user would on a THROWAWAY seeded plan (logged out, no external GIS, never a real plan).
 *
 *  NEW-1 B2066224  Done never destroys a shape the person cannot see from where they are standing:
 *                  saved rect → Polygon → draw → Done keeps the rect; reopen → Rectangle → Done keeps the
 *                  polygon; and the same for a shape drawn earlier in the SAME session.
 *  NEW-2 B2066225  Enter closes a drafting polygon with focus on a toolbar button, without re-firing it.
 *  NEW-3 B2066226  "Reset to full page" does not move between Rectangle and Polygon.
 *  NEW-4 B2066227  A collapsed OVERLAYS row shows its Crop… button inside a short (1600×465) window.
 *
 * Real pointer / keyboard events only (SYNTHETIC-KEYS-DONT-EDIT), foreground tab asserted
 * (FOREGROUND-OR-VOID), and a KNOWN-GOOD ARM per scenario: the dialog must open reporting the geometry we
 * know it has, or the run is VOID and prints no score.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const imgW = 3000, imgH = 1800;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='#e8dcb5'/><text x='40' y='140' font-size='120' fill='#333'>TOP-LEFT</text></svg>`;
const ov = { id: "ovW", name: "leftovers-sheet.png", imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg) };
const mkSite = (crop) => ({ id: "W1", groupId: "W1", site: "CropWalk", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -1700, y: -1000 }, { x: 1700, y: -1000 }, { x: 1700, y: 1000 }, { x: -1700, y: 1000 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [crop ? { ...ov, crop } : ov], parcelDrawings: [], status: "active", updatedAt: Date.now() });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// One fresh context per scenario: seeds the throwaway plan, opens it, expands OVERLAYS.
async function scenario(label, { crop = null, viewport = { width: 1440, height: 900 } } = {}) {
  console.log(`\n== ${label}`);
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ W1: mkSite(crop) }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await assertMeasurable(page, "verify-crop-leftovers");
  if (!(await page.locator("text=Overlays").count())) {
    await page.locator('[data-testid="module-tab-site-planner"]').first().click();
    await page.waitForTimeout(1200);
    await page.locator("text=CropWalk").first().dblclick();
    await page.waitForTimeout(2200);
  }
  await page.locator("text=Overlays").first().click();
  await page.waitForTimeout(500);
  const S = {
    page, ctx,
    dlg: page.locator('[data-testid="overlay-crop-dialog"]'),
    stored: () => page.evaluate(() => { const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const o = raw.W1 && raw.W1.sheetOverlays.find((x) => x.id === "ovW"); return o ? (o.crop ?? null) : undefined; }),
  };
  S.waitStored = async (pred, ms = 4000) => { const t = Date.now(); let s; while (Date.now() - t < ms) { s = await S.stored(); if (pred(s)) return s; await page.waitForTimeout(150); } return s; };
  S.openCrop = async () => {
    // the Overlays panel keeps Crop… inside the expanded row (Crop section), not on the collapsed row
    if (!(await page.locator('[data-testid="overlay-crop-ovW"]').count())) await page.locator("button", { hasText: ov.name }).first().click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="overlay-crop-ovW"] [data-testid="overlay-crop-open"]').click();
    await page.waitForTimeout(700);
  };
  S.imgBox = () => S.dlg.locator("img").first().boundingBox();
  S.at = async (fx, fy) => { const b = await S.imgBox(); return { x: b.x + fx * b.width, y: b.y + fy * b.height }; };
  S.clickAt = async (fx, fy) => { const p = await S.at(fx, fy); await page.mouse.click(p.x, p.y); await page.waitForTimeout(220); };
  S.done = () => S.dlg.locator('[data-testid="crop-done"]');
  S.mode = (m) => S.dlg.locator("button", { hasText: m }).first().click().then(() => page.waitForTimeout(200));
  S.vertices = () => S.dlg.locator('[data-testid^="crop-poly-vertex-"]').count();
  S.drawTriangle = async () => { await S.clickAt(0.3, 0.3); await S.clickAt(0.7, 0.3); await S.clickAt(0.5, 0.8); await page.keyboard.press("Enter"); await page.waitForTimeout(250); };
  S.save = async () => { await S.done().click(); await page.waitForTimeout(500); };
  return S;
}

/* ======================= NEW-1 — Done stores ONLY the active mode's shape =======================
 * (Supersedes B2066224's "Done carries the other shape": the hidden rectangle/polygon kept beside the
 *  active one is GONE. A rect crop has x/y/w/h and no `pts`; a poly crop has `pts` and no x/y/w/h.) */
const isOnlyRect = (c) => !!c && c.kind === "rect" && !("pts" in c) && ["x", "y", "w", "h"].every((k) => typeof c[k] === "number");
const isOnlyPoly = (c) => !!c && c.kind === "poly" && Array.isArray(c.pts) && !["x", "y", "w", "h"].some((k) => k in c);
const trimBR = async (S, dx, dy) => {
  const br = await S.dlg.locator('[data-testid="crop-handle-br"]').boundingBox();
  await S.page.mouse.move(br.x + br.width / 2, br.y + br.height / 2); await S.page.mouse.down();
  await S.page.mouse.move(br.x - dx, br.y - dy, { steps: 6 }); await S.page.mouse.up(); await S.page.waitForTimeout(250);
};
try {
  const S = await scenario("NEW-1a: saved rectangle → Polygon → new shape → Done", { crop: { kind: "rect", x: 300, y: 200, w: 1200, h: 800 } });
  await S.openCrop();
  check("[known-good arm] tool opens on the saved Rectangle, Done enabled", (await S.dlg.count()) === 1 && (await S.done().isEnabled()) && (await S.stored()).kind === "rect");
  check("tab is foreground", await S.page.evaluate(() => document.visibilityState === "visible"));
  await S.mode("Polygon");
  check("Polygon on a rect-cropped overlay starts an EMPTY open draw (not the rectangle's four corners)", (await S.vertices()) === 0 && (await S.dlg.locator("svg circle").count()) === 0);
  await S.drawTriangle();
  check("a new triangle is closed (3 draggable points)", (await S.vertices()) === 3);
  check("no 'other shape is kept' note exists any more", (await S.dlg.locator('[data-testid="crop-keeps-other"]').count()) === 0 && (await S.dlg.locator('[data-testid="crop-clear-polygon"]').count()) === 0);
  await S.save();
  const c = await S.waitStored((s) => s && s.kind === "poly");
  check("saved: active shape is the triangle", c && c.kind === "poly" && c.pts.length === 3, JSON.stringify(c));
  check("saved: ONLY the polygon — the old rectangle is not stored beside it (no x/y/w/h)", isOnlyPoly(c), JSON.stringify(c));
  // reverse: reopen (polygon active), switch to Rectangle, trim, Done — only the rectangle is stored
  await S.openCrop();
  await S.mode("Rectangle");
  await trimBR(S, 300, 150);
  await S.save();
  const c2 = await S.waitStored((s) => s && s.kind === "rect");
  check("reverse: Rectangle active and stored ALONE — the triangle polygon is not kept (no pts)", isOnlyRect(c2), JSON.stringify(c2));
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }
try {
  const S = await scenario("NEW-1b: nothing saved — shapes drawn in one session, Done from either mode");
  await S.openCrop();
  check("[known-good arm] uncropped overlay opens in Rectangle with Done enabled", (await S.dlg.count()) === 1 && (await S.done().isEnabled()) && (await S.stored()) === null);
  await trimBR(S, 300, 150);
  await S.mode("Polygon");
  check("after trimming a rectangle, Polygon on an unsaved overlay is a fresh trace", (await S.vertices()) === 0);
  await S.drawTriangle();
  await S.save();
  const c = await S.waitStored((s) => s && s.kind === "poly");
  check("Done in Polygon stores ONLY the triangle — the rectangle trimmed earlier this session is not carried", c && c.pts.length === 3 && isOnlyPoly(c), JSON.stringify(c));
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }
try {
  const S = await scenario("NEW-1c: polygon drawn first, then Rectangle chosen, Done", { crop: null });
  await S.openCrop();
  await S.mode("Polygon");
  await S.drawTriangle();
  await S.mode("Rectangle");
  await trimBR(S, 250, 120);
  await S.save();
  const c = await S.waitStored((s) => s && s.kind === "rect");
  check("Done in Rectangle stores ONLY the rectangle — the triangle drawn earlier this session is not carried (no pts)", isOnlyRect(c), JSON.stringify(c));
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }
try {
  const S = await scenario("NEW-1d: untouched Polygon visit is NOT saved as a shape", { crop: { kind: "rect", x: 300, y: 200, w: 1200, h: 800 } });
  await S.openCrop();
  await S.mode("Polygon"); await S.mode("Rectangle");
  await S.save();
  const c = await S.waitStored((s) => s && s.kind === "rect");
  check("rectangle saved unchanged with no stray polygon", isOnlyRect(c) && c.x === 300 && c.y === 200 && c.w === 1200 && c.h === 800, JSON.stringify(c));
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }
try {
  const S = await scenario("NEW-1e: Reset to full page then Done saves no crop at all", { crop: { kind: "poly", pts: [[300, 200], [1500, 250], [900, 1300]] } });
  await S.openCrop();
  check("[known-good arm] a saved polygon opens as the closed polygon (3 vertices)", (await S.vertices()) === 3);
  await S.dlg.locator('[data-testid="crop-reset"]').click(); await S.page.waitForTimeout(250);
  await S.save();
  const c = await S.waitStored((s) => s === null);
  check("Reset then Done stores crop null (no leftover shape of either kind)", c === null, JSON.stringify(c));
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }

/* ======================= NEW-2 — Enter closes the polygon wherever focus is ======================= */
try {
  const S = await scenario("NEW-2: Enter with focus on a toolbar button");
  await S.openCrop();
  await S.mode("Polygon");
  await S.clickAt(0.2, 0.2); await S.clickAt(0.8, 0.2); await S.clickAt(0.5, 0.8);
  check("[known-good arm] three points placed, polygon still drafting (no draggable vertices yet)", (await S.vertices()) === 0 && (await S.dlg.locator("svg circle").count()) === 3);
  await S.dlg.locator('[data-testid="crop-zoom-in"]').click(); await S.page.waitForTimeout(200);
  const focused = await S.page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
  check("focus really sits on the zoom-in button", focused === "crop-zoom-in", String(focused));
  const pct0 = await S.dlg.locator('[data-testid="crop-zoom-100"]').textContent();
  await S.page.keyboard.press("Enter"); await S.page.waitForTimeout(300);
  check("Enter closed the polygon", (await S.vertices()) === 3);
  check("…and did not re-fire the focused zoom-in button", (await S.dlg.locator('[data-testid="crop-zoom-100"]').textContent()) === pct0, pct0);
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }

/* ======================= NEW-3 — Reset holds still across modes ======================= */
try {
  const S = await scenario("NEW-3: Reset to full page does not slide when switching modes");
  await S.openCrop();
  const reset = S.dlg.locator('[data-testid="crop-reset"]');
  const rectX = (await reset.boundingBox()).x;
  await S.mode("Polygon");
  const polyX = (await reset.boundingBox()).x;
  check("Reset is at the same x in Rectangle and Polygon", Math.abs(rectX - polyX) < 0.5, `${rectX} vs ${polyX}`);
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }

/* ======================= NEW-4 — Crop is not hunted for on a short window =======================
 * The Overlays panel now keeps Crop… in the row's expanded detail (the collapsed row carries no crop control),
 * so the check is: one click on the row brings Crop… fully inside a short window, and it opens the tool. */
try {
  const S = await scenario("NEW-4: OVERLAYS row, 1600×465 window", { viewport: { width: 1600, height: 465 } });
  check("[known-good arm] the overlay row exists and is collapsed (no Opacity control, no Crop section showing)", (await S.page.locator('[data-testid="reference-row-ovW"]').count()) === 1 && (await S.page.locator('[data-testid="overlay-opacity-pct"]').count()) === 0 && (await S.page.locator('[data-testid="overlay-crop-ovW"]').count()) === 0);
  await S.page.locator("button", { hasText: ov.name }).first().click(); await S.page.waitForTimeout(400);
  const btn = S.page.locator('[data-testid="overlay-crop-ovW"] [data-testid="overlay-crop-open"]');
  await btn.scrollIntoViewIfNeeded(); await S.page.waitForTimeout(200);
  const vis = await btn.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, w: r.width, h: r.height }; });
  check("after expanding the row, Crop… is fully inside the short window (reachable in one scroll of the panel)", vis.top >= 0 && vis.bottom <= vis.vh && vis.w > 0, JSON.stringify(vis));
  await S.page.screenshot({ path: new URL("./screens/crop-leftovers-short.png", import.meta.url).pathname });
  await btn.click(); await S.page.waitForTimeout(700);
  check("clicking it opens the crop tool", (await S.dlg.count()) === 1);
  await S.ctx.close();
} catch (e) { check("scenario ran to the end", false, String(e).split("\n")[0]); }

await browser.close();
console.log(fail ? `\n✗ ${fail} check(s) FAILED` : "\n✓ ALL PASS");
process.exit(fail ? 1 : 0);
