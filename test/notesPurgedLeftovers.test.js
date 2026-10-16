/* A TOMBSTONED ORPHAN BODY IS A PURGE TO FINISH, NEVER A LOST NOTE (NEW-1, 2026-10-16).
 *
 * ⛔ THE FAILURE (owner's Grand Port › Notes, build 144dc28): the amber bar read "Two notes are
 * filed nowhere and could NOT be put back — this browser refused the write, so nothing was
 * changed." Both ids were in `tree.tombs` — deliberately purged, body bytes left behind on this
 * device. Nothing refused any write: the adoption effect found nothing to adopt, returned
 * early, never cleared `unreachable`, and the bar asserted a write outcome nobody observed.
 *
 * Each case below fails on the pre-fix code (red-proofed against main). */
import { beforeEach, describe, expect, it } from "vitest";

import { addPage, emptyTree, withTombstones, allPageIds } from "../src/workspaces/notes/lib/notesModel.js";
import { planPageSeed } from "../src/workspaces/notes/lib/notesCloud.js";
import { planOrphanResolution } from "../src/workspaces/notes/lib/notesOrphanPlan.js";
import { readFileSync } from "node:fs";

const mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};
const store = await import("../src/workspaces/notes/lib/notesStore.js");
const scan = await import("../src/workspaces/notes/lib/notesScan.js");

const doc = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
beforeEach(() => { mem.clear(); });

describe("unreachableNotes / scanOrphanBodies", () => {
  it("a body whose id is tombstoned is a purged leftover, NOT unreachable", () => {
    const tree = withTombstones(emptyTree(), ["pg_purged"]);
    store.writePage("pg_purged", doc("Asset Information template content"));
    store.writePage("pg_lost", doc("A genuinely node-less note with words"));
    const r = scan.scanOrphanBodies(tree);
    expect(r.purgedLeftovers).toEqual(["pg_purged"]);
    expect(r.unreachable.map((o) => o.pageId)).toEqual(["pg_lost"]);
    expect(scan.unreachableNotes(tree).map((o) => o.pageId)).toEqual(["pg_lost"]);
  });
});

describe("planOrphanResolution — every orphan ends in exactly one outcome", () => {
  it("maps a tombstoned orphan to purge and a node-less un-tombstoned body to adopt", () => {
    const tree = withTombstones(emptyTree(), ["pg_purged"]);
    const unreachable = [{ pageId: "pg_purged", firstLine: "x", preview: "x" }, { pageId: "pg_lost", firstLine: "y", preview: "y" }];
    const r = planOrphanResolution(tree, unreachable, []);
    expect(r.outcome).toEqual({ pg_purged: "purged", pg_lost: "adopted" });
    expect(r.purge).toEqual(["pg_purged"]);
    expect(allPageIds(r.tree)).toEqual(["pg_lost"]);       // the purged one is never given a node
  });
  it("a leftovers-only plan changes no tree but still purges", () => {
    const tree = withTombstones(emptyTree(), ["pg_a", "pg_b"]);
    const r = planOrphanResolution(tree, [], ["pg_a", "pg_b"]);
    expect(r.changed).toBe(false);
    expect(r.purge.sort()).toEqual(["pg_a", "pg_b"]);
  });
  it("an orphan that already has a home is settled, not left standing", () => {
    const tree = addPage(emptyTree(), { id: "pg_home", title: "h" }).tree;
    const r = planOrphanResolution(tree, [{ pageId: "pg_home", firstLine: "h" }], []);
    expect(r.outcome.pg_home).toBe("settled");
  });
});

describe("the cloud seed never re-adopts a tombstoned row (leak source)", () => {
  const row = (id) => ({ id, rev: 3, purged: false, binned: false });
  it("a tombstoned, un-purged row is repurged, not adopted — and not uploaded when only local", () => {
    const p = planPageSeed({ index: [row("pg_t")], localIds: [], tombstoned: ["pg_t"] });
    expect(p.adopt).toEqual([]);
    expect(p.repurge).toEqual(["pg_t"]);
    const q = planPageSeed({ index: [], localIds: ["pg_t"], tombstoned: ["pg_t"] });
    expect(q.upload).toEqual([]);
  });
  it("a failed cloud purge stays eligible: the row is listed again next seed", () => {
    const state = { treeRev: null, treeDirty: false, images: {}, adopted: [], pages: { pg_t: { rev: 3, dirty: false, purged: true, auto: false } } };
    expect(planPageSeed({ index: [row("pg_t")], state, localIds: [], tombstoned: ["pg_t"] }).repurge).toEqual(["pg_t"]);
  });
  it("untombstoned rows adopt exactly as before", () => {
    expect(planPageSeed({ index: [row("pg_ok")], localIds: [], tombstoned: ["pg_t"] }).adopt).toEqual(["pg_ok"]);
  });
});

describe("IntegrityBanner claims a refused write only off the explicit signal", () => {
  const src = readFileSync("src/workspaces/notes/components/IntegrityBanner.jsx", "utf8");
  it("never derives the refused-write sentence from a count of notes found", () => {
    expect(src).not.toMatch(/\(unreachable\s*\|\|\s*\[\]\)\.length/);
    expect(src).toMatch(/const stillLost = writeRefused/);
    expect(src).not.toMatch(/this browser refused the write/);
  });
});

describe("Notes.jsx wires the real write outcome", () => {
  const src = readFileSync("src/workspaces/notes/Notes.jsx", "utf8");
  it("persistTree returns writeTree's boolean and the effect reads it", () => {
    expect(src).toMatch(/if \(!writeTree\(next\)\) setStatus\("error"\); else return true;[\s\S]*return false;/);
    expect(src).toMatch(/if \(!persistTree\(plan\.tree\)\) writeRefused/);
  });
});
