/* NEW-2 (B2163345) — SELECTION HANDLES FIT THE CROPPED AREA, driven in a real browser (Site tab canvas).
 *
 * After a crop, the selection box + 4 resize grips + rotate grip must hug what is VISIBLE (the crop rect, or a
 * polygon crop's bounding box), and scale / rotate must pivot about the VISIBLE centre without changing the
 * crop-vs-image relationship:
 *   KNOWN-GOOD ARM (DRIVER-SCROLL §6): an UNCROPPED overlay's grips sit on its image corners — if not, the run is VOID.
 *   1. rect crop → grips on the crop's corners (not the image's)            2. poly crop → grips on its bounding box
 *   3. corner drag scales the overlay as a whole: crop JSON untouched, visible centre fixed, visible width grows
 *   4. rotate drag: visible centre fixed, rotation stored, crop untouched   5. Reset crop → grips back on the full image
 * Logged out, local fixture, no external GIS. Modes: BASE_URL (default the local preview).
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "") + "/";
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
const near = (a, b, tol = 2.5) => Math.abs(a - b) <= tol;

const imgW = 1000, imgH = 800;
const svg = (c) => `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='${c}'/></svg>`;
const mk = (id, c, extra = {}) => ({ id, name: id + ".png", imgW, imgH, page: 1, pageCount: 1, ftPerPx: 1, rotation: 0, opacity: 1, locked: false,
  x: -imgW / 2, y: -imgH / 2, src: "data:image/svg+xml;utf8," + encodeURIComponent(svg(c)), ...extra });
const RECT = { kind: "rect", x: 600, y: 100, w: 200, h: 150 };
const POLY = { kind: "poly", pts: [[100, 500], [300, 520], [200, 700]] }; // bbox 100,500 → 300,700
const site = { id: "H1", groupId: "H1", site: "HandleT", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -600, y: -500 }, { x: 600, y: -500 }, { x: 600, y: 500 }, { x: -600, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [mk("ovA", "#e8a83c", { crop: RECT }), mk("ovP", "#3c9ae8", { crop: POLY }), mk("ovU", "#6ac36a")],
  parcelDrawings: [], status: "active", updatedAt: Date.now() };

const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ H1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
await assertMeasurable(page, "verify-overlay-crop-handles");
if (!(await page.locator("text=Overlays").count())) {
  await page.locator('[data-testid="module-tab-site-planner"]').first().click(); await page.waitForTimeout(1200);
  await page.locator("text=HandleT").first().dblclick(); await page.waitForTimeout(2200);
}
await page.locator("text=Overlays").first().click(); await page.waitForTimeout(500);
await page.locator('button[title^="Zoom to fit"]').first().click(); await page.waitForTimeout(700);

const select = async (id) => { if (!(await page.locator(`[data-testid="overlay-crop-${id}"]`).count())) await page.locator("button", { hasText: id + ".png" }).first().click(); await page.waitForTimeout(400); };
const stored = (id) => page.evaluate((id) => { const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const o = raw.H1 && raw.H1.sheetOverlays.find((x) => x.id === id); return o ? { crop: o.crop ?? null, rotation: o.rotation || 0, ftPerPx: o.ftPerPx, x: o.x, y: o.y } : null; }, id);
// Geometry in CLIENT px: the full image box (unrotated frames only) + the chrome.
const geo = (id) => page.evaluate((id) => {
  const img = document.querySelector(`image[data-overlay-id="${id}"]`);
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const sc = [...document.querySelectorAll('[data-handle="overlay-scale"]')].map(r);
  const rot = document.querySelector('[data-handle="overlay-rotate"]');
  const ib = img ? img.getBoundingClientRect() : null;
  return { img: ib && { x: ib.x, y: ib.y, w: ib.width, h: ib.height }, sc, rot: rot ? r(rot) : null };
}, id);
const centreOf = (g) => ({ x: (g.sc[0].x + g.sc[2].x) / 2, y: (g.sc[0].y + g.sc[2].y) / 2 });
const wOf = (g) => Math.hypot(g.sc[1].x - g.sc[0].x, g.sc[1].y - g.sc[0].y);
const drag = async (from, to) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) { await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8); await page.waitForTimeout(30); } await page.mouse.up(); await page.waitForTimeout(600); };

/* KNOWN-GOOD ARM — uncropped: grips on the image corners */
await select("ovU");
let g = await geo("ovU");
const armOk = g.img && g.sc.length === 4 && near(g.sc[0].x, g.img.x) && near(g.sc[0].y, g.img.y) && near(g.sc[2].x, g.img.x + g.img.w) && near(g.sc[2].y, g.img.y + g.img.h);
check("known-good: an UNCROPPED overlay's grips sit on its image corners", armOk, JSON.stringify({ img: g.img, tl: g.sc[0], br: g.sc[2] }));
if (!armOk) { console.log("  ⛔ VOID — the probe cannot see a known answer; no score reported."); await browser.close(); process.exit(2); }

