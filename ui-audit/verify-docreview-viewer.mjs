/* Verify the 2026-06-20 Doc Review single-sheet interaction batch B288–B296 against the
 * REAL built viewer (vite preview on :4173). Generates a 2-page Letter PDF, opens it in
 * the Markup workspace, then drives each behaviour and asserts the DOM:
 *
 *   B288 — wheel zooms (cursor-anchored): a wheel-up over the canvas grows the on-screen
 *          canvas (zoom in), and the page-point under the cursor stays put.
 *   B290 — the + button is cursor/centre-anchored: scale grows AND the content point at the
 *          viewport centre stays at the centre (no drift).
 *   B289 — Pan tool drag moves the sheet by the drag delta (transform pan; free any direction, B313).
 *   B292 — switching sheets keeps the current zoom (no snap back to fit-width).
 *   B295 — "Fit page" fits the WHOLE sheet in view (cssH ≤ available height) where plain
 *          "Fit" (width) overflows vertically.
 *   B291 — Count: 3 clicks then a double-click finishes with exactly 3 points (NOT 5) — the
 *          double-click's two phantom pointerdowns are stripped. (takeoff-correctness, HIGH)
 *   B293 — a placed Rect can be dragged to a new position (Select-mode interior drag), and a
 *          Text note is created through an inline editor (no window.prompt) and re-edited on
 *          double-click.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-docreview-viewer.mjs              (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// NB: Doc Review renders PDFs via pdf.js, which calls Map.prototype.getOrInsertComputed — the
// OLDER bundled Chromium-1194 lacks it and throws (the sheet never rasterizes, so the markup SVG
// overlay never mounts and no interaction can be driven). Use the newer chromium-1228 build
// (chrome-linux64). Override with PW_CHROME if your environment differs.
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b273-test.pdf";

/* A structurally-valid TWO-page PDF (612×792 Letter each) with exact xref byte-offsets so
 * PDF.js parses it without a rebuild. Two pages so the sheet-switch test (B292) has a Sheet 2. */
function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (SHEET ONE - B288..B296 interaction test) Tj ET";
  const s2 = "BT /F1 20 Tf 60 700 Td (SHEET TWO - second page for sheet-switch test) Tj ET";
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
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

