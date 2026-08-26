/* B784832 — undo/redo only resurrected `el` elements; callouts, markups, measures and parcels
 * stayed dead after Ctrl+Z (and the toolbar Undo button, which calls the identical `undo()` path).
 *
 * REPORTED LIVE (Michael, plan "Richfield" smt7q6ar8egz): three callouts deleted, Ctrl+Z and the
 * undo button both did nothing — the callouts stayed tombstoned in `site_elements`, no un-delete
 * write ever landed.
 *
 * ROOT CAUSE (SitePlanner.jsx `applySnapshot`): after a snapshot restore, the resurrect-list it
 * hands to `elementSync.allowResurrect()` — the ONE thing that lets `reconcile()`'s `!shad` branch
 * mint a `create` over a live server tombstone instead of refusing it as a phantom (B712224 round
 * 3) — was built from `s.els` only. Undoing the deletion of any OTHER kind (`markup` / `measure` /
 * `callout` / `parcel`) restored it on the canvas for exactly one render: the very next `reconcile()`
 * found no `pendingResurrect` entry for that key, read the still-tombstoned server row, refused the
 * create, and told the canvas to remove it again via `onRowsCanonical` — a Ctrl+Z that visibly did
 * nothing, and did not persist even if it had appeared to work.
 *
 * THE FIX: iterate the same `KIND_TO_FIELD` map the sync engine itself is keyed on, so every
 * collection is included and a future sixth kind cannot fall through this loop again.
 *
 * This suite mirrors twoTabResurrection.test.js's shape: a behavioral proof at the elementSync
 * engine level (the fix's `allowResurrect` call unblocks every kind; the pre-fix call — `el` only —
 * reproduces the reported bug for the other four) plus a structural guard on the real source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";
import { KIND_TO_FIELD } from "../src/workspaces/site-planner/lib/elementRows.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

const KINDS = Object.keys(KIND_TO_FIELD); // ["el", "markup", "measure", "callout", "parcel"]
const fixtureFor = (kind) => ({ id: `${kind}1`, kind, data: { id: `${kind}1`, kind } });

function makeEngine() {
  const ops = [];
  const adoptions = [];
  const s = createElementSync({
    siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
    onEvent: () => {}, onRowsCanonical: (a) => adoptions.push(...a),
    commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
  });
  return { s, ops, adoptions };
}

describe("B784832 — undo must resurrect EVERY kind (el, markup, measure, callout, parcel), not just el", () => {
  it("THE FIX: allowResurrect populated from every KIND_TO_FIELD collection lets every kind's delete-undo commit a create", async () => {
    const { s, ops, adoptions } = makeEngine();
    // Seed one live element of each kind, then tombstone each — exactly what "delete this callout"
    // (or building, markup, measurement, parcel) does on the server.
    s.seed(KINDS.map((kind) => ({ kind, id: `${kind}1`, data: fixtureFor(kind).data, rev: 2, z_index: 0 })));
    for (const kind of KINDS) {
      s.applyRemoteRow({ kind, id: `${kind}1`, deleted_at: "2026-08-26T15:34:03.980+00", rev: 3, updated_by: "me" });
    }
    // THE FIXED SHAPE — SitePlanner.jsx's applySnapshot now builds this list from every
    // KIND_TO_FIELD collection in the restored snapshot, not just `els`.
    const items = [];
    for (const kind of KINDS) items.push({ kind, id: `${kind}1` });
    s.allowResurrect(items);
    // The undone snapshot's canvas collections all show their element back.
    const collections = {};
    for (const [kind, field] of Object.entries(KIND_TO_FIELD)) collections[field] = [fixtureFor(kind).data];
    s.reconcile(collections, {});
    await tick();
    const createdKeys = ops.filter((o) => o.op === "create").map((o) => `${o.kind}:${o.id}`);
    expect(createdKeys.sort()).toEqual(KINDS.map((k) => `${k}:${k}1`).sort());
    expect(adoptions).toEqual([]); // nothing was forced back off the canvas
  });

  it("THE BUG, REPRODUCED: allowResurrect populated from `el` only (the pre-fix shape) leaves the other four kinds phantom-refused", async () => {
    const { s, ops, adoptions } = makeEngine();
    s.seed(KINDS.map((kind) => ({ kind, id: `${kind}1`, data: fixtureFor(kind).data, rev: 2, z_index: 0 })));
    for (const kind of KINDS) {
      s.applyRemoteRow({ kind, id: `${kind}1`, deleted_at: "2026-08-26T15:34:03.980+00", rev: 3, updated_by: "me" });
    }
    // THE PRE-FIX SHAPE — verbatim: `for (const x of s.els || []) items.push({ kind: "el", id: x.id })`.
    s.allowResurrect([{ kind: "el", id: "el1" }]);
    const collections = {};
    for (const [kind, field] of Object.entries(KIND_TO_FIELD)) collections[field] = [fixtureFor(kind).data];
    s.reconcile(collections, {});
    await tick();
    const createdKeys = ops.filter((o) => o.op === "create").map((o) => `${o.kind}:${o.id}`);
    expect(createdKeys).toEqual(["el:el1"]); // only the exempted kind actually commits
    // The other four are refused as phantom creates and handed back as removals — the app-visible
    // "I pressed undo and the callout/markup/measurement/parcel is still gone" symptom.
    const removedKeys = adoptions.map((a) => `${a.kind}:${a.id}`).sort();
    expect(removedKeys).toEqual(["callout:callout1", "markup:markup1", "measure:measure1", "parcel:parcel1"]);
    expect(adoptions.every((a) => a.el === null)).toBe(true);
  });

  it("CONTROL — a genuinely new (never-tombstoned) object of every kind still creates normally with no allowResurrect at all", async () => {
    const { s, ops } = makeEngine();
    s.seed([]);
    const collections = {};
    for (const [kind, field] of Object.entries(KIND_TO_FIELD)) collections[field] = [fixtureFor(kind).data];
    s.reconcile(collections, {});
    await tick();
    const createdKeys = ops.filter((o) => o.op === "create").map((o) => `${o.kind}:${o.id}`);
    expect(createdKeys.sort()).toEqual(KINDS.map((k) => `${k}:${k}1`).sort());
  });
});

describe("B784832 — SitePlanner.applySnapshot's resurrect-staging is structurally generic over every kind", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("stages resurrect items from KIND_TO_FIELD, not from a single hardcoded `s.els` loop", () => {
    const idx = src.indexOf("if (e && e.allowResurrect) {");
    expect(idx, "the allowResurrect staging block is gone").toBeGreaterThan(-1);
    const block = src.slice(idx, src.indexOf("\n      }", idx) + "\n      }".length);
    expect(block).toMatch(/Object\.entries\(KIND_TO_FIELD\)/);
    expect(block).toMatch(/s\[field\]/);
    // The exact pre-fix bug signature: a bare `s.els` loop hardcoding `kind: "el"` and nothing else.
    expect(block).not.toMatch(/for \(const x of s\.els \|\| \[\]\)/);
    expect(block).not.toMatch(/kind:\s*"el",\s*id:\s*x\.id/);
  });

  it("SitePlanner.jsx imports KIND_TO_FIELD (so the staging loop and the sync engine can never disagree on kinds)", () => {
    expect(src).toMatch(/import\s*\{[^}]*KIND_TO_FIELD[^}]*\}\s*from\s*"\.\/lib\/elementRows\.js"/);
  });
});
