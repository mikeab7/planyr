/* NEW-3 — Standards "Apply now" (retroactive) + the account/project scope ladder.
 *
 * The two families behave oppositely on purpose: parcels are STAMPED at creation, so applying
 * WRITES the value; elements resolve their type style at RENDER, so applying CLEARS the
 * per-element overrides that were winning over the default. */
import { describe, it, expect, beforeEach } from "vitest";
import {
  PARCEL_STD_KEYS, TYPE_STD_KEYS,
  applyParcelStandard, applyTypeStandard, parcelStandardImpact, typeStandardImpact, appliedLabel,
  applyAllStandards, allStandardsImpact, appliedObjectsLabel,
  EMPTY_STD_DRAFT, draftHasParcel, draftHasType, draftParcelValue, draftTypeValue,
  withParcelDraft, withTypeDraft, draftDirty, mergeDraftIntoSettings,
} from "../src/workspaces/site-planner/lib/standardsApply.js";
import {
  typeStyle, parcelDefaultStyle, standardScope, setAccountStyleDefaults, getAccountStyleDefaults,
  setPreviewStyleDefaults, setbackLineStyle, setbackDashArray, SETBACK_LINE,
} from "../src/workspaces/site-planner/lib/planStyle.js";
import { setStandardPref, getStandardPref, _normalizePrefs } from "../src/workspaces/site-planner/lib/userPrefs.js";

beforeEach(() => { setAccountStyleDefaults({}); setPreviewStyleDefaults({}); });

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
    expect(PARCEL_STD_KEYS).toEqual(["stroke", "weight", "dash", "fill", "fillOpacity", "sbStroke", "sbWeight", "sbDash"]);
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
    // `measureStyle` joined the shape with the measurement-standards item — additive, so an
    // older prefs row simply normalizes to an empty bag and nothing needs migrating.
    expect(_normalizePrefs(null).planStandards).toEqual({ parcelStyle: {}, typeStyles: {}, measureStyle: {} });
    expect(_normalizePrefs("nope").planStandards).toEqual({ parcelStyle: {}, typeStyles: {}, measureStyle: {} });
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

/* ---------------------------------------------------------------- NEW-1: the SETBACK line
 *
 * It had no controls at all — colour, weight and dash were hardcoded at the one place it was
 * drawn, while the parcel BOUNDARY beside it carried a full set of standards. These guards pin
 * the two halves that matter: the new keys round-trip through the retroactive Apply path, and a
 * plan that never set them renders EXACTLY as it did before (the upgrade must be invisible).
 */
