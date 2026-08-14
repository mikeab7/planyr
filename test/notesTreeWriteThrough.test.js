/* THE STORED TREE IS NEVER STALER THAN THE SCREEN (B400176).
 *
 * ⛔ THE REPORT: *"rename a loose page from 'Untitled page' to 'PROBE13 TITLE'. The stored tree
 * updated immediately and correctly, but the sidebar list under NOT IN A PROJECT no longer
 * showed the note at all — it listed only 'Recovered — ...'. After a reload the renamed note was
 * back in the list in the right place."*
 *
 * ⛔ THE CAUSE, and it is a seam rather than a screen. This tree has TWO readers reading two
 * different copies. The rail renders from React state; the cloud sync reads `localStorage`. The
 * workspace wrote the tree on a 400 ms debounce, so inside that window the stored copy was the
 * tree as it stood BEFORE the edit — and the sync does not merely read the stored copy, it acts
 * on it:
 *
 *   • `seed()` decides whether this device owes an edit by asking `sync.treeDirty`, which only
 *     becomes true when `writeTree` runs. Inside the window it is still FALSE, so the seed
 *     concludes this device is clean and ADOPTS the account's tree wholesale — a tree that
 *     cannot contain an edit this device has not written down yet. It then hands that back to
 *     the workspace, which is the row leaving the rail.
 *   • `pushPending` pushes `readTreeRaw()`, so an edit made inside the window is not merely late
 *     to the account — it is skipped entirely.
 *
 * ⛔ WHAT THIS SUITE PROVES, in the order it matters. The first case DEMONSTRATES the loss by
 * modelling the debounce exactly — a workspace holding an edit it has not written — so the cost
 * is on the record rather than asserted. The rest assert the property that makes it impossible:
 * once an edit is written, no seed may adopt it away, for a rename, a new page, a move or a
 * delete. Measured with a real keyboard beside this, in `ui-audit/verify-notes-rename-live.mjs`.
 *
 * ⛔ AND WHY IT LIVES AT THE STORE RATHER THAN AT THE COMPONENT: the workspace's debounce was
 * one way to arrive at a stale stored tree, and the guard should not be about that one way.
 * Anything that leaves an edit unwritten while a seed runs loses it, and the suite says so in
 * terms of the seam rather than in terms of a timer somebody might reintroduce elsewhere.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addPage, allPageIds, findPage, migrate, movePage, deleteNode, projectOfPage, renameNode, setPageProject } from "../src/workspaces/notes/lib/notesModel.js";
import { mergeTrees } from "../src/workspaces/notes/lib/notesCloud.js";

const UID = "u_writethrough";
const GRAND_PORT = "smqfy2r7pdec";
const COLORADO = "sms7v3ua7ksy";

/** Which project a page is filed under, asked the way the rail asks it. */
const projectOf = (tree, id) => projectOfPage(tree, id);

/* ---- the server: one row per table, `rev` owned by it exactly as the deployed trigger owns
 * it, so a guarded push whose `rev` filter misses returns zero rows and reads as a conflict. */
function fakeServer() {
  return { tree: null, treeRev: 0, pages: new Map(), images: new Map() };
}

