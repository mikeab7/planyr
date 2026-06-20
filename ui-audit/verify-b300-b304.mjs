/* Verify the Document-Review editing batch B300–B304 against the REAL built app.
 *   B300 undo/redo (Ctrl-Z / Ctrl-Shift-Z / Ctrl-Y) over markups + calibration
 *   B301 manual Calibrate validates input (rejects "1/8" / "1:240"; accepts feet)
 *   B302 toolbar buttons don't wrap labels mid-word (white-space:nowrap, 1 line)
 *   B303 sheet paging — Prev/Next buttons + ← / → keyboard
 *   B304 measurement label sits at the path midpoint, not the first vertex
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/make-sample-pdf.mjs                (creates /tmp/samples/sample.pdf)
 *       node ui-audit/verify-b300-b304.mjs               (another shell)
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js v6 rendering uses Map.prototype.getOrInsertComputed — only in newer Chromium,
// so target chromium-1228 (chrome-linux64), not the older 1194 build, here.
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF = "/tmp/samples/sample.pdf";
if (!existsSync(PDF)) { console.error("missing sample — run: node ui-audit/make-sample-pdf.mjs"); process.exit(2); }

const results = [];
const check = (name, cond, detail = "") => { results.push({ name, ok: !!cond, detail }); console.log(`${cond ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await page.waitForTimeout(600);

// open the sample PDF
await page.setInputFiles('input[type="file"][accept*="pdf"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 20000 });
await page.waitForTimeout(600);

const overlay = page.locator('[data-testid=\"markup-overlay\"]');
const indicator = () => page.locator("text=/^\\d+ \\/ \\d+$/").first().innerText();
// The takeoff calibration status line (NOT the sheet-list buttons, which also say "Sheet N").
// Pick the leaf element that mentions a sheet AND calibration/scale wording.
const badge = () => page.evaluate(() => {
  const els = [...document.querySelectorAll("span,div")].filter((e) => /Sheet \d+/.test(e.textContent) && /calibrat|NOT TO SCALE|scale from/i.test(e.textContent));
  els.sort((a, b) => a.textContent.length - b.textContent.length);
  return els[0] ? els[0].textContent : "";
});

/* ---------- B302 — toolbar labels don't wrap ---------- */
const tbBtns = await page.evaluate(() => {
  const want = ["Open", "Stitch", "Library"];
  return want.map((t) => {
    const b = [...document.querySelectorAll("header button")].find((x) => x.textContent.includes(t));
    if (!b) return { t, found: false };
    const cs = getComputedStyle(b);
    return { t, found: true, h: Math.round(b.getBoundingClientRect().height), ws: cs.whiteSpace };
  });
});
const tbOk = tbBtns.every((b) => b.found && b.ws === "nowrap" && b.h <= 34);
check("B302 toolbar buttons are single-line (nowrap, ≤34px)", tbOk, JSON.stringify(tbBtns));

/* ---------- B303 — sheet paging ---------- */
const start = await indicator();
await page.locator('button[title="Next sheet (→)"]').click();
await page.waitForTimeout(400);
const afterNext = await indicator();
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
const afterArrowR = await indicator();
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(400);
const afterArrowL = await indicator();
check("B303 Next button advances the sheet", start === "1 / 4" && afterNext === "2 / 4", `${start} → ${afterNext}`);
check("B303 → / ← keys page the sheets", afterArrowR === "3 / 4" && afterArrowL === "2 / 4", `→ ${afterArrowR}, ← ${afterArrowL}`);
// back to sheet 1 for the drawing tests
await page.locator('button:has-text("Sheet 1")').first().click();
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 8000 });
await page.waitForTimeout(400);

/* ---------- B300 — undo / redo ---------- */
const rectCount = () => overlay.locator("rect").count();
const undoDisabledAtStart = await page.locator('button[title^="Undo"]').isDisabled();
await page.locator('button:has-text("Rect")').first().click();
await overlay.click({ position: { x: 220, y: 160 } });
await overlay.click({ position: { x: 430, y: 300 } });
await page.waitForTimeout(250);
const afterDraw = await rectCount();
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
const afterUndo = await rectCount();
await page.keyboard.press("Control+Shift+z");
await page.waitForTimeout(250);
const afterRedoShift = await rectCount();
await page.keyboard.press("Control+z");
await page.waitForTimeout(150);
await page.keyboard.press("Control+y");
await page.waitForTimeout(250);
const afterRedoY = await rectCount();
check("B300 undo disabled before any edit", undoDisabledAtStart === true, `disabled=${undoDisabledAtStart}`);
check("B300 draw → undo removes it", afterDraw === 1 && afterUndo === 0, `draw=${afterDraw}, undo=${afterUndo}`);
check("B300 redo (Ctrl-Shift-Z and Ctrl-Y) restores it", afterRedoShift === 1 && afterRedoY === 1, `shiftZ=${afterRedoShift}, ctrlY=${afterRedoY}`);
// leave the canvas clean (undo the rect) for the label test
await page.keyboard.press("Control+z");
await page.waitForTimeout(250);
check("B300 final undo leaves a clean sheet", (await rectCount()) === 0);

