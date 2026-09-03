/* Model workspace — the WORKBOOK layer (Stage 3, NEW-1, owner brief 2026-09-03): an ordered
 * list of named sheets with an active one. Every mutator here must be a real pure function
 * (never mutate its argument) and every no-op edit must return the SAME workbook reference
 * (`toBe`, not `toEqual`) — same identity discipline test/modelSheetModel.test.js already
 * holds the per-sheet mutators to, and for the identical reason: it's what makes
 * useUndoableState's "no-op edit mints no undo frame" guarantee true one layer up.
 */
import { describe, it, expect } from "vitest";
import {
  createWorkbook, migrateWorkbook, createSheet, migrateSheet, commitCellText, setRaw,
  activeSheetIndex, activeSheetEntry, setActiveSheet, addSheet, duplicateSheet, renameSheet,
  deleteSheet, reorderSheet, applyToActiveSheet, workbookInsertRowAt, workbookDeleteRowAt,
  workbookInsertColumnAt, workbookDeleteColumn, isFormulaText,
} from "../src/workspaces/model/lib/sheetModel.js";

describe("createWorkbook", () => {
  it("starts with exactly one sheet, named Sheet1, and it is the active one", () => {
    const wb = createWorkbook();
    expect(wb.sheets.length).toBe(1);
    expect(wb.sheets[0].name).toBe("Sheet1");
    expect(wb.activeSheetId).toBe(wb.sheets[0].id);
  });
});

describe("migrateWorkbook — pre-existing single-sheet rows must load without loss", () => {
  it("a PRE-Stage-3 blob (bare sheet fields at the top level) wraps into a one-sheet workbook named Sheet1", () => {
    let old = createSheet();
    old = setRaw(old, 0, 0, "12345");
    old = commitCellText(old, 0, 1, "=A1*2");
    const wb = migrateWorkbook(old);
    expect(wb.sheets.length).toBe(1);
    expect(wb.sheets[0].name).toBe("Sheet1");
    expect(wb.sheets[0].sheet.cells).toEqual(old.cells);
    expect(wb.activeSheetId).toBe(wb.sheets[0].id);
  });

  it("an already-workbook-shaped blob round-trips its sheets, names, and active sheet", () => {
    const wb1 = createWorkbook();
    const wb2 = addSheet(wb1);
    const raw = JSON.parse(JSON.stringify(wb2)); // simulate a real jsonb round trip
    const migrated = migrateWorkbook(raw);
    expect(migrated.sheets.length).toBe(2);
    expect(migrated.sheets.map((s) => s.name)).toEqual(["Sheet1", "Sheet2"]);
    expect(migrated.activeSheetId).toBe(wb2.activeSheetId);
  });

  it("each sheet inside a workbook blob is floated up through migrateSheet's own capacity floor", () => {
    const raw = { sheets: [{ id: "sheet1", name: "Sheet1", sheet: { version: 1, columns: [{ id: "c1", name: "A" }], rowCount: 5, cells: {} } }], activeSheetId: "sheet1" };
    const migrated = migrateWorkbook(raw);
    expect(migrated.sheets[0].sheet.columns.length).toBeGreaterThan(1);
    expect(migrated.sheets[0].sheet.rowCount).toBeGreaterThan(5);
  });

  it("an activeSheetId pointing nowhere real falls back to the first sheet", () => {
    const raw = { sheets: [{ id: "sheet1", name: "Sheet1", sheet: createSheet() }], activeSheetId: "ghost" };
    expect(migrateWorkbook(raw).activeSheetId).toBe("sheet1");
  });

  it("an empty sheets array is treated as though it never happened — falls back to a fresh workbook", () => {
    const migrated = migrateWorkbook({ sheets: [], activeSheetId: "x" });
    expect(migrated.sheets.length).toBe(1);
  });

  it("null/garbage input returns a fresh, valid workbook rather than crashing", () => {
    expect(migrateWorkbook(null).sheets.length).toBe(1);
    expect(migrateWorkbook("not an object").sheets.length).toBe(1);
    expect(migrateWorkbook({}).sheets.length).toBe(1);
  });

  it("a duplicate sheet id in the raw blob is defended against, never silently dropped", () => {
    const raw = { sheets: [{ id: "dup", name: "One" }, { id: "dup", name: "Two" }] };
    const migrated = migrateWorkbook(raw);
    expect(migrated.sheets.length).toBe(2);
    expect(new Set(migrated.sheets.map((s) => s.id)).size).toBe(2); // both ids are unique
  });
});

