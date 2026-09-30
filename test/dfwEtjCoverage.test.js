/* NEW-1 (DFW ETJ, 2026-09-30) — city limits + ETJ within 50 miles of Dallas.
 *
 * The answers below are RECORDED from the live services on 2026-09-30 (each fixture point was queried
 * before it was written down — see `ui-audit/audit-dfw-etj-coverage.mjs`, which re-asks the same
 * questions of the live endpoints and additionally measures the distinct-city floor). What is under
 * test here is what the APP DOES with those answers, which is where the false-clean lived:
 *
 *   • a point that hits a real ETJ polygon reports THAT ETJ (and only reports it as an ETJ);
 *   • a point that hits two ETJs' shared strip reports BOTH — never one;
 *   • "Unincorporated" is a positive finding only where the ETJ data covers the point;
 *   • a point the ETJ data cannot speak to — or a failed lookup — reads UNAVAILABLE, never unincorporated;
 *   • outside the DFW zone nothing changed (Houston still reads "Unincorporated").
 *
 * Red-proof: on the commit before this item, `etj_collin`/`etj_rockwall`/`etj_denton` do not exist,
 * so the Prosper fixture returns no ETJ and the unincorporated/unavailable fixtures both read
 * "Unincorporated" — every ETJ and unavailable assertion below fails there.
 */
import { describe, it, expect } from "vitest";
import {
  ETJ_SOURCES, etjSourcesForPoint, identifyJurisdiction, formatJurisdictionBadge,
  etjPointCoverage, inDfwZone, distanceMiles, DFW_ZONE, normalizeFeature, cityAreasFromFeatures,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { etjNamesOf } from "../src/workspaces/site-planner/lib/etjNames.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });

// Service needles — each is a substring unique to one registry URL.
const N = {
  county: "Texas_County_Boundaries", city: "Texas_City_Boundaries",
  collin: "fdWXd5OobWR1E3er", rockwall: "9RjmpzvuPPeYSNdf", denton: "oTsZYNubyv7xK5yP", fortworth: "Fort_Worth_ETJ",
};
/* routes: { needle: () => features | throws }. An unrouted service THROWS — a test that forgets to
 * route a service the code asked for must fail loudly, exactly as an unreachable one would. */
function fakeFetch(routes) {
  return async (url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) return { features: respond(url) };
    }
    throw new Error("no route for " + url);
  };
}
const attr = (a) => [{ attributes: a }];
const NONE = () => [];
const ETJ_ALL_EMPTY = { [N.collin]: NONE, [N.rockwall]: NONE, [N.denton]: NONE, [N.fortworth]: NONE };
const ROLES = ["county", "city", "etj"];
const run = (lng, lat, routes) => identifyJurisdiction(lng, lat, { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ROLES });

