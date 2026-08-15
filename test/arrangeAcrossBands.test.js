/* NEW-1 — "Send to Back" means behind everything under it.
 *
 * ⛔ THE POINT OF THIS SUITE, and why it is separate from `sitePlannerArrange.test.js`: every
 * assertion here is one the PRE-FIX rule fails, and the pre-fix rule is replayed at the bottom as
 * the mutation check rather than described. The old model — `reorderByZ` over the peers in the
 * object's OWN band — passes 14 tests in that sibling file and is not wrong about anything it
 * claims; it simply cannot see the case the owner is in, because a markup over a building is a
 * question about the OTHER band.
 *
 * The measured symptom being closed (owner's account, a duplicate of Goose Creek Plan II): a
 * markup drawn over Building 1, right-click → Send to Back → nothing visible happens, and the row
 * then greys itself, which is a claim that the operation completed.
 */
import { describe, it, expect } from "vitest";
import { arrangeAcrossBands, arrangeBandFlags, reorderByZ, arrangeFlags } from "../src/workspaces/site-planner/lib/arrange.js";
import { Z_GAP, sortByZ } from "../src/workspaces/site-planner/lib/zOrder.js";

// Apply a result to the family, so a test asserts the RESULTING STACK rather than a patch shape.
const apply = (items, res) => items.map((o) => {
  const out = { ...o };
  if (res.patch[o.id] != null) out.z = res.patch[o.id];
  if (res.cross && res.cross.id === o.id) out.behindEls = res.cross.behind ? true : undefined;
  return out;
});
// Bottom-to-top paint order of the whole family, the way the two render passes actually draw it:
// the behind band first, then the band over the plan, each sorted by z.
const painted = (items) => [
  ...sortByZ(items.filter((o) => o.behindEls === true)),
  ...sortByZ(items.filter((o) => o.behindEls !== true)),
].map((o) => o.id);

// THE OWNER'S CASE, at its minimum: one markup, over the plan, nothing else in the family.
const lone = () => [{ id: "mk1", z: 100 }];
// A mixed plan: two over the plan, one already behind it.
const mixed = () => [
  { id: "under", z: 50, behindEls: true },
  { id: "low", z: 100 },
  { id: "high", z: 200 },
];

describe("arrangeAcrossBands — Send to Back crosses the band (the owner's reported case)", () => {
  it("sends a LONE markup over a building behind the plan — the exact reported repro", () => {
    const res = arrangeAcrossBands(lone(), "mk1", "back");
    // Pre-fix this was null (a lone peer is a no-op in every mode), which is the whole defect:
    // the app decided there was nothing to do and greyed the row.
    expect(res).not.toBeNull();
    expect(res.cross).toEqual({ id: "mk1", behind: true });
    expect(apply(lone(), res)[0].behindEls).toBe(true);
  });

  it("Send to Back lands at the BOTTOM of the whole stack, not the bottom of a band", () => {
    const res = arrangeAcrossBands(mixed(), "high", "back");
    expect(painted(apply(mixed(), res))).toEqual(["high", "under", "low"]);
  });

  it("Bring to Front is the mirror — it crosses UP and lands on top of everything", () => {
    const res = arrangeAcrossBands(mixed(), "under", "front");
    expect(painted(apply(mixed(), res))).toEqual(["low", "high", "under"]);
  });

  it("a within-band move is UNCHANGED — same minimal patch the original rule produced", () => {
    const items = mixed();
    const res = arrangeAcrossBands(items, "low", "front");
    expect(res.cross).toBeNull();
    expect(res.patch).toEqual(reorderByZ(items.filter((o) => o.behindEls !== true), "low", "front"));
  });
});

describe("arrangeAcrossBands — the single-step modes step ACROSS the band edge, once", () => {
  it("Send Backward at the bottom of the upper band crosses, landing ON TOP of the lower band", () => {
    const res = arrangeAcrossBands(mixed(), "low", "backward");
    expect(res.cross).toEqual({ id: "low", behind: true });
    // One step down: below "high", above "under" — not all the way to the bottom.
    expect(painted(apply(mixed(), res))).toEqual(["under", "low", "high"]);
  });

  it("Bring Forward at the top of the lower band crosses, landing UNDER the upper band", () => {
    const res = arrangeAcrossBands(mixed(), "under", "forward");
    expect(res.cross).toEqual({ id: "under", behind: false });
    expect(painted(apply(mixed(), res))).toEqual(["under", "low", "high"]);
  });

  it("backward then forward returns the original paint order (the steps are inverses across the edge)", () => {
    const start = mixed();
    const once = apply(start, arrangeAcrossBands(start, "low", "backward"));
    const back = apply(once, arrangeAcrossBands(once, "low", "forward"));
    expect(painted(back)).toEqual(painted(start));
  });

  it("a within-band step never crosses", () => {
    const res = arrangeAcrossBands(mixed(), "high", "backward");
    expect(res.cross).toBeNull();
    expect(painted(apply(mixed(), res))).toEqual(["under", "high", "low"]);
  });
});

