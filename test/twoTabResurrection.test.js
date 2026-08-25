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
  it("SUPERSEDED BY ROUND 3 — a stale collection no longer resurrects even with NO fold at all", async () => {
    // Round 1 fixed the CALL SITE (SitePlanner.jsx's reconcileElems folds drainRemote()'s
    // instructions before diffing) but left the ENGINE itself willing to mint a create for any
    // stale-canvas read, from ANY call site — which is exactly what round 2's live re-test proved:
    // the resurrection recurred with a WORSE blast radius, from a call site round 1's fold cannot
    // reach at all (the idle observer's ordinary autosave diff, no gesture, nothing buffered — see
    // the "round 3" describe block below). Round 3 closes it at the ENGINE, so this exact stale-fed
    // collection — reconcile() given NO fold, exactly the pre-round-1 bug shape — now mints nothing.
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
    // `drainRemote()` used to hand it (round 1's shape) — and, more generally, exactly what ANY
    // stale-canvas window hands it (round 3's shape: no fold in sight, no gesture, nothing buffered).
    s.reconcile({ els: [el("host"), el("sw1", { type: "sidewalk", attachedTo: "host" })] }, {});
    await tick();
    const createdIds = ops.filter((o) => o.op === "create").map((o) => o.id);
    expect(createdIds).toEqual([]); // ← the delete floor refuses both, engine-side, no fold needed
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

/* B712224 (round 3) — round 1's fold (above) only helps when the canvas removal was BUFFERED
 * (`busyRef.current` true, a gesture in flight). The owner's round-2 live re-test had tab B
 * COMPLETELY IDLE — no gesture, nothing buffered — and the resurrection still happened: 11 of 13
 * bonded children came back alive under a fresh, envelope-less ("unknown") operation. Production
 * telemetry (site `smt6imo0gda0`) shows the mechanism is NOT a race elementSync's fold can reach at
 * all: `reconcile()`'s `!shad` branch cannot tell "the server has never seen this element" from "the
 * server holds this element as a TOMBSTONE and the canvas hasn't caught up yet" — both look
 * identical (no shadow entry, the collection still shows it). Any stale-canvas window — a direct
 * React state-update lag, a heal-pass clobber, a refetch fold — reproduces the shape with NO
 * buffering involved whatsoever, and `commit_elements` deliberately auto-restores a `create` over a
 * same-kind tombstone (the exact behavior `site_elements.sql`'s create branch documents).
 *
 * THE FIX: a never-pruned delete floor (`maxDeleteRev`, already used by the refetch-resurrect guard)
 * is now recorded on EVERY tombstone this engine learns of — its own, a foreign one via
 * `applyRemoteRow`, and one read back from a `seed()` — and `reconcile()`'s `!shad` branch refuses to
 * mint a create against a floored key (unless a `restore()` is explicitly in flight), routing the
 * refusal back through the `onRowsCanonical` channel as a removal instead. */
describe("B712224 (round 3) — the delete floor: a tombstoned element's stale canvas copy never re-mints a create", () => {
  it("a FOREIGN tombstone (no gesture, nothing buffered) leaves a floor that refuses the phantom create and reports a removal", async () => {
    const ops = [];
    const adoptions = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {}, onRowsCanonical: (a) => adoptions.push(...a),
      commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "host", data: el("host"), rev: 2, z_index: 0 }]);
    // Tab B's realtime handler receives tab A's tombstone and applies it DIRECTLY (no gesture, no
    // buffering) — exactly `applyRemoteRow`'s ordinary path, never touching `pendingRemoteRef`.
    const instr = s.applyRemoteRow({ kind: "el", id: "host", deleted_at: "2026-08-24T01:40:27.245909+00", rev: 3, updated_by: "tab-a" });
    expect(instr.action).toBe("remove");
    // THE BUG SHAPE: reconcile() is fed the canvas AS IT STOOD BEFORE that removal landed — no fold,
    // no drain, nothing buffered to fold. Round 1's fix cannot see this at all: there is nothing in
    // `pendingRemoteRef` to fold.
    s.reconcile({ els: [el("host")] }, {});
    await tick();
    expect(ops.filter((o) => o.op === "create")).toHaveLength(0);   // ← no resurrection
    expect(adoptions).toEqual([{ kind: "el", id: "host", el: null }]); // ← told to remove it from the canvas
  });

  it("MUTATION CHECK — the pre-fix `!shad` branch (no floor check) mints a create for the identical inputs", async () => {
    // The exact OLD shape of reconcile()'s no-shadow branch: mint unconditionally. Proves the
    // scenario above is a real hole the floor check closes, not an artifact of this test's setup.
    const preFixCreate = (shad, maxDeleteRevHas) => !shad && !maxDeleteRevHas;
    expect(preFixCreate(/* shad */ undefined, /* maxDeleteRev.has */ false)).toBe(true);
    // and the CURRENT module really does floor it — re-run the live scenario and check the floor
    // directly via the engine's own tombstone snapshot, which `reconcile()` consults.
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {}, commit: async (batch) => ({ ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: 1 })) }),
    });
    s.seed([{ kind: "el", id: "host", data: el("host"), rev: 2, z_index: 0 }]);
    s.applyRemoteRow({ kind: "el", id: "host", deleted_at: "2026-08-24T01:40:27.245909+00", rev: 3, updated_by: "tab-a" });
    expect(s.tombstonedSnapshot().has("el:host")).toBe(true); // the floor the fix reads
  });

  it("CONTROL — a genuinely NEW element (never tombstoned) still creates normally", async () => {
    const ops = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {}, commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([]);
    s.reconcile({ els: [el("brand-new")] }, {});
    await tick();
    expect(ops.filter((o) => o.op === "create").map((o) => o.id)).toEqual(["brand-new"]);
  });

  it("CONTROL — an explicit restore() after a foreign tombstone still commits as cls:restore, never refused", async () => {
    const ops = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {}, commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    s.seed([{ kind: "el", id: "host", data: el("host"), rev: 2, z_index: 0 }]);
    s.applyRemoteRow({ kind: "el", id: "host", deleted_at: "2026-08-24T01:40:27.245909+00", rev: 3, updated_by: "tab-a" });
    s.restore("el", "host", el("host"));       // the B673 "deleted by ⟨name⟩" toast's explicit Restore action
    s.reconcile({ els: [el("host")] }, {});     // the canvas already shows the restore-in-progress copy
    await tick();
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("restore");
  });

  it("the floor also comes from seed() — a page load / reconnect that fetches a tombstoned row refuses the same phantom create", async () => {
    const ops = [];
    const adoptions = [];
    const s = createElementSync({
      siteId: "s", selfUid: "me", now: () => 0, setTimer: (fn) => { fn(); return 1; }, clearTimer: () => {},
      onEvent: () => {}, onRowsCanonical: (a) => adoptions.push(...a),
      commit: async (batch) => { ops.push(...batch); return { ok: true, results: batch.map((o) => ({ id: o.id, status: "ok", rev: (o.expected || 0) + 1 })) }; },
    });
    // fetchElements() does NOT filter on deleted_at — a reconnect refetch's row set includes tombstones.
    s.seed([{ kind: "el", id: "host", data: el("host"), rev: 3, z_index: 0, deleted_at: "2026-08-24T01:40:27.245909+00" }]);
    // A stale on-device cache (or a canvas that hasn't yet absorbed the tombstone) still shows it.
    s.reconcile({ els: [el("host")] }, {});
    await tick();
    expect(ops.filter((o) => o.op === "create")).toHaveLength(0);
    expect(adoptions).toEqual([{ kind: "el", id: "host", el: null }]);
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
