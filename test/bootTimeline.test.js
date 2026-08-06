/* The boot-timeline instrument's pure half (NEW-1, speed program phase 3).
 *
 * The browser-driven part needs Chromium and four seconds of a real boot; these are the parts that
 * can go red in `npm test`, and they are the parts whose failure would be INVISIBLE in the report:
 * a phase rule that stops matching does not crash, it silently moves milliseconds into
 * UNATTRIBUTED or — far worse — into a neighbouring named bucket, and the table still adds up.
 *
 * The three properties asserted here are the three the whole instrument rests on:
 *   1. the source-map decoder actually resolves a generated position to its source file;
 *   2. every sample is charged SOMEWHERE, and what cannot be named is charged to UNATTRIBUTED;
 *   3. the wall spine's segments sum EXACTLY to time-to-first-drag, in measured order.
 */
import { describe, it, expect } from "vitest";
import { decodeVlq, decodeMappings, makeSourceLookup, normalizeSource } from "../ui-audit/lib/sourceMapIndex.mjs";
import {
  phaseForFrame, attributeProfile, spineSegments, classifyRequest, networkSummary, crossTab,
  UNATTRIBUTED, NATIVE_PHASE, MAX_ALIGNMENT_UNCERTAINTY_MS,
} from "../ui-audit/lib/bootTimeline.mjs";

