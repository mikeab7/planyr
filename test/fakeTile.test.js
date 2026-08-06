import { describe, it, expect } from "vitest";
import { fakeTilePng, tileColor, parseTileUrl, decodedTileBytes, decodedMB } from "../ui-audit/lib/fakeTile.mjs";

/* NEW-2 — the tile bytes that let this sandbox exercise decoded-image and GPU memory at all.
 *
 * Two properties carry the whole value of this file, and both are the kind that fail silently:
 *   1. THE PNG MUST ACTUALLY DECODE. A malformed PNG makes Chromium fire `error` instead of
 *      `load` — which is exactly the state this file exists to escape, and the run would look
 *      identical to the blocked-host run it replaced. The structural assertions below stand in
 *      for a decoder: signature, chunk order, declared dimensions, and a valid CRC per chunk.
 *   2. TWO TILES MUST NEVER SHARE BYTES. Chromium caches decoded bitmaps by content, so identical
 *      bytes across 200 tiles means ONE decoded bitmap shared 200 ways — the tile cache would look
 *      free, and the false negative would be indistinguishable from a real "no growth" finding.
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Walk the chunk list the way a decoder would, verifying every CRC on the way through. */
function chunks(png) {
  const out = [];
  let o = 8;
  while (o + 8 <= png.length) {
    const len = png.readUInt32BE(o);
    const type = png.slice(o + 4, o + 8).toString("latin1");
    const body = png.slice(o + 4, o + 8 + len);
    const crc = png.readUInt32BE(o + 8 + len);
    out.push({ type, len, data: png.slice(o + 8, o + 8 + len), crcOk: crc32(body) === crc });
    o += 12 + len;
  }
  return out;
}

describe("fakeTilePng — it has to be a PNG a real decoder accepts", () => {
  const png = fakeTilePng(15, 3, 7);

  it("carries the PNG signature", () => {
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("has IHDR, IDAT and IEND in that order, every CRC valid", () => {
    const c = chunks(png);
    expect(c.map((x) => x.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(c.every((x) => x.crcOk)).toBe(true);
  });

  it("declares the dimensions and colour format it actually contains", () => {
    const ihdr = chunks(png)[0].data;
    expect(ihdr.readUInt32BE(0)).toBe(256);
    expect(ihdr.readUInt32BE(4)).toBe(256);
    expect(ihdr[8]).toBe(8);  // 8 bits per channel
    expect(ihdr[9]).toBe(2);  // truecolour RGB
    expect(ihdr[12]).toBe(0); // not interlaced
  });

  it("honours a requested size", () => {
    const ihdr = chunks(fakeTilePng(1, 1, 1, 64))[0].data;
    expect(ihdr.readUInt32BE(0)).toBe(64);
  });
});

describe("every tile must be its own bytes — or Chromium shares one decoded bitmap", () => {
  it("gives no two tiles in a plausible viewport the same content", () => {
    const seen = new Set();
    for (let z = 14; z <= 17; z++) {
      for (let x = 0; x < 12; x++) {
        for (let y = 0; y < 12; y++) seen.add(fakeTilePng(z, x, y, 8).toString("base64"));
      }
    }
    expect(seen.size).toBe(4 * 12 * 12);
  });

  it("tileColor is deterministic — the same tile is byte-identical across runs", () => {
    expect(tileColor(15, 3, 7)).toEqual(tileColor(15, 3, 7));
    expect(fakeTilePng(15, 3, 7, 8).equals(fakeTilePng(15, 3, 7, 8))).toBe(true);
  });
});

describe("parseTileUrl — the ArcGIS axis order is Y BEFORE X", () => {
  it("reads an ArcGIS /tile/{z}/{y}/{x} URL with the right axes", () => {
    // Getting this backwards still "works" (every tile gets bytes) while quietly making
    // neighbouring tiles collide, which is why it is asserted rather than assumed.
    expect(parseTileUrl("https://server/MapServer/tile/16/25/13")).toEqual({ z: 16, y: 25, x: 13 });
  });

  it("reads an OSM-style /{z}/{x}/{y}.png URL", () => {
    expect(parseTileUrl("https://a.tile.host/16/13/25.png")).toEqual({ z: 16, x: 13, y: 25 });
  });

  it("tolerates a query string", () => {
    expect(parseTileUrl("https://server/MapServer/tile/16/25/13?blankTile=false")).toEqual({ z: 16, y: 25, x: 13 });
  });

  it("returns null for anything that is not a tile, so a non-tile request is never fulfilled with an image", () => {
    expect(parseTileUrl("https://server/MapServer?f=json")).toBeNull();
    expect(parseTileUrl("https://api.example.com/v1/projects")).toBeNull();
    expect(parseTileUrl("")).toBeNull();
  });
});

describe("decoded-bitmap arithmetic — the number the JS heap cannot see", () => {
  it("is 4 bytes per pixel, not the compressed transfer size", () => {
    expect(decodedTileBytes(256)).toBe(262144);
    expect(decodedMB(100)).toBeCloseTo(25, 1);
  });
});