// ---------------------------------------------------------------------------------------------
describe("routing — every DFW ETJ publisher is reached, and only near its county", () => {
  it("the three new county publishers are registered rows, sourced from the one GIS registry", () => {
    for (const id of ["etj_collin", "etj_rockwall", "etj_denton"]) {
      const row = ETJ_SOURCES.find((s) => s.id === id);
      expect(row, id).toBeTruthy();
      expect(row.url).toBe(GIS_SOURCES[id].serviceUrl);            // one home for the endpoint
      expect(row.roster.length).toBeGreaterThan(3);
      expect(row.dataLastEdited).toMatch(/^\d{4}-\d{2}-\d{2}$/);   // the tooltip states a date, never "current"
    }
  });
  it("a Prosper point (Collin/Denton line) routes to Collin and Denton, never to Houston's H-GAC", () => {
    const ids = etjSourcesForPoint(33.23255, -96.8961).map((s) => s.id);
    expect(ids).toContain("etj_collin");
    expect(ids).toContain("etj_denton");
    expect(ids).not.toContain("etj_hgac");
  });
  it("Houston is untouched: still exactly one ETJ source, none of the DFW servers", () => {
    expect(etjSourcesForPoint(29.76, -95.37).map((s) => s.id)).toEqual(["etj_hgac"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the four coverage fixtures", () => {
  it("downtown Dallas → City of Dallas (city limits, not an ETJ)", async () => {
    const j = await run(-96.7970, 32.7767, {
      [N.county]: () => attr({ CNTY_NM: "Dallas" }), [N.city]: () => attr({ city_name: "Dallas" }), ...ETJ_ALL_EMPTY,
    });
    expect(j.city).toEqual(["Dallas"]);
    expect(j.cityContainment).toBe("in");
    expect(j.etjUnavailable).toBe(false);                    // in a city's limits the ETJ question does not arise
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("City of Dallas · Dallas County");
  });

  it("a point in a KNOWN ETJ (Prosper's, Collin County) → that ETJ, in no city", async () => {
    // Recorded 2026-09-30: (-96.8961, 33.23255) is inside Collin's "Prosper" polygon and in NO TxGIO city.
    const j = await run(-96.8961, 33.23255, {
      [N.county]: () => attr({ CNTY_NM: "Collin" }), [N.city]: NONE,
      ...ETJ_ALL_EMPTY, [N.collin]: () => attr({ CITY: "Prosper" }),
    });
    expect(j.etj).toEqual(["Prosper"]);
    expect(j.cityContainment).toBe("none");
    expect(j.etjUnavailable).toBe(false);                    // a hit is a positive finding wherever it is
    expect(formatJurisdictionBadge(j).text).toBe("City of Prosper ETJ · Collin County");
  });

  it("a point in NO city and NO ETJ in a county whose ETJ set is declared complete → Unincorporated", async () => {
    // Recorded 2026-09-30: (-96.50, 33.10) — Collin County, no TxGIO city, no Collin/Rockwall/Denton/FW ETJ.
    const j = await run(-96.50, 33.10, {
      [N.county]: () => attr({ CNTY_NM: "Collin" }), [N.city]: NONE, ...ETJ_ALL_EMPTY,
    });
    expect(j.etjCoverage.status).toBe("complete");
    expect(j.etjUnavailable).toBe(false);
    expect(j.unincorporated).toBe(true);
    expect(formatJurisdictionBadge(j).text).toBe("Unincorporated · Collin County");
  });

  it("a FORCED FETCH FAILURE reads unavailable — never unincorporated", async () => {
    // Same Collin point as above, but every ETJ service throws.
    const boom = () => { throw new Error("HTTP 503"); };
    const j = await run(-96.50, 33.10, {
      [N.county]: () => attr({ CNTY_NM: "Collin" }), [N.city]: NONE,
      [N.collin]: boom, [N.rockwall]: boom, [N.denton]: boom, [N.fortworth]: boom,
    });
    expect(j.sources.find((s) => s.id === "etj").state).toBe("failed");
    expect(j.etjUnavailable).toBe(true);
    const b = formatJurisdictionBadge(j);
    expect(b.text).not.toMatch(/Unincorporated/);
    expect(b.text).toMatch(/ETJ data unavailable/);
    expect(b.etjUnavailable).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
describe("silence is not a finding — coverage is a claim, checked per county", () => {
  it("a no-hit point in a county we hold no complete ETJ set for reads UNAVAILABLE, not unincorporated", async () => {
    // ~20 mi south-west of downtown, Ellis County — outside every county declared complete.
    const j = await run(-96.95, 32.50, {
      [N.county]: () => attr({ CNTY_NM: "Ellis" }), [N.city]: NONE, ...ETJ_ALL_EMPTY,
    });
    expect(j.etjCoverage.status).toBe("unavailable");
    expect(j.etjUnavailable).toBe(true);
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Outside city limits · ETJ data unavailable · Ellis County");
    expect(b.text).not.toMatch(/Unincorporated/);
  });
  it("an UNKNOWN county is unavailable too (the county lookup failing must not read as complete)", () => {
    expect(etjPointCoverage(32.5, -96.95, []).status).toBe("unavailable");
    expect(etjPointCoverage(32.5, -96.95, undefined).status).toBe("unavailable");
  });
  it("Denton County is deliberately NOT declared complete (its roster omits cities we cannot speak for)", () => {
    expect(etjPointCoverage(33.2, -97.1, ["Denton"]).status).toBe("unavailable");
  });
  it("outside the 50-mile zone nothing changes — a Houston-side unincorporated point still reads Unincorporated", async () => {
    const j = await identifyJurisdiction(-95.9, 29.9, {
      cache: freshCache(), roles: ROLES,
      fetchJson: fakeFetch({ [N.county]: () => attr({ CNTY_NM: "Waller" }), [N.city]: NONE, HGAC_City_ETJ: NONE, Baytown: NONE }),
    });
    expect(j.etjCoverage.status).toBe("n/a");
    expect(j.etjUnavailable).toBe(false);
    expect(formatJurisdictionBadge(j).text).toMatch(/^Unincorporated/);
  });
  it("the zone is 50 miles from Dallas City Hall — inclusive at the centre, exclusive at Houston", () => {
    expect(inDfwZone(DFW_ZONE.lat, DFW_ZONE.lng)).toBe(true);
    expect(inDfwZone(29.76, -95.37)).toBe(false);
    expect(distanceMiles(32.7767, -96.7970, 33.5, -96.7970)).toBeCloseTo(50, 0);
    expect(inDfwZone(33.49, -96.797)).toBe(true);
    expect(inDfwZone(33.52, -96.797)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("overlapping ETJ claims are reported as BOTH, never resolved to one", () => {
  const dentonRow = ETJ_SOURCES.find((s) => s.id === "etj_denton");
  it("Denton County publishes an overlap strip as one feature 'Denton/Cross Roads' → two claims", () => {
    expect(etjNamesOf(dentonRow, "Denton/Cross Roads")).toEqual(["Denton", "Cross Roads"]);
    expect(etjNamesOf(dentonRow, "Denton Div 2/Pilot Point")).toEqual(["Denton", "Pilot Point"]);
    expect(etjNamesOf(dentonRow, "Denton Div 2")).toEqual(["Denton"]);
    expect(normalizeFeature(dentonRow, { CITY: "Dish/Ponder" }).names).toEqual(["Dish", "Ponder"]);
  });
  it("a point in that strip reports BOTH ETJs on the badge", async () => {
    const j = await run(-97.2, 33.2, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE,
      ...ETJ_ALL_EMPTY, [N.denton]: () => attr({ CITY: "Denton/Cross Roads" }),
    });
    expect([...j.etj].sort()).toEqual(["Cross Roads", "Denton"]);
    expect(formatJurisdictionBadge(j).text).toBe("ETJ crosses City of Denton + City of Cross Roads · Denton County");
  });
  it("two publishers each claiming the point are unioned and both reported", async () => {
    const j = await run(-96.93, 33.207, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE,
      ...ETJ_ALL_EMPTY, [N.collin]: () => attr({ CITY: "Prosper" }), [N.denton]: () => attr({ CITY: "Little Elm" }),
    });
    expect([...j.etj].sort()).toEqual(["Little Elm", "Prosper"]);
  });
  it("the area-share path counts an overlap polygon toward EVERY city that claims it", () => {
    const ring = [[-97.20, 33.20], [-97.19, 33.20], [-97.19, 33.21], [-97.20, 33.21]];
    const strip = { rings: [[[-97.25, 33.15], [-97.15, 33.15], [-97.15, 33.25], [-97.25, 33.25], [-97.25, 33.15]]] };
    const res = cityAreasFromFeatures(dentonRow, [{ attrs: { CITY: "Denton/Cross Roads" }, geometry: strip }], [ring], [-97.195, 33.205]);
    expect(res.rows.map((r) => r.name).sort()).toEqual(["Cross Roads", "Denton"]);
    for (const r of res.rows) expect(r.share).toBeGreaterThan(0.99);
  });
});

// ---------------------------------------------------------------------------------------------
describe("naming rules are data, and never invent a name", () => {
  const collin = ETJ_SOURCES.find((s) => s.id === "etj_collin");
  it("Collin's neighbour-county prefixes are stripped", () => {
    expect(etjNamesOf(collin, "GraysonCo-Howe")).toEqual(["Howe"]);
    expect(etjNamesOf(collin, "HuntCo-Greenville")).toEqual(["Greenville"]);
    expect(etjNamesOf(collin, "McKinney")).toEqual(["McKinney"]);   // mixed case is preserved, not title-cased
  });
  it("an empty or missing name is [] (or the source constant) — never a made-up name", () => {
    expect(etjNamesOf(collin, "")).toEqual([]);
    expect(etjNamesOf(collin, null)).toEqual([]);
    expect(etjNamesOf({ nameConst: "Austin" }, null)).toEqual(["Austin"]);
  });
  it("H-GAC's ALL-CAPS names still title-case (behaviour unchanged for Houston)", () => {
    expect(etjNamesOf(ETJ_SOURCES.find((s) => s.id === "etj_hgac"), "MISSOURI CITY")).toEqual(["Missouri City"]);
  });
});
