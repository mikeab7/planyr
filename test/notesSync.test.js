/* notesSync — the decisions cloud sync makes, proven without a network (B1291).
 *
 * Every rule that decides WHICH COPY OF A NOTE WINS lives in pure functions in
 * src/workspaces/notes/lib/notesCloud.js precisely so it can be tested here rather than
 * only in a signed-in browser. The transport half is exercised against a FAKE Supabase
 * client, which is what lets these assert the two things a mock of the ENGINE could never
 * catch: that a push carries the revision GUARD, and that it never sends a `rev` of its own
 * (the server trigger owns that column — a client-sent rev would be silently ignored, and
 * the guard would be the only thing standing between two devices and a lost note).
 */
import { describe, it, expect } from "vitest";
import {
  IMAGE_MIME_ALLOWED, PAGE_TABLE, TREE_TABLE, dataUrlToBlob, emptySyncState, fetchPageIndex,
  isEmptyDoc, judgeConflict, mergeSyncState, mergeTrees, planAdoption, planImageSync,
  planPageSeed, pushPage, pushTree, sameDoc, syncFailureReason,
} from "../src/workspaces/notes/lib/notesCloud.js";
import { notesConflictLine } from "../src/workspaces/notes/lib/notesStore.js";

/* ---- fixtures ------------------------------------------------------------------------ */

const page = (id, title = id, t = {}) => ({ id, title, createdAt: t.createdAt ?? 1000, updatedAt: t.updatedAt ?? 1000 });
const section = (id, pages) => ({ id, title: id, pages });
const notebook = (id, sections) => ({ id, title: id, projectId: null, sections });
const tree = (notebooks, trash = []) => ({ v: 2, notebooks, trash });
const trashEntry = (id, node, kind = "page", pageIds = [node.id]) => ({ id, kind, node, parentId: null, index: 0, title: node.title, deletedAt: 5000, pageIds });

