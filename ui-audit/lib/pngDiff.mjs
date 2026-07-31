/* pngDiff — a dependency-free PNG decoder + image differ (NEW-2).
 *
 * WHY THIS EXISTS. NEW-2's whole licence to ship is the claim "visually identical", and a claim
 * about pixels has to be settled in pixels. This repo has no image dependency (no pngjs, no
 * sharp, no pixelmatch) and adding one to the client tree for an audit script would be the wrong
 * trade — but PNG is just zlib plus five row filters, and node ships zlib. So: decode, and
 * report WHERE and BY HOW MUCH two renders differ, rather than a boolean that leaves you
 * guessing whether a hash mismatch is a real downgrade or one antialiased edge.
 *
 * Supports the subset Chromium's screenshot encoder emits: 8-bit RGB / RGBA, non-interlaced.
 * Anything else throws by name rather than silently mis-reading — a differ that quietly returns
 * "identical" because it could not parse the file is worse than no differ.
 */
import { inflateSync } from "node:zlib";

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error("not a PNG");
  let off = 8, ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("PNG has no IHDR");
  if (ihdr.depth !== 8) throw new Error(`unsupported bit depth ${ihdr.depth}`);
  if (ihdr.interlace) throw new Error("interlaced PNG is not supported");
  const channels = ihdr.colorType === 2 ? 3 : ihdr.colorType === 6 ? 4 : ihdr.colorType === 0 ? 1 : null;
  if (!channels) throw new Error(`unsupported colour type ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown row filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/**
 * Compare two decoded images. Returns the count of differing pixels, the worst per-channel
 * delta, the mean delta over the differing pixels only, and the bounding box of the difference
 * — the bbox is the useful part: "every differing pixel sits on a band's left and right edge"
 * is a diagnosis, "0.3% of pixels differ" on its own is not.
 */
export function diffImages(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const n = Math.min(a.channels, b.channels, 3); // compare RGB; alpha is opaque on a canvas screenshot
  let differing = 0, maxDelta = 0, sum = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const ia = (y * a.width + x) * a.channels, ib = (y * b.width + x) * b.channels;
      let d = 0;
      for (let c = 0; c < n; c++) d = Math.max(d, Math.abs(a.data[ia + c] - b.data[ib + c]));
      if (!d) continue;
      differing++; sum += d;
      if (d > maxDelta) maxDelta = d;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const total = a.width * a.height;
  return {
    total, differing, pct: +((differing / total) * 100).toFixed(4),
    maxDelta, meanDelta: differing ? +(sum / differing).toFixed(2) : 0,
    bbox: differing ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : null,
  };
}
