// B839 — verifies the export aerial's FAST PATH: stitching the source's cached XYZ tiles into a
// frame-exact backdrop, instead of the slow dynamic /export render that timed out under the 8s
// inline cap (the B738/V252 repro: Esri /export AbortError @ 8015ms → white sheet). This runs the
// REAL stitch DOM code from SitePlanner.jsx (fetchTileImage + stitchAerialDataUrl) end to end in
// headless Chromium against a LOCAL tile server that sends the SAME `Access-Control-Allow-Origin: *`
// Esri/USGS send — so the crossOrigin <img> loads canvas-clean and toDataURL never taints.
//
//   1) Happy path — all covering tiles served → a data:image/jpeg backdrop of the exact cropped
//      canvas size, mostly non-white + colour-varied (the imagery, not a blank sheet).
//   2) Strict-fail path — ONE tile 500s → the stitch returns null (so exportAerialForFrame falls
//      through to the alternate source / dynamic-/export fallback rather than a gappy exhibit).
//
// Why local tiles, not live Esri: the sandbox egress proxy resets headless Chromium's TLS tunnel
// to server.arcgisonline.com (curl over HTTP/1.1 gets through; the browser's does not). 127.0.0.1
// is in NO_PROXY, so a local tile server is a clean, deterministic stand-in with identical CORS
// semantics. The signed-out-safe live click-through on planyr.io is logged in VERIFICATION.md.
import { chromium } from "playwright";
import { createServer } from "http";
import { deflateSync } from "zlib";
import { aerialTileGrid, pickAerialTileZoom, feetExtentToBbox } from "../src/workspaces/site-planner/lib/arcgis.js";

