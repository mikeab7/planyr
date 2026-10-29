/* NEW-1 (FEMA flood layer slid at twice the pan speed) — the two GIS hosts INSIDE the plan SVG must cancel the plan group's own
 * live transform, because they already carry the basemap wrapper's gesture transform themselves.
 *
 * CLAIM 1: the composition  svg regShift → group `translate(tx ty) scale(k)` → anchorInverseCss → (mirrored wrap transform)  puts a
 *   point exactly where the wrap transform alone would — for a pan, a zoom, both, and with a registration shift. (Before the fix the
 *   host was `translate(-reg)` only, so the group's translate was applied on top of the mirrored one: 2× the pan.)
 * CLAIM 2: nothing to cancel → no transform at all (rest and export render byte-for-byte what they did).
 * CLAIM 3 (source guard): both foreignObject hosts in SitePlanner.jsx take their transform from anchorInverseCss — a third host
 *   copied from them keeps the cancel, and nobody reverts one to the bare registration translate.
 * MUTATION CHECKS: dropping the scale term fails CLAIM 1's zoom rows; dropping the translate term fails every pan row; reverting a
 *   host to `translate(-reg)` fails CLAIM 3. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { anchorTransform, anchorInverseCss } from "../src/shared/viewport/viewAnchor.js";
import { plannerSource } from "./helpers/plannerSource.js";

const anchor = { ppf: 0.35, offX: 60, offY: 60 };
// parse the CSS the helper emits and apply it right-to-left to a point (what the browser does)
function applyCss(css, p) {
  if (!css) return p;
  const ops = [...css.matchAll(/(scale|translate)\(([^)]*)\)/g)].map((m) => ({ op: m[1], v: m[2].split(",").map((x) => parseFloat(x)) }));
  let { x, y } = p;
  for (const o of ops.reverse()) {
    if (o.op === "scale") { x *= o.v[0]; y *= o.v[o.v.length - 1]; } else { x += o.v[0]; y += o.v[1]; }
  }
  return { x, y };
}
const group = (t, p) => ({ x: t.k * p.x + t.tx, y: t.k * p.y + t.ty });

describe("anchorInverseCss — the in-SVG GIS hosts follow the basemap, not the plan group", () => {
  const cases = [
    ["pan", { ppf: 0.35, offX: 300, offY: 150 }],
    ["pan, negative", { ppf: 0.35, offX: -120.5, offY: 33.25 }],
    ["zoom in", { ppf: 0.35 * 1.4, offX: 40, offY: 80 }],
    ["zoom out + pan", { ppf: 0.35 / 1.6, offX: -300, offY: 210 }],
  ];
  for (const [name, view] of cases) for (const reg of [[0, 0], [-0.48, 0.22], [1, -1]]) {
    it(`${name} · reg ${reg}: net displacement is the wrap's alone`, () => {
      const t = anchorTransform(view, anchor);
      const css = anchorInverseCss(t, reg[0], reg[1]);
      for (const p of [{ x: 0, y: 0 }, { x: 612, y: 340 }, { x: 1100, y: 700 }]) {
        const out = applyCss(css, p);                       // host-local → undo reg + group
        const screen = { x: reg[0] + group(t, out).x, y: reg[1] + group(t, out).y }; // svg reg translate, then the group
        expect(screen.x).toBeCloseTo(p.x, 2);
        expect(screen.y).toBeCloseTo(p.y, 2);
      }
    });
  }
  it("a bare registration shift still cancels (the pre-fix behaviour, unchanged when no gesture is armed)", () => {
    expect(anchorInverseCss(null, 0.5, -0.25)).toBe("translate(-0.5px, 0.25px)");
  });
  it("nothing to cancel → no transform", () => {
    expect(anchorInverseCss(null, 0, 0)).toBeUndefined();
    expect(anchorInverseCss({ k: 1, tx: 0, ty: 0 }, 0, 0)).toBeUndefined();
  });
});

describe("the two in-SVG hosts use it", () => {
  const src = plannerSource();
  it("both foreignObject hosts take anchorInverseCss with an explicit transform origin", () => {
    const n = (src.match(/transformOrigin: "0 0",\s*\n\s*transform: anchorInverseCss\(viewT, regShift\.dx, regShift\.dy\)/g) || []).length;
    expect(n).toBe(2);
  });
  it("neither is back to the bare registration translate", () => {
    expect(src).not.toMatch(/transform: \(regShift\.dx \|\| regShift\.dy\) \? `translate\(\$\{-regShift\.dx\}px/);
  });
});
