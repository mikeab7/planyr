#!/usr/bin/env node
/* Measures the OCR-scanned-deed pipeline (deedOcr.js -> pdfRaster.js -> imagePreprocess.js ->
 * Tesseract.js -> deedOcrRepair.js -> deedParse.js) end to end, in a REAL headless browser, against
 * a genuinely degraded synthetic scan — not a fixture built to flatter the parser.
 *
 * WHY SYNTHETIC RATHER THAN THE OWNER'S REAL DEED: he does not have the PDF attached to this
 * session (Chambers County "16 - Recorded Correction SWD.pdf"); he ran stock Tesseract against it
 * himself and reported the measured facts (19/19 bearings recovered, one true character error — a
 * doubled degree sign standing in for a minutes prime — plus two harmless word slips). This fixture
 * renders a comparable legal description (same construct set: a non-tangent curve with radius/
 * central-angle/arc/chord, a "passing at ... for a total distance of" clause, a parenthetical offset
 * note) to a canvas and degrades it — skew, noise, dropped contrast, a resample-down-and-up blur —
 * the way a repeated photocopy scan degrades, which is a HARDER case than the owner's clean 1-bit
 * CCITT scan. The two together (his real measurement + this harder synthetic one) bracket what the
 * feature actually does: excellent on a clean bitonal county scan, and still honestly reported here
 * on a rougher one.
 *
 * Ground truth is the exact polygon `test/deedRealDeedAudit.test.js` already proves deedParse.js
 * parses and closes correctly from clean text — so a shortfall here is attributable to OCR
 * recognition quality, not to a parser gap (already ruled out separately).
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5195;
const ASSET_PORT = 5196;
const BASE = `http://127.0.0.1:${PORT}`;
const ASSET_BASE = `http://127.0.0.1:${ASSET_PORT}`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// A plain loopback static file server for Tesseract's worker/WASM-core/language-data files —
// same-origin, HTTP-only, so it never touches the sandbox's TLS-inspecting egress proxy (which
// breaks a Web Worker's `importScripts()` load of a REMOTE script specifically; measured — a plain
// `fetch()` to the same external host works, only the worker's importScripts of jsdelivr's
// worker.min.js failed outright). Serves the exact bytes npm already installed, plus one
// pre-fetched copy of the English trained-data file (also from jsdelivr, fetched once via plain
// `curl`, which is unaffected — this is a one-time cache under the OS temp dir, not committed).
function startAssetServer() {
  const coreDir = path.join(ROOT, "node_modules/tesseract.js-core");
  const workerFile = path.join(ROOT, "node_modules/tesseract.js/dist/worker.min.js");
  const langDir = path.join(os.tmpdir(), "planyr-ocr-fixture-lang");
  fs.mkdirSync(langDir, { recursive: true });
  const langFile = path.join(langDir, "eng.traineddata.gz");
  const MIME = { ".js": "text/javascript", ".wasm": "application/wasm", ".gz": "application/gzip" };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, ASSET_BASE);
    let filePath = null;
    if (url.pathname === "/worker.min.js") filePath = workerFile;
    else if (url.pathname.startsWith("/core/")) filePath = path.join(coreDir, url.pathname.slice("/core/".length));
    else if (url.pathname === "/lang/eng.traineddata.gz") filePath = langFile;
    if (!filePath || !fs.existsSync(filePath)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", MIME[path.extname(filePath)] || "application/octet-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(ASSET_PORT, "127.0.0.1", () => resolve({ server, langFile }));
  });
}

async function ensureLangDataCached(langFile) {
  if (fs.existsSync(langFile)) return;
  const res = await fetch("https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz");
  if (!res.ok) throw new Error(`couldn't fetch English trained data: HTTP ${res.status}`);
  fs.writeFileSync(langFile, Buffer.from(await res.arrayBuffer()));
}

const GROUND_TEXT = `BEGINNING at a found 1/2 inch iron rod for the northwest corner of the herein described 94.53 acre tract;

THENCE North 00 degrees 00 minutes 00 seconds East, 400.00 feet to a point for corner;

THENCE Northeasterly, along a curve to the right, having a radius of 400.00 feet, a central angle of 60 degrees 00 minutes 00 seconds, an arc length of 418.88 feet, and a long chord which bears North 90 degrees 00 minutes 00 seconds East, 400.00 feet to a point for corner;

THENCE South 75 degrees 57 minutes 50 seconds East, passing at 200.00 feet a set 5/8 inch iron rod for reference, for a total distance of 412.31 feet to a point for corner;

THENCE South 00 degrees 00 minutes 00 seconds East, (0.24 feet left) 400.00 feet to a set iron rod;

THENCE South 78 degrees 41 minutes 24 seconds West, 509.90 feet to a point;

THENCE North 56 degrees 18 minutes 36 seconds West, 360.56 feet to the POINT OF BEGINNING, containing 94.53 acres of land, more or less.`;

// Degradation level to apply — override via env for the "how hard can this be pushed" probe
// without editing the file. Default is calibrated to a realistic repeated-photocopy scan.
const DEGRADE = process.env.OCR_FIXTURE_STRESS === "1"
  ? { skewDeg: 2.4, noise: 14, contrastDrop: 0.6, resampleFactor: 0.42 }
  : { skewDeg: 1.6, noise: 6, contrastDrop: 0.8, resampleFactor: 0.6 };

const GROUND_TRUTH = [
  { az: 0.000, distFt: 400.00, bearingLabel: "N00°00'00\"E" },
  { az: 90.000, distFt: 400.00, bearingLabel: "N90°00'00\"E (curve chord)" },
  { az: 104.036, distFt: 412.31, bearingLabel: "S75°57'50\"E" },
  { az: 180.000, distFt: 400.00, bearingLabel: "S00°00'00\"E" },
  { az: 258.690, distFt: 509.90, bearingLabel: "S78°41'24\"W" },
  { az: 303.690, distFt: 360.56, bearingLabel: "N56°18'36\"W" },
];

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok || r.status === 404) return true; } catch (_) { /* not up yet */ }
    await delay(500);
  }
  throw new Error("dev server did not come up");
}

