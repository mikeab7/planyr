#!/usr/bin/env node
/* Generates the four sample sheets NEW-2 (B1783329) asks for, so the crop path (rect + polygon)
 * has real, varied artwork to prove itself against instead of a synthetic flat rectangle. Written
 * once and committed — re-run only if a fixture needs to change shape. Pure Node (pdf-lib for the
 * two PDFs, a hand-rolled minimal PNG encoder for the raster — no native `canvas` dependency).
 *
 * Four fixtures, each chosen to break a different part of the crop path:
 *  1. broker-flyer.pdf   — a logo band across the top + a marketing column down one side around a
 *                          centred plan drawing (the motivating case named in B1134754).
 *  2. e-size-title-block.pdf — an E-size sheet (34x44in) whose title block runs down the right
 *     edge but only over the LOWER 70% of the sheet height; plan content (a match-line box)
 *     continues across the full width in the TOP 30%. A single rectangle excluding the title
 *     block column would also cut off that top-right plan content — this is the case a rectangle
 *     cannot express and a polygon can.
 *  3. l-shaped-plan.png   — an L-shaped plan area (two joined rectangles) on a white sheet: a shape
 *     a rectangle genuinely cannot trim to without either clipping a leg or keeping the notch.
 *  4. rotated-landscape.pdf — a landscape sheet stored with a PDF /Rotate 90 page attribute (the
 *     MediaBox itself is portrait; the page reads landscape only once /Rotate is honoured).
 */
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const OUT_DIR = "test/fixtures/site-plan-crop";
mkdirSync(OUT_DIR, { recursive: true });

