/* NEW-1 + NEW-2 — "read the elevation off the map, always."
 *
 * NEW-1: hovering ANY contour (not only the sparse every-5-ft index lines) names its
 * elevation, answered by a JS hit-test over the composed geometry so the polylines stay
 * `interactive:false` (B704's perf decision) and B1088's fixed lattice keeps the hit
 * stable.
 * NEW-2: the ground readout ALWAYS shows a state — a number, or an honest named state —
 * and never silently vanishes (B706 rendered every non-value case as absence). Plus the
 * proposed elevation and the signed cut/fill, read from the SAME surface the B826
 * earthwork rows price off, so the chip and the ledger cannot disagree.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildContourIndex, hitContour, composeContourPaint, contourLabelText,
  HOVER_TOL_PX, DOUBLE_STAMP_PX,
} from "../src/workspaces/site-planner/lib/contours.js";
import { latticeTileAt, latticeCover, bandCellMeters, TILE_CELLS, lngToMercX, latToMercY } from "../src/workspaces/site-planner/lib/demGrid.js";
import { groundReadout, deltaColor, COARSE_CELL_FT } from "../src/workspaces/site-planner/lib/groundReadout.js";
import { buildPlanes, surfaceGrid, sampleProposedAt } from "../src/workspaces/site-planner/lib/proposedSurface.js";
import { samplePoint } from "../src/workspaces/site-planner/lib/elevation.js";

const line = (level, coords, isIndex = false) => ({ level, coords, isIndex });
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];

// ---------------------------------------------------------------------------
describe("NEW-1 — hover hit-test over the composed contour geometry", () => {
  // A little slope: four east-west contours a thousandth of a degree apart. Only 155 is
  // an index line, so 152/153/154 are exactly the lines that carried no label before.
  const lines = [
    line(152, [[30.0000, -95.7000], [30.0000, -95.6900]]),
    line(153, [[30.0010, -95.7000], [30.0010, -95.6900]]),
    line(154, [[30.0020, -95.7000], [30.0020, -95.6900]]),
    line(155, [[30.0030, -95.7000], [30.0030, -95.6900]], true),
  ];
  const idx = buildContourIndex(lines);
  const TOL = 0.00002; // ~2 m — the degree-equivalent of a handful of screen px at z17

  it("names an UNLABELLED 1-ft line under the cursor", () => {
    const hit = hitContour(idx, 30.0010 + 0.000005, -95.6950, TOL);
    expect(hit).toBeTruthy();
    expect(hit.level).toBe(153);
    expect(hit.isIndex).toBe(false);
    expect(contourLabelText(hit.level)).toBe("153 ft");
  });

  it("reads INTERMEDIATE values, not only multiples of five", () => {
    const levels = [30.0000, 30.0010, 30.0020, 30.0030]
      .map((lat) => hitContour(idx, lat, -95.6950, TOL).level);
    expect(levels).toEqual([152, 153, 154, 155]);
  });

  it("returns the closest point ON the line, so the label sits on the contour", () => {
    const hit = hitContour(idx, 30.0010 + 0.000008, -95.69503, TOL);
    expect(hit.ll[0]).toBeCloseTo(30.0010, 9);
    expect(hit.ll[1]).toBeCloseTo(-95.69503, 6);
  });

  it("answers NOTHING when the cursor is not near a line (no nearest-line fallback)", () => {
    expect(hitContour(idx, 30.0005, -95.6950, TOL)).toBeNull();  // midway between two lines
    expect(hitContour(idx, 30.0010, -95.6500, TOL)).toBeNull();  // off the end of every run
  });

  it("is order-independent — the answer can't depend on which tile resolved first", () => {
    const shuffled = buildContourIndex([lines[2], lines[0], lines[3], lines[1]]);
    const a = hitContour(idx, 30.0020, -95.6950, TOL);
    const b = hitContour(shuffled, 30.0020, -95.6950, TOL);
    expect(b.level).toBe(a.level);
    expect(b.ll).toEqual(a.ll);
  });

  it("resolves an exact tie by level, never by insertion order", () => {
    const twin = [line(160, [[30, -95.7], [30, -95.6]]), line(159, [[30, -95.7], [30, -95.6]])];
    const one = hitContour(buildContourIndex(twin), 30, -95.65, TOL);
    const two = hitContour(buildContourIndex([twin[1], twin[0]]), 30, -95.65, TOL);
    expect(one.level).toBe(159);
    expect(two.level).toBe(159);
  });

  it("still finds a segment far longer than one index bucket (the big-segment path)", () => {
    const long = buildContourIndex([line(151, [[29.9, -96.0], [30.1, -95.4]])]);
    expect(long.big.length).toBe(1);
    const mid = { lat: 30.0, lng: -95.7 };
    expect(hitContour(long, mid.lat, mid.lng, TOL).level).toBe(151);
  });

  it("scales with the map: a tighter tolerance rejects what a looser one accepted", () => {
    const off = 30.0010 + 0.00003;
    expect(hitContour(idx, off, -95.695, 0.00005)).toBeTruthy();
    expect(hitContour(idx, off, -95.695, 0.00001)).toBeNull();
  });

  it("keeps the hover budget honest — the screen tolerances are small and fixed", () => {
    expect(HOVER_TOL_PX).toBeLessThanOrEqual(8);
    expect(DOUBLE_STAMP_PX).toBeGreaterThanOrEqual(20);
  });

  it("indexes exactly what composeContourPaint paints (one composition, one index)", () => {
    // the composition's own output feeds the index — no second geometry model anywhere
    const painted = composeContourPaint([]);
    expect(buildContourIndex(painted.lines).count).toBe(0);
    expect(hitContour(buildContourIndex(painted.lines), 30, -95, TOL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("NEW-2(b) — the cursor tile is a plain lattice tile (so it's a cache hit)", () => {
  it("latticeTileAt is a pure function of (band, point) and agrees with latticeCover", () => {
    const lat = 29.78, lng = -95.81, band = 17;
    const a = latticeTileAt(lat, lng, band);
    expect(latticeTileAt(lat, lng, band).key).toBe(a.key);
    const span = TILE_CELLS * bandCellMeters(band);
    expect(a.tx).toBe(Math.floor(lngToMercX(lng) / span));
    expect(a.ty).toBe(Math.floor(latToMercY(lat) / span));
    // the very tile a view centred here would ask the contour layer for
    const cover = latticeCover({ west: lng - 1e-4, east: lng + 1e-4, south: lat - 1e-4, north: lat + 1e-4 }, band);
    expect(cover.tiles.map((t) => t.key)).toContain(a.key);
  });
  it("covers real ground — a tile at the cursor spans well past one screen", () => {
    const t = latticeTileAt(29.78, -95.81, 17);
    expect(t.bbox.xmax - t.bbox.xmin).toBeGreaterThan(500); // metres
  });
});

// ---------------------------------------------------------------------------
describe("NEW-2(a) — the elevation field ALWAYS shows a state, and never invents one", () => {
  const hasDigit = (s) => /\d/.test(s);

  it("a reading reads as a number, with the unit written exactly once", () => {
    const r = groundReadout({ el: { status: "value", ft: 152.63 } });
    expect(r.text).toBe("Exist 152.6 ft");
    expect(r.text.match(/ft/g).length).toBe(1);
  });

  it("in flight says so — it does NOT disappear (the B706 bug)", () => {
    const r = groundReadout({ el: { status: "pending" } });
    expect(r.text).toBe("Exist …");
    expect(hasDigit(r.text)).toBe(false);
  });

  it("a DEM void and an endpoint failure are DIFFERENT named states, both present", () => {
    expect(groundReadout({ el: { status: "void" } }).text).toBe("Exist — (no data here)");
    expect(groundReadout({ el: { status: "unavailable" } }).text).toBe("Exist — (unavailable)");
    expect(groundReadout({ el: { status: "unavailable" } }).title).toMatch(/Nothing is being guessed/);
  });

  it("every state renders a field — none is ever the empty string", () => {
    for (const status of ["value", "pending", "void", "unavailable"]) {
      const r = groundReadout({ el: { status, ft: 100 } });
      expect(r.parts.length).toBeGreaterThan(0);
      expect(r.text.startsWith("Exist")).toBe(true);
    }
  });

  it("a coarse grid cell is marked and explained, not silently smoothed over", () => {
    const fine = groundReadout({ el: { status: "value", ft: 152.6, cellFt: 6 } });
    const coarse = groundReadout({ el: { status: "value", ft: 152.6, cellFt: COARSE_CELL_FT + 20 } });
    expect(fine.text).toBe("Exist 152.6 ft");
    expect(coarse.text).toBe("Exist ≈152.6 ft");
    expect(coarse.title).toMatch(/coarse/i);
  });
});

describe("NEW-2(c/d) — proposed and the signed delta", () => {
  it("shows Exist · Prop · Fill on one line, unit once, delta on the fill ramp", () => {
    const r = groundReadout({ el: { status: "value", ft: 152.6 }, prop: { status: "value", ft: 155.0 } });
    expect(r.text).toBe("Exist 152.6 · Prop 155.0 · Fill 2.4 ft");
    expect(r.text.match(/ft/g).length).toBe(1);
    expect(r.parts.find((p) => p.key === "delta").color).toBe(deltaColor(2.4));
  });

  it("labels a lower proposed surface as Cut", () => {
    const r = groundReadout({ el: { status: "value", ft: 152.6 }, prop: { status: "value", ft: 150.8 } });
    expect(r.text).toBe("Exist 152.6 · Prop 150.8 · Cut 1.8 ft");
  });

  it("calls a negligible delta 'On grade' rather than a fake ±0.0", () => {
    const r = groundReadout({ el: { status: "value", ft: 152.60 }, prop: { status: "value", ft: 152.62 } });
    expect(r.text).toBe("Exist 152.6 · Prop 152.6 ft · On grade");
  });

  it("SUPPRESSES the delta whenever either side is unknown", () => {
    const a = groundReadout({ el: { status: "pending" }, prop: { status: "value", ft: 155 } });
    const b = groundReadout({ el: { status: "value", ft: 152.6 }, prop: { status: "none", reason: "outside" } });
    expect(a.parts.some((p) => p.key === "delta")).toBe(false);
    expect(b.parts.some((p) => p.key === "delta")).toBe(false);
    expect(b.text).toBe("Exist 152.6 ft · Prop —");
  });

  it("gives an honest REASON for a missing proposed value, and never a number", () => {
    for (const [reason, re] of [["nosurface", /finished floor/i], ["outside", /No graded element/i], ["pond", /borrow/i], ["void", /No ground data/i]]) {
      const r = groundReadout({ el: { status: "value", ft: 100 }, prop: { status: "none", reason } });
      expect(r.parts.find((p) => p.key === "prop").text).toBe("Prop —");
      expect(r.title).toMatch(re);
    }
  });

  it("omits the proposed field entirely on a surface with no concept (the map finder)", () => {
    const r = groundReadout({ el: { status: "value", ft: 152.6 } });
    expect(r.parts.map((p) => p.key)).toEqual(["exist"]);
  });

  it("stays ONE short line — three fields, no wrapping prose", () => {
    const r = groundReadout({ el: { status: "value", ft: 1152.6 }, prop: { status: "value", ft: 1155.0 } });
    expect(r.parts.length).toBe(3);
    expect(r.text.includes("\n")).toBe(false);
    expect(r.text.length).toBeLessThanOrEqual(48);
  });
});

// ---------------------------------------------------------------------------
describe("NEW-2(e) — the readout and the earthwork ledger read ONE surface", () => {
  // A pad + its paving field on ground that falls to the east, plus a pond the grid
  // excludes as borrow. Exactly the B826 inputs the yield panel prices off.
  const els = [
    { id: "b", type: "building", ring: rect(0, 0, 200, 200) },
    { id: "p", type: "paving", ring: rect(200, 0, 200, 200) },
  ];
  const pondRings = [rect(600, 600, 100, 100)];
  const existAt = (pt) => 100 - pt.x / 100;   // 1 ft down per 100 ft east
  const { planes } = buildPlanes({ els, ffeFt: 103, dockDropFt: 4 });
  const grid = surfaceGrid({ planes, els, existAt, pondRings });

  it("surfaceGrid publishes the ownership set the point sampler walks", () => {
    expect(grid.owners.length).toBe(2);
    expect(grid.owners.map((g) => g.el.id)).toEqual(["b", "p"]); // building precedence first
    expect(grid.pondRings).toBe(pondRings);
  });

  it("EVERY priced footprint cell ties out to the point sample (no second derivation)", () => {
    const foot = grid.cells.filter((c) => !c.wedge && c.dzFt != null);
    expect(foot.length).toBeGreaterThan(50);
    for (const c of foot) {
      const s = sampleProposedAt(grid, { x: c.x, y: c.y }, existAt);
      expect(s.status).toBe("value");
      expect(s.elId).toBe(c.elId);
      expect(s.ft - existAt({ x: c.x, y: c.y })).toBeCloseTo(c.dzFt, 9);
    }
  });

  it("EVERY transition-wedge cell ties out too — the daylight taper is not re-derived", () => {
    const wedge = grid.cells.filter((c) => c.wedge && c.propFt != null);
    expect(wedge.length).toBeGreaterThan(10);
    for (const c of wedge) {
      const s = sampleProposedAt(grid, { x: c.x, y: c.y }, existAt);
      expect(s.status).toBe("value");
      expect(s.wedge).toBe(true);
      expect(s.ft).toBeCloseTo(c.propFt, 9);
    }
  });

  it("a pad reads its FFE exactly", () => {
    expect(sampleProposedAt(grid, { x: 100, y: 100 }, existAt).ft).toBeCloseTo(103, 9);
  });

  it("NEVER extrapolates a plane past its own element", () => {
    // far east of the paving, well beyond any daylight wedge
    const far = sampleProposedAt(grid, { x: 5000, y: 100 }, existAt);
    expect(far.status).toBe("none");
    expect(far.reason).toBe("outside");
    // and the honest answer is nothing — not the plane's value out there
    expect(far.ft).toBeUndefined();
  });

  it("a pond interior is borrow, not a graded surface", () => {
    const s = sampleProposedAt(grid, { x: 650, y: 650 }, existAt);
    expect(s.status).toBe("none");
    expect(s.reason).toBe("pond");
  });

  it("a DEM void inside a possible wedge is an honest unknown, never priced at zero", () => {
    const voidAt = (pt) => (pt.x > 400 ? null : existAt(pt));
    const g2 = surfaceGrid({ planes, els, existAt: voidAt, pondRings });
    const s = sampleProposedAt(g2, { x: 405, y: 100 }, voidAt);
    expect(s.status).toBe("none");
    expect(s.reason).toBe("void");
  });

  it("with no surface at all the sampler says so instead of guessing", () => {
    expect(sampleProposedAt(null, { x: 0, y: 0 }, existAt)).toEqual({ status: "none", reason: "nosurface" });
    expect(sampleProposedAt({ owners: [] }, { x: 0, y: 0 }, existAt).reason).toBe("nosurface");
  });

  it("the chip's delta equals proposed minus existing at that same point", () => {
    const pt = { x: 100, y: 100 };
    const s = sampleProposedAt(grid, pt, existAt);
    const e = existAt(pt);
    const r = groundReadout({ el: { status: "value", ft: e }, prop: { status: "value", ft: s.ft } });
    const dz = s.ft - e;
    expect(r.text).toContain(`${dz > 0 ? "Fill" : "Cut"} ${Math.abs(dz).toFixed(1)}`);
  });
});

// ---------------------------------------------------------------------------
describe("NEW-2 — a hung elevation request must FAIL, not hang forever (LOUD-FAILURE)", () => {
  // Found by driving the real page: a caller-supplied AbortSignal used to REPLACE
  // samplePoint's own controller, which silently disabled its timeout with it. A socket
  // that accepted and never answered therefore never settled, and the readout sat "in
  // flight" forever with no way to ever report the failure — the worst version of the
  // very symptom NEW-2 is about.
  it("times out even when the caller passes its own signal", async () => {
    const ctrl = new AbortController();
    // a stalled socket: settles only when its signal aborts, exactly as real fetch does
    const hang = (_u, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => { const e = new Error("aborted"); e.name = "AbortError"; reject(e); });
    });
    await expect(samplePoint(29.7, -95.8, { signal: ctrl.signal, timeoutMs: 30, fetchImpl: hang }))
      .rejects.toThrow(/timed out/i);
  });

  it("a CALLER abort still surfaces as an abort, so a superseded cursor move stays quiet", async () => {
    const ctrl = new AbortController();
    const fetchImpl = (u, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => {
        const e = new Error("aborted"); e.name = "AbortError"; reject(e);
      });
    });
    const p = samplePoint(29.7, -95.8, { signal: ctrl.signal, timeoutMs: 5000, fetchImpl });
    ctrl.abort();
    await expect(p).rejects.toThrow(/abort/i);
    await expect(p).rejects.toHaveProperty("name", "AbortError");
  });

  it("still returns a reading on the happy path", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ samples: [{ value: "46.5" }] }) });
    const ft = await samplePoint(29.7, -95.8, { fetchImpl });
    expect(ft).toBeCloseTo(46.5 * (3937 / 1200), 6);
  });

  it("no-data still reads as null (never a fabricated zero)", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ samples: [{ value: "NoData" }] }) });
    expect(await samplePoint(29.7, -95.8, { fetchImpl })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("NEW-1/NEW-2 ship with their matching optimization (the perf-budget rule)", () => {
  // The hover hit-test and the always-on readout added real bytes to the Site route, which
  // breached `bundle.largestChunkBytes`. The matching optimization is that the terrain
  // pipeline (terrainLayers + demGrid + contours + the worker glue) now loads ON DEMAND —
  // at the first terrain-layer toggle or the first cursor move — instead of on boot. That
  // only holds while nothing on the boot path static-imports it again, which is exactly the
  // kind of thing a later change re-introduces by accident. So: pin it.
  const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
  const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = dir + f;
    return statSync(p).isDirectory() ? walk(p + "/") : p.match(/\.(js|jsx)$/) ? [p] : [];
  });
  const files = walk(ROOT);

  it("ONLY terrainLazy.js reaches terrainLayers.js, and only dynamically", () => {
    const offenders = [];
    for (const f of files) {
      if (f.endsWith("lib/terrainLayers.js")) continue;
      const src = readFileSync(f, "utf8");
      if (/from\s+"[^"]*terrainLayers\.js"/.test(src)) offenders.push(f.slice(ROOT.length));
      if (/import\("[^"]*terrainLayers\.js"\)/.test(src) && !f.endsWith("lib/terrainLazy.js")) {
        offenders.push(`${f.slice(ROOT.length)} (dynamic, but not through terrainLazy)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the zoom gate is readable without the pipeline — terrainGate.js imports nothing", () => {
    const gate = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/terrainGate.js", import.meta.url)), "utf8");
    expect(gate).not.toMatch(/^\s*import\s/m);
    expect(gate).toMatch(/export const TERRAIN_MIN_ZOOM = 16;/);
  });

  it("the d3-contour tracer stays worker-only — contours.js must not import it back", () => {
    const paint = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/contours.js", import.meta.url)), "utf8");
    expect(paint).not.toMatch(/from "d3-contour"/);
    expect(paint).not.toMatch(/from "\.\/contourTrace\.js"/);
    const trace = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/contourTrace.js", import.meta.url)), "utf8");
    expect(trace).toMatch(/from "d3-contour"/);
  });
});
