/* NEW-8 — outline OPACITY and outline WIDTH are real per-element, standard-able props.
 * elStyle resolves element override → type default → built-in; `weight` (what every outline draw
 * reads) follows `strokeWidth`; `strokeWidthSet` is the EXPLICIT value or null (a road's curb stroke
 * is zoom-derived and may only be overridden by a width someone actually set). */
import { describe, it, expect, beforeEach } from "vitest";
import { elStyle, typeStyle, setAccountStyleDefaults, setPreviewStyleDefaults } from "../src/workspaces/site-planner/lib/planStyle.js";
import { applyTypeStandard } from "../src/workspaces/site-planner/lib/standardsApply.js";

beforeEach(() => { setAccountStyleDefaults({}); setPreviewStyleDefaults({}); });

describe("elStyle — outline props", () => {
  it("defaults: opacity 1, width = the type's built-in weight, nothing 'set'", () => {
    const st = elStyle({ id: "b", type: "building" }, {});
    expect(st.strokeOpacity).toBe(1);
    expect(st.strokeWidth).toBe(2);
    expect(st.weight).toBe(2);
    expect(st.strokeWidthSet).toBeNull();
    expect(elStyle({ id: "p", type: "paving" }, {}).weight).toBe(1.25);
  });
  it("a building with strokeWidth 4 / strokeOpacity 0.5 resolves exactly that (and weight follows)", () => {
    const st = elStyle({ id: "b", type: "building", strokeWidth: 4, strokeOpacity: 0.5 }, {});
    expect([st.strokeWidth, st.weight, st.strokeWidthSet, st.strokeOpacity]).toEqual([4, 4, 4, 0.5]);
  });
  it("a type default (Set as default / Standards → Colors) applies to elements with no override; the element wins over it", () => {
    const settings = { typeStyles: { building: { strokeWidth: 3, strokeOpacity: 0.8 } } };
    expect(elStyle({ id: "b", type: "building" }, settings)).toMatchObject({ strokeWidth: 3, weight: 3, strokeOpacity: 0.8, strokeWidthSet: 3 });
    expect(elStyle({ id: "b", type: "building", strokeWidth: 6 }, settings)).toMatchObject({ strokeWidth: 6, strokeOpacity: 0.8 });
    expect(typeStyle("building", settings).strokeWidth).toBe(3);
  });
  it("the Standards draft preview layer reaches the outline props too", () => {
    setPreviewStyleDefaults({ typeStyles: { building: { strokeWidth: 5 } } });
    expect(elStyle({ id: "b", type: "building" }, {}).weight).toBe(5);
  });
  it("Apply (retroactive) drops the per-element outline overrides so elements follow the default", () => {
    const els = [{ id: "a", type: "building", strokeWidth: 4 }, { id: "b", type: "building" }];
    const r = applyTypeStandard(els, "building", "strokeWidth");
    expect(r.count).toBe(1);
    expect(r.els[0]).toEqual({ id: "a", type: "building" });
  });
});
