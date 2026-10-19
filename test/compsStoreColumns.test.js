// NEW-3 / NEW-2 — the select list must carry every column compToRow writes. A column that is written
// but never read back makes rowToComp yield null for it, and the next Save writes that null over the
// stored value (lease_opex was wiped exactly this way).
import { describe, it, expect } from "vitest";
import { SELECT_COLS } from "../src/shared/comps/lib/compsStore.js";
import { compToRow, rowToComp, compToDraft, draftToComp, emptyDraft, compFieldRows, compPowerText } from "../src/shared/comps/lib/comps.js";

const fullComp = {
  compType: "lease", compDate: "2026-09-01", title: "t", anchor: { kind: "pin", lat: 1, lon: 2 },
  leaseRate: 5, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseOpex: 1.25, leaseTi: 3,
  clearHeightFt: 32, yearBuilt: 2019, powerAmps: 2000, powerVolts: 480, powerPhase: 3, dockDoors: 24,
};

describe("compsStore SELECT_COLS covers every column compToRow writes", () => {
  const selected = new Set(SELECT_COLS.split(","));
  // Written by the client but deliberately not selected: server-stamped timestamp (we do select updated_at).
  const keys = Object.keys(compToRow(fullComp));
  it("no written column is missing from the select list", () => {
    expect(keys.filter((k) => !selected.has(k))).toEqual([]);
  });
  it("names the new power / dock columns and lease_opex explicitly", () => {
    for (const c of ["lease_opex", "power_amps", "power_volts", "power_phase", "dock_doors"]) expect(selected.has(c)).toBe(true);
  });
});

describe("OpEx survives an edit that does not touch it (NEW-3)", () => {
  it("row -> comp -> draft -> comp -> row keeps lease_opex", () => {
    const row = { ...compToRow(fullComp), id: "x", lat: 1, lon: 2, created_at: "", updated_at: "" };
    const back = compToRow(draftToComp(compToDraft(rowToComp(row))));
    expect(back.lease_opex).toBe(1.25);
  });
  it("the record shows the OpEx row", () => {
    expect(compFieldRows({ ...fullComp, leaseOpex: 1.25 }).some((r) => r.key === "opex")).toBe(true);
  });
});

describe("power / dock doors round-trip — blank vs 0 vs value (NEW-2)", () => {
  const trip = (patch) => {
    const row = { ...compToRow({ ...fullComp, ...patch }), id: "x", lat: 1, lon: 2, created_at: "", updated_at: "" };
    return compToRow(draftToComp(compToDraft(rowToComp(row))));
  };
  it("a value survives", () => {
    const r = trip({});
    expect([r.power_amps, r.power_volts, r.power_phase, r.dock_doors]).toEqual([2000, 480, 3, 24]);
  });
  it("0 stays 0 (not blank)", () => {
    const r = trip({ dockDoors: 0, powerAmps: 0 });
    expect(r.dock_doors).toBe(0);
    expect(r.power_amps).toBe(0);
  });
  it("blank stays null (not 0)", () => {
    const r = trip({ powerAmps: null, powerVolts: null, powerPhase: null, dockDoors: null });
    expect([r.power_amps, r.power_volts, r.power_phase, r.dock_doors]).toEqual([null, null, null, null]);
    const d = emptyDraft(null);
    expect(draftToComp(d).powerAmps).toBeNull();
  });
  it("record view: Power row omits blank parts; Dock doors row; none for land", () => {
    expect(compPowerText({ powerAmps: 2000, powerVolts: 480, powerPhase: 3 })).toBe("2,000 A · 480 V · 3-phase");
    expect(compPowerText({ powerAmps: 2000 })).toBe("2,000 A");
    expect(compPowerText({})).toBeNull();
    const rows = compFieldRows(fullComp);
    expect(rows.find((r) => r.key === "power").value).toBe("2,000 A · 480 V · 3-phase");
    expect(rows.find((r) => r.key === "dockDoors").value).toBe("24");
    expect(compFieldRows({ compType: "land", anchor: null, landSizeValue: 1, landSizeUnit: "ac", powerAmps: 5 }).some((r) => r.key === "power")).toBe(false);
  });
});

describe("sheet + paste wiring for power / dock doors (NEW-2)", () => {
  it("the desktop sheet has the four BUILDING columns, applying to sale + lease only", async () => {
    const { SHEET_COLUMNS } = await import("../src/shared/comps/lib/compSheetColumns.js");
    for (const k of ["powerAmps", "powerVolts", "powerPhase", "dockDoors"]) {
      const c = SHEET_COLUMNS.find((x) => x.key === k);
      expect(c, k).toBeTruthy();
      expect(c.group).toBe("BUILDING");
      expect(c.appliesTo("lease") && c.appliesTo("building_sale") && !c.appliesTo("land")).toBe(true);
    }
  });
  it("a pasted Power / Dock doors header lands in the draft", async () => {
    const { parsePaste } = await import("../src/shared/comps/lib/compParse.js");
    const text = "Type\tDate\tTenant\tSF\tRate\tPeriod\tPower\tDock doors\nlease\t2026-09-01\tAcme\t100000\t6\tyr\t2000\t24";
    const out = parsePaste(text);
    expect(out.mode).toBe("spreadsheet");
    expect(out.rows[0].draft.powerAmps).toBe("2000");
    expect(out.rows[0].draft.dockDoors).toBe("24");
  });
});
