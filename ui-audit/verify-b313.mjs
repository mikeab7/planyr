/* Verify B313 — the Markup canvas now uses the shared viewport TRANSFORM engine (parity with
 * the Site map), against the REAL built viewer (vite preview on :4173). Generates a 2-page
 * Letter PDF, opens it in Markup, then drives + asserts the DOM:
 *
 *   1. FREE PAN in all directions — at Fit-width (no horizontal scroll room in the old model),
 *      a Pan drag moves the sheet left/right/up/down (the canvas's screen position tracks it).
 *      This is the headline fix: the old scroll box could "only scroll vertically".
 *   2. Cursor-anchored wheel zoom — the page point under the cursor stays put through a zoom.
 *   3. Geometry + calibration SURVIVE the view transform — a calibrated Distance reads the same
 *      feet before/after zoom+pan, and the sheet stays "calibrated" (view transform only).
 *   4. Bluebeam pan/tool collision — middle-mouse pans even with a drawing tool active AND draws
 *      nothing; Select on empty canvas pans.
 *   5. Draw + select-move still works through the transform (pointer pipeline intact).
 *   6. Sheet switch keeps the current zoom (B292 holds under the new model).
 *   7. No uncaught page errors.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b313.mjs                          (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js needs Map.prototype.getOrInsertComputed — the older bundled Chromium-1194 lacks it.
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b313-test.pdf";

function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (SHEET ONE - B313 transform viewport test) Tj ET";
  const s2 = "BT /F1 20 Tf 60 700 Td (SHEET TWO - second page) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`,
    `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
const ok = (name, pass, detail) => { results.push({ pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

// Transform-model geometry: canvas → page box (translated) → viewport (overflow:hidden).
const geom = (page) => page.evaluate(() => {
  const c = document.querySelector("canvas");
  const vp = c.parentElement.parentElement; // page box → viewport
  const cr = c.getBoundingClientRect(), vr = vp.getBoundingClientRect();
  return { canL: cr.left, canT: cr.top, cssW: cr.width, cssH: cr.height, vpL: vr.left, vpT: vr.top, vpW: vp.clientWidth, vpH: vp.clientHeight };
});
const overlayText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('canvas + svg text')).map((t) => t.textContent));
const calBadge = (page) => page.evaluate(() => (document.body.innerText.match(/Sheet \d+ (calibrated|not calibrated|—[^\n]*)/) || [""])[0]);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const drag = async (x0, y0, dx, dy, opts = {}) => {
  await page.mouse.move(x0, y0); await page.mouse.down(opts);
  await page.mouse.move(x0 + dx, y0 + dy, { steps: 8 }); await page.mouse.up(opts);
  await page.waitForTimeout(120);
};

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
  await page.waitForTimeout(500);

  // ---- 1. FREE PAN in all directions (the headline) ----
  {
    await page.getByRole("button", { name: "Fit", exact: true }).click(); // fit-width: tall sheet, no horizontal room in the old model
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    const g0 = await geom(page);
    const cx = g0.vpL + g0.vpW / 2, cy = g0.vpT + g0.vpH / 2;
    await drag(cx, cy, 140, 0);                    // drag right
    const gR = await geom(page);
    await drag(cx, cy, -140, 0);                   // drag left (past origin)
    const gL = await geom(page);
    await drag(cx, cy, 0, 90);                     // drag down
    const gD = await geom(page);
    const movedRight = gR.canL - g0.canL;          // sheet followed the drag right
    const movedLeft = gR.canL - gL.canL;           // then back left
    const movedDown = gD.canT - gL.canT;
    ok("1a free pan RIGHT moves the sheet horizontally", movedRight > 110, `canL Δ=+${Math.round(movedRight)}px for a +140 drag (old fit-width model couldn't pan horizontally)`);
    ok("1b free pan LEFT moves the sheet horizontally", movedLeft > 110, `canL Δ=-${Math.round(movedLeft)}px for a -140 drag`);
    ok("1c free pan DOWN moves the sheet vertically", movedDown > 70, `canT Δ=+${Math.round(movedDown)}px for a +90 drag`);
  }

  // ---- 2. cursor-anchored wheel zoom ----
  {
    await page.getByRole("button", { name: "Page", exact: true }).click();
    await page.waitForTimeout(400);
    const g0 = await geom(page);
    const cx = g0.canL + g0.cssW * 0.4, cy = g0.canT + g0.cssH * 0.4;
    const fx = (cx - g0.canL) / g0.cssW, fy = (cy - g0.canT) / g0.cssH;
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300);
    await page.waitForFunction((w0) => document.querySelector("canvas").getBoundingClientRect().width > w0 + 2, g0.cssW, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    const g1 = await geom(page);
    const grew = g1.cssW / g0.cssW;
    const anchorX = g1.canL + fx * g1.cssW, anchorY = g1.canT + fy * g1.cssH;
    const drift = Math.hypot(anchorX - cx, anchorY - cy);
    ok("2a wheel zooms in", grew > 1.08, `canvas ×${grew.toFixed(2)}`);
    ok("2b wheel zoom is cursor-anchored", drift < 12, `point under cursor drifted ${drift.toFixed(1)}px`);
  }

  // ---- 3. geometry + calibration SURVIVE zoom + pan ----
  {
    await page.getByRole("button", { name: "Page", exact: true }).click();
    await page.waitForTimeout(400);
    // calibrate: two points a horizontal distance apart, then enter 100 ft
    await page.getByRole("button", { name: "Calibrate", exact: true }).click();
    let g = await geom(page);
    await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.50);
    await page.mouse.click(g.canL + g.cssW * 0.70, g.canT + g.cssH * 0.50);
    await page.waitForTimeout(200);
    await page.fill('input[placeholder*="38"]', "100");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const calAfterSet = await calBadge(page);
    // draw a Distance
    await page.getByRole("button", { name: "Distance", exact: true }).click();
    g = await geom(page);
    await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.65);
    await page.mouse.click(g.canL + g.cssW * 0.60, g.canT + g.cssH * 0.65);
    await page.waitForTimeout(250);
    const labelBefore = (await overlayText(page)).find((t) => /ft/.test(t)) || "";
    // zoom in + pan, then re-read
    await page.mouse.move(g.canL + g.cssW * 0.5, g.canT + g.cssH * 0.5);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    const gp = await geom(page);
    await drag(gp.vpL + gp.vpW / 2, gp.vpT + gp.vpH / 2, -120, -60);
    const labelAfter = (await overlayText(page)).find((t) => /ft/.test(t)) || "";
    const calAfterZoom = await calBadge(page);
    ok("3a calibrate set the sheet scale", /calibrated/.test(calAfterSet) && !/not calibrated/.test(calAfterSet), `badge: "${calAfterSet}"`);
    ok("3b measurement reads the same feet after zoom+pan", labelBefore && labelBefore === labelAfter, `"${labelBefore}" → "${labelAfter}" (view transform must not change geometry)`);
    ok("3c sheet stays calibrated through the view transform", /calibrated/.test(calAfterZoom) && !/not calibrated/.test(calAfterZoom), `badge: "${calAfterZoom}"`);
  }

  // ---- 4. Bluebeam: middle-mouse pans even with a draw tool active, and draws nothing ----
  {
    await page.getByRole("button", { name: "Page", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Rect", exact: true }).click(); // a DRAWING tool is active
    const rects0 = await page.evaluate(() => document.querySelectorAll("canvas + svg rect").length);
    const g0 = await geom(page);
    await drag(g0.vpL + g0.vpW / 2, g0.vpT + g0.vpH / 2, 130, 80, { button: "middle" }); // middle-drag
    const g1 = await geom(page);
    const rects1 = await page.evaluate(() => document.querySelectorAll("canvas + svg rect").length);
    const moved = Math.hypot(g1.canL - g0.canL, g1.canT - g0.canT);
    ok("4a middle-mouse pans with a drawing tool active", moved > 90, `sheet moved ${Math.round(moved)}px on a middle-drag`);
    ok("4b middle-mouse drew nothing", rects1 === rects0, `rect count ${rects0}→${rects1} (a middle-drag must never draw)`);
  }

  // ---- 5. draw + select-move still works through the transform ----
  {
    await page.getByRole("button", { name: "Rect", exact: true }).click();
    let g = await geom(page);
    await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.30);
    await page.mouse.click(g.canL + g.cssW * 0.45, g.canT + g.cssH * 0.42);
    await page.waitForTimeout(200);
    const xBefore = await page.evaluate(() => { const r = document.querySelector("canvas + svg rect"); return r ? parseFloat(r.getAttribute("x")) : null; });
    await page.getByRole("button", { name: "Select", exact: true }).click();
    g = await geom(page);
    // grab the rect interior and drag it
    await drag(g.canL + g.cssW * 0.37, g.canT + g.cssH * 0.36, 80, 40);
    const xAfter = await page.evaluate(() => { const r = document.querySelector("canvas + svg rect"); return r ? parseFloat(r.getAttribute("x")) : null; });
    ok("5 draw a Rect + Select-drag moves it", xBefore != null && xAfter != null && Math.abs(xAfter - xBefore) > 30, `rect x ${Math.round(xBefore)}→${Math.round(xAfter)}`);
  }

  // ---- 6. sheet switch keeps the current zoom (B292 under the new model) ----
  {
    const before = (await geom(page)).cssW;
    await page.locator('button:has-text("Sheet 2")').first().click();
    await page.waitForTimeout(500);
    const after = (await geom(page)).cssW;
    ok("6 sheet switch keeps zoom", Math.abs(after - before) < 6, `Sheet1 ${Math.round(before)}px → Sheet2 ${Math.round(after)}px`);
  }

  ok("7 no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
