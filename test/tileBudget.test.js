/* NEW-7/NEW-4/NEW-3/NEW-6 — the pure policy behind the tile, ghost and overlay-scheduling
 * work. Every number here traces to the 2026-07-28 live measurement:
 *   • the Leaflet container measured 2018x1025 against ~1378x385 visible — 3.9x the pixel
 *     area before retina; at dpr 2.15 the working zoom held ~105 tiles where a bare
 *     viewport needs ~12-15;
 *   • one scenario load fetched 221 tiles (~3.5 MB) across FIVE zoom levels, ~53% of them
 *     transitional levels nobody lingered on;
 *   • toggling 23 overlays off released 780 of 782 SVG elements but 0 of 51 tiles.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  tileWeight, overscanPx, keepBufferFor, retinaForZoom, tileCacheLimit, tilesToEvict,
  OVERSCAN_FULL, OVERSCAN_REDUCED, RETINA_MIN_ZOOM,
} from "../src/workspaces/site-planner/lib/tileBudget.js";
import { visibleTiles } from "../src/workspaces/site-planner/lib/ghostSnapshot.js";
import { orderLayersByPriority, admittedAfter, LAYER_STAGE_SIZE } from "../src/workspaces/site-planner/lib/layerSchedule.js";

const BIG_VIEWPORT = { viewportW: 1600, viewportH: 1200 }; // roomy enough that the window clamp isn't what binds

describe("tileWeight", () => {
  it("calls an empty plan light and the reference scenario heavy", () => {
    expect(tileWeight({ elementCount: 0 })).toBe("light");
    expect(tileWeight({ elementCount: 148 })).toBe("heavy"); // the measured Concept C
    expect(tileWeight({ elementCount: 900 })).toBe("very-heavy");
  });

  it("treats a low-memory device as at least heavy", () => {
    expect(tileWeight({ elementCount: 5, deviceMemoryGb: 4 })).toBe("heavy");
    expect(tileWeight({ elementCount: 5, deviceMemoryGb: 16 })).toBe("light");
  });
});

describe("overscanPx", () => {
  it("gives a light plan the full pan-reveal margin and steps a heavy one down", () => {
    expect(overscanPx({ elementCount: 0, ...BIG_VIEWPORT })).toBe(OVERSCAN_FULL);
    expect(overscanPx({ elementCount: 148, ...BIG_VIEWPORT })).toBe(OVERSCAN_REDUCED);
    expect(overscanPx({ elementCount: 900, ...BIG_VIEWPORT })).toBeLessThan(OVERSCAN_REDUCED);
  });

  it("never overhangs a small window by most of itself — the 3.9x blow-up", () => {
    // The measured viewport was only 465 px tall; a fixed 320 per side is most of it.
    const px = overscanPx({ elementCount: 0, viewportW: 1378, viewportH: 465 });
    expect(px).toBeLessThan(OVERSCAN_FULL);
    // Container area must now be a small multiple of the visible area, not four times it.
    const area = (1378 + 2 * px) * (465 + 2 * px);
    expect(area / (1378 * 465)).toBeLessThan(2.6);
  });

  it("still leaves a real margin — the anti-flash reveal must not vanish", () => {
    expect(overscanPx({ elementCount: 5000, viewportW: 320, viewportH: 200 })).toBeGreaterThanOrEqual(48);
  });
});

describe("keepBufferFor", () => {
  it("steps down with weight, because it multiplies on top of the overscan", () => {
    expect(keepBufferFor({ elementCount: 0 })).toBe(4);
    expect(keepBufferFor({ elementCount: 148 })).toBe(2);
    expect(keepBufferFor({ elementCount: 900 })).toBe(1);
  });
});

describe("retinaForZoom", () => {
  it("keeps full density at the working zooms — a soft aerial is not an acceptable fix", () => {
    expect(retinaForZoom(18, { dpr: 2.15 })).toBe(true);
    expect(retinaForZoom(RETINA_MIN_ZOOM, { dpr: 2.15 })).toBe(true);
  });

  it("clamps it only out at the wide context zooms", () => {
    expect(retinaForZoom(12, { dpr: 2.15 })).toBe(false);
    expect(retinaForZoom(11, { dpr: 2.15 })).toBe(false);
  });

  it("is moot on a non-retina display, and yields first on a very heavy plan", () => {
    expect(retinaForZoom(18, { dpr: 1 })).toBe(false);
    expect(retinaForZoom(18, { dpr: 3, weight: "very-heavy" })).toBe(false);
  });
});

describe("tileCacheLimit / tilesToEvict", () => {
  it("sizes the cap from what the container genuinely needs, with headroom", () => {
    const limit = tileCacheLimit({ containerW: 2018, containerH: 1025, tileSizePx: 256, keepBuffer: 2 });
    expect(limit).toBeGreaterThan(105); // never below the measured working set
    expect(limit).toBeLessThan(600);    // but a real ceiling, not "unbounded"
  });

  it("sheds the furthest retained tiles once over the cap", () => {
    const tiles = Array.from({ length: 10 }, (_, i) => ({ key: `t${i}`, current: false, active: false, distance: i }));
    expect(tilesToEvict(tiles, 6)).toEqual(["t9", "t8", "t7", "t6"]);
  });

  it("NEVER evicts a tile that is part of the view — that would punch a hole in the aerial", () => {
    const tiles = Array.from({ length: 10 }, (_, i) => ({ key: `t${i}`, current: true, active: true, distance: i }));
    expect(tilesToEvict(tiles, 2)).toEqual([]);
  });

  it("does nothing at or under the cap", () => {
    expect(tilesToEvict([{ key: "a", current: false, distance: 1 }], 4)).toEqual([]);
  });
});

describe("ghost snapshot selection (NEW-4)", () => {
  const clip = { left: 0, top: 0, right: 1378, bottom: 465 };
  // A 400-tile overscanned container, only a fraction of which the user can see.
  const grid = [];
  for (let x = -6; x < 14; x++) {
    for (let y = -6; y < 14; y++) {
      const left = x * 256, top = y * 256;
      grid.push({ id: `${x}:${y}`, loaded: true, rect: { left, top, right: left + 256, bottom: top + 256, width: 256, height: 256 } });
    }
  }

  it("snapshots only the visible tiles — an order of magnitude fewer than a deep clone", () => {
    const keep = visibleTiles(grid, clip, 8);
    expect(grid.length).toBe(400);
    expect(keep.length).toBeLessThan(40);
    expect(keep.length).toBeGreaterThan(0);
  });

  it("covers the whole visible area — every screen corner is inside a kept tile", () => {
    const keep = visibleTiles(grid, clip, 0);
    for (const [x, y] of [[1, 1], [1377, 1], [1, 464], [1377, 464], [689, 232]]) {
      expect(keep.some((t) => t.rect.left <= x && t.rect.right >= x && t.rect.top <= y && t.rect.bottom >= y)).toBe(true);
    }
  });

  it("skips tiles that never painted — a blank <img> in the ghost is worse than none", () => {
    const withBlank = [...grid, { id: "blank", loaded: false, rect: { left: 0, top: 0, right: 256, bottom: 256, width: 256, height: 256 } }];
    expect(visibleTiles(withBlank, clip, 0).some((t) => t.id === "blank")).toBe(false);
  });
});

describe("overlay load order (NEW-3)", () => {
  const ALL = {
    fema_nfhl: { kind: "esriImage" }, wetlands: { kind: "esriImage" },
    jur_county: { kind: "vector" }, pipelines: { kind: "vectorLine" },
    contours: { kind: "contours" }, power: { kind: "overpass" }, streetphotos: { kind: "mapillary" },
  };
  const allOn = Object.fromEntries(Object.keys(ALL).map((k) => [k, { on: true }]));

  it("loads what kills a deal first and the crowd sources last", () => {
    const order = orderLayersByPriority(allOn, ALL);
    expect(order[0]).toBe("fema_nfhl");
    expect(order.indexOf("pipelines")).toBeLessThan(order.indexOf("contours"));
    expect(order.slice(-2).sort()).toEqual(["power", "streetphotos"]);
  });

  it("only lists layers that are ON", () => {
    const order = orderLayersByPriority({ ...allOn, power: { on: false } }, ALL);
    expect(order).not.toContain("power");
  });

  it("admits nothing on the first pass and WIDENS from there — never replaces", () => {
    const order = orderLayersByPriority(allOn, ALL);
    const s0 = admittedAfter(order, 0), s1 = admittedAfter(order, 1), s2 = admittedAfter(order, 2);
    expect(s0.size).toBe(0);
    expect(s1.size).toBe(LAYER_STAGE_SIZE);
    [...s1].forEach((id) => expect(s2.has(id)).toBe(true));
    expect(admittedAfter(order, 99).size).toBe(order.length);
  });
});

/* NEW-1 (2026-07-29) — the COARSE BACKFILL layer had no ceiling at all.
 *
 * `SitePlanner` bound `boundTileCache` to the DETAIL layer only. The backfill was created with
 * `preserveTilesAcrossSetView` and a keepBuffer two rings LARGER than the detail layer, and nothing
 * ever capped it — so its `_tiles` map grew for the length of the session, shedding only when
 * Leaflet's incidental pruning happened to fire. That is retained DECODED-IMAGE memory, which a JS
 * heap snapshot cannot see, which is why the 2026-07-28 "not a leak" verdict could not have caught
 * it: that run measured the ~135 MB of JS, not the ~420 MB of tiles/GPU where this lives.
 *
 * These assert the budget maths the backfill now uses, and that shedding never touches a CURRENT
 * tile — i.e. eviction cannot cost render quality, which is the owner's standing constraint. */