function clientFor(server) {
  const runSelect = (table, filters) => {
    if (table === "notes_trees") return server.tree == null ? [] : [{ data: server.tree, rev: server.treeRev }];
    if (table === "notes_images") return [...server.images.values()];
    let rows = [...server.pages.entries()].map(([id, r]) => ({ id, ...r }));
    if (filters.id !== undefined) {
      const want = Array.isArray(filters.id) ? new Set(filters.id) : new Set([filters.id]);
      rows = rows.filter((r) => want.has(r.id));
    }
    return rows;
  };

  const runWrite = (table, op, payload, filters) => {
    if (table === "notes_trees") {
      if (op === "insert") {
        if (server.tree != null) return { rows: [], error: { code: "23505", message: "duplicate key" } };
        server.tree = payload.data; server.treeRev = 1;
        return { rows: [{ rev: 1 }], error: null };
      }
      if (filters.rev !== undefined && filters.rev !== server.treeRev) return { rows: [], error: null };
      server.tree = payload.data; server.treeRev += 1;
      return { rows: [{ rev: server.treeRev }], error: null };
    }
    const rows = [];
    const list = op === "insert" ? [payload].flat() : [payload].flat();
    for (const p of list) {
      const id = p.id ?? filters.id;
      const prev = server.pages.get(id);
      if (op === "update" && filters.rev !== undefined && prev && filters.rev !== prev.rev) continue;
      const rev = (prev?.rev || 0) + 1;
      server.pages.set(id, { ...(prev || {}), ...p, rev });
      rows.push({ id, rev });
    }
    return { rows, error: null };
  };

  const builder = (table, op, payload) => {
    const filters = {};
    const exec = () => {
      if (op === "select") return { data: runSelect(table, filters), error: null };
      const r = runWrite(table, op, payload, filters);
      return { data: r.error ? null : r.rows, error: r.error };
    };
    const self = {
      eq(col, val) { filters[col] = val; return self; },
      in(col, vals) { filters[col] = vals; return self; },
      select() { return self; },
      maybeSingle() { const { data, error } = exec(); return Promise.resolve({ data: error ? null : (data?.[0] ?? null), error }); },
      then(res, rej) { const { data, error } = exec(); return Promise.resolve({ data, error }).then(res, rej); },
    };
    return self;
  };

  return {
    from(table) {
      return {
        select: () => builder(table, "select"),
        insert: (p) => builder(table, "insert", p),
        update: (p) => builder(table, "update", p),
        upsert: (p) => builder(table, "upsert", p),
      };
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        download: async () => ({ data: null, error: { message: "not stored" } }),
        remove: async () => ({ error: null }),
      }),
    },
  };
}

/** A browser window: its own localStorage, its own module instance, one shared server. */
async function openWindow(server) {
  const mem = new Map();
  const localStorage = {
    get length() { return mem.size; },
    key: (i) => [...mem.keys()][i] ?? null,
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
    clear: () => mem.clear(),
  };
  globalThis.window = {
    localStorage,
    addEventListener() {}, removeEventListener() {},
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
  };
  globalThis.document = { visibilityState: "visible" };

  vi.resetModules();
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: clientFor(server) }));
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  return { store, localStorage };
}

const focus = (w) => { globalThis.window.localStorage = w.localStorage; };
const readTree = (w) => migrate(w.store.readTreeRaw());
const titleOf = (t, id) => findPage(t, id)?.page?.title ?? null;

