/* THE ELEMENT BAND ESCAPE HATCH (NEW-1) — the type-layer rule, and the one deliberate way across it.
 *
 * Owner decision 2026-08-09, answering the six `{ open: … }` cells B293072 parked on the capability
 * table, verbatim: *"for item one, paving over a building. I mean, I don't think that should be the
 * default. But, like, if I try and force it and then I don't see why I shouldn't be able to do
 * that."*
 *
 * So there are TWO properties here and shipping either alone is a wrong answer, which is why they
 * are asserted as two separate describes:
 *
 *   1. THE DEFAULT DOES NOT MOVE. Every plan that has never been touched must sort byte-for-byte as
 *      it did before this feature existed. The strongest form of that is a REPLAY: the pre-fix
 *      comparator is reproduced verbatim below (PRE_FIX_BY_Z / PRE_FIX_Z_ORDER) and the shipped one
 *      must agree with it, element for element, on plans with no override anywhere. If a later
 *      change makes the default drift, that replay is what goes red.
 *
 *   2. FORCING WORKS, AND ONLY DELIBERATELY. An element carrying `bandForce: "front"` leaves its
 *      type band and draws over everything, including a building; ordinary Arrange (reorderByZ)
 *      still cannot move anything across a band edge, because it only ever sees one band's peers.
 *
 * ⛔ PROVEN RED AGAINST THE PRE-FIX SOURCE. With `zOrder` restored to `Z_LAYER[el.type] ?? 4` the
 * "forcing works" describe fails (paving stays under the building, the peer set stays the type's,
 * `bandForceOf` does not exist); with the override made the DEFAULT rather than opt-in, the replay
 * describe fails. Both directions are covered on purpose — a guard that can only fail one way is
 * how a default silently changes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zOrder, byZ, bandForceOf, EL_BANDS } from "../src/workspaces/site-planner/lib/planStyle.js";
import { reorderByZ, arrangeFlags } from "../src/workspaces/site-planner/lib/arrange.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const SP_CODE = stripComments(SP);

/* ── The PRE-FIX rule, reproduced verbatim. This is the thing the default must still equal. ────── */
const PRE_FIX_Z_LAYER = { road: 0, paving: 1, sidewalk: 1, landscape: 1, pond: 2, parking: 3, trailer: 3, building: 5 };
const PRE_FIX_Z_ORDER = (el) => PRE_FIX_Z_LAYER[el.type] ?? 4;
const PRE_FIX_BY_Z = (a, b) =>
  PRE_FIX_Z_ORDER(a) - PRE_FIX_Z_ORDER(b) ||
  (a.z || 0) - (b.z || 0) ||
  (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0);

const el = (id, type, z = 0, extra = {}) => ({ id, type, z, ...extra });

/* A plan holding one of every type twice, with ties, gaps and a missing z — the shapes a real saved
 * plan actually has, since the tiebreak ladder is where a comparator change hides. */
const UNTOUCHED_PLAN = [
  el("e9", "building", 2048), el("e1", "road", 0), el("e5", "pond", 1024),
  el("e3", "paving", 1024), el("e2", "road", 1024), el("e7", "parking", 0),
  el("e4", "paving", 1024), /* tie with e3 → id decides */
  { id: "e6", type: "sidewalk" }, /* no z at all → 0 */
  el("e8", "trailer", 512), el("e10", "building", 0), el("e11", "landscape", 3),
  el("e12", "gizmo", 0), /* an unknown type → the ?? 4 fallback */
];