/* 1. rect crop */
await select("ovA");
g = await geo("ovA");
const f = (fx, fy) => ({ x: g.img.x + fx * g.img.w, y: g.img.y + fy * g.img.h });
let exp = [f(0.6, 0.125), f(0.8, 0.125), f(0.8, 0.3125), f(0.6, 0.3125)];
check("rect crop: the four resize grips hug the CROP's corners, not the image's", g.sc.length === 4 && g.sc.every((p, i) => near(p.x, exp[i].x) && near(p.y, exp[i].y)), JSON.stringify({ got: g.sc, exp }));
check("rect crop: the rotate grip is above the crop's top edge, centred on it", near(g.rot.x, (exp[0].x + exp[1].x) / 2) && g.rot.y < exp[0].y - 10 && g.rot.y > exp[0].y - 40, JSON.stringify(g.rot));

/* 3. corner drag = whole-overlay scale about the visible centre */
const cropBefore = JSON.stringify((await stored("ovA")).crop);
const c0 = centreOf(g), w0 = wOf(g);
await drag(g.sc[2], { x: g.sc[2].x + 60, y: g.sc[2].y + 45 });
const sA = await stored("ovA");
g = await geo("ovA");
const c1 = centreOf(g), w1 = wOf(g);
check("scale: the overlay grew (visible width increased)", w1 > w0 * 1.2, `w0=${w0.toFixed(1)} w1=${w1.toFixed(1)}`);
check("scale: the crop is untouched (no drift vs the image)", JSON.stringify(sA.crop) === cropBefore, JSON.stringify(sA.crop));
check("scale: the VISIBLE centre stayed put on screen", near(c0.x, c1.x, 3) && near(c0.y, c1.y, 3), JSON.stringify({ c0, c1 }));
check("scale: grips still hug the crop at the new size", near(wOf(g), 200 * sA.ftPerPx * (g.img.w / (imgW * sA.ftPerPx)), 3), `w=${wOf(g).toFixed(1)}`);

/* 4. rotate about the visible centre */
const cR0 = centreOf(g);
await drag(g.rot, { x: cR0.x + 120, y: cR0.y - 20 }); // swing the grip to the right of the centre → a clockwise quarter-ish turn
const sB = await stored("ovA");
g = await geo("ovA");
const cR1 = centreOf(g);
check("rotate: the rotation was stored (a real turn)", Math.abs(sB.rotation) > 20, `rotation=${sB.rotation.toFixed(1)}`);
check("rotate: the VISIBLE centre stayed put on screen", near(cR0.x, cR1.x, 3) && near(cR0.y, cR1.y, 3), JSON.stringify({ cR0, cR1 }));
check("rotate: the crop is untouched", JSON.stringify(sB.crop) === cropBefore);

/* 2. polygon crop → bounding box */
await select("ovP");
g = await geo("ovP");
const f2 = (fx, fy) => ({ x: g.img.x + fx * g.img.w, y: g.img.y + fy * g.img.h });
exp = [f2(0.1, 0.625), f2(0.3, 0.625), f2(0.3, 0.875), f2(0.1, 0.875)];
check("poly crop: the grips hug the polygon's BOUNDING BOX", g.sc.length === 4 && g.sc.every((p, i) => near(p.x, exp[i].x) && near(p.y, exp[i].y)), JSON.stringify({ got: g.sc, exp }));

/* 5. Reset crop → full image (on the unrotated polygon-cropped overlay, so the image box is axis-aligned) */
await page.locator('[data-testid="overlay-crop-reset"]').click(); await page.waitForTimeout(600);
g = await geo("ovP");
check("Reset crop: the grips return to the full image", g.sc.length === 4 && near(g.sc[0].x, g.img.x, 3) && near(g.sc[0].y, g.img.y, 3) && near(g.sc[2].x, g.img.x + g.img.w, 3) && near(g.sc[2].y, g.img.y + g.img.h, 3), JSON.stringify({ img: g.img, tl: g.sc[0], br: g.sc[2] }));

console.log(fail ? `\n${fail} check(s) FAILED` : "\nall checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
