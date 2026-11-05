/* B2530690 — the Schedule page (public/sequence/index.html) cannot import from src/, so the shared range-selection
 * model + edge-scroll speed are inlined between the RANGE-SELECTION markers by scripts/sync-sequence-selection.mjs.
 * This fails the build if that copy drifts from src/shared/selection/* (one model, three surfaces — the Spreadsheet,
 * the Schedule grid and the Notes tables). Also pins that the Spreadsheet's import path still resolves to it. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSyncedHtml } from "../scripts/sync-sequence-selection.mjs";
import * as model from "../src/workspaces/model/lib/selectionModel.js";
import * as shared from "../src/shared/selection/rangeSelection.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("inlined range selection", () => {
  it("public/sequence/index.html carries exactly the shared source (run: node scripts/sync-sequence-selection.mjs)", () => {
    const html = read("public/sequence/index.html");
    const srcs = ["src/shared/selection/rangeSelection.js", "src/shared/selection/edgeScroll.js"].map(read);
    expect(buildSyncedHtml(srcs, html) === html).toBe(true);
  });
  it("the Spreadsheet's selectionModel path IS the shared module (no second implementation)", () => {
    for (const k of Object.keys(shared)) expect(model[k]).toBe(shared[k]);
  });
});

describe("the helpers the Schedule grid and the Notes tables added", () => {
  const sel = shared.makeSelection({ r1: 5, r2: 5, c1: 1, c2: 1 }, [{ r1: 0, r2: 1, c1: 0, c2: 2 }, { r1: 9, r2: 9, c1: 0, c2: 2 }]);
  it("selRowsOf — every distinct row of every range, ascending", () => {
    expect(shared.selRowsOf(sel, 100)).toEqual([0, 1, 5, 9]);
    expect(shared.selRowsOf(sel, 5)).toEqual([0, 1, 5]);
  });
  it("selEdgesAt — a cell reports the outside edges of the range(s) that hold it", () => {
    expect(shared.selEdgesAt(sel, 0, 0)).toEqual({ top: true, bottom: false, left: true, right: false });
    expect(shared.selEdgesAt(sel, 1, 2)).toEqual({ top: false, bottom: true, left: false, right: true });
    expect(shared.selEdgesAt(sel, 5, 1)).toEqual({ top: true, bottom: true, left: true, right: true });
    expect(shared.selEdgesAt(sel, 3, 1)).toEqual({ top: false, bottom: false, left: false, right: false });
  });
  it("selIsRange — several ranges, or a range bigger than a cell", () => {
    expect(shared.selIsRange(null)).toBe(false);
    expect(shared.selIsRange({ r1: 1, r2: 1, c1: 2, c2: 2 })).toBe(false);
    expect(shared.selIsRange({ r1: 1, r2: 2, c1: 2, c2: 2 })).toBe(true);
    expect(shared.selIsRange({ r1: 1, r2: 1, c1: 2, c2: 2, extra: [{ r1: 4, r2: 4, c1: 0, c2: 0 }] })).toBe(true);
  });
});