describe("arrangeAcrossBands — a no-op is now a TRUE end of the whole stack", () => {
  it("back / backward are no-ops only at the bottom of the LOWER band", () => {
    const items = [{ id: "a", z: 10, behindEls: true }, { id: "b", z: 20, behindEls: true }];
    expect(arrangeAcrossBands(items, "a", "back")).toBeNull();
    expect(arrangeAcrossBands(items, "a", "backward")).toBeNull();
    expect(arrangeAcrossBands(items, "b", "back")).not.toBeNull();
  });

  it("front / forward are no-ops only at the top of the UPPER band", () => {
    const items = [{ id: "a", z: 10 }, { id: "b", z: 20 }];
    expect(arrangeAcrossBands(items, "b", "front")).toBeNull();
    expect(arrangeAcrossBands(items, "b", "forward")).toBeNull();
    expect(arrangeAcrossBands(items, "a", "front")).not.toBeNull();
  });

  it("a lone markup ALREADY behind the plan is at the true back — and only then is it a no-op", () => {
    const items = [{ id: "mk1", z: 100, behindEls: true }];
    expect(arrangeAcrossBands(items, "mk1", "back")).toBeNull();
    expect(arrangeAcrossBands(items, "mk1", "front")).not.toBeNull();
  });

  it("unknown id / unknown mode / non-array input are no-ops", () => {
    expect(arrangeAcrossBands(mixed(), "nope", "back")).toBeNull();
    expect(arrangeAcrossBands(mixed(), "low", "sideways")).toBeNull();
    expect(arrangeAcrossBands(null, "low", "back")).toBeNull();
  });

  it("does not mutate its input", () => {
    const items = mixed();
    const copy = JSON.parse(JSON.stringify(items));
    arrangeAcrossBands(items, "high", "back");
    expect(items).toEqual(copy);
  });
});

describe("arrangeBandFlags — the greying can no longer claim an invisible success", () => {
  it("a LONE markup over the plan is NOT at the back, so Send to Back stays enabled", () => {
    const f = arrangeBandFlags(lone(), "mk1");
    expect(f.atBottom).toBe(false);
    expect(f.atTop).toBe(true);
    // The pre-fix flags said the opposite, which is what greyed the row.
    expect(arrangeFlags(lone(), "mk1").atBottom).toBe(true);
  });

  it("a markup at the bottom of the behind band IS at the back", () => {
    const items = [{ id: "mk1", z: 100, behindEls: true }];
    expect(arrangeBandFlags(items, "mk1")).toMatchObject({ atBottom: true, atTop: false, behind: true });
  });

  it("the bottom of the UPPER band is not the bottom of the stack", () => {
    expect(arrangeBandFlags(mixed(), "low")).toMatchObject({ atBottom: false, atTop: false });
  });

  it("count is the whole family, both bands", () => {
    expect(arrangeBandFlags(mixed(), "low").count).toBe(3);
  });

  it("returns null for an unknown id", () => {
    expect(arrangeBandFlags(mixed(), "nope")).toBeNull();
  });
});

/* ⛔ THE MUTATION CHECK, and it is the PRE-FIX RULE REPLAYED VERBATIM rather than a planted defect.
 * `bandOnly` is what `arrangeSel` did for all three annotation families before this item: filter the
 * family to the target's own band, hand it to `reorderByZ`, and grey the row from `arrangeFlags`
 * over that same filtered list. If a future change quietly restores that behaviour, these
 * expectations are what go red — and they are stated as the SYMPTOM, not as an implementation
 * detail, so the guard survives a refactor of the fix. */
describe("mutation check — the pre-fix rule, replayed", () => {
  const bandOnly = (items, id, mode) => {
    const t = items.find((o) => o.id === id);
    const peers = items.filter((o) => (o.behindEls === true) === (t.behindEls === true));
    return reorderByZ(peers, id, mode);
  };

  it("the pre-fix rule CANNOT move a lone markup off the building (this is the bug)", () => {
    expect(bandOnly(lone(), "mk1", "back")).toBeNull();
    expect(arrangeAcrossBands(lone(), "mk1", "back")).not.toBeNull();
  });

  it("the pre-fix rule sends to the back of a band that is entirely ABOVE the elements", () => {
    const pre = mixed().map((o) => {
      const z = bandOnly(mixed(), "high", "back")[o.id];
      return z == null ? o : { ...o, z };
    });
    // "high" moved to the bottom of the upper band — still over the plan. Nothing the user asked
    // for happened, and no band changed.
    expect(pre.find((o) => o.id === "high").behindEls).toBeUndefined();
    expect(painted(pre)).toEqual(["under", "high", "low"]);
    // The fix puts it under the plan, where "back" means what it says.
    expect(painted(apply(mixed(), arrangeAcrossBands(mixed(), "high", "back")))).toEqual(["high", "under", "low"]);
  });

  it("the pre-fix FLAGS then grey the row, reporting completion of an invisible move", () => {
    const after = mixed().map((o) => {
      const z = bandOnly(mixed(), "high", "back")[o.id];
      return z == null ? o : { ...o, z };
    });
    const peers = after.filter((o) => o.behindEls !== true);
    expect(arrangeFlags(peers, "high").atBottom).toBe(true);        // greyed — "already at the back"
    expect(arrangeBandFlags(after, "high").atBottom).toBe(false);   // and it plainly is not
  });
});

describe("z gaps stay sane across a crossing (so a later within-band move still has room)", () => {
  it("crossing to the back leaves a full gap below the lowest peer", () => {
    const items = mixed();
    const res = arrangeAcrossBands(items, "high", "back");
    expect(res.patch.high).toBe(50 - Z_GAP);
  });

  it("crossing into an EMPTY band is well-defined", () => {
    const items = [{ id: "a", z: 10 }, { id: "b", z: 20 }];
    const res = arrangeAcrossBands(items, "a", "back");
    expect(res.cross).toEqual({ id: "a", behind: true });
    expect(Number.isFinite(res.patch.a)).toBe(true);
    expect(painted(apply(items, res))).toEqual(["a", "b"]);
  });
});
