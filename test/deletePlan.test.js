/* NEW-1 — the delete-resolution guard.
 *
 * The owner's report was "delete is not deleting, and it keeps happening." The root cause was never
 * one bug: `deleteSel` opened with a bare `if (!sel) return;` — a silent no-op reachable from several
 * ordinary selection states, from any of sixteen call sites, with nothing written down anywhere.
 *
 * So these tests are written against the CONTRACT, not the old code paths:
 *   1. anything the user can SEE as selected is deletable — at any selection count, pinned or not;
 *   2. a delete that removes nothing returns a REASON and a message (never "" / undefined);
 *   3. a building takes its whole bonded assembly and every id gets a tombstone.
 * Each entry point is exercised against each selection shape, because the historical failures were
 * shape-dependent (a one-item multi behaved differently from a two-item one).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  planDelete, resolveRef, bondedSubtree, shouldHintTypingGuard,
  DELETE_ENTRIES, REF_FIELD, TYPING_GUARD_HINT,
} from "../src/workspaces/site-planner/lib/deletePlan.js";

// A plan shaped like the owner's Colorado site: three buildings, one carrying a bonded assembly.
const state = () => ({
  els: [
    { id: "b1", type: "building", cx: 0, cy: 0 },
    { id: "b1c1", type: "paving", attachedTo: "b1" },      // truck court
    { id: "b1c2", type: "parking", attachedTo: "b1" },     // trailer parking
    { id: "b1c3", type: "paving", attachedTo: "b1", dogEar: true },
    { id: "b2", type: "building" },
    { id: "b3", type: "building", locked: true },
    { id: "p1", type: "pond" },
  ],
  markups: [{ id: "m1", kind: "easement" }, { id: "m2", kind: "line", locked: true }],
  measures: [{ id: "ms1" }, { id: "ms2" }, {}],            // third is a legacy id-less measurement
  callouts: [{ id: "c1" }, { id: "c2", noLeader: true }],
  parcels: [{ id: "pc1", locked: true }, { id: "pc2" }],
});

const plan = (over) => planDelete({ state: state(), entry: "key:delete", ...over });

describe("the entry-point registry", () => {
  it("names every delete entry point exactly once", () => {
    expect(new Set(DELETE_ENTRIES).size).toBe(DELETE_ENTRIES.length);
    for (const e of ["key:delete", "cut", "panel:element", "panel:pond", "panel:parcel", "panel:easement",
      "panel:markup", "panel:callout", "panel:measure", "menu:element", "menu:measure", "menu:callout",
      "menu:markup", "menu:parcel"]) expect(DELETE_ENTRIES).toContain(e);
  });
  it("carries the asking entry point through to the result, for telemetry", () => {
    for (const entry of DELETE_ENTRIES) {
      expect(plan({ sel: { kind: "el", id: "b2" }, entry }).entry).toBe(entry);
      expect(plan({ sel: null, multi: [], entry }).entry).toBe(entry); // …including on the no-op path
    }
  });
});

describe("ref resolution", () => {
  it("maps every ref kind to a real collection and refuses an unknown one", () => {
    expect(Object.keys(REF_FIELD).sort()).toEqual(["callout", "el", "markup", "measure", "parcel"]);
    // The old code's trailing `else` treated ANY unrecognised kind as a parcel.
    expect(resolveRef({ kind: "overlay", id: "o1" }, state())).toBeNull();
    expect(plan({ sel: { kind: "overlay", id: "o1" } }).remove.parcels).toEqual([]);
  });
  it("resolves a measurement by id AND by index — the two forms sel and multi actually carry", () => {
    expect(resolveRef({ kind: "measure", id: "ms2" }, state()).index).toBe(1);
    expect(resolveRef({ kind: "measure", i: 1 }, state()).id).toBe("ms2");
    expect(resolveRef({ kind: "measure", i: 9 }, state())).toBeNull();
  });
  it("returns null for an id that is no longer on the plan", () => {
    expect(resolveRef({ kind: "el", id: "gone" }, state())).toBeNull();
  });
});

describe("a single selection", () => {
  it("deletes a plain building", () => {
    const r = plan({ sel: { kind: "el", id: "b2" } });
    expect(r.outcome).toBe("removed");
    expect(r.remove.els).toEqual(["b2"]);
    expect(r.tombstones).toEqual(["b2"]);
    expect(r.label).toBe("building");
  });
  it("takes a building's WHOLE bonded assembly and tombstones every id", () => {
    const r = plan({ sel: { kind: "el", id: "b1" } });
    expect(r.remove.els.sort()).toEqual(["b1", "b1c1", "b1c2", "b1c3"]);
    expect(r.tombstones.sort()).toEqual(["b1", "b1c1", "b1c2", "b1c3"]);
    expect(bondedSubtree(state().els, "b1")).toHaveLength(4);
  });
  it("deletes a bonded CHILD without taking its host with it", () => {
    const r = plan({ sel: { kind: "el", id: "b1c1" } });
    expect(r.remove.els).toEqual(["b1c1"]);
  });
  it("deletes each of the other kinds, with a tombstone", () => {
    expect(plan({ sel: { kind: "markup", id: "m1" } }).remove.markups).toEqual(["m1"]);
    expect(plan({ sel: { kind: "callout", id: "c1" } }).remove.callouts).toEqual(["c1"]);
    expect(plan({ sel: { kind: "parcel", id: "pc2" } }).remove.parcels).toEqual(["pc2"]);
    expect(plan({ sel: { kind: "measure", i: 0 } }).remove.measures).toEqual(["ms1"]);
    for (const s of [{ kind: "markup", id: "m1" }, { kind: "callout", id: "c1" }, { kind: "parcel", id: "pc2" }, { kind: "measure", i: 0 }])
      expect(plan({ sel: s }).tombstones).toHaveLength(1);
  });
  it("falls back to the index for a legacy measurement with no id, so it still gets removed", () => {
    const r = plan({ sel: { kind: "measure", i: 2 } });
    expect(r.outcome).toBe("removed");
    expect(r.remove.measures).toEqual([]);
    expect(r.remove.measureIdx).toEqual([2]);
  });
  it("names a text box a text box and a pond a pond", () => {
    expect(plan({ sel: { kind: "callout", id: "c2" } }).label).toBe("text box");
    expect(plan({ sel: { kind: "el", id: "p1" } }).label).toBe("pond");
  });
});

describe("a MULTI-selection of exactly ONE — the hole the old count branch left open", () => {
  it("deletes it, with no `sel` at all", () => {
    // `multi.length > 1` was false, so the old code fell through to `sel`, which was null → silence.
    const r = plan({ sel: null, multi: [{ kind: "el", id: "b2" }] });
    expect(r.outcome).toBe("removed");
    expect(r.remove.els).toEqual(["b2"]);
  });
  it("behaves identically to the same item as a single selection", () => {
    const viaMulti = plan({ sel: null, multi: [{ kind: "el", id: "b1" }] });
    const viaSel = plan({ sel: { kind: "el", id: "b1" }, multi: [] });
    expect(viaMulti.remove).toEqual(viaSel.remove);
    expect(viaMulti.tombstones.sort()).toEqual(viaSel.tombstones.sort());
  });
  it("deletes a one-item multi of every kind", () => {
    for (const ref of [{ kind: "markup", id: "m1" }, { kind: "measure", id: "ms1" }, { kind: "callout", id: "c1" }, { kind: "parcel", id: "pc2" }])
      expect(plan({ sel: null, multi: [ref] }).outcome).toBe("removed");
  });
});

describe("a multi-item multi-selection", () => {
  it("deletes every member, across kinds, in one plan", () => {
    const r = plan({ sel: null, multi: [
      { kind: "el", id: "b1" }, { kind: "markup", id: "m1" }, { kind: "measure", id: "ms1" },
      { kind: "callout", id: "c1" }, { kind: "parcel", id: "pc2" },
    ] });
    expect(r.outcome).toBe("removed");
    expect(r.remove.els.sort()).toEqual(["b1", "b1c1", "b1c2", "b1c3"]);
    expect(r.remove.markups).toEqual(["m1"]);
    expect(r.remove.measures).toEqual(["ms1"]);
    expect(r.remove.callouts).toEqual(["c1"]);
    expect(r.remove.parcels).toEqual(["pc2"]);
    expect(r.tombstones).toHaveLength(8);
    expect(r.label).toBe("5 items");
  });
  it("selecting a bonded child alongside its host never widens beyond the host's own assembly", () => {
    const r = plan({ sel: null, multi: [{ kind: "el", id: "b1c1" }, { kind: "el", id: "b1" }] });
    expect(r.remove.els.sort()).toEqual(["b1", "b1c1", "b1c2", "b1c3"]);
  });
  it("selecting ONLY a bonded child in a multi does not delete its building", () => {
    // The old multi branch resolved each ref to its ROOT first, so this silently took the building.
    expect(plan({ sel: null, multi: [{ kind: "el", id: "b1c1" }] }).remove.els).toEqual(["b1c1"]);
  });
  it("unions `sel` into the set and de-dupes it, however the two disagree", () => {
    const r = plan({ sel: { kind: "measure", i: 0 }, multi: [{ kind: "measure", id: "ms1" }] });
    expect(r.count).toBe(1);
    expect(r.remove.measures).toEqual(["ms1"]);
    // A `sel` that ISN'T in `multi` is still deleted — it is visibly selected.
    const r2 = plan({ sel: { kind: "el", id: "b2" }, multi: [{ kind: "el", id: "p1" }] });
    expect(r2.remove.els.sort()).toEqual(["b2", "p1"]);
  });
});

describe("an explicit menu target", () => {
  it("beats whatever the selection refs say, and does not wait for a setSel() to land", () => {
    const r = plan({ sel: { kind: "el", id: "b2" }, multi: [{ kind: "el", id: "p1" }], explicit: { kind: "el", id: "b1" }, entry: "menu:element" });
    expect(r.remove.els.sort()).toEqual(["b1", "b1c1", "b1c2", "b1c3"]);
  });
  it("still refuses loudly when the just-clicked item has already gone", () => {
    const r = plan({ explicit: { kind: "el", id: "gone" }, entry: "menu:element" });
    expect(r.outcome).toBe("stale");
    expect(r.message).toMatch(/already gone/i);
  });
});

describe("DELETE IS UNCONDITIONAL", () => {
  it("deletes a PINNED element, markup and parcel — pinning guards a drag, never a deliberate Delete", () => {
    expect(plan({ sel: { kind: "el", id: "b3" } }).outcome).toBe("removed");
    expect(plan({ sel: { kind: "markup", id: "m2" } }).outcome).toBe("removed");
    expect(plan({ sel: { kind: "parcel", id: "pc1" } }).outcome).toBe("removed");
  });
  it("still REPORTS that a pinned item was in the set, so telemetry can see it", () => {
    expect(plan({ sel: { kind: "el", id: "b3" } }).lockedCount).toBe(1);
    expect(plan({ sel: null, multi: [{ kind: "el", id: "b3" }, { kind: "markup", id: "m2" }] }).lockedCount).toBe(2);
    expect(plan({ sel: { kind: "el", id: "b2" } }).lockedCount).toBe(0);
  });
});

describe("SILENCE IS IMPOSSIBLE", () => {
  it("says nothing is selected rather than doing nothing", () => {
    const r = plan({ sel: null, multi: [] });
    expect(r.outcome).toBe("empty");
    expect(r.message).toMatch(/nothing is selected/i);
    expect(r.tombstones).toEqual([]);
  });
  it("says the target is already gone when the selection is stale", () => {
    const r = plan({ sel: { kind: "el", id: "gone" }, multi: [{ kind: "markup", id: "alsoGone" }] });
    expect(r.outcome).toBe("stale");
    expect(r.message).toMatch(/already gone/i);
    expect(r.stale).toHaveLength(2);
  });
  it("still deletes the live members when only SOME of the selection is stale", () => {
    const r = plan({ sel: null, multi: [{ kind: "el", id: "gone" }, { kind: "el", id: "b2" }] });
    expect(r.outcome).toBe("removed");
    expect(r.remove.els).toEqual(["b2"]);
    expect(r.stale).toHaveLength(1);
  });
  it("NEVER returns a no-op without a message — over every entry point and selection shape", () => {
    const shapes = [
      { sel: null, multi: [] },
      { sel: { kind: "el", id: "gone" }, multi: [] },
      { sel: null, multi: [{ kind: "el", id: "gone" }] },
      { sel: null, multi: [{ kind: "measure", i: 99 }] },
      { sel: { kind: "overlay", id: "o1" }, multi: [] },
      { explicit: { kind: "callout", id: "gone" } },
    ];
    for (const entry of DELETE_ENTRIES) for (const shape of shapes) {
      const r = plan({ ...shape, entry });
      expect(r.outcome, `${entry} ${JSON.stringify(shape)}`).not.toBe("removed");
      expect(r.message.length, `${entry} ${JSON.stringify(shape)}`).toBeGreaterThan(10);
    }
  });
  it("never returns a message on a successful delete (the toast is for failures only)", () => {
    expect(plan({ sel: { kind: "el", id: "b2" } }).message).toBe("");
  });
  it("survives a missing/garbage state without throwing", () => {
    for (const st of [undefined, {}, { els: null }, { els: [null, { }] }])
      expect(planDelete({ sel: { kind: "el", id: "b1" }, state: st }).outcome).not.toBe("removed");
  });
});

/* Source guard. The pure module can only prove the DECISION is sound; these assertions hold the
 * wiring, because the recurrence was never in the maths — it was a call site that quietly opted out
 * of the contract. A new Delete button that forgets its entry id goes red here, not in production. */
