/* B298401 — the archive reader adapts to a host that ignores HTTP Range.
 *
 * ⛔ THE DEFECT THIS PINS WAS INVISIBLE TO EVERY OTHER CHECK IN THE REPO, and that is the whole
 * point of the suite. Measured 2026-08-09 against a real Cloudflare Pages deployment: a ranged GET
 * returns **200 with the full body and no `accept-ranges`**, on every asset — the 6 MiB archive, the
 * 665 KB one, `manifest.json`, and a plain `/assets/index-*.js`. `pmtiles`' own `FetchSource`
 * REFUSES that ("Check that your storage backend supports HTTP Byte Serving"), so the flood layer
 * would have thrown on its first read in production and fallen back to live FEMA — permanently and
 * silently. Meanwhile the Vite dev server DOES honour Range, so the headless verifier, every unit
 * test and every local run stayed green over a feature that could not work where it ships.
 *
 * So both host behaviours are exercised here against the REAL committed Harris archive, and the two
 * are required to produce the SAME decoded tile. A stub that returned synthetic bytes would prove
 * the stub.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { FloodArchiveSource } from "../src/workspaces/site-planner/lib/floodArchiveSource.js";

const ARCHIVE = path.resolve(import.meta.dirname, "..", "public", "flood", "flood-tx-harris.pmtiles");
const BYTES = fs.readFileSync(ARCHIVE);
const decompress = async (buf, c) => (c === 2 ? zlib.gunzipSync(Buffer.from(buf)) : Buffer.from(buf));

/* A stub `fetch` that behaves like one of the two hosts we have actually measured. `calls` records
 * what went over the wire, because "did it fetch the whole thing twice" is the question. */
function stubFetch({ honorRange }) {
  const calls = [];
  const impl = async (url, opts) => {
    const range = opts.headers.get("range");
    const m = /bytes=(\d+)-(\d+)/.exec(range || "");
    if (honorRange && m) {
      const a = +m[1], b = Math.min(+m[2], BYTES.length - 1);
      const slice = BYTES.subarray(a, b + 1);
      calls.push({ range, status: 206, bytes: slice.length });
      return {
        status: 206,
        headers: new Headers({ "content-range": `bytes ${a}-${b}/${BYTES.length}`, "accept-ranges": "bytes", etag: '"x"' }),
        arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length),
      };
    }
    // The measured Cloudflare Pages behaviour: the range is ignored, the whole file comes back.
    calls.push({ range, status: 200, bytes: BYTES.length });
    return {
      status: 200,
      headers: new Headers({ "content-length": String(BYTES.length), etag: '"x"' }),
      arrayBuffer: async () => BYTES.buffer.slice(BYTES.byteOffset, BYTES.byteOffset + BYTES.length),
    };
  };
  return { impl, calls };
}

const HOUSTON = { z: 13, lon: -95.37, lat: 29.76 };
const tileXY = ({ z, lon, lat }) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: Math.floor(((lon + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) };
};

async function readThrough(honorRange) {
  const { impl, calls } = stubFetch({ honorRange });
  const source = new FloodArchiveSource("https://example.test/flood/flood-tx-harris.pmtiles", { fetchImpl: impl });
  const pm = new PMTiles(source, undefined, decompress);
  const header = await pm.getHeader();
  const { x, y } = tileXY(HOUSTON);
  const a = await pm.getZxy(13, x, y);
  const b = await pm.getZxy(13, x + 1, y);
  const features = a ? new VectorTile(new Pbf(a.data)).layers.flood : null;
  return { header, calls, source, features, second: !!b };
}

describe("a host that IGNORES Range (the measured Cloudflare Pages behaviour)", () => {
  it("still reads the header and decodes a real tile", async () => {
    const r = await readThrough(false);
    expect(r.header.minZoom).toBe(8);
    expect(r.header.maxZoom).toBe(13);
    expect(r.features).toBeTruthy();
    expect(r.features.length).toBeGreaterThan(0);
    expect(r.second).toBe(true);
  });

  it("fetches the archive exactly ONCE, however many tiles are read", async () => {
    const r = await readThrough(false);
    // Anything above 1 means the whole-file body was thrown away and re-requested — a 6 MiB
    // download per tile, which is worse than the live path this feature is meant to replace.
    expect(r.calls.filter((c) => c.status === 200).length).toBe(1);
    expect(r.source.wholeFileBytes).toBe(BYTES.length);
  });

  it("releases the held archive so a plan switch cannot leak a county per visit", async () => {
    const r = await readThrough(false);
    expect(r.source.wholeFileBytes).toBeGreaterThan(0);
    r.source.release();
    expect(r.source.wholeFileBytes).toBe(0);
  });
});

describe("a host that HONOURS Range (the Vite dev server, and any correct static host)", () => {
  it("keeps the cheap path — ranged reads, nothing held in memory", async () => {
    const r = await readThrough(true);
    expect(r.features).toBeTruthy();
    expect(r.source.wholeFileBytes).toBe(0);
    expect(r.calls.every((c) => c.status === 206)).toBe(true);
    const total = r.calls.reduce((n, c) => n + c.bytes, 0);
    expect(total).toBeLessThan(200 * 1024); // kilobytes, not the whole 5.96 MiB archive
  });
});

describe("the two hosts must not disagree about what is on the map", () => {
  it("decodes the SAME tile, feature for feature", async () => {
    const [noRange, withRange] = await Promise.all([readThrough(false), readThrough(true)]);
    expect(noRange.features.length).toBe(withRange.features.length);
    const props = (f) => Array.from({ length: f.length }, (_, i) => JSON.stringify(f.feature(i).properties));
    expect(props(noRange.features)).toEqual(props(withRange.features));
  });
});

describe("failure is LOUD, never a silent short read", () => {
  it("throws when the response is neither a 206 nor long enough to satisfy the read", async () => {
    const source = new FloodArchiveSource("https://example.test/x.pmtiles", {
      fetchImpl: async () => ({ status: 200, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(8) }),
    });
    await expect(source.getBytes(0, 16384)).rejects.toThrow(/8 bytes for a 16384-byte read/);
  });

  it("throws on an error status rather than treating the error page as tile data", async () => {
    const source = new FloodArchiveSource("https://example.test/x.pmtiles", {
      fetchImpl: async () => ({ status: 404, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) }),
    });
    await expect(source.getBytes(0, 16384)).rejects.toThrow(/HTTP 404/);
  });

  it("throws rather than returning short data on a read past the end of a held archive", async () => {
    const { impl } = stubFetch({ honorRange: false });
    const source = new FloodArchiveSource("https://example.test/a.pmtiles", { fetchImpl: impl });
    await source.getBytes(0, 16384);
    await expect(source.getBytes(BYTES.length + 10, 16)).rejects.toThrow(/past end/);
  });
});

describe("concurrent first reads", () => {
  it("a cold viewport asking for several tiles at once downloads the archive once, not N times", async () => {
    const { impl, calls } = stubFetch({ honorRange: false });
    const source = new FloodArchiveSource("https://example.test/a.pmtiles", { fetchImpl: impl });
    await Promise.all([source.getBytes(0, 16384), source.getBytes(0, 16384), source.getBytes(0, 16384)]);
    expect(calls.length).toBe(1);
  });
});