// ---- 1. broker-flyer.pdf --------------------------------------------------------------------
async function buildBrokerFlyer() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]); // letter, portrait
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width: W, height: H } = page.getSize();

  // Logo band across the top.
  page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(0.10, 0.20, 0.45) });
  page.drawText("BROKERAGE CO. — INDUSTRIAL PROPERTY FLYER", { x: 24, y: H - 55, size: 16, font, color: rgb(1, 1, 1) });

  // Marketing column down the right side.
  page.drawRectangle({ x: W - 150, y: 0, width: 150, height: H - 90, color: rgb(0.95, 0.95, 0.9) });
  const blurb = ["FOR LEASE", "", "±184,000 SF", "Class A Industrial", "", "Contact:", "Jane Broker", "(555) 010-2200"];
  blurb.forEach((line, i) => page.drawText(line, { x: W - 140, y: H - 130 - i * 16, size: 10, font, color: rgb(0.15, 0.15, 0.15) }));

  // The actual site plan artwork, centred in the remaining white space.
  const planX = 40, planY = 60, planW = W - 150 - planX - 20, planH = H - 90 - planY - 30;
  page.drawRectangle({ x: planX, y: planY, width: planW, height: planH, borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  page.drawRectangle({ x: planX + 30, y: planY + 30, width: planW - 100, height: planH * 0.4, color: rgb(0.8, 0.8, 0.85), borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText("BUILDING A", { x: planX + 40, y: planY + planH * 0.4, size: 11, font, color: rgb(0, 0, 0) });
  page.drawText("SITE PLAN", { x: planX + 10, y: planY + planH - 15, size: 12, font, color: rgb(0, 0, 0) });

  writeFileSync(`${OUT_DIR}/broker-flyer.pdf`, await doc.save());
}

// ---- 2. e-size-title-block.pdf -----------------------------------------------------------------
async function buildESizeTitleBlock() {
  const doc = await PDFDocument.create();
  const W = 34 * 72, H = 44 * 72; // E size, points (72/in)
  const page = doc.addPage([W, H]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);

  const TITLE_W = 6 * 72; // 6in wide title-block column
  const TITLE_H = H * 0.7; // covers the LOWER 70% of the sheet height only

  // Sheet border.
  page.drawRectangle({ x: 36, y: 36, width: W - 72, height: H - 72, borderColor: rgb(0, 0, 0), borderWidth: 2 });

  // The plan drawing — spans the FULL width across the top 30% (this is the part a right-edge
  // rectangular crop would clip if it excluded the whole title-block COLUMN), then continues at
  // reduced width (left of the title block) for the remaining height.
  page.drawRectangle({ x: 60, y: H - 200, width: W - 120, height: 160, color: rgb(0.85, 0.9, 0.85), borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText("MATCH LINE — SEE SHEET C-2", { x: 80, y: H - 100, size: 18, font, color: rgb(0, 0, 0) });
  page.drawRectangle({ x: 60, y: 60, width: W - 120 - TITLE_W, height: H - 260, color: rgb(0.85, 0.9, 0.85), borderColor: rgb(0, 0, 0), borderWidth: 1 });
  page.drawText("SITE PLAN — GRADING & DRAINAGE", { x: 100, y: H / 2, size: 24, font, color: rgb(0, 0, 0) });

  // Title block — right edge, lower 70% of height only.
  page.drawRectangle({ x: W - 36 - TITLE_W, y: 36, width: TITLE_W, height: TITLE_H, color: rgb(0.95, 0.95, 0.92), borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  const rows = ["PROJECT NO. 24-1187", "DRAWN BY: T.K.", "CHECKED BY: R.M.", "DATE: 06/12/2026", "SCALE: 1\" = 40'", "SHEET C-1 OF 12"];
  rows.forEach((line, i) => page.drawText(line, { x: W - 36 - TITLE_W + 18, y: 36 + TITLE_H - 40 - i * 24, size: 14, font, color: rgb(0, 0, 0) }));

  writeFileSync(`${OUT_DIR}/e-size-title-block.pdf`, await doc.save());
}

// ---- 4. rotated-landscape.pdf ------------------------------------------------------------------
async function buildRotatedLandscape() {
  const doc = await PDFDocument.create();
  // MediaBox is stored PORTRAIT (24x36in tall) — the page reads landscape only once the
  // /Rotate attribute below is honoured by whatever rasterizes it.
  const page = doc.addPage([24 * 72, 36 * 72]);
  page.setRotation(degrees(90));
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const { width: W, height: H } = page.getSize(); // pre-rotation (MediaBox) size: 1728 x 2592

  page.drawRectangle({ x: 40, y: 40, width: W - 80, height: H - 80, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  // Text drawn so that, once /Rotate 90 is honoured, "TOP OF SHEET" reads along the true top
  // edge of the landscape page — i.e. drawn running up the MediaBox's left edge.
  page.drawText("TOP OF SHEET (only right-side-up once /Rotate is honoured)", {
    x: 60, y: H / 2 - 250, size: 28, font, color: rgb(0, 0, 0), rotate: degrees(90),
  });
  page.drawRectangle({ x: W / 2 - 300, y: H / 2 - 400, width: 600, height: 800, color: rgb(0.85, 0.9, 0.95), borderColor: rgb(0, 0, 0), borderWidth: 1.5 });
  page.drawText("LANDSCAPE SITE PLAN", { x: W / 2 - 260, y: H / 2, size: 20, font, color: rgb(0, 0, 0), rotate: degrees(90) });

  writeFileSync(`${OUT_DIR}/rotated-landscape.pdf`, await doc.save());
}

// ---- 3. l-shaped-plan.png — hand-rolled PNG encoder (no `canvas` dependency) -------------------
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function buildPng(width, height, rgbAt) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbAt(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB, no interlace
  const idat = deflateSync(raw);
  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", Buffer.alloc(0))]);
}
function buildLShapedPlan() {
  const W = 1200, H = 900;
  // The L: a wide horizontal leg across the top-left 2/3 of the sheet, plus a vertical leg
  // down the left side — genuinely not expressible as one axis-aligned rectangle without
  // either cutting a leg off or keeping the whole notch (the top-right and bottom-right
  // quadrants of the L's bounding box are NOT plan content).
  const legAx0 = 80, legAy0 = 80, legAx1 = 900, legAy1 = 380; // horizontal leg
  const legBx0 = 80, legBy0 = 80, legBx1 = 400, legBy1 = 780; // vertical leg
  const inLeg = (x, y) =>
    (x >= legAx0 && x < legAx1 && y >= legAy0 && y < legAy1) ||
    (x >= legBx0 && x < legBx1 && y >= legBy0 && y < legBy1);
  const png = buildPng(W, H, (x, y) => (inLeg(x, y) ? [180, 195, 210] : [255, 255, 255]));
  writeFileSync(`${OUT_DIR}/l-shaped-plan.png`, png);
}

const main = async () => {
  await buildBrokerFlyer();
  await buildESizeTitleBlock();
  await buildRotatedLandscape();
  buildLShapedPlan();
  console.log(`Wrote fixtures to ${OUT_DIR}/`);
};
main();
