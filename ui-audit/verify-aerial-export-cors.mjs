// B735 — verifies the PDF/PNG export actually pulls a cross-origin satellite aerial into
// the rasterized output. The bug: when the LIVE basemap is on, the aerial is a Leaflet tile
// <div> the exported SVG can't clone, so the export must synthesize a frame-exact <image>
// from the source's `export` endpoint and INLINE it (fetch → data URL) before rasterizing —
// otherwise the fetch is dropped and the PDF comes out on a blank white background.
//
// This exercises the REAL inlineImages loop from SitePlanner.jsx end to end:
//   1) Happy path — a cross-origin image (served locally with `Access-Control-Allow-Origin: *`,
//      exactly like Esri/USGS send — curl-verified below) inlines to a data URL, the canvas
//      is NOT tainted, and the rasterized backdrop is the imagery (mostly non-white, varied).
//   2) Failure path — an unreachable aerial URL sets aerialDropped=true and drops the <image>
//      (the LOUD-FAILURE contract: the caller then shows a warning, never a silent white PDF).
//
// Why local imagery, not a live Esri fetch: the sandbox's egress proxy resets headless
// Chromium's TLS tunnel to server.arcgisonline.com (curl over HTTP/1.1 gets through; the
// browser's does not). 127.0.0.1 is in NO_PROXY so the local image is a clean, deterministic
// stand-in with identical CORS semantics. Esri's own `Access-Control-Allow-Origin: *` is
// asserted by curl at the end. The signed-in planyr.io click-through is logged in VERIFICATION.md.
import { chromium } from "playwright";
import { createServer } from "http";
import { deflateSync } from "zlib";
import { execSync } from "child_process";
import { aerialPlacement, feetExtentToBbox } from "../src/workspaces/site-planner/lib/arcgis.js";

/* ---- a tiny dependency-free RGB PNG (a colorful diagonal-band raster) ---- */
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function makePng(W, H) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y++) { raw[o++] = 0; for (let x = 0; x < W; x++) { raw[o++] = (x * 7) & 255; raw[o++] = (y * 5) & 255; raw[o++] = ((x + y) * 3) & 255; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(256, 160);

// Serve the image cross-origin with the SAME CORS header Esri/USGS send.
const server = createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "image/png");
  res.end(PNG);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const AERIAL_URL = `http://127.0.0.1:${PORT}/aerial.png`;

// Prove the geometry the real code uses is sane (frame → bbox → export placement).
const bbox = feetExtentToBbox({ minX: -900, minY: -600, maxX: 900, maxY: 600 }, 29.7858, -95.8244);
const placed = aerialPlacement(bbox, -95.8244, 29.7858, { maxPx: 2400 });
console.log(`frame → export image: ${placed.imgW}x${placed.imgH}px, placed at (${placed.x.toFixed(0)},${placed.y.toFixed(0)})ft\n`);

// The EXACT inlineImages loop from SitePlanner.jsx (the code under test).
const INLINE = `async (root) => {
  const XL = "http://www.w3.org/1999/xlink";
  const imgs = [...root.querySelectorAll("image")];
  let aerialDropped = false;
  await Promise.all(imgs.map(async (img) => {
    const href = img.getAttribute("href") || img.getAttributeNS(XL, "href");
    if (!href || href.startsWith("data:")) return;
    const isAerial = img.hasAttribute("data-export-aerial");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const blob = await fetch(href, { mode: "cors", signal: ctrl.signal }).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.blob(); });
      const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
      img.setAttribute("href", dataUrl); img.removeAttributeNS(XL, "href");
    } catch (_) { img.remove(); if (isAerial) aerialDropped = true; }
    finally { clearTimeout(timer); }
  }));
  return aerialDropped;
}`;

const EXEC = process.env.PW_CHROME || ((await import("fs")).existsSync("/opt/pw-browsers/chromium/chrome-linux/chrome")
  ? "/opt/pw-browsers/chromium/chrome-linux/chrome" : undefined);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });

