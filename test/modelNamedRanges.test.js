/* lib/namedRanges.js — the pure named-ranges model (Model workspace, Stage 3 pt 2, NEW-1). See
 * that file's own header for the scope decision (workbook-scoped), the storage shape (1-based
 * rects), and why deleting a name never blocks or rewrites formulas. */
import { describe, it, expect } from "vitest";
import { createSheet, commitCellText } from "../src/workspaces/model/lib/sheetModel.js";
import {
  validateNameText, defineName, retargetName, deleteName, renameName, namesList, nameUsageCount,
  rectFromSelRange, rectToSelRange, rectToAddressText, shiftNamesForStructuralChange,
  RESERVED_NAME_PREFIXES,
} from "../src/workspaces/model/lib/namedRanges.js";

describe("validateNameText — naming rules, each with its own reason", () => {
  it("accepts a normal name", () => {
    expect(validateNameText("LandCost", createSheet())).toMatchObject({ ok: true, key: "landcost" });
  });
  it("rejects empty text", () => {
    expect(validateNameText("   ", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/give the name/i) });
  });
  it("rejects a name starting with a digit", () => {
    expect(validateNameText("1Cost", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/start with a digit/i) });
  });
  it("rejects a name containing a space", () => {
    expect(validateNameText("Land Cost", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/space/i) });
  });
  it("rejects punctuation outside letters/digits/underscore/period", () => {
    expect(validateNameText("Land-Cost", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/letters, numbers, underscores/i) });
    expect(validateNameText("Cost!", createSheet())).toMatchObject({ ok: false });
  });
  it("rejects a name shaped like a cell address (A1, XFD1048576)", () => {
    expect(validateNameText("A1", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/cell address/i) });
    expect(validateNameText("XFD1048576", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/cell address/i) });
    // Case-insensitive, and $-anchored forms too — same shape either way.
    expect(validateNameText("a1", createSheet())).toMatchObject({ ok: false });
    expect(validateNameText("$A$1", createSheet())).toMatchObject({ ok: false });
  });
  it("rejects TRUE/FALSE (case-insensitive)", () => {
    expect(validateNameText("TRUE", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/reserved word/i) });
    expect(validateNameText("false", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/reserved word/i) });
  });
  it("rejects a built-in function name", () => {
    expect(validateNameText("SUM", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/built-in function/i) });
    expect(validateNameText("if", createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(/built-in function/i) });
  });
  it("rejects a duplicate (case-insensitive) unless excluded", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(validateNameText("landcost", s)).toMatchObject({ ok: false, reason: expect.stringMatching(/already exists/i) });
    // Editing the SAME name (excludeKey) is not a collision with itself.
    expect(validateNameText("LandCost", s, { excludeKey: "landcost" })).toMatchObject({ ok: true });
  });
  it("XFE1/ABCD1/A0/A1048577 are NOT valid addresses, so they're legal names (they read as plain identifiers)", () => {
    expect(validateNameText("XFE1", createSheet())).toMatchObject({ ok: true });
    expect(validateNameText("ABCD1", createSheet())).toMatchObject({ ok: true });
  });
  // spreadsheet-live-data-refs — RESERVED_NAME_PREFIXES (Site/Plan/Comp/Schedule) are what a
  // project-derived built-in name (lib/projectRefs.js) lives under; a user name starting with one
  // of them is refused here, at the ONE naming-rule gate, so a collision can never be CREATED.
  it("rejects a name starting with a reserved project-data prefix, case-insensitively", () => {
    for (const p of RESERVED_NAME_PREFIXES) {
      expect(validateNameText(`${p}.Foo`, createSheet())).toMatchObject({ ok: false, reason: expect.stringMatching(new RegExp(p, "i")) });
      expect(validateNameText(`${p.toLowerCase()}.Foo`, createSheet())).toMatchObject({ ok: false });
    }
  });
  it("does not reject a bare reserved word with no dot, or a name merely starting with the same letters", () => {
    expect(validateNameText("Site", createSheet())).toMatchObject({ ok: true });
    expect(validateNameText("SiteworksCost", createSheet())).toMatchObject({ ok: true }); // "Site" + more, no dot
  });
});

