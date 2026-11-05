import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { pruneVerdict, carryReady, ghostShouldDetach, CARRY_MS, PRUNE_IDLE_CAP_MS } from "../src/workspaces/site-planner/lib/parcelHandoff.js";

/* NEW-1 (parcel outlines lag the map when zooming) — the hand-off rules. The browser half is ui-audit/measure-parcel-zoom-lock.mjs (a per-frame reading of how far
 * the painted line sits from a lot corner); these pin the decisions it relies on. */
describe("pruneVerdict — a prune waits for the new zoom's answers, but never when there is nothing to wait for", () => {
  it("runs now when the layer is idle", () => expect(pruneVerdict({ visibleZoom: true, activeRequests: 0, ingestPending: 0 })).toBe("now"));
  it("WAITS while a cell request is in flight (the old lots are on the same ground — dropping them is the blank)", () => expect(pruneVerdict({ visibleZoom: true, activeRequests: 3, ingestPending: 0 })).toBe("wait"));
  it("WAITS while an answer is still being ingested", () => expect(pruneVerdict({ visibleZoom: true, activeRequests: 0, ingestPending: 40 })).toBe("wait"));
  it("runs now out of the draw range: nothing is requested there, so waiting would never end", () => expect(pruneVerdict({ visibleZoom: false, activeRequests: 2, ingestPending: 5 })).toBe("now"));
  it("tolerates undefined counters (an esri build without _activeRequests)", () => expect(pruneVerdict({ visibleZoom: true })).toBe("now"));
});

describe("carryReady — the previous stage's lines go only when this stage is DRAWN", () => {
  const has = (set) => (k) => set.has(k);
  const want = ["wide:a", "wide:b"];
  it("not ready before the layer has computed the view's tiles", () => expect(carryReady({ wantNow: null, hasLoaded: () => true, hasAttached: () => true, ingestPending: 0 })).toBe(false));
  it("not ready while a tile is still loading", () => expect(carryReady({ wantNow: want, hasLoaded: has(new Set(["wide:a"])), hasAttached: has(new Set(["wide:a"])), ingestPending: 0 })).toBe(false));
  it("not ready while a loaded tile's lots are still queued to draw", () => expect(carryReady({ wantNow: want, hasLoaded: () => true, hasAttached: () => true, ingestPending: 12 })).toBe(false));
  it("not ready when loaded but not yet attached", () => expect(carryReady({ wantNow: want, hasLoaded: () => true, hasAttached: has(new Set(["wide:a"])), ingestPending: 0 })).toBe(false));
  it("ready when every tile is loaded, attached and the queue is empty", () => expect(carryReady({ wantNow: want, hasLoaded: () => true, hasAttached: () => true, ingestPending: 0 })).toBe(true));
  it("an empty view (no tiles needed) is trivially ready", () => expect(carryReady({ wantNow: [], hasLoaded: () => false, hasAttached: () => false, ingestPending: 0 })).toBe(true));
});

describe("ghostShouldDetach — a carried lot that is a live close-stage lot again stays", () => {
  it("detaches an orphan", () => expect(ghostShouldDetach({ heldByLayer: false, visibleZoom: true })).toBe(true));
  it("detaches a held lot while the layer is still out of range", () => expect(ghostShouldDetach({ heldByLayer: true, visibleZoom: false })).toBe(true));
  it("keeps a lot the layer holds once back in range", () => expect(ghostShouldDetach({ heldByLayer: true, visibleZoom: true })).toBe(false));
});

describe("caps", () => {
  it("a county that never answers cannot pin stale lines or every lot ever seen", () => {
    expect(CARRY_MS).toBeGreaterThan(0); expect(CARRY_MS).toBeLessThanOrEqual(8000);
    expect(PRUNE_IDLE_CAP_MS).toBeGreaterThan(0); expect(PRUNE_IDLE_CAP_MS).toBeLessThanOrEqual(15000);
  });
});

/* WIRING — Leaflet cannot run in plain Node, so the three seams the fix depends on are asserted on the source. Each was the cause of a measured blank. */
describe("wiring (each seam was a measured blank frame run)", () => {
  const display = readFileSync(new URL("../src/workspaces/site-planner/lib/parcelDisplay.js", import.meta.url), "utf8");
  const wide = readFileSync(new URL("../src/workspaces/site-planner/lib/parcelWideLayer.js", import.meta.url), "utf8");
  it("the close layer hands the lots it lets go of out of range to the wide layer instead of detaching them", () => {
    expect(display).toMatch(/_wide\.carry\(hold\)/);
    expect(display).toMatch(/!this\._visibleZoom\(\)/);
  });
  it("the prune asks the verdict and waits for the layer's own `load`", () => {
    expect(display).toMatch(/pruneVerdict\(/);
    expect(display).toMatch(/layer\.on\("load", pruneWait\)/);
  });
  it("the close tile layer is floored at the wide floor, not the close floor (a GridLayer drops every canvas below its minZoom)", () => {
    expect(display).toMatch(/Math\.min\(layer\.options\.minZoom, layer\._wide\.wideFloor\)/);
  });
  it("the wide layer keeps the previous stage's tiles under the new one and releases on ready or the cap", () => {
    expect(wide).toMatch(/carryKeys\.add\(key\)/);
    expect(wide).toMatch(/carryReady\(/);
    expect(wide).toMatch(/setTimeout\(releaseCarry, CARRY_MS\)/);
  });
  it("the wide→close release waits two frames after the close layer's `load` (its canvases repaint a frame or more later)", () => {
    expect(wide).toMatch(/layer\.on\("load", releaseSoon\)/);
  });
});
