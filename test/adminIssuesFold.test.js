import { describe, it, expect } from "vitest";
import { shapeErrorGroups } from "../src/workspaces/admin/lib/adminPanels.js";
import { isDeployReload, chunkFile, normalizeMessage, foldIssues, sortIssues, searchIssues, visibleCount } from "../src/workspaces/admin/lib/adminIssues.js";

const row = (o) => ({ kind: "error", source: "react", message: "x", occurrences: 1, accounts: 1, first_seen: "2026-10-01T00:00:00Z", last_seen: "2026-10-04T00:00:00Z", last_build: "abc", builds: 1, ...o });
const CHUNK = (name, hash) => `Failed to fetch dynamically imported module: https://planyr.io/assets/${name}-${hash}.js`;
const NOW = new Date("2026-10-05T12:00:00Z").getTime();

describe("deploy-reload fold (real message samples)", () => {
  const rows = shapeErrorGroups([
    row({ source: "vite:preloadError", message: CHUNK("AdminGate", "Ab12Cd34"), occurrences: 1 }),
    row({ source: "unhandledrejection", message: CHUNK("AdminGate", "Zz99Yy88"), occurrences: 1 }),
    row({ source: "react", message: CHUNK("SitePlannerApp", "Qw12Er34"), occurrences: 2 }),
    row({ source: "vite:preloadError", message: "Unable to preload CSS for /assets/index-aaaaaaaa.css", occurrences: 1 }),
    row({ source: "window.onerror", message: "Cannot read properties of undefined (reading 'x') at https://planyr.io/assets/A-12345678.js:10:22", occurrences: 4, last_seen: "2026-10-05T10:00:00Z", first_seen: "2026-10-05T09:00:00Z" }),
    row({ source: "react", message: "Cannot read properties of undefined (reading 'x') at https://planyr.io/assets/A-87654321.js:99:1", occurrences: 3 }),
  ]);
  const { deploy, groups } = foldIssues(rows, NOW);
  it("recognises every chunk-load form, across sources", () => {
    expect(isDeployReload({ rawMessage: CHUNK("A", "12345678") })).toBe(true);
    expect(isDeployReload({ rawMessage: "boom", source: "vite:preloadError" })).toBe(true);
    expect(isDeployReload({ rawMessage: "Cannot read properties" })).toBe(false);
  });
  it("folds them into one block: occurrences and distinct files, ignoring hash and source", () => {
    expect(deploy.occurrences).toBe(5);
    expect(deploy.fileCount).toBe(3); // AdminGate.js, SitePlannerApp.js, index.css
    expect(deploy.files.find((f) => f.file === "AdminGate.js")).toMatchObject({ occurrences: 2, sources: ["vite:preloadError", "unhandledrejection"] });
  });
  it("keeps them out of the error groups", () => {
    expect(groups.every((g) => !/dynamically imported/.test(g.message))).toBe(true);
  });
  it("one bug is one row: same message, different hash/line:col/source merge, sources listed inside", () => {
    expect(groups).toHaveLength(1);
    expect(groups[0].occurrences).toBe(7);
    expect(groups[0].sources.map((s) => s.source).sort()).toEqual(["react", "window.onerror"]);
    expect(groups[0].rawKeys).toHaveLength(2);
  });
  it("marks a group first seen in the last 24 h as New", () => { expect(groups[0].isNew).toBe(false); expect(foldIssues(rows.filter((r) => r.source === "window.onerror"), NOW).groups[0].isNew).toBe(true); });
  it("an empty input is empty", () => { expect(foldIssues([], NOW)).toMatchObject({ deploy: { occurrences: 0, fileCount: 0 }, groups: [] }); });
});

describe("normalising + chunk names", () => {
  it("strips hashes, ids and line:col", () => {
    expect(normalizeMessage("at https://planyr.io/assets/Foo-AbCd1234.js:10:22")).toBe("at https://planyr.io/assets/Foo-*.js");
    expect(normalizeMessage("row 123e4567-e89b-12d3-a456-426614174000 missing")).toBe("row <id> missing");
  });
  it("names the chunk without its hash", () => {
    expect(chunkFile(CHUNK("DocReview", "Hq81xZ_a"))).toBe("DocReview.js");
    expect(chunkFile("nothing here")).toBe("(unknown file)");
  });
});

describe("sort / search / paging", () => {
  const g = (message, occurrences, last) => ({ key: message, message, occurrences, accounts: 1, lastSeen: last, sources: [{ source: "react", occurrences }] });
  const list = [g("a", 5, "2026-10-01T00:00:00Z"), g("b", 5, "2026-10-04T00:00:00Z"), g("c", 9, "2026-09-30T00:00:00Z")];
  it("default: count desc, then last seen desc", () => { expect(sortIssues(list).map((x) => x.message)).toEqual(["c", "b", "a"]); });
  it("sortable by last seen and message", () => {
    expect(sortIssues(list, "lastSeen", "desc").map((x) => x.message)).toEqual(["b", "a", "c"]);
    expect(sortIssues(list, "message", "asc").map((x) => x.message)).toEqual(["a", "b", "c"]);
  });
  it("search over message and source", () => { expect(searchIssues(list, "B").map((x) => x.message)).toEqual(["b"]); expect(searchIssues(list, "react")).toHaveLength(3); });
  it("top 10, then pages of 25", () => { expect([0, 1, 2].map(visibleCount)).toEqual([10, 35, 60]); });
});