describe("setback line standards", () => {
  it("an untouched parcel resolves to the OLD hardcoded look, byte for byte", () => {
    const s = setbackLineStyle({ id: "p1" }, "#b45309");
    expect(s.stroke).toBe("#b45309");   // PAL.setback, exactly as before
    expect(s.weight).toBe(1.25);
    expect(s.dash).toBe("7 6");
  });
  it("an empty / missing parcel is the same default (no crash on an unstyled ring)", () => {
    expect(setbackLineStyle(null, "#b45309")).toEqual({ stroke: "#b45309", weight: 1.25, dash: "7 6" });
    expect(setbackLineStyle({}, "#b45309").dash).toBe("7 6");
  });
  it("a per-parcel override wins over the theme default, key by key", () => {
    expect(setbackLineStyle({ sbStroke: "#ff0000" }, "#b45309").stroke).toBe("#ff0000");
    expect(setbackLineStyle({ sbWeight: 3 }, "#b45309").weight).toBe(3);
    expect(setbackLineStyle({ sbDash: "solid" }, "#b45309").dash).toBeUndefined();
    // a partial override leaves the other two at the default
    expect(setbackLineStyle({ sbStroke: "#ff0000" }, "#b45309").weight).toBe(SETBACK_LINE.weight);
  });
  it("the dash pattern scales with the weight, so a heavier line keeps its rhythm", () => {
    expect(setbackDashArray("dashed", 1.25)).toBe("7 6");
    expect(setbackDashArray("dashed", 2.5)).toBe("14 12");
    expect(setbackDashArray("dotted", 1.25)).toBe("1.25 3");
    expect(setbackDashArray("solid", 1.25)).toBeUndefined();
    expect(setbackDashArray(undefined, undefined)).toBe("7 6"); // unset === today's ring
  });
  it("is STAMPED onto a new parcel from the standards, exactly like the boundary style", () => {
    expect(parcelDefaultStyle({ parcelStyle: { sbStroke: "#123456", sbWeight: 2, sbDash: "dotted" } }))
      .toEqual({ sbStroke: "#123456", sbWeight: 2, sbDash: "dotted" });
  });
  it("stamps NOTHING when the standards match the built-in look — an upgraded plan gains no keys", () => {
    expect(parcelDefaultStyle({})).toEqual({});
    expect(parcelDefaultStyle({ parcelStyle: { sbWeight: SETBACK_LINE.weight, sbDash: SETBACK_LINE.dash } })).toEqual({});
  });
  it("follows the account default under the project's own (same ladder as the boundary)", () => {
    setAccountStyleDefaults({ parcelStyle: { sbStroke: "#aaaaaa", sbDash: "dotted" } });
    expect(parcelDefaultStyle({}).sbStroke).toBe("#aaaaaa");
    expect(parcelDefaultStyle({ parcelStyle: { sbStroke: "#bbbbbb" } }).sbStroke).toBe("#bbbbbb");
  });
  it("round-trips through the retroactive Apply path like any other parcel standard", () => {
    const list = [{ id: "a", points: [] }, { id: "b", points: [], sbStroke: "#ff0000" }];
    const one = applyParcelStandard(list, "sbStroke", "#ff0000");
    expect(one.count).toBe(1);                     // only the one that differed
    expect(one.parcels.every((p) => p.sbStroke === "#ff0000")).toBe(true);
    const all = applyAllStandards(list, [], { sbStroke: "#00ff00", sbWeight: 3, sbDash: "solid" }, []);
    expect(all.count).toBe(2);                     // DISTINCT objects, not 6 key hits
    expect(all.parcels[0]).toMatchObject({ sbStroke: "#00ff00", sbWeight: 3, sbDash: "solid" });
    expect(allStandardsImpact(all.parcels, [], { sbStroke: "#00ff00", sbWeight: 3, sbDash: "solid" }, [])).toBe(0);
  });
  it("applying an UNSET setback standard clears the key rather than storing a null", () => {
    const { parcels: out } = applyAllStandards([{ id: "a", sbStroke: "#ff0000" }], [], { sbStroke: null }, []);
    expect("sbStroke" in out[0]).toBe(false);
  });
});

/* ---------------------------------------------------------------- NEW-2: the PENDING DRAFT
 *
 * The footer's Project|All scope toggle is gone, replaced by three actions named outright. Once
 * "Save for this plan" is an explicit button, a field edit can no longer silently commit as the
 * plan default — so edits land in a draft and only a button stores them. These guards cover the
 * trap that model creates: an edit that is neither visible nor recoverable.
 */
