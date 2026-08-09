/* NEW-2 — how a baked flood tile DECODES, HIT-TESTS and PAINTS.
 *
 * These run against the REAL committed Harris archive, not a synthetic tile, because the two
 * things worth guarding here are both properties of real data: that a floodway lands on top of the
 * SFHA it sits inside (painter's algorithm), and that the feature the identify names is the same
 * feature that was drawn. A hand-built fixture would satisfy both by construction and prove
 * nothing.
 *
 * Everything under test is the Leaflet-FREE half (`floodTileDecode.js`). The layer itself imports
 * Leaflet, which needs a `window` — see that module's header.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PMTiles } from "pmtiles";
import {
  decodeFloodTile, paint, featureAt, pointInRings, lngToTileX, latToTileY, TILE_PX,
} from "../src/workspaces/site-planner/lib/floodTileDecode.js";
import {
  floodTileStyle, paintRank, floodTileTitle, floodTileRows, FLOOD_TILE_IDENTIFY_NOTE,
} from "../src/workspaces/site-planner/lib/floodTileStyle.js";

const FLOOD_DIR = path.resolve(import.meta.dirname, "..", "public", "flood");

class NodeSource {
  constructor(p) { this.p = p; this.fd = fs.openSync(p, "r"); }
  getKey() { return this.p; }
  async getBytes(offset, length) {
    const b = Buffer.alloc(length);
    fs.readSync(this.fd, b, 0, length, offset);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.length) };
  }
}
const decompress = async (buf, c) => (c === 2 ? zlib.gunzipSync(Buffer.from(buf)) : Buffer.from(buf));

/* The densest z13 tile we can find near the middle of the Harris archive — a real tile with a real
 * mix of zones, resolved once for the whole suite. */
async function harrisTile() {
  const pm = new PMTiles(new NodeSource(path.join(FLOOD_DIR, "flood-tx-harris.pmtiles")), undefined, decompress);
  const h = await pm.getHeader();
  let best = null;
  for (let i = 1; i <= 4; i++) {
    for (let j = 1; j <= 4; j++) {
      const lon = h.minLon + ((h.maxLon - h.minLon) * i) / 5;
      const lat = h.minLat + ((h.maxLat - h.minLat) * j) / 5;
      const x = Math.floor(lngToTileX(lon, 13));
      const y = Math.floor(latToTileY(lat, 13));
      const t = await pm.getZxy(13, x, y);
      if (!t) continue;
      const decoded = decodeFloodTile(t.data);
      if (!best || decoded.features.length > best.features.length) best = { ...decoded, z: 13, x, y };
    }
  }
  return best;
}
const TILE = await harrisTile();

describe("pointInRings", () => {
  const square = (x0, y0, x1, y1) => [[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]];
  it("answers inside and outside a simple ring", () => {
    expect(pointInRings(square(0, 0, 10, 10), 5, 5)).toBe(true);
    expect(pointInRings(square(0, 0, 10, 10), 15, 5)).toBe(false);
  });
  it("treats a hole as outside, without classifying ring winding first", () => {
    const withHole = [...square(0, 0, 10, 10), ...square(3, 3, 7, 7)];
    expect(pointInRings(withHole, 1, 1)).toBe(true);   // in the ring, outside the hole
    expect(pointInRings(withHole, 5, 5)).toBe(false);  // in the hole
  });
  it("handles a multipolygon's rings as one flat list", () => {
    const two = [...square(0, 0, 4, 4), ...square(10, 10, 14, 14)];
    expect(pointInRings(two, 2, 2)).toBe(true);
    expect(pointInRings(two, 12, 12)).toBe(true);
    expect(pointInRings(two, 7, 7)).toBe(false);
  });
  it("is false for empty geometry rather than throwing", () => {
    expect(pointInRings([], 1, 1)).toBe(false);
  });
});

