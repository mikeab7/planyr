/* NEW-2 (DFW ETJ gaps, 2026-09-30) — the second sweep: Dallas, Ellis, Johnson/Tarrant-side, Grayson, Kaufman-side
 * and Navarro-side publishers, a fresher Fort Worth copy, and the rules that keep every county we still cannot
 * see reading "ETJ data unavailable".
 *
 * Recorded answers are from the live services, 2026-09-30 (each fixture point was verified to be inside the
 * row's ETJ polygon and in no TxGIO city — see SOURCE_FIXTURES and `ui-audit/audit-dfw-etj-gaps.mjs`).
 * What is under test is what the APP does with them:
 *   • every fixture point is actually ROUTED to its own source (a bbox typo would make a source unreachable
 *     and nothing else would notice);
 *   • each publisher's name column becomes the right city;
 *   • polygons a spatial join could not confirm are withheld from BOTH the identify and the drawn layer;
 *   • no new row claims a county complete, so every county without a table stays "unavailable";
 *   • a routed source that FAILS blocks a "no ETJ" finding even when another source answered.
 */
import { describe, it, expect } from "vitest";
import {
  ETJ_SOURCES, etjSourcesForPoint, identifyJurisdiction, formatJurisdictionBadge, etjPointCoverage,
  buildIdentifyParams,
} from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { VECTOR_SOURCES, fetchVectorFeatures } from "../src/workspaces/site-planner/lib/vectorLayers.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { SOURCE_FIXTURES } from "../src/shared/gis/sourceFixtures.js";

function makeStore() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k), get length() { return map.size; }, key: (i) => Array.from(map.keys())[i] ?? null };
}
const freshCache = () => createGisCache({ store: makeStore(), now: () => 1_000_000 });
const needleOf = (id) => new URL(ETJ_SOURCES.find((s) => s.id === id).url).pathname;
const row = (id) => ETJ_SOURCES.find((s) => s.id === id);
const NONE = () => [];
const attr = (a) => [{ attributes: a }];
const ETJ_ALL_EMPTY = Object.fromEntries(ETJ_SOURCES.map((s) => [needleOf(s.id), NONE]));
function fakeFetch(routes, seen = []) {
  return async (url) => {
    seen.push(url);
    for (const [needle, respond] of Object.entries(routes)) if (url.includes(needle)) return { features: respond(url) };
    throw new Error("no route for " + url);
  };
}
const ROLES = ["county", "city", "etj"];
const run = (lng, lat, routes, seen) => identifyJurisdiction(lng, lat, { cache: freshCache(), fetchJson: fakeFetch(routes, seen), roles: ROLES });

const NEW_IDS = ["etj_dallasco", "etj_ellis", "etj_waxahachie", "etj_johnson", "etj_grayson", "etj_corsicana", "etj_bloominggrove", "etj_forney", "etj_talty", "etj_mansfield", "etj_sunnyvale"];

// ---------------------------------------------------------------------------------------------
describe("every new publisher is a real, routed, fixture-backed registry row", () => {
  it("each has a registry row, an ETJ_SOURCES row on the SAME url, a publisher date, and two fixture points", () => {
    for (const id of NEW_IDS) {
      expect(GIS_SOURCES[id], id).toBeTruthy();
      expect(row(id), id).toBeTruthy();
      expect(row(id).url).toBe(GIS_SOURCES[id].serviceUrl);
      expect(GIS_SOURCES[id].dataLastEdited).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(GIS_SOURCES[id].layerId, `${id}: the URL already carries the layer index`).toBeNull();
      expect(SOURCE_FIXTURES[id].fixtures.length, id).toBeGreaterThanOrEqual(2);
    }
  });
  it("EVERY fixture point of EVERY ETJ row is routed to its own source (a bbox typo would strand a publisher)", () => {
    const ids = ["etj_fortworth", "etj_collin", "etj_rockwall", "etj_denton", ...NEW_IDS];
    for (const id of ids) {
      for (const f of SOURCE_FIXTURES[id].fixtures) {
        const [lng, lat] = f.point;
        expect(etjSourcesForPoint(lat, lng).map((s) => s.id), `${id} @ ${f.label}`).toContain(id);
      }
    }
  });
  it("Houston is still exactly one query — none of the DFW publishers is routed there", () => {
    expect(etjSourcesForPoint(29.76, -95.37).map((s) => s.id)).toEqual(["etj_hgac"]);
  });
});

