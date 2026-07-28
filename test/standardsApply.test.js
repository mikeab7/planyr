/* NEW-3 — Standards "Apply now" (retroactive) + the account/project scope ladder.
 *
 * The two families behave oppositely on purpose: parcels are STAMPED at creation, so applying
 * WRITES the value; elements resolve their type style at RENDER, so applying CLEARS the
 * per-element overrides that were winning over the default. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PARCEL_STD_KEYS, TYPE_STD_KEYS,
  applyParcelStandard, applyTypeStandard, parcelStandardImpact, typeStandardImpact, appliedLabel,
} from "../src/workspaces/site-planner/lib/standardsApply.js";
import {
  typeStyle, parcelDefaultStyle, standardScope, setAccountStyleDefaults, getAccountStyleDefaults,
} from "../src/workspaces/site-planner/lib/planStyle.js";
import { setStandardPref, getStandardPref, _normalizePrefs } from "../src/workspaces/site-planner/lib/userPrefs.js";

beforeEach(() => setAccountStyleDefaults({}));

const parcels = () => ([
  { id: "p1", points: [], stroke: "#111111", weight: 2 },
  { id: "p2", points: [], stroke: "#222222", weight: 2 },
  { id: "p3", points: [], stroke: "#111111", weight: 4 },
]);
const els = () => ([
  { id: "e1", type: "building", fill: "#aaaaaa" },   // per-element override
  { id: "e2", type: "building" },                    // follows the type default
  { id: "e3", type: "parking", fill: "#bbbbbb" },    // a different type
]);

describe("key sets", () => {
  it("cover the standards the owner named (outline color, line weight, fill, dash, …)", () => {
    expect(PARCEL_STD_KEYS).toEqual(["stroke", "weight", "dash", "fill", "fillOpacity"]);
    expect(TYPE_STD_KEYS).toEqual(["fill", "stroke"]);
  });
});

describe("applyParcelStandard — retroactive write", () => {
  it("pushes the value onto EVERY existing parcel", () => {
    const { parcels: out, count } = applyParcelStandard(parcels(), "stroke", "#ff0000");
    expect(out.every((p) => p.stroke === "#ff0000")).toBe(true);
    expect(count).toBe(3); // none of the three already carried #ff0000
  });
  it("counts only what actually changed, so the toast never overstates", () => {
    const list = [{ id: "a", stroke: "#ff0000" }, { id: "b", stroke: "#000000" }];
    expect(applyParcelStandard(list, "stroke", "#ff0000").count).toBe(1);
  });
  it("is a no-op (same array reference) when everything already matches", () => {
    const list = parcels();
    const res = applyParcelStandard(list, "weight", 2);
    expect(res.count).toBe(1);            // p3 is weight 4
    const again = applyParcelStandard(res.parcels, "weight", 2);
    expect(again.count).toBe(0);
    expect(again.parcels).toBe(res.parcels);
  });
  it("a null value REMOVES the key — back to the theme built-in, not a stored null", () => {
    const { parcels: out } = applyParcelStandard(parcels(), "stroke", null);
    expect("stroke" in out[0]).toBe(false);
  });
  it("never mutates the input list", () => {
    const list = parcels();
    applyParcelStandard(list, "stroke", "#ff0000");
    expect(list[0].stroke).toBe("#111111");
  });
});

describe("applyTypeStandard — clear the overrides that outrank the default", () => {
  it("drops the per-element override on that type only", () => {
    const { els: out, count } = applyTypeStandard(els(), "building", "fill");
    expect(count).toBe(1);
    expect("fill" in out[0]).toBe(false);   // building override cleared
    expect(out[2].fill).toBe("#bbbbbb");    // parking untouched
  });
  it("is a no-op when no element of that type overrides the key", () => {
    const list = els();
    const res = applyTypeStandard(list, "building", "stroke");
    expect(res.count).toBe(0);
    expect(res.els).toBe(list);
  });
});

describe("impact counts — what the Apply chip shows before you click", () => {
  it("matches what the apply would actually change", () => {
    const list = parcels();
    expect(parcelStandardImpact(list, "stroke", "#ff0000")).toBe(applyParcelStandard(list, "stroke", "#ff0000").count);
    const e = els();
    expect(typeStandardImpact(e, "building", "fill")).toBe(applyTypeStandard(e, "building", "fill").count);
  });
  it("is zero when there is nothing to do (chip disabled)", () => {
    expect(typeStandardImpact(els(), "pond", "fill")).toBe(0);
  });
});

describe("appliedLabel", () => {
  it("pluralizes honestly", () => {
    expect(appliedLabel(1, "parcel")).toBe("Applied to 1 parcel");
    expect(appliedLabel(12, "parcel")).toBe("Applied to 12 parcels");
  });
});

describe("the scope ladder: built-in < account < project < per-object", () => {
  it("standardScope names where a value comes from", () => {
    expect(standardScope("#111111", "#222222")).toBe("project");
    expect(standardScope(undefined, "#222222")).toBe("all");
    expect(standardScope(undefined, undefined)).toBe("builtin");
    expect(standardScope(null, null)).toBe("builtin");
  });
  it("an ACCOUNT default shows on a project that hasn't overridden it", () => {
    setAccountStyleDefaults({ typeStyles: { building: { fill: "#123456" } } });
    expect(typeStyle("building", {}).fill).toBe("#123456");
  });
  it("a PROJECT default outranks the account default", () => {
    setAccountStyleDefaults({ typeStyles: { building: { fill: "#123456" } } });
    expect(typeStyle("building", { typeStyles: { building: { fill: "#abcdef" } } }).fill).toBe("#abcdef");
  });
  it("with neither set, the built-in still wins nothing away", () => {
    expect(typeStyle("building", {}).fill).toBe("#f3ece1");
  });
  it("parcelDefaultStyle stamps the account default onto a new parcel", () => {
    setAccountStyleDefaults({ parcelStyle: { stroke: "#0000ff", weight: 3 } });
    expect(parcelDefaultStyle({})).toEqual({ stroke: "#0000ff", weight: 3 });
  });
  it("…and a project value still wins on that plan", () => {
    setAccountStyleDefaults({ parcelStyle: { stroke: "#0000ff" } });
    expect(parcelDefaultStyle({ parcelStyle: { stroke: "#00ff00" } }).stroke).toBe("#00ff00");
  });
  it("a project explicitly turning fill OFF beats an account fill", () => {
    setAccountStyleDefaults({ parcelStyle: { fill: "#5b6650" } });
    expect(parcelDefaultStyle({ parcelStyle: { fill: null } }).fill).toBeUndefined();
  });
  it("setAccountStyleDefaults copies — a later mutation of the caller's object can't leak in", () => {
    const src = { parcelStyle: { stroke: "#0000ff" } };
    setAccountStyleDefaults(src);
    src.parcelStyle.stroke = "#ff0000";
    expect(getAccountStyleDefaults().parcelStyle.stroke).toBe("#0000ff");
  });
});

describe("account preference edits (pure)", () => {
  it("sets and reads a parcel standard", () => {
    const p = setStandardPref(_normalizePrefs(null), "parcelStyle", "stroke", "#0000ff");
    expect(getStandardPref(p, "parcelStyle", "stroke")).toBe("#0000ff");
  });
  it("sets and reads a per-type standard", () => {
    const p = setStandardPref(_normalizePrefs(null), "typeStyles", "fill", "#0000ff", "building");
    expect(getStandardPref(p, "typeStyles", "fill", "building")).toBe("#0000ff");
    expect(getStandardPref(p, "typeStyles", "fill", "parking")).toBeUndefined();
  });
  it("a null value REMOVES the account default (back to built-in), and prunes an empty type bag", () => {
    let p = setStandardPref(_normalizePrefs(null), "typeStyles", "fill", "#0000ff", "building");
    p = setStandardPref(p, "typeStyles", "fill", null, "building");
    expect(getStandardPref(p, "typeStyles", "fill", "building")).toBeUndefined();
    expect(p.planStandards.typeStyles.building).toBeUndefined();
  });
  it("never mutates the prefs it was given", () => {
    const p0 = _normalizePrefs({ planStandards: { parcelStyle: { stroke: "#111111" } } });
    setStandardPref(p0, "parcelStyle", "stroke", "#222222");
    expect(p0.planStandards.parcelStyle.stroke).toBe("#111111");
  });
  it("normalizes a missing / garbage prefs blob into the empty shape", () => {
    expect(_normalizePrefs(null).planStandards).toEqual({ parcelStyle: {}, typeStyles: {} });
    expect(_normalizePrefs("nope").planStandards).toEqual({ parcelStyle: {}, typeStyles: {} });
  });
});
