// NEW-1 / NEW-2 — Review can CLOSE an open file back to the sheet index, and a file saved with no project is
// findable in the Library under "Unfiled". Red on the commit before: no Close control, no unfiled module, no Unfiled
// section, and the save banner said "Saved to the Library." wherever the file went.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isUnfiledRow, unfiledRows, savedPlace } from "../src/workspaces/doc-review/lib/unfiled.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");

describe("unfiled rows (NEW-2)", () => {
  const rows = [
    { id: "a", project_id: "p1", updated_at: "2026-10-01T00:00:00Z" },
    { id: "b", project_id: null, updated_at: "2026-10-02T00:00:00Z" },
    { id: "c", project_id: null, orgScope: true, updated_at: "2026-10-03T00:00:00Z" },
    { id: "d", project_id: null, updated_at: "2026-10-04T00:00:00Z" },
    { id: "e", projectId: "p9" },
    { id: "", project_id: null },
  ];
  it("lists only rows with no project and no Organization scope, newest first", () => {
    expect(unfiledRows(rows).map((r) => r.id)).toEqual(["d", "b"]);
  });
  it("isUnfiledRow is false for project, org, id-less and null rows", () => {
    expect(isUnfiledRow(rows[0])).toBe(false);
    expect(isUnfiledRow(rows[2])).toBe(false);
    expect(isUnfiledRow(rows[4])).toBe(false);
    expect(isUnfiledRow(rows[5])).toBe(false);
    expect(isUnfiledRow(null)).toBe(false);
    expect(isUnfiledRow(rows[1])).toBe(true);
  });
  it("the save banner names where the file went", () => {
    expect(savedPlace({})).toMatch(/Unfiled/);
    expect(savedPlace({})).toMatch(/Library/);
    expect(savedPlace({ projectId: "p1", project: "Grand Port" })).toBe("Saved to the Library in Grand Port.");
    expect(savedPlace({ projectId: "p1" })).toBe("Saved to the Library.");
    expect(savedPlace({ orgScope: true })).toMatch(/Organization/);
    expect(savedPlace({ projectId: "p1" })).not.toMatch(/Unfiled/);
  });
});