describe("defineName / retargetName / deleteName — pure setters", () => {
  it("defineName stores a lowercased key with the display-cased name and a normalized rect", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 5, c1: 2, r2: 5, c2: 2 });
    expect(s.names.landcost).toEqual({ name: "LandCost", r1: 5, c1: 2, r2: 5, c2: 2 });
  });
  it("defineName normalizes a backwards-drawn selection rect", () => {
    let s = createSheet();
    s = defineName(s, "Block", { r1: 10, c1: 5, r2: 2, c2: 1 });
    expect(s.names.block).toMatchObject({ r1: 2, r2: 10, c1: 1, c2: 5 });
  });
  it("retargetName points an existing name at a new rect without touching others", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 5, c1: 2, r2: 5, c2: 2 });
    s = defineName(s, "Coverage", { r1: 6, c1: 2, r2: 6, c2: 2 });
    s = retargetName(s, "LandCost", { r1: 9, c1: 3, r2: 9, c2: 3 });
    expect(s.names.landcost).toMatchObject({ r1: 9, c1: 3, r2: 9, c2: 3 });
    expect(s.names.coverage).toMatchObject({ r1: 6, c1: 2, r2: 6, c2: 2 });
  });
  it("retargetName is a no-op for a name that doesn't exist", () => {
    const s = createSheet();
    expect(retargetName(s, "Nope", { r1: 1, c1: 1, r2: 1, c2: 1 })).toBe(s);
  });
  it("deleteName removes the entry; a no-op for one that isn't there", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 5, c1: 2, r2: 5, c2: 2 });
    const s2 = deleteName(s, "LandCost");
    expect(s2.names.landcost).toBeUndefined();
    expect(deleteName(s2, "LandCost")).toBe(s2); // no-op, same reference
  });
});

describe("rename — rewrites the name AND every formula that referenced it (one commit)", () => {
  it("renames the key/display text and rewrites a formula's bare reference", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 1, c1: 1, r2: 1, c2: 1 }); // A1
    s = commitCellText(s, 5, 1, "=LandCost*2"); // B6
    s = renameName(s, "LandCost", "SiteCost");
    expect(s.names.landcost).toBeUndefined();
    expect(s.names.sitecost).toMatchObject({ name: "SiteCost", r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(s.cells["c2:5"]).toBe("=SiteCost*2");
  });
  it("does not touch a same-spelled substring inside a string literal or a different identifier", () => {
    let s = createSheet();
    s = defineName(s, "Cost", { r1: 1, c1: 1, r2: 1, c2: 1 });
    s = commitCellText(s, 0, 2, '="TotalCost: " & Cost'); // C1 — "TotalCost" contains "Cost" but is a different token
    s = renameName(s, "Cost", "Expense");
    expect(s.cells["c3:0"]).toBe('="TotalCost: " & Expense');
  });
  it("a rename that only changes CASE still rewrites formula text to the new casing", () => {
    let s = createSheet();
    s = defineName(s, "landcost", { r1: 1, c1: 1, r2: 1, c2: 1 });
    s = commitCellText(s, 0, 2, "=landcost+1");
    s = renameName(s, "landcost", "LandCost");
    expect(s.names.landcost.name).toBe("LandCost");
    expect(s.cells["c3:0"]).toBe("=LandCost+1");
  });
  it("is a no-op for a name that doesn't exist", () => {
    const s = createSheet();
    expect(renameName(s, "Nope", "Whatever")).toBe(s);
  });
  it("a rename that changes nothing (identical text) is a no-op", () => {
    let s = createSheet();
    s = defineName(s, "LandCost", { r1: 1, c1: 1, r2: 1, c2: 1 });
    expect(renameName(s, "LandCost", "LandCost")).toBe(s);
  });
});

