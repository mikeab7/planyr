/* Text box / callout outline weight/dash/opacity + fill opacity (B1652704/B1652705, "NEW-1"/"NEW-2").
 *
 * BACK-COMPAT IS THE ACCEPTANCE TEST for NEW-1/NEW-2: an existing saved text box/callout has no
 * `weight`, `dash`, `opacity` or `fillOpacity` at all. This suite pins the exact values the box has
 * always rendered at (measured off the pre-existing hardcoded render — a 1.4px solid, fully opaque
 * border) as the resolver's fallback, so a regression that quietly changes the fallback (e.g. to the
 * polygon default of 2) fails here rather than showing up as a silently thicker border on every plan
 * ever saved.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CALLOUT_LINE, CALLOUT_STD_KEYS, calloutStyle } from "../src/workspaces/site-planner/lib/calloutStyle.js";
import { FAMILY_DEFAULT_INK, CALLOUT_DEFAULT_FILL } from "../src/shared/theme/familyInk.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("the built-in outline/fill look is EXACTLY the pre-styling render (an untouched box is unchanged)", () => {
  it("an unstyled callout resolves to weight 1.4 / solid / fully opaque outline and fill — NOT the polygon default of 2", () => {
    const st = calloutStyle({});
    expect(st.weight).toBe(1.4);
    expect(st.weight).not.toBe(2); // the polygon/markup/measurement default — deliberately NOT reused here
    expect(st.dash).toBe("solid");
    expect(st.opacity).toBe(1);
    expect(st.fillOpacity).toBe(1);
    expect(st).toMatchObject(CALLOUT_LINE);
  });
  it("the pre-existing text/fill/outline colour + padding/spacing defaults are untouched by this item", () => {
    const st = calloutStyle({});
    expect(st).toMatchObject({ size: 13, color: "#1f2937", fill: "#fffbe8", stroke: "#1f2937", align: "center", padX: 14, padY: 8, lineHeight: 1.3 });
  });
  it("an invalid/zero weight falls back to the built-in, never to 0 or NaN", () => {
    expect(calloutStyle({ weight: 0 }).weight).toBe(CALLOUT_LINE.weight);
    expect(calloutStyle({ weight: -1 }).weight).toBe(CALLOUT_LINE.weight);
    expect(calloutStyle({ weight: NaN }).weight).toBe(CALLOUT_LINE.weight);
  });
});

describe("the default ink/fill are wired to the shared token table, not a parallel copy (B1652707)", () => {
  it("calloutStyle resolves an unstyled callout's colour/stroke to FAMILY_DEFAULT_INK.callout", () => {
    expect(calloutStyle({}).color).toBe(FAMILY_DEFAULT_INK.callout);
    expect(calloutStyle({}).stroke).toBe(FAMILY_DEFAULT_INK.callout);
  });
  it("calloutStyle resolves an unstyled callout's fill to CALLOUT_DEFAULT_FILL", () => {
    expect(calloutStyle({}).fill).toBe(CALLOUT_DEFAULT_FILL);
  });
});

describe("NEW-1/NEW-2: every callout round-trips a full style through save and reload", () => {
  it("styled → serialized → reloaded resolves identically", () => {
    const FULL = { weight: 3, dash: "dashed", opacity: 0.6, fillOpacity: 0.25 };
    const drawn = { id: "co-1", box: { x: 0, y: 0 }, tip: { x: 10, y: 10 }, text: "hi", ...FULL };
    const reloaded = JSON.parse(JSON.stringify(drawn));
    CALLOUT_STD_KEYS.forEach((k) => expect(reloaded[k]).toEqual(FULL[k]));
    expect(calloutStyle(reloaded)).toEqual(calloutStyle(drawn));
    expect(calloutStyle(drawn)).toMatchObject(FULL);
  });
  it("weight/dash/opacity may be set independently — no coupling in the resolver", () => {
    expect(calloutStyle({ weight: 4 })).toMatchObject({ weight: 4, dash: "solid", opacity: 1, fillOpacity: 1 });
    expect(calloutStyle({ dash: "dotted" })).toMatchObject({ weight: 1.4, dash: "dotted", opacity: 1, fillOpacity: 1 });
    expect(calloutStyle({ opacity: 0.3 })).toMatchObject({ weight: 1.4, dash: "solid", opacity: 0.3, fillOpacity: 1 });
    expect(calloutStyle({ fillOpacity: 0.3 })).toMatchObject({ weight: 1.4, dash: "solid", opacity: 1, fillOpacity: 0.3 });
  });
});

describe("NEW-1: THE LEADER LINE IS PART OF THE OUTLINE — the render reads ONE resolved style for both", () => {
  // Source guard, not a render test (this codebase's canvas draw logic is tested this way — see
  // bugHuntGuards.test.js): the box border and every leader segment/arrowhead must read the SAME
  // `st.weight`/`leaderDash`(built from `st.dash`/`st.weight`)/`st.opacity`, never a second,
  // independently-hardcoded leader value (the pre-fix render hardcoded the box at 1.4 and the
  // leader at 1.6 — two different numbers for what is conceptually one outline).
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
  it("the box border reads st.weight/leaderDash/st.opacity/st.fillOpacity — not a hardcoded literal", () => {
    expect(src).toMatch(/fill=\{st\.fill\} fillOpacity=\{st\.fillOpacity\} stroke=\{border\} strokeWidth=\{st\.weight\} strokeDasharray=\{leaderDash\} strokeOpacity=\{st\.opacity\}/);
    expect(src).not.toMatch(/stroke=\{border\} strokeWidth=\{1\.4\}/);
  });
  it("both leader segments read st.weight/leaderDash/st.opacity — the same object the box reads", () => {
    const stubs = src.match(/<line data-testid=\{`callout-leader-stub-\$\{c\.id\}-\$\{i\}`\}[^/]*\/>/g) || [];
    const runs = src.match(/<line data-testid=\{`callout-leader-run-\$\{c\.id\}-\$\{i\}`\}[^/]*\/>/g) || [];
    expect(stubs.length).toBe(1);
    expect(runs.length).toBe(1);
    for (const line of [...stubs, ...runs]) {
      expect(line).toMatch(/strokeWidth=\{st\.weight\}/);
      expect(line).toMatch(/strokeDasharray=\{leaderDash\}/);
      expect(line).toMatch(/strokeOpacity=\{st\.opacity\}/);
      expect(line).not.toMatch(/strokeWidth=\{1\.6\}/); // the old, separately-hardcoded leader weight
    }
  });
  it("leaderDash is derived from the SAME st.dash/st.weight the box border uses — no second dash list", () => {
    expect(src).toMatch(/const leaderDash = dashArray\(st\.dash, st\.weight\);/);
  });
});
