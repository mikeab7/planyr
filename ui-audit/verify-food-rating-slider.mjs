#!/usr/bin/env node
/* verify-food-rating-slider — NEW-1..3 (2026-10-11): the one Food rating slider at phone width.
 *
 * ENGINE: Playwright Chromium with the iPhone 15 viewport (390 wide) + touch. Drives
 * ui-audit/fixtures/food-panel.html (the REAL VisitPanel, in-memory handlers) on a local vite dev server.
 *
 * ASSERTS, for the dish score, Food and Ambiance sliders alike:
 *   a. min 1 / max 10 / step 0.25, and no - / + buttons anywhere in the slider.
 *   b. NEW-3: for every tick 1..10, the thumb's rendered centre (measured by painting the thumb solid and
 *      reading the screenshot — the browser's own geometry, not the app's formula) is within 2 px of the
 *      tick label's centre; every label is inside the slider's box.
 *   c. NEW-2: a press (mouse AND touch) on the track far from the thumb sets the value at that point, and
 *      dragging on from there tracks the finger (snapped to 0.25).
 *   d. the grab target (the input's box) is at least 44 px tall.
 *   e. a mostly-vertical touch swipe starting on the slider leaves the value alone.
 * KNOWN-GOOD ARM: tapping the exact centre of the "10" tick must read 10 — if not, the run is void.
 * Usage: npx vite --port 5199 & ; node ui-audit/verify-food-rating-slider.mjs [baseUrl] [--shots=dir]
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.argv.find((a) => a.startsWith("http")) || "http://localhost:5199";
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8);
const FIX = `${BASE}/ui-audit/fixtures/food-panel.html`;
let failed = 0;
const check = (id, ok, detail = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ ...devices["iPhone 15"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.goto(FIX, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="food-log-visit-btn"]', { timeout: 20000 });
await assertMeasurable(page, "verify-food-rating-slider");
await page.locator('[data-testid="food-log-visit-btn"]').tap();
await page.waitForSelector('[data-testid="dish-score-slider"]');
if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); }

const sliders = [
  ["dish score", '[data-testid="dish-score-meter"]', '[data-testid="dish-score-slider"]', '[data-testid="dish-score-numeral"]'],
  ["Food", '[role="group"][aria-label="Food"]', '[data-testid="rating-slider"]', '[data-testid="rating-slider-readout"]'],
  ["Ambiance", '[role="group"][aria-label="Ambiance"]', '[data-testid="rating-slider"]', '[data-testid="rating-slider-readout"]'],
];
const rootOf = (sel) => page.locator(sel).first();
const valOf = (root, sl) => root.locator(sl).evaluate((e) => Number(e.value));

for (const [name, rootSel, slSel, roSel] of sliders) {
  const root = rootOf(rootSel);
  const input = root.locator(slSel);
  await input.scrollIntoViewIfNeeded();
  const attrs = await input.evaluate((e) => [e.min, e.max, e.step].join("/"));
  check(`${name}: min/max/step`, attrs === "1/10/0.25", attrs);
  const btns = await root.locator("button").allInnerTexts();
  check(`${name}: no -/+ buttons`, !btns.some((t) => /^[−+-]$/.test(t.trim())), JSON.stringify(btns));
  const box = await input.boundingBox();
  check(`${name}: grab target >= 44 tall`, box.height >= 44, `${box.height}`);

  // known-good arm: the centre of the "10" label must land the value on 10
  const tick = (t) => root.locator(`[data-tick="${t}"]`).boundingBox().then((b) => b.x + b.width / 2);
  const midY = box.y + box.height / 2;
  await page.touchscreen.tap(await tick(10), midY);
  const known = await valOf(root, slSel);
  check(`${name}: KNOWN-GOOD ARM (touch tap on tick 10 -> 10)`, known === 10, `${known}`);
  if (known !== 10) { console.log("VOID run"); process.exit(1); }

  // b. thumb centre vs tick centre, every value — thumb painted solid magenta so a screenshot can find it
  await page.addStyleTag({ content: ".food-rating-slider::-webkit-slider-thumb{background:#f0f!important;border-color:#f0f!important}" });
  let worst = 0, outside = 0;
  for (let t = 1; t <= 10; t++) {
    await input.fill(String(t));
    const b = await input.boundingBox();
    const png = await page.screenshot({ clip: { x: b.x, y: b.y, width: b.width, height: b.height } });
    const { default: zlib } = await import("node:zlib");
    const px = decodePng(png, zlib);
    let lo = 1e9, hi = -1;
    for (let y = 0; y < px.h; y++) for (let x = 0; x < px.w; x++) { const i = (y * px.w + x) * 4; if (px.d[i] > 200 && px.d[i + 1] < 80 && px.d[i + 2] > 200) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }
    const scale = px.w / b.width;
    const thumbC = b.x + ((lo + hi + 1) / 2) / scale;
    const lb = await root.locator(`[data-tick="${t}"]`).boundingBox();
    worst = Math.max(worst, Math.abs(thumbC - (lb.x + lb.width / 2)));
    if (lb.x < b.x - 0.5 || lb.x + lb.width > b.x + b.width + 0.5) outside++;
  }
  check(`${name}: tick centres under thumb centres (worst offset <= 2px)`, worst <= 2, `${worst.toFixed(2)}px`);
  check(`${name}: no tick label overflows the slider`, outside === 0, `${outside} outside`);
  await page.evaluate(() => document.querySelectorAll("style").forEach((s) => { if (s.textContent.includes("f0f!important")) s.remove(); }));

  // c. press far from the thumb sets the value there (mouse, then touch), then drag follows
  await root.locator(slSel).evaluate((e) => { e.value = "5"; });
  const b2 = await input.boundingBox();
  const xAt = async (t) => tick(t);
  await page.mouse.click(await xAt(2) , b2.y + b2.height / 2);
  const m = await valOf(root, slSel);
  check(`${name}: mouse press on track far from thumb jumps to that point (2)`, Math.abs(m - 2) <= 0.25, `${m}`);
  await page.touchscreen.tap(await xAt(8), b2.y + b2.height / 2);
  const tv = await valOf(root, slSel);
  check(`${name}: touch tap on track jumps to that point (8)`, Math.abs(tv - 8) <= 0.25, `${tv}`);
  await page.mouse.move(await xAt(3), b2.y + b2.height / 2);
  await page.mouse.down(); await page.mouse.move(await xAt(6), b2.y + b2.height / 2, { steps: 8 });
  const mid = await valOf(root, slSel);
  await page.mouse.up();
  check(`${name}: press then drag tracks the pointer (ends at 6) and snaps to 0.25`, Math.abs(mid - 6) <= 0.25 && (mid * 4) % 1 === 0, `${mid}`);
  const ro = await root.locator(roSel).innerText();
  check(`${name}: readout updates live`, ro.startsWith(String(mid)), ro);

  // d. vertical swipe starting on the slider leaves the value alone
  const cdp = await ctx.newCDPSession(page);
  const before = await valOf(root, slSel);
  const sx = (await tick(4)), sy = b2.y + b2.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy }] });
  for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx + i, y: sy - i * 12 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(150);
  const after = await valOf(root, slSel);
  check(`${name}: vertical swipe from the slider does not change it`, after === before, `${before} -> ${after}`);
  if (SHOTS) { await root.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/${name.replace(/\W+/g, "-")}.png` }); }
}
if (SHOTS) await page.screenshot({ path: `${SHOTS}/visit-sheet.png`, fullPage: false });
check("no page errors", errs.length === 0, errs.join(" | "));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
process.exit(failed ? 1 : 0);

// minimal PNG decoder (8-bit RGB/RGBA, non-interlaced)
function decodePng(buf, zlib) {
  let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString("ascii", o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(w * bpp);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * bpp + 1)], row = Buffer.from(raw.subarray(y * (w * bpp + 1) + 1, (y + 1) * (w * bpp + 1)));
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      if (f === 1) row[i] += a; else if (f === 2) row[i] += b; else if (f === 3) row[i] += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); row[i] += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
    }
    for (let x = 0; x < w; x++) { out[(y * w + x) * 4] = row[x * bpp]; out[(y * w + x) * 4 + 1] = row[x * bpp + 1]; out[(y * w + x) * 4 + 2] = row[x * bpp + 2]; out[(y * w + x) * 4 + 3] = bpp === 4 ? row[x * bpp + 3] : 255; }
    prev = row;
  }
  return { w, h, d: out };
}
