// B839 base stitch + B550512 budget-driven sharpen — verifies the export aerial's fast path end
// to end in headless Chromium against a LOCAL tile server (same CORS shape Esri/USGS send), running
// the REAL stitch code from exportSheet.js (fetchTileImage / fetchTileImageByDeadline /
// stitchAerialDataUrl), mirrored inline the same way this file always has (page.evaluate can't
// import the source tree directly).
//
//   1) Happy path, already at the source's native ceiling — the sharpen pass is a no-op
//      (deepenZoomFor → null), zero extra tiles requested, output = the base stitch.
//   2) Happy path, headroom exists + the deeper tiles arrive well inside budget — output jumps to
//      the DEEPER grid's canvas size (measurably sharper), added wall-clock is small.
//   3) Headroom exists but every deeper tile is slower than the budget — output stays at the BASE
//      canvas size (never a hole, never upscale-and-hope), and the call returns close to the
//      budget, never anywhere near the tiles' own (much longer) response time. This is the
//      "never block export on a round trip that hasn't returned" proof.
//   4) Mixed: half the deeper tiles are fast, half are slow — output is the SHARPER canvas size,
//      and the composited image carries BOTH the deep-tile marker colour (where one arrived) and
//      the base-tile colour (upscaled, where one didn't) — the literal "composite whatever
//      arrived and fall back to the current tile for anything that did not" behaviour.
//   5) Strict-fail path, unchanged: one BASE tile 500s → stitch returns null (triggers the
//      alternate-source / dynamic-/export fallback), regardless of the sharpen pass.
//
// Why local tiles, not live Esri: the sandbox egress proxy resets headless Chromium's TLS tunnel
// to server.arcgisonline.com (curl over HTTP/1.1 gets through; the browser's does not). 127.0.0.1
// is in NO_PROXY, so a local tile server is a clean, deterministic stand-in with identical CORS
// semantics. The signed-out-safe live click-through on planyr.io is logged in VERIFICATION.md.
//
// ⛔ THE SERVER SPEAKS HTTP/2, NOT HTTP/1.1 — measured, not assumed. A plain `http.createServer`
// mock capped this harness's own read of the sharpen pass: Chromium enforces ~6 concurrent
// connections PER ORIGIN over HTTP/1.1, so firing 240 deepen-tile requests queued behind that cap
// and starved the whole scenario regardless of server speed (240 concurrent Image loads measured
// at ~1.7s on bare loopback, purely from connection queuing — not from anything this fix does).
// Esri's tiles are served through CloudFront, which negotiates HTTP/2 (h2) with every real browser
// by default; only THIS SANDBOX's TLS-inspecting egress proxy forces the http/1.1 fallback curl
// observed earlier, and that is a property of the sandbox, not of a user's browser. An HTTP/2
// origin multiplexes hundreds of concurrent streams over one connection, so it does not reproduce
// the artificial 6-way bottleneck — testing against one is what makes this harness's wall-clock
// numbers meaningful rather than an artifact of the test's own transport choice.
import { chromium } from "playwright";
import { createSecureServer } from "http2";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { deflateSync } from "zlib";
import { aerialTileGrid, pickAerialTileZoom, deepenZoomFor, feetExtentToBbox } from "../src/workspaces/site-planner/lib/arcgis.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";

