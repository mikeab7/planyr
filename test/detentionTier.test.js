// B631 — the analysis-tier / DIA-trigger indicator. Pure.
import { describe, it, expect } from "vitest";
import { assessAnalysisTier } from "../src/workspaces/site-planner/lib/detentionRules.js";

describe("assessAnalysisTier", () => {
  it("Goose Creek composite: AE + floodway + HCFCD channel + ~300 ac → Full DIA, all triggers listed", () => {
    const t = assessAnalysisTier({
      acres: 300,
      authorityId: "hcfcd",
      floodZones: [{ zone: "AE" }, { zone: "AE", subtype: "FLOODWAY" }],
      channel: { near: true, unitNo: "Q101-00-00", name: "GOOSE CREEK", distFt: 40 },
    });
    expect(t.tier).toBe("dia");
    const ids = t.triggers.map((x) => x.id);
    expect(ids).toContain("floodplain");
    expect(ids).toContain("floodway");
    expect(ids).toContain("regulated-channel");
    expect(ids).toContain("tract-size");
    expect(t.triggers.find((x) => x.id === "floodway").detail).toMatch(/strong/i);
    expect(t.triggers.find((x) => x.id === "regulated-channel").detail).toMatch(/Q101-00-00/);
    expect(t.unknowns).toHaveLength(0);
  });

  it("a clean small site → rate-method, zero triggers", () => {
    const t = assessAnalysisTier({ acres: 5, authorityId: "coh", floodZones: [], channel: { near: false } });
    expect(t.tier).toBe("rate");
    expect(t.triggers).toHaveLength(0);
    expect(t.label).toMatch(/rate-method/i);
  });

  it("unknown channel adjacency lands in unknowns — a fact gap, never a fired trigger", () => {
    const t = assessAnalysisTier({ acres: 5, authorityId: "coh", floodZones: [], channel: null });
    expect(t.tier).toBe("rate");
    expect(t.unknowns.map((u) => u.id)).toContain("regulated-channel");
    const t2 = assessAnalysisTier({ acres: 5, authorityId: "coh", floodZones: [], channel: { near: null } });
    expect(t2.unknowns.map((u) => u.id)).toContain("regulated-channel");
  });

  it("NEW-4: outside Harris (channelDataApplicable:false) the channel-adjacency unknown is OMITTED, not permanent noise", () => {
    // A Fort Bend site: HCFCD channel data doesn't exist here, so an unresolvable
    // "Channel adjacency unknown" would sit forever — the caller gates it off.
    const t = assessAnalysisTier({ acres: 5, authorityId: "fortbend", floodZones: [], channel: null, channelDataApplicable: false });
    expect(t.unknowns.map((u) => u.id)).not.toContain("regulated-channel");
    const t2 = assessAnalysisTier({ acres: 5, authorityId: "fortbend", floodZones: [], channel: { near: null, state: "not-applicable" }, channelDataApplicable: false });
    expect(t2.unknowns.map((u) => u.id)).not.toContain("regulated-channel");
    // gating never suppresses a DETECTED channel (near:true still fires as a trigger)
    const t3 = assessAnalysisTier({ acres: 5, authorityId: "fortbend", floodZones: [], channel: { near: true, unitNo: "X" }, channelDataApplicable: false });
    expect(t3.triggers.map((x) => x.id)).toContain("regulated-channel");
  });

  it("NEW-4: in Harris (default channelDataApplicable) the unknown still surfaces — a real, resolvable gap", () => {
    const t = assessAnalysisTier({ acres: 5, authorityId: "hcfcd", floodZones: [], channel: { near: null }, channelDataApplicable: true });
    expect(t.unknowns.map((u) => u.id)).toContain("regulated-channel");
  });

  it("shaded X (0.2% zone) is NOT an SFHA trigger; Zone A / VE are", () => {
    expect(assessAnalysisTier({ acres: 5, floodZones: [{ zone: "X", subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }], channel: { near: false } }).tier).toBe("rate");
    expect(assessAnalysisTier({ acres: 5, floodZones: [{ zone: "A" }], channel: { near: false } }).tier).toBe("dia");
    expect(assessAnalysisTier({ acres: 5, floodZones: [{ zone: "VE" }], channel: { near: false } }).tier).toBe("dia");
  });

  it("per-authority tract thresholds: Chambers 200 ac, Fort Bend 50 ac (HEC-HMS), COH/HCFCD 20 ac", () => {
    const clean = { floodZones: [], channel: { near: false } };
    expect(assessAnalysisTier({ ...clean, acres: 150, authorityId: "chambers" }).tier).toBe("rate");
    expect(assessAnalysisTier({ ...clean, acres: 250, authorityId: "chambers" }).tier).toBe("dia");
    expect(assessAnalysisTier({ ...clean, acres: 45, authorityId: "fortbend" }).tier).toBe("rate");
    expect(assessAnalysisTier({ ...clean, acres: 55, authorityId: "fortbend" }).tier).toBe("dia");
    expect(assessAnalysisTier({ ...clean, acres: 25, authorityId: "coh" }).tier).toBe("dia");
    expect(assessAnalysisTier({ ...clean, acres: 25, authorityId: "hcfcd" }).tier).toBe("dia");
  });

  it("Montgomery's 640-ac master-plan trigger stacks on the 20-ac DIA trigger", () => {
    const t = assessAnalysisTier({ acres: 700, authorityId: "montgomery", floodZones: [], channel: { near: false } });
    const ids = t.triggers.map((x) => x.id);
    expect(ids).toContain("tract-size");
    expect(ids).toContain("master-plan");
  });

  it("no authority resolved → size thresholds can't fire, but flood facts still can", () => {
    const t = assessAnalysisTier({ acres: 500, authorityId: null, floodZones: [{ zone: "AE" }], channel: { near: false } });
    expect(t.triggers.map((x) => x.id)).toEqual(["floodplain"]);
  });
});
