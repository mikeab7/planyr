import { describe, it, expect } from "vitest";
import {
  rowInfoSections, combineLayerStatus,
  buildGroupSlots, mergeSlotAnyOn, mergeSlotOpacity, mergeGroupInfoSections,
} from "../src/workspaces/site-planner/lib/layerPanelInfo.js";

/* B760/B761 — the pure Layers-panel row helpers: what the per-row ⓘ shows, and how the
 * merged City/ETJ row folds two live statuses into one dot. */

const texts = (secs) => secs.map((s) => s.text);

describe("rowInfoSections (B760) — ⓘ popover content", () => {
  it("puts sublabel, source, vintage and note behind the ⓘ (in order)", () => {
    const cfg = { sublabel: "Detected in street photos.", source: "Mapillary", note: "Loads at zoom ≥ 16." };
    const secs = rowInfoSections(cfg, { vintage: "Capture date varies", age: "", ls: null });
    expect(texts(secs)).toEqual([
      "Detected in street photos.",
      "Source: Mapillary",
      "As of: Capture date varies",
      "Loads at zoom ≥ 16.",
    ]);
  });

  it("falls back to an honest 'vintage unknown' when no vintage is known", () => {
    const secs = rowInfoSections({}, { vintage: null, age: "", ls: null });
    expect(texts(secs)).toEqual(["As of: vintage unknown"]);
  });

  it("appends the refreshed-age ONLY when the layer is loaded/empty (not while loading/off)", () => {
    const cfg = { note: "x" };
    const loaded = rowInfoSections(cfg, { vintage: "2026", age: "3m ago", ls: { state: "loaded", ts: 1 } });
    expect(loaded[0].text).toBe("As of: 2026 · refreshed 3m ago");
    // loading → no refreshed stamp yet
    const loading = rowInfoSections(cfg, { vintage: "2026", age: "3m ago", ls: { state: "loading", ts: 1 } });
    expect(loading[0].text).toBe("As of: 2026");
    // off (ls null) → no refreshed stamp
    const off = rowInfoSections(cfg, { vintage: "2026", age: "", ls: null });
    expect(off[0].text).toBe("As of: 2026");
  });

  it("flags a stale refresh with a warn tone + an (updating…) marker", () => {
    const secs = rowInfoSections({}, { vintage: "2026", age: "3m ago", ls: { state: "loaded", ts: 1, stale: true } });
    expect(secs[0].text).toBe("As of: 2026 · refreshed 3m ago (updating…)");
    expect(secs[0].tone).toBe("warn");
  });

  it("adds the has-jurisdiction caveat as a warn line only when cfg.infoCaveat is set", () => {
    const withCaveat = rowInfoSections({ note: "n", infoCaveat: "HAS JURISDICTION, not service." }, { vintage: "2026" });
    const last = withCaveat[withCaveat.length - 1];
    expect(last).toEqual({ text: "HAS JURISDICTION, not service.", tone: "warn" });
    const without = rowInfoSections({ note: "n" }, { vintage: "2026" });
    expect(without.some((s) => s.tone === "warn")).toBe(false);
  });

  it("is empty of extra lines for a bare row (only the vintage line)", () => {
    expect(rowInfoSections({}, {}).length).toBe(1); // just the "As of:" line
  });
});

describe("combineLayerStatus (B761) — merged City/ETJ status dot", () => {
  const S = (state, extra = {}) => ({ state, ...extra });

  it("returns null when neither underlying layer is on", () => {
    expect(combineLayerStatus(null, null)).toBe(null);
    expect(combineLayerStatus()).toBe(null);
    expect(combineLayerStatus(undefined)).toBe(null);
  });

  it("prefers loading over everything (a load in progress shows as loading)", () => {
    expect(combineLayerStatus(S("loaded"), S("loading")).state).toBe("loading");
    expect(combineLayerStatus(S("failed"), S("loading")).state).toBe("loading");
  });

  it("prefers failed over loaded/empty (a real failure is never hidden by the other's success)", () => {
    expect(combineLayerStatus(S("loaded"), S("failed", { msg: "down" })).state).toBe("failed");
    // carries the failing layer's message
    expect(combineLayerStatus(S("empty"), S("failed", { msg: "down" })).msg).toBe("down");
  });

  it("prefers loaded over empty; falls to empty when both are empty", () => {
    expect(combineLayerStatus(S("empty"), S("loaded")).state).toBe("loaded");
    expect(combineLayerStatus(S("empty"), S("empty")).state).toBe("empty");
  });
});

