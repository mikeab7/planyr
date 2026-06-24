/* Verify the Document Review "open feedback" batch B446–B448 against the REAL built viewer
 * (vite preview on :4173), logged out. These are the state/timing/feedback bugs from the
 * 2026-06-24 owner trio:
 *
 *   B446 (NEW-1) — dropping/opening a file gives a clear, unmistakable signal it registered:
 *        the instant a file is accepted a canvas-level "Opening …" overlay (data-testid=
 *        "opening-overlay") appears, then a success state (the canvas/sheet renders). And a
 *        REJECTED open is never silent — an invalid (non-PDF) drop raises the loud openErr
 *        banner (role="alert") even though no document is open.
 *   B448 (NEW-3) — the dropped bytes are cached in-session, so the backdrop renders from the
 *        File directly (no cloud round-trip needed). Confirmed indirectly here: logged out
 *        (no cloud), a dropped PDF still renders its canvas — bytes came from the session cache.
 *
 * NB: the cross-file SWITCH determinism (B447) and the mid-upload backdrop survival (B448 on a
 * keyless source) need TWO saved cloud reviews + auth, which the logged-out sandbox can't drive
 * — those are logged for a signed-in live pass in VERIFICATION.md. This harness pins the parts
 * that ARE observable logged out: the overlay wiring + the loud-reject contract + no-regression
 * open.
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-open-feedback.mjs                  (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b446-test.pdf";
const TXT_PATH = "/tmp/b446-not-a.pdf.txt";

function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (SHEET ONE - open-feedback test B446) Tj ET";
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
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

writeFileSync(PDF_PATH, buildPdf());
writeFileSync(TXT_PATH, "this is not a pdf");

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const fileInput = 'input[accept="application/pdf,.pdf"]';

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(900);
  // Into the Review (Document Review) workspace.
  await page.locator('button:has-text("Review")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);

  // ---- B446: an INVALID drop is LOUD, never silent (openErr banner) ----
  {
    await page.setInputFiles(fileInput, TXT_PATH, { timeout: 8000 });
    let shown = false, text = "";
    try {
      const alert = page.locator('[role="alert"]');
      await alert.waitFor({ state: "visible", timeout: 4000 });
      text = (await alert.first().innerText()).replace(/\s+/g, " ").trim();
      shown = /isn’t a PDF|isn't a PDF|PDF/i.test(text);
    } catch (_) {}
    ok("B446 invalid open is surfaced (not silent)", shown, shown ? `banner: "${text.slice(0, 70)}…"` : "no openErr banner appeared for a non-PDF");
    // dismiss the banner so it doesn't shadow the next step
    const x = page.locator('[role="alert"] button[title="Dismiss"]');
    if (await x.count()) await x.first().click().catch(() => {});
    await page.waitForTimeout(200);
  }

  // ---- B446: a VALID drop shows the "Opening…" overlay, then the canvas (success state) ----
  {
    // Fire the open WITHOUT awaiting the input promise so we can race the transient overlay.
    page.setInputFiles(fileInput, PDF_PATH, { timeout: 8000 }).catch(() => {});
    let overlaySeen = false, label = "";
    try {
      const ov = page.locator('[data-testid="opening-overlay"]');
      await ov.waitFor({ state: "visible", timeout: 5000 });
      overlaySeen = true;
      label = (await ov.innerText()).replace(/\s+/g, " ").trim();
    } catch (_) {}
    ok("B446 'Opening…' overlay appears on a valid open", overlaySeen, overlaySeen ? `overlay: "${label}"` : "overlay never became visible");
    ok("B446 overlay names the file being opened", /Opening .*b446-test\.pdf/i.test(label) || /Opening .*\.pdf/i.test(label), `text="${label}"`);

    // success state: the overlay clears and the sheet renders.
    let canvasReady = false;
    try {
      await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
      canvasReady = true;
    } catch (_) {}
    ok("B448 dropped PDF renders its canvas (bytes from session cache, logged out)", canvasReady, canvasReady ? "canvas rasterized with no cloud round-trip" : "canvas never rendered");

    let overlayGone = false;
    try { await page.locator('[data-testid="opening-overlay"]').waitFor({ state: "detached", timeout: 6000 }); overlayGone = true; }
    catch (_) { overlayGone = (await page.locator('[data-testid="opening-overlay"]').count()) === 0; }
    ok("B446 overlay clears on success", overlayGone, overlayGone ? "overlay removed after the sheet rendered" : "overlay stuck on screen");
  }

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 2).join(" | ") : "clean");
} catch (e) {
  ok("harness ran", false, String(e).slice(0, 200));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