async function run() {
  const { server: assetServer, langFile } = await startAssetServer();
  await ensureLangDataCached(langFile);
  const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  let viteOut = "";
  vite.stdout.on("data", (d) => { viteOut += d; });
  vite.stderr.on("data", (d) => { viteOut += d; });
  try {
    await waitForServer();
    const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
    try {
      const page = await browser.newPage({ ignoreHTTPSErrors: true });
      const consoleErrors = [];
      page.on("pageerror", (e) => consoleErrors.push(String(e)));
      page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
      await page.goto(`${BASE}/ui-audit/fixtures/ocr-harness.html`, { waitUntil: "load" });
      await page.waitForFunction(() => window.__harnessReady === true, { timeout: 30000 });
      // FOREGROUND-OR-VOID (/CLAUDE.md) — this harness times the OCR run (wall-clock), so it must
      // prove the tab is actually foregrounded/rendering before trusting that clock.
      await assertMeasurable(page, "verify-ocr-scanned-deed");

      console.log(`Running degraded-scan OCR fixture (${JSON.stringify(DEGRADE)})…`);
      const t0 = Date.now();
      const result = await page.evaluate(
        ({ text, groundTruth, assetBase, degrade }) => window.__runOcrFixture({
          text, groundTruth, degrade,
          // Same-origin(loopback) asset paths — see startAssetServer's header for why: the sandbox's
          // TLS-inspecting proxy breaks a Worker's `importScripts()` load of a REMOTE script.
          ocrOpts: { tesseractOptions: { workerPath: `${assetBase}/worker.min.js`, corePath: `${assetBase}/core`, langPath: `${assetBase}/lang`, gzip: true } },
        }),
        { text: GROUND_TEXT, groundTruth: GROUND_TRUTH, assetBase: ASSET_BASE, degrade: DEGRADE },
      );
      const wallMs = Date.now() - t0;

      console.log("\n=== OCR scanned-deed fixture — RESULT ===");
      console.log(`Wall clock: ${(wallMs / 1000).toFixed(1)}s (build ${(result.timings.buildMs / 1000).toFixed(2)}s, OCR ${(result.timings.ocrMs / 1000).toFixed(2)}s)`);
      console.log(`Mean OCR confidence: ${result.meanConfidenceByPage.map((c) => c == null ? "n/a" : c.toFixed(1)).join(", ")}%`);
      console.log(`Repair changes: ${JSON.stringify(result.changesByPage[0])}`);
      console.log(`\nCalls found: ${result.callsFound} / ${result.groundTruthCount} ground-truth courses`);
      console.log(`Bearings correctly recovered (az within 0.5°, distance within 1% or 0.5ft): ${result.bearingsRecovered} / ${result.groundTruthCount}`);
      console.log(`Closes: ${result.closes}  Misclosure: ${result.gap == null ? "n/a" : result.gap.toFixed(2) + " ft"}`);
      console.log("\nPer-call detail:");
      for (const r of result.recovered) {
        console.log(`  ${r.ok ? "✓" : "✗"} got ${r.bearing ?? "—"} ${r.distFt?.toFixed(2) ?? "—"}ft   vs gt ${r.gtBearing ?? "—"} ${r.gtDist?.toFixed(2) ?? "—"}ft`);
      }
      if (result.groundTruthCount > result.recovered.length) {
        console.log(`  ✗ MISSING ${result.groundTruthCount - result.recovered.length} call(s) entirely`);
      }
      console.log("\n--- Repaired OCR text ---");
      console.log(result.repairedText);
      if (consoleErrors.length) {
        console.log("\n--- Browser console errors ---");
        for (const e of consoleErrors) console.log(" ", e);
      }

      const rate = result.bearingsRecovered / result.groundTruthCount;
      console.log(`\n${rate === 1 ? "✓" : rate >= 0.8 ? "⚠" : "✗"} Bearing recovery rate: ${(rate * 100).toFixed(0)}%`);
      process.exitCode = rate >= 0.8 ? 0 : 1;
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("FIXTURE FAILED:", e && e.stack || e);
    console.error("\n--- vite output ---\n", viteOut.slice(-4000));
    process.exitCode = 1;
  } finally {
    vite.kill("SIGTERM");
    assetServer.close();
  }
}

run();