describe("buildGroupSlots (B898) — N-ary merge-group consolidation", () => {
  const solo = (id, order) => [id, { label: id, order }];
  const member = (id, mergeGroup, order) => [id, { label: id, mergeGroup, order }];

  it("keeps unrelated entries as solo slots, in order", () => {
    const slots = buildGroupSlots([solo("a", 1), solo("b", 2)]);
    expect(slots).toEqual([{ kind: "solo", entry: solo("a", 1) }, { kind: "solo", entry: solo("b", 2) }]);
  });

  it("folds every entry sharing a mergeGroup id into ONE slot, preserving member order", () => {
    const a = member("ccn_service", "water_sewer", 1);
    const b = member("jur_mud", "water_sewer", 1);
    const c = member("coh_water", "water_sewer", 1);
    const slots = buildGroupSlots([a, b, c]);
    expect(slots).toEqual([{ kind: "merge", mergeGroup: "water_sewer", members: [a, b, c] }]);
  });

  it("sorts solo and merge slots together by minimum order (stable on ties)", () => {
    const flood = solo("fema", 1);
    const utilElectric = [member("osm_power", "electric", 2), member("hifld_tx", "electric", 2)];
    const utilWater = [member("ccn_service", "water_sewer", 1), member("jur_mud", "water_sewer", 1)];
    const slots = buildGroupSlots([flood, ...utilElectric, ...utilWater]);
    // water_sewer (order 1) and fema (order 1) tie — original relative order (fema, water_sewer) wins;
    // electric (order 2) sorts last.
    expect(slots.map((s) => (s.kind === "solo" ? s.entry[0] : s.mergeGroup)))
      .toEqual(["fema", "water_sewer", "electric"]);
  });

  it("two DIFFERENT merge groups never collapse into one slot", () => {
    const slots = buildGroupSlots([member("osm_power", "electric", 1), member("osm_hydrants", "fire_hydrants", 1)]);
    expect(slots.length).toBe(2);
    expect(slots.map((s) => s.mergeGroup).sort()).toEqual(["electric", "fire_hydrants"]);
  });

  it("real-world Water & sewer: 4 provider adapters fold into one slot", () => {
    const entries = [
      ["ccn_service", { label: "Water/sewer service territory (CCN)", group: "utilities", mergeGroup: "water_sewer", order: 1 }],
      ["jur_mud", { label: "Water district boundaries (MUD)", group: "utilities", mergeGroup: "water_sewer", order: 1 }],
      ["coh_water", { label: "Water mains", group: "utilities", mergeGroup: "water_sewer", order: 1 }],
      ["coh_ww", { label: "Wastewater mains", group: "utilities", mergeGroup: "water_sewer", order: 1 }],
    ];
    const slots = buildGroupSlots(entries);
    expect(slots.length).toBe(1);
    expect(slots[0].mergeGroup).toBe("water_sewer");
    expect(slots[0].members.map(([id]) => id)).toEqual(["ccn_service", "jur_mud", "coh_water", "coh_ww"]);
  });
});

describe("mergeSlotAnyOn / mergeSlotOpacity (B898)", () => {
  const members = [["a", { opacity: 0.5 }], ["b", { opacity: 0.9 }]];

  it("anyOn is INCLUSIVE — true the moment any one member is on (never AHJ-exclusive filtering)", () => {
    expect(mergeSlotAnyOn(members, {})).toBe(false);
    expect(mergeSlotAnyOn(members, { a: { on: false }, b: { on: false } })).toBe(false);
    expect(mergeSlotAnyOn(members, { a: { on: true }, b: { on: false } })).toBe(true);
    expect(mergeSlotAnyOn(members, { a: { on: false }, b: { on: true } })).toBe(true);
  });

  it("opacity is the max across configured members (never silently dims an already-visible member)", () => {
    expect(mergeSlotOpacity(members, { a: { opacity: 0.3 }, b: { opacity: 0.7 } })).toBe(0.7);
    // falls back to each member's own default when overlay state has no opacity yet
    expect(mergeSlotOpacity(members, {})).toBe(0.9);
  });
});

describe("mergeGroupInfoSections (B898) — merged-row ⓘ provenance list", () => {
  it("lists the group note first, then one Source line per member, in order", () => {
    const members = [
      ["ccn_service", { label: "Water/sewer service territory (CCN)", source: "PUC CCN, via Harris County GIS" }],
      ["jur_mud", { label: "Water district boundaries (MUD)", source: "TCEQ, via HARC" }],
    ];
    const sections = mergeGroupInfoSections(members, { groupNote: "Mains and service territory, whichever apply here." });
    expect(sections[0]).toEqual({ text: "Mains and service territory, whichever apply here." });
    expect(sections[1].text).toBe("Water/sewer service territory (CCN) — Source: PUC CCN, via Harris County GIS");
    expect(sections[2].text).toBe("Water district boundaries (MUD) — Source: TCEQ, via HARC");
  });

  it("dedupes identical infoCaveats across members and tags them warn", () => {
    const caveat = "A boundary means the district HAS JURISDICTION here — not that it serves a parcel.";
    const members = [
      ["ccn_service", { label: "CCN", source: "PUC", infoCaveat: caveat }],
      ["jur_mud", { label: "MUD", source: "TCEQ", infoCaveat: caveat }],
    ];
    const sections = mergeGroupInfoSections(members, {});
    const warnLines = sections.filter((s) => s.tone === "warn");
    expect(warnLines.length).toBe(1);
    expect(warnLines[0].text).toBe(caveat);
  });

  it("falls back to cfg.source as the member's own label when it has none", () => {
    const sections = mergeGroupInfoSections([["x", { source: "Some Agency" }]], {});
    expect(sections[0].text).toBe("Some Agency — Source: Some Agency");
  });
});
