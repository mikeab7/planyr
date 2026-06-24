/* Tool gesture + edit parity (owner report 2026-06-24: "the line tool doesn't work the same way
 * clicking" + roads should let you drag an endpoint to change angle, not just extend/rotate).
 *
 * Asserts the Bluebeam-style placement + edit model in the Site Planner:
 *   1. Line: BOTH click-to-start→click-to-finish AND press-drag-release commit a line.
 *   2. Rectangle: drag still commits a rect (the dual-mode didn't break box drawing).
 *   3. Road: a selected road shows two ENDPOINT grips; dragging one changes the road's angle +
 *      length while the OTHER end stays put (pivot) — no separate rotate needed.
 *
 * Run: vite preview on :4173, then  node ui-audit/verify-tool-gestures.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const road = { id: "r1", type: "road", cx: 0, cy: 0, w: 400, h: 30, rot: 0, travelW: 24, curb: 0.5 };
const sites = { s1: { id: "s1", groupId: "s1", site: "T", name: "A", status: "active", origin: { lat: 29.78, lon: -95.79 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }], els: [road], markups: [], updatedAt: Date.now() } };
const seed = `(()=>{try{if(localStorage.getItem("__tg__"))return;localStorage.setItem(${JSON.stringify(SITES_KEY)},${JSON.stringify(JSON.stringify(sites))});localStorage.setItem("planarfit:currentSite:v1","s1");localStorage.setItem("__tg__","1");}catch(e){}})();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1380, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3000);

const box = await page.evaluate(() => { let z = null, a = 0; for (const s of document.querySelectorAll("svg")) { const r = s.getBoundingClientRect(); if (r.width * r.height > a) { a = r.width * r.height; z = r; } } return { x: z.x, y: z.y, w: z.width, h: z.height }; });
const cx = box.x + box.w * 0.5, cy = box.y + box.h * 0.5;
const solidLines = () => page.evaluate(() => [...document.querySelectorAll("svg line")].filter((l) => !l.getAttribute("stroke-dasharray")).length);
const rects = () => page.evaluate(() => document.querySelectorAll('svg rect[stroke]').length);

// 1) Line via click-to-start → click-to-finish (two separate clicks, NO drag).
await page.keyboard.press("l"); await page.waitForTimeout(150);
const l0 = await solidLines();
await page.mouse.click(cx - 220, cy - 120); await page.waitForTimeout(200);
await page.mouse.move(cx - 40, cy - 150); await page.waitForTimeout(150);
await page.mouse.click(cx - 40, cy - 150); await page.waitForTimeout(300);
check("Line places via click-to-start → click-to-finish (Bluebeam)", (await solidLines()) === l0 + 1, `Δlines=${(await solidLines()) - l0}`);
await page.keyboard.press("Escape");

// 2) Line via press-drag-release still works.
await page.keyboard.press("l"); await page.waitForTimeout(150);
const l1 = await solidLines();
await page.mouse.move(cx - 220, cy + 150); await page.mouse.down(); await page.mouse.move(cx - 40, cy + 180, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
check("Line also places via press-drag-release", (await solidLines()) === l1 + 1, `Δlines=${(await solidLines()) - l1}`);
await page.keyboard.press("Escape");

// 3) Rectangle drag still commits (dual-mode didn't break box drawing).
await page.keyboard.press("r"); await page.waitForTimeout(150);
const r0 = await rects();
await page.mouse.move(cx + 120, cy - 180); await page.mouse.down(); await page.mouse.move(cx + 260, cy - 90, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(300);
check("Rectangle still places via drag", (await rects()) > r0, `Δrects=${(await rects()) - r0}`);
await page.keyboard.press("Escape");
await page.keyboard.press("v");

// 4) Road endpoint editing — select the road (off the acreage chip), drag the right end up.
await page.mouse.click(cx + 95, cy); await page.waitForTimeout(400);
const grips = () => page.evaluate(() => { const o = []; for (const c of document.querySelectorAll("svg circle")) { const t = c.querySelector("title"); if (t && /Drag to move this end/.test(t.textContent)) { const r = c.getBoundingClientRect(); o.push({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); } } return o; });
let g = await grips();
check("a selected road shows two endpoint grips", g.length === 2, `grips=${g.length}`);
if (g.length === 2) {
  g.sort((a, b) => a.x - b.x); const A0 = g[0], B0 = g[1];
  const ang0 = Math.atan2(B0.y - A0.y, B0.x - A0.x) * 180 / Math.PI;
  await page.mouse.move(B0.x, B0.y); await page.mouse.down(); await page.mouse.move(B0.x, B0.y - 90, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
  let g2 = await grips(); g2.sort((a, b) => a.x - b.x); const A1 = g2[0], B1 = g2[1];
  const ang1 = Math.atan2(B1.y - A1.y, B1.x - A1.x) * 180 / Math.PI;
  check("dragging an end changes the road angle (not just length)", Math.abs(ang1 - ang0) > 8, `${ang0.toFixed(1)}° → ${ang1.toFixed(1)}°`);
  check("the OTHER end stays fixed (pivot — no whole-road rotate)", Math.hypot(A1.x - A0.x, A1.y - A0.y) < 6, `left end moved ${Math.round(Math.hypot(A1.x - A0.x, A1.y - A0.y))}px`);
}
await page.screenshot({ path: OUT + "tool-gestures.png" });
check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nTool gestures + road endpoints: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
