/* NEW-1 / NEW-2 (library): the CI-runnable half. The browser proof (a press at the spot a row first appeared opens it; a
 * record-only site's file is reachable and deletable with no project picked) is ui-audit/verify-library-open-and-tracked.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { trackedSitesWithFiles, rowFileProblem } from "../src/workspaces/library/lib/trackedSites.js";
import { FileCard, UnfiledCard } from "../src/workspaces/library/components/LibraryHome.jsx";

const read = (r) => readFileSync(fileURLToPath(new URL(r, import.meta.url)), "utf8");

describe("trackedSitesWithFiles — a record-only site that holds files gets a route", () => {
  const tracked = [{ id: "t1", name: "Corner", updatedAt: 5 }, { id: "t2", name: "Empty", updatedAt: 9 }, { id: "t3", name: "Older", updatedAt: 1 }];
  it("lists only tracked sites that hold at least one live file, newest first, with counts", () => {
    const reviews = [{ id: "a", project_id: "t1" }, { id: "b", projectId: "t1" }, { id: "c", project_id: "t3" }, { id: "d", project_id: "pursuit-1" }, { id: "e", project_id: null }];
    expect(trackedSitesWithFiles(tracked, reviews)).toEqual([
      { id: "t1", name: "Corner", updatedAt: 5, count: 2 },
      { id: "t3", name: "Older", updatedAt: 1, count: 1 },
    ]);
  });
  it("an org-scoped file never counts toward a site", () => {
    expect(trackedSitesWithFiles(tracked, [{ id: "a", project_id: "t1", orgScope: true }])).toEqual([]);
  });
  it("tolerates empty/undefined input", () => {
    expect(trackedSitesWithFiles()).toEqual([]);
    expect(trackedSitesWithFiles([{ id: "t1" }], null)).toEqual([]);
  });
});

describe("rowFileProblem — a row that cannot resolve a file says so", () => {
  it("flags a row with no source file", () => expect(rowFileProblem({ id: "x", kind: "single", sfile: null })).toMatch(/No file/));
  it("is silent for a row with a file, a stitched set, or nothing", () => {
    expect(rowFileProblem({ id: "x", kind: "single", sfile: "a.pdf" })).toBeNull();
    expect(rowFileProblem({ id: "x", kind: "stitch", sfile: null })).toBeNull();
    expect(rowFileProblem(null)).toBeNull();
  });
  it("renders on both row kinds, and the open control is still enabled (the row stays clickable)", () => {
    const doc = { id: "r1", title: "T", kind: "single", sfile: null };
    for (const html of [renderToStaticMarkup(createElement(FileCard, { doc })), renderToStaticMarkup(createElement(UnfiledCard, { doc }))]) {
      expect(html).toContain('data-testid="row-file-problem"');
      expect(html).not.toMatch(/<button[^>]*title="Open in Review"[^>]*disabled/);
    }
  });
  it("shows 'Opening…' on the pressed row", () => {
    expect(renderToStaticMarkup(createElement(FileCard, { doc: { id: "r1", title: "T", sfile: "a.pdf" }, opening: true }))).toContain("Opening…");
  });
});

describe("LibraryHome wiring (source guards)", () => {
  const src = read("../src/workspaces/library/components/LibraryHome.jsx");
  it("rows wait for the first full read, so nothing moves under a hand (NEW-1)", () => {
    for (const section of ["!loading && (pinnedFolders", "!loading && recentCards", "!loading && (unfiled"]) expect(src).toContain(section);
    expect(src).toMatch(/setTimeout\(\(\) => setLoading\(false\), 8000\)/);   // a hung read cannot blank the page forever
  });
  it("an Open that does not leave the Library is said out loud and recorded (NEW-1: never a silent nothing)", () => {
    expect(src).toContain("library-open-no-response");
    expect(src).toContain('data-testid="library-open-note"');
  });
  it("the Projects list is not loosened — record-only sites are a separate named section (NEW-2)", () => {
    expect(src).toContain("listTrackedProjects");
    expect(src).toContain('data-testid="library-tracked-sites"');
    expect(read("../src/shared/projects/projects.js")).toMatch(/roleOf\(s\) === "pursuit"\)\);/);
  });
});
