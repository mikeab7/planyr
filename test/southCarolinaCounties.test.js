/* NEW-1 (South Carolina, 2026-10-19) — every one of South Carolina's 46 counties resolves to a REAL parcel source: Greenville's hand-written row, ten county layers, and the state Revenue and Fiscal
 * Affairs Office's statewide layer scoped to the other 35. None is a silent gap, and none is a county that needs the sentence "<County> — no parcel data wired here yet."
 *
 * RED-PROOF: on main (70a26e2) only Greenville was wired, so 45 of these counties fell through to "no-source" and the per-county assertions below go red; `git stash`-ing the scRaw/scMap spreads in
 * counties.js turns them red again. The county list is the repo's own bundled county polygons (fixture header), never hand-picked. The shared RFA layer is scoped per county, so a county can
 * never be answered with another county's lot. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { SC_ROWS } from "../src/workspaces/site-planner/lib/scParcels.js";
import { SOUTH_CAROLINA_VERIFICATION } from "../src/workspaces/site-planner/lib/scProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/scCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/scSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const RFA = "https://services9.arcgis.com/RvqSyw3diI7dTKo5/arcgis/rest/services/Lexington_Richland_Web_Map_WFL1/FeatureServer/18";
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "sc_" + n.replace(/ County$/, "").toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(["sc_greenville"]); // hand-written in counties.js since 2026-09-11, not in SC_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("sc_"));
const OWNER_LESS = new Set(["Clarendon County", "Fairfield County", "Georgetown County", "Saluda County"]); // RFA's roll has no owner for these and no county layer was found
const COUNTY_LAYER = new Set(["Barnwell", "Beaufort", "Calhoun", "Colleton", "Laurens", "Lee", "Pickens", "Spartanburg", "Sumter", "York"]);

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("SC");
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is South Carolina's 46 counties", () => {
    expect(FX.counties).toHaveLength(46);
    expect(new Set(FX.counties.map((c) => c.fips)).size).toBe(46);
  });
  it("every county is wired — there are no gaps to explain", () => {
    expect(Object.keys(FX.gaps)).toHaveLength(0);
    const wired = new Set(wiredKeys);
    expect(wired.size).toBe(46);
    for (const c of FX.counties) expect(wired.has(keyOf(c.name)), c.name).toBe(true);
  });
  it("the hand-written Greenville row is still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in South Carolina resolves to a source, never to 'no parcel data wired here yet'", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must be a wired county").toBe("ok");
    expect(id.name).toBe(c.name);
    expect(id.key).toBe(keyOf(c.name));
    expect(COUNTIES[id.key].layerUrl).toBeTruthy();
    expect(COUNTIES_MAP[id.key].state).toBe("SC");
    expect(noParcelSourceNote(id)).toBeFalsy();
    expect(countyKeyForName(c.name, "SC")).toBe(id.key);
  });
});

describe("the wired South Carolina rows", () => {
  const ROW_KEYS = SC_ROWS.map(([k]) => "sc_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(SC_ROWS).toHaveLength(45);
  });
  it("the state's RFA layer serves the 35 counties with no better county layer, each SCOPED to its own county", () => {
    let n = 0;
    for (const [k, name, url, idField, , scope] of SC_ROWS) {
      if (COUNTY_LAYER.has(name)) continue;
      n++;
      expect(url, name).toBe(RFA);
      expect(idField, name).toBe("T_Map_Number");
      expect(scope, name).toBe(`County='${name} County'`);
      expect(COUNTIES["sc_" + k].scopeWhere, name).toBe(scope);
      expect(COUNTIES_MAP["sc_" + k].scopeWhere, name).toBe(scope);
    }
    expect(n).toBe(35);
  });
  it("the ten county-own layers are exactly the ones recorded, each its own service (no shared scope)", () => {
    const own = SC_ROWS.filter(([, name]) => COUNTY_LAYER.has(name));
    expect(own).toHaveLength(10);
    for (const [, name, url, , , scope] of own) {
      expect(url, name).not.toBe(RFA);
      expect(scope, name).toBeNull();
    }
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    const relayHosts = new Set();
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      relayHosts.add(u.split("/")[2]);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
    expect([...relayHosts].sort()).toEqual(["gis.sumter-sc.com", "maps.spartanburgcounty.org", "www.laurenscountygis.org"]);
  });
  it("the SCDOT index of per-county layers answers 'Token Required' and is never used", () => {
    for (const k of wiredKeys) expect(COUNTIES[k].layerUrl, k).not.toMatch(/scdot\.org/i);
    expect(ALLOWED_HOSTS.has("smpesri.scdot.org")).toBe(false);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , , la, ln, bb] of SC_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["sc_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired South Carolina row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of [...ROW_KEYS]) {
      const v = SOUTH_CAROLINA_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-19");
      expect(v.verifiedNote, k).toMatch(/MEASURED/);
    }
  });
});

describe("a recorded real lot from each source reads back parcel id, acreage and (where the source has one) owner and address", () => {
  it("the fixture covers every wired county but the hand-written one", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(SC_ROWS.map(([, n]) => n + " County").sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = keyOf(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBe(String(s.attrs[s.idField]).replace(/\s+/g, " ").trim());
    // the stored account (what the card/list stamps at identify time) is the county's DECLARED column, never a jurisdiction code
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs[s.idField]));
    if (!OWNER_LESS.has(name)) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    }
    if (row.addrField) expect(rec.address, `${name}: the declared site address column resolves`).toBeTruthy();
  });
  it("the RFA layer's GeoID (a jurisdiction code, '4500720' on every Aiken lot) is never the account — the tax-map number is", () => {
    const aiken = SAMPLES["Aiken County"];
    expect(aiken.attrs.GeoID).toBeTruthy();
    const rec = countyRecord(aiken.attrs, { idField: "T_Map_Number" });
    expect(rec.account).toBe(aiken.attrs.T_Map_Number);
    expect(rec.account).not.toBe(String(aiken.attrs.GeoID));
  });
  it("the four counties whose RFA roll has no owner say so honestly — no owner, no invented one", () => {
    for (const n of OWNER_LESS) expect(ownerName(SAMPLES[n].attrs), n).toBeNull();
  });
  it("Lee County's CAMA address lines are the owner's mailing address and never become a site address", () => {
    expect(ownerName(SAMPLES["Lee County"].attrs)).toBeTruthy();
    expect(countyRecord(SAMPLES["Lee County"].attrs, { idField: COUNTIES.sc_lee.idField, addrField: COUNTIES.sc_lee.addrField }).address).toBeNull();
  });
});

describe("measured live (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const m = s.measured;
    expect(m.spreadPoints, `${name}: nine interior test points`).toBe(9);
    expect(m.edgePoints, `${name}: four county-line test points`).toBe(4);
    expect(m.hits + m.edgeHits, `${name}: polygons with a parcel id across the 13 points (misses are roads, water, public land)`).toBeGreaterThanOrEqual(5);
    expect(m.edgeHits, `${name}: points just inside the county line`).toBeGreaterThanOrEqual(1);
    expect(m.extent, `${name}: the layer's returned extent`).toBeTruthy();
    // South Carolina spans lng -83.36..-78.54, lat 32.03..35.22. The east bound allows for oceanfront lot polygons that run out past the beach (Horry's extent ends at -78.486); the check exists to catch a layer that is wholly elsewhere.
    const e = m.extent;
    expect(e[0] >= -83.4 && e[2] <= -78.45 && e[1] >= 32.0 && e[3] <= 35.25, `${name}: extent inside South Carolina`).toBe(true);
  });
});