/* ---- a tiny dependency-free 256×256 RGB PNG (a colourful raster, one per tile) ---- */
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function makeTilePng(seed) {
  const W = 256, H = 256;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y++) { raw[o++] = 0; for (let x = 0; x < W; x++) { raw[o++] = (x * 7 + seed * 13) & 255; raw[o++] = (y * 5 + seed * 29) & 255; raw[o++] = ((x + y) * 3 + seed * 53) & 255; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// A small Katy-area frame so the stitch grid is a handful of tiles (fast + deterministic).
const lat0 = 29.7858, lon0 = -95.8244;
const bbox = feetExtentToBbox({ minX: -400, minY: -400, maxX: 400, maxY: 400 }, lat0, lon0);
const maxNative = 19;
const z = pickAerialTileZoom(bbox, { maxNative, maxPx: 3072 });
const grid = aerialTileGrid(bbox, z);
console.log(`frame → tile stitch: z${z}, ${grid.tiles.length} tiles, canvas ${grid.canvasW}x${grid.canvasH}px`);

// One tile the "fail" run will 500 on (pick a middle tile so it's genuinely part of the cover set).
const failTile = grid.tiles[Math.floor(grid.tiles.length / 2)];

let failMode = false;
const server = createServer((req, res) => {
  // /tile/{z}/{y}/{x}.png
  res.setHeader("Cache-Control", "no-store"); // don't let the happy run's tiles satisfy the fail run
  const m = req.url.match(/\/tile\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) { res.statusCode = 404; res.end(); return; }
  const ty = Number(m[2]), tx = Number(m[3]);
  if (failMode && tx === failTile.x && ty === failTile.y) { res.statusCode = 500; res.end(); return; }
  res.setHeader("Access-Control-Allow-Origin", "*"); // exactly what Esri/USGS send
  res.setHeader("Content-Type", "image/png");
  res.end(makeTilePng((tx + ty) & 255));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const tilesTemplate = `http://127.0.0.1:${PORT}/tile/{z}/{y}/{x}`;

// The EXACT stitch DOM code from SitePlanner.jsx (fetchTileImage + stitchAerialDataUrl), the code
// under test — mirrored here the same way verify-aerial-export-cors.mjs mirrors inlineImages.
const STITCH = `
const AERIAL_TILE_TIMEOUT_MS = 8000;
const fetchTileImage = (url) => new Promise((resolve, reject) => {
  let tries = 0;
  const attempt = () => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const timer = setTimeout(() => { img.onload = img.onerror = null; img.src = ""; onFail(); }, AERIAL_TILE_TIMEOUT_MS);
    const onFail = () => { clearTimeout(timer); if (++tries <= 1) attempt(); else reject(new Error("tile load failed")); };
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = onFail;
    img.src = url;
  };
  attempt();
});
const stitchAerialDataUrl = async (bm, bbox, grid) => {
  try {
    const z = grid.z;
    if (!grid.tiles.length) return null;
    const loaded = await Promise.all(grid.tiles.map(async (t) => {
      const url = bm.tiles.replace("{z}", z).replace("{y}", t.y).replace("{x}", t.x);
      try { return { t, img: await fetchTileImage(url) }; } catch (_) { return { t, img: null }; }
    }));
    if (loaded.some((r) => !r.img)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = grid.canvasW; canvas.height = grid.canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (const { t, img } of loaded) ctx.drawImage(img, Math.round(t.dx), Math.round(t.dy), 256, 256);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (_) { return null; }
};
`;

const browser = await chromium.launch();
const page = await browser.newPage();
// Distinct query token per run so the happy run's cached tiles can't satisfy the fail run's
// injected 500 (headless Chromium keeps an aggressive in-memory image cache keyed by URL).
const bmHappy = { tiles: tilesTemplate + "?run=happy", maxNative };
const bmFail = { tiles: tilesTemplate + "?run=fail", maxNative };

// Analyse a stitched data URL: decode it back onto a canvas and measure non-white + colour variety.
const ANALYSE = `async (dataUrl) => {
  if (!dataUrl || !dataUrl.startsWith("data:image/jpeg")) return { ok: false, reason: "not a jpeg data url" };
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  let tainted = false, data;
  try { data = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { tainted = true; }
  if (tainted) return { ok: false, reason: "canvas tainted", w: img.width, h: img.height };
  let nonWhite = 0; const colors = new Set();
  for (let i = 0; i < data.length; i += 4 * 97) {
    const r = data[i], gg = data[i+1], b = data[i+2];
    if (!(r > 247 && gg > 247 && b > 247)) nonWhite++;
    colors.add((r >> 4) + "," + (gg >> 4) + "," + (b >> 4));
  }
  const total = Math.ceil(data.length / (4 * 97));
  return { ok: true, w: img.width, h: img.height, nonWhitePct: (100 * nonWhite / total), colorVariety: colors.size };
}`;

let allPass = true;

// 1) Happy path — every tile served.
failMode = false;
const happy = await page.evaluate(async ({ stitch, analyse, bm, bbox, grid }) => {
  const body = stitch + `\nreturn (async () => {
    const dataUrl = await stitchAerialDataUrl(bm, bbox, grid);
    const analysed = await (${analyse})(dataUrl);
    return { produced: !!dataUrl, isJpeg: !!dataUrl && dataUrl.startsWith("data:image/jpeg"), analysed };
  })();`;
  return new Function("bm", "bbox", "grid", body)(bm, bbox, grid);
}, { stitch: STITCH, analyse: ANALYSE, bm: bmHappy, bbox, grid });
const happyPass = happy.produced && happy.isJpeg && happy.analysed.ok
  && happy.analysed.w === grid.canvasW && happy.analysed.h === grid.canvasH
  && happy.analysed.nonWhitePct > 90 && happy.analysed.colorVariety > 20 && !happy.analysed.reason;
console.log(`\nHappy path (all tiles, CORS *):`);
console.log(`  produced=${happy.produced} jpeg=${happy.isJpeg} canvas=${happy.analysed.w}x${happy.analysed.h} (expected ${grid.canvasW}x${grid.canvasH})`);
console.log(`  non-white=${happy.analysed.nonWhitePct?.toFixed(1)}% colorVariety=${happy.analysed.colorVariety} tainted=${happy.analysed.reason === "canvas tainted"} → ${happyPass ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && happyPass;

// 2) Strict-fail path — one tile 500s → stitch must return null (triggers the fallback).
failMode = true;
const failed = await page.evaluate(async ({ stitch, bm, bbox, grid }) => {
  const body = stitch + `\nreturn (async () => ({ dataUrl: await stitchAerialDataUrl(bm, bbox, grid) }))();`;
  return new Function("bm", "bbox", "grid", body)(bm, bbox, grid);
}, { stitch: STITCH, bm: bmFail, bbox, grid });
const failPass = failed.dataUrl === null;
console.log(`\nStrict-fail path (one tile 500s → fall back):`);
console.log(`  stitch returned ${failed.dataUrl === null ? "null" : "a data URL"} → ${failPass ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && failPass;

await browser.close();
server.close();

console.log(`\n${allPass ? "ALL PASS ✅ — the tile-stitch backdrop is canvas-clean and strict-fails to the fallback" : "FAIL ❌"}`);
process.exit(allPass ? 0 : 1);
