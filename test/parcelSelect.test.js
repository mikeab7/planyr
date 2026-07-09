/* B735 — parcel merge-selection reducer: seed from the single selection so a
 * plain-click-then-Shift-click flow accumulates (the bug), plus the B170 inactive guard. */
import { describe, it, expect } from "vitest";
import { extendMergeSelection } from "../src/workspaces/site-planner/lib/parcelSelect.js";

// Every parcel active unless named here.
const activeMap = (inactive = []) => (id) => (inactive.includes(id) ? false : true);

describe("extendMergeSelection — the reported bug: plain-click A then Shift-click B", () => {
  it("seeds the set with the primary selection, so A is kept when B is Shift-clicked", () => {
    // A was plain-clicked (lives in `sel`, combineSel is still empty). Now Shift-click B.
    const next = extendMergeSelection([], "B", { primaryId: "A", isActive: activeMap() });
    expect(next).toEqual(["A", "B"]);
  });

  it("does not seed twice — a second Shift-click just adds the new parcel", () => {
    // After the first Shift-click, combineSel=[A,B] and sel moved to B. Shift-click C.
    const next = extendMergeSelection(["A", "B"], "C", { primaryId: "B", isActive: activeMap() });
    expect(next).toEqual(["A", "B", "C"]);
  });

  it("never seeds a duplicate when the primary is already in the set", () => {
    const next = extendMergeSelection(["A"], "B", { primaryId: "A", isActive: activeMap() });
    expect(next).toEqual(["A", "B"]);
  });
});

describe("extendMergeSelection — toggle semantics (Shift = add OR remove for parcels)", () => {
  it("Shift-clicking an already-picked parcel removes it", () => {
    const next = extendMergeSelection(["A", "B"], "B", { primaryId: "B", isActive: activeMap() });
    expect(next).toEqual(["A"]);
  });

  it("removing the primary still seeds nothing extra (primary === clicked is a plain toggle-off)", () => {
    // primaryId === clickedId → the seed branch is skipped; just toggle it off.
    const next = extendMergeSelection(["A", "B"], "A", { primaryId: "A", isActive: activeMap() });
    expect(next).toEqual(["B"]);
  });

  it("accumulates across a pure Shift-only flow (no prior primary)", () => {
    let s = extendMergeSelection([], "A", { primaryId: null, isActive: activeMap() });
    expect(s).toEqual(["A"]);
    s = extendMergeSelection(s, "B", { primaryId: "A", isActive: activeMap() });
    expect(s).toEqual(["A", "B"]);
  });

  it("seeds ANY active primaryId not already in the set — so the CALLER must never pass a just-removed parcel as primaryId (B735 resurrection contract)", () => {
    // This is correct given the inputs: the reducer trusts primaryId. The host wrapper
    // (shiftPickParcel) is what must keep `sel` off a removed parcel — verified by the headless
    // harness resurrection-guard check — so that this seed can't bring a removed parcel back.
    expect(extendMergeSelection(["B"], "C", { primaryId: "A", isActive: activeMap() })).toEqual(["B", "A", "C"]);
  });
});

describe("extendMergeSelection — inactive-parcel guard (B170)", () => {
  it("never ADDS an inactive parcel", () => {
    const next = extendMergeSelection(["A"], "B", { primaryId: "A", isActive: activeMap(["B"]) });
    expect(next).toEqual(["A"]);
  });

  it("never SEEDS an inactive primary", () => {
    const next = extendMergeSelection([], "B", { primaryId: "A", isActive: activeMap(["A"]) });
    expect(next).toEqual(["B"]);
  });

  it("still REMOVES an already-picked parcel even if it went inactive", () => {
    const next = extendMergeSelection(["A", "B"], "B", { primaryId: "A", isActive: activeMap(["B"]) });
    expect(next).toEqual(["A"]);
  });
});

describe("extendMergeSelection — defensive input handling", () => {
  it("treats a non-array current as empty", () => {
    expect(extendMergeSelection(null, "A", { primaryId: null })).toEqual(["A"]);
    expect(extendMergeSelection(undefined, "A", {})).toEqual(["A"]);
  });

  it("treats a missing isActive as everything-active", () => {
    const next = extendMergeSelection([], "B", { primaryId: "A" });
    expect(next).toEqual(["A", "B"]);
  });

  it("treats an undefined active flag (default parcel) as active", () => {
    // isActive returns undefined for a parcel with no explicit `active` field.
    const next = extendMergeSelection([], "B", { primaryId: "A", isActive: () => undefined });
    expect(next).toEqual(["A", "B"]);
  });
});
