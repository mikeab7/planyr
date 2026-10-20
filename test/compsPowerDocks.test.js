// NEW-2 (power + dock doors) and NEW-3 (lease_opex wiped on edit): every column compToRow writes
// must be one the store reads back, or an edit round trip silently nulls it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  compToRow, rowToComp, emptyDraft, compToDraft, draftToComp, compFieldRows, powerLabel, validateComp,
} from "../src/shared/comps/lib/comps.js";
import { SELECT_COLS, TRASH_SELECT_COLS } from "../src/shared/comps/lib/compsStore.js";
import { SHEET_COLUMNS } from "../src/shared/comps/lib/compSheetColumns.js";
import { parsePasteBlock as parseSpreadsheetPaste } from "../src/shared/comps/lib/compParse.js";

const cols = (s) => s.split(",").map((x) => x.trim());
const anchor = { kind: "pin", lat: 29.7, lon: -95.3, county: "harris" };

describe("NEW-3: the store reads back every column compToRow writes", () => {
  const full = compToRow({
    compType: "lease", compDate: "2026-01-01", anchor, powerAmps: 1, powerVolts: 2, powerPhase: 3, dockDoors: 4,
  });
  const written = Object.keys(full).filter((k) => k !== "updated_at"); // stamped on write, selected on read
  it("SELECT_COLS covers all of them", () => {
    const sel = cols(SELECT_COLS);
    expect(written.filter((k) => !sel.includes(k))).toEqual([]);
  });
  it("TRASH_SELECT_COLS covers them too", () => {
    const sel = cols(TRASH_SELECT_COLS);
    expect(written.filter((k) => !sel.includes(k))).toEqual([]);
  });
  it("lease_opex survives an open → edit-something-else → save round trip", () => {
    const stored = { id: "x", user_id: "u", comp_type: "lease", comp_date: "2026-01-01", anchor_kind: "pin", lat: 29.7, lon: -95.3,
      lease_rate: 0.5, lease_rate_period: "monthly", lease_opex: 3.25, lease_size_sf: 1000 };
    const comp = rowToComp(stored);
    expect(comp.leaseOpex).toBe(3.25);
    const draft = compToDraft(comp);
    expect(draft.leaseOpex).toBe("3.25");
    const row = compToRow(draftToComp({ ...draft, title: "renamed" }));
    expect(row.lease_opex).toBe(3.25);
  });
  it("the lease record shows an OpEx row", () => {
    const rows = compFieldRows(rowToComp({ id: "x", comp_type: "lease", anchor_kind: "pin", lat: 1, lon: 1, lease_rate: 5, lease_rate_period: "annual", lease_opex: 3.25 }));
    expect(rows.find((r) => r.key === "opex")?.value).toBe("$3.25");
  });
});

describe("NEW-2: power + dock doors round trip (blank vs 0 vs value)", () => {
  it("blank stays null, zero stays 0, a value stays", () => {
    const blank = compToRow(draftToComp({ ...emptyDraft(anchor), compType: "lease", compDate: "2026-01-01" }));
    expect([blank.power_amps, blank.power_volts, blank.power_phase, blank.dock_doors]).toEqual([null, null, null, null]);
    const zero = compToRow(draftToComp({ ...emptyDraft(anchor), compType: "lease", powerAmps: "0", dockDoors: "0" }));
    expect([zero.power_amps, zero.dock_doors]).toEqual([0, 0]);
    const val = compToRow(draftToComp({ ...emptyDraft(anchor), compType: "lease", powerAmps: "2000", powerVolts: "480", powerPhase: "3", dockDoors: "12" }));
    expect([val.power_amps, val.power_volts, val.power_phase, val.dock_doors]).toEqual([2000, 480, 3, 12]);
    const back = rowToComp({ ...val, id: "i", anchor_kind: "pin", lat: 1, lon: 1 });
    expect(compToDraft(back)).toMatchObject({ powerAmps: "2000", powerVolts: "480", powerPhase: "3", dockDoors: "12" });
  });
  it("record view: Power row omits blank parts; docks row; neither on land", () => {
    expect(powerLabel({ powerAmps: 2000, powerVolts: 480, powerPhase: 3 })).toBe("2,000 A · 480 V · 3-phase");
    expect(powerLabel({ powerAmps: 800 })).toBe("800 A");
    expect(powerLabel({})).toBeNull();
    const sale = compFieldRows({ compType: "building_sale", powerAmps: 2000, powerPhase: 3, dockDoors: 12 });
    expect(sale.find((r) => r.key === "power").value).toBe("2,000 A · 3-phase");
    expect(sale.find((r) => r.key === "dockDoors").value).toBe("12");
    expect(compFieldRows({ compType: "land", powerAmps: 2000, dockDoors: 3 }).some((r) => r.key === "power" || r.key === "dockDoors")).toBe(false);
    expect(compFieldRows({ compType: "lease" }).some((r) => r.key === "power")).toBe(false);
  });
  it("validation: whole numbers, phase 1 or 3", () => {
    const ok = { compType: "lease", leaseRatePeriod: "annual", anchor };
    expect(validateComp({ ...ok, powerAmps: 2000, powerPhase: 3 })).toEqual([]);
    expect(validateComp({ ...ok, powerPhase: 2 })).toContain("Power phase must be 1 or 3.");
    expect(validateComp({ ...ok, dockDoors: 2.5 })).toContain("Dock doors must be a whole number.");
  });
  it("sheet columns exist for building_sale + lease only, beside Clear Ht", () => {
    const keys = SHEET_COLUMNS.map((c) => c.key);
    const i = keys.indexOf("clearHeightFt");
    expect(keys.slice(i + 1, i + 5)).toEqual(["powerAmps", "powerVolts", "powerPhase", "dockDoors"]);
    for (const k of ["powerAmps", "powerVolts", "powerPhase", "dockDoors"]) {
      const c = SHEET_COLUMNS.find((x) => x.key === k);
      expect(c.appliesTo("land")).toBe(false);
      expect(c.appliesTo("lease") && c.appliesTo("building_sale")).toBe(true);
    }
  });
  it("paste headers Power / Amps / Docks / Dock doors fill the fields", () => {
    const rows = parseSpreadsheetPaste("Type\tPower\tDock doors\tSize\nbuilding sale\t2000\t14\t100000");
    expect(rows[0].draft).toMatchObject({ compType: "building_sale", powerAmps: "2000", dockDoors: "14" });
    const rows2 = parseSpreadsheetPaste("Type\tAmps\tDocks\nlease\t1200 A\t8");
    expect(rows2[0].draft).toMatchObject({ powerAmps: "1200", dockDoors: "8" });
  });
});

describe("NEW-2: SQL files", () => {
  const sql = readFileSync(new URL("../src/shared/comps/db/comps_power_docks.sql", import.meta.url), "utf8");
  it("adds the four nullable columns and the constraints", () => {
    for (const c of ["power_amps integer", "power_volts integer", "power_phase smallint", "dock_doors integer"]) expect(sql).toContain(c);
    expect(sql).toMatch(/power_phase in \(1, 3\)/);
    expect(sql).toMatch(/power_amps is null or power_amps >= 0/);
    expect(sql).toMatch(/dock_doors is null or dock_doors >= 0/);
    expect(sql).not.toMatch(/not null/i);
  });
});
