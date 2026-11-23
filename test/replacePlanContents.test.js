// AUDIT BATCH G2 — the whole-plan restores share ONE function, the element seam has a named home, and the two "latest value" flavours stay distinct.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { plannerSource } from "./helpers/plannerSource.js";
import { seamElements } from "../src/workspaces/site-planner/lib/elsSeam.js";
import { useLatestRender, useLatestEffect } from "../src/workspaces/site-planner/lib/useLatest.js";

const src = plannerSource();
describe("replacePlanContents is the only whole-plan restore", () => {
  it("is defined once and used by undo/redo, take-over, version restore and seed adoption", () => {
    expect(src.match(/const replacePlanContents = /g)).toHaveLength(1);
    expect(src.match(/replacePlanContents\(/g).length).toBeGreaterThanOrEqual(4);
  });
  it("no other place spells the whole-plan setters out in a row (the definition itself + the Standards 'Undo', which restores three collections, not the plan)", () => {
    expect(src.match(/setParcels\([^)]*\); setElsRaw\([^)]*\); setMeasures\(/g)?.length || 0).toBe(2);
  });
  it("guards every collection with `|| []`, deletedIds only when asked", () => {
    const body = src.match(/const replacePlanContents = [\s\S]*?\n  \};/)[0];
    for (const k of ["parcels", "els", "measures", "callouts", "markups", "sheetOverlays", "deletedIds"]) expect(body).toContain(`c.${k} || []`);
    expect(body).toContain("if (withDeleted)");
  });
});

describe("seamElements", () => {
  const ctx = (extra = {}) => ({ restrip: undefined, rampSeatCtx: () => ({ dockSidesOf: () => [], dockHeightIn: 48, onDrop() {}, runOf: () => null }), dockSidesOf: () => [], dockIn: 48, ...extra });
  it("applies a value or an updater and returns the elements", () => {
    const prev = [{ id: "a", type: "paving", cx: 0, cy: 0, w: 10, h: 10, rot: 0 }];
    expect(seamElements(prev, (p) => p, ctx())).toEqual(prev);
    const next = seamElements(prev, [...prev, { id: "b", type: "paving", cx: 50, cy: 0, w: 10, h: 10, rot: 0 }], ctx());
    expect(next.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("useLatest", () => {
  it("both flavours return a ref holding the value (render flavour at once)", () => {
    let r1, r2;
    const C = () => { r1 = useLatestRender(7); r2 = useLatestEffect(9); return null; };
    renderToStaticMarkup(createElement(C));
    expect(r1.current).toBe(7);
    expect(r2.current).toBe(9);
  });
});