// geometry: canvas → page box (translated) → viewport. canL/canT track pan; cssW/cssH track zoom (B313)
const geom = (page) => page.evaluate(() => {
  const c = document.querySelector("canvas");
  const wrap = c.parentElement.parentElement; // page box → viewport
  const cr = c.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  return {
    canL: cr.left, canT: cr.top, cssW: cr.width, cssH: cr.height,
    wrapL: wr.left, wrapT: wr.top, wrapW: wrap.clientWidth, wrapH: wrap.clientHeight,
    scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop,
  };
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
  await page.waitForTimeout(500);

  // ---- B288: wheel-up over the canvas zooms IN, anchored on the cursor ----
  {
    const g0 = await geom(page);
    const cx = g0.canL + g0.cssW * 0.4, cy = g0.canT + g0.cssH * 0.4; // a point off-centre so anchoring is visible
    const fx = (cx - g0.canL) / g0.cssW, fy = (cy - g0.canT) / g0.cssH; // content fraction under the cursor
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -300); // deltaY<0 → zoom in
    await page.waitForFunction((w0) => document.querySelector("canvas").getBoundingClientRect().width > w0 + 2, g0.cssW, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    const g1 = await geom(page);
    const grew = g1.cssW / g0.cssW;
    const anchorX = g1.canL + fx * g1.cssW, anchorY = g1.canT + fy * g1.cssH; // where that content point sits now
    const drift = Math.hypot(anchorX - cx, anchorY - cy);
    ok("B288 wheel zooms in", grew > 1.08, `canvas ${Math.round(g0.cssW)}→${Math.round(g1.cssW)}px (×${grew.toFixed(2)})`);
    ok("B288 wheel is cursor-anchored", drift < 14, `point under cursor drifted ${drift.toFixed(1)}px`);
  }

  // ---- B290: the + button grows scale AND holds the viewport centre fixed ----
  {
    const g0 = await geom(page);
    const cx = g0.wrapL + g0.wrapW / 2, cy = g0.wrapT + g0.wrapH / 2;
    const fx = (cx - g0.canL) / g0.cssW, fy = (cy - g0.canT) / g0.cssH;
    await page.getByRole("button", { name: "+", exact: true }).click();
    await page.waitForFunction((w0) => document.querySelector("canvas").getBoundingClientRect().width > w0 + 2, g0.cssW, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(250);
    const g1 = await geom(page);
    const grew = g1.cssW / g0.cssW;
    const anchorX = g1.canL + fx * g1.cssW, anchorY = g1.canT + fy * g1.cssH;
    const drift = Math.hypot(anchorX - cx, anchorY - cy);
    ok("B290 + button zooms in", grew > 1.08, `×${grew.toFixed(2)}`);
    ok("B290 + holds the viewport centre", drift < 14, `centre drifted ${drift.toFixed(1)}px`);
  }

  // ---- B289: Pan tool drag moves the sheet (now a transform pan — free in any direction, B313) ----
  {
    await page.getByRole("button", { name: "Pan", exact: true }).click();
    await page.waitForTimeout(120);
    const g0 = await geom(page);
    const sx = g0.wrapL + g0.wrapW / 2, sy = g0.wrapT + g0.wrapH / 2;
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(sx + 110, sy + 70, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(150);
    const g1 = await geom(page);
    const dL = g1.canL - g0.canL, dT = g1.canT - g0.canT; // the sheet follows the drag (transform translate, B313)
    ok("B289 drag-to-pan moves the sheet", dL > 80 && dT > 50, `sheet Δ = (${Math.round(dL)}, ${Math.round(dT)})px for a (110,70) drag`);
  }

  // ---- B292: switching sheets keeps the current zoom ----
  {
    const before = (await geom(page)).cssW;
    await page.locator('button:has-text("Sheet 2")').first().click();
    await page.waitForTimeout(600);
    const after = (await geom(page)).cssW;
    ok("B292 sheet switch keeps zoom", Math.abs(after - before) < 4, `Sheet1 ${Math.round(before)}px → Sheet2 ${Math.round(after)}px (would snap to ~fit-width if broken)`);
  }

  // ---- B295: "Fit page" fits the whole sheet; plain "Fit" (width) overflows height ----
  {
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(500);
    const gw = await geom(page);
    await page.getByRole("button", { name: "Fit page", exact: true }).click();
    await page.waitForTimeout(500);
    const gp = await geom(page);
    const widthFitOverflows = gw.cssH > gw.wrapH + 2;          // portrait Letter, fit-width is taller than the viewport
    const pageFits = gp.cssH <= gp.wrapH - 24 + 6 && gp.cssW <= gp.wrapW + 2; // whole sheet visible
    ok("B295 Fit page fits the whole sheet", pageFits, `Fit-page canvas ${Math.round(gp.cssW)}×${Math.round(gp.cssH)} in viewport ${gp.wrapW}×${gp.wrapH}`);
    ok("B295 plain Fit (width) overflowed height", widthFitOverflows, `Fit-width canvas h=${Math.round(gw.cssH)} vs viewport h=${gw.wrapH}`);
  }

  // ---- B291: Count finishes with N points on double-click, not N+2 (HIGH) ----
  {
    await page.getByRole("button", { name: "Fit page", exact: true }).click(); // whole sheet on-screen so every click lands
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Count", exact: true }).click();
    const g = await geom(page);
    const cxs = [g.canL + g.cssW * 0.35, g.canL + g.cssW * 0.5, g.canL + g.cssW * 0.65];
    const cy = g.canT + g.cssH * 0.45;
    for (const x of cxs) { await page.mouse.click(x, cy); await page.waitForTimeout(90); }
    await page.mouse.dblclick(g.canL + g.cssW * 0.5, g.canT + g.cssH * 0.6); // finish
    await page.waitForTimeout(300);
    // committed count points render as <circle r="7"> in the OVERLAY svg (scope past header icons)
    const dots = await page.evaluate(() => document.querySelectorAll('canvas + svg circle[r="7"]').length);
    ok("B291 double-click count = clicks (no phantom)", dots === 3, `3 clicks + dblclick → ${dots} count dots (5 = the bug)`);
  }

  // ---- B293: move a placed Rect; create + edit a Text note inline ----
  {
    await page.getByRole("button", { name: "Fit page", exact: true }).click(); // whole sheet visible
    await page.waitForTimeout(500);
    // draw a rect
    await page.getByRole("button", { name: "Rect", exact: true }).click();
    const g = await geom(page);
    await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.30);
    await page.mouse.click(g.canL + g.cssW * 0.45, g.canT + g.cssH * 0.45);
    await page.waitForTimeout(200);
    const rectX = () => page.evaluate(() => { const r = document.querySelector("canvas + svg rect"); return r ? parseFloat(r.getAttribute("x")) : null; });
    const xBefore = await rectX();
    // select + drag its interior
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const ix = g.canL + g.cssW * 0.375, iy = g.canT + g.cssH * 0.375;
    await page.mouse.move(ix, iy); await page.mouse.down();
    await page.mouse.move(ix + 120, iy + 20, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const xAfter = await rectX();
    ok("B293 drag moves a placed markup", xBefore != null && xAfter != null && (xAfter - xBefore) > 80, `rect x ${xBefore == null ? "?" : Math.round(xBefore)} → ${xAfter == null ? "?" : Math.round(xAfter)} for a +120px drag`);

    // create a text note via the inline editor (no window.prompt)
    await page.getByRole("button", { name: "Text", exact: true }).click();
    await page.mouse.click(g.canL + g.cssW * 0.5, g.canT + g.cssH * 0.65);
    await page.waitForSelector('input[placeholder="Text note…"]', { timeout: 3000 });
    await page.keyboard.type("HELLO");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    const hasHello = await page.evaluate(() => [...document.querySelectorAll("canvas + svg text")].some((t) => (t.textContent || "").includes("HELLO")));
    ok("B293 inline text create (no prompt)", hasHello, `rendered <text>HELLO</text> = ${hasHello}`);

    // edit it on double-click
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const tpos = await page.evaluate(() => { const t = [...document.querySelectorAll("canvas + svg text")].find((x) => (x.textContent || "").includes("HELLO")); const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.dblclick(tpos.x, tpos.y);
    await page.waitForSelector('input[placeholder="Text note…"]', { timeout: 3000 });
    await page.fill('input[placeholder="Text note…"]', "WORLD");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
    const edited = await page.evaluate(() => { const ts = [...document.querySelectorAll("canvas + svg text")].map((t) => t.textContent || ""); return ts.some((t) => t.includes("WORLD")) && !ts.some((t) => t.includes("HELLO")); });
    ok("B293 double-click edits a text note", edited, `text now reads WORLD (not HELLO) = ${edited}`);
  }

  await page.screenshot({ path: new URL("./screens/b283-b291.png", import.meta.url).pathname });
} catch (e) {
  ok("harness", false, "threw: " + e.message);
}

if (pageErrors.length) ok("no uncaught page errors", false, pageErrors.join(" | "));
else ok("no uncaught page errors", true, "0 page errors");

await ctx.close();
await browser.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