describe("base64-VLQ decoding", () => {
  it("decodes the canonical signed values", () => {
    expect(decodeVlq("A")).toEqual([0]);
    expect(decodeVlq("C")).toEqual([1]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
    // 5-bit continuation: "gB" = 16 (continuation) then 1 → 32 >> 1 = 16
    expect(decodeVlq("gB")).toEqual([16]);
  });

  it("stops at an unrecognised character instead of throwing", () => {
    expect(decodeVlq("A!")).toEqual([0]);
    expect(decodeVlq("")).toEqual([]);
  });
});

describe("source-map lookup", () => {
  // Two generated lines. Line 0 has mappings at columns 0 and 5 (sources 0 and 1); line 1 carries
  // the source index forward as a delta, which is the part a naive decoder gets wrong.
  const map = {
    sources: ["../../src/workspaces/site-planner/SitePlanner.jsx", "../../node_modules/react-dom/index.js"],
    mappings: "AAAA,KCAA;AAAA",
  };

  it("resolves a generated position to its source file", () => {
    const at = makeSourceLookup(map);
    expect(at(0, 0)).toBe("src/workspaces/site-planner/SitePlanner.jsx");
    expect(at(0, 4)).toBe("src/workspaces/site-planner/SitePlanner.jsx");
    expect(at(0, 5)).toBe("node_modules/react-dom/index.js");
    expect(at(0, 900)).toBe("node_modules/react-dom/index.js");   // last mapping at or before wins
  });

  it("returns null for a line with no mappings and for a column before the first", () => {
    const at = makeSourceLookup({ sources: ["a.js"], mappings: "IAAA" });   // first segment at col 4
    expect(at(0, 0)).toBe(null);
    expect(at(7, 0)).toBe(null);
  });

  it("normalises vendor and app paths to something a phase rule can match", () => {
    expect(normalizeSource("../../../node_modules/leaflet/dist/leaflet-src.js")).toBe("node_modules/leaflet/dist/leaflet-src.js");
    expect(normalizeSource("../../src/app/Shell.jsx")).toBe("src/app/Shell.jsx");
  });
});

describe("phase attribution", () => {
  it("names the phases the brief asks for", () => {
    expect(phaseForFrame({ functionName: "x", url: "u" }, "node_modules/react-dom/client.js")).toBe("React render & commit");
    expect(phaseForFrame({ functionName: "x", url: "u" }, "node_modules/clipper-lib/clipper.js")).toBe("Geometry vendor (Clipper)");
    expect(phaseForFrame({ functionName: "x", url: "u" }, "src/workspaces/site-planner/lib/roadGeometry.js")).toBe("Site geometry (roads · ponds · contours)");
    expect(phaseForFrame({ functionName: "x", url: "u" }, "src/workspaces/site-planner/lib/parcelSnapshot.js")).toBe("Model load & normalisation");
    expect(phaseForFrame({ functionName: "x", url: "u" }, "src/workspaces/site-planner/SitePlanner.jsx")).toBe("Planner render body (SitePlanner.jsx)");
    expect(phaseForFrame({ functionName: "x", url: "u" }, "src/workspaces/site-planner/MapFinder.jsx")).toBe("Map finder (MapFinder.jsx)");
  });

  it("keeps V8's own frames as named answers, never as UNATTRIBUTED", () => {
    expect(phaseForFrame({ functionName: "(idle)" }, null)).toMatch(/^idle/);
    expect(phaseForFrame({ functionName: "(program)" }, null)).toMatch(/^V8/);
    expect(phaseForFrame({ functionName: "(garbage collector)" }, null)).toBe("garbage collection");
  });

  it("separates a native frame from a frame we simply could not name", () => {
    expect(phaseForFrame({ functionName: "setAttribute", url: "" }, null)).toBe(NATIVE_PHASE);
    expect(phaseForFrame({ functionName: "Qse", url: "http://x/assets/SitePlannerApp-abc.js" }, null)).toBe(UNATTRIBUTED);
  });

  it("charges every sample somewhere, and lists the unattributed ones BY NAME", () => {
    const profile = {
      startTime: 1000,
      nodes: [
        { id: 1, callFrame: { functionName: "(idle)" } },
        { id: 2, callFrame: { functionName: "render", url: "http://x/assets/index.js", lineNumber: 0, columnNumber: 0 } },
        { id: 3, callFrame: { functionName: "Qse", url: "http://x/assets/mystery.js", lineNumber: 6 } },
      ],
      samples: [1, 2, 3, 3],
      timeDeltas: [1000, 2000, 3000, 4000],   // µs
    };
    const out = attributeProfile(profile, (f) => (String(f.url || "").includes("index") ? "node_modules/react-dom/x.js" : null));
    const total = out.phases.reduce((a, p) => a + p.ms, 0);
    expect(total).toBeCloseTo(out.totalMs, 1);
    expect(out.totalMs).toBe(10);                       // 10_000 µs, nothing dropped
    const un = out.phases.find((p) => p.phase === UNATTRIBUTED);
    expect(un.ms).toBe(7);
    expect(out.unattributed[0].fn).toMatch(/Qse/);
    expect(out.unattributed[0].ms).toBe(7);
  });
});

describe("the wall spine", () => {
  const marks = { responseEnd: 20, firstScript: 40, fcp: 900, canvasExists: 3800, canvasDrawn: 4100, pointerDown: 5600, pointerUp: 7100, dragServiced: 7400 };

  it("sums EXACTLY to time-to-first-drag", () => {
    const { segments } = spineSegments(marks);
    expect(+segments.reduce((a, s) => a + s.ms, 0).toFixed(1)).toBe(7400);
  });

  it("orders by MEASUREMENT, so a late 'canvas drawn' lands where it happened", () => {
    // The harness presses as soon as the canvas ELEMENT exists, so on a slow boot the canvas
    // finishes drawing AFTER the press. A spine that assumed the tidy order would emit a negative
    // segment or, worse, a plausible positive one in the wrong place.
    const late = { ...marks, canvasDrawn: 6000 };
    const { segments } = spineSegments(late);
    const order = segments.map((s) => s.mark);
    expect(order.indexOf("canvasDrawn")).toBeGreaterThan(order.indexOf("pointerDown"));
    expect(segments.every((s) => s.ms >= 0)).toBe(true);
    expect(+segments.reduce((a, s) => a + s.ms, 0).toFixed(1)).toBe(7400);
  });

  it("reports a mark that never fired rather than interpolating one", () => {
    const { segments, missing } = spineSegments({ ...marks, canvasDrawn: undefined });
    expect(missing).toContain("canvasDrawn");
    expect(segments.some((s) => s.mark === "canvasDrawn")).toBe(false);
  });
});

describe("network classification", () => {
  it("splits the categories the brief names", () => {
    const base = "http://localhost:4173/";
    expect(classifyRequest(`${base}assets/index-abc.js`, base)).toBe("app JS chunk");
    expect(classifyRequest("https://server.arcgisonline.com/tile/1/2/3", base)).toBe("basemap tiles");
    expect(classifyRequest("https://xyz.supabase.co/rest/v1/sites", base)).toBe("Supabase");
    expect(classifyRequest("https://msc.fema.gov/arcgis/rest/x", base)).toBe("GIS services");
    expect(classifyRequest("https://hazards.fema.gov/gis/nfhl/x", base)).toBe("GIS services");
  });

  it("counts failures separately from successes", () => {
    const rows = networkSummary([
      { url: "https://server.arcgisonline.com/a", failed: true },
      { url: "https://server.arcgisonline.com/b", startMs: 10, endMs: 20, bytes: 100 },
    ], "http://localhost:4173/");
    expect(rows[0].count).toBe(2);
    expect(rows[0].failed).toBe(1);
  });
});

describe("the cross-tab refuses to report what it cannot align", () => {
  it("suppresses itself when the clock pairing is too loose", () => {
    const out = crossTab([], [], { monoZeroUs: 0, uncertaintyMs: MAX_ALIGNMENT_UNCERTAINTY_MS + 1 });
    expect(out.rows).toBe(null);
    expect(out.why).toMatch(/alignment/);
  });

  it("suppresses itself when there is no alignment at all", () => {
    expect(crossTab([], [], { monoZeroUs: NaN, uncertaintyMs: 1 }).rows).toBe(null);
  });

  it("attributes a segment from the samples that fall inside it", () => {
    const timeline = [
      { tUs: 1_000_000, phase: "A" }, { tUs: 1_100_000, phase: "A" }, { tUs: 1_900_000, phase: "B" },
    ];
    const segments = [{ mark: "m", from: "start", to: "m", fromMs: 0, at: 2000, ms: 2000 }];
    const { rows } = crossTab(timeline, segments, { monoZeroUs: 0, uncertaintyMs: 1 });
    expect(rows[0].phases.map((p) => p.phase)).toEqual(["A", "B"]);
    expect(rows[0].phases[0].ms + rows[0].phases[1].ms).toBeCloseTo(2000, 1);
  });
});