describe("THE DEFAULT DOES NOT MOVE — an untouched plan sorts exactly as it did pre-fix", () => {
  it("zOrder agrees with the pre-fix type table for every type, including the unknown fallback", () => {
    for (const type of ["road", "paving", "sidewalk", "landscape", "pond", "parking", "trailer", "building", "gizmo", undefined]) {
      expect(zOrder({ type }), `zOrder changed for type ${String(type)}`).toBe(PRE_FIX_Z_ORDER({ type }));
    }
  });

  it("byZ produces the IDENTICAL order to the pre-fix comparator on a plan with no override", () => {
    const now = [...UNTOUCHED_PLAN].sort(byZ).map((e) => e.id);
    const before = [...UNTOUCHED_PLAN].sort(PRE_FIX_BY_Z).map((e) => e.id);
    expect(now).toEqual(before);
  });

  it("the type-layer rule still holds by default: paving cannot outrank a building", () => {
    const order = [...UNTOUCHED_PLAN].sort(byZ).map((e) => e.id);
    // Every paving id precedes (draws under) every building id, whatever their z says.
    for (const p of ["e3", "e4"]) for (const b of ["e9", "e10"]) {
      expect(order.indexOf(p), `${p} must draw under ${b}`).toBeLessThan(order.indexOf(b));
    }
  });

  it("an element with NO bandForce reports no override, and neither do the odd values", () => {
    for (const v of [undefined, null, "", "FRONT", "Back", 0, 1, true, {}, ["front"]]) {
      expect(bandForceOf({ type: "paving", bandForce: v }), `bandForce ${JSON.stringify(v)} must be ignored`).toBe(null);
      expect(zOrder({ type: "paving", bandForce: v })).toBe(PRE_FIX_Z_ORDER({ type: "paving" }));
    }
  });

  /* An unreadable override must never silently move a building — LOUD-FAILURE's quiet twin: when we
   * cannot honour an instruction, we do the DOCUMENTED thing (the type layer), not a third thing. */
  it("an unknown band name falls back to the TYPE LAYER, never to some other band", () => {
    const forged = { id: "x", type: "building", z: 0, bandForce: "somewhere-else" };
    expect(zOrder(forged)).toBe(PRE_FIX_Z_ORDER(forged));
  });
});

describe("FORCING WORKS — an explicit override crosses the band, and only it can", () => {
  it("forced paving draws OVER a building; the same paving untouched draws under it", () => {
    const bldg = el("b1", "building", 0);
    const pav = el("p1", "paving", 0);
    const before = [bldg, pav].sort(byZ).map((e) => e.id);
    expect(before).toEqual(["p1", "b1"]);                                   // paving under building
    const forced = { ...pav, bandForce: "front" };
    const after = [bldg, forced].sort(byZ).map((e) => e.id);
    expect(after).toEqual(["b1", "p1"]);                                    // …and over it once forced
  });

  it("the forced band sits above EVERY type band, not just the building one", () => {
    for (const type of ["road", "paving", "sidewalk", "landscape", "pond", "parking", "trailer", "building", "gizmo"]) {
      expect(zOrder({ type, bandForce: "front" })).toBeGreaterThan(PRE_FIX_Z_ORDER({ type }));
    }
    expect(zOrder({ type: "paving", bandForce: "front" })).toBe(EL_BANDS.front);
  });

  it("forcing ONE element leaves every other element exactly where it was", () => {
    const before = [...UNTOUCHED_PLAN].sort(byZ).map((e) => e.id);
    const plan = UNTOUCHED_PLAN.map((e) => (e.id === "e3" ? { ...e, bandForce: "front" } : e));
    const after = [...plan].sort(byZ).map((e) => e.id);
    expect(after.filter((id) => id !== "e3")).toEqual(before.filter((id) => id !== "e3"));
    expect(after[after.length - 1]).toBe("e3");                             // …and the forced one is on top
  });

  it("the override is REVERSIBLE: clearing it restores the pre-fix position exactly", () => {
    const plan = UNTOUCHED_PLAN.map((e) => (e.id === "e3" ? { ...e, bandForce: "front" } : e));
    const back = plan.map((e) => (e.id === "e3" ? { ...e, bandForce: undefined } : e));
    expect([...back].sort(byZ).map((e) => e.id)).toEqual([...UNTOUCHED_PLAN].sort(PRE_FIX_BY_Z).map((e) => e.id));
  });

  /* ⛔ THE OTHER HALF OF THE OWNER'S ANSWER: an ORDINARY Bring to Front must still stop at the band
   * edge. `reorderByZ` only ever sees the peers the caller hands it, and the caller (arrangeSel)
   * builds that set by `zOrder` — so the guarantee is that a band-scoped peer set can never contain
   * a member of another band, and that the patch only ever touches z. */
  it("ordinary Arrange cannot cross a band: its peer set is band-scoped and it only writes z", () => {
    const plan = [el("b1", "building", 0), el("b2", "building", 1024), el("p1", "paving", 0)];
    const band = zOrder(plan[2]);
    const peers = plan.filter((e) => zOrder(e) === band);
    expect(peers.map((e) => e.id)).toEqual(["p1"]);                         // buildings are not peers
    expect(reorderByZ(peers, "p1", "front")).toBe(null);                    // nothing to reorder against
    // …and with two paving pads, Bring to Front moves it above the OTHER PAVING only.
    const plan2 = [...plan, el("p2", "paving", 1024)];
    const peers2 = plan2.filter((e) => zOrder(e) === band);
    const patch = reorderByZ(peers2, "p1", "front");
    expect(Object.keys(patch)).toEqual(["p1"]);
    const moved = plan2.map((e) => (patch[e.id] != null ? { ...e, z: patch[e.id] } : e));
    const order = [...moved].sort(byZ).map((e) => e.id);
    expect(order.indexOf("p1")).toBeGreaterThan(order.indexOf("p2"));       // front of its own band…
    expect(order.indexOf("p1")).toBeLessThan(order.indexOf("b1"));          // …still under the buildings
  });

  it("forced elements form their own Arrange peer group and can be ordered against each other", () => {
    const plan = [
      el("b1", "building", 0),
      { ...el("p1", "paving", 0), bandForce: "front" },
      { ...el("k1", "parking", 1024), bandForce: "front" },   // forced later, so it stacked on top
    ];
    const band = EL_BANDS.front;
    const peers = plan.filter((e) => zOrder(e) === band);
    expect(peers.map((e) => e.id).sort()).toEqual(["k1", "p1"]);
    const af = arrangeFlags(peers, "p1");
    expect(af.count).toBe(2);
    const patch = reorderByZ(peers, "p1", "front");
    expect(patch).toBeTruthy();
    const moved = plan.map((e) => (patch[e.id] != null ? { ...e, z: patch[e.id] } : e));
    const order = [...moved].sort(byZ).map((e) => e.id);
    expect(order).toEqual(["b1", "k1", "p1"]);
  });
});

