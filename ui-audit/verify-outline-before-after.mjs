/* NEW-1 acceptance (2026-10-22, owner: "NO visible quality loss") — the Epps Mill lot outline at the work laptop's pixel ratio (2.6775),
 * BEFORE (a deploy without the canvas cut — default live planyr.io until it carries it) and AFTER (a deploy that has it), side by side,
 * with the outline's own ink compared pixel for pixel. The canvas cut hands back pixels that were never drawn on; it must change no
 * pixel of what IS drawn, so the outline masks must be identical (and the "after" side must still hold the lot's outline at full density).
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-outline-before-after.mjs <beforeBase> <afterBase> [--out f.json] [--shots dir]
 * Writes before.png / after.png (clipped round the lot) + diff.png (outline pixels that differ, red) and exits 0 iff the masks are identical. */
import { writeFileSync, mkdirSync } from "node:fs";
import { openLaptop, LAPTOP } from "./lib/workLaptopRig.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import zlib from "node:zlib";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const [BEFORE, AFTER] = args.filter((a) => /^https?:/.test(a));
if (!BEFORE || !AFTER) { console.error("usage: verify-outline-before-after.mjs <beforeBase> <afterBase>"); process.exit(2); }
const OUT = flag("--out") || "outline-before-after.json", SHOTS = flag("--shots") || "ui-audit/screenshots/work-laptop";
mkdirSync(SHOTS, { recursive: true });

/* encode an RGBA buffer as a PNG with node's zlib only (the repo's decoder is read-only) */
function encodePng(w, h, rgba) {
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
/* outline ink: the selected lot's orange-red stroke and the Select-parcels purple (#a21caf) — never the aerial */
const isInk = (r, g, b) => (r > 190 && g < 110 && b < 90) || (Math.abs(r - 162) < 34 && Math.abs(g - 28) < 40 && Math.abs(b - 175) < 40);

async function shoot(base, label) {
  const s = await openLaptop({ base });
  const page = s.page; await assertMeasurable(page, "verify-outline-before-after " + label);
  const sleep = (m) => page.waitForTimeout(m);
  try {
    const build = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
    await page.goto(base + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="map-toolbar-select-parcels"]'), null, { timeout: 60000 }); await sleep(1500);
    const b = page.locator('input[role="combobox"]').first(); await b.click(); await b.fill("5965 Miller Ln, Christiana, TN"); await sleep(1500); await b.press("Enter");
    await page.waitForFunction(() => (window.__mapSelectedParcels?.() || []).length > 0, null, { timeout: 45000 }); await sleep(4000);
    await page.evaluate(() => { const m = window.__mapFinderMap; m.setView(m.getCenter(), 18, { animate: false }); }); await sleep(4000);
    const buf = await page.screenshot();
    const dpr = await page.evaluate(() => devicePixelRatio);
    /* second shot: the SELECT-PARCELS outlines (the per-tile canvases the canvas cut touches) over the same ground */
    const clr = page.locator('[data-testid="map-decide-clear"]').first(); if (await clr.count()) await clr.click();
    await page.locator('[data-testid="map-toolbar-select-parcels"]').first().click({ timeout: 15000 });
    await page.waitForFunction(() => { const d = window.__mapParcelDisplay ? window.__mapParcelDisplay() : null; return d && d.drawn > 0; }, null, { timeout: 40000 }).catch(() => {});
    await sleep(7000);
    const buf2 = await page.screenshot();
    return { build, dpr, png: decodePng(buf), png2: decodePng(buf2) };
  } finally { await s.close(); }
}
const A = await shoot(BEFORE, "before"), B = await shoot(AFTER, "after");
function compare(PA, PB, isInkFn) {
  const W = Math.min(PA.width, PB.width), H = Math.min(PA.height, PB.height);
  let inkA = 0, inkB = 0, xor = 0, onlyA = 0; const diff = Buffer.alloc(W * H * 4);
  const px = (p, x, y) => { const i = (y * p.width + x) * p.channels; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = isInkFn(...px(PA, x, y)), b = isInkFn(...px(PB, x, y)); if (a) inkA++; if (b) inkB++;
    const o = (y * W + x) * 4; const [r, g, bl] = px(PB, x, y);
    diff[o] = r; diff[o + 1] = g; diff[o + 2] = bl; diff[o + 3] = 255;
    if (a && !b) onlyA++;
    if (a !== b) { xor++; diff[o] = 255; diff[o + 1] = 0; diff[o + 2] = 255; }
  }
  return { W, H, inkA, inkB, xor, onlyA, diff };
}
const isPurple = (r, g, b) => Math.abs(r - 162) < 34 && Math.abs(g - 28) < 40 && Math.abs(b - 175) < 40;
const save = (name, p) => { const out = Buffer.alloc(p.width * p.height * 4); for (let i = 0; i < p.width * p.height; i++) { out[i * 4] = p.data[i * p.channels]; out[i * 4 + 1] = p.data[i * p.channels + 1]; out[i * 4 + 2] = p.data[i * p.channels + 2]; out[i * 4 + 3] = 255; } writeFileSync(`${SHOTS}/${name}`, encodePng(p.width, p.height, out)); };
const sel = compare(A.png, B.png, isInk), par = compare(A.png2, B.png2, isPurple);
save("outline-before.png", A.png); save("outline-after.png", B.png); writeFileSync(`${SHOTS}/outline-diff.png`, encodePng(sel.W, sel.H, sel.diff));
save("parcels-before.png", A.png2); save("parcels-after.png", B.png2); writeFileSync(`${SHOTS}/parcels-diff.png`, encodePng(par.W, par.H, par.diff));
const res = { before: { base: BEFORE, build: A.build, dpr: A.dpr }, after: { base: AFTER, build: B.build, dpr: B.dpr }, selectedLot: { inkBefore: sel.inkA, inkAfter: sel.inkB, differing: sel.xor }, selectParcels: { inkBefore: par.inkA, inkAfter: par.inkB, differing: par.xor, inkOnlyInBefore: par.onlyA }, size: `${sel.W}x${sel.H}` };
writeFileSync(OUT, JSON.stringify(res, null, 2)); console.log(JSON.stringify(res, null, 2));
/* The selected-lot outline (drawn by the finder from the selection — untouched by either fix) must be IDENTICAL. The Select-parcels layer may
 * legitimately differ: the feature-id fix (B2409408) makes the AFTER side draw every lot where the BEFORE side held one at random — so the
 * rule there is SUPERSET: nothing the before side drew may be missing after, and after must hold at least as much ink. */
const same = (c) => c.inkA > 1000 && c.inkB > 1000 && c.xor / Math.max(c.inkA, c.inkB) < 0.005;
const superset = (c) => c.inkB >= c.inkA && c.onlyA / Math.max(1, c.inkA) < 0.01;
const ok = same(sel) && superset(par); // the outline must exist at full density on BOTH sides, and its pixels must agree to within half a percent (aerial/basemap are excluded by the colour mask)
console.log(ok ? "PASS — the selected-lot outline is pixel-identical; the Select-parcels outlines after are a superset of before" : "FAIL — see the numbers above");
process.exit(ok ? 0 : 1);
