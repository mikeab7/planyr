/* Brand raster generator — turns the canonical favicon SVG into the raster icon
 * set the browser/OS need, and copies the source SVGs into the deploy folder.
 *
 *   node brand/generate-icons.mjs
 *
 * Inputs  (source of record, this folder):
 *   brand/planyr-favicon.svg   — simplified solid coral stack on a dark tile (small use)
 *   brand/planyr-mark.svg      — full-finish display mark (large use)
 *
 * Outputs (committed into public/, served at the site root):
 *   public/favicon.svg         — copy of the simplified mark (scalable favicon)
 *   public/planyr-mark.svg     — copy of the full-finish display mark
 *   public/favicon.ico         — 16/32/48 multi-size (PNG-embedded) for legacy tabs
 *   public/apple-touch-icon.png— 180x180 home-screen icon (iOS), dark full-bleed tile
 *
 * No npm dependency: we rasterize by driving the Chromium binary the web sandbox
 * already ships (same one ui-audit uses) with --screenshot. Chromium's headless
 * screenshot honours the window WIDTH but caps the usable HEIGHT (~85px overhead),
 * so we render onto a deliberately tall canvas and crop the exact square out of the
 * top-left. PNG encode/decode is hand-rolled (zlib only) to keep this dependency-free.
 * Re-run whenever the artwork changes, then commit public/.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import zlib from "node:zlib";

const ROOT = new URL("..", import.meta.url).pathname;
const BRAND = join(ROOT, "brand");
const PUBLIC = join(ROOT, "public");

// ── Chromium ────────────────────────────────────────────────────────────────
function findChrome() {
  if (process.env.PW_CHROME && existsSync(process.env.PW_CHROME)) return process.env.PW_CHROME;
  const base = "/opt/pw-browsers";
  const revs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("chromium-")).sort() : [];
  for (const r of revs.reverse()) {
    const p = join(base, r, "chrome-linux", "chrome");
    if (existsSync(p)) return p;
  }
  throw new Error("No Chromium binary found; set PW_CHROME to a chrome executable.");
}
const CHROME = findChrome();
const TMP = mkdtempSync(join(tmpdir(), "planyr-icons-"));

// ── minimal PNG codec (8-bit, no interlace) ──────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
function decodePng(b) {
  let p = 8, w, h, ct; const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString("ascii", p + 4, p + 8); const d = b.slice(p + 8, p + 8 + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; }
    else if (type === "IDAT") idat.push(d); else if (type === "IEND") break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : 3; const stride = w * ch;
  const out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const row = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride); const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, bb = prev[i], c = i >= ch ? prev[i - ch] : 0; let v = row[i];
      if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) { const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? bb : c; }
      cur[i] = v & 255;
    }
    cur.copy(out, y * stride); prev = cur;
  }
  if (ct === 6) return { w, h, rgba: out };
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { rgba[j] = out[i]; rgba[j + 1] = out[i + 1]; rgba[j + 2] = out[i + 2]; rgba[j + 3] = 255; }
  return { w, h, rgba };
}
function cropTopLeft(dec, size) {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) dec.rgba.copy(out, y * size * 4, y * dec.w * 4, (y * dec.w + size) * 4);
  return out;
}

// ── render one square icon at exactly size x size ────────────────────────────
const favSvg = readFileSync(join(BRAND, "planyr-favicon.svg"), "utf8");
function renderIcon(size, { transparent } = { transparent: true }) {
  const bg = transparent ? "transparent" : "#15171C";
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `html,body{margin:0;padding:0;background:${bg}}` +
    `svg{display:block;width:${size}px;height:${size}px}</style></head>` +
    `<body>${favSvg}</body></html>`;
  const htmlPath = join(TMP, `i-${size}-${transparent}.html`);
  const pngPath = join(TMP, `i-${size}-${transparent}.png`);
  writeFileSync(htmlPath, html);
  // Render onto a tall canvas (width honoured, height has ~85px overhead) then crop.
  execFileSync(CHROME, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars",
    "--ignore-certificate-errors", "--force-device-scale-factor=1",
    `--default-background-color=${transparent ? "00000000" : "15171Cff"}`,
    `--window-size=${size},${size + 200}`,
    `--screenshot=${pngPath}`,
    `file://${htmlPath}`,
  ], { stdio: ["ignore", "ignore", "ignore"] });
  const dec = decodePng(readFileSync(pngPath));
  if (dec.w !== size) throw new Error(`render ${size}px width came out ${dec.w}`);
  return encodePng(cropTopLeft(dec, size), size, size);
}

// ── multi-size .ico (embeds PNG frames; supported since IE/Vista) ─────────────
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length;
  frames.forEach((f, i) => {
    const e = i * 16;
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 0);
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, e + 1);
    dir.writeUInt16LE(1, e + 4);
    dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(f.buf.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += f.buf.length;
  });
  return Buffer.concat([header, dir, ...frames.map((f) => f.buf)]);
}

// ── run ──────────────────────────────────────────────────────────────────────
console.log("chromium:", CHROME);

const icoSizes = [16, 32, 48];
const frames = icoSizes.map((size) => ({ size, buf: renderIcon(size, { transparent: true }) }));
writeFileSync(join(PUBLIC, "favicon.ico"), buildIco(frames));
console.log("wrote public/favicon.ico", icoSizes.join("/"));

writeFileSync(join(PUBLIC, "apple-touch-icon.png"), renderIcon(180, { transparent: false }));
console.log("wrote public/apple-touch-icon.png 180x180");

copyFileSync(join(BRAND, "planyr-favicon.svg"), join(PUBLIC, "favicon.svg"));
copyFileSync(join(BRAND, "planyr-mark.svg"), join(PUBLIC, "planyr-mark.svg"));
console.log("copied public/favicon.svg + public/planyr-mark.svg");
console.log("done.");
