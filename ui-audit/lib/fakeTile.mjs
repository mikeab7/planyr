/* fakeTile — a real, decodable PNG per tile, so this sandbox can exercise the ONE suspect it
 * otherwise structurally cannot (NEW-2).
 *
 * THE PROBLEM THIS SOLVES, and it has blocked every memory finding in this repo for two weeks.
 * Every external tile host is unreachable here. Leaflet still creates its `<img>` elements, so
 * tile COUNT and tile-node retention are measurable — but nothing ever decodes, no bitmap is
 * allocated, and no texture is uploaded to the compositor. That means decoded-image and GPU
 * memory, named repeatedly as the largest single suspect for the owner's ~278 MB tab (B1121's
 * "wrong instrument for where the memory lives", B1331, longSession.mjs's own tileCaveat), have
 * never once been exercised by any instrument here. Every run has ended with the same honest
 * shrug: "that half cannot be settled in this sandbox."
 *
 * It can be, by serving the bytes ourselves. A route handler fulfils every tile request with a
 * genuine 256x256 PNG, so Chromium does the real work: decode, bitmap allocation, texture upload,
 * compositing, and eviction. The tile SOURCE is fake; the memory behaviour is not.
 *
 * ⛔ EVERY TILE MUST HAVE DISTINCT BYTES, and this is the whole reason this file generates images
 * instead of shipping one fixture PNG. Chromium caches decoded images keyed by content: serve the
 * identical bytes for 200 tiles and it decodes ONE bitmap and shares it, which would make the tile
 * cache look free and reproduce the exact false negative this exists to avoid. Colour is derived
 * from (z, x, y), so no two tiles in a session share a decoded bitmap.
 *
 * Hand-rolled rather than adding an image dependency: a PNG is a signature, three chunks, and a
 * CRC, and this is dev-only tooling that must not add a runtime dep to the app.
 */
import { deflateSync } from "node:zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* A deterministic colour per tile. Deliberately spread across the byte range rather than a small
 * palette, so two different tiles cannot collide into identical bytes and get their decoded
 * bitmaps shared (see the note above — that collision is the failure mode this file exists to
 * prevent). Pure and total: any finite z/x/y yields a colour. */
export function tileColor(z, x, y) {
  const h = (Math.imul(z + 1, 2654435761) ^ Math.imul(x + 1, 40503) ^ Math.imul(y + 1, 2246822519)) >>> 0;
  return { r: h & 0xff, g: (h >>> 8) & 0xff, b: (h >>> 16) & 0xff };
}

/* A real RGB PNG of `size`x`size`, flat-filled with this tile's own colour plus a per-row ramp so
 * the compressed payload is not degenerate (a single flat colour deflates to almost nothing, which
 * would understate the transfer but NOT the decode — the decoded bitmap is size*size*4 regardless,
 * which is the number that matters here). */
export function fakeTilePng(z, x, y, size = 256) {
  const s = Math.max(1, Math.min(1024, Math.floor(size)));
  const { r, g, b } = tileColor(z, x, y);
  // Raw scanlines: one filter byte (0 = None) then RGB triples.
  const raw = Buffer.alloc(s * (1 + s * 3));
  for (let row = 0; row < s; row++) {
    const off = row * (1 + s * 3);
    raw[off] = 0;
    for (let col = 0; col < s; col++) {
      const p = off + 1 + col * 3;
      raw[p] = (r + row) & 0xff;
      raw[p + 1] = (g + col) & 0xff;
      raw[p + 2] = (b + ((row + col) >> 1)) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s, 0);
  ihdr.writeUInt32BE(s, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // colour type 2 = truecolour RGB
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // deflate / adaptive filtering / no interlace
  return Buffer.concat([SIG, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/* Pull z/x/y out of a tile URL. Handles the two shapes this app's basemap registry builds —
 * ArcGIS `/tile/{z}/{y}/{x}` (note: Y BEFORE X) and the OSM-style `/{z}/{x}/{y}.png` — and
 * returns null for anything else so a non-tile request is never silently fulfilled with an image.
 * Getting the ArcGIS axis order wrong would still "work" (every tile still gets bytes) while
 * quietly making neighbouring tiles collide, so the order is asserted in the unit tests. */
export function parseTileUrl(url) {
  const u = String(url || "").split(/[?#]/)[0];
  let m = /\/tile\/(\d+)\/(\d+)\/(\d+)$/.exec(u);
  if (m) return { z: +m[1], y: +m[2], x: +m[3] };
  m = /\/(\d+)\/(\d+)\/(\d+)(?:\.(?:png|jpe?g|webp))?$/.exec(u);
  if (m) return { z: +m[1], x: +m[2], y: +m[3] };
  return null;
}

/* Decoded bytes a retained tile costs the renderer, which is the figure the JS heap cannot see
 * and the one every previous verdict here was missing. 4 bytes per pixel (RGBA), and on a retina
 * layer Leaflet fetches one zoom deeper and displays at half size — same decoded pixel count per
 * tile, but roughly four times as many tiles for the same ground area. */
export const decodedTileBytes = (size = 256) => size * size * 4;
export const decodedMB = (tiles, size = 256) => +((tiles * decodedTileBytes(size)) / 1048576).toFixed(1);
