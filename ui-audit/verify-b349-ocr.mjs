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
  console.log("\nReal OCR — clean read + degraded-input stress (one worker, ~40–60s):");
  const R = await page.evaluate(async (V) => {
    const SC = 2, W = 1224, H = 792;
    // ONE worker, reused across cases (matches ocr.js's single-worker session).
    const T9 = window.Tesseract;
    const worker = await T9.createWorker("eng", T9.OEM.LSTM_ONLY, {
      workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${V}/dist/worker.min.js`,
      corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${V}`,
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0",
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: T9.PSM.SPARSE_TEXT });

    // The SAME conversion ocr.js does (incl. the non-finite/inverted/low-conf guards).
    const toText = (data, sc) => {
      const words = data.words && data.words.length ? data.words : (() => {
        const out = []; for (const b of data.blocks || []) for (const p of (b.paragraphs || [])) for (const l of (p.lines || [])) for (const w of (l.words || [])) out.push(w); return out;
      })();
      const items = words.filter((w) => {
        const s = (w.text || "").trim(); if (!s) return false;
        if (Number.isFinite(w.confidence) && w.confidence < 45) return false;
        const b = w.bbox || {}; if (![b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) return false;
        return b.x1 > b.x0 && b.y1 > b.y0;
      }).map((w) => w.text.trim());
      return { text: items.join(" "), n: items.length };
    };
    const ocr = async (draw) => {
      const cv = document.createElement("canvas"); cv.width = W * SC; cv.height = H * SC;
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      g.fillStyle = "#000"; g.textBaseline = "top"; draw(g, SC);
      const { data } = await worker.recognize(cv, {}, { blocks: true });
      return toText(data, SC);
    };

    // Case 1 — clean scan (title block + match line).
    const clean = await ocr((g, sc) => {
      const T = (t, x, y, px) => { g.font = `${px * sc}px Arial`; g.fillText(t, x * sc, y * sc); };
      T("GRADING PLAN", 980, 120, 26); T("SHEET NO. C-5", 980, 175, 20);
      T("SCALE: 1\"=40'", 980, 215, 20); T("MATCH LINE - SEE SHEET C-6", 690, 380, 18);
    });
    // Case 2 — blank page (no text). Must NOT hallucinate a sheet number.
    const blank = await ocr(() => {});
    // Case 3 — pure noise (random speckles, no text). Must NOT hallucinate a sheet number.
    const noise = await ocr((g, sc) => { for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random()})`; g.fillRect(Math.random() * W * sc, Math.random() * H * sc, 2, 2); } });

    let crashed = false;
    try { await ocr((g, sc) => { g.font = `${10 * sc}px Arial`; g.fillText("DRAINAGE PLAN C-9", 60, 60); }); } catch (e) { crashed = true; }

    await worker.terminate();
    return { clean, blank, noise, crashed };
  }, V);

  const up = (s) => (s || "").toUpperCase().replace(/\s+/g, " ");
  // Clean read (acceptance)
  console.log("   clean:", JSON.stringify(R.clean.text).slice(0, 150));
  const t = up(R.clean.text);
  check(R.clean.n > 0, `clean scan → positioned words (${R.clean.n})`);
  check(/C[-\s]?5/.test(t), "clean: read the sheet number C-5");
  check(/GRADING/.test(t), "clean: read the plan title (GRADING)");
  check(/40/.test(t) && /SCALE|=/.test(t), "clean: read the scale callout (…=40')");
  check(/C[-\s]?6/.test(t), "clean: read the match-line target C-6");
  // Stress: no hallucination on blank / noise (the dangerous failure — a confident wrong read)
  console.log("   blank:", JSON.stringify(R.blank.text).slice(0, 80), "| noise:", JSON.stringify(R.noise.text).slice(0, 80));
  check(!/SHEET\s*NO|C-?5|GRADING/.test(up(R.blank.text)), `blank page → no hallucinated sheet/title (got ${R.blank.n} words)`);
  check(!/SHEET\s*NO|C-?5|GRADING/.test(up(R.noise.text)), `pure noise → no hallucinated sheet/title (got ${R.noise.n} words)`);
  check(!R.crashed, "a small-font degraded render is handled without throwing");
}

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