describe("NEW-1 — the coarse backfill layer's ceiling", () => {
  it("a larger keepBuffer earns a larger ceiling, but still a FINITE one", () => {
    const detail = tileCacheLimit({ containerW: 1280, containerH: 900, tileSizePx: 256, keepBuffer: 2 });
    const backfill = tileCacheLimit({ containerW: 1280, containerH: 900, tileSizePx: 256, keepBuffer: 4 });
    expect(backfill).toBeGreaterThan(detail);          // its own buffer is respected…
    expect(Number.isFinite(backfill)).toBe(true);      // …but it is bounded, which it was not
    expect(backfill).toBeLessThan(2000);
  });

  it("eviction NEVER sheds a current tile, so capping cannot degrade the aerial", () => {
    // 400 retained tiles, 30 of them current — the shape of a long panning session.
    const entries = Array.from({ length: 400 }, (_, i) => ({
      key: `k${i}`, current: i < 30, active: i < 30, loaded: true, distance: i,
    }));
    const drop = tilesToEvict(entries, 60);
    expect(drop.length).toBeGreaterThan(0);                                  // it really sheds…
    for (const k of drop) {
      const e = entries.find((x) => x.key === k);
      expect(e.current, `${k} is current and must never be evicted`).toBe(false);
    }
    // …and it sheds the FURTHEST first, so what goes is what the user is least likely to pan back to.
    const droppedDistances = drop.map((k) => entries.find((x) => x.key === k).distance);
    expect(Math.min(...droppedDistances)).toBeGreaterThan(29);
  });

  it("the planner binds a cap to BOTH tile layers (anti-drift source guard)", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    const caps = [...src.matchAll(/boundTileCache\(/g)];
    expect(caps.length, "detail AND backfill must each be capped").toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/geoBfCapRef\.current = boundTileCache\(bf,/);
    expect(src).toMatch(/geoBfCapRef\.current\(\)/);   // and detached on teardown
  });
});
