import { describe, it, expect } from "vitest";
import { deletedFilesForProject } from "../src/shared/sitePlans/lib/deletedSitePlanFiles.js";

// NEW-1 (2026-10-20) — deleted site-plan FILES are listed in the Site Planner's plan menu, per project.
const rows = [
  { id: "a", project_id: "g1", doc_title: "Master plan", page: 2, source_file_name: "master.pdf", deleted_at: "2026-10-19T12:00:00Z" },
  { id: "b", project_id: "g2", doc_title: "Other site", page: 1, source_file_name: null, deleted_at: "2026-10-18T12:00:00Z" },
  { id: "c", project_id: null, doc_title: null, page: 1, source_file_name: null, deleted_at: null },
];

describe("deletedFilesForProject", () => {
  it("keeps this project's files and never another project's", () => {
    const ids = deletedFilesForProject(rows, "g1").map((f) => f.id);
    expect(ids).toContain("a");
    expect(ids).not.toContain("b");
  });
  it("keeps a file detached from every site reachable (offered in the open project's menu)", () => {
    expect(deletedFilesForProject(rows, "g1").map((f) => f.id)).toContain("c");
  });
  it("shapes a row for the menu (name fallback, ms timestamp, file name kept for the tooltip)", () => {
    const [a, , c] = [...deletedFilesForProject(rows, "g1"), ...deletedFilesForProject(rows, "g1")].slice(0, 3);
    expect(a).toMatchObject({ id: "a", name: "Master plan", page: 2, fileName: "master.pdf", projectId: "g1" });
    expect(a.deletedAt).toBe(Date.parse("2026-10-19T12:00:00Z"));
    const orphan = deletedFilesForProject(rows, "g1").find((f) => f.id === "c");
    expect(orphan.name).toBe("Untitled site plan");
    expect(orphan.deletedAt).toBeNull();
    expect(c).toBeDefined();
  });
  it("is empty-safe", () => {
    expect(deletedFilesForProject(null, "g1")).toEqual([]);
    expect(deletedFilesForProject([], "g1")).toEqual([]);
  });
});
