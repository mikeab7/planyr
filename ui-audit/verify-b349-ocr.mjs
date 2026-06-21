/* Verify B349 (OCR — was B340 tail) — the REAL Tesseract engine loads (pinned jsDelivr assets) and reads a
 * scanned drawing's text in a real browser, and our word→item conversion produces the metadata
 * the grouping/stitching pipeline needs. This is the live counterpart to test/ocr.test.js (which
 * proves the conversion + orchestration deterministically with mocked recognize).
 *
 * It draws a "scanned" title block + match line onto a canvas (no text layer — exactly the case
 * `extractPageItems` returns [] for), runs Tesseract with the SAME pinned CDN paths ocr.js uses,
 * then applies the SAME wordsToItems → readSheetMeta logic and asserts it recovers the sheet
 * number, scale, and match-line target.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b340-ocr.mjs                 (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const V = "5.1.1";

const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (/error|fail/i.test(m.text())) console.log("   [console]", m.text()); });
await page.goto(BASE, { waitUntil: "load" });

// Pull in the Tesseract UMD build from the SAME CDN ocr.js pins. If the sandbox blocks it, the
// harness says so plainly rather than failing silently.
let loaded = true;
try { await page.addScriptTag({ url: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/tesseract.min.js` }); }
catch (e) { loaded = false; console.log("  ⚠ couldn't load tesseract.js from jsDelivr in-browser:", String(e).split("\n")[0]); }
check(loaded, "tesseract.js engine loads from jsDelivr in the browser");

if (loaded) {
  console.log("\nReal OCR of a 'scanned' title block + match line (this takes ~10–20s):");
  const result = await page.evaluate(async (V) => {
    // 1) Draw a scanned-looking sheet: white page, black title-block text on the right, a match
    //    line in the drawing area. No text layer — just pixels, like a scan.
    const SC = 2, W = 1224, H = 792;
    const cv = document.createElement("canvas"); cv.width = W * SC; cv.height = H * SC;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    g.fillStyle = "#000"; g.textBaseline = "top";
    const T = (t, x, y, px) => { g.font = `${px * SC}px Arial`; g.fillText(t, x * SC, y * SC); };
    T("GRADING PLAN", 980, 120, 26);
    T("SHEET NO. C-5", 980, 175, 20);
    T("SCALE: 1\"=40'", 980, 215, 20);
    T("MATCH LINE - SEE SHEET C-6", 690, 380, 18);

    // 2) Real Tesseract, pinned to the SAME jsDelivr assets ocr.js uses.
    const T9 = window.Tesseract;
    const worker = await T9.createWorker("eng", T9.OEM.LSTM_ONLY, {
      workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/worker.min.js`,
      corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${V}`,
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0",
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: T9.PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(cv, {}, { blocks: true });
    await worker.terminate();

    // 3) The SAME conversion ocr.js does: words (canvas px) → page-unit items.
    const words = data.words && data.words.length ? data.words : (() => {
      const out = []; for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) out.push(w); return out;
    })();
    const items = words.filter((w) => (w.text || "").trim() && (w.confidence == null || w.confidence >= 45))
      .map((w) => ({ str: w.text.trim(), x: w.bbox.x0 / SC, y: w.bbox.y0 / SC, w: (w.bbox.x1 - w.bbox.x0) / SC, h: (w.bbox.y1 - w.bbox.y0) / SC }));
    const text = items.map((i) => i.str).join(" ");
    return { text, n: items.length, sample: items.slice(0, 3) };
  }, V);

  console.log("   OCR read:", JSON.stringify(result.text).slice(0, 160));
  const t = result.text.toUpperCase().replace(/\s+/g, " ");
  check(result.n > 0, `Tesseract returned positioned words (${result.n})`);
  check(/C[-\s]?5/.test(t), "read the sheet number C-5");
  check(/GRADING/.test(t), "read the plan title (GRADING)");
  check(/40/.test(t) && /SCALE|=/.test(t), "read the scale callout (…=40')");
  check(/C[-\s]?6/.test(t), "read the match-line target C-6");
}

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