/* ── B548822 — THE MIRROR: "Force underneath everything" (`bandForce: "back"`), the escape hatch
 * the stack-picker report exposed as missing. Same shape as "front" throughout, on purpose — a
 * second mechanism here is the next bug. */
describe("THE MIRROR — 'back' crosses the band the other way, below every type including road", () => {
  it("forced pond draws UNDER a road; the same pond untouched draws over it", () => {
    const road = el("r1", "road", 0);
    const pond = el("d1", "pond", 0);
    const before = [road, pond].sort(byZ).map((e) => e.id);
    expect(before).toEqual(["r1", "d1"]);                                   // pond over road, normally
    const forced = { ...pond, bandForce: "back" };
    const after = [road, forced].sort(byZ).map((e) => e.id);
    expect(after).toEqual(["d1", "r1"]);                                    // …and under it once forced back
  });

  it("the back band sits below EVERY type band, including road", () => {
    for (const type of ["road", "paving", "sidewalk", "landscape", "pond", "parking", "trailer", "building", "gizmo"]) {
      expect(zOrder({ type, bandForce: "back" })).toBeLessThan(PRE_FIX_Z_ORDER({ type }));
    }
    expect(zOrder({ type: "pond", bandForce: "back" })).toBe(EL_BANDS.back);
  });

  it("the Richfield case: a pond forced back stops covering a road it geometrically contains", () => {
    // e1454052brxkkr (pond, z=-1024) sat over e1454053brxkkr (road, z=65536) — raw z never mattered,
    // the type band did. Forcing the POND back (rather than lifting the road) is the other fix.
    const pond = { id: "e1454052brxkkr", type: "pond", z: -1024 };
    const road = { id: "e1454053brxkkr", type: "road", z: 65536 };
    const order = [pond, road].sort(byZ).map((e) => e.id);
    expect(order).toEqual(["e1454053brxkkr", "e1454052brxkkr"]);            // pond paints last (on top) today, despite its far lower z
    const forcedPond = { ...pond, bandForce: "back" };
    const orderFixed = [forcedPond, road].sort(byZ).map((e) => e.id);
    expect(orderFixed).toEqual(["e1454052brxkkr", "e1454053brxkkr"]);       // road now paints last (on top)
  });

  it("forcing ONE element back leaves every other element exactly where it was", () => {
    const before = [...UNTOUCHED_PLAN].sort(byZ).map((e) => e.id);
    const plan = UNTOUCHED_PLAN.map((e) => (e.id === "e5" ? { ...e, bandForce: "back" } : e)); // e5 is a pond
    const after = [...plan].sort(byZ).map((e) => e.id);
    expect(after.filter((id) => id !== "e5")).toEqual(before.filter((id) => id !== "e5"));
    expect(after[0]).toBe("e5");                                            // …and the forced one is on bottom
  });

  it("the override is REVERSIBLE the other direction too", () => {
    const plan = UNTOUCHED_PLAN.map((e) => (e.id === "e5" ? { ...e, bandForce: "back" } : e));
    const restored = plan.map((e) => (e.id === "e5" ? { ...e, bandForce: undefined } : e));
    expect([...restored].sort(byZ).map((e) => e.id)).toEqual([...UNTOUCHED_PLAN].sort(PRE_FIX_BY_Z).map((e) => e.id));
  });

  it("front and back never collide, and each forms its own peer group", () => {
    const plan = [
      el("b1", "building", 0),
      { ...el("p1", "paving", 0), bandForce: "front" },
      { ...el("d1", "pond", 0), bandForce: "back" },
    ];
    const order = [...plan].sort(byZ).map((e) => e.id);
    expect(order).toEqual(["d1", "b1", "p1"]);
    expect(plan.filter((e) => zOrder(e) === EL_BANDS.back).map((e) => e.id)).toEqual(["d1"]);
    expect(plan.filter((e) => zOrder(e) === EL_BANDS.front).map((e) => e.id)).toEqual(["p1"]);
  });
});

