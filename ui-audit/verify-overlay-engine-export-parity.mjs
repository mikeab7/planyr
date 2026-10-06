#!/usr/bin/env node
/* NEW-1 (one overlay engine) — EXPORT PARITY, MEASURED NOT ASSERTED.
 *
 * Seeds one plan with three placed Site-tab overlays that exercise the shared engine end to end —
 *   A  a legacy RECT crop with NO `kind` key (migrate-on-read) + rotation + a Y-scale
 *   B  a POLY crop + rotation
 *   C  no crop, rotated (control)
 * — drives the REAL print flow (File ▾ → Download PDF → Continue → Download PDF) and captures
 *   (1) the composed export SVG that becomes the PDF/PNG, and
 *   (2) the live canvas's overlay subtree (x/y/width/height, <clipPath>, rotate transform).
 * It prints a SHA-256 of each. Run it against a build from BEFORE the engine refactor and a build
 * from AFTER; the two hashes must match byte for byte. (KMZ: no overlay export path exists in
 * this app — kmlExport.js has no GroundOverlay — so there is nothing to compare; see the item.)
 *
 * Usage:  node ui-audit/verify-overlay-engine-export-parity.mjs <dist-dir> [--out file.json]
 *         (serves <dist-dir> itself; compare the two printed `exportSha`/`canvasSha` lines)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, extname, resolve } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const dist = resolve(process.argv[2] || "dist");
const outIdx = process.argv.indexOf("--out");
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".wasm": "application/wasm" };

const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let f = join(dist, p === "/" ? "index.html" : p);
  try { const b = await readFile(f); res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" }); res.end(b); }
  catch { try { const b = await readFile(join(dist, "index.html")); res.writeHead(200, { "content-type": "text/html" }); res.end(b); } catch { res.writeHead(404); res.end(); } }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const imgW = 800, imgH = 600;
const art = (label, fill) => `<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='800' height='600' fill='${fill}'/><circle cx='400' cy='300' r='200' fill='none' stroke='#222' stroke-width='12'/><text x='60' y='120' font-size='90' fill='#111'>${label}</text></svg>`;
const src = (l, c) => "data:image/svg+xml;utf8," + encodeURIComponent(art(l, c));
const ov = (id, extra) => ({ id, name: id + ".png", imgW, imgH, page: 1, pageCount: 1, opacity: 0.8, locked: false, detectedScale: null, sheet: null, ...extra });
const overlays = [
  ov("ovA", { src: src("A", "#cfe8ff"), ftPerPx: 0.5, ftPerPxY: 0.45, rotation: 17.5, x: -420, y: -200, crop: { x: 100, y: 80, w: 500, h: 380 } }),
  ov("ovB", { src: src("B", "#ffe9c7"), ftPerPx: 0.4, rotation: 301, x: 40, y: -120, crop: { kind: "poly", pts: [[60, 60], [700, 120], [640, 520], [200, 560]] } }),
  ov("ovC", { src: src("C", "#d8f5d0"), ftPerPx: 0.3, rotation: 90, x: -100, y: 120 }),
];
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -260 }, { x: 440, y: -260 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const site = { id: "ovparity", groupId: "ovparity", site: "Overlay Parity", name: "Plan 1", origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: overlays, parcelDrawings: [], updatedAt: 1700000000000, data: { status: "active" } };
const seed = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ovparity: ${JSON.stringify(site)} })); localStorage.setItem('planarfit:currentSite:v1', 'ovparity'); } catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => {
  window.__svgBlobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (o) => { try { if (o && o.type === "image/svg+xml") o.text().then((t) => window.__svgBlobs.push(t)).catch(() => {}); } catch (_) {} return orig(o); };
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-overlay-engine-export-parity");
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE + "#/site", { waitUntil: "load" });
await page.waitForTimeout(2500);
await page.getByText("Overlay Parity", { exact: true }).first().click({ timeout: 8000 });
await page.waitForSelector('image[data-overlay-image="1"]', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (_) {}
await page.waitForTimeout(800);

// (2) the live canvas overlay subtree — what the export clones.
const canvasHtml = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('image[data-overlay-image="1"]')];
  return imgs.map((i) => {
    const g = i.closest("g[transform]") || i.parentElement;
    const clip = g && g.querySelector("clipPath");
    return { id: i.getAttribute("data-overlay-id"), x: i.getAttribute("x"), y: i.getAttribute("y"), w: i.getAttribute("width"), h: i.getAttribute("height"),
      clipAttr: i.getAttribute("clip-path"), gTransform: g && g.getAttribute("transform"), clip: clip ? clip.innerHTML : null };
  }).sort((a, b) => a.id.localeCompare(b.id));
});

await page.screenshot({ path: process.env.SHOT || "/tmp/parity.png" });
// (1) the real print → export flow.
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
await page.getByRole("button", { name: /^Continue ➜$/ }).first().click({ timeout: 8000 });
await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20_000 });
await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
let sheet = "";
for (let i = 0; i < 160; i++) {
  await page.waitForTimeout(500);
  const blobs = await page.evaluate(() => window.__svgBlobs || []);
  sheet = blobs.find((t) => /data-overlay-id|ovA/.test(t)) || blobs.find((t) => /Site area/.test(t)) || "";
  if (sheet) break;
}
const sha = (s) => createHash("sha256").update(s).digest("hex");
// Only overlay-bearing markup is compared: the sheet also carries a timestamp/aerial that are not
// this change's business. Extract every <g>/<image>/<clipPath> that mentions an overlay id.
const overlayBits = (sheet.match(/<(?:image|clipPath|g)\b[^>]*(?:ovA|ovB|ovC|ov-crop)[^>]*>(?:<(?:rect|polygon)\b[^>]*\/?>(?:<\/(?:rect|polygon)>)?)?/g) || []);
const result = { canvas: canvasHtml, exportOverlayBits: overlayBits, exportBytes: sheet.length };
const canvasSha = sha(JSON.stringify(canvasHtml)), exportSha = sha(JSON.stringify(overlayBits)), fullSha = sha(sheet);
console.log("overlays on canvas:", canvasHtml.length, "| overlay nodes in export:", overlayBits.length, "| page errors:", errs.length ? errs.slice(0, 3) : "none");
console.log("canvasSha  " + canvasSha);
console.log("exportSha  " + exportSha);
console.log("fullSheetSha " + fullSha + "  (whole composed sheet; informational — includes aerial/date)");
if (outFile) await writeFile(outFile, JSON.stringify(result, null, 1));
await browser.close(); server.close();
const ok = canvasHtml.length === 3 && overlayBits.length >= 3 && !errs.length;
console.log(ok ? "CAPTURED ✅" : "FAIL ❌ — overlays did not render/export (void run)");
process.exit(ok ? 0 : 1);
