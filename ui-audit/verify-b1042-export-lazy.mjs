#!/usr/bin/env node
/* B1042 verification — the export path moved behind a dynamic import() and must still work.
 *
 * WHAT THE SPLIT DID, and therefore what can break. The whole PDF / PNG / KMZ export path,
 * the B839 aerial tile Stitcher, and the GIS-layer capture were lifted out of
 * SitePlanner.jsx into lib/exportSheet.js, which is now fetched on demand. Those routines
 * used to read planner state through the component's closure; they now read it through a
 * `ctx` object SitePlanner rebuilds per call. `no-undef` lint proves no identifier dangles,
 * but it CANNOT prove the ctx carries the right VALUES — a key that is present but wired to
 * the wrong thing lints clean and exports a wrong sheet. Only driving the real UI catches
 * that, which is what this does.
 *
 * Asserts, against the built app, logged out, with all cross-origin traffic blocked:
 *   1. A plain Site route does NOT fetch the exportSheet chunk (it really is deferred).
 *   2. Opening the File menu WARMS it — so the deferral costs the owner no visible wait
 *      when they then click a download (the "short chunk fetch, not a delayed export" bar).
 *   3. Export PNG runs end to end and produces a real download with real bytes.
 *   4. Download PDF / pick frame enters print mode and lays out a frame — proving the
 *      print-plan aspect resolved through the lazy chunk (that value feeds the frame-resize
 *      drag, which cannot await, so it is cached in a ref).
 *   5. Switching orientation Landscape→Portrait re-fits the frame — the async aspect-refit path.
 *   6. "Download PDF" from print mode produces a real PDF — the deepest ctx consumer
 *      (sheet layout, restyle pass, image inlining, rasterize, jpegToPdf) end to end.
 *
 * (B765984: the .json project-file export/import pair was removed from the File menu, so the
 * former step 7 — "Export project file (.json) still downloads" — no longer applies.)
 *
 * NOT covered here (needs the live edge / real GIS hosts, so it stays a live check): the
 * aerial Stitcher actually stitching real tiles, and GIS raster/vector layers compositing
 * into the sheet. Both are cross-origin, which this sandbox blocks. See VERIFICATION.md.
 *
 *   node ui-audit/verify-b1042-export-lazy.mjs          # against http://localhost:4173
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const stem = (f) => f.replace(/-[A-Za-z0-9_-]{8,}\.js$/, "").replace(/\.js$/, "");

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(perfScenarioSeed());
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-b1042-export-lazy");

const fetched = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.startsWith(BASE) && /\/assets\/.*\.js(\?|$)/.test(u)) fetched.push(stem(u.split("/").pop()));
});
/* Block cross-origin so the run never depends on GIS/tile hosts the sandbox refuses. The
 * export path is built to survive exactly this (LOUD-FAILURE: a dropped aerial warns and the
 * file still downloads), so a clean run here also exercises that fallback. */
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

const fail = [];
const ok = [];
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60_000 });
await page.waitForTimeout(3000); // let any boot-time warm fire, so its absence is meaningful

/* ---- 1. deferred at boot ------------------------------------------------------------- */
if (fetched.includes("exportSheet")) fail.push("exportSheet was fetched on a plain Site route — it is NOT deferred");
else ok.push(`exportSheet is absent from the boot fetch set (${[...new Set(fetched)].join(", ")})`);

/* ---- 2. the File menu warms it -------------------------------------------------------- */
const fileBtn = page.getByRole("button", { name: /^File/ }).filter({ visible: true }).first();
await fileBtn.waitFor({ state: "visible", timeout: 20_000 });
await fileBtn.click();
await page.waitForTimeout(1500);
if (!fetched.includes("exportSheet")) fail.push("opening the File menu did NOT warm the exportSheet chunk — the first download would stall on a cold fetch");
else ok.push("opening the File menu warms the exportSheet chunk (no cold fetch on the download click)");

