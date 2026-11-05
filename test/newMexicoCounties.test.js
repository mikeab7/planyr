/* NEW-1 (B2345888, 2026-10-19) — every one of New Mexico's 33 counties resolves to a connected parcel source (no gap remains).
 *
 * RED-PROOF: on main (70a26e2) only Bernalillo had a row, so the other 32 counties fell through to no-source; `git stash`-ing counties.js's
 * nmRaw/nmMap spread turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture header), never hand-picked.
 * The wiring claims in nmParcels.js (which counties ride the State Engineer's layer, which ride their own, which are town-only) are asserted
 * here so a later edit that "tidies" two rows onto one layer, or drops the town-only disclosure, goes red. Measurements behind them:
 * docs/STATEWIDE-PARCELS.md "New Mexico counties (2026-10-19)". */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { NM_ROWS } from "../src/workspaces/site-planner/lib/nmParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/newMexicoCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/newMexicoSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "nm_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const OSE = /^\/gis-proxy\/gis\.ose\.nm\.gov\/server_s\/rest\/services\/Parcels\/County_Parcels_2025\/MapServer\/\d+$/;
const OWN_LAYER = ["catron", "chaves", "cibola", "colfax", "doaana", "eddy", "grant", "otero", "rioarriba"];
const TOWNS_ONLY = ["debaca", "guadalupe", "mora", "quay", "union"];

describe("the computed county list", () => {
  it("is New Mexico's 33 counties", () => {
    expect(FX.counties).toHaveLength(33);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["NM"]));
  });
  it("every county is wired — no gap remains", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("nm_")));
    expect(wired.size).toBe(33);
    for (const c of FX.counties) expect(wired.has(slugOf(c.name)), c.name).toBe(true);
  });
});

describe("a point inside each New Mexico county resolves to that county's source", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").toBe("ok");
    expect(id.name).toBe(c.name);
    expect(id.key).toBe(slugOf(c.name));
    expect(noParcelSourceNote(id)).toBeNull();
    expect(COUNTIES[id.key].layerUrl).toBeTruthy();
    expect(COUNTIES_MAP[id.key].state).toBe("NM");
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("NM");
  });
});

describe("the wired New Mexico rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of NM_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("is 32 rows (Bernalillo stays the hand-written nm_bernalillo) with no shared layer", () => {
    expect(NM_ROWS).toHaveLength(32);
    const urls = NM_ROWS.map((r) => r[2]);
    expect(new Set(urls).size).toBe(urls.length);
    expect(NM_ROWS.some(([k]) => k === "bernalillo")).toBe(false);
  });
  it("nine counties ride their own county layer (2026 edits), the other 23 the State Engineer's county layer", () => {
    for (const [k, , u] of NM_ROWS) {
      if (OWN_LAYER.includes(k)) expect(u, k).toMatch(/^https:\/\/[^/]*arcgis\.com\//);
      else expect(u, k).toMatch(OSE);
    }
    expect(NM_ROWS.filter(([k]) => OWN_LAYER.includes(k))).toHaveLength(9);
  });
  it("each State Engineer row points at ITS OWN county's layer index", () => {
    const order = ["Bernalillo", "Catron", "Chaves", "Cibola", "Colfax", "Curry", "De Baca", "Doña Ana", "Eddy", "Grant", "Guadalupe", "Harding", "Hidalgo", "Lea", "Lincoln", "Los Alamos", "Luna", "McKinley", "Mora", "Otero", "Quay", "Rio Arriba", "Roosevelt", "Sandoval", "San Juan", "San Miguel", "Santa Fe", "Sierra", "Socorro", "Taos", "Torrance", "Union", "Valencia"];
    for (const [k, n, u] of NM_ROWS) if (OSE.test(u)) expect(order[Number(u.split("/").pop())], k).toBe(n);
  });
  it("Catron rides the county layer, never the State Engineer's town-lots-only Catron layer", () => {
    const u = NM_ROWS.find(([k]) => k === "catron")[2];
    expect(u).toMatch(/Tax_Parcel_Polygon20241007/);
  });
  it("the five State Engineer layers that hold town lots only say so in their help text", () => {
    for (const k of TOWNS_ONLY) expect(COUNTIES["nm_" + k].help, k).toMatch(/towns and villages only/);
    for (const k of Object.keys(COUNTIES).filter((x) => x.startsWith("nm_") && x !== "nm_bernalillo" && !TOWNS_ONLY.includes(x.slice(3)))) expect(COUNTIES[k].help, k).not.toMatch(/towns and villages only/);
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , la, ln, bb] of NM_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("Doña Ana's key is the letters-only slug countyKeyForName derives", () => {
    expect(COUNTIES.nm_doaana.label).toBe("Doña Ana County, NM");
  });
});

describe("a recorded real lot from each source reads back parcel id and owner", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const row = COUNTIES[slugOf(name)];
    expect(row, name).toBeTruthy();
    expect(row.idField, name).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) expect(rec.owner, `${name}: owner`).toBeTruthy();
  });
});
