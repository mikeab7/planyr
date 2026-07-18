/* Power screening — transmission easement flag + substation service-proxy (PHASE 5) — pure tests. */
import { describe, it, expect } from "vitest";
import {
  voltLabel, ownerLabel, subName, summarizeTransmission, summarizeSubstations,
} from "../src/workspaces/site-planner/lib/powerScreen.js";

describe("voltLabel / ownerLabel — clean the redacted HIFLD attributes", () => {
  it("prefers a real numeric kV, falls back to VOLT_CLASS, hides withheld sentinels", () => {
    expect(voltLabel({ VOLTAGE: 138 })).toBe("138 kV");
    expect(voltLabel({ VOLTAGE: 0, VOLT_CLASS: "220-287" })).toBe("220-287 kV");
    expect(voltLabel({ VOLTAGE: -999999, VOLT_CLASS: "NOT AVAILABLE" })).toBe("");
    expect(voltLabel({})).toBe("");
    expect(voltLabel({ VOLT_CLASS: "735 AND ABOVE kV" })).toBe("735 AND ABOVE kV");
  });
  it("hides a withheld / blank owner", () => {
    expect(ownerLabel({ OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC" })).toBe("CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC");
    expect(ownerLabel({ OWNER: "NOT AVAILABLE" })).toBe("");
    expect(ownerLabel({})).toBe("");
  });
});

describe("subName — clean anonymized substation names", () => {
  it("keeps a real name, replaces UNKNOWN#### / blank with 'unnamed substation'", () => {
    expect(subName({ NAME: "T H WHARTON" })).toBe("T H WHARTON");
    expect(subName({ NAME: "UNKNOWN26184" })).toBe("unnamed substation");
    expect(subName({ NAME: "NOT AVAILABLE" })).toBe("unnamed substation");
    expect(subName({})).toBe("unnamed substation");
  });
});

describe("summarizeTransmission — crossing = easement flag; nearby = info", () => {
  it("empty → absent (caller supplies the 'none within' label)", () => {
    const r = summarizeTransmission({ ranked: [] }, { total: 0 });
    expect(r.status).toBe("absent");
    expect(r.summary).toBe(null);
  });
  it("a line crossing the footprint flags a likely transmission easement (present)", () => {
    const scr = {
      nearest: { attrs: { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 138 }, distFt: 0 },
      ranked: [
        { attrs: { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 138 }, distFt: 0 },
        { attrs: { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 345 }, distFt: 10 },
      ],
    };
    const r = summarizeTransmission(scr, { total: 2, bufferMi: 0.25 });
    expect(r.status).toBe("present");
    expect(r.summary).toMatch(/2 transmission lines cross the site/);
    expect(r.summary).toMatch(/up to 345 kV/);
    expect(r.summary).toMatch(/transmission easement/);
    expect(r.detail[0]).toMatch(/crosses the site/);
  });
  it("a line only NEAR the site is info context, not a constraint", () => {
    const scr = {
      nearest: { attrs: { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 138 }, distFt: 700 },
      ranked: [{ attrs: { OWNER: "CENTERPOINT ENERGY HOUSTON ELECTRIC, LLC", VOLTAGE: 138 }, distFt: 700 }],
    };
    const r = summarizeTransmission(scr, { total: 1, bufferMi: 0.25 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/1 transmission line within 0.25 mi/);
    expect(r.summary).toMatch(/nearest/);
    expect(r.summary).not.toMatch(/easement/);
  });
});

describe("summarizeSubstations — nearest-distance service proxy (always info)", () => {
  it("none within the buffer → info 'farther from grid', never a constraint", () => {
    const r = summarizeSubstations({ ranked: [] }, { total: 0, bufferMi: 3 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/No mapped electric substation within 3 mi/);
    expect(r.summary).toMatch(/farther from grid/);
  });
  it("reports the nearest distance + name + count as an info fact", () => {
    const scr = {
      nearest: { attrs: { NAME: "T H WHARTON", MAX_VOLTAG: 345 }, distFt: 2640 },
      ranked: [
        { attrs: { NAME: "T H WHARTON", MAX_VOLTAG: 345 }, distFt: 2640 },
        { attrs: { NAME: "UNKNOWN26184", MAX_VOLTAG: 0 }, distFt: 5000 },
      ],
    };
    const r = summarizeSubstations(scr, { total: 2, bufferMi: 3 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/Nearest electric substation/);
    expect(r.summary).toMatch(/T H WHARTON/);
    expect(r.summary).toMatch(/2 within 3 mi/);
    // anonymized + withheld-voltage record renders cleanly in the detail
    expect(r.detail[1]).toMatch(/unnamed substation/);
    expect(r.detail[1]).not.toMatch(/kV/);
  });
});