describe("decodeFloodTile — against the real Harris archive", () => {
  it("finds polygons and classifies every one of them", () => {
    expect(TILE, "the committed Harris archive must yield a non-empty z13 tile").toBeTruthy();
    expect(TILE.features.length).toBeGreaterThan(5);
    for (const f of TILE.features) {
      expect(f.resolved, JSON.stringify(f.props)).toBeTruthy();
      expect(f.rings.length).toBeGreaterThan(0);
    }
  });

  it("sorts to the painter's order, so a floodway is never buried by its own SFHA", () => {
    const ranks = TILE.features.map((f) => f.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // And the order itself is the one that matters:
    expect(paintRank("floodway")).toBeGreaterThan(paintRank("sfha"));
    expect(paintRank("sfha")).toBeGreaterThan(paintRank("shaded-x"));
  });

  it("decodes a tile with no flood layer to nothing rather than throwing", () => {
    // An empty protobuf is a valid MVT with no layers — the ordinary "nothing here" case.
    expect(decodeFloodTile(new Uint8Array(0))).toEqual({ extent: 4096, features: [] });
  });
});

describe("paint", () => {
  /* A recording 2d context — no DOM, no canvas library. What matters is that every feature is
   * drawn with its OWN style and closed with the even-odd rule (a hole must stay a hole). */
  const recorder = () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (_t, k) => {
        if (k === "fillStyle" || k === "strokeStyle" || k === "lineWidth") return undefined;
        return (...a) => calls.push([k, ...a]);
      },
      set: (_t, k, v) => { calls.push(["set:" + String(k), v]); return true; },
    });
    return { canvas: { getContext: () => ctx }, calls };
  };

  it("draws every decoded feature", () => {
    const r = recorder();
    expect(paint(r.canvas, TILE)).toBe(TILE.features.length);
    expect(r.calls.filter((c) => c[0] === "beginPath").length).toBe(TILE.features.length);
  });

  it("always fills even-odd, so a polygon's hole survives whatever way its ring was wound", () => {
    const r = recorder();
    paint(r.canvas, TILE);
    const fills = r.calls.filter((c) => c[0] === "fill");
    expect(fills.length).toBe(TILE.features.length);
    for (const f of fills) expect(f[1]).toBe("evenodd");
  });

  it("uses each feature's own style rather than one global colour", () => {
    const r = recorder();
    paint(r.canvas, TILE);
    const set = r.calls.filter((c) => c[0] === "set:fillStyle").map((c) => c[1]);
    for (const f of TILE.features) expect(set).toContain(floodTileStyle(f.resolved.variant).fill);
  });

  it("scales tile-space coordinates into the 256 px canvas", () => {
    const r = recorder();
    paint(r.canvas, { extent: 4096, features: [{ resolved: { variant: "sfha" }, rings: [[{ x: 0, y: 0 }, { x: 4096, y: 4096 }]] }] });
    expect(r.calls).toContainEqual(["lineTo", TILE_PX, TILE_PX]);
  });

  it("returns 0 for a canvas with no 2d context rather than throwing", () => {
    expect(paint({ getContext: () => null }, TILE)).toBe(0);
    expect(paint(null, TILE)).toBe(0);
  });
});