describe("Library Home Unfiled section (NEW-2)", () => {
  it("UnfiledCard offers Open + a Move to project picker listing the projects", async () => {
    const { UnfiledCard } = await import("../src/workspaces/library/components/LibraryHome.jsx");
    const h = renderToStaticMarkup(createElement(UnfiledCard, { doc: { id: "x", title: "planyr-test-delete-me", discipline: "Other", updated_at: "2026-10-03T00:00:00Z" }, projects: [{ id: "p1", name: "Grand Port" }, { id: "p2", name: "Bain" }] }));
    expect(h).toContain('data-testid="unfiled-row"');
    expect(h).toContain("planyr-test-delete-me");
    expect(h).toContain("Move to project…");
    expect(h).toContain("Grand Port");
    expect(h).toContain("Bain");
  });
  it("LibraryHome renders the section from the shared unfiled filter and files through the ONE shared function", () => {
    const src = read("src/workspaces/library/components/LibraryHome.jsx");
    expect(src).toContain("unfiledRows(reviews)");
    expect(src).toContain("<SectionHead>Unfiled</SectionHead>");
    expect(src).toContain("fileReviewIntoProject");
  });
  it("the Needs-filing row in FileBrowser uses the same shared function (one implementation, not two)", () => {
    const src = read("src/workspaces/library/components/FileBrowser.jsx");
    expect(src).toContain("fileReviewIntoProject");
    expect(src).not.toMatch(/await refileReview\(/);
  });
  it("Review's 'Upload a file without a project' says where it will land", async () => {
    const { ReviewEmptyStateView } = await import("../src/workspaces/doc-review/components/ReviewEmptyState.jsx");
    const h = renderToStaticMarkup(createElement(ReviewEmptyStateView, { projects: [{ id: "p1", name: "A" }], reviews: [] }));
    expect(h).toMatch(/Unfiled in the Library/);
  });
});

describe("fileReviewIntoProject — the shared filing step", () => {
  const calls = [];
  beforeEach(() => { calls.length = 0; vi.resetModules(); });
  const load = async ({ refile, facts, move, rec }) => {
    vi.doMock("../src/workspaces/doc-review/lib/reviewStore.js", () => ({
      refileReview: async (...a) => { calls.push(["refile", ...a]); return refile; },
      upsertFileFacts: async (...a) => { calls.push(["facts"]); return facts; },
      loadReview: async () => rec,
    }));
    vi.doMock("../src/workspaces/library/lib/folders.js", () => ({ moveDriveFileToFolder: async (...a) => { calls.push(["move", ...a]); return move; } }));
    return (await import("../src/workspaces/library/lib/fileIntoProject.js")).fileReviewIntoProject;
  };
  it("a failed re-point writes nothing else and reports the error", async () => {
    const f = await load({ refile: { ok: false, error: "nope" }, facts: { ok: true }, move: { ok: true }, rec: { sources: [] } });
    const r = await f({ f: { id: "r1" }, projectId: "p1", projectName: "Grand Port", discipline: "Other" });
    expect(r).toEqual({ ok: false, error: "nope" });
    expect(calls.map((c) => c[0])).toEqual(["refile"]);
  });
  it("success re-points, mirrors the index, and moves each Drive copy", async () => {
    const f = await load({ refile: { ok: true }, facts: { ok: true }, move: { ok: true }, rec: { sources: [{ driveKey: "k1" }, { driveKey: "k2" }, {}] } });
    const r = await f({ f: { id: "r1" }, projectId: "p1", projectName: "Grand Port", discipline: "Other" });
    expect(r).toEqual({ ok: true, notice: "" });
    expect(calls.map((c) => c[0])).toEqual(["refile", "facts", "move", "move"]);
    expect(calls[0][2]).toMatchObject({ projectId: "p1", project: "Grand Port", discipline: "Other" });
  });
  it("a Drive-move failure is loud, not silent", async () => {
    const f = await load({ refile: { ok: true }, facts: { ok: true }, move: { ok: false, error: "quota" }, rec: { sources: [{ driveKey: "k1" }] } });
    const r = await f({ f: { id: "r1" }, projectId: "p1", discipline: "Other" });
    expect(r.ok).toBe(true);
    expect(r.notice).toMatch(/Google Drive copy couldn't be moved/);
  });
});

describe("Close (NEW-1) — wiring", () => {
  const src = read("src/workspaces/doc-review/DocReview.jsx");
  it("a Close control exists for an open file, on the toolbar and (phone) its own bar", () => {
    expect((src.match(/data-testid="review-close-file"/g) || []).length).toBe(2);
    expect(src).toMatch(/const requestClose = /);
  });
  it("unsaved Word/text edits prompt; a clean file closes straight away", () => {
    expect(src).toMatch(/if \(docFile && docDirty\) setClosePrompt\("ask"\); else closeNow\(\)/);
    expect(src).toContain("onDirty={setDocDirty}");
    expect(src).toContain("saveRef={docSaveRef}");
  });
  it("Close flushes the review, then swaps in a blank one so the last-doc pointer stops pointing at the closed file", () => {
    const body = src.slice(src.indexOf("const closeNow = async"), src.indexOf("const requestClose"));
    expect(body.indexOf("saveNow()")).toBeGreaterThan(-1);
    expect(body.indexOf("saveNow()")).toBeLessThan(body.indexOf("resetSingle()"));
  });
  it("a Save that fails keeps the file open", () => {
    expect(src).toMatch(/if \(ok\) await closeNow\(\); else setClosePrompt\(null\)/);
  });
  it("Word/text files are recorded as recents and as the resume target (they open in the editor now)", () => {
    expect(src).toContain("!isPdfName(source.name) && !docKindOf(source.name)");
    expect(src).toContain("!isPdfName(src.name) && !docKindOf(src.name)");
  });
  it("a save files where the open review is filed and the banner says where", () => {
    expect(src).toContain("const where = savedPlace(filing)");
  });
  it("the dialog offers Save / Discard / Cancel", () => {
    const d = read("src/workspaces/doc-review/components/CloseFileDialog.jsx");
    for (const id of ["close-file-save", "close-file-discard", "close-file-cancel"]) expect(d).toContain(id);
    expect(d).toContain('"Escape"');
  });
  it("the editor's Save resolves true/false for the dialog to wait on", () => {
    const e = read("src/workspaces/doc-review/docEditor/DocEditor.jsx");
    expect(e).toContain("saveRef.current = () => doSave(false)");
    expect(e).toMatch(/return true;\s*\} catch/);
  });
  it("B2039234 — every project-switch branch that would replace the file goes through the dirty-file prompt, and Cancel goes back", () => {
    const eff = src.slice(src.indexOf("const back = () => onNavigate"), src.indexOf("// Consume the Shell's cross-workspace"));
    expect((eff.match(/leave\(\(\) =>/g) || []).length).toBe(5);
    expect(eff).not.toMatch(/[^(]\(async \(\) => \{ try \{ await saveNow\(\); \} catch \(_\) \{\} setMode\("review"\); resetSingle\(\); \}\)\(\);\s*\n\s*\}\s*\n\s*\/\/ eslint/);
    expect(src).toContain("if (!ok) choice = \"cancel\"");
    expect(src).toContain("if (choice === \"cancel\") sw.back(); else sw.run();");
  });
});
