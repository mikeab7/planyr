import { describe, it, expect } from "vitest";
import { syncProjectFolders, planDelete, slugSeg, treeParentForUpload } from "../server/storage/folderMirror.js";

// A fake project_folders store: holds rows, applies drive_* patches like Supabase would.
function fakeStore(initial) {
  const rows = initial.map((r) => ({
    id: r.id, parentId: r.parentId ?? null, name: r.name, trashed: r.trashed ?? false,
    driveFolderId: r.driveFolderId ?? null, driveParentId: r.driveParentId ?? null,
    driveName: r.driveName ?? null, driveTrashed: r.driveTrashed ?? false,
  }));
  return {
    rows,
    async list() { return rows.map((r) => ({ ...r })); },
    async updateDrive(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) return { ok: false, error: "no row" };
      if ("driveFolderId" in patch) row.driveFolderId = patch.driveFolderId;
      if ("driveParentId" in patch) row.driveParentId = patch.driveParentId;
      if ("driveName" in patch) row.driveName = patch.driveName;
      if ("driveTrashed" in patch) row.driveTrashed = patch.driveTrashed;
      return { ok: true };
    },
  };
}

// A fake Drive client that mints folder ids + records ops.
function fakeClient({ children = {} } = {}) {
  let n = 0;
  const calls = { created: [], updated: [], trashed: [], listed: [] };
  return {
    calls,
    async folderId(path) { return `root:${path}`; },
    async createSubfolder({ name, parentFolderId }) { n += 1; calls.created.push({ name, parentFolderId }); return { id: `d${n}` }; },
    async update(fileId, patch) { calls.updated.push({ fileId, ...patch }); return { id: fileId }; },
    async trash(fileId) { calls.trashed.push(fileId); },
    async list({ parentFolderId }) { calls.listed.push(parentFolderId); return children[parentFolderId] || []; },
  };
}

describe("slugSeg", () => {
  it("matches the files.js filing slug (lowercase, dash-collapsed)", () => {
    expect(slugSeg("Project ABC")).toBe("project-abc");
    expect(slugSeg("")).toBe("x");
  });
});

describe("syncProjectFolders — create pass (B650)", () => {
  it("creates a fresh nested tree parents-first, persists drive ids, then no-ops", async () => {
    const store = fakeStore([
      { id: "c", parentId: "b", name: "C" },
      { id: "a", parentId: null, name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ]);
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });

    expect(r.ok).toBe(true);
    expect(r.summary.created).toBe(3);
    // A created under the project root; B under A's new id; C under B's new id.
    expect(client.calls.created[0]).toEqual({ name: "A", parentFolderId: "root:u1/project-p1" });
    expect(client.calls.created[1].name).toBe("B");
    expect(client.calls.created[1].parentFolderId).toBe("d1"); // A's minted id
    expect(client.calls.created[2].parentFolderId).toBe("d2"); // B's minted id
    // Bookkeeping persisted: top-level driveParentId stays null (means "project root").
    expect(store.rows.find((x) => x.id === "a").driveParentId).toBe(null);
    expect(store.rows.find((x) => x.id === "b").driveParentId).toBe("d1");

    // Second sync: nothing to do.
    const again = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(again.summary).toEqual({ created: 0, renamed: 0, moved: 0, trashed: 0 });
  });
});

describe("syncProjectFolders — rename / move / trash (B650)", () => {
  it("renames in place on the existing Drive id", async () => {
    const store = fakeStore([
      { id: "a", parentId: null, name: "New Name", driveFolderId: "d1", driveName: "Old Name", driveParentId: null },
    ]);
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(r.summary.renamed).toBe(1);
    expect(client.calls.updated).toEqual([{ fileId: "d1", name: "New Name" }]);
    expect(store.rows[0].driveName).toBe("New Name");
  });

  it("moves in place (add new parent, remove old)", async () => {
    const store = fakeStore([
      { id: "p2", parentId: null, name: "P2", driveFolderId: "dp2", driveName: "P2", driveParentId: null },
      { id: "c", parentId: "p2", name: "C", driveFolderId: "dc", driveName: "C", driveParentId: "dp1" },
    ]);
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(r.summary.moved).toBe(1);
    expect(client.calls.updated).toEqual([{ fileId: "dc", addParents: "dp2", removeParents: "dp1" }]);
    expect(store.rows.find((x) => x.id === "c").driveParentId).toBe("dp2");
  });

  it("trashes the subtree root only and flags the whole subtree drive_trashed", async () => {
    const store = fakeStore([
      { id: "a", parentId: null, name: "A", trashed: true, driveFolderId: "d1", driveName: "A" },
      { id: "b", parentId: "a", name: "B", trashed: true, driveFolderId: "d2", driveName: "B", driveParentId: "d1" },
    ]);
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(r.summary.trashed).toBe(1);
    expect(client.calls.trashed).toEqual(["d1"]); // only the root; Drive cascades to d2
    expect(store.rows.every((x) => x.driveTrashed)).toBe(true);
  });
});

