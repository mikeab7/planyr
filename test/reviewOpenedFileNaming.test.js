import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { metaForOpenedFile, noticeForTab } from "../src/workspaces/doc-review/lib/openedFileMeta.js";
import { composeTitle } from "../src/workspaces/doc-review/lib/reviewNaming.js";

const src = readFileSync(new URL("../src/workspaces/doc-review/DocReview.jsx", import.meta.url), "utf8");
const D = "2026-10-04";
const unfiled = { projectId: null, project: "", orgScope: false };

describe("NEW-1 — a Word/txt/PDF opened from disk is named after ITSELF in the Library", () => {
  // The adjacent-cases table from the brief: every row must carry its own file's name + a category.
  const rows = [
    ["Word, no project", "planyr-test-2-delete-me.docx", unfiled, "2026.10.04 planyr-test-2-delete-me"],
    ["Word saved inside a project", "Lease Exhibit.docx", { projectId: "p1", project: "Goose Creek", orgScope: false }, "2026.10.04 Goose Creek - Lease Exhibit"],
    ["Word, Organization scope", "Policy.docx", { projectId: null, project: "", orgScope: true }, "2026.10.04 Policy"],
    [".txt", "notes.txt", unfiled, "2026.10.04 notes"],
    ["Save-as-Word from a .txt (the opened .txt itself)", "scope of work.txt", unfiled, "2026.10.04 scope of work"],
    ["a .doc (saved as .docx)", "deed-poa-parcel3.doc", unfiled, "2026.10.04 deed-poa-parcel3"],
    ["a PDF", "Site Plan.pdf", unfiled, "2026.10.04 Site Plan"],
  ];
  for (const [label, name, filing, title] of rows) {
    it(label, () => {
      const m = metaForOpenedFile(name, filing, D);
      expect(composeTitle(m)).toBe(title);
      expect(m.discipline).toBe("Other"); // a category, never blank
      expect(m.title).toBe(""); // auto-composed → follows a project rename
      expect(composeTitle(m)).not.toMatch(/Untitled/);
    });
  }
  it("a previously open PDF never lends its name: the helper takes no prior meta at all", () => {
    expect(metaForOpenedFile.length).toBeLessThanOrEqual(3);
    const m = metaForOpenedFile("planyr-test-delete-me.docx", unfiled, D);
    expect(m.item).toBe("planyr-test-delete-me");
    expect(JSON.stringify(m)).not.toMatch(/C5IP|Airtex|Site Plan/);
  });
  it("the Review root derives a new file's meta from the file — in the blank case too (red on the old code)", () => {
    const fn = src.slice(src.indexOf("const beginFileOpen"), src.indexOf("const openFile ="));
    expect(fn).toMatch(/metaForOpenedFile\(file\.name/);
    expect(fn).toMatch(/setMeta\(fresh\)/); // applied to state, so the SAVED record carries it
    expect(fn).not.toMatch(/return \{ switched: false, meta: L\.meta \};\s*\n\s*\};/); // the stale-meta fall-through is gone for a new file
  });
  it("a re-drop that re-attaches bytes keeps the review's own meta", () => {
    expect(src).toMatch(/if \(reattach\) return \{ switched: false, meta: L\.meta \}/);
  });
});

describe("NEW-2 — a status message belongs to the tab that produced it", () => {
  it("shows only on its own tab", () => {
    const rec = { tab: "A", msg: "Restored the version from …" };
    expect(noticeForTab(rec, "A")).toMatch(/Restored/);
    expect(noticeForTab(rec, "B")).toBe("");
    expect(noticeForTab({ tab: null, msg: "x" }, null)).toBe("");
  });
  it("the Review root hands each editor only its own tab's notice (red on the old `here ? docNotice`)", () => {
    expect(src).toMatch(/notice=\{noticeForTab\(docNoticeRec, f\.tabId\)\}/);
    expect(src).not.toMatch(/notice=\{here \? docNotice/);
  });
  it("'save as new' / 'save a copy' tag the notice with the NEW review's tab", () => {
    expect(src).toMatch(/Saved as a new Word file[^\n]*, res\.id\);/);
    expect(src).toMatch(/Saved a copy as[^\n]*, res\.id\);/);
  });
});