// ---------------------------------------------------------------------------------------------
describe("each publisher's recorded answer becomes the right ETJ on the badge", () => {
  // [id, county, point, the attribute row the service returns there, expected ETJ names]
  const CASES = [
    ["etj_dallasco", "Dallas", [-96.60143, 32.62008], { City: "Seagoville" }, ["Seagoville"]],
    ["etj_ellis", "Ellis", [-96.99026, 32.29932], { Municipality: "Maypearl" }, ["Maypearl"]],
    ["etj_waxahachie", "Ellis", [-96.98737, 32.35429], {}, ["Waxahachie"]],
    ["etj_johnson", "Tarrant", [-97.31302, 32.46665], { NAME: "BURLESON" }, ["Burleson"]],   // ALL-CAPS → title case
    ["etj_grayson", "Collin", [-96.72999, 33.4627], { ETJ: "GUNTER" }, ["Gunter"]],
    ["etj_corsicana", "Navarro", [-96.54482, 32.04061], {}, ["Corsicana"]],
    ["etj_bloominggrove", "Navarro", [-96.73338, 32.09668], {}, ["Blooming Grove"]],
    ["etj_forney", "Kaufman", [-96.49598, 32.72267], {}, ["Forney"]],
    ["etj_talty", "Kaufman", [-96.43106, 32.69943], {}, ["Talty"]],
    ["etj_mansfield", "Tarrant", [-97.20516, 32.58534], {}, ["Mansfield"]],
    ["etj_sunnyvale", "Dallas", [-96.56529, 32.83034], {}, ["Sunnyvale"]],
  ];
  for (const [id, county, [lng, lat], a, want] of CASES) {
    it(`${id}: ${want.join(" + ")} ETJ at (${lng}, ${lat})`, async () => {
      const j = await run(lng, lat, {
        "Texas_County_Boundaries": () => attr({ CNTY_NM: county }), "Texas_City_Boundaries": NONE,
        ...ETJ_ALL_EMPTY, [needleOf(id)]: () => attr(a),
      });
      expect(j.etj).toEqual(want);
      expect(j.etjUnavailable).toBe(false);                              // a real hit is a positive finding
      expect(formatJurisdictionBadge(j).text).toMatch(new RegExp(`City of ${want[0]} ETJ`));
      expect(formatJurisdictionBadge(j).text).not.toMatch(/Unincorporated/);
    });
  }
});

// ---------------------------------------------------------------------------------------------
describe("Dallas County: polygons whose name a spatial join could not confirm are WITHHELD, never guessed", () => {
  it("the withheld OBJECTIDs and the query filter are the same list", () => {
    const g = GIS_SOURCES.etj_dallasco;
    const m = /NOT IN \(([\d,\s]+)\)/.exec(g.where);
    expect(m[1].split(",").map(Number)).toEqual(g.withheld.objectIds);
    expect(g.withheld.objectIds).toHaveLength(10);
    expect(g.withheld.reason).toMatch(/spatial join/);
  });
  it("the filter rides the IDENTIFY query …", () => {
    const p = buildIdentifyParams(row("etj_dallasco"), { lng: -96.6, lat: 32.62 });
    expect(p.where).toBe(GIS_SOURCES.etj_dallasco.where);
    expect(buildIdentifyParams(row("etj_collin"), { lng: -96.6, lat: 33.1 }).where).toBeUndefined();   // others untouched
  });
  it("… and the DRAWN layer's request for that service, so the picture and the answer cannot disagree", async () => {
    const urls = [];
    const fetchJson = async (u) => { urls.push(u); return { features: [] }; };
    await fetchVectorFeatures(VECTOR_SOURCES.jur_etj, { w: -96.9, s: 32.5, e: -96.4, n: 33.0 }, { fetchJson, tier: null });
    const dallas = urls.find((u) => u.includes("Dallas_County_ETJ"));
    expect(dallas).toBeTruthy();
    expect(decodeURIComponent(dallas).replace(/\+/g, " ")).toContain("OBJECTID NOT IN (8,14,68,69,71,72,157,159,161,162)");
    const collin = urls.find((u) => u.includes("fdWXd5OobWR1E3er"));
    expect(decodeURIComponent(collin)).toContain("where=1=1");   // every other publisher is unfiltered
  });
});

