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
  etjPointCoverage, inDfwZone, distanceMiles, DFW_ZONE, normalizeFeature, cityAreasFromFeatures, buildIdentifyParams,
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

// Service needles — each is the URL PATH of one registry row, so a needle can only ever match that row.
const needleOf = (id) => new URL(ETJ_SOURCES.find((s) => s.id === id).url).pathname;
const N = {
  county: "Texas_County_Boundaries", city: "Texas_City_Boundaries",
  collin: needleOf("etj_collin"), rockwall: needleOf("etj_rockwall"), denton: needleOf("etj_denton"), fortworth: needleOf("etj_fortworth"),
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
// EVERY registered ETJ service answers "nothing here" unless a test overrides it. Built from the registry, so a
// newly added publisher can never turn these fixtures into "couldn't check" by being un-routed.
const ETJ_ALL_EMPTY = Object.fromEntries(ETJ_SOURCES.map((sx) => [needleOf(sx.id), NONE]));
const ROLES = ["county", "city", "etj"];
const run = (lng, lat, routes) => identifyJurisdiction(lng, lat, { cache: freshCache(), fetchJson: fakeFetch(routes), roles: ROLES });

// ---------------------------------------------------------------------------------------------
describe("routing — every DFW ETJ publisher is reached, and only near its county", () => {
  it("the three new county publishers are registered rows, sourced from the one GIS registry", () => {
    for (const id of ["etj_collin", "etj_rockwall", "etj_denton"]) {
      const row = ETJ_SOURCES.find((s) => s.id === id);
      expect(row, id).toBeTruthy();
      expect(row.url).toBe(GIS_SOURCES[id].serviceUrl);            // one home for the endpoint
      // Collin/Rockwall enumerate their cities; Denton's CURRENT edition was probed from a browser only and its city
      // list was never enumerated, so it declares `rosterUnknown` instead of claiming one (NEW-2).
      if (id === "etj_denton") expect(row.rosterUnknown).toBe(true); else expect(row.roster.length).toBeGreaterThan(3);
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
      ...Object.fromEntries(ETJ_SOURCES.map((sx) => [needleOf(sx.id), boom])),
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
describe("a strip two cities claim is DISPUTED — never assigned to a city, never unincorporated", () => {
  const dentonRow = ETJ_SOURCES.find((s) => s.id === "etj_denton");
  // Denton County's own word (recorded 2026-09-30 from the 2022 edition that carries the same four columns): NAME is
  // 'Undetermined', and CITY lists the two CLAIMANTS.
  const UNDET = { NAME: "Undetermined", TYPE: "ETJ", CITY: "Denton/Cross Roads", INC_MUNI: null };
  it("normalizeFeature flags it, names NO city, and keeps the claimants as claims", () => {
    const n = normalizeFeature(dentonRow, UNDET);
    expect(n.undetermined).toBe(true);
    expect(n.name).toBeNull();
    expect(n.names).toEqual([]);
    expect(n.claimants).toEqual(["Denton", "Cross Roads"]);
    expect(normalizeFeature(dentonRow, { NAME: "Denton Div 2/Sanger".split("/")[0], TYPE: "DIV 2", CITY: "Denton" }).undetermined).toBeUndefined();
  });
  it("a point in a disputed strip: the ETJ list stays EMPTY, the strip is reported as undetermined, and it is not 'Unincorporated'", async () => {
    const j = await run(-97.2, 33.2, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE, ...ETJ_ALL_EMPTY, [N.denton]: () => attr(UNDET),
    });
    expect(j.etj).toEqual([]);                                   // never assigned to Denton OR Cross Roads
    expect(j.etjUndetermined).toEqual([{ source: "etj_denton", claimants: ["Denton", "Cross Roads"] }]);
    expect(j.etjUnavailable).toBe(false);                        // it is a finding, not a gap
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("ETJ undetermined (disputed) · Denton County");
    expect(b.text).not.toMatch(/Unincorporated|City of/);
    expect(b.governingCities).toEqual([]);
  });
  it("'DIV 2' is a Denton ETJ division: it reads as Denton ETJ, and TYPE is not filtered on", async () => {
    const j = await run(-97.15, 33.21, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE, ...ETJ_ALL_EMPTY,
      [N.denton]: () => attr({ NAME: "Denton", TYPE: "DIV 2", CITY: "Denton", INC_MUNI: null }),
    });
    expect(j.etj).toEqual(["Denton"]);
    expect(j.etjUndetermined).toEqual([]);
    expect(formatJurisdictionBadge(j).text).toBe("City of Denton ETJ · Denton County");
    expect(buildIdentifyParams(dentonRow, { lng: -97.15, lat: 33.21 }).where).toBeUndefined();   // no TYPE filter
  });
  it("a disputed strip ALONGSIDE a named ETJ keeps both facts, each in its own words", async () => {
    const j = await run(-96.93, 33.207, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE, ...ETJ_ALL_EMPTY,
      [N.collin]: () => attr({ CITY: "Prosper" }), [N.denton]: () => attr(UNDET),
    });
    expect(j.etj).toEqual(["Prosper"]);
    expect(formatJurisdictionBadge(j).text).toBe("City of Prosper ETJ · another ETJ claim undetermined (disputed) · Denton County");
  });
  it("two PUBLISHERS each claiming the point are still unioned and both reported (only Denton's own 'Undetermined' is withheld)", async () => {
    const j = await run(-96.93, 33.207, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE,
      ...ETJ_ALL_EMPTY, [N.collin]: () => attr({ CITY: "Prosper" }), [N.denton]: () => attr({ NAME: "Little Elm", TYPE: "ETJ", CITY: "Little Elm" }),
    });
    expect([...j.etj].sort()).toEqual(["Little Elm", "Prosper"]);
  });
  it("an ETJ feature whose name cannot be read is flagged undetermined — never dropped (silence would read as 'no ETJ')", async () => {
    const j = await run(-97.2, 33.2, {
      [N.county]: () => attr({ CNTY_NM: "Denton" }), [N.city]: NONE, ...ETJ_ALL_EMPTY, [N.denton]: () => attr({ NAME: "", TYPE: "ETJ", CITY: "" }),
    });
    expect(j.etj).toEqual([]);
    expect((j.etjUndetermined || []).length).toBe(1);
    expect(formatJurisdictionBadge(j).text).toMatch(/^ETJ undetermined \(disputed\)/);
  });
  it("the parcel-share pass counts a disputed polygon toward NO city", () => {
    const ring = [[-97.20, 33.20], [-97.19, 33.20], [-97.19, 33.21], [-97.20, 33.21]];
    const strip = { rings: [[[-97.25, 33.15], [-97.15, 33.15], [-97.15, 33.25], [-97.25, 33.25], [-97.25, 33.15]]] };
    const res = cityAreasFromFeatures(dentonRow, [{ attrs: UNDET, geometry: strip }], [ring], [-97.195, 33.205]);
    expect(res.rows).toEqual([]);
  });
  it("the generic overlap splitter still works for any publisher that declares one (registry data, not code)", () => {
    const row = { nameSplit: "/", nameStrip: ["\\s+Div\\s*\\d+$"] };
    expect(etjNamesOf(row, "Denton/Cross Roads")).toEqual(["Denton", "Cross Roads"]);
    expect(etjNamesOf(row, "Denton Div 2/Pilot Point")).toEqual(["Denton", "Pilot Point"]);
    expect(etjNamesOf(row, "Denton Div 2")).toEqual(["Denton"]);
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