/* ---------- B301 — manual Calibrate validation ---------- */
await page.locator('button:has-text("Calibrate")').first().click();
await overlay.click({ position: { x: 200, y: 500 } });
await overlay.click({ position: { x: 500, y: 500 } });
await page.waitForTimeout(300);
const calInput = page.locator('input[placeholder*="38"]');
const inputAppeared = await calInput.count();
// malformed: a fraction that parseFloat would coerce to 1
await calInput.fill("1/8");
await calInput.press("Enter");
await page.waitForTimeout(250);
const rejected = await page.locator("text=/Enter a length|scale ratio/i").count();
const stillUncal = /not calibrated/i.test(await badge());
// ratio form
await calInput.fill("1:240");
await calInput.press("Enter");
await page.waitForTimeout(200);
const ratioMsg = await page.locator("text=/scale ratio/i").count();
// valid feet
await calInput.fill("100");
await calInput.press("Enter");
await page.waitForTimeout(300);
const inputGone = await page.locator('input[placeholder*="38"]').count();
const nowCalibrated = /Sheet \d+ calibrated/i.test(await badge());
check("B301 inline Calibrate box opens (no window.prompt)", inputAppeared === 1);
check("B301 rejects '1/8' with a message, stays uncalibrated", rejected >= 1 && stillUncal, `msg=${rejected}, uncal=${stillUncal}`);
check("B301 rejects '1:240' as a scale ratio", ratioMsg >= 1);
check("B301 accepts '100' → sheet calibrated, box closes", nowCalibrated && inputGone === 0, `cal=${nowCalibrated}, gone=${inputGone}`);

/* ---------- B304 — distance label at the midpoint, not pts[0] ---------- */
await page.locator('button:has-text("Distance")').first().click();
const X1 = 250, X2 = 650, Y = 360;
await overlay.click({ position: { x: X1, y: Y } });
await overlay.click({ position: { x: X2, y: Y } });
await page.waitForTimeout(300);
const labelX = await page.evaluate(() => {
  const sv = document.querySelector('[data-testid="markup-overlay"]');
  const t = [...sv.querySelectorAll("text")].find((e) => /ft|set scale/.test(e.textContent));
  return t ? parseFloat(t.getAttribute("x")) : null;
});
// midpoint ≈ (250+650)/2 = 450 (+4 nudge). pts[0] would be ≈ 250.
const midOk = labelX != null && Math.abs(labelX - 454) < 40 && labelX > 330;
check("B304 distance label sits near the midpoint (~450), not pts[0] (~250)", midOk, `labelX=${labelX}`);

await page.screenshot({ path: new URL("./screens/b300-b304.png", import.meta.url).pathname });

/* ---------- Stitcher — same undo/redo + inline-calibrate fixes apply there too ---------- */
await page.locator('button:has-text("Stitch ▸")').first().click();
await page.waitForTimeout(700);
await page.setInputFiles('input[type="file"][accept*="pdf"]', PDF, { timeout: 8000 });
await page.waitForTimeout(900);
await page.locator('button:has-text("· p1")').first().click(); // add sheet 1 to the canvas
await page.waitForTimeout(900);
const placedOne = await page.locator("text=/Placed sheets · 1/").count();
const stitchSvg = page.locator("svg").last();
// draw a distance across the placed sheet, then undo it
await page.locator('button:has-text("Distance")').first().click();
await stitchSvg.click({ position: { x: 150, y: 150 } });
await stitchSvg.click({ position: { x: 320, y: 150 } });
await page.waitForTimeout(300);
const measAfterDraw = await stitchSvg.locator("line").count();
await page.keyboard.press("Control+z");
await page.waitForTimeout(300);
const measAfterUndo = await stitchSvg.locator("line").count();
// inline calibrate validation in the stitcher
await page.locator('button:has-text("Calibrate")').first().click();
await stitchSvg.click({ position: { x: 150, y: 250 } });
await stitchSvg.click({ position: { x: 350, y: 250 } });
await page.waitForTimeout(300);
const stCalBox = await page.locator('input[placeholder*="38"]').count();
await page.locator('input[placeholder*="38"]').fill("1/8");
await page.locator('input[placeholder*="38"]').press("Enter");
await page.waitForTimeout(200);
const stRejected = await page.locator("text=/Enter a length|scale ratio/i").count();
await page.locator('input[placeholder*="38"]').fill("100");
await page.locator('input[placeholder*="38"]').press("Enter");
await page.waitForTimeout(300);
const stCalibrated = await page.locator("text=/Calibrated/").count();
check("Stitch: a sheet places on the canvas", placedOne === 1);
check("Stitch: draw distance → Ctrl-Z undoes it", measAfterDraw >= 1 && measAfterUndo === 0, `draw=${measAfterDraw}, undo=${measAfterUndo}`);
check("Stitch: inline Calibrate opens + rejects '1/8'", stCalBox === 1 && stRejected >= 1, `box=${stCalBox}, rej=${stRejected}`);
check("Stitch: accepts '100' → Calibrated", stCalibrated >= 1, `calibrated=${stCalibrated}`);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