/** His rail: the note he renamed, and the one that was still there after it vanished. */
const seedTree = () => ({
  v: 3, tombs: [], trash: [],
  pages: [
    { id: "p_probe", title: "Untitled page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
    { id: "p_rec", title: "Recovered — 3 blocks", createdAt: 2, updatedAt: 2, projectId: null, pages: [] },
  ],
});

/** Publish the account from one window and open a second on it. Returns both, synced. */
async function twoWindows() {
  const server = fakeServer();
  const A = await openWindow(server);
  focus(A);
  A.store.setNotesScope(UID);
  A.store.writeTree(seedTree());
  await A.store.startNotesSync({});
  await A.store.refreshNotesSync();

  const B = await openWindow(server);
  focus(B);
  B.store.setNotesScope(UID);
  await B.store.startNotesSync({});
  return { server, A, B };
}

/** Something happening on the OTHER computer, which is what bumps the server's rev and so
 *  makes this device's next seed take the adopt branch at all. */
async function otherDeviceAddsANote(w, id) {
  focus(w);
  const next = addPage(readTree(w), { id, title: `From the other computer ${id}` });
  w.store.writeTree(next.tree);
  await w.store.refreshNotesSync();
}

afterEach(() => { vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js"); });

describe("an edit that is only in memory when a sync tick lands", () => {
  /* ⛔ THE DEMONSTRATION. Not a guard on today's code — a record of what the debounce cost, so
   * nobody has to take the diagnosis on trust. The workspace is modelled exactly as it behaved:
   * it holds the renamed tree in a ref and has not called `writeTree` yet. */
  it("⛔ IS ADOPTED AWAY — the rename is lost and the note leaves the rail", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    // The workspace's in-memory tree after a rename, un-written — the debounce window.
    const inMemory = renameNode(readTree(A), "p_probe", "PROBE13 TITLE");
    expect(titleOf(inMemory, "p_probe")).toBe("PROBE13 TITLE");

    await A.store.refreshNotesSync();      // a sync tick lands inside the window

    // The stored tree — which is what `onTree` hands back to the rail — never heard of it.
    expect(titleOf(readTree(A), "p_probe")).toBe("Untitled page");
    // …and the workspace's own copy is about to be replaced by that one.
    expect(titleOf(readTree(A), "p_probe")).not.toBe(titleOf(inMemory, "p_probe"));
  });

  /* The costlier half of the same shape: a page that exists only in memory is not late to the
   * account, it never existed. This is the version of the failure that matches his report —
   * a note leaving the rail rather than merely wearing an old name. */
  it("⛔ …and a NEW page held only in memory is adopted out of existence entirely", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    const inMemory = addPage(readTree(A), { id: "p_new", title: "A note made a moment ago" }).tree;
    expect(allPageIds(inMemory)).toContain("p_new");

    await A.store.refreshNotesSync();

    expect(allPageIds(readTree(A))).not.toContain("p_new");
  });
});

describe("⛔ THE RULE: a tree edit that has been WRITTEN survives every sync path", () => {
  it("a rename survives a seed that also brings the other computer's new note", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "PROBE13 TITLE"));
    await A.store.refreshNotesSync();

    const after = readTree(A);
    expect(titleOf(after, "p_probe")).toBe("PROBE13 TITLE");     // his edit
    expect(allPageIds(after)).toContain("p_other");              // and the other computer's
    expect(allPageIds(after)).toContain("p_rec");                // and nothing else went
  });

  it("…and it reaches the account, rather than being skipped by the push", async () => {
    const { server, A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "PROBE13 TITLE"));
    await A.store.refreshNotesSync();

    expect(titleOf(migrate(server.tree), "p_probe")).toBe("PROBE13 TITLE");

    // …and the other window sees it, which is the whole point of writing it down.
    focus(B);
    await B.store.refreshNotesSync();
    expect(titleOf(readTree(B), "p_probe")).toBe("PROBE13 TITLE");
  });

  it("a NEW page survives, on both devices", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(addPage(readTree(A), { id: "p_new", title: "A note made a moment ago" }).tree);
    await A.store.refreshNotesSync();
    expect(allPageIds(readTree(A))).toContain("p_new");

    focus(B);
    await B.store.refreshNotesSync();
    expect(allPageIds(readTree(B))).toContain("p_new");
  });

  it("a MOVE survives — the page is nested where it was put, not back at the top", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(movePage(readTree(A), "p_probe", "p_rec", 0));
    await A.store.refreshNotesSync();

    const after = readTree(A);
    expect(findPage(after, "p_probe")?.parent?.id).toBe("p_rec");
    expect((after.pages || []).map((p) => p.id)).not.toContain("p_probe");
  });

  it("a DELETE survives — a binned note is not un-binned by the account's copy", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    const del = deleteNode(readTree(A), "p_probe");
    expect(del.entry).toBeTruthy();
    A.store.writeTree(del.tree);
    await A.store.refreshNotesSync();

    const after = readTree(A);
    expect((after.pages || []).map((p) => p.id)).not.toContain("p_probe");
    expect((after.trash || []).map((e) => e.id)).toContain(del.entry.id);
  });

  /* ⛔ AND THE DEFECT THIS SUITE FOUND ON ITS FIRST RUN, which is not the one it was written
   * for (B342996). Writing the rename down was necessary and was NOT sufficient: it reached the
   * account correctly and the OTHER computer then reverted it and pushed the old name back up.
   *
   * `mergeTrees` rule 3 was "the local title wins", unconditionally, justified by the merge only
   * running when this device owes an edit. Owing an edit on one page says nothing about another
   * page's name, and nothing at all about which name was typed LAST. So a rename could not
   * travel between two machines in either direction, and the account ended up holding the name
   * the owner had just replaced. `renameNode` now dates the rename and the merge asks. */
  it("⛔ A RENAME REACHES THE OTHER COMPUTER — and is not reverted and pushed back by it", async () => {
    const { server, A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "PROBE13 TITLE"));
    await A.store.refreshNotesSync();
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("PROBE13 TITLE");

    focus(B);
    await B.store.refreshNotesSync();
    expect(titleOf(readTree(B), "p_probe")).toBe("PROBE13 TITLE");
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("PROBE13 TITLE");   // B did not undo it

    // …and it stays put when A syncs again, rather than ping-ponging between the two.
    focus(A);
    await A.store.refreshNotesSync();
    expect(titleOf(readTree(A), "p_probe")).toBe("PROBE13 TITLE");
  });

  it("…and the LATER of two rival renames wins, whichever machine typed it", async () => {
    const { A, B } = await twoWindows();

    // B renames first and pushes; A renames the same note afterwards.
    focus(B);
    B.store.writeTree(renameNode(readTree(B), "p_probe", "B typed this first", 1000));
    await B.store.refreshNotesSync();

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "A typed this last", 2000));
    await A.store.refreshNotesSync();
    expect(titleOf(readTree(A), "p_probe")).toBe("A typed this last");

    focus(B);
    await B.store.refreshNotesSync();
    expect(titleOf(readTree(B), "p_probe")).toBe("A typed this last");
  });

  it("⛔ …and a TIE resolves to the copy in front of you, never to a coin toss", async () => {
    const { A, B } = await twoWindows();

    focus(B);
    B.store.writeTree(renameNode(readTree(B), "p_probe", "Theirs", 5000));
    await B.store.refreshNotesSync();

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "Mine", 5000));   // the same instant
    await A.store.refreshNotesSync();
    expect(titleOf(readTree(A), "p_probe")).toBe("Mine");
  });

  /* ⛔ AND THE HALF B342996 DELIBERATELY LEFT OPEN FOR ONE ROUND (B421493): a RE-FILE travels
   * too. It is the same defect the name had — the stale computer silently put the note back in
   * its old project and pushed that up — and it was deferred because `projectId` sits with
   * PLACEMENT, which rule 4 gives to the local side and which the reachability fuzz is built
   * around. The distinction that makes it safe: a project is a VALUE on a ROOT, not a position.
   * Parent and sibling order are untouched, and the case below proves that in the same breath. */
  it("⛔ A RE-FILE REACHES THE OTHER COMPUTER — and is not put back by it", async () => {
    const { server, A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(setPageProject(readTree(A), "p_probe", GRAND_PORT, 5000));
    await A.store.refreshNotesSync();
    expect(projectOf(readTree(A), "p_probe")).toBe(GRAND_PORT);
    expect(projectOf(migrate(server.tree), "p_probe")).toBe(GRAND_PORT);

    focus(B);
    await B.store.refreshNotesSync();
    expect(projectOf(readTree(B), "p_probe")).toBe(GRAND_PORT);
    expect(projectOf(migrate(server.tree), "p_probe")).toBe(GRAND_PORT);   // B did not undo it

    focus(A);
    await A.store.refreshNotesSync();
    expect(projectOf(readTree(A), "p_probe")).toBe(GRAND_PORT);            // and it stays put
  });

  it("…in the OTHER direction too — B files it, A picks it up", async () => {
    const { A, B } = await twoWindows();

    focus(B);
    B.store.writeTree(setPageProject(readTree(B), "p_rec", COLORADO, 5000));
    await B.store.refreshNotesSync();

    focus(A);
    await A.store.refreshNotesSync();
    expect(projectOf(readTree(A), "p_rec")).toBe(COLORADO);
  });

  it("…and UN-filing travels, which is the case a truthy check would miss", async () => {
    const { A, B } = await twoWindows();

    /* ⛔ THE TIMES ARE EXPLICIT, and that is not a convenience. Two `Date.now()` calls inside one
     * test land in the same millisecond, which the merge correctly reads as a TIE and resolves to
     * local — so the wall clock made this case pass or fail depending on how busy the machine
     * was. A test whose verdict depends on its own speed proves nothing either way. */
    focus(A);
    A.store.writeTree(setPageProject(readTree(A), "p_probe", GRAND_PORT, 1000));
    await A.store.refreshNotesSync();
    focus(B);
    await B.store.refreshNotesSync();
    expect(projectOf(readTree(B), "p_probe")).toBe(GRAND_PORT);

    // …now take it back out of every project. `null` is a real answer, not "no answer" — a
    // truthiness test here would keep the old project forever.
    focus(B);
    B.store.writeTree(setPageProject(readTree(B), "p_probe", null, 2000));
    await B.store.refreshNotesSync();
    focus(A);
    await A.store.refreshNotesSync();
    expect(projectOf(readTree(A), "p_probe")).toBeNull();
  });

  it("⛔ …and the LATER re-file wins, whichever machine made it", async () => {
    const { A, B } = await twoWindows();

    focus(B);
    B.store.writeTree(setPageProject(readTree(B), "p_probe", COLORADO, 1000));
    await B.store.refreshNotesSync();

    focus(A);
    A.store.writeTree(setPageProject(readTree(A), "p_probe", GRAND_PORT, 2000));
    await A.store.refreshNotesSync();
    focus(B);
    await B.store.refreshNotesSync();
    expect(projectOf(readTree(B), "p_probe")).toBe(GRAND_PORT);
  });

  it("⛔ …and PLACEMENT is NOT swept along with it — a nesting made here survives", async () => {
    const { A, B } = await twoWindows();
    await otherDeviceAddsANote(B, "p_other");

    focus(A);
    A.store.writeTree(movePage(readTree(A), "p_probe", "p_rec", 0));      // nested locally
    await A.store.refreshNotesSync();
    focus(B);
    await B.store.refreshNotesSync();
    focus(A);
    await A.store.refreshNotesSync();

    const after = readTree(A);
    expect(findPage(after, "p_probe")?.parent?.id).toBe("p_rec");         // rule 4 still holds
    expect(allPageIds(after)).toContain("p_other");
  });

  /* ⛔ THE INTERLEAVING, because a single round proves less than it looks like it does: each
   * edit is written and then immediately synced, with the other computer moving in between.
   * Every one of the ten names has to be on both devices at the end. */
  it("⛔ TEN WRITE-THEN-SYNC ROUNDS, with the other computer editing between each, lose nothing", async () => {
    const { A, B } = await twoWindows();

    for (let i = 0; i < 10; i += 1) {
      await otherDeviceAddsANote(B, `p_other_${i}`);
      focus(A);
      A.store.writeTree(addPage(readTree(A), { id: `p_mine_${i}`, title: `Mine ${i}` }).tree);
      await A.store.refreshNotesSync();
    }

    focus(A);
    await A.store.refreshNotesSync();
    focus(B);
    await B.store.refreshNotesSync();

    const onA = allPageIds(readTree(A));
    const onB = allPageIds(readTree(B));
    for (let i = 0; i < 10; i += 1) {
      expect(onA).toContain(`p_mine_${i}`);
      expect(onA).toContain(`p_other_${i}`);
      expect(onB).toContain(`p_mine_${i}`);
      expect(onB).toContain(`p_other_${i}`);
    }
    expect(onA.sort()).toEqual(onB.sort());
  });
});

