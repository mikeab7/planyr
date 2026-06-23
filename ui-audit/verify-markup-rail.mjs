/* Verify B330 — the Markup drawing/measure tools + zoom controls now live in a right-side
 * vertical rail (Bluebeam-style), not AppHeader row 2. Against the REAL built viewer.
 *
 *   1. The tools moved OFF the header INTO the rail: the rail holds Select…Text + zoom, and
 *      the top header no longer carries a "Distance" tool button.
 *   2. The rail sits on the RIGHT, between the canvas and the Takeoff panel.
 *   3. Select is the default active tool, highlighted on the Markup accent (#EF9F27).
 *   4. Clicking a rail tool activates it (accent highlight) and the hint bar follows.
 *   5. The rail's zoom controls work (In grows the sheet; a % readout is present).
 *   6. The Takeoff panel collapses + re-opens.
 *   7. No uncaught page errors.
 *
 * Run:  npx vite preview --port 4173   ·   node ui-audit/verify-b321.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/markup-rail-test.pdf";
const ACCENT = "rgb(239, 159, 39)"; // #EF9F27

function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (SHEET ONE - B330 tool rail test) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`,
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

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const railBtn = (name) => page.locator('[data-testid="markup-rail"] button', { hasText: new RegExp(`^${name}$`) });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
  await page.waitForTimeout(500);

  // ---- 1. tools are in the rail; the header no longer carries them ----
  {
    const railTools = [];
    for (const n of ["Select", "Pan", "Calibrate", "Distance", "Perimeter", "Area", "Count", "Rect", "Cloud", "Text"]) {
      railTools.push(await railBtn(n).count());
    }
    const allInRail = railTools.every((c) => c === 1);
    // "Distance" must exist exactly once, and inside the rail (not duplicated in the header).
    const distanceTotal = await page.locator('button', { hasText: /^Distance$/ }).count();
    ok("1a all 10 tools live in the right rail", allInRail, `counts ${railTools.join(",")}`);
    ok("1b tools are not left in the header", distanceTotal === 1, `total "Distance" buttons on the page = ${distanceTotal} (1 = only the rail's)`);
  }

  // ---- 2. rail is on the right, between the canvas and the Takeoff ----
  {
    const pos = await page.evaluate(() => {
      const rail = document.querySelector('[data-testid="markup-rail"]');
      const canvas = document.querySelector("canvas");
      const vp = canvas.parentElement.parentElement;          // the canvas viewport
      const takeoff = [...document.querySelectorAll("div")].find((d) => /^Takeoff/.test(d.textContent || "") && d.getBoundingClientRect().width < 300 && d.getBoundingClientRect().width > 200);
      return {
        railL: rail.getBoundingClientRect().left, railR: rail.getBoundingClientRect().right, railW: rail.getBoundingClientRect().width,
        vpR: vp.getBoundingClientRect().right, takeoffL: takeoff ? takeoff.getBoundingClientRect().left : null, winW: window.innerWidth,
      };
    });
    ok("2a rail is on the right side", pos.railL > pos.winW * 0.6, `rail.left=${Math.round(pos.railL)} of ${pos.winW}`);
    ok("2b rail is flush right of the canvas, left of Takeoff", pos.railL >= pos.vpR - 2 && (pos.takeoffL == null || pos.railR <= pos.takeoffL + 2), `vp.right=${Math.round(pos.vpR)} rail=[${Math.round(pos.railL)}..${Math.round(pos.railR)}] takeoff.left=${pos.takeoffL == null ? "?" : Math.round(pos.takeoffL)}`);
  }

  // ---- 3. Select is the default active tool, on the Markup accent ----
  {
    const bg = await railBtn("Select").evaluate((el) => getComputedStyle(el).backgroundColor);
    ok("3 Select is active by default on the #EF9F27 accent", bg === ACCENT, `Select bg = ${bg}`);
  }

  // ---- 4. clicking a rail tool activates it + the hint bar follows ----
  {
    await railBtn("Area").click();
    await page.waitForTimeout(150);
    const areaBg = await railBtn("Area").evaluate((el) => getComputedStyle(el).backgroundColor);
    const selBg = await railBtn("Select").evaluate((el) => getComputedStyle(el).backgroundColor);
    const hint = await page.evaluate(() => (document.body.innerText.match(/Area:[^\n]*/) || [""])[0]);
    ok("4a clicking Area activates it (accent)", areaBg === ACCENT && selBg !== ACCENT, `Area=${areaBg} Select=${selBg}`);
    ok("4b the hint bar follows the active tool", /^Area:/.test(hint), `hint: "${hint.slice(0, 40)}…"`);
  }

  // ---- 5. rail zoom controls work ----
  {
    const w0 = await page.evaluate(() => document.querySelector("canvas").getBoundingClientRect().width);
    await railBtn("In").click(); await railBtn("In").click();
    await page.waitForTimeout(250);
    const w1 = await page.evaluate(() => document.querySelector("canvas").getBoundingClientRect().width);
    const hasPct = await page.evaluate(() => /\d+%/.test(document.querySelector('[data-testid="markup-rail"]').textContent || ""));
    ok("5a rail In button zooms the sheet", w1 > w0 + 5, `canvas ${Math.round(w0)}→${Math.round(w1)}px`);
    ok("5b rail shows a % zoom readout", hasPct, `rail text has a % readout = ${hasPct}`);
  }

  // ---- 6. Takeoff collapses + re-opens ----
  {
    const takeoffWide = () => page.evaluate(() => [...document.querySelectorAll("div")].some((d) => Math.abs(d.getBoundingClientRect().width - 246) < 3 && /Takeoff/.test(d.textContent || "")));
    const open0 = await takeoffWide();
    await page.locator('button[title="Hide the takeoff panel"]').click();
    await page.waitForTimeout(200);
    const openAfterHide = await takeoffWide();
    await page.locator('button[title="Show the takeoff panel"]').click();
    await page.waitForTimeout(200);
    const openAfterShow = await takeoffWide();
    ok("6 Takeoff collapses and re-opens", open0 && !openAfterHide && openAfterShow, `wide panel present: start=${open0} afterHide=${openAfterHide} afterShow=${openAfterShow}`);
  }

  ok("7 no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 2).join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
