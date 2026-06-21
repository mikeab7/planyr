/* STRESS test for B331 touchscreen pinch — hammers both the Site map and the Markup canvas
 * with adversarial multitouch and asserts the gesture can't break: scale stays FINITE and within
 * its clamps, coincident fingers don't divide-by-zero into NaN, a 3rd finger / partial lift can't
 * corrupt or jump, an interrupted gesture recovers, and the mouse path is unaffected after a touch
 * storm. Fingers are kept INSIDE the measured canvas rect so every gesture actually lands on the
 * target; the clamps are reached by repeating moderate sweeps, not by oversized off-canvas gaps.
 * Drives REAL trusted multitouch via CDP `Input.dispatchTouchEvent` on a `hasTouch` context.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/pinch-stress.pdf";

function buildPdf() {
  const s = "BT /F1 20 Tf 60 700 Td (PINCH STRESS SHEET) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${s.length} >>\nstream\n${s}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  off.forEach((o) => { pdf += String(o).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
const ok = (n, p, d) => { results.push({ p }); console.log(`${p ? "PASS ✅" : "FAIL ❌"}  ${n}  —  ${d}`); };
const finite = (v) => typeof v === "number" && Number.isFinite(v);

/* Stateful multitouch: each CDP call carries the FULL set of currently-down points (Chrome diffs
 * to find what changed); touchEnd carries the points that REMAIN, so we can lift one of several. */
class Touch {
  // dwell: ms between dispatched touch events. The heavy Site-planner SVG re-renders every frame on
  // the capture-phase pinch, so events must be paced like a real finger (~16ms ≈ 60fps, the cadence
  // verify-pinch.mjs proves reliable) — faster and synthetic events get dropped, desyncing the
  // baseline. Markup is lighter but uses the same pacing for consistency.
  constructor(client, page, dwell = 16) { this.client = client; this.page = page; this.pts = new Map(); this.dwell = dwell; }
  _arr() { return [...this.pts.values()].map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 6, radiusY: 6, force: 1 })); }
  async _send(type, override) { try { await this.client.send("Input.dispatchTouchEvent", { type, touchPoints: override || this._arr() }); } catch (_) {} await this.page.waitForTimeout(this.dwell); }
  async down(id, x, y) { this.pts.set(id, { id, x, y }); await this._send("touchStart"); }
  async move(id, x, y) { if (this.pts.has(id)) this.pts.set(id, { id, x, y }); await this._send("touchMove"); }
  async up(id) { this.pts.delete(id); await this._send("touchEnd"); }
  async cancel() { this.pts.clear(); await this._send("touchCancel", []); } // CDP requires touchCancel to carry an EMPTY point list
}

// A sweep about (cx,cy): finger gap goes gap0 → gap1 over `steps`. Both fingers stay on the X axis
// through cy. Caller guarantees gap/2 stays within the canvas.
async function sweep(t, cx, cy, gap0, gap1, steps = 5) {
  await t.down(1, cx - gap0 / 2, cy); await t.down(2, cx + gap0 / 2, cy);
  for (let i = 1; i <= steps; i++) { const g = gap0 + (gap1 - gap0) * (i / steps); await t.move(1, cx - g / 2, cy); await t.move(2, cx + g / 2, cy); }
  await t.up(1); await t.up(2);
}

