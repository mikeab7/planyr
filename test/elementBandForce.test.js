/* THE ELEMENT BAND ESCAPE HATCH — RETIRED (B1788912, 2026-09-19, NEW-1).
 *
 * This file used to prove the type-layer rule (road → paving → pond → parking → building) and its
 * one deliberate `bandForce` escape hatch. Owner decision, 2026-09-19, verbatim, REVERSING the
 * 2026-08-09 decision this file was originally written to guard: *"I mean I feel like whatever I
 * draw should be at the top so I can never lose anything when I draw it, I'm assuming that's how
 * bluebeam works"* — told plainly that a parking field drawn after a building would paint over the
 * building, and a road drawn last would put pavement over everything, and, verbatim: *"Selection
 * should lift and I'm good with bluebeams order with new items on top, you can disregard my
 * previous rule."* See `/CLAUDE.md`'s owner-constraints entry 10 and planStyle.js's SUPERSEDED
 * Z_LAYER block for the full history.
 *
 * This file now proves the REPLACEMENT: `zOrder`/`byZ` are pure creation-order (no type table, no
 * band), the retired mechanism (`bandForceOf` / `EL_BANDS` / the "Draw order" panel control /
 * `setElBand`) is genuinely gone rather than merely unused, and the one-time migration
 * (`migrateBandForce` in zOrder.js) folds a legacy `bandForce` value into an ordinary z instead of
 * leaving dead, misleading data on an old plan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zOrder, byZ } from "../src/workspaces/site-planner/lib/planStyle.js";
import * as PlanStyle from "../src/workspaces/site-planner/lib/planStyle.js";
import { withMissingZ, migrateBandForce, Z_GAP, nextZ } from "../src/workspaces/site-planner/lib/zOrder.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const SP = read("../src/workspaces/site-planner/SitePlanner.jsx");
const PS = read("../src/workspaces/site-planner/lib/planStyle.js");
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const SP_CODE = stripComments(SP);
// planStyle.js's SUPERSEDED block quotes the retired Z_LAYER/EL_BANDS/bandForceOf names on purpose
// (history, kept rather than deleted) — strip comments here too so this checks the LIVE code only.
const PS_CODE = stripComments(PS);

const el = (id, type, z, extra = {}) => ({ id, type, z, ...extra });

describe("zOrder/byZ are plain creation order — no type table, no band", () => {
  it("zOrder reads the element's own z, never its type", () => {
    for (const type of ["road", "paving", "sidewalk", "landscape", "pond", "parking", "trailer", "building", "gizmo"]) {
      expect(zOrder({ type, z: 42 })).toBe(42);
    }
  });
  it("a missing or non-numeric z reads as 0", () => {
    for (const bad of [undefined, null, NaN, "12", {}]) {
      expect(zOrder({ type: "building", z: bad })).toBe(0);
    }
    expect(zOrder({ type: "building" })).toBe(0);
  });
  it("byZ sorts purely by (z, id) — a higher-z paving pad DOES outrank a lower-z building", () => {
    const bldg = el("b1", "building", 0);
    const pav = el("p1", "paving", 1024);
    expect([bldg, pav].sort(byZ).map((e) => e.id)).toEqual(["b1", "p1"]); // paving paints last (on top)
  });
  it("a real Arrange 'send to back' (z=0, or negative) is never treated as missing", () => {
    const a = el("a", "building", 0), b = el("b", "paving", -50);
    expect([a, b].sort(byZ).map((e) => e.id)).toEqual(["b", "a"]);
  });
  it("id is the deterministic tiebreak for an exact z tie", () => {
    const a = el("z-later", "pond", 5), b = el("a-earlier", "pond", 5);
    expect([a, b].sort(byZ).map((e) => e.id)).toEqual(["a-earlier", "z-later"]);
  });
});

describe("the retired mechanism is genuinely GONE, not merely unused", () => {
  it("planStyle.js exports neither bandForceOf nor EL_BANDS any more", () => {
    expect(Object.prototype.hasOwnProperty.call(PlanStyle, "bandForceOf")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(PlanStyle, "EL_BANDS")).toBe(false);
  });
  it("no live code path reads Z_LAYER, BUILDING_Z, bandForce, or EL_BANDS", () => {
    expect(PS_CODE).not.toMatch(/\bZ_LAYER\b/);
    expect(PS_CODE).not.toMatch(/\bEL_BANDS\b/);
    expect(PS_CODE).not.toMatch(/bandForceOf/);
    expect(SP_CODE).not.toMatch(/\bBUILDING_Z\b/);
    expect(SP_CODE).not.toMatch(/bandForceOf/);
    expect(SP_CODE).not.toMatch(/\bsetElBand\b/);
    expect(SP_CODE).not.toMatch(/drawElsZ/);
  });
  it("the retired panel control's testids and wording are gone from SitePlanner.jsx", () => {
    for (const dead of ["el-band-restore", "el-band-force", "el-band-force-back", "el-band-forced-note",
      "Force on top of everything", "Force underneath everything", "Use the normal layer order"]) {
      expect(SP_CODE, `must not contain "${dead}"`).not.toContain(dead);
    }
  });
  it("an element's Arrange peer set is the WHOLE plan, not a type/band-filtered subset", () => {
    expect(SP_CODE, "arrangeSel's element branch must not filter peers by zOrder")
      .not.toMatch(/peers = els\.filter\(\(e\) => zOrder\(e\) === band\)/);
    expect(SP_CODE).toMatch(/peers = els;/);
  });
  it("the dissolved road network no longer excludes a band-forced road (there is no band to force out of)", () => {
    expect(SP_CODE).not.toMatch(/isCenterlineRoad\(x\) && !x\.attachedTo && !bandForceOf\(x\)/);
    expect(SP_CODE).toMatch(/isCenterlineRoad\(x\) && !x\.attachedTo && !elHidden\(hiddenGroups, x\)/);
  });
});

describe("migrateBandForce — the one-time load migration for a legacy plan", () => {
  it("a plan with no bandForce anywhere is returned UNCHANGED (same reference)", () => {
    const plan = [el("a", "building", 0), el("b", "paving", 10)];
    expect(migrateBandForce(plan)).toBe(plan);
  });
  it("'front' lands above every plain element and the field is stripped", () => {
    const plan = [el("a", "building", 0), { ...el("b", "paving", 10), bandForce: "front" }, el("c", "road", 5)];
    const out = migrateBandForce(plan);
    const forced = out.find((e) => e.id === "b");
    expect(forced.bandForce).toBeUndefined();
    expect(forced.z).toBeGreaterThan(Math.max(...out.filter((e) => e.id !== "b").map((e) => e.z)));
  });
  it("'back' lands below every plain element and the field is stripped", () => {
    const plan = [el("a", "building", 0), { ...el("b", "pond", 10), bandForce: "back" }, el("c", "road", 5)];
    const out = migrateBandForce(plan);
    const forced = out.find((e) => e.id === "b");
    expect(forced.bandForce).toBeUndefined();
    expect(forced.z).toBeLessThan(Math.min(...out.filter((e) => e.id !== "b").map((e) => e.z)));
  });
  it("several forced elements keep their own relative (array) order among themselves", () => {
    const plan = [
      { ...el("first", "paving", 0), bandForce: "front" },
      el("mid", "building", 5),
      { ...el("second", "parking", 0), bandForce: "front" },
    ];
    const out = migrateBandForce(plan);
    const firstZ = out.find((e) => e.id === "first").z;
    const secondZ = out.find((e) => e.id === "second").z;
    expect(firstZ).toBeLessThan(secondZ);
  });
  it("an unforced element's z is left completely untouched", () => {
    const plan = [el("a", "building", 777), { ...el("b", "paving", 0), bandForce: "front" }];
    expect(migrateBandForce(plan).find((e) => e.id === "a").z).toBe(777);
  });
});

describe("withMissingZ — every freshly created element lands on top, never at the bottom", () => {
  it("an already-fully-z'd list is returned UNCHANGED (same reference)", () => {
    const plan = [el("a", "building", 0), el("b", "paving", -50)];
    expect(withMissingZ(plan)).toBe(plan);
  });
  it("a z-less element is stamped above the current max, real z's untouched", () => {
    const plan = [el("a", "building", 100), { id: "b", type: "paving" }];
    const out = withMissingZ(plan);
    expect(out.find((e) => e.id === "a").z).toBe(100);
    expect(out.find((e) => e.id === "b").z).toBe(100 + Z_GAP);
  });
  it("a batch of z-less elements keeps ITS OWN array order, never an id sort", () => {
    const plan = [el("host", "building", 0), { id: "z-court", type: "paving" }, { id: "a-trailer", type: "trailer" }];
    const out = withMissingZ(plan);
    expect(out.find((e) => e.id === "z-court").z).toBeLessThan(out.find((e) => e.id === "a-trailer").z);
  });
  it("matches nextZ's own convention for where a fresh top lands", () => {
    const plan = [el("a", "building", 500)];
    expect(withMissingZ([...plan, { id: "b", type: "road" }]).find((e) => e.id === "b").z).toBe(nextZ(plan));
  });
});
