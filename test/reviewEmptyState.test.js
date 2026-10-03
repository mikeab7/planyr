// NEW-1 — Review's "nothing open" screen is a project-aware sheet index. Red on the old
// "No drawing open" screen, which had none of these states and carried the removed buttons.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ReviewEmptyStateView } from "../src/workspaces/doc-review/components/ReviewEmptyState.jsx";
import { buildSheetIndex, latestPerSheet, drawingCountLabel } from "../src/shared/files/sheetIndex.js";

const row = (o) => ({ id: o.id, projectId: "p1", kind: "single", ...o });
const REVIEWS = [
  row({ id: "a", sheetNumber: "C-101", sheetTitle: "Grading Plan", revision: "2", discipline: "Civil" }),
  row({ id: "a3", sheetNumber: "C-101", sheetTitle: "Grading Plan", revision: "3", discipline: "Civil" }),
  row({ id: "s", sheetNumber: "S-201", sheetTitle: "Framing", revision: "1", discipline: "Structural" }),
  row({ id: "x", sheetNumber: "", discipline: "Other", sfile: "Soils report.pdf", title: "Soils report" }),
  row({ id: "w", sheetNumber: "", discipline: "Other", sfile: "Notes.docx", title: "Notes" }),
  row({ id: "old", sheetNumber: "A-1", sheetTitle: "Plan", revision: "1", discipline: "Architectural", state: "superseded" }),
  row({ id: "q", projectId: "p2", sheetNumber: "E-1", sheetTitle: "Power", revision: "A", discipline: "Electrical" }),
];
const PROJECTS = [{ id: "p1", name: "Goose Creek" }, { id: "p2", name: "Bain" }, { id: "p3", name: "Empty One" }];
const html = (props) => renderToStaticMarkup(createElement(ReviewEmptyStateView, { projects: PROJECTS, reviews: REVIEWS, ...props }));
const REMOVED = ["Browse the Library", "Open PDF", "Compare revisions", "drop a construction PDF", "Calibrate to scale", "No drawing open"];

describe("Review empty state", () => {
  it("State 1 (no project): project cards with drawing counts + the no-project upload link, none of the removed copy", () => {
    const h = html({});
    expect(h).toContain("Pick a project");
    expect(h).toContain("to see its drawings");
    expect((h.match(/data-testid="empty-project-card"/g) || []).length).toBe(3);
  });
  it("State 1 counts are latest-per-sheet, superseded excluded", () => {
    const h = html({});
    expect(h).toContain("4 drawings"); // C-101 r3, S-201, Soils, Notes
    expect(h).toContain("1 drawing<");  // p2
    expect(h).toContain("No drawings yet"); // p3
    expect(h).toContain("Upload a file without a project");
    for (const s of REMOVED) expect(h).not.toContain(s);
  });
  it("State 2 (a project): 'Current set', Upload file, grouped by discipline in order, Other last by file name", () => {
    const h = html({ projectId: "p1" });
    expect(h).toContain("Current set");
    expect(h).toContain("Upload file");
    const order = [...h.matchAll(/data-group="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["Civil", "Structural", "Other"]);
    expect(h).toContain("C-101");
    expect(h).toContain("Rev 3");
    expect(h).not.toContain("Rev 2");        // older revision of the same sheet is not listed
    expect(h).not.toContain("A-1");          // superseded
    expect(h).toContain("Soils report.pdf"); // sheetless file kept, by file name
    expect(h).toContain("Notes.docx");       // Word file appears in Other
    for (const s of REMOVED) expect(h).not.toContain(s);
  });
  it("project with zero files, and only non-sheet files", () => {
    expect(html({ projectId: "p3" })).toContain("No drawings in this project yet");
    const only = html({ projectId: "p1", reviews: [REVIEWS[3], REVIEWS[4]] });
    expect(only).toContain('data-group="Other"');
    expect(only).not.toContain('data-group="Civil"');
  });
  it("no projects at all still offers the no-project upload", () => {
    const h = html({ projects: [] });
    expect(h).toContain("Pick a project");
    expect(h).toContain("No projects yet");
    expect(h).toContain("Upload a file without a project");
  });
  it("a failed read is loud, never rendered as 'no drawings'", () => {
    const h = html({ projectId: "p1", reviews: null, readFailed: true });
    expect(h).toContain("Couldn’t load your drawings");
    expect(h).not.toContain("No drawings in this project yet");
  });
});

describe("sheet index", () => {
  it("sheet prefix wins over a wrong filed discipline; rows sort by sheet number", () => {
    const idx = buildSheetIndex([row({ id: "1", sheetNumber: "S-2", discipline: "Civil" }), row({ id: "2", sheetNumber: "S-10", discipline: "Civil" })]);
    expect(idx.groups.map((g) => g.label)).toEqual(["Structural"]);
    expect(idx.groups[0].rows.map((r) => r.sheetNumber)).toEqual(["S-2", "S-10"]);
  });
  it("latestPerSheet keeps sheetless files and the highest revision", () => {
    const out = latestPerSheet(REVIEWS.filter((r) => r.projectId === "p1"));
    expect(out.map((f) => f.id).sort()).toEqual(["a3", "s", "w", "x"].sort());
  });
  it("count label", () => {
    expect([drawingCountLabel(0), drawingCountLabel(1), drawingCountLabel(12)]).toEqual(["No drawings yet", "1 drawing", "12 drawings"]);
  });
});

describe("DocReview wiring", () => {
  const src = readFileSync(new URL("../src/workspaces/doc-review/DocReview.jsx", import.meta.url), "utf8");
  it("the old empty-state buttons/copy are gone and the picker takes Word/text", () => {
    for (const s of ["empty-open-library", "empty-compare", "Browse the Library", "Calibrate to scale, measure", "drop a construction PDF"]) expect(src).not.toContain(s);
    expect(src).toMatch(/\.docx,\.doc,\.txt/);
  });
  it("a Word/text pick never auto-downloads: it only sets the offer behind the explicit Download button", () => {
    const i = src.indexOf("isWordOrTextName(file.name)");
    const block = src.slice(i, i + 700);
    expect(block).toContain("setNonPdfOffer");
    expect(block).not.toMatch(/\.click\(\)|download\s*=/);
  });
});