const state = (over = {}) => ({ ...emptySyncState(), ...over });

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. THE TREE MERGE — reached only when BOTH devices changed the structure
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("mergeTrees", () => {
  it("keeps a notebook that exists on only ONE side — a merge can never lose a notebook", () => {
    const mine = tree([notebook("nbA", [section("s1", [page("p1")])])]);
    const theirs = tree([notebook("nbB", [section("s2", [page("p2")])])]);
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks.map((n) => n.id)).toEqual(["nbA", "nbB"]);
  });

  it("keeps a PAGE added on the other device inside a section they both have", () => {
    const mine = tree([notebook("nb", [section("s", [page("p1")])])]);
    const theirs = tree([notebook("nb", [section("s", [page("p1"), page("p2")])])]);
    expect(mergeTrees(mine, theirs).notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("keeps a SECTION added on the other device", () => {
    const mine = tree([notebook("nb", [section("s1", [page("p1")])])]);
    const theirs = tree([notebook("nb", [section("s1", [page("p1")]), section("s2", [page("p2")])])]);
    expect(mergeTrees(mine, theirs).notebooks[0].sections.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("the LOCAL title wins for a node both sides have — local is the side with unpushed changes", () => {
    const mine = tree([notebook("nb", [section("s", [{ ...page("p1"), title: "My rename" }])])]);
    const theirs = tree([notebook("nb", [section("s", [{ ...page("p1"), title: "Their rename" }])])]);
    expect(mergeTrees(mine, theirs).notebooks[0].sections[0].pages[0].title).toBe("My rename");
  });

  it("timestamps take the LATER edit and the EARLIER creation, whichever side each came from", () => {
    const mine = tree([notebook("nb", [section("s", [page("p1", "p1", { createdAt: 900, updatedAt: 2000 })])])]);
    const theirs = tree([notebook("nb", [section("s", [page("p1", "p1", { createdAt: 500, updatedAt: 7000 })])])]);
    const pg = mergeTrees(mine, theirs).notebooks[0].sections[0].pages[0];
    expect(pg.updatedAt).toBe(7000);
    expect(pg.createdAt).toBe(500);
  });

  it("A DELETE ON EITHER SIDE WINS — a page they binned does not come back because we still have it", () => {
    const p = page("p2");
    const mine = tree([notebook("nb", [section("s", [page("p1"), p])])]);
    const theirs = tree([notebook("nb", [section("s", [page("p1")])])], [trashEntry("t1", p)]);
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks[0].sections[0].pages.map((x) => x.id)).toEqual(["p1"]);
    expect(out.trash.map((e) => e.id)).toEqual(["t1"]);
  });

  it("…and it works the other way round too — a page WE binned is not resurrected by their live copy", () => {
    const p = page("p2");
    const mine = tree([notebook("nb", [section("s", [page("p1")])])], [trashEntry("t1", p)]);
    const theirs = tree([notebook("nb", [section("s", [page("p1"), p])])]);
    expect(mergeTrees(mine, theirs).notebooks[0].sections[0].pages.map((x) => x.id)).toEqual(["p1"]);
  });

  it("a binned NOTEBOOK takes its whole cascade with it, from either side's bin", () => {
    const nb = notebook("nbGone", [section("sG", [page("pG1"), page("pG2")])]);
    const mine = tree([notebook("nbKeep", [section("s", [page("p1")])]), nb]);
    const theirs = tree([notebook("nbKeep", [section("s", [page("p1")])])], [trashEntry("t9", nb, "notebook", ["pG1", "pG2"])]);
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks.map((n) => n.id)).toEqual(["nbKeep"]);
  });

  it("the merged bin is the UNION, and an entry is never duplicated", () => {
    const p = page("p9");
    const shared = trashEntry("tShared", p);
    const mine = tree([], [shared, trashEntry("tMine", page("pm"))]);
    const theirs = tree([], [shared, trashEntry("tTheirs", page("pt"))]);
    expect(mergeTrees(mine, theirs).trash.map((e) => e.id)).toEqual(["tShared", "tMine", "tTheirs"]);
  });

  it("a page MOVED on both devices keeps the LOCAL placement and appears exactly once", () => {
    const mine = tree([notebook("nb", [section("s1", [page("p1")]), section("s2", [])])]);
    const theirs = tree([notebook("nb", [section("s1", []), section("s2", [page("p1")])])]);
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1"]);
    expect(out.notebooks[0].sections[1].pages).toEqual([]);
  });

  it("survives junk on either side rather than throwing — a merge is not a place to crash", () => {
    expect(mergeTrees(null, null)).toEqual({ v: 2, notebooks: [], trash: [] });
    expect(mergeTrees(tree([notebook("nb", [section("s", [page("p1")])])]), undefined).notebooks).toHaveLength(1);
  });

  /* B1374 — THE PROJECT BINDING RIDES THROUGH THE MERGE. Asserted, not assumed: the binding
   * lives in the tree blob, and the tree blob is the thing this function rewrites. A merge
   * that dropped `projectId` would silently un-file every notebook the moment two devices
   * both touched the structure — which is a data loss that looks exactly like the bug this
   * whole item is about, arriving later and from a different direction. */
  const bound = (id, pid, sections) => ({ id, title: id, projectId: pid, sections });

  it("A NOTEBOOK'S PROJECT BINDING SURVIVES THE MERGE, on both sides", () => {
    const mine = tree([bound("nbA", "P1", [section("s1", [page("p1")])])]);
    const theirs = tree([bound("nbB", "P2", [section("s2", [page("p2")])])]);
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks.map((n) => [n.id, n.projectId])).toEqual([["nbA", "P1"], ["nbB", "P2"]]);
  });

  it("...and a LOOSE notebook stays loose rather than acquiring one", () => {
    const out = mergeTrees(
      tree([bound("nb", null, [section("s", [page("p1")])])]),
      tree([bound("nb", null, [section("s", [page("p2")])])]),
    );
    expect(out.notebooks[0].projectId).toBeNull();
  });

  it("for a notebook on BOTH sides the LOCAL binding wins, the same as its title (rule 3)", () => {
    const mine = tree([bound("nb", "P-local", [section("s", [page("p1")])])]);
    const theirs = tree([bound("nb", "P-server", [section("s", [page("p1")])])]);
    expect(mergeTrees(mine, theirs).notebooks[0].projectId).toBe("P-local");
  });

  it("re-binding on THIS device and adding a page on the other keeps BOTH — the bind is not paid for with a note", () => {
    const mine = tree([bound("nb", null, [section("s", [page("p1")])])]);           // set loose here
    const theirs = tree([bound("nb", "P1", [section("s", [page("p1"), page("p2")])])]); // page added there
    const out = mergeTrees(mine, theirs);
    expect(out.notebooks[0].projectId).toBeNull();
    expect(out.notebooks[0].sections[0].pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. ROWS-CANONICAL-ON-SEED — which copy of a page BODY wins
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("planPageSeed — which copy wins", () => {
  it("a page the SERVER HAS SEEN and this device has not: the ROW wins (adopt)", () => {
    const plan = planPageSeed({ index: [{ id: "p1", rev: 4 }], state: state(), localIds: [] });
    expect(plan.adopt).toEqual(["p1"]);
    expect(plan.upload).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("a page whose server rev MOVED and has no pending local edit: the ROW wins, no conflict", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 9 }],
      state: state({ pages: { p1: { rev: 4, dirty: false, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan.adopt).toEqual(["p1"]);
  });

  it("a page in step with the server and untouched is left completely alone", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 4 }],
      state: state({ pages: { p1: { rev: 4, dirty: false, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan).toEqual({ adopt: [], conflicts: [], upload: [], purged: [] });
  });

  it("a page the SERVER HAS NEVER SEEN: LOCAL wins and is uploaded with no base revision", () => {
    const plan = planPageSeed({ index: [], state: state(), localIds: ["fresh"] });
    expect(plan.upload).toEqual([{ id: "fresh", base: null }]);
  });

  it("a pending local edit against an UNMOVED server rev is simply pushed", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 4 }],
      state: state({ pages: { p1: { rev: 4, dirty: true, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan.upload).toEqual([{ id: "p1", base: 4 }]);
    expect(plan.conflicts).toEqual([]);
  });

  it("BOTH MOVED: neither wins silently — the page is a named CONFLICT", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 9 }],
      state: state({ pages: { p1: { rev: 4, dirty: true, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan.conflicts).toEqual(["p1"]);
    expect(plan.adopt).toEqual([]);
    expect(plan.upload).toEqual([]);
  });

  it("A BINNED PAGE NEVER RAISES A FALSE CONFLICT — binning bumps the rev, and a delete is not an edit", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 9, binned: true }],
      state: state({ pages: { p1: { rev: 4, dirty: true, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan.conflicts).toEqual([]);
    expect(plan.upload).toEqual([{ id: "p1", base: 9 }]);   // rebased onto the bin stamp
  });

  it("a PURGED page is cleared here and is never a conflict", () => {
    const plan = planPageSeed({
      index: [{ id: "p1", rev: 9, purged: true }],
      state: state({ pages: { p1: { rev: 4, dirty: true, purged: false } } }),
      localIds: ["p1"],
    });
    expect(plan.purged).toEqual(["p1"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.upload).toEqual([]);
  });

  it("A PURGED PAGE IS NEVER RESURRECTED — a local body left behind is not re-uploaded", () => {
    const plan = planPageSeed({
      index: [],
      state: state({ pages: { gone: { rev: 7, dirty: true, purged: true } } }),
      localIds: ["gone"],
    });
    expect(plan.upload).toEqual([]);
  });

  it("a purge already applied on this device is not re-applied every seed", () => {
    const plan = planPageSeed({
      index: [{ id: "gone", rev: 8, purged: true }],
      state: state({ pages: { gone: { rev: 8, dirty: false, purged: true } } }),
      localIds: [],
    });
    expect(plan.purged).toEqual([]);
  });

  it("the four sets are disjoint across a mixed account", () => {
    const plan = planPageSeed({
      index: [
        { id: "adoptMe", rev: 3 },
        { id: "conflicted", rev: 9 },
        { id: "inStep", rev: 2 },
        { id: "purgedOne", rev: 5, purged: true },
      ],
      state: state({ pages: {
        conflicted: { rev: 4, dirty: true, purged: false },
        inStep: { rev: 2, dirty: false, purged: false },
      } }),
      localIds: ["conflicted", "inStep", "purgedOne", "brandNew"],
    });
    expect(plan.adopt).toEqual(["adoptMe"]);
    expect(plan.conflicts).toEqual(["conflicted"]);
    expect(plan.purged).toEqual(["purgedOne"]);
    expect(plan.upload).toEqual([{ id: "brandNew", base: null }]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. PICTURES — eager up, lazy down
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("planImageSync", () => {
  it("a picture the server has never seen is UPLOADED — otherwise the note opens broken elsewhere", () => {
    const plan = planImageSync({ index: [], localMeta: [{ id: "img1", pageId: "p1" }], state: state() });
    expect(plan.upload).toEqual(["img1"]);
  });

  it("a picture the server already has is left alone", () => {
    const plan = planImageSync({ index: [{ id: "img1", pageId: "p1" }], localMeta: [{ id: "img1", pageId: "p1" }], state: state() });
    expect(plan.upload).toEqual([]);
    expect(plan.dropLocal).toEqual([]);
  });

  it("a picture purged elsewhere is dropped from this device's cache, not re-uploaded", () => {
    const plan = planImageSync({
      index: [{ id: "img1", pageId: "p1", deleted: true }],
      localMeta: [{ id: "img1", pageId: "p1" }],
      state: state(),
    });
    expect(plan.dropLocal).toEqual(["img1"]);
    expect(plan.upload).toEqual([]);
  });

  it("a picture this device purged is never pushed back up", () => {
    const plan = planImageSync({
      index: [],
      localMeta: [{ id: "img1", pageId: "p1" }],
      state: state({ images: { img1: { up: false, purged: true } } }),
    });
    expect(plan.upload).toEqual([]);
  });

  it("DOWNLOADS ARE NOT PLANNED HERE — pictures arrive with the page that needs them", () => {
    const plan = planImageSync({ index: [{ id: "onlyInCloud", pageId: "p1" }], localMeta: [], state: state() });
    expect(Object.keys(plan).sort()).toEqual(["dropLocal", "upload"]);
    expect(plan.upload).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. THE SIGN-IN MIGRATION
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("planAdoption — signed-out notes join the account", () => {
  const local = tree([notebook("nbLocal", [section("s", [page("p1"), page("p2")])])]);

  it("adopts a signed-out notebook the account has never seen, with every page under it", () => {
    const plan = planAdoption(local, tree([]));
    expect(plan.notebooks.map((n) => n.id)).toEqual(["nbLocal"]);
    expect(plan.pageIds).toEqual(["p1", "p2"]);
  });

  it("IS IDEMPOTENT — a second run adopts nothing, so notes are never silently duplicated", () => {
    const account = tree([notebook("nbLocal", [section("s", [page("p1"), page("p2")])])]);
    expect(planAdoption(local, account)).toEqual({ notebooks: [], pageIds: [] });
  });

  it("leaves the account's own notebooks alone and never proposes deleting anything", () => {
    const account = tree([notebook("nbAccount", [section("sa", [page("pa")])])]);
    const plan = planAdoption(local, account);
    expect(plan.notebooks.map((n) => n.id)).toEqual(["nbLocal"]);
  });

  /* ⛔ TOMBSTONE-DELETES. Adoption is also a delete path, and "missing from the account
   * tree" is not the same as "never adopted" — these two cases are how a deleted note would
   * otherwise be resurrected by the migration that was supposed to be idempotent. */
  it("does NOT re-adopt a notebook this device already adopted and the user has since deleted", () => {
    const account = tree([]);   // adopted once, then deleted and purged out of the account
    expect(planAdoption(local, account, { already: ["nbLocal"] })).toEqual({ notebooks: [], pageIds: [] });
  });

  it("does NOT re-adopt a notebook sitting in the account's BIN — a binned note is not a missing one", () => {
    const nb = notebook("nbLocal", [section("s", [page("p1"), page("p2")])]);
    const account = tree([], [trashEntry("t1", nb, "notebook", ["p1", "p2"])]);
    expect(planAdoption(local, account).notebooks).toEqual([]);
  });

  it("a genuinely new signed-out notebook still comes across even with a history of adoptions", () => {
    const both = tree([notebook("nbLocal", [section("s", [page("p1")])]), notebook("nbNew", [section("s2", [page("p3")])])]);
    const plan = planAdoption(both, tree([]), { already: ["nbLocal"] });
    expect(plan.notebooks.map((n) => n.id)).toEqual(["nbNew"]);
    expect(plan.pageIds).toEqual(["p3"]);
  });

  it("nothing signed out means nothing to do", () => {
    expect(planAdoption(tree([]), tree([notebook("nb", [])]))).toEqual({ notebooks: [], pageIds: [] });
    expect(planAdoption(null, null)).toEqual({ notebooks: [], pageIds: [] });
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE WIRE — the revision guard, proven through the real transport
 *
 * These drive the SHIPPED functions against a fake client and assert what actually goes out.
 * The B1120 lesson: test the REQUEST, never a mock that is more forgiving than the server.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
function fakeClient({ updateRows = [{ rev: 5 }], insertRow = { rev: 1 }, error = null } = {}) {
  const calls = [];
  const builder = (table, op, payload) => {
    const rec = { table, op, payload, filters: {} };
    calls.push(rec);
    const self = {
      eq(col, val) { rec.filters[col] = val; return self; },
      in(col, vals) { rec.filters[col] = vals; return self; },
      select() { return self; },
      maybeSingle() { return Promise.resolve({ data: error ? null : insertRow, error }); },
      then(res, rej) { return Promise.resolve({ data: error ? null : updateRows, error }).then(res, rej); },
    };
    return self;
  };
  return {
    calls,
    from(table) {
      return {
        select: (cols) => builder(table, "select", cols),
        insert: (payload) => builder(table, "insert", payload),
        update: (payload) => builder(table, "update", payload),
        upsert: (payload) => builder(table, "upsert", payload),
      };
    },
  };
}

describe("the revision guard on the wire", () => {
  it("a page push GUARDS on the revision it read, and sends NO rev of its own", async () => {
    const c = fakeClient();
    const r = await pushPage(c, "p1", { type: "doc" }, 4);
    const call = c.calls.find((x) => x.op === "update");
    expect(call.table).toBe(PAGE_TABLE);
    expect(call.filters).toEqual({ id: "p1", rev: 4 });
    expect(Object.keys(call.payload)).toEqual(["doc"]);   // the server trigger owns `rev`
    expect(r).toEqual({ ok: true, rev: 5 });
  });

  it("ZERO ROWS BACK IS A CONFLICT, never a retry that clobbers", async () => {
    const c = fakeClient({ updateRows: [] });
    expect(await pushPage(c, "p1", { type: "doc" }, 4)).toEqual({ ok: false, conflict: true });
  });

  it("a page the server has never seen is INSERTED, still with no client-chosen rev", async () => {
    const c = fakeClient({ insertRow: { rev: 1 } });
    const r = await pushPage(c, "new", { type: "doc" }, null);
    const call = c.calls.find((x) => x.op === "insert");
    expect(Object.keys(call.payload).sort()).toEqual(["doc", "id"]);
    expect(r).toEqual({ ok: true, rev: 1 });
  });

  it("a duplicate-key insert is reported as a CONFLICT, not as a write failure", async () => {
    const c = fakeClient({ error: { code: "23505", message: "duplicate key value" } });
    expect(await pushPage(c, "new", { type: "doc" }, null)).toEqual({ ok: false, conflict: true });
  });

  it("a genuine error is reported as an error, so the footer can name it", async () => {
    const c = fakeClient({ error: { code: "PGRST301", message: "JWT expired" } });
    expect(await pushPage(c, "new", { type: "doc" }, null)).toEqual({ ok: false, error: "JWT expired" });
  });

  it("the TREE push is guarded the same way, and writes the `data` column", async () => {
    const c = fakeClient({ updateRows: [{ rev: 12 }] });
    const r = await pushTree(c, { v: 2, notebooks: [] }, 11);
    const call = c.calls.find((x) => x.op === "update");
    expect(call.table).toBe(TREE_TABLE);
    expect(call.filters).toEqual({ rev: 11 });
    expect(Object.keys(call.payload)).toEqual(["data"]);
    expect(r).toEqual({ ok: true, rev: 12 });
  });

  it("the page INDEX asks for revisions and delete state, never for documents", async () => {
    const c = fakeClient({ updateRows: [{ id: "p1", rev: 3, deleted_at: null, purged_at: "2026-07-31" }] });
    const r = await fetchPageIndex(c);
    expect(c.calls[0].payload).toBe("id,rev,deleted_at,purged_at");
    expect(c.calls[0].payload).not.toContain("doc");
    expect(r.index).toEqual([{ id: "p1", rev: 3, binned: false, purged: true }]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 6. LOUD-FAILURE — a failure has to be sayable
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("syncFailureReason", () => {
  it("names the cases a user can actually act on", () => {
    expect(syncFailureReason("TypeError: Failed to fetch")).toBe("no connection");
    expect(syncFailureReason("JWT expired")).toBe("your sign-in expired — sign in again");
    expect(syncFailureReason('new row violates row-level security policy')).toBe("the server refused the write");
    expect(syncFailureReason("Payload too large")).toBe("a note or picture is too large");
  });

  it("never returns an empty string — an unnamed failure is the thing this prevents", () => {
    for (const input of ["", null, undefined, "something nobody predicted"]) {
      expect(syncFailureReason(input).length).toBeGreaterThan(0);
    }
  });
});

describe("the picture codec", () => {
  it("decodes a base64 data URL to bytes of the declared type", () => {
    const blob = dataUrlToBlob("data:image/png;base64,aGVsbG8=");
    expect(blob).toBeTruthy();
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(5);
  });

  it("refuses junk rather than uploading nothing under a real id", () => {
    expect(dataUrlToBlob("not a data url")).toBe(null);
    expect(dataUrlToBlob("")).toBe(null);
  });

  it("the mime allow-list matches the bucket's, so a refusal is named here not at the server", () => {
    expect(IMAGE_MIME_ALLOWED).toEqual(["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 8. A NO-OP CONFLICT MUST NEVER PROMPT (B1391)
 *
 * The false alarm the owner hit: one person, one account, two windows. A revision guard can
 * only answer "did the row move?", and the honest answer to that is not "do the two copies
 * disagree?". These are the rules that stand between a lost race and an interruption.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("sameDoc — the bytes may differ; the note may not", () => {
  const doc = (...content) => ({ type: "doc", content });
  const para = (text, marks) => ({ type: "paragraph", content: text ? [{ type: "text", text, ...(marks ? { marks } : {}) }] : [] });

  it("two documents that say the same thing are the same document", () => {
    expect(sameDoc(doc(para("The bayou runs north.")), doc(para("The bayou runs north.")))).toBe(true);
  });

  it("KEY ORDER is not an edit — a round trip through the server's jsonb may reorder it", () => {
    const a = { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text: "hi" }] }] };
    const b = { content: [{ content: [{ text: "hi", type: "text" }], attrs: { textAlign: "left" }, type: "paragraph" }], type: "doc" };
    expect(sameDoc(a, b)).toBe(true);
  });

  it("an attribute written as NULL and one left out are the same note", () => {
    const a = doc({ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text: "hi" }] });
    const b = doc({ type: "paragraph", content: [{ type: "text", text: "hi" }] });
    expect(sameDoc(a, b)).toBe(true);
  });

  it("an EMPTY marks list and no marks list are the same note", () => {
    const a = doc({ type: "paragraph", content: [{ type: "text", text: "hi", marks: [] }] });
    expect(sameDoc(a, doc(para("hi")))).toBe(true);
  });

  it("marks are a SET — bold+italic is the same text as italic+bold", () => {
    const a = doc(para("hi", [{ type: "bold" }, { type: "italic" }]));
    const b = doc(para("hi", [{ type: "italic" }, { type: "bold" }]));
    expect(sameDoc(a, b)).toBe(true);
  });

  it("...but CONTENT is a SEQUENCE — two paragraphs in the other order is a different note", () => {
    expect(sameDoc(doc(para("one"), para("two")), doc(para("two"), para("one")))).toBe(false);
  });

  it("a real edit is still a real edit", () => {
    expect(sameDoc(doc(para("The bayou runs north.")), doc(para("The bayou runs south.")))).toBe(false);
    expect(sameDoc(doc(para("hi")), doc(para("hi", [{ type: "bold" }])))).toBe(false);
  });

  it("nothing and nothing agree; nothing and something do not", () => {
    expect(sameDoc(null, null)).toBe(true);
    expect(sameDoc(null, doc(para("hi")))).toBe(false);
  });
});

describe("isEmptyDoc", () => {
  it("a page that was never typed into is empty", () => {
    expect(isEmptyDoc(null)).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph" }] })).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] })).toBe(true);
  });

  it("a picture or a table is NOT nothing, even with no words in it", () => {
    expect(isEmptyDoc({ type: "doc", content: [{ type: "noteImage", attrs: { imageId: "i1" } }] })).toBe(false);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "table", content: [] }] })).toBe(false);
  });

  it("one word is not empty", () => {
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] })).toBe(false);
  });
});

describe("judgeConflict — only a REAL divergence may interrupt", () => {
  const withText = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
  const blank = { type: "doc", content: [{ type: "paragraph" }] };

  it("IDENTICAL COPIES RECONCILE IN SILENCE — the owner's false alarm, in one line", () => {
    const v = judgeConflict({ localDoc: withText("same words"), serverDoc: withText("same words") });
    expect(v.silent).toBe(true);
    expect(v.why).toBe("identical");
  });

  it("a lost race with NOTHING HERE TO LOSE takes the row (ROWS-CANONICAL-ON-SEED)", () => {
    expect(judgeConflict({ localDoc: null, serverDoc: withText("their words") })).toEqual({ silent: true, why: "nothing-local" });
    expect(judgeConflict({ localDoc: blank, serverDoc: withText("their words") })).toEqual({ silent: true, why: "nothing-local" });
  });

  it("⛔ THE SILENT PATH MAY ONLY EVER ADD TEXT BACK — text here against a blank there is a REAL conflict", () => {
    const v = judgeConflict({ localDoc: withText("my paragraph"), serverDoc: blank });
    expect(v.silent).toBe(false);
  });

  it("two different documents still stop and ask — the guarantee this whole path exists for", () => {
    const v = judgeConflict({ localDoc: withText("my words"), serverDoc: withText("their words") });
    expect(v).toEqual({ silent: false, why: "diverged" });
  });
});

describe("mergeSyncState — two windows of one browser converge instead of overwriting", () => {
  const ledger = (over = {}) => ({ ...emptySyncState(), adopted: [], ...over });

  it("a revision the SIBLING window pushed is picked up, not flattened", () => {
    const mine = ledger({ pages: { p1: { rev: 4, dirty: false, purged: false } } });
    const disk = ledger({ pages: { p1: { rev: 7, dirty: false, purged: false } } });
    expect(mergeSyncState(mine, disk).pages.p1.rev).toBe(7);
  });

  it("⛔ A DIRTY PAGE KEEPS ITS OWN BASE — adopting a fresher rev would let a STALE body commit cleanly", () => {
    const mine = ledger({ pages: { p1: { rev: 4, dirty: true, purged: false } } });
    const disk = ledger({ pages: { p1: { rev: 7, dirty: false, purged: false } } });
    const out = mergeSyncState(mine, disk).pages.p1;
    expect(out.rev).toBe(4);      // the guard must still refuse; judgeConflict then decides
    expect(out.dirty).toBe(true);
  });

  it("an unpushed edit in EITHER window is still owed to the cloud", () => {
    expect(mergeSyncState(ledger({ treeDirty: true }), ledger()).treeDirty).toBe(true);
    expect(mergeSyncState(ledger(), ledger({ treeDirty: true })).treeDirty).toBe(true);
    expect(mergeSyncState(
      ledger({ pages: { p1: { rev: 2, dirty: false, purged: false } } }),
      ledger({ pages: { p1: { rev: 2, dirty: true, purged: false } } }),
    ).pages.p1.dirty).toBe(true);
  });

  it("a TOMBSTONE from either window stands (TOMBSTONE-DELETES)", () => {
    const out = mergeSyncState(
      ledger({ pages: { p1: { rev: 3, dirty: false, purged: false } } }),
      ledger({ pages: { p1: { rev: 3, dirty: false, purged: true } }, images: { i1: { up: true, purged: true } } }),
    );
    expect(out.pages.p1.purged).toBe(true);
    expect(out.images.i1.purged).toBe(true);
  });

  it("a page only ONE window knows about survives the merge", () => {
    const out = mergeSyncState(
      ledger({ pages: { p1: { rev: 1, dirty: false, purged: false } } }),
      ledger({ pages: { p2: { rev: 9, dirty: false, purged: false } } }),
    );
    expect(Object.keys(out.pages).sort()).toEqual(["p1", "p2"]);
  });

  it("the ADOPTED-ONCE list is a union — a notebook adopted in one window is not re-copied in the other", () => {
    expect(mergeSyncState(ledger({ adopted: ["nbA"] }), ledger({ adopted: ["nbB"] })).adopted.sort()).toEqual(["nbA", "nbB"]);
  });

  it("merging an EMPTY ledger with a real one loses nothing", () => {
    const disk = ledger({ treeRev: 12, pages: { p1: { rev: 3, dirty: false, purged: false } } });
    expect(mergeSyncState(null, disk).treeRev).toBe(12);
    expect(mergeSyncState(null, disk).pages.p1.rev).toBe(3);
  });
});

describe("the conflict copy may never name a PERSON (B1391)", () => {
  it("says WINDOW, never a someone — these notes are private to one account", () => {
    const copy = notesConflictLine("Site notes");
    const all = `${copy.text} ${copy.keepMine} ${copy.keepTheirs} ${copy.parkedSuffix}`;
    expect(copy.text).toContain("Site notes");
    expect(all).toMatch(/window/i);
    expect(all).not.toMatch(/person|someone|somebody|else's|another user|colleague/i);
  });

  it("still says plainly that nothing was overwritten — the reassurance is the point of the bar", () => {
    expect(notesConflictLine("x").text).toMatch(/nothing was overwritten/i);
  });

  it("an untitled page is named, not left blank", () => {
    expect(notesConflictLine("").text).toContain("Untitled");
  });
});