/* ---- 3. Export PNG downloads real bytes ----------------------------------------------- */
try {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 45_000 }),
    page.getByRole("button", { name: /^Export PNG$/ }).first().click(),
  ]);
  /* Assert the BYTES, not the suggested filename. Headless Chromium reports "download"
   * for a blob URL clicked from inside a canvas.toBlob() callback (the user-activation
   * context is gone by then, so it ignores the anchor's `download` name) — confirmed
   * identical on the pre-split build, so it is a harness artifact, not a regression. The
   * PNG magic number + a realistic size are the real proof the sheet rendered. */
  const path = await dl.path();
  const fs = await import("node:fs");
  const bytes = path ? fs.statSync(path).size : 0;
  const magic = path ? fs.readFileSync(path).subarray(0, 8).toString("hex") : "";
  if (magic !== "89504e470d0a1a0a") fail.push(`Export PNG produced a non-PNG payload (magic ${magic || "none"})`);
  else if (bytes < 50_000) fail.push(`Export PNG downloaded only ${bytes} bytes — the sheet is effectively empty`);
  else ok.push(`Export PNG downloaded a real PNG (${(bytes / 1024).toFixed(0)} KB)`);
} catch (e) {
  fail.push(`Export PNG never produced a download — ${String(e).split("\n")[0]}`);
}

/* ---- 4. print mode lays out a frame through the lazy chunk ----------------------------- */
try {
  await fileBtn.click();
  await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
  await page.waitForFunction(() => /PRINT FRAME/i.test(document.body.innerText), null, { timeout: 20_000 });
  const readFrame = () => page.evaluate(() => {
    const r = document.querySelector('[data-testid="print-frame"]');
    return r ? { w: +r.getAttribute("width"), h: +r.getAttribute("height") } : null;
  });
  const frame1 = await readFrame();
  if (!frame1 || !(frame1.w > 0 && frame1.h > 0)) fail.push("print mode opened but no print frame was laid out — the lazy plan-box aspect never resolved");
  else ok.push(`print mode laid out a frame (aspect ${(frame1.w / frame1.h).toFixed(3)}) via the lazy chunk`);

  /* ---- 5. the async aspect-refit path (Landscape → Portrait) -------------------------- */
  if (frame1) {
    await page.getByRole("button", { name: /^Portrait$/ }).first().click();
    await page.waitForTimeout(1200);
    const frame2 = await readFrame();
    const a1 = frame1.w / frame1.h, a2 = frame2 ? frame2.w / frame2.h : null;
    if (a2 == null) fail.push("switching to Portrait lost the print frame entirely");
    else if (!(a2 < a1)) fail.push(`switching to Portrait did not re-fit the frame (aspect ${a1.toFixed(3)} → ${a2.toFixed(3)}) — the async aspect refresh is not landing`);
    else ok.push(`Portrait re-fit the frame through the async aspect refresh (${a1.toFixed(3)} → ${a2.toFixed(3)})`);
  }
  /* ---- 6. the full PDF pipeline, end to end ------------------------------------------- */
  const [pdfDl] = await Promise.all([
    page.waitForEvent("download", { timeout: 90_000 }),
    page.getByRole("button", { name: /^Download PDF$/ }).first().click(),
  ]);
  const pdfPath = await pdfDl.path();
  const fs2 = await import("node:fs");
  const pdfBytes = pdfPath ? fs2.statSync(pdfPath).size : 0;
  const pdfMagic = pdfPath ? fs2.readFileSync(pdfPath).subarray(0, 5).toString("latin1") : "";
  if (pdfMagic !== "%PDF-") fail.push(`Download PDF produced a non-PDF payload (header "${pdfMagic}")`);
  else if (pdfBytes < 50_000) fail.push(`Download PDF produced only ${pdfBytes} bytes — the sheet is effectively empty`);
  else ok.push(`Download PDF produced a real PDF (${(pdfBytes / 1024).toFixed(0)} KB) through the full lazy pipeline`);
} catch (e) {
  fail.push(`print-frame / PDF path failed — ${String(e).split("\n")[0]}`);
}

/* An uncaught exception anywhere in the run means the ctx wiring dropped something. */
const realErrors = pageErrors.filter((e) => !/ERR_FAILED|ERR_ABORTED|Failed to fetch|NetworkError/i.test(e));
if (realErrors.length) fail.push(`uncaught page error(s): ${[...new Set(realErrors)].slice(0, 3).join(" | ")}`);
else ok.push("no uncaught page errors across the whole export run");

await browser.close();

console.log("B1042 — export path behind a dynamic import\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log();
console.log(fail.length ? `✗ ${fail.length} failure(s).` : "✓ The export path is deferred, warmed on menu open, and still exports.");
process.exit(fail.length ? 1 : 0);
