import { describe, it, expect } from "vitest";
import { assemblyIntegrity, unhealablePayload } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";
import { missingBondSiblings, impossibleStacks, ID_BOND_KEYS, normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";
import { ID_BOND_TAGS } from "../src/workspaces/site-planner/lib/bondRemap.js";

/* ⛔ NEW-3 — A HEAL THAT PRODUCES A PHYSICALLY IMPOSSIBLE LAYOUT MUST FAIL, NOT REPORT SUCCESS.
 *
 * THE MEASURED CASE, from the owner's plan `smsdrvzr9gzx` (Richfield / Concept A), reproduced here
 * with his real numbers rather than a stand-in. Building `e1454939cgzlnc` is 620 × 1198 at rot 270
 * with a truck court and a trailer row on each of two walls. A stale delete (NEW-1) killed the
 * RIGHT-hand truck court `e1454940cgzlnc` — 135 ft deep. Two passes then conspired:
 *
 *   1. `normalizeCrossHostBonds` read the trailer's `forCourt`, could not find the element it
 *      named, and DROPPED the reference as "dangling" — a rule written for a bond pointing at
 *      another BUILDING's court, applied to a bond pointing at nothing.
 *   2. `normalizeStrandedZones` then saw a stack member nobody points at, read it as the HEAD of
 *      its own chain, and laid it against the dock wall: 310 (half the host across that wall) + 25
 *      (half its own depth) = 335 ft, where it had been at 470.
 *
 * The heal moved it 135 ft — exactly the depth of the court that was missing — and reported
 * `assembly-tear-healed`. The result is a trailer row flush against a dock wall with no truck
 * court for a truck to reach it across: not a layout, a layout with a piece missing.
 *
 * The invariant is asserted as GEOMETRY, not as bookkeeping, because after step 1 the BONDS were
 * coherent — the broken one had been tidied away — and the drawing was not.
 */

const HOST = { id: "e1454939cgzlnc", type: "building", cx: 1594.19, cy: -762.81, w: 620, h: 1198, rot: 270 };
// LEFT wall (intact): court then trailer.
const LEFT_COURT = { id: "e1454942cgzlnc", type: "paving", cx: 1594.19, cy: -385.31, w: 135, h: 1198, rot: 270, attachedTo: HOST.id, truckCourt: { side: "left" } };
const LEFT_TRAILER = { id: "e1454943cgzlnc", type: "trailer", cx: 1594.19, cy: -292.81, w: 1198, h: 50, rot: 0, attachedTo: HOST.id, noFit: true, forCourt: LEFT_COURT.id, prevZone: LEFT_COURT.id };
// RIGHT wall: the court is the row that was deleted.
const RIGHT_COURT = { id: "e1454940cgzlnc", type: "paving", cx: 1594.19, cy: -1140.31, w: 135, h: 1198, rot: 270, attachedTo: HOST.id, truckCourt: { side: "right" } };
const RIGHT_TRAILER = { id: "e1454941cgzlnc", type: "trailer", cx: 1594.19, cy: -1232.81, w: 1198, h: 50, rot: 0, attachedTo: HOST.id, noFit: true, forCourt: RIGHT_COURT.id, prevZone: RIGHT_COURT.id };

const whole = () => [HOST, LEFT_COURT, LEFT_TRAILER, RIGHT_COURT, RIGHT_TRAILER].map((e) => ({ ...e }));
// The plan as it was left: the right-hand court gone, its trailer still declaring the bond.
const torn = () => [HOST, LEFT_COURT, LEFT_TRAILER, RIGHT_TRAILER].map((e) => ({ ...e }));
const byId = (list, id) => list.find((e) => e.id === id);

describe("NEW-3 — the heal leaves an assembly with a missing sibling ALONE", () => {
  it("a bond naming a DELETED element is not dropped: it is the only record of what belonged there", () => {
    const out = normalizeBondedChildren(torn());
    const t = byId(out, RIGHT_TRAILER.id);
    expect(t.forCourt).toBe(RIGHT_COURT.id);
    expect(t.prevZone).toBe(RIGHT_COURT.id);
  });

  it("…and its GEOMETRY is not re-derived: the 135 ft pull toward the building never happens", () => {
    const out = normalizeBondedChildren(torn());
    const t = byId(out, RIGHT_TRAILER.id);
    expect(t.cx).toBeCloseTo(RIGHT_TRAILER.cx, 6);
    expect(t.cy).toBeCloseTo(RIGHT_TRAILER.cy, 6);   // pre-fix: -1097.81, i.e. moved in by exactly 135
  });

  it("the tear is REPORTED instead, naming the element, the bond and the id that is gone", () => {
    const res = assemblyIntegrity(torn());
    const miss = res.unhealable.filter((r) => r.kind === "missing-sibling");
    expect(miss.length).toBe(2);                                  // forCourt AND prevZone
    expect(miss.every((r) => r.id === RIGHT_TRAILER.id)).toBe(true);
    expect(miss.every((r) => r.missing === RIGHT_COURT.id)).toBe(true);
    expect(miss.map((r) => r.bond).sort()).toEqual(["forCourt", "prevZone"]);
    const payload = unhealablePayload(res.unhealable);
    expect(payload.count).toBe(2);
    expect(payload.kinds).toContain("missing-sibling");
  });

  it("a COHERENT plan reports nothing and is returned by identity — the guard costs a clean plan nothing", () => {
    const list = whole();
    const res = assemblyIntegrity(list);
    expect(res.unhealable).toEqual([]);
    expect(res.els).toBe(list);
  });

  it("B1124 is UNTOUCHED: a bond pointing at a real element on ANOTHER host is still re-pointed", () => {
    // The duplicate-remap case this pass was written for: the element named EXISTS, it is simply
    // bonded to the wrong building. That is repairable and must stay repaired.
    const other = { ...HOST, id: "hostB", cx: 5000 };
    const otherCourt = { ...RIGHT_COURT, id: "courtB", attachedTo: "hostB", cx: 5000 };
    const list = [...whole(), other, otherCourt];
    const stray = byId(list, RIGHT_TRAILER.id);
    stray.forCourt = "courtB";                                    // cross-host: points at hostB's court
    stray.prevZone = "courtB";
    const out = normalizeBondedChildren(list);
    expect(byId(out, RIGHT_TRAILER.id).forCourt).toBe(RIGHT_COURT.id);   // re-pointed at its OWN host's court
    expect(missingBondSiblings(out)).toEqual([]);
  });
});

describe("NEW-3 — the direct assertion: a trailer row may never bond flush to its host", () => {
  it("fires on the exact state the owner was left with", () => {
    const left = torn();
    byId(left, RIGHT_TRAILER.id).cy = -1097.81;                   // where the heal put it: 335 ft across
    const bad = impossibleStacks(left);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ id: RIGHT_TRAILER.id, host: HOST.id, missing: "truck court" });
    expect(bad[0].across).toBeCloseTo(335, 2);                    // 310 + 25 — first in the stack
  });

  it("it is GEOMETRY, not bookkeeping: it fires even with the broken bond tidied away", () => {
    // This is what makes it the right assertion. After the old cross-host pass dropped the
    // dangling reference, every bond in the plan was coherent and the drawing was impossible.
    const left = torn();
    const t = byId(left, RIGHT_TRAILER.id);
    t.cy = -1097.81;
    delete t.forCourt; delete t.prevZone;
    expect(missingBondSiblings(left)).toEqual([]);                // nothing left to see in the bonds…
    expect(impossibleStacks(left)).toHaveLength(1);               // …and the geometry still says it
  });

  it("does NOT fire on the intact wall, where a court sits between the trailer and the building", () => {
    expect(impossibleStacks(whole())).toEqual([]);
  });

  it("does NOT fire on a trailer that is merely far from its host (that is a TEAR, a different thing)", () => {
    const list = whole();
    byId(list, RIGHT_TRAILER.id).cy -= 2000;
    expect(impossibleStacks(list)).toEqual([]);
  });

  it("assemblyIntegrity carries it, separately from `tears`, so a fix and a refusal are never one number", () => {
    const left = torn();
    byId(left, RIGHT_TRAILER.id).cy = -1097.81;
    const res = assemblyIntegrity(left);
    expect(res.unhealable.some((r) => r.kind === "impossible-stack")).toBe(true);
    expect(res.tears.every((t) => t.id !== RIGHT_TRAILER.id)).toBe(true);   // never counted as healed
  });
});

describe("NEW-3 — the bond inventory cannot drift from the copy path's", () => {
  it("ID_BOND_KEYS is ID_BOND_TAGS minus `attachedTo` (which names the HOST, not a sibling)", () => {
    expect([...ID_BOND_KEYS].sort()).toEqual(ID_BOND_TAGS.filter((k) => k !== "attachedTo").sort());
  });

  it("a legacy `forTrailer: true` flag is inert, not a bond — it can never be reported as missing", () => {
    const list = whole();
    byId(list, RIGHT_TRAILER.id).forTrailer = true;
    expect(missingBondSiblings(list)).toEqual([]);
  });
});
