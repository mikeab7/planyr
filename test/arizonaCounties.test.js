/* NEW-1 (B2365360, 2026-10-19) — every one of Arizona's 15 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap
 * ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on main (654ca32) only Pinal and Maricopa had rows, so the 13 counties wired here fell through to no-source; `git stash`-ing
 * counties.js's azRaw/azMap spread turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture header),
 * never hand-picked. Adding a county to `gaps` in the fixture is a claim (docs/STATEWIDE-PARCELS.md "Arizona counties (2026-10-19)" records what was
 * searched); removing one requires wiring it. Arizona has no free statewide layer, so a gap must not borrow another county's. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, displayMinZoomOf } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { AZ_ROWS } from "../src/workspaces/site-planner/lib/azParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/arizonaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/arizonaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "az_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");

describe("the computed county list", () => {
  it("is Arizona's 15 counties", () => {
    expect(FX.counties).toHaveLength(15);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["AZ"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("az_")));
    expect(wired.size + Object.keys(GAPS).length).toBe(15);
    for (const c of FX.counties) expect(wired.has(slugOf(c.name)) !== (bare(c.name) in GAPS), c.name).toBe(true);
  });
});

describe("a point inside each Arizona county resolves to that county's source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in GAPS) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toContain(c.name);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(slugOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("AZ");
    }
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l, i) => [`${l.name} #${i}`, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("AZ");
  });
});

describe("the wired Arizona rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of AZ_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no two counties share a layer (a county may never borrow another's)", () => {
    const urls = AZ_ROWS.map((r) => r[2]);
    expect(new Set(urls).size).toBe(urls.length);
    for (const k of ["az_pinal", "az_maricopa"]) expect(urls).not.toContain(COUNTIES[k].layerUrl);
  });
  it("each ADWR compile layer index is the layer for its own county (the layers are named by county, so a wrong index is a silent misroute)", () => {
    // Measured 2026-10-19: services.arcgis.com/C34zQ7veRS0V1t04 … /Parcels/FeatureServer — index → layer name. 7 and 8 do not exist.
    const ADWR = { apache: 0, cochise: 1, gila: 3, greenlee: 5, lapaz: 6, pima: 10, santacruz: 12, yuma: 13 };
    for (const [k, , u] of AZ_ROWS) {
      const m = u.match(/C34zQ7veRS0V1t04\/arcgis\/rest\/services\/Parcels\/FeatureServer\/(\d+)$/);
      if (!m) { expect(ADWR[k], `${k} is not on the ADWR compile`).toBeUndefined(); continue; }
      expect(Number(m[1]), k).toBe(ADWR[k]);
    }
    expect(AZ_ROWS.filter((r) => /C34zQ7veRS0V1t04/.test(r[2])).length).toBe(Object.keys(ADWR).length);
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , , la, ln, bb] of AZ_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("a county with a town dense enough to overflow the 2,000-lot query cap at zoom 15 draws outlines from zoom 16 up, never silently short", () => {
    // Measured 2026-10-19: busiest 1 km cell = 600–1,133 lots at zoom 16 in these ten; Apache (10) and Greenlee (221) are sparse. Mohave is a MapServer (its floor is the generic MapServer one).
    const dense = ["cochise", "coconino", "gila", "graham", "lapaz", "navajo", "pima", "santacruz", "yavapai", "yuma", "mohave"];
    for (const k of dense) expect(displayMinZoomOf("az_" + k), k).toBeGreaterThanOrEqual(16);
    for (const k of ["apache", "greenlee"]) expect(displayMinZoomOf("az_" + k), k).toBe(0);
  });
  it("keys do not collide with the two hand-written rows", () => {
    for (const [k] of AZ_ROWS) expect(["pinal", "maricopa"].includes(k), k).toBe(false);
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
  it.each(Object.entries(SAMPLES))("%s: the card's Account / ID is the declared parcel number (APN), not an internal column", (name, s) => {
    expect(idAttrFor(slugOf(name), s.attrs)).toBe(String(s.attrs[s.idField]));
  });
  it("every wired county has a recorded sample", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(AZ_ROWS.map((r) => r[1]).sort());
  });
});
