/* NEW-4 — Library folder tree: a failed read keeps the previous rows + shows an error; only an
 * empty SUCCESS renders the "Create the standard folder structure" template. */
import { describe, it, expect } from "vitest";
import { applyFolderRead, templatePreviewAllowed, FOLDER_READ_FAILED_PREFIX } from "../src/workspaces/library/lib/folderLoadDecision.js";

const ROWS = [{ id: "a", parentId: null, name: "A", order: 1, trashed: false }];

describe("applyFolderRead", () => {
  it("a successful read replaces the rows and clears any error", () => {
    expect(applyFolderRead([], { ok: true, rows: ROWS })).toEqual({ rows: ROWS, failed: false, error: "" });
  });
  it("an empty SUCCESS is an honest empty tree (rows [], not failed)", () => {
    expect(applyFolderRead(ROWS, { ok: true, rows: [] })).toEqual({ rows: [], failed: false, error: "" });
  });
  it("a FAILED re-read keeps the previous rows and names the failure", () => {
    const r = applyFolderRead(ROWS, { ok: false, rows: [], error: "FetchError: network" });
    expect(r.rows).toBe(ROWS);
    expect(r.failed).toBe(true);
    expect(r.error.startsWith(FOLDER_READ_FAILED_PREFIX)).toBe(true);
    expect(r.error).toContain("FetchError: network");
  });
  it("a FAILED first read of a different project shows NOTHING (never another project's rows) and is still failed", () => {
    const r = applyFolderRead(ROWS, { ok: false, rows: [], error: "x" }, { fresh: true });
    expect(r.rows).toEqual([]);
    expect(r.failed).toBe(true);
  });
  it("a missing result is a failure, not an empty tree", () => {
    expect(applyFolderRead(ROWS, undefined).failed).toBe(true);
  });
});

describe("templatePreviewAllowed — the seed button gate", () => {
  it("only an honest empty tree may invite a seed", () => {
    expect(templatePreviewAllowed({ loading: false, failed: false, treeLength: 0 })).toBe(true);
    expect(templatePreviewAllowed({ loading: false, failed: true, treeLength: 0 })).toBe(false);   // the NEW-4 defect
    expect(templatePreviewAllowed({ loading: true, failed: false, treeLength: 0 })).toBe(false);
    expect(templatePreviewAllowed({ loading: false, failed: false, treeLength: 3 })).toBe(false);
  });
});
