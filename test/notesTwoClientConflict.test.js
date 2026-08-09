/* TWO REAL CLIENTS, ONE ACCOUNT, ONE NOTE — DRIVEN THROUGH THE ACTUAL STORE (NEW-1).
 *
 * ⛔ WHY THIS EXISTS BESIDE test/notesProjectIntegrity.test.js. That suite proves the
 * DECISIONS (pure functions, no storage). This one proves the RESULTING STORE: two separate
 * instances of the real `notesStore` module, each with its own localStorage, talking to one
 * in-memory server that behaves like the deployed schema — including the part that produced
 * the defect's conditions, `notes_touch_rev` bumping `rev` on every write so a stale push is
 * REFUSED rather than silently winning.
 *
 * Nothing here is mocked except the network's far end. The revision guards, the ledger merge,
 * `judgeConflict`, the seed's adopt/upload plan, the park and the resolve are all the shipped
 * code, reached the way the workspace reaches them.
 *
 * ⛔ AND IT ASSERTS THE TWO THINGS A "a copy was made" CHECK CANNOT:
 *   (a) the EXACT number of pages that exist afterwards, on BOTH clients and on the server;
 *   (b) that EVERY page's projectId equals the projectId of the page it came from.
 * The broken build passes (a) on its own — it did make exactly one copy. It is (b) that
 * fails, and the mutation arm at the bottom runs the pre-fix copy against these same clients
 * to prove this suite goes red on it, with the exact fingerprint the owner found by hand.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { copyPageWithin, migrate, pageProjectIndex, allPageIds, addPage } from "../src/workspaces/notes/lib/notesModel.js";
import { findCrossProjectDuplicates } from "../src/workspaces/notes/lib/notesDuplicates.js";

const GRAND_PORT = "smqfy2r7pdec";
const COLORADO = "sms7v3ua7ksy";
const UID = "u1";

const doc = (...lines) => ({
  type: "doc",
  content: lines.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

/* The owner's own note, and his own divergence: the two copies differed by ONE WORD in about
 * forty — "Plat" against "RPlat". Kept at full length deliberately, because a short fixture
 * would make the near-duplicate question trivially easy and prove nothing about the real one. */
const COORD_LINES = [
  "Civil", "PLAT_WORD", "Resubmitted to Baytown 7/13", "CP Grant To Others",
  "Civil working to include irrigation line", "Sanitary Line Extension",
  "Can we get this reimbursed?", "Water / Sanitary Additional Reservation",
  "Working to schedule payment", "LONOs", "Last email to DOW was 7/13, they responded on 7/16",
  "Truck Turn Exhibit", "Quiddity looking into expanding areas, WB-67", "Permitting",
  "Baytown - LPA", "Anything needing my attention?", "Chambers County - Sitework",
];
const coordination = (platWord) => doc(...COORD_LINES.map((l) => (l === "PLAT_WORD" ? platWord : l)));

const COORD_V1 = coordination("Plat");
const COORD_A = coordination("RPlat");                            // the edit that landed first
const COORD_B = coordination("Replat");                           // the edit that lost the race

/* ---- the server ------------------------------------------------------------------------
 *
 * One row per table, `rev` owned by the server exactly as the real trigger owns it. A guarded
 * update whose `rev` filter does not match returns ZERO ROWS, which is what the client reads
 * as a conflict — the single behaviour this whole feature is built on top of. */
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
    // notes_pages
    if (op === "insert") {
      if (server.pages.has(payload.id)) return { rows: [], error: { code: "23505", message: "duplicate key" } };
      server.pages.set(payload.id, { doc: payload.doc, rev: 1, deleted_at: null, purged_at: null });
      return { rows: [{ id: payload.id, rev: 1 }], error: null };
    }
    const want = filters.id === undefined ? [...server.pages.keys()]
      : (Array.isArray(filters.id) ? filters.id : [filters.id]);
    const out = [];
    for (const id of want) {
      const row = server.pages.get(id);
      if (!row) continue;
      if (filters.rev !== undefined && filters.rev !== row.rev) continue;   // the guard refuses
      Object.assign(row, payload);
      row.rev += 1;                                                          // the trigger
      out.push({ id, rev: row.rev });
    }
    return { rows: out, error: null };
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

/* ---- a client window --------------------------------------------------------------------
 *
 * Its own localStorage (two windows of one browser share storage; two COMPUTERS do not, and
 * the cross-device case is the stricter one), its own module instance, one shared server. */
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
  // Node 22 exposes `navigator` as a getter-only global — read it, never assign it.

  vi.resetModules();
  vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: clientFor(server) }));
  const store = await import("../src/workspaces/notes/lib/notesStore.js");
  const scan = await import("../src/workspaces/notes/lib/notesScan.js");
  return { store: { ...store, ...scan }, mem, localStorage };
}