/* ⛔ A RENAME HAS ITS OWN CLOCK (B342996 ×3, owner decision 2026-08-13).
 *
 * THE QUESTION HE SETTLED. The merge has to know which of two titles was typed last, and the
 * only stamp a node carried was `updatedAt` — so the first fix moved `updatedAt` on a rename.
 * That works for the merge and lies to the reader: `updatedAt` is what the page header renders
 * as **Last edited**, so a note nobody had written a word in for months began claiming it was
 * edited today because somebody fixed a typo in its title. His decision, verbatim: *"'Last
 * edited' keeps meaning what it says: the text changed. A rename must not move it, and the
 * label he sees must not change because someone renamed a note."*
 *
 * SO THERE ARE NOW THREE INDEPENDENT STAMPS on a node and each answers exactly one question:
 *   • `updatedAt` — the TEXT changed. Rendered. Moved only by `touchPage`.
 *   • `renamedAt` — the TITLE changed. Never rendered; read only to settle a title conflict.
 *   • `filedAt`   — the PROJECT changed. Never rendered; read only to settle a filing conflict.
 *
 * ⛔ MIGRATION, AND IT IS THE CLAUSE THAT DECIDES WHETHER THIS IS SAFE TO SHIP. Every node
 * written before today has neither new stamp. ABSENT IS OLDEST, NEVER NEWEST — treat a missing
 * stamp as "just now" and a machine that has never renamed anything wins every disagreement by
 * default, which is the exact failure the stamps exist to stop, arriving through the migration
 * door. When NEITHER side has a stamp the rule falls back to what it was — local wins — and
 * says so in `mergeTrees`.
 *
 * ⛔ AND THE DEFECT THIS BLOCK FOUND ON ITS FIRST RUN, which is the one worth remembering
 * because it was nowhere near the merge: `migratePageNode` rebuilds every node from a NAMED
 * FIELD LIST, and every read of the tree goes through it. It did not name the two new fields,
 * so they were written correctly, destroyed on the next read, and the merge then compared two
 * absent stamps, called it a tie and kept local — indistinguishable from the old behaviour, in
 * total silence. Seven cases went red at the merge; the cause was in the reader.
 */
