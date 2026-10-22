/* NEW-1 (New York, 2026-10-20) — every one of New York's 62 counties resolves to a REAL outcome: the statewide public layer (38 counties, the five NYC
 * boroughs among them), a county row wired here, or an explicit, named gap ("<County> — no parcel data wired here yet."). Never a county that is
 * silently empty.
 *
 * RED-PROOF: on main (eccb06e) ny_statewide answered for all 62 counties, so a click in any of the 24 counties it does not hold fell to an empty layer.
 * `git stash`-ing counties.js's nyRaw/nyMap spread and NY_UNCOVERED exclusion turns every "wired" and "gap" case below red. The county list is the
 * Census-derived polygon asset (fixture header), never hand-picked. Adding a county to `gaps` in the fixture is a claim (docs/STATEWIDE-PARCELS.md
 * "New York counties (2026-10-20)" records what was searched); removing one requires wiring it. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, statewideExcludesCounty, candidateCountiesForPoint, displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { NY_ROWS, NY_UNCOVERED } from "../src/workspaces/site-planner/lib/nyParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/newYorkCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/newYorkSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "ny_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const GAPS = new Set(FX.gaps);
const UNCOVERED = new Set(NY_UNCOVERED);
/* MEASURED 2026-10-20 from the statewide layer's Footprint layer (/0) and a per-county count of /1: the 38 counties it holds. */
const STATEWIDE = ["Albany", "Bronx", "Broome", "Cayuga", "Chautauqua", "Cortland", "Erie", "Genesee", "Greene", "Hamilton", "Kings", "Lewis", "Livingston", "Montgomery", "New York", "Oneida", "Onondaga", "Ontario", "Orange", "Oswego", "Otsego", "Putnam", "Queens", "Rensselaer", "Richmond", "Rockland", "Schuyler", "St. Lawrence", "Steuben", "Suffolk", "Sullivan", "Tioga", "Tompkins", "Ulster", "Warren", "Wayne", "Westchester", "Wyoming"];

describe("the computed county list", () => {
  it("is New York's 62 counties", () => {
    expect(FX.counties).toHaveLength(62);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["NY"]));
  });
  it("every county is exactly one of: held by the statewide layer · wired here · a named gap", () => {
    expect(STATEWIDE).toHaveLength(38);
    expect(NY_UNCOVERED).toHaveLength(24);
    for (const c of FX.counties) {
      const n = bare(c.name);
      const inStatewide = STATEWIDE.includes(n);
      const uncovered = UNCOVERED.has(n);
      const wired = slugOf(c.name) in COUNTIES;
      expect(inStatewide !== uncovered, `${n}: statewide xor uncovered`).toBe(true);
      expect(wired, `${n}: wired iff uncovered and not a gap`).toBe(uncovered && !GAPS.has(n));
    }
  });
});

describe("a point inside each New York county resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    const n = bare(c.name);
    if (STATEWIDE.includes(n)) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey).toBe("ny_statewide");
    } else if (GAPS.has(n)) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow the statewide layer, which holds none of it").toBeUndefined();
      expect(noParcelSourceNote(id)).toContain(c.name);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(slugOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("NY");
    }
  });
});

describe("the statewide layer is never asked about a county it does not hold", () => {
  it("excludes exactly the 24 uncovered counties", () => {
    for (const c of FX.counties) {
      const n = bare(c.name);
      expect(statewideExcludesCounty("ny_statewide", c.name), n).toBe(UNCOVERED.has(n));
    }
  });
  it("a click in a wired county does not list ny_statewide as a candidate, and a click in an NYC borough still does", () => {
    const at = (name) => FX.counties.find((c) => c.name === name);
    for (const n of ["Nassau", "Monroe", "Saratoga", "Dutchess"]) {
      const c = at(n + " County");
      expect(candidateCountiesForPoint(c.lat, c.lng), n).not.toContain("ny_statewide");
      expect(candidateCountiesForPoint(c.lat, c.lng), n).toContain(slugOf(c.name));
    }
    for (const n of ["Bronx", "Kings", "New York", "Queens", "Richmond"]) {
      const c = at(n + " County");
      expect(candidateCountiesForPoint(c.lat, c.lng), n).toContain("ny_statewide");
    }
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l, i) => [`${l.name} #${i}`, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("NY");
  });
});