describe("the Standards draft", () => {
  const committedParcel = (k) => ({ stroke: "#111111", weight: 2 })[k];
  const committedType = (t, k) => (t === "building" && k === "fill" ? "#f3ece1" : undefined);

  it("starts empty and reads straight through to what is committed", () => {
    expect(draftParcelValue(EMPTY_STD_DRAFT, "stroke", "#111111")).toBe("#111111");
    expect(draftHasParcel(EMPTY_STD_DRAFT, "stroke")).toBe(false);
    expect(draftDirty(EMPTY_STD_DRAFT, committedParcel, committedType)).toBe(false);
  });
  it("shows the pending value once a field is touched, without storing it", () => {
    const d = withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000" });
    expect(draftParcelValue(d, "stroke", "#111111")).toBe("#ff0000");
    expect(draftParcelValue(d, "weight", 2)).toBe(2);        // untouched keys still read committed
    expect(draftDirty(d, committedParcel, committedType)).toBe(true);
  });
  it("is NOT dirty when an edit lands back on the committed value — no permanent nag", () => {
    const d = withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000" });
    const back = withParcelDraft(d, { stroke: "#111111" });
    expect(draftHasParcel(back, "stroke")).toBe(true);       // still touched…
    expect(draftDirty(back, committedParcel, committedType)).toBe(false); // …but nothing to save
  });
  it("treats a null as a real pending change — clearing a standard is an edit", () => {
    const d = withParcelDraft(EMPTY_STD_DRAFT, { stroke: null });
    expect(draftParcelValue(d, "stroke", "#111111")).toBe(null);
    expect(draftDirty(d, committedParcel, committedType)).toBe(true);
  });
  it("carries element-type edits on the same footing", () => {
    const d = withTypeDraft(EMPTY_STD_DRAFT, "building", { fill: "#ff0000" });
    expect(draftHasType(d, "building", "fill")).toBe(true);
    expect(draftTypeValue(d, "building", "fill", "#f3ece1")).toBe("#ff0000");
    expect(draftTypeValue(d, "parking", "fill", "#cdd7dd")).toBe("#cdd7dd");
    expect(draftDirty(d, committedParcel, committedType)).toBe(true);
  });
  it("never mutates the draft it was handed (Discard restores by dropping it)", () => {
    const d = withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000" });
    const snapshot = JSON.parse(JSON.stringify(d));
    withParcelDraft(d, { weight: 4 });
    withTypeDraft(d, "building", { fill: "#000000" });
    expect(d).toEqual(snapshot);
    expect(EMPTY_STD_DRAFT).toEqual({ parcelStyle: {}, typeStyles: {}, measureStyle: {} });
  });

  describe("committing it into the plan (Save for this plan / the commit half of Apply)", () => {
    it("folds every pending key into settings", () => {
      const d = withTypeDraft(withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000", sbDash: "dotted" }), "building", { fill: "#00ff00" });
      const next = mergeDraftIntoSettings({ setback: 25, parcelStyle: { weight: 3 } }, d);
      expect(next.parcelStyle).toEqual({ weight: 3, stroke: "#ff0000", sbDash: "dotted" });
      expect(next.typeStyles).toEqual({ building: { fill: "#00ff00" } });
      expect(next.setback).toBe(25);   // untouched settings ride through
    });
    it("a null DELETES the stored key — cleared means 'follow the default', not 'stored null'", () => {
      const next = mergeDraftIntoSettings({ parcelStyle: { stroke: "#111111" }, typeStyles: { building: { fill: "#f00", stroke: "#0f0" } } },
        { parcelStyle: { stroke: null }, typeStyles: { building: { fill: null } } });
      expect("stroke" in next.parcelStyle).toBe(false);
      expect(next.typeStyles.building).toEqual({ stroke: "#0f0" });
    });
    it("drops a type bag that ends up empty, so settings never accumulate husks", () => {
      const next = mergeDraftIntoSettings({ typeStyles: { building: { fill: "#f00" } } }, { parcelStyle: {}, typeStyles: { building: { fill: null } } });
      expect("building" in next.typeStyles).toBe(false);
    });
    it("does not mutate the settings it was handed", () => {
      const settings = { parcelStyle: { stroke: "#111111" }, typeStyles: { building: { fill: "#f00" } } };
      const snapshot = JSON.parse(JSON.stringify(settings));
      mergeDraftIntoSettings(settings, withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000" }));
      expect(settings).toEqual(snapshot);
    });
    it("committing then re-checking leaves nothing dirty", () => {
      const d = withParcelDraft(EMPTY_STD_DRAFT, { stroke: "#ff0000" });
      const next = mergeDraftIntoSettings({}, d);
      expect(draftDirty(d, (k) => next.parcelStyle[k], () => undefined)).toBe(false);
    });
  });

  describe("previewing it (a draft changes what you SEE, never what gets STORED)", () => {
    it("an element type previews the pending colour without it being in settings", () => {
      setPreviewStyleDefaults({ typeStyles: { building: { fill: "#ff0000" } } });
      expect(typeStyle("building", {}).fill).toBe("#ff0000");
      expect(typeStyle("building", {}).stroke).toBe("#33302b");   // untouched key keeps the built-in
    });
    it("a null in the preview CLEARS back to the built-in instead of painting nothing", () => {
      setPreviewStyleDefaults({ typeStyles: { building: { fill: null } } });
      expect(typeStyle("building", { typeStyles: { building: { fill: "#00ff00" } } }).fill).toBe("#f3ece1");
    });
    it("does NOT reach parcelDefaultStyle — an uncommitted value can never be stamped into geometry", () => {
      setPreviewStyleDefaults({ typeStyles: {}, parcelStyle: { stroke: "#ff0000" } });
      expect(parcelDefaultStyle({})).toEqual({});
    });
  });
});