describe("⛔ A RENAME IS STAMPED SEPARATELY FROM AN EDIT", () => {
  it("a rename does NOT move Last edited — the label he reads keeps meaning what it says", () => {
    const before = migrate(seedTree());
    const edited = titleOf(before, "p_probe");
    expect(edited).toBe("Untitled page");

    const after = renameNode(before, "p_probe", "A new name", 999_000);
    const node = findPage(after, "p_probe").page;

    expect(node.title).toBe("A new name");
    expect(node.updatedAt).toBe(findPage(before, "p_probe").page.updatedAt);   // untouched
    expect(node.renamedAt).toBe(999_000);                                      // its own stamp
  });

  it("…and a re-file does not move it either — moving a note is not writing in it", () => {
    const before = migrate(seedTree());
    const after = setPageProject(before, "p_probe", GRAND_PORT, 999_000);
    const node = findPage(after, "p_probe").page;

    expect(node.projectId).toBe(GRAND_PORT);
    expect(node.updatedAt).toBe(findPage(before, "p_probe").page.updatedAt);
    expect(node.filedAt).toBe(999_000);
  });

  /* ⛔ THE STAMPS SURVIVE A READ. Written as its own case rather than left implicit in the
   * merge cases, because when the reader dropped them every merge case failed and none of them
   * pointed at the reader. */
  it("⛔ …and both stamps survive `migrate`, which is where they were being destroyed", () => {
    const stamped = setPageProject(renameNode(migrate(seedTree()), "p_probe", "X", 111), "p_probe", GRAND_PORT, 222);
    const reread = migrate(JSON.parse(JSON.stringify(stamped)));
    const node = findPage(reread, "p_probe").page;
    expect(node.renamedAt).toBe(111);
    expect(node.filedAt).toBe(222);
  });

  it("…and an older node with no stamps reads back with none, rather than with zeros", () => {
    const node = findPage(migrate(seedTree()), "p_probe").page;
    expect("renamedAt" in node).toBe(false);
    expect("filedAt" in node).toBe(false);
  });

  /* ⛔ HIS TEST, VERBATIM: *"two clients, one stale; rename on A, then have B push a tree that
   * predates the rename — A's name must survive, in both directions."* B is stale in the way
   * that actually happens: it has its own unpushed edit, so it MERGES rather than adopting, and
   * its copy of the renamed note is the one it was holding before the rename was typed. */
  it("⛔ A STALE COMPUTER'S PUSH DOES NOT UNDO A RENAME — A renames, B pushes an older tree", async () => {
    const { server, A, B } = await twoWindows();

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "THE NAME HE TYPED", 9000));
    await A.store.refreshNotesSync();
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("THE NAME HE TYPED");

    // B never saw the rename and has an edit of its own to push.
    focus(B);
    B.store.writeTree(addPage(readTree(B), { id: "p_b_edit", title: "B was busy" }).tree);
    await B.store.refreshNotesSync();

    expect(titleOf(readTree(B), "p_probe")).toBe("THE NAME HE TYPED");        // B adopted it
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("THE NAME HE TYPED"); // and did not push the old one back

    focus(A);
    await A.store.refreshNotesSync();
    expect(titleOf(readTree(A), "p_probe")).toBe("THE NAME HE TYPED");        // and it stays
    expect(allPageIds(readTree(A))).toContain("p_b_edit");                    // B's work still arrived
  });

  it("…and in the OTHER direction — B renames, A pushes an older tree", async () => {
    const { server, A, B } = await twoWindows();

    focus(B);
    B.store.writeTree(renameNode(readTree(B), "p_probe", "TYPED ON THE LAPTOP", 9000));
    await B.store.refreshNotesSync();

    focus(A);
    A.store.writeTree(addPage(readTree(A), { id: "p_a_edit", title: "A was busy" }).tree);
    await A.store.refreshNotesSync();

    expect(titleOf(readTree(A), "p_probe")).toBe("TYPED ON THE LAPTOP");
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("TYPED ON THE LAPTOP");
  });

  /* ⛔ THE MIGRATION CLAUSE, AS A CASE RATHER THAN AS A COMMENT: a machine whose copy has NO
   * rename stamp may not win a title fight by default. This is the whole of "absent is oldest"
   * — if absent read as "just now", the stale side below would take the title back. */
  it("⛔ A MACHINE THAT HAS NEVER RENAMED ANYTHING CANNOT WIN BY DEFAULT", async () => {
    const { server, A, B } = await twoWindows();

    focus(A);
    A.store.writeTree(renameNode(readTree(A), "p_probe", "STAMPED", 9000));
    await A.store.refreshNotesSync();

    // B edits the note's TITLE the old way — a tree written before the stamps existed, so the
    // title differs with no `renamedAt` anywhere on it.
    focus(B);
    const stale = readTree(B);
    const hit = findPage(stale, "p_probe").page;
    hit.title = "UNSTAMPED — WRITTEN BY AN OLD BUILD";
    delete hit.renamedAt;
    hit.updatedAt = 9_999_999;                 // …and it even claims a newer EDIT
    B.store.writeTree(stale);
    await B.store.refreshNotesSync();

    expect(titleOf(readTree(B), "p_probe")).toBe("STAMPED");
    expect(titleOf(migrate(server.tree), "p_probe")).toBe("STAMPED");
  });

  /* ⛔ THE MUTATION CHECK he asked for: *"include a mutation check that the suite goes red on
   * the old behaviour."* A guard nobody has watched fail is a guard that rots green, and the
   * failure mode here is specifically SILENT — the reader dropping the field produced exactly
   * the old answers with nothing to show for it. So the old rule is re-implemented here, run
   * against the same input, and asserted to give the WRONG answer. If someone reverts the
   * stamps, the cases above start agreeing with this one and this case says so. */
  it("⛔ MUTATION: the OLD rule — local title always wins — fails these cases", () => {
    const stale = { id: "p", title: "THE OLD NAME", updatedAt: 9_999_999, projectId: null, pages: [] };
    const fresh = { id: "p", title: "THE NAME HE TYPED", updatedAt: 1, renamedAt: 9000, projectId: null, pages: [] };

    // TODAY: the stale side merges and adopts the newer rename.
    const now = mergeTrees({ v: 3, pages: [stale], trash: [] }, { v: 3, pages: [fresh], trash: [] });
    expect(now.pages[0].title).toBe("THE NAME HE TYPED");

    // THE OLD RULE, reconstructed: local wins unconditionally. Same input, wrong answer.
    const oldRule = (local) => local.pages[0].title;
    expect(oldRule({ pages: [stale] })).toBe("THE OLD NAME");
    expect(oldRule({ pages: [stale] })).not.toBe(now.pages[0].title);

    /* AND THE FIRST FIX'S RULE — judge by `updatedAt` — reconstructed the same way. It gets
     * this case wrong too, because the stale side had been TYPED IN more recently than the
     * side that was RENAMED, which is a different fact and used to be indistinguishable. */
    const byUpdatedAt = (l, s) => (s.pages[0].updatedAt > l.pages[0].updatedAt ? s : l).pages[0].title;
    expect(byUpdatedAt({ pages: [stale] }, { pages: [fresh] })).toBe("THE OLD NAME");
    expect(byUpdatedAt({ pages: [stale] }, { pages: [fresh] })).not.toBe(now.pages[0].title);
  });
});