/** Point a freshly-opened window's globals back at its own storage — two windows exist at
 *  once in these tests, and only one `globalThis.window` does. */
const focus = (w) => { globalThis.window.localStorage = w.localStorage; };

const readTree = (w) => migrate(w.store.readTreeRaw());
const projectsOf = (tree) => Object.fromEntries(pageProjectIndex(tree));

/** The tree both windows start from: a Grand Port note and an unrelated Colorado pursuit. */
const seedTree = () => ({
  v: 3,
  pages: [
    { id: "gp_coord", title: "Coordination", createdAt: 1, updatedAt: 1, pages: [], projectId: GRAND_PORT },
    { id: "co_page1", title: "Page 1", createdAt: 1, updatedAt: 1, pages: [], projectId: COLORADO },
  ],
  trash: [],
});

afterEach(() => { vi.doUnmock("../src/workspaces/site-planner/lib/supabase.js"); });

describe("a real conflict between two clients", () => {
  it("⛔ ends with the EXACT page count on both clients, and every page in its source's project", async () => {
    const server = fakeServer();

    /* --- client A publishes the account -------------------------------------------- */
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    A.store.writeTree(seedTree());
    A.store.writePage("gp_coord", COORD_V1);
    A.store.writePage("co_page1", doc("Weld County — dead pursuit"));
    await A.store.startNotesSync({});
    await A.store.refreshNotesSync();
    expect(server.pages.size).toBe(2);
    expect(server.tree).toBeTruthy();

    /* --- client B picks it up ------------------------------------------------------- */
    const B = await openWindow(server);
    focus(B);
    B.store.setNotesScope(UID);
    await B.store.startNotesSync({});
    expect(allPageIds(readTree(B))).toEqual(["gp_coord", "co_page1"]);
    expect(B.store.readPage("gp_coord")).toEqual(COORD_V1);

    /* --- both edit the same note; A lands first ------------------------------------- */
    focus(B);
    B.store.writePage("gp_coord", COORD_B);          // B's unpushed edit

    focus(A);
    A.store.writePage("gp_coord", COORD_A);
    await A.store.refreshNotesSync();                 // A wins the race
    expect(server.pages.get("gp_coord").doc).toEqual(COORD_A);

    /* --- B's push is REFUSED and becomes a named conflict ---------------------------- */
    focus(B);
    await B.store.refreshNotesSync();
    expect(B.store.notesConflicts()).toEqual(["gp_coord"]);

    /* --- B chooses "Use the other". THE WORKSPACE'S PARK, VERBATIM ------------------- */
    const beforeTree = readTree(B);
    const beforeCount = allPageIds(beforeTree).length;
    const beforeProjects = projectsOf(beforeTree);
    const localDoc = B.store.readPage("gp_coord");

    // B is STANDING IN the Colorado pursuit — the condition the defect needed. The park
    // cannot be told about it: `copyPageWithin` takes a source page id and nothing else.
    const parked = copyPageWithin(beforeTree, "gp_coord", { title: "Coordination (this window’s copy)" });
    expect(parked.refused).toBeNull();
    expect(B.store.writePage(parked.pageId, localDoc)).toBe(true);
    B.store.writeTree(parked.tree);
    const res = await B.store.resolveNotesConflict("gp_coord", "theirs");
    expect(res.ok).toBe(true);
    await B.store.refreshNotesSync();

    /* --- (a) THE EXACT NUMBER OF PAGES ---------------------------------------------- */
    const afterB = readTree(B);
    expect(allPageIds(afterB)).toHaveLength(beforeCount + 1);
    expect(server.pages.size).toBe(beforeCount + 1);

    /* --- (b) EVERY PAGE'S PROJECT EQUALS ITS SOURCE'S -------------------------------- */
    const afterProjects = projectsOf(afterB);
    for (const [id, pid] of Object.entries(beforeProjects)) expect(afterProjects[id]).toBe(pid);
    expect(afterProjects[parked.pageId]).toBe(GRAND_PORT);      // the copy stayed home
    expect(afterProjects[parked.pageId]).not.toBe(COLORADO);
    expect(Object.values(afterProjects).filter((p) => p === COLORADO)).toHaveLength(1);

    /* --- and B kept BOTH texts: nothing was overwritten to get here ------------------ */
    expect(B.store.readPage("gp_coord")).toEqual(COORD_A);      // the copy that was chosen
    expect(B.store.readPage(parked.pageId)).toEqual(COORD_B);   // the one that was not
    expect(B.store.notesConflicts()).toEqual([]);

    /* --- client A converges on the same store, page for page ------------------------- */
    focus(A);
    await A.store.refreshNotesSync();
    const afterA = readTree(A);
    expect(allPageIds(afterA).sort()).toEqual(allPageIds(afterB).sort());
    expect(projectsOf(afterA)).toEqual(afterProjects);
    expect(A.store.readPage(parked.pageId)).toEqual(COORD_B);

    /* --- and the detector is SILENT: the two copies share a project ------------------ */
    focus(B);
    expect(B.store.scanNoteDuplicates(afterB)).toEqual([]);
  });

  it("MUTATION — the pre-fix park files the copy where the viewer is standing, and this suite goes RED", async () => {
    const server = fakeServer();
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    A.store.writeTree(seedTree());
    A.store.writePage("gp_coord", COORD_V1);
    A.store.writePage("co_page1", doc("Weld County — dead pursuit"));
    await A.store.startNotesSync({});
    await A.store.refreshNotesSync();

    const B = await openWindow(server);
    focus(B);
    B.store.setNotesScope(UID);
    await B.store.startNotesSync({});
    B.store.writePage("gp_coord", COORD_B);
    focus(A);
    A.store.writePage("gp_coord", COORD_A);
    await A.store.refreshNotesSync();
    focus(B);
    await B.store.refreshNotesSync();
    expect(B.store.notesConflicts()).toEqual(["gp_coord"]);

    /* THE REVERT: the copy filed into the project the viewer happens to be showing. */
    const viewersProjectId = COLORADO;
    const beforeTree = readTree(B);
    const beforeCount = allPageIds(beforeTree).length;
    const broken = addPage(beforeTree, { projectId: viewersProjectId, title: "Coordination (this window’s copy)" });
    B.store.writePage(broken.pageId, B.store.readPage("gp_coord"));
    B.store.writeTree(broken.tree);
    await B.store.resolveNotesConflict("gp_coord", "theirs");
    await B.store.refreshNotesSync();

    const after = readTree(B);
    // (a) STILL PASSES — the broken build does make exactly one copy. This is why a count
    // on its own is not a check.
    expect(allPageIds(after)).toHaveLength(beforeCount + 1);
    // (b) FAILS — and this is the fingerprint the owner found by hand a week later.
    const projects = projectsOf(after);
    expect(projects[broken.pageId]).toBe(COLORADO);
    expect(projects[broken.pageId]).not.toBe(projects.gp_coord);

    // …and the shipped detector, run over the REAL resulting store, goes loud on it.
    const found = B.store.scanNoteDuplicates(after);
    expect(found).toHaveLength(1);
    expect(found[0].projectIds.sort()).toEqual([COLORADO, GRAND_PORT].sort());
    expect(found[0].pages.map((p) => p.pageId).sort()).toEqual(["gp_coord", broken.pageId].sort());
  });

  it("a note whose tree node is lost is SURFACED, not swept away every time the tab opens", async () => {
    const server = fakeServer();
    const A = await openWindow(server);
    focus(A);
    A.store.setNotesScope(UID);
    A.store.writeTree(seedTree());
    A.store.writePage("gp_coord", COORD_V1);
    A.store.writePage("co_page1", doc("Weld County — dead pursuit"));
    await A.store.startNotesSync({});

    // The tree loses a node (a merge that dropped it, a clobbered blob) while the BODY row
    // survives in the cloud. Found in the owner's own account, holding real notes.
    const orphaned = { ...seedTree(), pages: seedTree().pages.filter((p) => p.id !== "gp_coord") };
    A.store.writeTree(orphaned);

    const swept = A.store.sweepOrphans(["co_page1"]);
    expect(swept.removed).toEqual([]);                       // ⛔ it refused to destroy words
    expect(swept.kept).toEqual(["gp_coord"]);
    expect(A.store.readPage("gp_coord")).toEqual(COORD_V1);  // still there to be recovered

    const lost = A.store.unreachableNotes(orphaned);
    expect(lost).toHaveLength(1);
    expect(lost[0].pageId).toBe("gp_coord");
    expect(lost[0].preview).toContain("Civil");

    // An EMPTY stray is still swept — an interrupted delete leaves no words behind.
    A.store.writePage("junk", { type: "doc", content: [] });
    expect(A.store.sweepOrphans(["co_page1", "gp_coord"]).removed).toEqual(["junk"]);
  });
});

/* One belt-and-braces read of the whole thing from outside: the fingerprint this feature
 * exists to make impossible, stated once as a property rather than as a sequence of steps. */
describe("the property, stated plainly", () => {
  it("no two pages may share their text while differing in project — after any copy", () => {
    const tree = seedTree();
    const copied = copyPageWithin(tree, "gp_coord", { title: "Coordination (copy)" });
    const rows = [
      { pageId: "gp_coord", title: "Coordination", projectId: GRAND_PORT, text: "Civil Plat Resubmitted to Baytown CP Grant To Others LONOs", where: "live" },
      { pageId: copied.pageId, title: "Coordination (copy)", projectId: projectsOf(copied.tree)[copied.pageId], text: "Civil Plat Resubmitted to Baytown CP Grant To Others LONOs", where: "live" },
    ];
    expect(findCrossProjectDuplicates(rows)).toEqual([]);
  });
});