const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const demoSite = { id: "stress-demo", groupId: "stress-demo", site: "Stress Demo", name: "Plan 1", origin: null, county: null, parcels: [parcel], els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const pageErrors = [];

try {
  /* ============================ SITE MAP ============================ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await ctx.newPage(); const client = await ctx.newCDPSession(page);
    page.on("pageerror", (e) => pageErrors.push("site:" + e));
    await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ "stress-demo": s })); localStorage.setItem("planarfit:currentSite:v1", "stress-demo"); } catch (e) {} }, demoSite);
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const ppf = () => page.evaluate(() => { const m = document.body.innerText.match(/([\d.]+)\s*px\/ft/); return m ? parseFloat(m[1]) : null; });
    const inClamp = (v) => finite(v) && v >= 0.0199 && v <= 8.0001; // engine clamps scale to [0.02, 8]
    // Measure the SVG canvas so every finger lands on it (avoid the side panels / rail).
    const rect = await page.evaluate(() => { const s = document.querySelector('svg[aria-label="Site plan canvas"]') || document.querySelector("svg"); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const cx = Math.round(rect.x + rect.w / 2), cy = Math.round(rect.y + rect.h / 2);
    const maxGap = Math.round(Math.min(rect.w, rect.h) * 0.45); // central zone — avoids the floating edge controls (Layers panel, zoom buttons) that sit over the canvas corners
    const t = new Touch(client, page);
    ok("S0 Site: canvas measured, on-canvas gap budget", rect.w > 200 && maxGap > 150, `svg ${Math.round(rect.w)}×${Math.round(rect.h)} @(${cx},${cy}), maxGap ${Math.round(maxGap)}`);

    // S1 — 30 rapid alternating spread/pinch cycles; scale must stay finite + clamped throughout.
    let badS1 = 0, worstS1 = null;
    for (let i = 0; i < 30; i++) {
      await sweep(t, cx, cy, 90, Math.min(380, maxGap), 4); await sweep(t, cx, cy, Math.min(380, maxGap), 90, 4);
      if (i % 6 === 0) { const v = await ppf(); if (!inClamp(v)) { badS1++; worstS1 = v; } }
    }
    ok("S1 Site: 30 alternating pinch storms stay finite + in [0.02,8]", inClamp(await ppf()) && badS1 === 0, `final ${await ppf()} px/ft, off-clamp samples=${badS1}${worstS1 != null ? ` (worst ${worstS1})` : ""}`);

    // S2 — saturate the MAX clamp via repeated on-canvas spreads. Must pin at ~8, never exceed/NaN.
    for (let i = 0; i < 5; i++) await sweep(t, cx, cy, 90, maxGap, 6);
    const sMax = await ppf();
    ok("S2 Site: repeated spread saturates at the 8 px/ft ceiling (no overshoot/NaN)", finite(sMax) && sMax <= 8.0001 && sMax >= 7.0, `${sMax} px/ft`);

    // S3 — saturate the MIN clamp via repeated on-canvas pinch-togethers. Must floor at ~0.02, never ≤0.
    for (let i = 0; i < 6; i++) await sweep(t, cx, cy, maxGap, 70, 6);
    const sMin = await ppf();
    ok("S3 Site: repeated pinch floors at the 0.02 px/ft floor (never ≤0 / NaN) and is « the max", finite(sMin) && sMin >= 0.0199 && sMin < sMax * 0.5, `${sMin} px/ft (max was ${sMax})`);

    // S4 — COINCIDENT fingers (gap→0): the divide-by-zero trap. Must not become Infinity/NaN.
    await sweep(t, cx, cy, 80, 240, 4); // back to a sane zoom
    await t.down(1, cx, cy); await t.down(2, cx + 1, cy);
    for (let i = 0; i < 6; i++) { await t.move(1, cx, cy); await t.move(2, cx, cy); } // exactly coincident
    await t.move(1, cx - 110, cy); await t.move(2, cx + 110, cy); // then spread out
    await t.up(1); await t.up(2);
    ok("S4 Site: coincident fingers (gap≈0) never produce NaN/Infinity", inClamp(await ppf()), `${await ppf()} px/ft`);

    // S5 — THREE fingers + partial lift: add a 3rd mid-pinch, move all, lift one, continue, full lift.
    await t.down(1, cx - 110, cy); await t.down(2, cx + 110, cy);
    await t.move(1, cx - 140, cy); await t.move(2, cx + 140, cy);
    await t.down(3, cx, cy - 90);
    await t.move(1, cx - 150, cy + 10); await t.move(2, cx + 150, cy + 10); await t.move(3, cx, cy - 110);
    await t.up(2);
    await t.move(1, cx - 120, cy); await t.move(3, cx + 60, cy - 70);
    await t.up(1); await t.up(3);
    ok("S5 Site: 3-finger + partial lift stays finite + clamped (no corruption/jump)", inClamp(await ppf()), `${await ppf()} px/ft`);

    // S6 — interrupt (touchCancel) mid-pinch, then the app's documented blur-reset, then re-pinch.
    // First pinch OUT to a low zoom so a subsequent spread has headroom to show an increase (S4/S5
    // legitimately pinned us at the 8 px/ft ceiling, where "zoom in more" is correctly a no-op).
    for (let i = 0; i < 3; i++) await sweep(t, cx, cy, maxGap, 80, 6);
    await t.down(1, cx - 60, cy); await t.down(2, cx + 60, cy); await t.move(1, cx - 110, cy); await t.move(2, cx + 110, cy);
    await t.cancel(); // palm-reject style cancel — must not error or stick
    const okAfterCancel = inClamp(await ppf());
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); // app resets gesture state on focus loss
    await page.waitForTimeout(120);
    const before = await ppf();
    await sweep(t, cx, cy, 90, maxGap, 6); // fresh spread after the interrupt
    const after = await ppf();
    ok("S6 Site: re-pinch works after an interrupted gesture (no stuck/leaked state)", okAfterCancel && finite(before) && finite(after) && after > before * 1.4, `cancel-ok=${okAfterCancel}; px/ft ${before} → ${after}`);

    // S7 — MOUSE path untouched after the touch storm: a wheel zoom still works. Pinch out to low
    // first so the wheel-in has room to increase.
    for (let i = 0; i < 3; i++) await sweep(t, cx, cy, maxGap, 80, 6);
    const wBefore = await ppf();
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
    const wAfter = await ppf();
    ok("S7 Site: mouse-wheel zoom still works after a touch storm (gate not stuck)", finite(wBefore) && finite(wAfter) && wAfter > wBefore * 1.2, `px/ft ${wBefore} → ${wAfter}`);

    await ctx.close();
  }

  /* ============================ MARKUP CANVAS ============================ */
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await ctx.newPage(); const client = await ctx.newCDPSession(page);
    page.on("pageerror", (e) => pageErrors.push("markup:" + e));
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
    await page.waitForTimeout(700);
    await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
    await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
    await page.getByRole("button", { name: "Page", exact: true }).click();
    await page.waitForTimeout(400);
    const cw = () => page.evaluate(() => { const c = document.querySelector("canvas"); return c ? c.getBoundingClientRect().width : null; });
    const sane = (w) => finite(w) && w > 1 && w < 60000; // rendered sheet width: never collapsed/NaN/exploded
    const rect = await page.evaluate(() => { const v = document.querySelector("canvas").parentElement.parentElement.getBoundingClientRect(); return { x: v.x, y: v.y, w: v.width, h: v.height }; });
    const cx = Math.round(rect.x + rect.w / 2), cy = Math.round(rect.y + rect.h / 2);
    const maxGap = Math.round(Math.min(rect.w, rect.h) * 0.45); // central zone — avoids floating edge controls
    const t = new Touch(client, page);
    ok("M0 Markup: viewport measured, on-canvas gap budget", rect.w > 200 && maxGap > 150, `vp ${Math.round(rect.w)}×${Math.round(rect.h)} @(${cx},${cy}), maxGap ${Math.round(maxGap)}`);

    // M1 — 30 alternating spread/pinch storms; the rendered sheet width stays sane throughout.
    let badM1 = 0;
    for (let i = 0; i < 30; i++) {
      await sweep(t, cx, cy, 90, Math.min(340, maxGap), 4); await sweep(t, cx, cy, Math.min(340, maxGap), 90, 4);
      if (i % 6 === 0) { const w = await cw(); if (!sane(w)) badM1++; }
    }
    ok("M1 Markup: 30 alternating pinch storms keep the sheet finite (>0, not NaN/exploded)", sane(await cw()) && badM1 === 0, `final ${Math.round(await cw())}px, insane samples=${badM1}`);

    // M2 — saturate max then min via repeated on-canvas sweeps; min must be « max (pinch-out works).
    for (let i = 0; i < 5; i++) await sweep(t, cx, cy, 90, maxGap, 6);
    const mMax = await cw();
    for (let i = 0; i < 6; i++) await sweep(t, cx, cy, maxGap, 70, 6);
    const mMin = await cw();
    ok("M2 Markup: repeated spread then pinch — both bounded, min « max (no NaN/collapse/stuck)", sane(mMax) && sane(mMin) && mMin < mMax * 0.5, `max ${Math.round(mMax)}px · min ${Math.round(mMin)}px`);

    // M3 — coincident fingers (divide-by-zero trap).
    await sweep(t, cx, cy, 80, 240, 4);
    await t.down(1, cx, cy); await t.down(2, cx + 1, cy);
    for (let i = 0; i < 6; i++) { await t.move(1, cx, cy); await t.move(2, cx, cy); }
    await t.move(1, cx - 110, cy); await t.move(2, cx + 110, cy);
    await t.up(1); await t.up(2);
    ok("M3 Markup: coincident fingers (gap≈0) never produce NaN/collapse", sane(await cw()), `${Math.round(await cw())}px`);

    // M4 — 3 fingers + partial lift.
    await t.down(1, cx - 100, cy); await t.down(2, cx + 100, cy);
    await t.move(1, cx - 130, cy); await t.move(2, cx + 130, cy);
    await t.down(3, cx, cy - 90);
    await t.move(1, cx - 150, cy + 10); await t.move(2, cx + 150, cy + 10); await t.move(3, cx, cy - 110);
    await t.up(2);
    await t.move(1, cx - 120, cy); await t.move(3, cx + 40, cy - 80);
    await t.up(1); await t.up(3);
    ok("M4 Markup: 3-finger + partial lift stays finite (no corruption/jump)", sane(await cw()), `${Math.round(await cw())}px`);

    // M5 — re-pinch after a full storm still zooms (state re-armed, nothing leaked).
    await sweep(t, cx, cy, Math.min(300, maxGap), 100, 5);
    const before = await cw();
    await sweep(t, cx, cy, 90, Math.min(320, maxGap), 6);
    const after = await cw();
    ok("M5 Markup: a fresh pinch after the storm still grows the sheet (no stuck state)", sane(before) && sane(after) && after > before * 1.3, `${Math.round(before)} → ${Math.round(after)}px`);

    await ctx.close();
  }

  ok("no uncaught page errors during the entire stress run", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.p).length;
  console.log(`\n${passed}/${results.length} stress checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
