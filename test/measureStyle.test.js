/* Measurement STYLE + label-reveal threshold (NEW-1 / NEW-2).
 *
 * The three things these guard, in the owner's words:
 *   NEW-1  "I should have the same optionality for any measurement tool or shape that I have for
 *           any other shape" — every mode round-trips a full style, and a new measurement is born
 *           with the Standards defaults the way a parcel is.
 *   NEW-1  the ONE deliberate exception: the uncalibrated amber warning still overrides a user
 *           colour, because it is a correctness signal and not decoration.
 *   NEW-2  "add an option to where I can edit the level of zoom to where the label shows up" —
 *           set, cleared, inherited from Standards, and always overridden by selection.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  MEASURE_LINE, MEASURE_WARN_COLOR, MEASURE_STD_KEYS, MEASURE_SEL_WEIGHT_BUMP, MEASURE_SEL_FILL_BUMP,
  measureStyle, measureDefaultStyle, measureStdValue, setAccountMeasureDefaults, getAccountMeasureDefaults,
  measureLabelThreshold, measureLabelVisible, hasLabelThreshold, zoomBandLabel, labelRevealNote,
} from "../src/workspaces/site-planner/lib/measureStyle.js";
import {
  MEASURE_STD_KEYS as APPLY_KEYS, applyMeasureStandard, applyAllStandards,
  EMPTY_STD_DRAFT, withMeasureDraft, draftMeasureValue, draftDirty, mergeDraftIntoSettings,
} from "../src/workspaces/site-planner/lib/standardsApply.js";

const ACCENT = "#f97316";
const MODES = ["line", "polyline", "area", "count"];

beforeEach(() => setAccountMeasureDefaults({}));

describe("the built-in look is EXACTLY the pre-styling render (an untouched plan is unchanged)", () => {
  it("an unstyled measurement resolves to accent / weight 1.5 / solid / 10% fill", () => {
    const st = measureStyle({}, { accent: ACCENT });
    expect(st).toMatchObject({ stroke: ACCENT, fill: ACCENT, weight: 1.5, dash: "solid", fillOpacity: 0.1, warn: false });
  });
  it("selection bumps weight and fill opacity by the historic amounts", () => {
    const st = measureStyle({}, { accent: ACCENT, selected: true });
    expect(st.weight).toBe(MEASURE_LINE.weight + MEASURE_SEL_WEIGHT_BUMP); // 1.5 → 2.5
    expect(st.fillOpacity).toBeCloseTo(MEASURE_LINE.fillOpacity + MEASURE_SEL_FILL_BUMP, 6); // 0.10 → 0.16
  });
  it("fill follows the line until a separate fill colour is set", () => {
    expect(measureStyle({ stroke: "#123456" }, { accent: ACCENT }).fill).toBe("#123456");
    expect(measureStyle({ stroke: "#123456", fill: "#abcdef" }, { accent: ACCENT }).fill).toBe("#abcdef");
  });
});

describe("NEW-1: every mode round-trips a FULL style through save and reload", () => {
  // A measurement persists as a whole object (elementRows explodes `data: el`), so a save/reload
  // is a structural clone — this asserts the resolver reads back every key it wrote, per mode.
  const FULL = { stroke: "#0ea5e9", weight: 3, dash: "dashed", fill: "#f43f5e", fillOpacity: 0.42, labelPpf: 1.25 };
  for (const mode of MODES) {
    it(`${mode}: styled → serialized → reloaded resolves identically`, () => {
      const drawn = { id: `m-${mode}`, mode, pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], ...FULL };
      const reloaded = JSON.parse(JSON.stringify(drawn));
      MEASURE_STD_KEYS.forEach((k) => expect(reloaded[k]).toEqual(FULL[k]));
      const a = measureStyle(drawn, { accent: ACCENT });
      const b = measureStyle(reloaded, { accent: ACCENT });
      expect(b).toEqual(a);
      expect(b).toMatchObject({ stroke: "#0ea5e9", weight: 3, dash: "dashed", fill: "#f43f5e", fillOpacity: 0.42 });
      // and NEW-2's threshold survives the trip on every mode, not just area
      expect(measureLabelThreshold(reloaded, {}, 0.18)).toBe(1.25);
    });
  }
  it("the style key list the panel edits and the one Standards applies are the SAME list", () => {
    expect(APPLY_KEYS).toEqual(MEASURE_STD_KEYS);
  });
});

describe("NEW-1: the uncalibrated amber still WINS over a user colour", () => {
  it("overrides both the line and the fill, and reports warn", () => {
    const m = { stroke: "#0ea5e9", fill: "#f43f5e" };
    const st = measureStyle(m, { accent: ACCENT, uncalibrated: true });
    expect(st.stroke).toBe(MEASURE_WARN_COLOR);
    expect(st.fill).toBe(MEASURE_WARN_COLOR);
    expect(st.warn).toBe(true);
  });
  it("does not DESTROY the user's colour — it comes back once the sheet is calibrated", () => {
    const m = { stroke: "#0ea5e9" };
    expect(measureStyle(m, { accent: ACCENT, uncalibrated: true }).stroke).toBe(MEASURE_WARN_COLOR);
    expect(measureStyle(m, { accent: ACCENT, uncalibrated: false }).stroke).toBe("#0ea5e9");
  });
  it("still overrides while selected (the bump changes weight, never the warn colour)", () => {
    const st = measureStyle({ stroke: "#0ea5e9" }, { accent: ACCENT, uncalibrated: true, selected: true });
    expect(st.stroke).toBe(MEASURE_WARN_COLOR);
    expect(st.weight).toBe(MEASURE_LINE.weight + MEASURE_SEL_WEIGHT_BUMP);
  });
});

describe("NEW-1: a new measurement is born with the Standards defaults (the parcel mechanic)", () => {
  it("stamps only what the user actually customized", () => {
    expect(measureDefaultStyle({})).toEqual({});
    expect(measureDefaultStyle({ measureStyle: { stroke: "#0ea5e9" } })).toEqual({ stroke: "#0ea5e9" });
  });
  it("a value equal to the built-in is NOT stamped (an untouched plan gains no keys)", () => {
    expect(measureDefaultStyle({ measureStyle: { weight: MEASURE_LINE.weight, dash: MEASURE_LINE.dash } })).toEqual({});
  });
  it("fill opacity rides along only when a fill colour is set", () => {
    expect(measureDefaultStyle({ measureStyle: { fillOpacity: 0.5 } })).toEqual({});
    expect(measureDefaultStyle({ measureStyle: { fill: "#abcdef", fillOpacity: 0.5 } })).toEqual({ fill: "#abcdef", fillOpacity: 0.5 });
  });
  it("a stamped measurement then resolves to what Standards asked for, in every mode", () => {
    const settings = { measureStyle: { stroke: "#16a34a", weight: 2.5, dash: "dotted", fill: "#fde047", fillOpacity: 0.3 } };
    for (const mode of MODES) {
      const born = { id: `m${mode}`, mode, pts: [], ...measureDefaultStyle(settings) };
      expect(measureStyle(born, { accent: ACCENT })).toMatchObject({
        stroke: "#16a34a", weight: 2.5, dash: "dotted", fill: "#fde047", fillOpacity: 0.3,
      });
    }
  });
  it("the ladder is built-in < account < project", () => {
    setAccountMeasureDefaults({ stroke: "#111111", weight: 4 });
    expect(getAccountMeasureDefaults()).toEqual({ stroke: "#111111", weight: 4 });
    expect(measureStdValue({}, "stroke")).toBe("#111111");
    expect(measureStdValue({ measureStyle: { stroke: "#222222" } }, "stroke")).toBe("#222222");
    expect(measureDefaultStyle({ measureStyle: { stroke: "#222222" } })).toEqual({ stroke: "#222222", weight: 4 });
  });
});

describe("NEW-2: the label reveal threshold", () => {
  const FLOOR = 0.18;
  it("SET — a measurement's own threshold wins", () => {
    expect(measureLabelThreshold({ labelPpf: 1.2 }, {}, FLOOR)).toBe(1.2);
    expect(hasLabelThreshold({ labelPpf: 1.2 }, {})).toBe(true);
  });
  it("CLEARED — dropping it falls back to the global floor", () => {
    expect(measureLabelThreshold({}, {}, FLOOR)).toBe(FLOOR);
    expect(measureLabelThreshold({ labelPpf: null }, {}, FLOOR)).toBe(FLOOR);
    expect(hasLabelThreshold({}, {})).toBe(false);
  });
  it("INHERITED — with no override it follows the Standards default", () => {
    const settings = { measureStyle: { labelPpf: 0.9 } };
    expect(measureLabelThreshold({}, settings, FLOOR)).toBe(0.9);
    expect(hasLabelThreshold({}, settings)).toBe(true);
    // and an own value still beats the Standards default
    expect(measureLabelThreshold({ labelPpf: 3 }, settings, FLOOR)).toBe(3);
  });
  it("a survey-scale note can hide while a headline area stays visible (the driving case)", () => {
    const note = { labelPpf: 2 }, headline = { labelPpf: 0.05 };
    expect(measureLabelVisible(note, 0.35, { globalFloor: FLOOR })).toBe(false);
    expect(measureLabelVisible(headline, 0.35, { globalFloor: FLOOR })).toBe(true);
    expect(measureLabelVisible(note, 2.5, { globalFloor: FLOOR })).toBe(true);
  });
  it("SELECTION always wins, whatever the threshold says", () => {
    expect(measureLabelVisible({ labelPpf: 99 }, 0.01, { globalFloor: FLOOR, selected: true })).toBe(true);
    expect(measureLabelVisible({ labelPpf: 99 }, 0.01, { globalFloor: FLOOR, selected: false })).toBe(false);
  });
  it("the threshold is exactly at-or-above, so the capture zoom itself shows the label", () => {
    expect(measureLabelVisible({ labelPpf: 0.5 }, 0.5, { globalFloor: FLOOR })).toBe(true);
    expect(measureLabelVisible({ labelPpf: 0.5 }, 0.4999, { globalFloor: FLOOR })).toBe(false);
  });
  it("the readout is a NAMED zoom band and never a raw number (owner rule)", () => {
    expect(zoomBandLabel(0.02)).toBe("Region");
    expect(zoomBandLabel(0.35)).toBe("Site overview");
    expect(zoomBandLabel(2)).toBe("Close in");
    expect(zoomBandLabel(6)).toBe("Detail");
    const note = labelRevealNote({ labelPpf: 0.35 }, {}, FLOOR);
    expect(note).toBe("Shows from Site overview in");
    expect(note).not.toMatch(/\d/);
    expect(labelRevealNote({}, {}, FLOOR)).toMatch(/\(default\)$/);
  });
});

describe("NEW-1: Standards → Measurements applies retroactively (the parcel mechanic: WRITE)", () => {
  it("writes the value onto every existing measurement", () => {
    const measures = [{ id: "a", mode: "area" }, { id: "b", mode: "line", stroke: "#000000" }];
    const res = applyMeasureStandard(measures, "stroke", "#16a34a");
    expect(res.count).toBe(2);
    expect(res.measures.map((m) => m.stroke)).toEqual(["#16a34a", "#16a34a"]);
  });
  it("a null CLEARS the key rather than storing a null", () => {
    const res = applyMeasureStandard([{ id: "a", stroke: "#000000" }], "stroke", null);
    expect(res.count).toBe(1);
    expect("stroke" in res.measures[0]).toBe(false);
  });
  it("returns the SAME array reference when nothing changes", () => {
    const measures = [{ id: "a", stroke: "#16a34a" }];
    const res = applyMeasureStandard(measures, "stroke", "#16a34a");
    expect(res.count).toBe(0);
    expect(res.measures).toBe(measures);
  });
  it("the one panel-wide Apply counts a measurement as ONE object however many keys changed", () => {
    const res = applyAllStandards([], [], {}, [], {
      measures: [{ id: "a" }, { id: "b" }],
      measureValues: { stroke: "#16a34a", weight: 3, dash: "dotted" },
    });
    expect(res.count).toBe(2);
    expect(res.measures[0]).toMatchObject({ stroke: "#16a34a", weight: 3, dash: "dotted" });
  });
  it("existing callers that pass no measurements are untouched", () => {
    const parcels = [{ id: "p", stroke: "#111111" }];
    const res = applyAllStandards(parcels, [], { stroke: "#222222" }, []);
    expect(res.count).toBe(1);
    expect(res.measures).toEqual([]);
  });
});

describe("NEW-1: measurement standards ride the same pending-DRAFT model as parcels", () => {
  it("an edit lands in the draft and is only stored on commit", () => {
    const d = withMeasureDraft(EMPTY_STD_DRAFT, { stroke: "#16a34a" });
    expect(draftMeasureValue(d, "stroke", undefined)).toBe("#16a34a");
    expect(EMPTY_STD_DRAFT.measureStyle).toEqual({}); // never mutated
    expect(mergeDraftIntoSettings({}, d).measureStyle).toEqual({ stroke: "#16a34a" });
  });
  it("a draft matching what is committed is NOT dirty", () => {
    const d = withMeasureDraft(EMPTY_STD_DRAFT, { stroke: "#16a34a" });
    expect(draftDirty(d, () => undefined, () => undefined, () => "#16a34a")).toBe(false);
    expect(draftDirty(d, () => undefined, () => undefined, () => "#000000")).toBe(true);
  });
  it("a null in the draft DELETES the stored standard rather than storing a null", () => {
    const d = withMeasureDraft(EMPTY_STD_DRAFT, { stroke: null });
    expect(mergeDraftIntoSettings({ measureStyle: { stroke: "#16a34a" } }, d).measureStyle).toEqual({});
  });
});
