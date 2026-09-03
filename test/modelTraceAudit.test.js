/* Model workspace — Stage 3 (NEW-1, owner brief 2026-09-03): trace precedents/dependents.
 * Exercises lib/traceAudit.js against the REAL formula engine + sheetEngine.js's `graph`, never
 * a stub graph — a change on either side of the wire shows up here.
 */
import { describe, it, expect } from "vitest";
import { createSheet, setRaw, commitCellText } from "../src/workspaces/model/lib/sheetModel.js";
import { defineName } from "../src/workspaces/model/lib/namedRanges.js";
import { evaluateWorkbook } from "../src/workspaces/model/lib/sheetEngine.js";
import {
  TRACE_STEP_CAP, cellKey, parseCellKey, stepTrace, beginOrStepTrace, renderableTrace,
} from "../src/workspaces/model/lib/traceAudit.js";

function wb(sheets, activeSheetId = sheets[0].id) {
  return { sheets, activeSheetId };
}

describe("cellKey / parseCellKey", () => {
  it("round-trips a sheetId/row/col triple", () => {
    expect(cellKey("sheet1", 4, 2)).toBe("sheet1:4:2");
    expect(parseCellKey("sheet1:4:2")).toEqual({ sheetId: "sheet1", row: 4, col: 2 });
  });
});

describe("beginOrStepTrace / stepTrace — precedents, level-at-a-time", () => {
  it("level 1 shows only the ORIGIN cell's own direct precedents, never a level further", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100"); // A1
    s = setRaw(s, 0, 2, "0.05"); // C1
    s = defineName(s, "Rate", { r1: 1, c1: 3, r2: 1, c2: 3 }); // C1
    s = commitCellText(s, 0, 3, "=A1*Rate"); // D1
    s = commitCellText(s, 0, 4, "=D1+1"); // E1
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const graph = r.graph;

    let t = beginOrStepTrace(null, "precedents", "sheet1", 0, 4, graph); // trace E1
    let render = renderableTrace(t, graph, "sheet1");
    expect(render.level).toBe(1);
    expect(render.arrows).toHaveLength(1);
    expect(render.arrows[0]).toMatchObject({ toCell: { row: 0, col: 4 }, fromRect: { r1: 0, c1: 3, r2: 0, c2: 3 } });

    t = beginOrStepTrace(t, "precedents", "sheet1", 0, 4, graph); // click again — level 2
    render = renderableTrace(t, graph, "sheet1");
    expect(render.level).toBe(2);
    expect(render.arrows).toHaveLength(3); // D1->E1, A1->D1, Rate(C1)->D1
    const named = render.arrows.find((a) => a.kind === "name");
    expect(named).toMatchObject({ label: "Rate", toCell: { row: 0, col: 3 } });

    t = beginOrStepTrace(t, "precedents", "sheet1", 0, 4, graph); // level 3 — nothing left
    expect(t.noFurther).toBe(true);
    expect(t.levels).toHaveLength(3); // unchanged — no new level pushed
  });

  it("switching from precedents to dependents on the SAME cell starts fresh at level 1", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "10");
    s = commitCellText(s, 0, 1, "=A1*2"); // B1 — has a precedent (A1)
    s = commitCellText(s, 0, 2, "=B1+1"); // C1 — B1's own dependent
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const graph = r.graph;
    let t = beginOrStepTrace(null, "precedents", "sheet1", 0, 1, graph); // trace B1's precedents
    expect(t.mode).toBe("precedents");
    expect(t.levels.length - 1).toBe(1);
    expect([...t.visited]).toContain(cellKey("sheet1", 0, 0)); // A1
    t = beginOrStepTrace(t, "dependents", "sheet1", 0, 1, graph); // same cell, different mode
    expect(t.mode).toBe("dependents");
    expect(t.levels.length - 1).toBe(1); // fresh level 1, not extended — never carries precedents-mode state over
    expect([...t.visited]).toContain(cellKey("sheet1", 0, 2)); // C1, not A1
  });

  it("re-invoking on a DIFFERENT cell also starts fresh, never extends the old origin's trace", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "10"); s = setRaw(s, 1, 0, "20");
    s = commitCellText(s, 0, 1, "=A1*2");
    s = commitCellText(s, 1, 1, "=A2*3");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const graph = r.graph;
    let t = beginOrStepTrace(null, "precedents", "sheet1", 0, 1, graph); // B1
    t = beginOrStepTrace(t, "precedents", "sheet1", 1, 1, graph); // B2 — a different cell
    expect(t.originKey).toBe(cellKey("sheet1", 1, 1));
    expect(t.levels.length - 1).toBe(1);
  });

  it("tracing precedents on a non-formula (literal) cell finds nothing — no crash, no arrows", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "100");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const t = beginOrStepTrace(null, "precedents", "sheet1", 0, 0, r.graph);
    expect(t.noFurther).toBe(true);
    const render = renderableTrace(t, r.graph, "sheet1");
    expect(render.arrows).toHaveLength(0);
  });
});

