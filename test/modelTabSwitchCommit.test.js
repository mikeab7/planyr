/* Model workspace — NEW-1 (2026-10-29): a half-typed cell / formula-bar entry carried over to the next
 * sheet tab and saved THERE. Switching sheets now commits it to the sheet being left first.
 * CI-runnable half: the "pending" rule plus source guards that every sheet-changing handler flushes;
 * the browser half is e2e/model-tab-switch-commits.spec.js (red on the pre-fix code). */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { hasPendingFormulaText } from "../src/workspaces/model/lib/pendingEntry.js";

describe("hasPendingFormulaText", () => {
  it("is pending only when the draft differs from what the cell holds", () => {
    expect(hasPendingFormulaText("500", "")).toBe(true);
    expect(hasPendingFormulaText("=A1+1", "=A1+1")).toBe(false);
    expect(hasPendingFormulaText("", undefined)).toBe(false);
    expect(hasPendingFormulaText("", "7")).toBe(true); // clearing the text is an edit too
  });
});

describe("wiring (source guards)", () => {
  const app = fs.readFileSync("src/workspaces/model/ModelApp.jsx", "utf8");
  const sheetView = fs.readFileSync("src/workspaces/model/components/SheetView.jsx", "utf8");
  const bar = fs.readFileSync("src/workspaces/model/components/FormulaBar.jsx", "utf8");
  const body = (name) => { const i = app.indexOf(`const ${name} = useCallback(`); return app.slice(i, i + 700); };

  it("SheetView and FormulaBar both expose commitPending", () => {
    expect(sheetView).toMatch(/commitPending:\s*\(\)\s*=>/);
    expect(sheetView).toContain("editValueRef.current");
    expect(bar).toMatch(/commitPending:\s*\(\)\s*=>/);
  });
  it("every handler that changes the showing sheet flushes pending entry first", () => {
    for (const h of ["onSelectSheetTab", "onAddSheetTab", "onDuplicateSheetTab", "onDeleteSheetTab", "onNavigateTrace"]) {
      const b = body(h);
      expect(b, h).toContain("commitPendingEntry()");
      expect(b.indexOf("commitPendingEntry()"), h).toBeLessThan(b.indexOf("setActiveSheetId("));
    }
  });
  it("add / duplicate / delete build from the latest workbook, not the captured one", () => {
    for (const h of ["onAddSheetTab", "onDuplicateSheetTab", "onDeleteSheetTab"]) {
      expect(body(h), h).toMatch(/commit\(\(wb\) =>/);
    }
  });
});
