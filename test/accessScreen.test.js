/* Access-tier screening — AADT / rail / airport (PHASE 6) — pure tests. */
import { describe, it, expect } from "vitest";
import {
  railroadName, airportTypeLabel, summarizeAadt, summarizeRail, summarizeAirports,
} from "../src/workspaces/site-planner/lib/accessScreen.js";

describe("railroadName / airportTypeLabel — plain labels from terse codes", () => {
  it("expands common railroad reporting marks, falls back to the raw mark", () => {
    expect(railroadName("UP")).toBe("Union Pacific");
    expect(railroadName("PTRA")).toBe("Port Terminal Railroad Association");
    expect(railroadName("BNSF")).toBe("BNSF Railway");
    expect(railroadName("ZZZ")).toBe("ZZZ"); // unknown mark → raw
    expect(railroadName("")).toBe("");
  });
  it("labels FAA TYPE_CODE", () => {
    expect(airportTypeLabel("AD")).toBe("airport");
    expect(airportTypeLabel("HP")).toBe("heliport");
    expect(airportTypeLabel("")).toBe("airfield");
  });
});

describe("summarizeAadt — nearest counted road's traffic (info)", () => {
  it("none within the buffer → info, no count", () => {
    const r = summarizeAadt({ ranked: [] }, { total: 0, bufferMi: 0.5 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/No TxDOT traffic-count station within 0.5 mi/);
  });
  it("reports the nearest road's AADT as a formatted vehicles/day figure", () => {
    const scr = {
      nearest: { attrs: { AADT_PRELIM: 47150, Located_On: "IH 10" }, distFt: 500 },
      ranked: [
        { attrs: { AADT_PRELIM: 47150, Located_On: "IH 10" }, distFt: 500 },
        { attrs: { AADT_PRELIM: 12000, Located_On: "-" }, distFt: 1200 }, // blank road name
      ],
    };
    const r = summarizeAadt(scr, { total: 2, bufferMi: 0.5 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/~47,150 vehicles\/day on IH 10/);
    expect(r.detail[1]).toMatch(/counted road · ~12,000\/day/); // blank name → "counted road"
  });
});

describe("summarizeRail — nearest rail line + owner (info)", () => {
  it("none within the buffer → info 'not a rail-served location'", () => {
    const r = summarizeRail({ ranked: [] }, { total: 0, bufferMi: 0.5 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/not a rail-served location/);
  });
  it("a line crossing/abutting the site flags a potential rail-served siding", () => {
    const scr = {
      nearest: { attrs: { RROWNER1: "UP" }, distFt: 0 },
      ranked: [{ attrs: { RROWNER1: "UP" }, distFt: 0 }],
    };
    const r = summarizeRail(scr, { total: 1, bufferMi: 0.5 });
    expect(r.summary).toMatch(/crosses\/abuts the site: Union Pacific/);
    expect(r.summary).toMatch(/potential rail-served siding/);
    expect(r.detail[0]).toMatch(/Union Pacific · crosses\/abuts the site/);
  });
  it("a line merely nearby reports the distance + owner, no siding claim", () => {
    const scr = { nearest: { attrs: { RROWNER1: "BNSF" }, distFt: 900 }, ranked: [{ attrs: { RROWNER1: "BNSF" }, distFt: 900 }] };
    const r = summarizeRail(scr, { total: 1, bufferMi: 0.5 });
    expect(r.summary).toMatch(/nearest .*: BNSF Railway/);
    expect(r.summary).not.toMatch(/siding/);
  });
});

describe("summarizeAirports — Part 77 proximity proxy (info + caution)", () => {
  it("none within the buffer → info, outside the Part 77 neighborhood", () => {
    const r = summarizeAirports({ ranked: [] }, { total: 0, bufferMi: 3 });
    expect(r.status).toBe("info");
    expect(r.summary).toMatch(/outside the likely FAA Part 77 neighborhood/);
  });
  it("raises a Part 77 caution when a runway (AD) airport is within the caution radius", () => {
    const scr = {
      nearest: { attrs: { NAME: "SOME HELIPORT", TYPE_CODE: "HP" }, distFt: 1000 },
      ranked: [
        { attrs: { NAME: "SOME HELIPORT", TYPE_CODE: "HP" }, distFt: 1000 },
        { attrs: { NAME: "WILLIAM P HOBBY", TYPE_CODE: "AD" }, distFt: 8000 }, // runway airport, within cautionFt
      ],
    };
    const r = summarizeAirports(scr, { total: 2, bufferMi: 3, cautionFt: 10560 });
    // the runway airport is the headline (the Part 77 concern), not the closer heliport
    expect(r.summary).toMatch(/Nearest airport .*: WILLIAM P HOBBY/);
    expect(r.summary).toMatch(/Part 77 height-restriction surfaces/);
    expect(r.summary).toMatch(/Form 7460/);
  });
  it("a distant runway airport → no caution, just the nearest-airfield fact", () => {
    const scr = {
      nearest: { attrs: { NAME: "FAR FIELD", TYPE_CODE: "AD" }, distFt: 14000 },
      ranked: [{ attrs: { NAME: "FAR FIELD", TYPE_CODE: "AD" }, distFt: 14000 }],
    };
    const r = summarizeAirports(scr, { total: 1, bufferMi: 3, cautionFt: 10560 });
    expect(r.summary).toMatch(/Nearest airport .*: FAR FIELD/);
    expect(r.summary).not.toMatch(/Part 77/);
  });
});
