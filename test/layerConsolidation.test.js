import { describe, it, expect, vi } from "vitest";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so the module
// loads in the node test environment (same pattern as test/probeNoCors.test.js).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn() }));

import { ALL_LAYERS, MERGE_GROUPS, LAYER_GROUP_ORDER, LAYER_GROUP_LABEL } from "../src/workspaces/site-planner/lib/layers.js";
import { buildGroupSlots } from "../src/workspaces/site-planner/lib/layerPanelInfo.js";
import { JURISDICTION_LAYERS } from "../src/workspaces/site-planner/lib/counties.js";

/* B898 — Layers-panel redesign guards: the reorg is grouping/naming/order + a source-resolver
 * for consolidated layers, and must never weaken a data fetch. These pin the acceptance
 * criteria: decision-first group order, no provider-specific top-level group, exactly ONE
 * "Water & sewer" / "Electric" / "Fire hydrants" layer each (still N adapters underneath,
 * each fetch untouched), and function-first labels (provider name lives in `source`, not
 * the visible label). */

const membersOf = (mergeGroup) => Object.entries(ALL_LAYERS).filter(([, cfg]) => cfg.mergeGroup === mergeGroup);
const allLabels = () => Object.values(ALL_LAYERS).map((cfg) => cfg.label).filter(Boolean);

describe("B898 — decision-first group order (deal-killer first, reference last)", () => {
  it("the canonical group order matches the brief exactly", () => {
    expect(LAYER_GROUP_ORDER).toEqual(["base", "flood", "utilities", "environmental", "access", "jurisdiction"]);
  });
  it("every group has a plain-English label with no provider name baked in", () => {
    expect(LAYER_GROUP_LABEL).toEqual({
      base: "Base & terrain",
      flood: "Flood & drainage",
      utilities: "Utilities serving the site",
      environmental: "Environmental & hazards",
      access: "Access & infrastructure",
      jurisdiction: "Jurisdictions & authority",
    });
  });
  it("no layer is tagged with a provider-specific group (e.g. a county/city key) — only the six canonical groups", () => {
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      if (!cfg.group) continue; // a few merge-secondaries (jur_etj) carry no group tag of their own
      expect(LAYER_GROUP_ORDER, `${id} has an unrecognized group "${cfg.group}"`).toContain(cfg.group);
    }
  });
  it("the old per-county 'Harris County · City of Houston' provider group is empty — no top-level provider group", () => {
    expect(Object.keys(JURISDICTION_LAYERS.harris.layers)).toEqual([]);
  });
});

describe("B898 — ONE 'Water & sewer' layer for all AHJs (no provider-named water/sewer layers remain)", () => {
  it("exactly one mergeGroup id ('water_sewer') covers every water/sewer adapter", () => {
    const members = membersOf("water_sewer");
    expect(members.map(([id]) => id).sort()).toEqual(["ccn_service", "coh_ww", "coh_water", "jur_mud"].sort());
  });
  it("every member keeps group 'utilities' and its own fetch (url/kind) untouched", () => {
    for (const [, cfg] of membersOf("water_sewer")) {
      expect(cfg.group).toBe("utilities");
      expect(cfg.url, `${cfg.label} lost its fetch URL`).toBeTruthy();
      expect(cfg.source, `${cfg.label} has no provenance for the ⓘ`).toBeTruthy();
    }
  });
  it("MERGE_GROUPS.water_sewer has the single consolidated label 'Water & sewer'", () => {
    expect(MERGE_GROUPS.water_sewer.label).toBe("Water & sewer");
  });
  it("MERGE_GROUPS.water_sewer note is explicitly inclusive, never AHJ-exclusive", () => {
    expect(MERGE_GROUPS.water_sewer.note).toMatch(/every provider|not just the parcel/i);
  });
  it("no standalone provider-named water/sewer label survives anywhere in the registry", () => {
    const banned = [
      "Houston water lines", "Houston wastewater", "MUD / water districts",
      "Water/sewer CCN (Houston region)", "Water/sewer CCN",
    ];
    for (const label of allLabels()) for (const b of banned) expect(label).not.toBe(b);
  });
  it("buildGroupSlots folds all 4 members into ONE row when the Utilities group is built", () => {
    const utilEntries = Object.entries(ALL_LAYERS).filter(([, cfg]) => cfg.group === "utilities");
    const slots = buildGroupSlots(utilEntries);
    const waterSlot = slots.find((s) => s.kind === "merge" && s.mergeGroup === "water_sewer");
    expect(waterSlot).toBeTruthy();
    expect(waterSlot.members.length).toBe(4);
    // and only ONE such slot — never split across two rows
    expect(slots.filter((s) => s.kind === "merge" && s.mergeGroup === "water_sewer").length).toBe(1);
  });
});