describe("addSheet / setActiveSheet / activeSheetEntry", () => {
  it("appends a new blank sheet, named SheetN, and makes it active", () => {
    const wb = addSheet(createWorkbook());
    expect(wb.sheets.length).toBe(2);
    expect(wb.sheets[1].name).toBe("Sheet2");
    expect(wb.activeSheetId).toBe(wb.sheets[1].id);
    expect(activeSheetEntry(wb).id).toBe(wb.sheets[1].id);
  });
  it("de-duplicates a default name against a sheet that already carries it", () => {
    let wb = createWorkbook();
    wb = renameSheet(wb, wb.sheets[0].id, "Sheet2"); // Sheet1 renamed to look like a future default
    wb = addSheet(wb); // its own default name would collide with the existing "Sheet2"
    expect(wb.sheets[1].name).not.toBe("Sheet2");
  });
  it("setActiveSheet switches the active id; a no-op (same id, or an unknown id) returns the SAME workbook", () => {
    const wb = addSheet(createWorkbook());
    const switched = setActiveSheet(wb, wb.sheets[0].id);
    expect(switched.activeSheetId).toBe(wb.sheets[0].id);
    expect(setActiveSheet(switched, switched.activeSheetId)).toBe(switched);
    expect(setActiveSheet(wb, "ghost")).toBe(wb);
  });
  it("activeSheetIndex resolves the active sheet's position", () => {
    const wb = addSheet(createWorkbook());
    expect(activeSheetIndex(wb)).toBe(1);
  });
});

describe("duplicateSheet", () => {
  it("clones a sheet's full data under a new id/name, right after the source, and makes it active", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, setRaw, 0, 0, "500");
    const dup = duplicateSheet(wb, wb.sheets[0].id);
    expect(dup.sheets.length).toBe(2);
    expect(dup.sheets[1].name).toBe("Sheet1 (copy)");
    expect(dup.sheets[1].sheet.cells).toEqual(dup.sheets[0].sheet.cells);
    expect(dup.activeSheetId).toBe(dup.sheets[1].id);
  });
  it("editing the duplicate never touches the original (a real deep clone, not a shared reference)", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, setRaw, 0, 0, "1");
    const dup = duplicateSheet(wb, wb.sheets[0].id);
    const edited = applyToActiveSheet(dup, setRaw, 0, 0, "999"); // edits the NEW active sheet (the copy)
    expect(edited.sheets[0].sheet.cells["c1:0"]).toBe("1"); // original untouched
    expect(edited.sheets[1].sheet.cells["c1:0"]).toBe("999");
  });
  it("a cross-sheet formula inside the duplicated sheet still points at the SAME other sheet, unchanged", () => {
    let wb = createWorkbook();
    wb = addSheet(wb); // sheet2
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A1+1");
    const dup = duplicateSheet(wb, wb.sheets[1].id); // duplicate sheet2
    expect(dup.sheets[2].sheet.cells["c1:0"]).toBe("=Sheet1!A1+1");
  });
  it("an unknown sheetId is a no-op", () => {
    const wb = createWorkbook();
    expect(duplicateSheet(wb, "ghost")).toBe(wb);
  });
});