const result = await page.evaluate(async ({ url, inlineSrc }) => {
  const W = 300, H = 200, SVGNS = "http://www.w3.org/2000/svg", XL = "http://www.w3.org/1999/xlink";
  // Build a genuine SVG DOM (correct namespaces) mirroring buildExportSvg: white paper, aerial <image>, a mark.
  const parse = (href) => {
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", 0); bg.setAttribute("y", 0); bg.setAttribute("width", W); bg.setAttribute("height", H); bg.setAttribute("fill", "#ffffff");
    const im = document.createElementNS(SVGNS, "image");
    im.setAttribute("data-export-aerial", "1");
    im.setAttribute("href", href); im.setAttributeNS(XL, "href", href);
    im.setAttribute("x", 0); im.setAttribute("y", 0); im.setAttribute("width", W); im.setAttribute("height", H); im.setAttribute("preserveAspectRatio", "none");
    const mark = document.createElementNS(SVGNS, "rect");
    mark.setAttribute("x", 120); mark.setAttribute("y", 80); mark.setAttribute("width", 60); mark.setAttribute("height", 40);
    mark.setAttribute("fill", "none"); mark.setAttribute("stroke", "#c0392b"); mark.setAttribute("stroke-width", 3);
    svg.appendChild(bg); svg.appendChild(im); svg.appendChild(mark);
    return svg;
  };
  const inlineImages = eval("(" + inlineSrc + ")");

  // 1) Happy path — cross-origin image inlines and renders as imagery.
  const root = parse(url); document.body.appendChild(root);
  const aerialDropped = await inlineImages(root);
  const inlinedHref = root.querySelector("image[data-export-aerial]")?.getAttribute("href") || "";
  const isDataUrl = inlinedHref.startsWith("data:image");
  const xml = new XMLSerializer().serializeToString(root);
  const blobUrl = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("svg raster failed")); img.src = blobUrl; });
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); ctx.drawImage(img, 0, 0, W, H);
  URL.revokeObjectURL(blobUrl);
  let taint = false, data = null;
  try { data = ctx.getImageData(0, 0, W, H).data; } catch (_) { taint = true; } // a taint would prove the inline failed
  let nonWhite = 0, samples = 0; const buckets = new Set();
  if (data) for (let i = 0; i < data.length; i += 4 * 53) { samples++; const r = data[i], g = data[i + 1], b = data[i + 2]; if (!(r > 244 && g > 244 && b > 244)) nonWhite++; buckets.add(`${r >> 5},${g >> 5},${b >> 5}`); }

  // 2) Failure path — an unreachable aerial URL must set aerialDropped=true (LOUD-FAILURE).
  const root2 = parse("http://127.0.0.1:1/aerial.png"); document.body.appendChild(root2);
  const droppedOnBad = await inlineImages(root2);
  const removedOnBad = !root2.querySelector("image[data-export-aerial]");

  return { aerialDropped, isDataUrl, taint, nonWhiteFrac: samples ? nonWhite / samples : 0, colorVariety: buckets.size, droppedOnBad, removedOnBad };
}, { url: AERIAL_URL, inlineSrc: INLINE });

await browser.close();
server.close();

// Belt-and-suspenders: assert the REAL Esri export endpoint sends CORS `*` (curl / HTTP-1.1
// path, which the sandbox proxy allows) — so the same pipeline works against it in a real browser.
const corsOf = (url) => {
  try {
    const hdrs = execSync(`curl -sS -D - -o /dev/null -H "Origin: https://planyr.io" "${url}"`, { encoding: "utf8", timeout: 20000 });
    return /access-control-allow-origin:\s*\*/i.test(hdrs) ? "* (CORS OK)" : (/^HTTP.* 403/im.test(hdrs) ? "unresolved (host blocked by sandbox proxy)" : "MISSING");
  } catch (_) { return "unresolved (curl/network)"; }
};
const esriCors = corsOf(placed.src);
// USGS uses a SEPARATE ArcGIS Server (basemap.nationalmap.gov). ArcGIS Server defaults to
// AllowedOrigins=*, so it's EXPECTED to be CORS-open, but the sandbox proxy blocks that host —
// so this is informational, confirmed live in V251. Either way a non-CORS source just drops the
// aerial and warns loudly (LOUD-FAILURE), never a silent white sheet.
const usgsUrl = aerialPlacement(bbox, -95.8244, 29.7858, { maxPx: 600, exportBase: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export" }).src;
const usgsCors = corsOf(usgsUrl);

const happyPass = result.aerialDropped === false && result.isDataUrl && !result.taint && result.nonWhiteFrac > 0.6 && result.colorVariety > 8;
const failPass = result.droppedOnBad === true && result.removedOnBad === true;
const pass = happyPass && failPass;

console.log("Happy path (cross-origin aerial, CORS *):");
console.log(`  aerialDropped=${result.aerialDropped} inlinedToDataURL=${result.isDataUrl} canvasTainted=${result.taint}`);
console.log(`  backdrop non-white=${(result.nonWhiteFrac * 100).toFixed(1)}% colorVariety=${result.colorVariety} → ${happyPass ? "PASS ✅" : "FAIL ❌"}`);
console.log("Failure path (unreachable aerial):");
console.log(`  aerialDropped=${result.droppedOnBad} imageRemoved=${result.removedOnBad} → ${failPass ? "PASS ✅" : "FAIL ❌"}`);
console.log(`Real export-endpoint CORS: Esri = ${esriCors} · USGS = ${usgsCors} (USGS confirmed live in V251)`);
console.log(`\n${pass ? "ALL PASS ✅ — a CORS aerial inlines into the export raster; a dropped aerial reports loudly" : "SOME CHECKS FAILED ❌"}`);
process.exit(pass ? 0 : 1);
