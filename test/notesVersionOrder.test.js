/* notesVersionOrder — orders a conflict's two copies by recency, never by which browser window
 * they came from (B849105). PURE.
 */
import { describe, it, expect } from "vitest";
import { orderConflictVersions } from "../src/workspaces/notes/lib/notesVersionOrder.js";

describe("orderConflictVersions — the owner's exact case: 'this window' is the OLDER copy", () => {
  it("puts the server (newer) copy in `newer` and the local (older) copy in `older`", () => {
    const localDoc = { type: "doc", content: [{ type: "text", text: "has a table" }] };
    const serverDoc = { type: "doc", content: [{ type: "text", text: "table converted to text" }] };
    const now = Date.now();
    const r = orderConflictVersions({
      localDoc, serverDoc,
      localUpdatedAt: now - 4 * 24 * 60 * 60 * 1000,   // 4 days ago
      serverUpdatedAt: now - 1 * 24 * 60 * 60 * 1000,  // 1 day ago
    });
    expect(r.comparable).toBe(true);
    expect(r.newer.which).toBe("theirs");
    expect(r.newer.doc).toBe(serverDoc);
    expect(r.older.which).toBe("mine");
    expect(r.older.doc).toBe(localDoc);
  });
});

describe("orderConflictVersions — the local copy is newer", () => {
  it("puts local in `newer`", () => {
    const now = Date.now();
    const r = orderConflictVersions({
      localDoc: "L", serverDoc: "S",
      localUpdatedAt: now - 1000,
      serverUpdatedAt: now - 5000,
    });
    expect(r.comparable).toBe(true);
    expect(r.newer.which).toBe("mine");
    expect(r.older.which).toBe("theirs");
  });
});

describe("orderConflictVersions — not comparable, and the caller is told so", () => {
  it("one timestamp missing → comparable is false", () => {
    const r = orderConflictVersions({ localDoc: "L", serverDoc: "S", localUpdatedAt: null, serverUpdatedAt: Date.now() });
    expect(r.comparable).toBe(false);
  });

  it("both timestamps missing → comparable is false", () => {
    const r = orderConflictVersions({ localDoc: "L", serverDoc: "S", localUpdatedAt: null, serverUpdatedAt: null });
    expect(r.comparable).toBe(false);
  });

  it("an exact tie is NOT treated as one side being newer", () => {
    const t = Date.now();
    const r = orderConflictVersions({ localDoc: "L", serverDoc: "S", localUpdatedAt: t, serverUpdatedAt: t });
    expect(r.comparable).toBe(false);
  });

  it("`newer`/`older` are still populated (a stable local-first pairing) even when not comparable, so a caller never has to null-check them", () => {
    const r = orderConflictVersions({ localDoc: "L", serverDoc: "S", localUpdatedAt: null, serverUpdatedAt: null });
    expect(r.newer.which).toBe("mine");
    expect(r.older.which).toBe("theirs");
  });
});

describe("orderConflictVersions — missing args don't throw", () => {
  it("no args at all", () => {
    const r = orderConflictVersions();
    expect(r.comparable).toBe(false);
    expect(r.newer.doc).toBe(null);
    expect(r.older.doc).toBe(null);
  });
});
