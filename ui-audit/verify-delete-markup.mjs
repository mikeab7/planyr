/* Verify the "I can't delete this little triangle" fix (B374/B375/B376) against the REAL
 * built Markup viewer (vite preview on :4173). Reproduces Michael's exact case — an
 * UNCALIBRATED Area measurement (its label reads "set scale", a filled triangle) — and
 * proves every removal path now works:
 *
 *   B374 — clicking ANYWHERE INSIDE the filled area selects it (the interior was a dead hit
 *          target before; only an edge/vertex click registered). A click clearly OUTSIDE it
 *          does NOT select — the hit test stays specific.
 *   B375 — a selected markup shows an on-canvas × button; clicking it removes the markup.
 *   B374+kbd — an interior-selected area also deletes via the Delete key (the path that was
 *          unreachable because you could never select the area to begin with).
 *   B376 — the Takeoff "This sheet" list shows the markup with its own × that deletes it,
 *          independent of clicking it on the canvas.
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-delete-markup.mjs                 (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js needs the newer Chromium (1194 lacks Map.prototype.getOrInsertComputed). (V72 note)
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/delete-markup-test.pdf";

/* A structurally-valid one-page Letter PDF (612×792) with exact xref offsets so PDF.js parses
 * it without a rebuild. No scale text → the sheet stays UNCALIBRATED (label = "set scale"),
 * matching the reported triangle. */
function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (DELETE-MARKUP TEST SHEET) Tj ET";
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
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

const geom = (page) => page.evaluate(() => {
  const c = document.querySelector("canvas");
  const wrap = c.parentElement.parentElement;
  const cr = c.getBoundingClientRect();
  return { canL: cr.left, canT: cr.top, cssW: cr.width, cssH: cr.height };
});
const polyCount = (page) => page.evaluate(() => document.querySelectorAll("canvas + svg polygon").length);
const polyStroke = (page) => page.evaluate(() => { const p = document.querySelector("canvas + svg polygon"); return p ? p.getAttribute("stroke-width") : null; });
const areaLabel = (page) => page.evaluate(() => { const t = [...document.querySelectorAll("canvas + svg text")].map((n) => n.textContent); return t.join("|"); });

// Draw an UNCALIBRATED triangle Area: 3 interior-distinct clicks + Enter (Enter commits all
// points with no phantom-point stripping). Returns the triangle's centroid + an outside point.
async function drawTriangle(page) {
  await page.getByRole("button", { name: "Area", exact: true }).click();
  const g = await geom(page);
  const P = (fx, fy) => ({ x: g.canL + g.cssW * fx, y: g.canT + g.cssH * fy });
  const p1 = P(0.40, 0.30), p2 = P(0.60, 0.30), p3 = P(0.50, 0.55);
  for (const p of [p1, p2, p3]) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(80); }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  return { centroid: P(0.50, 0.383), outside: P(0.50, 0.72) };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Page", exact: true }).click(); // whole sheet visible so every click lands
  await page.waitForTimeout(500);

  // ---- B374: interior selects; outside does NOT ----
  {
    const { centroid, outside } = await drawTriangle(page);
    const label = await areaLabel(page);
    ok("setup: uncalibrated Area drawn", (await polyCount(page)) === 1 && /set scale/.test(label), `1 polygon, label "${label}"`);

    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.waitForTimeout(120);
    // click OUTSIDE the triangle first — must NOT select (no phantom "select anything")
    await page.mouse.click(outside.x, outside.y);
    await page.waitForTimeout(150);
    const strokeOutside = await polyStroke(page);
    const xAfterOutside = await page.getByTitle("Delete this markup (Del)").count();
    ok("B374 click OUTSIDE the area does not select", strokeOutside === "2" && xAfterOutside === 0, `stroke=${strokeOutside}, on-canvas ×=${xAfterOutside}`);

    // click the INTERIOR centroid — must select (this is the dead-centre bug)
    await page.mouse.click(centroid.x, centroid.y);
    await page.waitForTimeout(150);
    const strokeInside = await polyStroke(page);
    ok("B374 click INSIDE the filled area selects it", strokeInside === "3", `selected stroke width = ${strokeInside} (was 2 = unselected/bug)`);
  }

  // ---- B375: the on-canvas × appears on the selection and deletes it ----
  {
    const xBtn = page.getByTitle("Delete this markup (Del)");
    const shown = await xBtn.count();
    ok("B375 on-canvas × shown for the selection", shown === 1, `× button count = ${shown}`);
    await xBtn.first().click();
    await page.waitForTimeout(200);
    ok("B375 on-canvas × deletes the markup", (await polyCount(page)) === 0, `polygons after × = ${await polyCount(page)}`);
  }

  // ---- B374 + keyboard: interior-select then Delete key removes it ----
  {
    const { centroid } = await drawTriangle(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.mouse.click(centroid.x, centroid.y);
    await page.waitForTimeout(120);
    ok("B374 interior-selected for keyboard delete", (await polyStroke(page)) === "3", `stroke=${await polyStroke(page)}`);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
    ok("B374 Delete key removes the interior-selected area", (await polyCount(page)) === 0, `polygons after Delete = ${await polyCount(page)}`);
  }

  // ---- B376: the Takeoff list row × deletes it, independent of canvas selection ----
  {
    await drawTriangle(page); // tool stays on Area; nothing selected on canvas
    const rowDelete = page.getByTitle("Delete this markup", { exact: true }); // exact → not the "(Del)" on-canvas one
    const rowCount = await rowDelete.count();
    ok("B376 markup is listed in the Takeoff panel with a × ", rowCount >= 1, `row delete buttons = ${rowCount}`);
    await rowDelete.first().click();
    await page.waitForTimeout(200);
    ok("B376 Takeoff row × deletes the markup", (await polyCount(page)) === 0, `polygons after row × = ${await polyCount(page)}`);
  }

  ok("no page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.join(" | ") : "clean");
} catch (e) {
  ok("harness ran", false, String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