/* ── SOURCE GUARDS — the wiring, which no pure test can see. Each of these was RED pre-fix. ────── */
describe("the escape hatch is wired, and it is the ONE mechanism", () => {
  it("the element right-click menu carries BOTH cross-band rows — front and its mirror, back", () => {
    expect(SP_CODE, 'the element menu must offer the "Force on top of everything" escape hatch')
      .toContain("Force on top of everything");
    expect(SP_CODE, 'and its mirror — the missing "force underneath" the stack-picker report named')
      .toContain("Force underneath everything");
    expect(SP_CODE, "…and the way back out of either").toContain("Use the normal layer order");
    expect(SP_CODE, "the front row must call the one mutator").toMatch(/setElBand\(t\.id,\s*"front"\)/);
    expect(SP_CODE, "the back row must call the same mutator, the other direction").toMatch(/setElBand\(t\.id,\s*"back"\)/);
    expect(SP_CODE, "the restore row must clear the override").toMatch(/setElBand\(t\.id,\s*null\)/);
  });

  it("the inspector shows a forced element as forced, with a restore control", () => {
    expect(SP_CODE, "a forced element must be visibly forced in its inspector").toContain("el-band-forced-note");
    expect(SP_CODE, "…and carry an obvious way back to the default order").toContain("el-band-restore");
  });

  /* The whole point of resolving the override inside `zOrder` is that the four places that ask a
   * band question keep asking ONE function. A second copy of the rule is the next bug. */
  it("nothing re-derives the band from el.type — the override resolves inside zOrder", () => {
    expect(SP_CODE.match(/Z_LAYER\s*\[/), "SitePlanner.jsx must not read the type table directly").toBeFalsy();
    expect(SP_CODE, "the peer set must be built from zOrder, which resolves the override")
      .toMatch(/peers = els\.filter\(\(e\) => zOrder\(e\) === band\)/);
  });

  /* A road that has been lifted out of the road band cannot stay in the dissolved road network, or
   * it paints in both places at once. */
  it("a forced road leaves the dissolved road network", () => {
    expect(SP_CODE, "the roadNet memo must exclude band-forced roads")
      .toMatch(/isCenterlineRoad\(x\) && !x\.attachedTo && !bandForceOf\(x\)/);
    expect(SP_CODE.match(/drawElsZ\.above\.map\([^)]*roadNet=\{null\}/), "the above-band pass must receive roadNet now that a road can land in it").toBeFalsy();
  });

  it("the capability table has no open cells left on crossBand", async () => {
    const { ELEMENT_CAPABILITIES, verdict } = await import("../e2e/elementCapabilities.table.js");
    for (const row of ELEMENT_CAPABILITIES.filter((r) => r.family === "el")) {
      expect(verdict(row.actions.crossBand), `${row.type} must have answered crossBand`).toBe("yes");
    }
  });
});