// ---------------------------------------------------------------------------------------------
describe("counties we cannot fully see keep reading UNAVAILABLE — only two are declared complete", () => {
  // The 19 counties the 50-mile circle touches (computed from TxDOT county polygons, 2026-09-30).
  const TOUCHED = ["Ellis", "Denton", "Dallas", "Tarrant", "Collin", "Kaufman", "Johnson", "Hunt", "Navarro", "Van Zandt",
    "Parker", "Grayson", "Wise", "Hill", "Rockwall", "Henderson", "Cooke", "Fannin", "Rains"];
  const COMPLETE = ["Collin", "Rockwall"];
  // A point INSIDE each complete county (the rule needs that county's own source routed there).
  const INSIDE = { Collin: [33.10, -96.50], Rockwall: [32.90, -96.40] };
  for (const c of TOUCHED) {
    it(`${c} County: ${COMPLETE.includes(c) ? "complete" : "unavailable"} for a point that hits no city and no ETJ`, () => {
      const [lat, lng] = INSIDE[c] || [32.8, -96.8];
      expect(etjPointCoverage(lat, lng, [c]).status).toBe(COMPLETE.includes(c) ? "complete" : "unavailable");
    });
  }
  it("no row added by this sweep declares a county complete (each is a compile, not the county's own full table)", () => {
    for (const id of NEW_IDS) expect(GIS_SOURCES[id].completeCounties, id).toBeUndefined();
    expect(ETJ_SOURCES.flatMap((s) => s.completeCounties || []).sort()).toEqual(["Collin", "Rockwall"]);
  });
  it("a Kaufman County point in no city and no ETJ (Forney/Talty answer only where they have a polygon) reads unavailable", async () => {
    const j = await run(-96.30, 32.62, {
      "Texas_County_Boundaries": () => attr({ CNTY_NM: "Kaufman" }), "Texas_City_Boundaries": NONE, ...ETJ_ALL_EMPTY,
    });
    expect(j.etjUnavailable).toBe(true);
    expect(formatJurisdictionBadge(j).text).toBe("Outside city limits · ETJ data unavailable · Kaufman County");
  });
});