// A throwaway self-signed cert for 127.0.0.1, generated fresh each run (openssl is present in
// every environment this harness runs in — same assumption the repo's other TLS-needing harnesses
// make). Chromium is launched with --ignore-certificate-errors to trust it (verify-export-quality.mjs
// precedent).
const certDir = mkdtempSync(path.join(tmpdir(), "aerial-h2-"));
const keyPath = path.join(certDir, "key.pem"), certPath = path.join(certDir, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
  "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
const tlsKey = readFileSync(keyPath), tlsCert = readFileSync(certPath);

/* ---- a tiny dependency-free 256×256 RGB PNG (a colourful raster, one per tile) ---- */
const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
// `marker` distinguishes a BASE-zoom tile (a blue/green gradient, seed-varied) from a DEEPEN-zoom
// tile (a hot-magenta gradient) so the composited output can be read back and attributed by colour.
function makeTilePng(seed, marker = "base") {
  const W = 256, H = 256;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  let o = 0;
  for (let y = 0; y < H; y++) {
    raw[o++] = 0;
    for (let x = 0; x < W; x++) {
      if (marker === "deepen") { raw[o++] = 230; raw[o++] = (x * 3 + seed * 11) & 63; raw[o++] = 220; } // hot magenta family
      else { raw[o++] = (x * 7 + seed * 13) & 255; raw[o++] = (y * 5 + seed * 29) & 255; raw[o++] = ((x + y) * 3 + seed * 53) & 255; }
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const lat0 = 29.7858, lon0 = -95.8244; // Katy area, the app's home turf
const maxNative = 19;

// Two frames: SMALL already sits at the native ceiling (no headroom — proves the zero-cost path);
// LARGE is a realistic big-tract frame where the base pick backs off from z19, so headroom exists.
const smallBbox = feetExtentToBbox({ minX: -150, minY: -150, maxX: 150, maxY: 150 }, lat0, lon0);
const largeBbox = feetExtentToBbox({ minX: -1600, minY: -1600, maxX: 1600, maxY: 1600 }, lat0, lon0);

const smallZ = pickAerialTileZoom(smallBbox, { maxNative, maxPx: 3072 });
const smallGrid = aerialTileGrid(smallBbox, smallZ);
const smallDeepenZ = deepenZoomFor(smallZ, maxNative);

const largeZ = pickAerialTileZoom(largeBbox, { maxNative, maxPx: 3072 });
const largeGrid = aerialTileGrid(largeBbox, largeZ);
const largeDeepenZ = deepenZoomFor(largeZ, maxNative);
const largeDeepenGrid = aerialTileGrid(largeBbox, largeDeepenZ);

console.log(`small frame (300ft): base z${smallZ} ${smallGrid.tiles.length} tiles ${smallGrid.canvasW}x${smallGrid.canvasH} | deepenZ=${smallDeepenZ ?? "none (already at ceiling)"}`);
console.log(`large frame (3200ft): base z${largeZ} ${largeGrid.tiles.length} tiles ${largeGrid.canvasW}x${largeGrid.canvasH} | deepen z${largeDeepenZ} ${largeDeepenGrid.tiles.length} tiles ${largeDeepenGrid.canvasW}x${largeDeepenGrid.canvasH}`);
if (smallDeepenZ !== null) throw new Error("fixture regression: the small frame must already be at the native ceiling (deepenZoomFor should return null)");
if (!(largeDeepenZ > largeZ)) throw new Error("fixture regression: the large frame must have deepen headroom");

// failTile (STRICT base path) + a SLOW/FAST split of the deepen grid for the mixed scenario.
const failTile = largeGrid.tiles[Math.floor(largeGrid.tiles.length / 2)];
const slowDeepenTiles = new Set(largeDeepenGrid.tiles.filter((_, i) => i % 2 === 0).map((t) => `${t.x},${t.y}`));

let mode = "happy"; // "happy" | "fail-base" | "slow-deepen" | "mixed-deepen"
const SLOW_MS = 3000; // deliberately far past the budget
const server = createSecureServer({ key: tlsKey, cert: tlsCert }, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const m = req.url.match(/\/tile\/(\d+)\/(\d+)\/(\d+)\?run=([\w-]+)/);
  if (!m) { res.statusCode = 404; res.end(); return; }
  const [, zs, ys, xs, run] = m;
  const z = Number(zs), ty = Number(ys), tx = Number(xs);
  // Classify base vs. deepen by which RUN this request belongs to, not the raw zoom number — the
  // small frame's base zoom (19) and the large frame's deepen zoom (19) coincide numerically, so a
  // bare `z === largeDeepenZ` check would mislabel the small-frame scenario's own base tiles.
  const isDeepenLevel = run !== "small-ceiling" && z === largeDeepenZ;
  const respond = () => {
    if (mode === "fail-base" && z === largeZ && tx === failTile.x && ty === failTile.y) { res.statusCode = 500; res.end(); return; }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "image/png");
    res.end(makeTilePng((tx + ty) & 255, isDeepenLevel ? "deepen" : "base"));
  };
  if (isDeepenLevel && mode === "slow-deepen") { setTimeout(respond, SLOW_MS); return; }
  if (isDeepenLevel && mode === "mixed-deepen" && slowDeepenTiles.has(`${tx},${ty}`)) { setTimeout(respond, SLOW_MS); return; }
  respond();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const tilesTemplate = (run) => `https://127.0.0.1:${PORT}/tile/{z}/{y}/{x}?run=${run}`; // distinct token per run defeats Chromium's in-memory image cache across scenarios

// The EXACT stitch DOM code from exportSheet.js (fetchTileImage / fetchTileImageByDeadline /
// stitchAerialDataUrl), the code under test.
const STITCH = `
const AERIAL_TILE_TIMEOUT_MS = 8000;
const AERIAL_DEEPEN_BUDGET_MS = 1000;
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
const fetchTileImageByDeadline = (url, deadline) => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.fetchPriority = "low";
  let done = false;
  const finish = (result) => { if (done) return; done = true; clearTimeout(timer); img.onload = img.onerror = null; resolve(result); };
  const timer = setTimeout(() => { img.src = ""; finish(null); }, Math.max(0, deadline - Date.now()));
  img.onload = () => finish(img);
  img.onerror = () => finish(null);
  img.src = url;
});
const DEEPEN_CONCURRENCY = 24;
const mapWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => { while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
};
const stitchAerialDataUrl = async (bm, bbox, grid, deepenZ, deepenGrid) => {
  try {
    const z = grid.z;
    if (!grid.tiles.length) return null;
    const loadedPromise = Promise.all(grid.tiles.map(async (t) => {
      const url = bm.tiles.replace("{z}", z).replace("{y}", t.y).replace("{x}", t.x);
      try { return { t, img: await fetchTileImage(url) }; } catch (_) { return { t, img: null }; }
    }));
    const deepenDeadline = Date.now() + AERIAL_DEEPEN_BUDGET_MS;
    const sharpPromise = deepenGrid && deepenGrid.tiles.length
      ? mapWithConcurrency(deepenGrid.tiles, DEEPEN_CONCURRENCY, async (t) => {
          const url = bm.tiles.replace("{z}", deepenZ).replace("{y}", t.y).replace("{x}", t.x);
          const img = await fetchTileImageByDeadline(url, deepenDeadline);
          return img ? { t, img } : null;
        })
      : null;
    const loaded = await loadedPromise;
    if (loaded.some((r) => !r.img)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = grid.canvasW; canvas.height = grid.canvasH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (const { t, img } of loaded) ctx.drawImage(img, Math.round(t.dx), Math.round(t.dy), 256, 256);
    if (sharpPromise) {
      const arrived = (await sharpPromise).filter(Boolean);
      if (arrived.length) {
        const sc = document.createElement("canvas");
        sc.width = deepenGrid.canvasW; sc.height = deepenGrid.canvasH;
        const sctx = sc.getContext("2d");
        if (sctx) {
          sctx.drawImage(canvas, 0, 0, sc.width, sc.height);
          for (const { t, img } of arrived) sctx.drawImage(img, Math.round(t.dx), Math.round(t.dy), 256, 256);
          return sc.toDataURL("image/jpeg", 0.92);
        }
      }
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch (_) { return null; }
};
`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();
/* ⛔ FOREGROUND-OR-VOID: a background tab clamps setTimeout and suspends rAF, so a wall-clock
   reading from one is void — see ui-audit/lib/tabTiming.mjs. This harness measures wall-clock
   (scenarios 2/3), so the precondition applies to every scenario, not just the timed ones. */
await assertMeasurable(page, "verify-aerial-tile-stitch");

const ANALYSE = `async (dataUrl) => {
  if (!dataUrl || !dataUrl.startsWith("data:image/jpeg")) return { ok: false, reason: "not a jpeg data url" };
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const g = c.getContext("2d"); g.drawImage(img, 0, 0);
  let tainted = false, data;
  try { data = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { tainted = true; }
  if (tainted) return { ok: false, reason: "canvas tainted", w: img.width, h: img.height };
  let nonWhite = 0, magenta = 0; const colors = new Set();
  const total = Math.ceil(data.length / (4 * 97));
  for (let i = 0; i < data.length; i += 4 * 97) {
    const r = data[i], gg = data[i+1], b = data[i+2];
    if (!(r > 247 && gg > 247 && b > 247)) nonWhite++;
    if (r > 190 && b > 190 && gg < 100) magenta++; // the deepen-tile marker colour
    colors.add((r >> 4) + "," + (gg >> 4) + "," + (b >> 4));
  }
  return { ok: true, w: img.width, h: img.height, nonWhitePct: (100 * nonWhite / total), magentaPct: (100 * magenta / total), colorVariety: colors.size };
}`;

const runStitch = async (_run, { bm, bbox, grid, deepenZ, deepenGrid }) => page.evaluate(async ({ stitch, analyse, bm, bbox, grid, deepenZ, deepenGrid }) => {
  const body = stitch + `\nreturn (async () => {
    const t0 = performance.now();
    const dataUrl = await stitchAerialDataUrl(bm, bbox, grid, deepenZ, deepenGrid);
    const ms = performance.now() - t0;
    const analysed = await (${analyse})(dataUrl);
    return { produced: !!dataUrl, isJpeg: !!dataUrl && dataUrl.startsWith("data:image/jpeg"), analysed, ms };
  })();`;
  return new Function("bm", "bbox", "grid", "deepenZ", "deepenGrid", body)(bm, bbox, grid, deepenZ, deepenGrid);
}, { stitch: STITCH, analyse: ANALYSE, bm, bbox, grid, deepenZ, deepenGrid });

let allPass = true;
const results = [];

// 1) Already at the native ceiling — sharpen is a no-op (deepenZ is null → no extra requests).
mode = "happy";
const bmSmall = { tiles: tilesTemplate("small-ceiling"), maxNative };
const r1 = await runStitch("small-ceiling", { bm: bmSmall, bbox: smallBbox, grid: smallGrid, deepenZ: null, deepenGrid: null });
const pass1 = r1.produced && r1.analysed.ok && r1.analysed.w === smallGrid.canvasW && r1.analysed.h === smallGrid.canvasH;
console.log(`\n1) Already at native ceiling (no headroom): canvas=${r1.analysed.w}x${r1.analysed.h} (expected ${smallGrid.canvasW}x${smallGrid.canvasH}), ${r1.ms.toFixed(0)}ms → ${pass1 ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && pass1; results.push({ scenario: "already-at-ceiling", ms: r1.ms, w: r1.analysed.w, h: r1.analysed.h });

// 2) Headroom + fast deepen tiles (well inside budget) → sharper canvas.
mode = "happy";
const bmLarge = { tiles: tilesTemplate("large-fast"), maxNative };
const r2 = await runStitch("large-fast", { bm: bmLarge, bbox: largeBbox, grid: largeGrid, deepenZ: largeDeepenZ, deepenGrid: largeDeepenGrid });
const pass2 = r2.produced && r2.analysed.ok && r2.analysed.w === largeDeepenGrid.canvasW && r2.analysed.h === largeDeepenGrid.canvasH && r2.analysed.magentaPct > 50;
console.log(`2) Headroom + fast deepen tiles: canvas=${r2.analysed.w}x${r2.analysed.h} (expected the SHARPER ${largeDeepenGrid.canvasW}x${largeDeepenGrid.canvasH}), magenta(deepen-marker)=${r2.analysed.magentaPct.toFixed(1)}%, ${r2.ms.toFixed(0)}ms → ${pass2 ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && pass2; results.push({ scenario: "headroom-fast-deepen", ms: r2.ms, w: r2.analysed.w, h: r2.analysed.h });

// 3) Headroom exists but every deepen tile is far slower than the budget → falls back to the BASE
//    canvas size (never a stall — the call returns near the ~1000ms budget, nowhere near SLOW_MS).
mode = "slow-deepen";
const bmSlow = { tiles: tilesTemplate("large-slow"), maxNative };
const r3 = await runStitch("large-slow", { bm: bmSlow, bbox: largeBbox, grid: largeGrid, deepenZ: largeDeepenZ, deepenGrid: largeDeepenGrid });
const pass3 = r3.produced && r3.analysed.ok && r3.analysed.w === largeGrid.canvasW && r3.analysed.h === largeGrid.canvasH && r3.ms < SLOW_MS * 0.6;
console.log(`3) Headroom but deepen tiles all slow (${SLOW_MS}ms): canvas=${r3.analysed.w}x${r3.analysed.h} (expected the BASE ${largeGrid.canvasW}x${largeGrid.canvasH} — never stalls), ${r3.ms.toFixed(0)}ms (budget ~1000ms, must stay well under ${SLOW_MS}ms) → ${pass3 ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && pass3; results.push({ scenario: "headroom-slow-deepen", ms: r3.ms, w: r3.analysed.w, h: r3.analysed.h });

// 4) Mixed: half the deepen tiles fast, half slow (an ADVERSARIAL checkerboard interleave — a real
//    connection is far more likely to be broadly fast or broadly slow than to alternate tile by
//    tile, so this is a worst case, not the expected case) → sharper canvas, and the picture
//    carries BOTH the deepen marker colour (arrived tiles) and the base colour (fell back,
//    upscaled). Timing gets a looser ceiling than scenario 3's clean cutoff — the interleave means
//    some lanes legitimately restart a second tile just as the deadline closes — but it must still
//    be bounded, not open-ended.
mode = "mixed-deepen";
const bmMixed = { tiles: tilesTemplate("large-mixed"), maxNative };
const r4 = await runStitch("large-mixed", { bm: bmMixed, bbox: largeBbox, grid: largeGrid, deepenZ: largeDeepenZ, deepenGrid: largeDeepenGrid });
const pass4 = r4.produced && r4.analysed.ok && r4.analysed.w === largeDeepenGrid.canvasW && r4.analysed.h === largeDeepenGrid.canvasH && r4.analysed.magentaPct > 3 && r4.analysed.magentaPct < 97 && r4.ms < SLOW_MS * 0.85;
console.log(`4) Mixed fast/slow deepen tiles: canvas=${r4.analysed.w}x${r4.analysed.h} (expected the SHARPER size), magenta(arrived)=${r4.analysed.magentaPct.toFixed(1)}% (expect a partial share, not 0% or ~100%), ${r4.ms.toFixed(0)}ms (must stay bounded, well under ${SLOW_MS}ms) → ${pass4 ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && pass4; results.push({ scenario: "mixed-deepen", ms: r4.ms, w: r4.analysed.w, h: r4.analysed.h });

// 5) Strict-fail path, unchanged: one BASE tile 500s → stitch returns null.
mode = "fail-base";
const bmFail = { tiles: tilesTemplate("fail-base"), maxNative };
const r5 = await page.evaluate(async ({ stitch, bm, bbox, grid, deepenZ, deepenGrid }) => {
  const body = stitch + `\nreturn (async () => ({ dataUrl: await stitchAerialDataUrl(bm, bbox, grid, deepenZ, deepenGrid) }))();`;
  return new Function("bm", "bbox", "grid", "deepenZ", "deepenGrid", body)(bm, bbox, grid, deepenZ, deepenGrid);
}, { stitch: STITCH, bm: bmFail, bbox: largeBbox, grid: largeGrid, deepenZ: largeDeepenZ, deepenGrid: largeDeepenGrid });
const pass5 = r5.dataUrl === null;
console.log(`5) Strict-fail (one BASE tile 500s): stitch returned ${r5.dataUrl === null ? "null" : "a data URL"} → ${pass5 ? "PASS ✅" : "FAIL ❌"}`);
allPass = allPass && pass5;

await browser.close();
server.close();
rmSync(certDir, { recursive: true, force: true });

console.log(`\n── resolution proof (device px per source px equivalent) ──`);
console.log(`before (base only, current shipped behaviour on a large frame): ${largeGrid.canvasW}x${largeGrid.canvasH} covering the same ground as after`);
console.log(`after  (budget-driven sharpen engaged):                          ${r2.analysed.w}x${r2.analysed.h}  (${(r2.analysed.w / largeGrid.canvasW).toFixed(2)}x linear resolution gain)`);
console.log(`\n${allPass ? "ALL PASS ✅ — base stitch unchanged; sharpen pass improves resolution when it can, never stalls past budget, never regresses when it can't" : "FAIL ❌"}`);
process.exit(allPass ? 0 : 1);