describe("syncProjectFolders — robustness fixes (B650 review)", () => {
  it("moves an existing folder UNDER a folder created in the same sync (one pass)", async () => {
    const store = fakeStore([
      { id: "b", parentId: null, name: "B" }, // brand-new parent (a create)
      { id: "a", parentId: "b", name: "A", driveFolderId: "da", driveName: "A", driveParentId: "root0" },
    ]);
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(r.ok).toBe(true);
    expect(r.summary.created).toBe(1);
    expect(r.summary.moved).toBe(1);
    const upd = client.calls.updated.find((u) => u.fileId === "da");
    expect(upd.addParents).toBe("d1"); // B's freshly-minted id
    expect(upd.removeParents).toBe("root0");
    expect(store.rows.find((x) => x.id === "a").driveParentId).toBe("d1");
  });

  it("rolls back (trashes) a created Drive folder whose id fails to persist — no duplicate next sync", async () => {
    const rows = [{ id: "a", parentId: null, name: "A" }];
    const store = {
      rows,
      async list() { return [{ id: "a", parentId: null, name: "A", trashed: false, driveFolderId: null, driveParentId: null, driveName: null, driveTrashed: false }]; },
      async updateDrive() { return { ok: false, error: "supabase 503" }; }, // persist always fails
    };
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store });
    expect(r.ok).toBe(false); // error surfaced, never a silent success
    expect(client.calls.created).toHaveLength(1);
    expect(client.calls.trashed).toEqual(["d1"]); // the orphan was trashed so it can't duplicate
    expect(r.summary.created).toBe(0);
  });
});

describe("syncProjectFolders — chunked ops (the live-502 fix, B650)", () => {
  // A 3-level tree of 12 folders, none mirrored yet.
  const bigTree = () => {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      rows.push({ id: `t${i}`, parentId: null, name: `T${i}` });
      for (let j = 0; j < 3; j++) rows.push({ id: `t${i}c${j}`, parentId: `t${i}`, name: `C${j}` });
    }
    return rows;
  };

  it("executes at most maxOps per call, reports remaining, and finishes over rounds with no duplicates", async () => {
    const store = fakeStore(bigTree());
    const client = fakeClient();
    const r1 = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 5 });
    expect(r1.ok).toBe(true);
    expect(r1.summary.created).toBe(5);
    expect(r1.total).toBe(12);
    expect(r1.remaining).toBe(7);

    // Loop like the client does until remaining hits 0.
    let rounds = 0;
    let last = r1;
    while (last.remaining > 0 && rounds < 10) {
      last = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 5 });
      rounds += 1;
    }
    expect(last.remaining).toBe(0);
    expect(client.calls.created).toHaveLength(12); // every folder created EXACTLY once
    expect(store.rows.every((x) => x.driveFolderId)).toBe(true);
    // And a further sync is a clean no-op.
    const done = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 5 });
    expect(done.total).toBe(0);
    expect(client.calls.created).toHaveLength(12);
  });

  it("keeps parents-first across the chunk boundary (a child never precedes its parent)", async () => {
    const store = fakeStore(bigTree());
    const client = fakeClient();
    let r;
    do {
      r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 4 });
      expect(r.errors).toEqual([]); // "parent not yet in Drive" would land here
    } while (r.remaining > 0);
    expect(client.calls.created).toHaveLength(12);
  });

  it("defers (not errors) a move whose new parent's create fell past the chunk budget", async () => {
    const store = fakeStore([
      { id: "n1", parentId: null, name: "N1" }, // create #1 (fills the budget)
      { id: "n2", parentId: null, name: "N2" }, // create #2 — beyond budget
      // already-mirrored folder being moved under n2:
      { id: "m", parentId: "n2", name: "M", driveFolderId: "dm", driveName: "M", driveParentId: "old" },
    ]);
    const client = fakeClient();
    const r1 = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 1 });
    expect(r1.ok).toBe(true);
    expect(r1.errors).toEqual([]);
    expect(r1.remaining).toBeGreaterThan(0); // n2's create + m's move still pending
    // Finish the loop — the move lands once n2 exists.
    let last = r1;
    let guard = 0;
    while (last.remaining > 0 && guard++ < 10) {
      last = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 1 });
      expect(last.errors).toEqual([]);
    }
    expect(store.rows.find((x) => x.id === "m").driveParentId).toBe("d2"); // n2's minted id
  });

  it("surfaces the first error as `error` (never a bare status code for the user)", async () => {
    const store = {
      rows: [],
      async list() { return [{ id: "a", parentId: null, name: "A", trashed: false, driveFolderId: null, driveParentId: null, driveName: null, driveTrashed: false }]; },
      async updateDrive() { return { ok: false, error: "supabase 503" }; },
    };
    const client = fakeClient();
    const r = await syncProjectFolders({ projectId: "p1", userId: "u1", client, store, maxOps: 20 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/supabase 503/);
    expect(r.remaining).toBeGreaterThan(0); // the failed create re-plans next round
  });
});