// ---------------------------------------------------------------------------------------------
describe("a routed source that FAILS blocks a 'no ETJ' finding, even when another source answered", () => {
  const collinNone = { "Texas_County_Boundaries": () => attr({ CNTY_NM: "Collin" }), "Texas_City_Boundaries": NONE };
  it("control: every routed source healthy and empty, complete county → Unincorporated", async () => {
    const j = await run(-96.50, 33.10, { ...collinNone, ...ETJ_ALL_EMPTY });
    expect(j.etjSourceErrors).toEqual([]);
    expect(formatJurisdictionBadge(j).text).toBe("Unincorporated · Collin County");
  });
  it("ONE routed source (Rockwall's) throws while the rest answer empty → unavailable, naming the source", async () => {
    const boom = () => { throw new Error("HTTP 503"); };
    const j = await run(-96.50, 33.10, { ...collinNone, ...ETJ_ALL_EMPTY, [needleOf("etj_rockwall")]: boom });
    expect(j.sources.find((s) => s.id === "etj").state).not.toBe("failed");   // the role as a whole DID answer
    expect(j.etjSourceErrors).toContain("etj_rockwall");
    expect(j.etjUnavailable).toBe(true);
    expect(formatJurisdictionBadge(j).text).toMatch(/ETJ data unavailable/);
    expect(formatJurisdictionBadge(j).text).not.toMatch(/Unincorporated/);
  });
  it("…but a real hit from a healthy source is still reported (an error never erases a positive finding)", async () => {
    const boom = () => { throw new Error("HTTP 503"); };
    const j = await run(-96.8961, 33.23255, { ...collinNone, ...ETJ_ALL_EMPTY, [needleOf("etj_collin")]: () => attr({ CITY: "Prosper" }), [needleOf("etj_rockwall")]: boom });
    expect(j.etj).toEqual(["Prosper"]);
    expect(j.etjUnavailable).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
describe("the drawn ETJ layer fans out only to what the view needs, and does not blank a metro on one blip", () => {
  const DFW = { w: -97.2, s: 32.4, e: -96.4, n: 33.4 };
  const HOUSTON = { w: -95.5, s: 29.6, e: -95.2, n: 29.9 };
  it("a Houston view never touches a DFW publisher", async () => {
    const urls = [];
    await fetchVectorFeatures(VECTOR_SOURCES.jur_etj, HOUSTON, { fetchJson: async (u) => { urls.push(u); return { features: [] }; } });
    expect(urls.length).toBeGreaterThan(0);
    for (const id of [...NEW_IDS, "etj_collin", "etj_denton", "etj_rockwall"]) {
      const path = new URL(row(id).url).pathname;
      expect(urls.some((u) => u.includes(path)), id).toBe(false);
    }
  });
  it("a DFW view asks every DFW publisher whose box it meets, and normalises every feature to { CITY, _src }", async () => {
    const seen = [];
    const fetchJson = async (u) => {
      seen.push(u);
      if (u.includes("CityETJPermits_GC")) return { features: [{ attributes: { NAME: "Undetermined", TYPE: "ETJ", CITY: "Denton/Cross Roads" }, geometry: { rings: [[[-97, 33], [-96.9, 33], [-96.9, 33.1], [-97, 33]]] } }] };
      return { features: [] };
    };
    const { features } = await fetchVectorFeatures(VECTOR_SOURCES.jur_etj, DFW, { fetchJson });
    for (const id of ["etj_collin", "etj_denton", "etj_dallasco", "etj_ellis", "etj_johnson", "etj_fortworth", "etj_mansfield"]) {
      expect(seen.some((u) => u.includes(new URL(row(id).url).pathname)), id).toBe(true);
    }
    expect(features).toHaveLength(1);
    expect(features[0].attributes).toEqual({ CITY: "Undetermined (disputed)", _src: "etj_denton", _undetermined: true, CLAIMANTS: "Denton / Cross Roads" });   // disputed: no city named, claimants kept as claims
  });
  it("one transient failure is retried once and the pull succeeds", async () => {
    let n = 0;
    const fetchJson = async (u) => { if (u.includes("Dallas_County_ETJ") && n++ === 0) throw new Error("HTTP 503"); return { features: [] }; };
    await expect(fetchVectorFeatures(VECTOR_SOURCES.jur_etj, DFW, { fetchJson, retryDelayMs: 0 })).resolves.toBeTruthy();
    expect(n).toBe(2);
  });
  it("a service that keeps failing FAILS the whole pull — a partial answer must never be cached as 'no ETJ'", async () => {
    const fetchJson = async (u) => { if (u.includes("Dallas_County_ETJ")) throw new Error("HTTP 503"); return { features: [] }; };
    await expect(fetchVectorFeatures(VECTOR_SOURCES.jur_etj, DFW, { fetchJson, retryDelayMs: 0 })).rejects.toThrow(/503/);
  });
});

// ---------------------------------------------------------------------------------------------
describe("Fort Worth: the city's own current layer, and SB 2038 release areas that never read as plain ETJ", () => {
  const FW = needleOf("etj_fortworth"), REL = needleOf("etj_release_fortworth");
  const tarrant = { "Texas_County_Boundaries": () => attr({ CNTY_NM: "Tarrant" }), "Texas_City_Boundaries": NONE };
  it("Fort Worth's ETJ is the city's own open-data service (81 polygons, edited 2026-09-01), not a copy", () => {
    expect(GIS_SOURCES.etj_fortworth.serviceUrl).toBe("https://mapit.fortworthtexas.gov/ags/rest/services/CIVIC/OpenData_Boundaries/MapServer/1");
    expect(GIS_SOURCES.etj_fortworth.dataLastEdited).toBe("2026-09-01");
    expect(GIS_SOURCES.etj_fortworth.browserVerified).toMatchObject({ date: "2026-09-30", features: 81 });
    expect(GIS_SOURCES.etj_release_fortworth.serviceUrl).toBe("https://mapit.fortworthtexas.gov/ags/rest/services/Planning_Development/PlanningDevelopment/MapServer/120");
    expect(row("etj_release_fortworth").release).toBe(true);
  });
  it("control: inside Fort Worth's ETJ and in no release area → City of Fort Worth ETJ", async () => {
    const j = await run(-97.51286, 32.61144, { ...tarrant, ...ETJ_ALL_EMPTY, [FW]: () => attr({}) });
    expect(j.etj).toEqual(["Fort Worth"]);
    expect(j.etjReleased).toEqual([]);
    expect(formatJurisdictionBadge(j).text).toBe("City of Fort Worth ETJ · Tarrant County");
  });
  it("inside the ETJ polygon AND a release area → NOT a plain ETJ: reported as a release area", async () => {
    const j = await run(-97.51286, 32.61144, { ...tarrant, ...ETJ_ALL_EMPTY, [FW]: () => attr({}), [REL]: () => attr({}) });
    expect(j.etj).toEqual([]);                                   // the city's ETJ hit is withheld
    expect(j.etjReleased).toEqual(["Fort Worth"]);
    expect(j.etjUnavailable).toBe(false);                        // a finding, not a gap
    const b = formatJurisdictionBadge(j);
    expect(b.text).toBe("Fort Worth ETJ release area (SB 2038) · Tarrant County");
    expect(b.text).not.toMatch(/Unincorporated|City of Fort Worth ETJ/);
  });
  it("in a release area the ETJ layer no longer draws → still a release area, never unincorporated", async () => {
    const j = await run(-97.51286, 32.61144, { ...tarrant, ...ETJ_ALL_EMPTY, [REL]: () => attr({}) });
    expect(formatJurisdictionBadge(j).text).toBe("Fort Worth ETJ release area (SB 2038) · Tarrant County");
  });
  it("a release area alongside a disputed strip keeps both findings", async () => {
    const j = await run(-97.2, 33.05, { ...tarrant, ...ETJ_ALL_EMPTY, [REL]: () => attr({}), [needleOf("etj_denton")]: () => attr({ NAME: "Undetermined", TYPE: "ETJ", CITY: "Denton/Cross Roads" }) });
    expect(formatJurisdictionBadge(j).text).toMatch(/^ETJ undetermined \(disputed\) · Fort Worth ETJ release area \(SB 2038\)/);
  });
  it("the parcel-share pass never asks the release layer for geometry (it is not ETJ membership)", async () => {
    const seen = [];
    const ring = [[-97.52, 32.60], [-97.50, 32.60], [-97.50, 32.62], [-97.52, 32.62]];
    await identifyJurisdiction(-97.51, 32.61, {
      cache: freshCache(), roles: ROLES, ring, rings: [ring],
      fetchJson: fakeFetch({ ...tarrant, ...ETJ_ALL_EMPTY, [FW]: () => [], [REL]: () => attr({}) }, seen),
    });
    const relUrls = seen.filter((u) => u.includes(REL));
    expect(relUrls.length).toBeGreaterThan(0);                   // it IS consulted …
    expect(relUrls.some((u) => u.includes("returnGeometry=true"))).toBe(false);   // … but never measured as membership
  });
  it("the drawn layer names and marks a release area so it can be styled DOTTED (line style, not opacity)", async () => {
    const fetchJson = async (u) => (u.includes(REL) ? { features: [{ attributes: {}, geometry: { rings: [[[-97.5, 32.6], [-97.4, 32.6], [-97.4, 32.7], [-97.5, 32.6]]] } }] } : { features: [] });
    const { features } = await fetchVectorFeatures(VECTOR_SOURCES.jur_etj, { w: -97.7, s: 32.4, e: -97.1, n: 33.1 }, { fetchJson, retryDelayMs: 0 });
    expect(features).toHaveLength(1);
    expect(features[0].attributes).toEqual({ CITY: "Fort Worth ETJ release area (SB 2038)", _src: "etj_release_fortworth", _release: true });
  });
});
