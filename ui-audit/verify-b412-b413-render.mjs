/* Verify B412 (no white flash on zoom-settle) + B413 (Bluebeam-class sharpness via a two-layer,
 * viewport-clipped render) against the REAL built viewer (vite preview on :4173).
 *
 * Builds a LARGE E-size sheet (2448×1584 pt) with a big filled black rectangle + text, opens it
 * in the Library/Markup canvas at deviceScaleFactor 2 (a Retina-class display — the case that went
 * soft), then drives + asserts the DOM:
 *
 *   A. Two-layer structure — a BACKDROP canvas fills the page box and a DETAIL canvas sits over it.
 *   B. The backdrop is rendered (opaque linework present) = the no-white floor under everything.
 *   C. SHARPNESS (B413): zoomed in on the big sheet, the DETAIL canvas's backing-store density is
 *      ~the device pixel ratio (native), whereas the OLD whole-page raster would have dropped well
 *      below that at the same zoom (budget spread across the whole sheet). detail ÷ would-be-whole.
 *   D. NO WHITE FLASH (B412): on zoom the backdrop is NEVER re-rastered (its backing dims are
 *      unchanged → it can't blank), and polling the detail canvas through the settle never catches
 *      it blank (the double-buffered swap keeps the prior frame up until the new one is ready).
 *   E. The markup overlay still draws through the two-layer change (pointer pipeline intact).
 *   F. No uncaught page errors.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b412-b413-render.mjs        (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b412-b413-esize.pdf";
const PAGE_W = 2448, PAGE_H = 1584; // E-size in PDF points

function buildPdf() {
  // A big filled black rectangle covering the page centre (a guaranteed opaque region to sample)
  // + large text. Two pages so a sheet-switch path exists.
  const content = `q 0 0 0 rg 424 392 1600 800 re f Q BT /F1 90 Tf 300 1300 Td (E-SIZE CIVIL SHEET C-5 B412/B413) Tj ET`;
  const c2 = `q 0 0 0 rg 424 392 1600 800 re f Q BT /F1 90 Tf 300 1300 Td (E-SIZE CIVIL SHEET C-6) Tj ET`;
  const mb = `[0 0 ${PAGE_W} ${PAGE_H}]`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mb} /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox ${mb} /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`,
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

// The two canvases live inside the page box (the markup-overlay's parent). [0]=backdrop, [1]=detail.
const layers = (page) => page.evaluate(() => {
  const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
  if (!box) return null;
  const cs = Array.from(box.querySelectorAll("canvas"));
  const meas = (c) => { const r = c.getBoundingClientRect(); return { backW: c.width, backH: c.height, cssW: r.width, cssH: r.height, left: r.left, top: r.top }; };
  return { count: cs.length, box: { w: box.clientWidth, h: box.clientHeight }, backdrop: cs[0] ? meas(cs[0]) : null, detail: cs[1] ? meas(cs[1]) : null };
});

// Count opaque (alpha>0) pixels in a small square at the centre of a canvas's backing store —
// proves the layer is RENDERED (linework present), not a blanked/transparent canvas. Sampling
// the centre, which the page-centred black rectangle always covers.
const opaqueCenter = (page, idx, n = 60) => page.evaluate(({ idx, n }) => {
  const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
  const c = box?.querySelectorAll("canvas")[idx];
  if (!c || !c.width) return -1;
  const x = Math.max(0, Math.floor(c.width / 2 - n / 2)), y = Math.max(0, Math.floor(c.height / 2 - n / 2));
  const w = Math.min(n, c.width), h = Math.min(n, c.height);
  const d = c.getContext("2d").getImageData(x, y, w, h).data;
  let op = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) op++;
  return op;
}, { idx, n });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
// deviceScaleFactor 2 = a Retina-class display, the exact case the whole-page budget went soft on.
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  // wait for BOTH layers to have a backing store
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
    const cs = box ? box.querySelectorAll("canvas") : [];
    return cs.length >= 2 && cs[0].width > 0 && cs[1].width > 0;
  }, { timeout: 15000 });
  await page.getByRole("button", { name: "Fit", exact: true }).click();
  await page.waitForTimeout(600);

  // ---- A. two-layer structure ----
  {
    const L = await layers(page);
    ok("A1 two canvases (backdrop + detail) inside the page box", L && L.count >= 2 && !!L.backdrop && !!L.detail, L ? `count=${L.count}` : "no page box");
    const fills = L && Math.abs(L.backdrop.cssW - L.box.w) < 3 && Math.abs(L.backdrop.cssH - L.box.h) < 3;
    ok("A2 backdrop fills the page box (the no-white floor)", !!fills, L ? `backdrop ${Math.round(L.backdrop.cssW)}×${Math.round(L.backdrop.cssH)} vs box ${L.box.w}×${L.box.h}` : "—");
  }

  // ---- B. the backdrop is actually rendered (opaque linework present) ----
  {
    const op = await opaqueCenter(page, 0);
    ok("B backdrop is rendered (opaque content, not a blank canvas)", op > 1000, `${op}/3600 centre pixels opaque`);
  }

  // record the backdrop backing dims BEFORE zoom (must not change on zoom — proves no re-raster)
  const before = await layers(page);

  // ---- zoom IN toward the viewport centre until the sheet is enlarged enough that the OLD
  //      whole-page raster would have busted the budget (scale > ~1.24 on this E-size sheet);
  //      stay centred so the detail covers the page centre ----
  {
    const cx = before.detail.left + before.detail.cssW / 2, cy = before.detail.top + before.detail.cssH / 2;
    await page.mouse.move(cx, cy);
    let scale = 0;
    for (let i = 0; i < 40; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(55);
      const L = await layers(page);
      scale = L.backdrop.cssW / PAGE_W;            // backdrop fills the page box → cssW = pageW*scale
      if (scale >= 2.6) break;                       // deep enough for a clear whole-page-vs-detail gap
    }
    await page.waitForTimeout(500); // let the settle re-raster the detail at the final scale
    ok("(zoom reached a deep scale for the comparison)", scale >= 1.4, `view.scale ≈ ${scale.toFixed(2)} (need > 1.24 for the old raster to go soft)`);
  }

  // ---- C. SHARPNESS: detail renders the visible window at ~device density; the old whole-page
  //         raster would have gone soft at this zoom ----
  {
    const m = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="markup-overlay"]')?.parentElement;
      const cs = box.querySelectorAll("canvas");
      const bd = cs[0].getBoundingClientRect(), dt = cs[1].getBoundingClientRect();
      const pageW = 2448, pageH = 1584;
      const scale = bd.width / pageW;                                  // backdrop fills page box: cssW = pageW*scale
      const detailDensity = cs[1].width / dt.width;                   // backing ÷ CSS = device-px per CSS-px
      const wholeArea = (pageW * scale) * (pageH * scale);
      const wholeDensity = Math.max(0.05, Math.min(2, Math.sqrt(24e6 / wholeArea))); // what the old whole-page raster would pick
      return { scale, dpr: window.devicePixelRatio, detailDensity, wholeDensity };
    });
    ok("C1 detail renders at ~native device density when zoomed in",
       m.detailDensity >= m.dpr - 0.15, `detail density ${m.detailDensity.toFixed(2)}× vs dpr ${m.dpr}× at zoom ${m.scale.toFixed(2)}`);
    ok("C2 detail is sharper than the OLD whole-page raster would be here (the Bluebeam gap)",
       m.detailDensity / m.wholeDensity > 1.3, `detail ${m.detailDensity.toFixed(2)}× vs would-be whole-page ${m.wholeDensity.toFixed(2)}× → ${(m.detailDensity / m.wholeDensity).toFixed(2)}× sharper`);
  }

  // ---- D. NO WHITE FLASH: backdrop dims unchanged by zoom (never re-rastered → never blanks) ----
  {
    const after = await layers(page);
    const same = after.backdrop.backW === before.backdrop.backW && after.backdrop.backH === before.backdrop.backH;
    ok("D1 backdrop is NOT re-rastered on zoom (its backing dims are unchanged → it can't flash white)",
       same, `backdrop backing ${before.backdrop.backW}×${before.backdrop.backH} → ${after.backdrop.backW}×${after.backdrop.backH}`);
    const op = await opaqueCenter(page, 0);
    ok("D2 backdrop still shows the page through the zoom (opaque floor intact)", op > 1000, `${op}/3600 opaque`);

    // Poll the detail layer across a fresh settle: with the double-buffer it is never caught blank
    // (the old clear-then-async-render would leave a transparent gap a poll could catch).
    const cx2 = after.detail.left + after.detail.cssW / 2, cy2 = after.detail.top + after.detail.cssH / 2;
    await page.mouse.move(cx2, cy2);
    await page.mouse.wheel(0, -360); // kick one more re-raster
    let minOpaque = Infinity;
    for (let i = 0; i < 12; i++) { const o = await opaqueCenter(page, 1); if (o >= 0) minOpaque = Math.min(minOpaque, o); await page.waitForTimeout(28); }
    await page.waitForTimeout(300);
    ok("D3 detail layer never goes blank through a settle (double-buffered swap — no white flash)",
       minOpaque > 0, `min opaque centre pixels across the settle = ${minOpaque}`);
  }

  // ---- E. markup overlay still draws through the two-layer change ----
  {
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Rect", exact: true }).click();
    const L = await layers(page);
    const bx = L.backdrop.left, by = L.backdrop.top, bw = L.backdrop.cssW, bh = L.backdrop.cssH;
    await page.mouse.click(bx + bw * 0.35, by + bh * 0.35);
    await page.mouse.click(bx + bw * 0.55, by + bh * 0.48);
    await page.waitForTimeout(250);
    const rects = await page.evaluate(() => document.querySelectorAll('[data-testid="markup-overlay"] rect').length);
    ok("E markup overlay still draws over the two layers", rects >= 1, `${rects} rect(s) in the overlay`);
  }

  ok("F no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.join(" | ") : "clean");
} catch (e) {
  ok("harness completed", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