describe("B898 — Fire hydrants consolidated to ONE layer", () => {
  it("exactly the 3 hydrant-relevant adapters merge under fire_hydrants", () => {
    const members = membersOf("fire_hydrants");
    expect(members.map(([id]) => id).sort()).toEqual(["coh_hydrants", "mapillary", "osm_hydrants"].sort());
  });
  it("MERGE_GROUPS.fire_hydrants has the single consolidated label 'Fire hydrants'", () => {
    expect(MERGE_GROUPS.fire_hydrants.label).toBe("Fire hydrants");
  });
  it("no standalone provider-named hydrant label survives", () => {
    const banned = ["Fire hydrants (OSM)", "Fire hydrants (City of Houston)"];
    for (const label of allLabels()) for (const b of banned) expect(label).not.toBe(b);
  });
});

describe("B898 — Electric consolidated to ONE layer", () => {
  it("exactly the 3 electric adapters merge under electric (OSM power/poles + HIFLD transmission + HIFLD substations)", () => {
    const members = membersOf("electric");
    expect(members.map(([id]) => id).sort()).toEqual(["hifld_substations", "hifld_tx", "osm_power"].sort());
  });
  it("MERGE_GROUPS.electric has the single consolidated label", () => {
    expect(MERGE_GROUPS.electric.label).toBe("Electric (lines, substations & poles)");
  });
  it("no standalone provider-named electric label survives", () => {
    const banned = ["Power lines & poles (OSM)", "Transmission lines (HIFLD)", "Electric substations (HIFLD)"];
    for (const label of allLabels()) for (const b of banned) expect(label).not.toBe(b);
  });
});

describe("B898 — every merge-group member is tagged 'utilities' and no group spans two merge groups", () => {
  it("water_sewer / electric / fire_hydrants members are mutually exclusive ids", () => {
    const w = new Set(membersOf("water_sewer").map(([id]) => id));
    const e = new Set(membersOf("electric").map(([id]) => id));
    const f = new Set(membersOf("fire_hydrants").map(([id]) => id));
    for (const id of w) { expect(e.has(id)).toBe(false); expect(f.has(id)).toBe(false); }
    for (const id of e) expect(f.has(id)).toBe(false);
  });
  it("every mergeGroup member lives in the Utilities group", () => {
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      if (cfg.mergeGroup) expect(cfg.group, `${id} (mergeGroup ${cfg.mergeGroup})`).toBe("utilities");
    }
  });
});

describe("B898 — function-first labels: no bare provider-code suffix on a solo (non-merged) row", () => {
  // A solo row's label must not end in a bare "(PROVIDER)" acronym suffix — the provider now
  // lives in `source`, surfaced only in the ⓘ. Merge MEMBERS are exempt (their `label` is the
  // per-provider ⓘ line, e.g. "Water mains" / "Transmission lines" — no acronym suffix anyway).
  const PROVIDER_SUFFIX = /\((OSM|HIFLD|TxRRC|NWI|COH|HCFCD)\)\s*$/i;
  it("no solo layer's visible label ends in a bare provider-code suffix", () => {
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      if (cfg.mergeGroup || cfg.mergeWith) continue; // merge members/secondaries carry their own convention
      expect(PROVIDER_SUFFIX.test(cfg.label || ""), `${id}: "${cfg.label}"`).toBe(false);
    }
  });
});

describe("B898 — Flood & drainage rename (auto by AHJ, no hard-coded 'Houston' label)", () => {
  it("hcfcd_row / coh_storm carry function-first labels, not provider names", () => {
    expect(ALL_LAYERS.hcfcd_row.label).toBe("Drainage channels & ROW");
    expect(ALL_LAYERS.coh_storm.label).toBe("Storm sewer");
    expect(ALL_LAYERS.hcfcd_row.group).toBe("flood");
    expect(ALL_LAYERS.coh_storm.group).toBe("flood");
  });
  it("provider stays available for the ⓘ via cfg.source", () => {
    expect(ALL_LAYERS.hcfcd_row.source).toBeTruthy();
    expect(ALL_LAYERS.coh_storm.source).toBeTruthy();
  });
});
