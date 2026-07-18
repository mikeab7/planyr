/* CCN screening classifier (public-data screening PHASE 1) — pure unit tests.
 * Utility-kind inference from the provider name + the water/sewer finding classifier. */
import { describe, it, expect } from "vitest";
import {
  inferUtilityType, describeHolder, ccnHolders, classifyCcn, CCN_UTILITY_TYPES,
} from "../src/workspaces/site-planner/lib/ccnClassify.js";
import { gisSource } from "../src/shared/gis/sources.js";

describe("inferUtilityType — provider kind from the UTILITY name (no field encodes it)", () => {
  // Real names pulled live from the PUC CCN layers near Katy/Cypress.
  it("classifies the common Texas provider kinds", () => {
    expect(inferUtilityType("CITY OF KATY").kind).toBe("city");
    expect(inferUtilityType("NORTHWEST HARRIS COUNTY MUD 25").kind).toBe("mud");
    expect(inferUtilityType("HARRIS COUNTY WCID 89").kind).toBe("wcid");
    expect(inferUtilityType("FORT BEND COUNTY FWSD 1").kind).toBe("fwsd");
    expect(inferUtilityType("KINGSLAND ESTATES WSC").kind).toBe("wsc");
    expect(inferUtilityType("AQUA TEXAS INC").kind).toBe("investor");
    expect(inferUtilityType("TEXAS WATER UTILITIES LP").kind).toBe("investor");
    expect(inferUtilityType("UNDINE TEXAS LLC").kind).toBe("investor");
    expect(inferUtilityType("KATY-HOCKLEY CORP").kind).toBe("investor");
  });

  it("a plain district name falls to the generic district kind, not investor", () => {
    expect(inferUtilityType("SOME REGIONAL WATER DISTRICT").kind).toBe("district");
  });

  it("empty / null / unrecognized → the honest 'other' kind, never a throw", () => {
    expect(inferUtilityType("").kind).toBe("other");
    expect(inferUtilityType(null).kind).toBe("other");
    expect(inferUtilityType(undefined).kind).toBe("other");
    expect(inferUtilityType("Zzxy").kind).toBe("other");
  });

  it("every type entry carries a plain-language label", () => {
    for (const t of CCN_UTILITY_TYPES) expect(t.label).toMatch(/^a[n]? /);
  });

  it("describeHolder pairs the name with its kind label", () => {
    expect(describeHolder("CITY OF KATY")).toBe("CITY OF KATY (a city)");
    expect(describeHolder("")).toBe("Unnamed utility (a utility)");
  });
});

describe("ccnHolders — distinct non-empty provider names (straddle-aware)", () => {
  it("dedupes and drops blanks", () => {
    expect(ccnHolders([{ UTILITY: "CITY OF KATY" }, { UTILITY: "CITY OF KATY" }, { UTILITY: "" }, { UTILITY: "AQUA TEXAS INC" }]))
      .toEqual(["CITY OF KATY", "AQUA TEXAS INC"]);
    expect(ccnHolders([])).toEqual([]);
    expect(ccnHolders(null)).toEqual([]);
  });
});

describe("classifyCcn — CCN is a FACT (info), never a good/bad constraint", () => {
  it("no holder (water) → an honest well/new-CCN flag, not a green all-clear", () => {
    const c = classifyCcn([], { service: "water" });
    expect(c.status).toBe("info");
    expect(c.summary).toMatch(/No certificated water provider/i);
    expect(c.summary).not.toMatch(/Houston region/); // statewide source → no regional hedge
    expect(c.detail).toEqual([]);
  });

  it("no holder (sewer, regional) → hedged for out-of-coverage", () => {
    const c = classifyCcn([], { service: "sewer", regional: true });
    expect(c.status).toBe("info");
    expect(c.summary).toMatch(/No certificated sewer provider/i);
    expect(c.summary).toMatch(/Houston region/i); // regional → the out-of-coverage hedge is present
  });

  it("one holder → 'Water service: <utility> (<kind>)' with a CCN detail line", () => {
    const c = classifyCcn([{ UTILITY: "NORTHWEST HARRIS COUNTY MUD 25", STATUS: "Commission Approved", CCN_NO: "13215" }], { service: "water" });
    expect(c.status).toBe("info");
    expect(c.summary).toBe("Water service: NORTHWEST HARRIS COUNTY MUD 25 (a MUD (municipal utility district))");
    expect(c.detail[0]).toMatch(/Commission Approved/);
    expect(c.detail[0]).toMatch(/CCN 13215/);
  });

  it("multiple holders → straddle summary listing the providers", () => {
    const c = classifyCcn([{ UTILITY: "CITY OF KATY" }, { UTILITY: "AQUA TEXAS INC" }], { service: "water" });
    expect(c.summary).toMatch(/2 certificated water providers/i);
    expect(c.summary).toMatch(/site straddles/i);
  });

  it("a pending-docket certificate is flagged as not-yet-final", () => {
    const c = classifyCcn([{ UTILITY: "UNDINE TEXAS LLC", STATUS: "Pending Final Order Docket No. 53459" }], { service: "water" });
    expect(c.summary).toMatch(/pending PUC docket/i);
  });
});

describe("CCN registry rows (PHASE 1) — endpoints + coverage guards", () => {
  it("water CCN is the STATEWIDE TWDB source with a coverage fixture", () => {
    const w = gisSource("ccnWater");
    expect(w.serviceUrl).toMatch(/services3\.arcgis\.com/);
    expect(w.serviceUrl).toMatch(/PUC_CCN_2023Dec/);
    expect(w.coverage).toBe("statewide");
    expect(w.tier).toBe("production");
    expect(w.fields.utility).toBe("UTILITY");
    expect(w.fixtures.some((f) => f.expectMinCount >= 1 && Array.isArray(f.point))).toBe(true);
  });

  it("sewer CCN rides the Harris County re-serve (layer 2), documented regional", () => {
    const s = gisSource("ccnSewer");
    expect(s.serviceUrl).toMatch(/gis\.hctx\.net/);
    expect(s.layerId).toBe(2);
    expect(s.coverage).toMatch(/Houston metro region/i);
    expect(s.tier).toBe("production");
    expect(s.fixtures.length).toBeGreaterThanOrEqual(1);
  });
});