describe("treeParentForUpload — server-side tree targeting for uploads (B650)", () => {
  const treeRows = [
    { id: "design", parentId: null, name: "02. Design", trashed: false, driveFolderId: "d-design", driveParentId: null, driveName: "02. Design", driveTrashed: false },
    { id: "drawings", parentId: "design", name: "01. Drawings", trashed: false, driveFolderId: "d-drawings", driveParentId: "d-design", driveName: "01. Drawings", driveTrashed: false },
    { id: "civil", parentId: "drawings", name: "05. Civil", trashed: false, driveFolderId: "d-civil", driveParentId: "d-drawings", driveName: "05. Civil", driveTrashed: false },
    { id: "cur", parentId: "civil", name: "01. Current", trashed: false, driveFolderId: "d-cur", driveParentId: "d-civil", driveName: "01. Current", driveTrashed: false },
  ];

  it("returns the mirrored Current folder's Drive id for a known discipline", async () => {
    const store = { async list() { return treeRows; } };
    expect(await treeParentForUpload({ store, projectId: "p1", discipline: "Civil" })).toBe("d-cur");
  });

  it("returns null when the tree is empty / project missing / store throws (legacy path)", async () => {
    expect(await treeParentForUpload({ store: { async list() { return []; } }, projectId: "p1", discipline: "Civil" })).toBe(null);
    expect(await treeParentForUpload({ store: { async list() { return treeRows; } }, projectId: null, discipline: "Civil" })).toBe(null);
    expect(await treeParentForUpload({ store: { async list() { throw new Error("boom"); } }, projectId: "p1", discipline: "Civil" })).toBe(null);
  });
});

describe("planDelete — enumerate what a delete removes (B650)", () => {
  it("lists subtree folders (from the index) + files (live from Drive)", async () => {
    const store = fakeStore([
      { id: "a", parentId: null, name: "01. Civil", driveFolderId: "d1" },
      { id: "b", parentId: "a", name: "01. Current", driveFolderId: "d2" },
    ]);
    const client = fakeClient({
      children: {
        d1: [{ name: "sub", mimeType: "application/vnd.google-apps.folder" }],
        d2: [{ name: "grading.pdf", mimeType: "application/pdf" }, { name: "site.dwg", mimeType: "application/acad" }],
      },
    });
    const r = await planDelete({ projectId: "p1", folderId: "a", client, store });
    expect(r.ok).toBe(true);
    expect(r.folders.map((f) => f.name)).toEqual(["01. Civil", "01. Current"]);
    // Only real files, not the nested folder entry.
    expect(r.files.map((f) => f.name).sort()).toEqual(["grading.pdf", "site.dwg"]);
    expect(r.files.every((f) => f.folder === "01. Current")).toBe(true);
  });

  it("still enumerates folders when a subtree folder was never mirrored to Drive", async () => {
    const store = fakeStore([{ id: "a", parentId: null, name: "01. Land", driveFolderId: null }]);
    const client = fakeClient();
    const r = await planDelete({ projectId: "p1", folderId: "a", client, store });
    expect(r.folders.map((f) => f.name)).toEqual(["01. Land"]);
    expect(r.files).toEqual([]);
  });
});