describe("featureAt — the identify answers with the feature that was DRAWN", () => {
  /* Take a real vertex of a real polygon, convert it back to lat/lng, and ask what is there. This
   * is the round trip that matters: the renderer and the hit test must agree on the projection. */
  const anyFeature = () => TILE.features[Math.floor(TILE.features.length / 2)];

  const tileToLngLat = (px, py, t) => {
    const n = 2 ** t.z;
    const lng = ((t.x + px / t.extent) / n) * 360 - 180;
    const yy = Math.PI - 2 * Math.PI * ((t.y + py / t.extent) / n);
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(yy) - Math.exp(-yy)));
    return { lng, lat };
  };

  it("finds a feature at a point inside its own geometry", () => {
    const f = anyFeature();
    // The centroid of a ring's bounding box is not guaranteed inside a concave ring, so walk the
    // ring's own points and take the first interior sample we can construct.
    let hit = null;
    for (const ring of f.rings) {
      for (let i = 0; i < ring.length && !hit; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        for (const nudge of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const p = { x: mid.x + nudge[0] * 3, y: mid.y + nudge[1] * 3 };
          if (pointInRings(f.rings, p.x, p.y)) { hit = p; break; }
        }
      }
    }
    expect(hit, "a real polygon must have a reachable interior point").toBeTruthy();
    const at = tileToLngLat(hit.x, hit.y, TILE);
    const found = featureAt([TILE], at);
    expect(found).toBeTruthy();
    expect(pointInRings(found.rings, hit.x, hit.y)).toBe(true);
  });

  it("answers null outside every decoded tile, so other layers can still answer", () => {
    expect(featureAt([TILE], { lat: 0, lng: 0 })).toBeNull();
    expect(featureAt([TILE], null)).toBeNull();
    expect(featureAt([], { lat: 29.7, lng: -95.4 })).toBeNull();
  });

  it("returns the TOPMOST feature — the last painted is the one under the cursor", () => {
    const box = [[{ x: 0, y: 0 }, { x: 4096, y: 0 }, { x: 4096, y: 4096 }, { x: 0, y: 4096 }]];
    const fake = {
      z: 13, x: TILE.x, y: TILE.y, extent: 4096,
      features: [
        { props: { FLD_ZONE: "AE" }, resolved: { variant: "sfha", zone: "AE", sfha: true }, rings: box, rank: paintRank("sfha") },
        { props: { FLD_ZONE: "AE" }, resolved: { variant: "floodway", zone: "AE", sfha: true }, rings: box, rank: paintRank("floodway") },
      ],
    };
    const at = tileToLngLat(2048, 2048, fake);
    expect(featureAt([fake], at).resolved.variant).toBe("floodway");
  });
});

describe("the identify card's wording", () => {
  it("leads with the answer a reader is looking for", () => {
    expect(floodTileTitle({ zone: "AE", variant: "floodway", sfha: true })).toMatch(/floodway/i);
    expect(floodTileTitle({ zone: "AE", variant: "sfha", sfha: true })).toMatch(/1% annual chance/);
    expect(floodTileTitle({ zone: "X", variant: "shaded-x" })).toMatch(/0\.2%/);
    expect(floodTileTitle({ zone: "D", variant: "d" })).toMatch(/undetermined/i);
    expect(floodTileTitle(null)).toBeTruthy(); // never blank
  });

  it("omits a base flood elevation rather than printing a sentinel", () => {
    const withBfe = floodTileRows({ STATIC_BFE: 42 }, { sfha: true });
    expect(withBfe.some((r) => /elevation/i.test(r.label) && /42/.test(r.value))).toBe(true);
    // The build strips -9999 to absent, so an absent BFE simply has no row.
    const none = floodTileRows({}, { sfha: true });
    expect(none.some((r) => /elevation/i.test(r.label))).toBe(false);
  });

  it("always states the SFHA answer, because that is the one a developer acts on", () => {
    expect(floodTileRows({}, { sfha: true }).some((r) => r.label === "In the SFHA" && r.value === "Yes")).toBe(true);
    expect(floodTileRows({}, { sfha: false }).some((r) => r.label === "In the SFHA" && r.value === "No")).toBe(true);
  });

  it("names the live FEMA query as the authority on every tile answer", () => {
    // The line that stops a generalised picture being read as a parcel's answer.
    expect(FLOOD_TILE_IDENTIFY_NOTE).toMatch(/live FEMA/i);
    expect(FLOOD_TILE_IDENTIFY_NOTE).toMatch(/authoritative/i);
  });
});

describe("the style table", () => {
  it("gives every kept variant a distinct fill", () => {
    const kept = ["sfha", "floodway", "shaded-x", "x-future", "x-levee", "d"];
    const fills = kept.map((v) => floodTileStyle(v).fill);
    expect(new Set(fills).size).toBe(kept.length);
  });
  it("paints an unrecognised class rather than dropping it silently", () => {
    // NFHL publishes OPEN WATER polygons, and a class nobody anticipated must still be visible.
    const s = floodTileStyle("other");
    expect(s.fill).toBeTruthy();
    expect(floodTileStyle(undefined).fill).toBe(s.fill);
  });
  it("has no entry for the two variants the build drops, so one appearing paints loudly", () => {
    expect(floodTileStyle("unshaded-x").fill).toBe(floodTileStyle("other").fill);
  });
});
