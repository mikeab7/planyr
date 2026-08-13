import { describe, it, expect } from "vitest";
import {
  CITY_LIMIT_CLASSES, classifyCityLimit, declaredLimitClassing,
  cityLimitLabel, cityLimitGloss, dominantClass,
} from "../src/workspaces/site-planner/lib/cityLimitClass.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { CITY_SOURCES, JURISDICTION_SOURCES, normalizeFeature } from "../src/workspaces/site-planner/lib/jurisdiction.js";

/* ⛔ NEW-1 — "CITY LIMITS" IS THREE JURISDICTION CLASSES, AND A ROW THAT CANNOT SAY WHICH FAILS
 * HERE RATHER THAN ANSWERING BY ASSUMPTION.
 *
 * The generalisation is the half that outlives Baytown: a layer NAMED "city limits" is not required
 * to mean full-purpose limits. Every city-limits source must declare either the field that
 * separates the classes or that it carries only full-purpose polygons — and this suite is where a
 * row that declares neither is caught. */

const BAYTOWN = CITY_SOURCES.find((s) => s.id === "city_baytown");

describe("every city-limits source declares how it separates the classes", () => {
  it("⛔ a row declaring neither a class field nor fullPurposeOnly fails its own fixture", () => {
    const undeclared = { id: "city_somewhere", role: "city", fields: { name: "NAME" } };
    const d = declaredLimitClassing(undeclared);
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/declares neither/);
    // …and it may NEVER be read as full-purpose limits, which is the overstatement itself.
    expect(classifyCityLimit(undeclared, { NAME: "Somewhere" }).id).toBe("unknown");
  });

  it("every city source the app actually routes to declares one of the two", () => {
    for (const src of CITY_SOURCES) {
      const d = declaredLimitClassing(src);
      expect(d.ok, `${src.id}: ${d.reason}`).toBe(true);
    }
    expect(declaredLimitClassing(JURISDICTION_SOURCES.city).kind).toBe("full-purpose-only");
    expect(declaredLimitClassing(BAYTOWN).kind).toBe("class-field");
  });

  it("and so does every city-limits row in the shared GIS registry", () => {
    const cityRows = Object.values(GIS_SOURCES).filter((r) => /city limits/i.test(r.label || ""));
    expect(cityRows.length).toBeGreaterThanOrEqual(2);
    for (const row of cityRows) {
      const d = declaredLimitClassing({ ...row, id: row.key });
      expect(d.ok, `${row.key}: ${d.reason}`).toBe(true);
    }
  });
});

describe("classifying Baytown's three classes", () => {
  const c = (attrs) => classifyCityLimit(BAYTOWN, attrs).id;
  it("reads FEATURE, and falls back to NAME/Comment on the one polygon whose FEATURE is null", () => {
    expect(c({ FEATURE: "CITY" })).toBe("full");
    expect(c({ FEATURE: "LIMITED ANNEXATION" })).toBe("limited");
    expect(c({ FEATURE: "StripAnnex" })).toBe("strip");
    // OID 1369: FEATURE null, NAME and Comment both "CITY" (live, 2026-08-12).
    expect(c({ FEATURE: null, NAME: "CITY", Comment: "CITY" })).toBe("full");
  });

  it("an unrecognised value is UNKNOWN, never upgraded to full", () => {
    expect(c({ FEATURE: "SOMETHING NEW" })).toBe("unknown");
    expect(c({})).toBe("unknown");
    expect(CITY_LIMIT_CLASSES.unknown.governsFully).toBe(false);
  });

  it("only the full-purpose class claims the city's whole authority", () => {
    expect(CITY_LIMIT_CLASSES.full.governsFully).toBe(true);
    expect(CITY_LIMIT_CLASSES.limited.governsFully).toBe(false);
    expect(CITY_LIMIT_CLASSES.strip.governsFully).toBe(false);
  });

  it("the class rides normalizeFeature, so it travels with the feature", () => {
    expect(normalizeFeature(BAYTOWN, { FEATURE: "LIMITED ANNEXATION", Unique_ID: "CL-20170711-007" }))
      .toEqual({ role: "city", name: "Baytown", limitClass: "limited", uniqueId: "CL-20170711-007" });
  });
});

describe("the wording — three different amounts of authority, three different nouns", () => {
  it("⛔ 'City of X' is reserved for full-purpose limits", () => {
    expect(cityLimitLabel("Baytown", "full")).toBe("City of Baytown limits");
    expect(cityLimitLabel("Baytown", "limited")).toBe("Baytown limited-purpose annexation");
    expect(cityLimitLabel("Baytown", "strip")).toBe("Baytown strip annexation");
    for (const id of ["limited", "strip", "unknown"]) {
      expect(cityLimitLabel("Baytown", id)).not.toMatch(/^City of Baytown$/);
    }
  });

  it("the plain-English explanation names the city and is NOT the badge", () => {
    expect(cityLimitGloss("Baytown", "limited")).toMatch(/annexed this land for SOME purposes only/);
    expect(cityLimitGloss("Baytown", "limited").length).toBeGreaterThan(cityLimitLabel("Baytown", "limited").length);
  });

  it("the strongest class present leads", () => {
    expect(dominantClass(["strip", "limited", "full"])).toBe("full");
    expect(dominantClass(["strip", "limited"])).toBe("limited");
    expect(dominantClass([])).toBe(null);
  });
});
