import { describe, it, expect } from "vitest";
import { resolveDraftStepBack } from "../src/workspaces/site-planner/lib/drafts.js";

// The pure "step back the last placed vertex" resolver behind the Site Planner's Bluebeam-style
// mid-draw undo (Backspace/Delete AND Ctrl/⌘-Z). It must (a) trim exactly one point from whatever
// draft is active, (b) collapse a draft to null once its last point is gone, and (c) — the
// load-bearing contract — return null when NO draft is active, so Ctrl-Z falls through to a real
// global undo instead of being silently swallowed.
const P = (n) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));

describe("resolveDraftStepBack — Bluebeam mid-draw vertex step-back", () => {
  it("returns null with no active draft (Ctrl-Z must fall through to global undo)", () => {
    expect(resolveDraftStepBack({})).toBeNull();
    expect(resolveDraftStepBack(undefined)).toBeNull();
    expect(resolveDraftStepBack({ tool: "select" })).toBeNull();
    // A tool selected but nothing placed yet is still "no draft".
    expect(resolveDraftStepBack({ tool: "measure", measDraft: [] })).toBeNull();
    expect(resolveDraftStepBack({ draftPoly: [] })).toBeNull();
    expect(resolveDraftStepBack({ mkPoly: { pts: [] } })).toBeNull();
  });

  it("trims a boundary polygon (draftPoly) one point at a time, then cancels to null", () => {
    expect(resolveDraftStepBack({ draftPoly: P(3) })).toEqual({ target: "draftPoly", next: P(2) });
    // last point → whole draft cancelled
    expect(resolveDraftStepBack({ draftPoly: P(1) })).toEqual({ target: "draftPoly", next: null });
  });

  it("trims an area-element polygon (draftElPoly), preserving its non-points fields", () => {
    const d = { type: "building", pts: P(3) };
    expect(resolveDraftStepBack({ draftElPoly: d })).toEqual({ target: "draftElPoly", next: { type: "building", pts: P(2) } });
    expect(resolveDraftStepBack({ draftElPoly: { type: "pond", pts: P(1) } })).toEqual({ target: "draftElPoly", next: null });
  });

  it("trims a markup polyline/polygon (mkPoly), preserving kind/style", () => {
    const m = { kind: "mpolygon", stroke: "#f00", pts: P(4) };
    expect(resolveDraftStepBack({ mkPoly: m })).toEqual({ target: "mkPoly", next: { kind: "mpolygon", stroke: "#f00", pts: P(3) } });
    expect(resolveDraftStepBack({ mkPoly: { kind: "mpolyline", pts: P(1) } })).toEqual({ target: "mkPoly", next: null });
  });

  it("trims a centerline road (draftRoadPts) then cancels", () => {
    expect(resolveDraftStepBack({ draftRoadPts: P(2) })).toEqual({ target: "draftRoadPts", next: P(1) });
    expect(resolveDraftStepBack({ draftRoadPts: P(1) })).toEqual({ target: "draftRoadPts", next: null });
  });

  it("trims a freehand easement (easeDraft.pts), collapsing to { pts } shape", () => {
    expect(resolveDraftStepBack({ easeDraft: { pts: P(3) } })).toEqual({ target: "easeDraft", next: { pts: P(2) } });
    expect(resolveDraftStepBack({ easeDraft: { pts: P(1) } })).toEqual({ target: "easeDraft", next: null });
  });

  it("NEW: trims a parcel-edge easement RUN (easeEdges.idx), preserving parcelId", () => {
    const s = { easeEdges: { parcelId: "pc1", idx: [0, 1, 2] } };
    expect(resolveDraftStepBack(s)).toEqual({ target: "easeEdges", next: { parcelId: "pc1", idx: [0, 1] } });
    // last edge removed → run cancelled
    expect(resolveDraftStepBack({ easeEdges: { parcelId: "pc1", idx: [3] } })).toEqual({ target: "easeEdges", next: null });
  });

  it("NEW: trims the ditch cross-section pending point (xsecPts) only while xsecMode is on", () => {
    expect(resolveDraftStepBack({ xsecMode: true, xsecPts: P(1) })).toEqual({ target: "xsecPts", next: [] });
    // xsecPts present but the tool is off → not this branch's business
    expect(resolveDraftStepBack({ xsecMode: false, xsecPts: P(1) })).toBeNull();
  });

  it("trace / split / measure branches are tool-gated (no accidental trim when the tool is off)", () => {
    expect(resolveDraftStepBack({ traceMode: true, tracePts: P(2) })).toEqual({ target: "tracePts", next: P(1) });
    expect(resolveDraftStepBack({ traceMode: false, tracePts: P(2) })).toBeNull();
    expect(resolveDraftStepBack({ tool: "split", splitPath: P(3) })).toEqual({ target: "splitPath", next: P(2) });
    expect(resolveDraftStepBack({ tool: "select", splitPath: P(3) })).toBeNull();
    expect(resolveDraftStepBack({ tool: "measure", measDraft: P(2) })).toEqual({ target: "measDraft", next: P(1) });
    expect(resolveDraftStepBack({ tool: "measure", measDraft: [] })).toBeNull();
  });

  it("does not mutate the input draft (returns fresh arrays/objects)", () => {
    const pts = P(3);
    const s = { draftPoly: pts };
    const r = resolveDraftStepBack(s);
    expect(r.next).not.toBe(pts);
    expect(pts.length).toBe(3); // original untouched
  });
});
