import { describe, it, expect } from "vitest";
import { TYPE, typeStyle, elStyle, setAccountStyleDefaults } from "../src/workspaces/site-planner/lib/planStyle.js";
import { ELEMENT_DEFAULT_PAINT } from "../src/shared/theme/familyInk.js";

/* NEW-3 (Building panel v3) — palette A, "built materials". Only the DEFAULTS moved: a colour someone
 * set on an element, or on a plan ("Set as default" -> settings.typeStyles), or on the account, wins. */
const NEW = {
  paving: ["#d5d9de", "#8f99a3"],
  parking: ["#d6e5f2", "#7f9fbb"],
  road: ["#9eabb7", "#66737f"],
  sidewalk: ["#f7f6f2", "#b4b1a6"],
  trailer: ["#e3d4b2", "#b09a6c"],
  landscape: ["#bcd3a6", "#7f9a63"],
};

describe("palette A defaults", () => {
  for (const [type, [fill, stroke]] of Object.entries(NEW)) {
    it(`${type} default is ${fill} / ${stroke}`, () => {
      expect(TYPE[type].fill).toBe(fill);
      expect(TYPE[type].stroke).toBe(stroke);
    });
    it(`${type}: the familyInk mirror is identical`, () => {
      expect(ELEMENT_DEFAULT_PAINT[type]).toEqual([fill, stroke]);
    });
  }
  it("none of the retired colours remain as a default", () => {
    const all = JSON.stringify([TYPE, ELEMENT_DEFAULT_PAINT]).toLowerCase();
    for (const old of ["#d6d1c7", "#9a9384", "#cdd7dd", "#7d949e", "#b9b4a8", "#7c786d", "#eceae3"]) expect(all).not.toContain(old);
  });
});

describe("a colour the user set keeps winning over the new default", () => {
  it("an element's own fill / stroke", () => {
    const s = elStyle({ type: "paving", fill: "#123456", stroke: "#654321" }, {});
    expect(s.fill).toBe("#123456");
    expect(s.stroke).toBe("#654321");
    expect(elStyle({ type: "paving" }, {}).fill).toBe("#d5d9de");
  });
  it("a plan's 'Set as default' (settings.typeStyles) beats the built-in", () => {
    const settings = { typeStyles: { parking: { fill: "#abcdef" } } };
    expect(typeStyle("parking", settings).fill).toBe("#abcdef");
    expect(typeStyle("parking", settings).stroke).toBe("#7f9fbb"); // the key the plan did not set follows the new default
    expect(elStyle({ type: "parking" }, settings).fill).toBe("#abcdef");
  });
  it("an account default beats the built-in too", () => {
    setAccountStyleDefaults({ typeStyles: { road: { fill: "#222222" } } });
    try { expect(typeStyle("road", {}).fill).toBe("#222222"); } finally { setAccountStyleDefaults({}); }
    expect(typeStyle("road", {}).fill).toBe("#9eabb7");
  });
});