describe("trace dependents — works from an INPUT cell, not just a formula cell", () => {
  it("finds every formula that reads a plain literal cell, including a name's own target", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "5"); // A1, a plain literal — no formula of its own
    s = commitCellText(s, 0, 1, "=A1*2"); // B1
    s = commitCellText(s, 1, 1, "=A1+1"); // B2
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const graph = r.graph;
    const t = beginOrStepTrace(null, "dependents", "sheet1", 0, 0, graph);
    const render = renderableTrace(t, graph, "sheet1");
    expect(render.arrows.map((a) => a.toCell)).toEqual(
      expect.arrayContaining([{ row: 0, col: 1 }, { row: 1, col: 1 }]),
    );
    expect(render.arrows).toHaveLength(2);
  });

  it("dependent's label reads the NAME, not the raw address, when it read this cell BY a name", () => {
    let s = createSheet();
    s = setRaw(s, 4, 1, "250000000"); // B5
    s = defineName(s, "LandCost", { r1: 5, c1: 2, r2: 5, c2: 2 }); // B5
    s = commitCellText(s, 0, 0, "=LandCost*2"); // A1
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const t = beginOrStepTrace(null, "dependents", "sheet1", 4, 1, r.graph); // trace B5
    const render = renderableTrace(t, r.graph, "sheet1");
    expect(render.arrows).toHaveLength(1);
    expect(render.arrows[0]).toMatchObject({ label: "LandCost", kind: "name" });
  });
});

describe("cross-sheet — never an arrow, always a distinct navigable marker", () => {
  function crossSheetWorkbook() {
    let s1 = createSheet(); s1 = setRaw(s1, 0, 0, "10"); // Sheet1!A1
    let s2 = createSheet(); s2 = commitCellText(s2, 0, 0, "=Sheet1!A1*2"); // Sheet2!A1
    return evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s1 }, { id: "sheet2", name: "Sheet2", sheet: s2 }]));
  }

  it("precedents: a cross-sheet reference renders as a marker on the ORIGIN's own sheet, not an arrow", () => {
    const r = crossSheetWorkbook();
    const t = beginOrStepTrace(null, "precedents", "sheet2", 0, 0, r.graph); // Sheet2!A1's precedents
    const render = renderableTrace(t, r.graph, "sheet2");
    expect(render.arrows).toHaveLength(0);
    expect(render.markers).toHaveLength(1);
    expect(render.markers[0]).toMatchObject({ direction: "in", targetSheetId: "sheet1", targetCell: { row: 0, col: 0 }, label: "Sheet1!A1" });
  });

  it("dependents: the SAME edge, viewed from the other sheet, is an OUTGOING marker", () => {
    const r = crossSheetWorkbook();
    const t = beginOrStepTrace(null, "dependents", "sheet1", 0, 0, r.graph); // Sheet1!A1's dependents
    const render = renderableTrace(t, r.graph, "sheet1");
    expect(render.arrows).toHaveLength(0);
    expect(render.markers).toHaveLength(1);
    expect(render.markers[0]).toMatchObject({ direction: "out", targetSheetId: "sheet2", targetCell: { row: 0, col: 0 } });
  });

  it("a marker's own target navigates correctly — nothing about it is drawn until you're actually there", () => {
    const r = crossSheetWorkbook();
    const t = beginOrStepTrace(null, "precedents", "sheet2", 0, 0, r.graph);
    // Nothing renders for sheet2's OWN precedent chain if you ask sheetEngine to render sheet1 instead —
    // the trace still holds the cell, it just has nowhere to draw on a sheet it doesn't touch here.
    const renderOnSheet1 = renderableTrace(t, r.graph, "sheet1");
    expect(renderOnSheet1.arrows).toHaveLength(0);
    expect(renderOnSheet1.markers).toHaveLength(0);
  });
});

describe("TRACE_STEP_CAP — a very large fan-out never locks up a single step", () => {
  it("caps the number of NEW cells one step discovers and marks the trace truncated", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1"); // A1 — the shared constant every row below reads
    const rows = TRACE_STEP_CAP + 50;
    s = { ...s, rowCount: Math.max(s.rowCount, rows) };
    for (let r = 0; r < rows; r++) s = commitCellText(s, r, 1, "=A1+1"); // B1..B(cap+50), each reads A1
    const wbEval = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const t = beginOrStepTrace(null, "dependents", "sheet1", 0, 0, wbEval.graph); // trace A1's dependents
    expect(t.truncated).toBe(true);
    expect(t.levels[t.levels.length - 1].length).toBe(TRACE_STEP_CAP);
    // The overlay only ever draws what was actually revealed — never more than the cap.
    const render = renderableTrace(t, wbEval.graph, "sheet1");
    expect(render.arrows.length).toBeLessThanOrEqual(TRACE_STEP_CAP);
    expect(render.truncated).toBe(true);
  }, 20000);
});

describe("dedupe — a formula referencing the same cell twice draws ONE arrow, not two", () => {
  it("=A1+A1 collapses to a single precedent hop", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "5");
    s = commitCellText(s, 0, 1, "=A1+A1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const t = beginOrStepTrace(null, "precedents", "sheet1", 0, 1, r.graph);
    const render = renderableTrace(t, r.graph, "sheet1");
    expect(render.arrows).toHaveLength(1);
  });
});

describe("stepTrace — a plain step over an already-fully-explored frontier is a safe no-op", () => {
  it("returns noFurther without corrupting levels/visited", () => {
    let s = createSheet();
    s = setRaw(s, 0, 0, "1");
    const r = evaluateWorkbook(wb([{ id: "sheet1", name: "Sheet1", sheet: s }]));
    const t0 = { mode: "precedents", originSheetId: "sheet1", originKey: "sheet1:0:0", levels: [["sheet1:0:0"]], visited: new Set(["sheet1:0:0"]), truncated: false, noFurther: false };
    const t1 = stepTrace(t0, r.graph);
    expect(t1.noFurther).toBe(true);
    expect(t1.levels).toBe(t0.levels); // unchanged reference — nothing to add
  });
});
