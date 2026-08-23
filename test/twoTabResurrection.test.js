/* B712224 — the two-tab bonded-assembly delete resurrection.
 *
 * THE BUG, measured live on production (two throwaway plans, `smt6ew6hjpch` two-tab vs
 * `smt6f2h5ka22` single-tab control): deleting a bonded assembly with a SECOND same-account tab
 * open resurrected exactly 3 of its 14 members — the along-wall sidewalks and a court-trailer
 * row — ~2s after the delete cascade committed, alive again at a fresh rev with the SAME ids.
 *
 * THE MECHANISM (SitePlanner.jsx `reconcileElems`): a realtime tombstone clears the engine's
 * `shadow` entry for a key SYNCHRONOUSLY, the moment the row arrives — but if a gesture (even an
 * incidental pan) is in flight, the matching CANVAS removal is buffered into `pendingRemoteRef`
 * instead of applied immediately. When the gesture ends, `reconcileElems` used to call
 * `drainRemote()` (which fires the buffered `setEls`/etc — an ASYNC React update) and then, on the
 * very next line, read `stateRef.current` — which is only re-assigned on the NEXT render and so
 * still held the just-tombstoned elements. Feeding that STALE collection into `elementSync.reconcile()`
 * reproduces exactly the shape that function is built to diff: shadow lacks the key (the tombstone
 * already cleared it), the collection still has it → a fresh CREATE, which the server auto-restores
 * a same-kind tombstoned row into (the observed rev 2→3, deleted_at set→NULL, same id).
 *
 * THE FIX: `drainRemote()` now returns the instructions it applied, and `reconcileElems` folds them
 * into LOCAL copies of the collections (via the same `applyInstrToList` the real `setEls` calls use)
 * before diffing — so the diff sees the post-drain reality in the same synchronous call, regardless
 * of whether React has re-rendered `stateRef.current` yet.
 *
 * This suite has two halves: a BEHAVIORAL reproduction of the underlying vulnerability at the
 * elementSync diff level (feeding it a stale, pre-drain collection resurrects a tombstoned element;
 * feeding it the folded, post-drain collection does not — the exact transformation the fix applies),
 * and a STRUCTURAL guard on the real `SitePlanner.jsx` source, so the fix cannot silently regress
 * back to reading `stateRef.current` right after `drainRemote()` with nothing folded in between.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";

const tick = () => new Promise((r) => setTimeout(r, 0));
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

// The exact transform `applyInstrToList` performs in SitePlanner.jsx — duplicated here (not
// imported: the real one is a closure inside the component) so the behavioral half exercises the
// identical shape the fix applies, both pre- and post-fix.
const applyInstrToList = (list, instr) => {
  if (!instr || instr.action === "ignore") return list;
  if (instr.action === "remove") return list.filter((x) => x.id !== instr.id);
  if (instr.action === "upsert")
    return list.some((x) => x.id === instr.id) ? list.map((x) => (x.id === instr.id ? instr.el : x)) : [...list, instr.el];
  return list;
};

const el = (id, extra = {}) => ({ id, type: "building", cx: 0, cy: 0, w: 10, h: 10, ...extra });

describe("B712224 — the elementSync diff resurrects a tombstoned element fed a STALE collection", () => {
  it("reproduces the vulnerability: shadow cleared by a tombstone, collection still shows it alive → a fresh CREATE", async () => {
    const ops = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {},
      commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([
      { kind: "el", id: "host", data: el("host"), rev: 2, z_index: 0 },
      { kind: "el", id: "sw1", data: el("sw1", { type: "sidewalk", attachedTo: "host" }), rev: 2, z_index: 1024 },
    ]);
    // A same-account tombstone arrives for both — this SYNCHRONOUSLY clears shadow for both keys,
    // exactly as elementSync.applyRemoteRow does regardless of whether the canvas instruction that
    // pairs with it gets applied immediately or buffered.
    s.applyRemoteRow({ kind: "el", id: "host", deleted_at: "2026-08-23T23:03:09.019602+00", rev: 3, updated_by: "me" });
    s.applyRemoteRow({ kind: "el", id: "sw1", deleted_at: "2026-08-23T23:03:09.019602+00", rev: 3, updated_by: "me" });
    // THE BUG SHAPE: reconcile() is fed the collection AS IT STOOD BEFORE either tombstone was
    // applied to the canvas — exactly what a stale `stateRef.current` read right after
    // `drainRemote()` used to hand it.
    s.reconcile({ els: [el("host"), el("sw1", { type: "sidewalk", attachedTo: "host" })] }, {});
    await tick();
    const createdIds = ops.filter((o) => o.op === "create").map((o) => o.id);
    expect(createdIds.sort()).toEqual(["host", "sw1"]); // ← the resurrection, reproduced
  });

  it("THE FIX: folding the drained remove instructions into the collection BEFORE diffing resurrects nothing", async () => {
    const ops = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {},
      commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([
      { kind: "el", id: "host", data: el("host"), rev: 2, z_index: 0 },
      { kind: "el", id: "sw1", data: el("sw1", { type: "sidewalk", attachedTo: "host" }), rev: 2, z_index: 1024 },
    ]);
    const instrHost = s.applyRemoteRow({ kind: "el", id: "host", deleted_at: "2026-08-23T23:03:09.019602+00", rev: 3, updated_by: "me" });
    const instrSw1 = s.applyRemoteRow({ kind: "el", id: "sw1", deleted_at: "2026-08-23T23:03:09.019602+00", rev: 3, updated_by: "me" });
    expect(instrHost.action).toBe("remove");
    expect(instrSw1.action).toBe("remove");
    // THE FIX SHAPE: fold the drained instructions into a LOCAL copy — exactly what
    // reconcileElems now does with `drained` — before handing the collection to reconcile().
    let staleEls = [el("host"), el("sw1", { type: "sidewalk", attachedTo: "host" })];
    for (const instr of [instrHost, instrSw1]) staleEls = applyInstrToList(staleEls, instr);
    expect(staleEls).toHaveLength(0); // both correctly folded out
    s.reconcile({ els: staleEls }, {});
    await tick();
    expect(ops).toHaveLength(0); // ← no resurrection
  });
});

describe("B712224 — SitePlanner.reconcileElems folds drainRemote()'s instructions before diffing (structural guard)", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("drainRemote() returns what it applied, not void — a synchronous caller needs the instructions back", () => {
    const idx = src.indexOf("const drainRemote = () => {");
    expect(idx, "drainRemote is gone").toBeGreaterThan(-1);
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    expect(block).toMatch(/return q;/);
    expect(block).toMatch(/return \[\];/); // the empty-queue early return must also return an array
  });

  it("applyRemoteInstr and reconcileElems share ONE instruction-application rule (applyInstrToList)", () => {
    const defIdx = src.indexOf("const applyInstrToList = (list, instr) => {");
    expect(defIdx, "applyInstrToList is gone").toBeGreaterThan(-1);
    const applyRemoteIdx = src.indexOf("const applyRemoteInstr = (instr) => {");
    const applyRemoteBlock = src.slice(applyRemoteIdx, src.indexOf("\n  };", applyRemoteIdx));
    expect(applyRemoteBlock).toMatch(/applyInstrToList\(a, instr\)/); // the real setState calls use it too
  });

  it("reconcileElems captures drainRemote()'s return and folds it into LOCAL collections before e.reconcile()", () => {
    const idx = src.indexOf("const reconcileElems = (busy, override) =>");
    const block = src.slice(idx, src.indexOf("\n  };", idx));
    // The stale-read shape this regresses to: draining without capturing anything, then reading
    // stateRef.current straight into the reconcile() call with no fold in between.
    expect(block).toMatch(/drained\s*=\s*drainRemote\(\)/);
    expect(block).toMatch(/for \(const instr of drained\)/);
    expect(block).toMatch(/els = applyInstrToList\(els, instr\)/);
    expect(block).toMatch(/markups = applyInstrToList\(markups, instr\)/);
    // The reconcile call must use the FOLDED local bindings, never `s.markups` etc. directly —
    // that literal shape (`markups: s.markups`) is the pre-fix bug signature.
    expect(block).toMatch(/e\.reconcile\(\{ els, markups, measures, callouts, parcels \}/);
    expect(block).not.toMatch(/markups:\s*s\.markups/);
  });
});
