/* NEW-3 — Standards "Apply now" (retroactive) + the account/project scope ladder.
 *
 * The two families behave oppositely on purpose: parcels are STAMPED at creation, so applying
 * WRITES the value; elements resolve their type style at RENDER, so applying CLEARS the
 * per-element overrides that were winning over the default. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PARCEL_STD_KEYS, TYPE_STD_KEYS,
  applyParcelStandard, applyTypeStandard, parcelStandardImpact, typeStandardImpact, appliedLabel,
  applyAllStandards, allStandardsImpact, appliedObjectsLabel, derivedPanelScope,
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

/* ------------------------------------------------ ONE Apply for the whole panel (owner rule)
 *
 * "I didn't mean that for every individual setting. I meant all, like, to apply them to the
 * project… not each individual setting. It's taking up way too much space as is."
 *
 * So: one Apply that pushes EVERY standard onto what's already drawn, in one undo frame, reported
 * in distinct OBJECTS — a parcel whose outline colour and weight both change is one object, not two.
 */
describe("applyAllStandards — every standard at once, counted in objects", () => {
  const parcelValues = { stroke: "#0000ff", weight: 3, dash: "dashed", fill: null, fillOpacity: null };

  it("writes every parcel key and clears every element override in ONE pass", () => {
    const parcels = [
      { id: "p1", stroke: "#ff0000", weight: 2 },
      { id: "p2", stroke: "#0000ff", weight: 3, dash: "dashed" },   // already matches
    ];
    const els = [
      { id: "e1", type: "building", fill: "#123456", stroke: "#654321" },
      { id: "e2", type: "building" },                                // no override to clear
      { id: "e3", type: "pond", fill: "#abcdef" },                   // type not in the list
    ];
    const res = applyAllStandards(parcels, els, parcelValues, ["building"]);
    expect(res.parcels[0]).toEqual({ id: "p1", stroke: "#0000ff", weight: 3, dash: "dashed" });
    expect(res.parcels[1]).toBe(parcels[1]);                         // untouched row keeps identity
    expect(res.els[0]).toEqual({ id: "e1", type: "building" });
    expect(res.els[2]).toBe(els[2]);
    expect(res.count).toBe(2);                                       // p1 + e1 — DISTINCT objects
  });

  it("counts an object ONCE even when several standards change it (no inflated toast)", () => {
    const parcels = [{ id: "p1", stroke: "#ff0000", weight: 2, dash: "solid" }];
    expect(applyAllStandards(parcels, [], parcelValues, []).count).toBe(1);
  });

  it("nothing to do → same array references, count 0, so the Apply chip stays disabled", () => {
    const parcels = [{ id: "p1", stroke: "#0000ff", weight: 3, dash: "dashed" }];
    const els = [{ id: "e1", type: "building" }];
    const res = applyAllStandards(parcels, els, parcelValues, ["building"]);
    expect(res.count).toBe(0);
    expect(res.parcels).toBe(parcels);
    expect(res.els).toBe(els);
    expect(allStandardsImpact(parcels, els, parcelValues, ["building"])).toBe(0);
  });

  it("the impact count is exactly what an Apply would change", () => {
    const parcels = [{ id: "p1", stroke: "#ff0000" }, { id: "p2", stroke: "#00ff00" }];
    const els = [{ id: "e1", type: "building", fill: "#111111" }];
    expect(allStandardsImpact(parcels, els, parcelValues, ["building"]))
      .toBe(applyAllStandards(parcels, els, parcelValues, ["building"]).count);
  });

  it("a key absent from the values bag is left alone (an unset standard doesn't wipe anything)", () => {
    const parcels = [{ id: "p1", stroke: "#ff0000", weight: 2 }];
    const res = applyAllStandards(parcels, [], { stroke: "#0000ff" }, []);
    expect(res.parcels[0]).toEqual({ id: "p1", stroke: "#0000ff", weight: 2 });
  });

  it("handles empty/missing inputs without throwing", () => {
    expect(applyAllStandards(undefined, undefined, {}, []).count).toBe(0);
  });

  it("says OBJECTS, because it spans parcels AND elements", () => {
    expect(appliedObjectsLabel(1)).toBe("Applied to 1 object");
    expect(appliedObjectsLabel(12)).toBe("Applied to 12 objects");
  });
});

describe("derivedPanelScope — collapsing per-key scopes must MOVE nothing", () => {
  it("reports All when any standard already lives on the account", () => {
    expect(derivedPanelScope(["project", "builtin", "all"])).toBe("all");
  });
  it("reports Project when none does", () => {
    expect(derivedPanelScope(["project", "builtin", "builtin"])).toBe("project");
    expect(derivedPanelScope([])).toBe("project");
    expect(derivedPanelScope()).toBe("project");
  });
  it("is a READ, never a write — an account-scope default a user already has is not demoted", () => {
    // The hazard this exists for: the panel-level control must not retroactively pull an
    // account-wide default back onto one plan just because the UI collapsed. Nothing here
    // returns a mutation; the caller only renders the value.
    const scopes = ["all", "project"];
    const snapshot = [...scopes];
    derivedPanelScope(scopes);
    expect(scopes).toEqual(snapshot);
  });
});