describe("nameUsageCount / namesList", () => {
  it("counts every genuine reference, never a function-call-shaped same-spelled token", () => {
    let s = createSheet();
    s = defineName(s, "Cost", { r1: 1, c1: 1, r2: 1, c2: 1 });
    s = commitCellText(s, 0, 2, "=Cost+1"); // C1
    s = commitCellText(s, 1, 2, "=Cost*2"); // C2
    s = commitCellText(s, 2, 2, "=SUM(Cost, 5)"); // C3 — "Cost" here is a real reference (not immediately followed by "(")
    expect(nameUsageCount(s, "Cost")).toBe(3);
  });
  it("namesList is sorted by display name, case-insensitively", () => {
    let s = createSheet();
    s = defineName(s, "zebra", { r1: 1, c1: 1, r2: 1, c2: 1 });
    s = defineName(s, "Apple", { r1: 2, c1: 1, r2: 2, c2: 1 });
    expect(namesList(s).map((n) => n.name)).toEqual(["Apple", "zebra"]);
  });
});

describe("rect <-> selRange conversions", () => {
  it("rectFromSelRange converts 0-based selRange to a normalized 1-based rect", () => {
    expect(rectFromSelRange({ r1: 4, r2: 4, c1: 1, c2: 1 })).toEqual({ r1: 5, r2: 5, c1: 2, c2: 2 });
    expect(rectFromSelRange({ r1: 9, r2: 1, c1: 5, c2: 0 })).toEqual({ r1: 2, r2: 10, c1: 1, c2: 6 });
  });
  it("rectToSelRange is the exact inverse for an already-normalized rect", () => {
    const rect = { r1: 5, r2: 5, c1: 2, c2: 2 };
    expect(rectToSelRange(rect)).toEqual({ r1: 4, r2: 4, c1: 1, c2: 1 });
  });
  it("rectToAddressText formats a single cell and a range", () => {
    expect(rectToAddressText({ r1: 5, r2: 5, c1: 2, c2: 2 })).toBe("B5");
    expect(rectToAddressText({ r1: 5, r2: 10, c1: 2, c2: 4 })).toBe("B5:D10");
  });
});

describe("shiftNamesForStructuralChange — mirrors formula.js's own structural-shift rules", () => {
  it("insert a row ABOVE a name's target pushes it down", () => {
    const names = { landcost: { name: "LandCost", r1: 5, c1: 1, r2: 5, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 3, 1); // insert before row 3
    expect(shifted.landcost).toMatchObject({ r1: 6, r2: 6 });
  });
  it("insert a row BELOW a name's target leaves it untouched", () => {
    const names = { landcost: { name: "LandCost", r1: 5, c1: 1, r2: 5, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 8, 1);
    expect(shifted).toBe(names); // identity no-op
  });
  it("insert a row INSIDE a multi-row range grows it", () => {
    const names = { block: { name: "Block", r1: 2, c1: 1, r2: 6, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 4, 1);
    expect(shifted.block).toMatchObject({ r1: 2, r2: 7 });
  });
  it("delete the row a single-cell name targets DROPS the name", () => {
    const names = { landcost: { name: "LandCost", r1: 5, c1: 1, r2: 5, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 5, -1);
    expect(shifted.landcost).toBeUndefined();
  });
  it("delete a row ABOVE a name's target pulls it up, never drops it", () => {
    const names = { landcost: { name: "LandCost", r1: 5, c1: 1, r2: 5, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 2, -1);
    expect(shifted.landcost).toMatchObject({ r1: 4, r2: 4 });
  });
  it("delete a row BELOW a name's target leaves it untouched (identity no-op)", () => {
    const names = { landcost: { name: "LandCost", r1: 5, c1: 1, r2: 5, c2: 1 } };
    const shifted = shiftNamesForStructuralChange(names, "row", 9, -1);
    expect(shifted).toBe(names);
  });
  it("column axis behaves identically over c1/c2", () => {
    const names = { landcost: { name: "LandCost", r1: 1, c1: 5, r2: 1, c2: 5 } };
    const shifted = shiftNamesForStructuralChange(names, "col", 3, 1);
    expect(shifted.landcost).toMatchObject({ c1: 6, c2: 6 });
  });
  it("a null/undefined names map passes through untouched", () => {
    expect(shiftNamesForStructuralChange(undefined, "row", 1, 1)).toBeUndefined();
  });
});