describe("every delete entry point in SitePlanner.jsx is wired to the contract", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  // Prose describing the wiring (this file is heavily commented on purpose) is not wiring.
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("has no bare onClick={deleteSel} left — every button names its entry point", () => {
    expect(code).not.toMatch(/onClick=\{deleteSel\}/);
  });

  it("passes an `entry` at every deleteSel call site", () => {
    const calls = code.match(/deleteSel\((?!\s*\))[^;]*?\)/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(11); // the panel buttons + the menus + cut + the key
    for (const c of calls) expect(c, c).toMatch(/entry:\s*"/);
    // …and every entry id used is a registered one.
    for (const m of src.matchAll(/entry:\s*"([^"]+)"/g)) expect(DELETE_ENTRIES).toContain(m[1]);
  });

  it("keeps the keyboard Delete UNCONDITIONAL — no selection precondition on the keypress", () => {
    // The old `&& (selRef.current || multiRef.current.length)` guard meant Delete-with-nothing-
    // selected never reached deleteSel, so it could never say "nothing is selected".
    expect(src).toMatch(/if \(e\.key === "Delete" \|\| e\.key === "Backspace"\) \{ e\.preventDefault\(\); deleteSel\(null, \{ entry: "key:delete" \}\)/);
  });

  it("clears BOTH selection stores on a delete and on an undo/redo snapshot", () => {
    // A one-item `multi` left pointing at a just-deleted element is what made the Delete key dead
    // until an unrelated click reset it — in deleteSel itself, and again in applySnapshot.
    const del = src.slice(src.indexOf("const deleteSel = (target, opts)"));
    const body = del.slice(0, del.indexOf("\n  };"));
    expect(body).toMatch(/setSel\(null\); setMulti\(\[\]\)/);
    const snap = src.slice(src.indexOf("const applySnapshot = (s) =>"));
    expect(snap.slice(0, snap.indexOf("\n  };"))).toMatch(/setSel\(null\); setMulti\(\[\]\)/);
  });

  it("reports every attempt AND every outcome through the client_errors event channel", () => {
    expect(src).toMatch(/reportClientEvent\("delete-attempt"/);
    expect(src).toMatch(/reportClientEvent\("delete-outcome"/);
    // The two sibling delete paths that don't go through deleteSel are instrumented too.
    for (const fn of ["const deleteMarkupById", "const deleteParcelById"]) {
      const f = src.slice(src.indexOf(fn));
      expect(f.slice(0, f.indexOf("\n  };")), fn).toMatch(/reportClientEvent\("delete-outcome"/);
    }
  });

  it("leaves no delete path that returns without saying anything", () => {
    for (const fn of ["const deleteMarkupById", "const deleteParcelById"]) {
      const f = src.slice(src.indexOf(fn));
      const body = f.slice(0, f.indexOf("\n  };"));
      // Any early `return;` in these must be preceded by a user-facing flashWarn.
      const early = body.slice(0, body.lastIndexOf("return;") + 7);
      if (/return;/.test(early)) expect(early, fn).toMatch(/flashWarn\(/);
    }
  });
});

describe("the typing-guard hint", () => {
  const base = { key: "Delete", hasSelection: true, fieldKey: "width", lastHintedField: null };
  it("fires once per focused field when Delete is swallowed with something selected", () => {
    expect(shouldHintTypingGuard(base)).toBe(true);
    expect(shouldHintTypingGuard({ ...base, lastHintedField: "width" })).toBe(false);
    expect(shouldHintTypingGuard({ ...base, fieldKey: "depth", lastHintedField: "width" })).toBe(true);
  });
  it("never fires on Backspace — the natural editing key inside a field", () => {
    expect(shouldHintTypingGuard({ ...base, key: "Backspace" })).toBe(false);
  });
  it("never fires with nothing selected (Delete wasn't going to do anything anyway)", () => {
    expect(shouldHintTypingGuard({ ...base, hasSelection: false })).toBe(false);
  });
  it("tells the user where the keystroke went and what to do", () => {
    expect(TYPING_GUARD_HINT).toMatch(/typing/i);
    expect(TYPING_GUARD_HINT).toMatch(/click the plan/i);
  });
});