describe("the New York / New Jersey line routes each side to its own state", () => {
  it.each(FX.cross.map((x, i) => [`${x.county} (${x.state}) across from ${x.across} #${i}`, x]))("%s", (_n, x) => {
    const id = countyIdentity(x.lat, x.lng);
    expect(id.state).toBe(x.state);
    expect(id.name).toBe(x.county);
    if (x.state === "NJ") {
      expect(COUNTIES_MAP[id.key || ""]?.state ?? "NJ").toBe("NJ");
      expect(id.statewideKey ?? "nj_statewide").not.toBe("ny_statewide");
    }
  });
});

describe("the wired New York rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of NY_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no two counties share a layer unless each is scoped to its own rows", () => {
    const seen = new Map();
    for (const [k, , u, , , where] of NY_ROWS) {
      const list = seen.get(u) || [];
      list.push([k, where]);
      seen.set(u, list);
    }
    for (const [u, list] of seen) if (list.length > 1) for (const [k, where] of list) expect(where, `${k} shares ${u}`).toBeTruthy();
  });
  it("the two counties on the shared north-country parcel model are scoped to their own rows", () => {
    const row = (k) => NY_ROWS.find((r) => r[0] === k);
    expect(row("franklin")[5]).toMatch(/FRANKLIN/);
    expect(row("jefferson")[5]).toMatch(/JEFFERSON/);
    expect(row("fulton")[5]).toBe("County='Fulton'"); // the Mohawk-basin layer holds 14 counties
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , , la, ln, bb] of NY_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("a dense county draws outlines from zoom 16 up, never silently short of the 2,000-lot query cap", () => {
    for (const [k, , , , , , , , , , floor] of NY_ROWS) {
      if (["essex", "schoharie", "washington"].includes(k)) continue; // busiest 1 km cell measured at most a few hundred lots
      expect(displayMinZoomOf("ny_" + k), k).toBeGreaterThanOrEqual(16);
      expect(floor, k).toBeGreaterThanOrEqual(16);
    }
    for (const k of ["nassau", "monroe"]) expect(displayMinZoomOf("ny_" + k), k).toBeGreaterThanOrEqual(17);
  });
});

describe("a recorded real lot from each source reads back parcel id", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const row = COUNTIES[slugOf(name)];
    expect(row, name).toBeTruthy();
    expect(row.idField, name).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) expect(rec.owner, `${name}: owner`).toBeTruthy();
  });
  it.each(Object.entries(SAMPLES))("%s: the card's Account / ID is the declared parcel number, not an internal column", (name, s) => {
    expect(idAttrFor(slugOf(name), s.attrs)).toBe(String(s.attrs[s.idField]));
  });
  it("every wired county has a recorded sample", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(NY_ROWS.map((r) => r[1]).sort());
  });
});

describe("a New York City lot (statewide layer) shows a parcel id although MUNI_PARCEL_ID is blank", () => {
  // Recorded 2026-10-20: Queens, 45-14 41 Street. MUNI_PARCEL_ID / PRINT_KEY / ACRES are null for every NYC lot (and 874k statewide).
  const queens = { COUNTY_NAME: "Queens", PARCEL_ADDR: "45-14 41 STREET", PRINT_KEY: null, SBL: "4001930036", PRIMARY_OWNER: "ISLAM, ZAIN", ACRES: null, CALC_ACRES: 0.045385, MUNI_PARCEL_ID: null, SWIS_SBL_ID: "6301004001930036" };
  it("falls back to the state's SWIS+SBL id, and keeps the county's own id when it has one", () => {
    expect(countyRecord(queens, {}).account).toBe("6301004001930036");
    expect(countyRecord({ ...queens, PRINT_KEY: "1.-2-3", MUNI_PARCEL_ID: "X1" }, {}).account).toBe("1.-2-3");
    expect(countyRecord(queens, {}).deedAcres).toBeCloseTo(0.045385, 5);
  });
});