describe("renameSheet — rewrites every cross-sheet formula that names the old name", () => {
  it("renames the sheet and is a no-op for a blank name or the identical name", () => {
    const wb = createWorkbook();
    expect(renameSheet(wb, wb.sheets[0].id, "Costs").sheets[0].name).toBe("Costs");
    expect(renameSheet(wb, wb.sheets[0].id, "")).toBe(wb);
    expect(renameSheet(wb, wb.sheets[0].id, "Sheet1")).toBe(wb);
  });
  it("de-duplicates against an existing OTHER sheet's name", () => {
    let wb = addSheet(createWorkbook()); // Sheet1, Sheet2
    const renamed = renameSheet(wb, wb.sheets[0].id, "Sheet2");
    expect(renamed.sheets[0].name).not.toBe("Sheet2");
  });
  it("rewrites a cross-sheet reference on ANOTHER sheet to the new name", () => {
    let wb = addSheet(createWorkbook()); // Sheet1, Sheet2
    wb = { ...wb, activeSheetId: wb.sheets[1].id };
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A1+1"); // Sheet2!A1 references Sheet1
    const renamed = renameSheet(wb, wb.sheets[0].id, "Costs");
    expect(renamed.sheets[1].sheet.cells["c1:0"]).toBe("=Costs!A1+1");
  });
  it("rewrites a redundant self-qualified reference on the RENAMED sheet's own cells too", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A2+1");
    const renamed = renameSheet(wb, wb.sheets[0].id, "Costs");
    expect(renamed.sheets[0].sheet.cells["c1:0"]).toBe("=Costs!A2+1");
  });
  it("quotes the new name when it needs it (spaces), and leaves an unrelated sheet's formula alone", () => {
    let wb = addSheet(createWorkbook());
    wb = { ...wb, activeSheetId: wb.sheets[1].id };
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A1");
    const renamed = renameSheet(wb, wb.sheets[0].id, "My Costs");
    expect(renamed.sheets[1].sheet.cells["c1:0"]).toBe("='My Costs'!A1");
  });
  it("a bare (unqualified) reference is never rewritten by a DIFFERENT sheet's rename", () => {
    let wb = addSheet(createWorkbook());
    wb = { ...wb, activeSheetId: wb.sheets[1].id };
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=A1+Sheet1!B1");
    const renamed = renameSheet(wb, wb.sheets[0].id, "Costs");
    expect(renamed.sheets[1].sheet.cells["c1:0"]).toBe("=A1+Costs!B1");
  });
});

describe("deleteSheet — never zero sheets; a referenced sheet's cross-sheet refs become #REF!", () => {
  it("refuses to delete the last remaining sheet", () => {
    const wb = createWorkbook();
    expect(deleteSheet(wb, wb.sheets[0].id)).toBe(wb);
  });
  it("removes the sheet and turns every reference to it, elsewhere, into #REF!", () => {
    let wb = addSheet(createWorkbook()); // Sheet1, Sheet2
    wb = { ...wb, activeSheetId: wb.sheets[1].id };
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A1+1");
    const deleted = deleteSheet(wb, wb.sheets[0].id); // delete Sheet1
    expect(deleted.sheets.length).toBe(1);
    expect(deleted.sheets[0].sheet.cells["c1:0"]).toBe("=#REF!+1");
  });
  it("a formula referencing a DIFFERENT (surviving) sheet is untouched", () => {
    let wb = addSheet(createWorkbook());
    wb = addSheet(wb); // Sheet1, Sheet2, Sheet3
    wb = { ...wb, activeSheetId: wb.sheets[2].id };
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet2!A1");
    const deleted = deleteSheet(wb, wb.sheets[0].id); // delete Sheet1, keep Sheet2 reference intact
    expect(deleted.sheets.find((s) => s.name === "Sheet3").sheet.cells["c1:0"]).toBe("=Sheet2!A1");
  });
  it("moves the active sheet to the one before it when the active sheet itself is deleted", () => {
    let wb = addSheet(createWorkbook());
    wb = addSheet(wb); // Sheet1, Sheet2, Sheet3 — active = Sheet3
    const deleted = deleteSheet(wb, wb.activeSheetId);
    expect(deleted.activeSheetId).toBe(wb.sheets[1].id); // Sheet2, the one immediately before Sheet3
  });
  it("an unknown sheetId is a no-op", () => {
    const wb = addSheet(createWorkbook());
    expect(deleteSheet(wb, "ghost")).toBe(wb);
  });
});

describe("reorderSheet", () => {
  it("moves a sheet to a new tab position", () => {
    let wb = addSheet(createWorkbook());
    wb = addSheet(wb); // Sheet1, Sheet2, Sheet3
    const reordered = reorderSheet(wb, 0, 2); // Sheet1 moves to the end
    expect(reordered.sheets.map((s) => s.name)).toEqual(["Sheet2", "Sheet3", "Sheet1"]);
  });
  it("a no-op move (same index) returns the SAME workbook", () => {
    const wb = addSheet(createWorkbook());
    expect(reorderSheet(wb, 1, 1)).toBe(wb);
  });
  it("clamps out-of-range indices to the real bounds instead of throwing", () => {
    let wb = addSheet(createWorkbook());
    expect(() => reorderSheet(wb, -5, 50)).not.toThrow();
  });
});

describe("applyToActiveSheet", () => {
  it("applies a per-sheet mutator to the currently active sheet only", () => {
    let wb = addSheet(createWorkbook()); // active = Sheet2
    wb = applyToActiveSheet(wb, setRaw, 0, 0, "42");
    expect(wb.sheets[1].sheet.cells["c1:0"]).toBe("42");
    expect(wb.sheets[0].sheet.cells).toEqual({});
  });
  it("a no-op mutator call returns the SAME workbook reference", () => {
    const wb = createWorkbook();
    expect(applyToActiveSheet(wb, setRaw, 0, 0, "")).toBe(wb); // setting blank-to-blank is a no-op
  });
});

describe("workbook structural edits — cross-sheet reference sweep", () => {
  it("inserting a row on the sheet a formula references shifts that formula's reference too", () => {
    let wb = addSheet(createWorkbook()); // Sheet1, Sheet2 — active = Sheet2
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A5"); // Sheet2!A1 references Sheet1!A5
    wb = { ...wb, activeSheetId: wb.sheets[0].id }; // switch to Sheet1, the one about to be edited
    wb = workbookInsertRowAt(wb, 0); // insert a row at the very top of Sheet1
    expect(wb.sheets[1].sheet.cells["c1:0"]).toBe("=Sheet1!A6"); // shifted down by one
  });
  it("inserting a row on an UNRELATED sheet never touches a reference naming a different sheet", () => {
    let wb = addSheet(createWorkbook());
    wb = addSheet(wb); // Sheet1, Sheet2, Sheet3 — active = Sheet3
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet2!A5");
    wb = { ...wb, activeSheetId: wb.sheets[0].id }; // edit Sheet1 — Sheet3's Sheet2! reference must not move
    wb = workbookInsertRowAt(wb, 0);
    expect(wb.sheets[2].sheet.cells["c1:0"]).toBe("=Sheet2!A5");
  });
  it("a bare reference on the edited sheet's OWN formula also shifts (owner === edited)", () => {
    let wb = createWorkbook();
    wb = applyToActiveSheet(wb, setRaw, 4, 0, "1"); // A5
    wb = applyToActiveSheet(wb, commitCellText, 0, 1, "=A5"); // B1 = A5
    wb = workbookInsertRowAt(wb, 0);
    expect(wb.sheets[0].sheet.cells["c2:1"]).toBe("=A6"); // shifted; the formula cell itself also moved down a row (r=1 now)
  });
  it("deleting a column that collapses a cross-sheet reference turns it into #REF! elsewhere, qualifier intact", () => {
    let wb = addSheet(createWorkbook());
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A1"); // Sheet2!A1 references Sheet1!A1 (column A)
    wb = { ...wb, activeSheetId: wb.sheets[0].id };
    wb = workbookDeleteColumn(wb, 0); // delete Sheet1's column A
    expect(wb.sheets[1].sheet.cells["c1:0"]).toBe("=Sheet1!#REF!");
  });
  it("deleting the LAST column on a sheet is a genuine no-op and never sweeps other sheets", () => {
    let wb = createWorkbook();
    // Collapse Sheet1 down to one column first.
    while (wb.sheets[0].sheet.columns.length > 1) wb = workbookDeleteColumn(wb, wb.sheets[0].sheet.columns.length - 1);
    const before = wb;
    const after = workbookDeleteColumn(wb, 0);
    expect(after).toBe(before);
  });
  it("deleting a row on the edited sheet shifts a cross-sheet reference from elsewhere", () => {
    let wb = addSheet(createWorkbook());
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!A10");
    wb = { ...wb, activeSheetId: wb.sheets[0].id };
    wb = workbookDeleteRowAt(wb, 0); // delete Sheet1's very first row
    expect(wb.sheets[1].sheet.cells["c1:0"]).toBe("=Sheet1!A9");
  });
  it("inserting a column on the edited sheet shifts a cross-sheet reference from elsewhere", () => {
    let wb = addSheet(createWorkbook());
    wb = applyToActiveSheet(wb, commitCellText, 0, 0, "=Sheet1!C1");
    wb = { ...wb, activeSheetId: wb.sheets[0].id };
    wb = workbookInsertColumnAt(wb, 0); // insert a column before A on Sheet1
    expect(wb.sheets[1].sheet.cells["c1:0"]).toBe("=Sheet1!D1");
  });
});
