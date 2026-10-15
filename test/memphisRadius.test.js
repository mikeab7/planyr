/* NEW-1 (Memphis 100-mile radius, 2026-10-15) — every county with any part of its boundary within 100 statute miles
 * of downtown Memphis resolves to a REAL outcome: a connected parcel source, or a plainly worded "no parcel data".
 * Never a county that is silently empty.
 *
 * RED-PROOF: on the commit before this work, 24 Mississippi counties had no source (the sentence only), Tennessee's
 * Shelby and Chester borrowed the statewide layer's cover although that layer holds none of their parcels, and
 * Germantown/Collierville resolved to nothing. The county list is computed from Census-derived county boundaries
 * (fixture header), never hand-picked. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/memphisRadiusCounties.json", import.meta.url), "utf8"));
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* The honest gaps: no public parcel service exists (or none Planyr may reach) — each must SAY so. */
const NO_SOURCE = new Set(["TN:Shelby County", "TN:Chester County", "KY:Fulton County", "MO:Butler County", "MO:Dunklin County",
  "MO:New Madrid County", "MO:Pemiscot County", "MO:Ripley County"]);
// A centroid can fall just across a line on the simplified asset; these were nudged to a point the asset agrees on.
const NUDGE = { "MO:Dunklin County": [36.30, -90.05] };
const pointOf = (c) => NUDGE[`${c.state}:${c.name}`] || [c.lat, c.lng];

describe("the computed county list", () => {
  it("is the 71 counties, by state", () => {
    const by = {};
    FX.counties.forEach((c) => { by[c.state] = (by[c.state] || 0) + 1; });
    expect(by).toEqual({ AR: 22, KY: 1, MO: 5, MS: 25, TN: 18 });
    expect(FX.counties).toHaveLength(71);
  });
});

describe("every county in the radius resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [`${c.state} ${c.name}`, c]))("%s", (_l, c) => {
    const [lat, lng] = pointOf(c);
    const id = countyIdentity(lat, lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    const gap = NO_SOURCE.has(`${c.state}:${c.name}`);
    if (gap) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer that holds none of it").toBeUndefined();
      expect(noParcelSourceNote(id)).toMatch(/no parcel data/);
    } else if (id.status === "ok") {
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
    } else {
      expect(id.statewideKey, `${c.name} needs a source`).toBeTruthy();
    }
  });
});

describe("Mississippi — one pinned MARIS layer per county", () => {
  const ms = FX.counties.filter((c) => c.state === "MS");
  it("all 25 counties are connected (DeSoto on its own service, 24 on MARIS)", () => {
    for (const c of ms) expect(countyIdentity(...pointOf(c)).status, c.name).toBe("ok");
  });
  it("Tate (West half) and Lee (East half) pin different layers, both scoped by CNTYNAME", () => {
    expect(COUNTIES.ms_tate.layerUrl).toMatch(/MS_Parcels_August_2024\/MapServer\/1$/);
    expect(COUNTIES.ms_lee.layerUrl).toMatch(/MS_Parcels_August_2024\/MapServer\/2$/);
    expect(COUNTIES.ms_tate.scopeWhere).toBe("CNTYNAME='TATE'");
    expect(COUNTIES.ms_lee.scopeWhere).toBe("CNTYNAME='LEE'");
  });
  it("is routed through an allow-listed gis-proxy host, never a bare CORS gamble", () => {
    for (const c of ms.filter((x) => x.name !== "DeSoto County")) {
      const key = countyIdentity(...pointOf(c)).key;
      const m = COUNTIES[key].layerUrl.match(/^\/gis-proxy\/([^/]+)\//);
      expect(m, key).toBeTruthy();
      expect(ALLOWED_HOSTS.has(m[1]), key).toBe(true);
    }
  });
  it("a Memphis-area click (Southaven → DeSoto, Senatobia → Tate) reaches a county source", () => {
    expect(candidateCountiesForPoint(34.9889, -90.0126)).toContain("ms_desoto");
    expect(candidateCountiesForPoint(34.6176, -89.9695)).toContain("ms_tate");
  });
});

describe("Tennessee — the statewide layer's two holes say so", () => {
  it("Shelby (Memphis) and Chester report no parcel data; Tipton/Fayette ride the statewide layer", () => {
    const memphis = countyIdentity(35.1495, -90.049);
    expect(memphis).toMatchObject({ status: "no-source", name: "Shelby County" });
    expect(noParcelSourceNote(memphis)).toMatch(/Shelby County — no parcel data/);
    expect(countyIdentity(35.564, -89.6495).statewideKey).toBe("tn_statewide");
  });
  it("Germantown and Collierville (inside Shelby) are city-scoped sources with the town's own layer", () => {
    expect(countyIdentity(35.0868, -89.81)).toMatchObject({ status: "ok", key: "tn_germantown" });
    expect(countyIdentity(35.042, -89.664)).toMatchObject({ status: "ok", key: "tn_collierville" });
    expect(COUNTIES_MAP.tn_germantown.cityScoped).toBe(true);
    expect(COUNTIES_MAP.tn_collierville.cityScoped).toBe(true);
    // a Memphis point just west of Germantown is NOT Germantown
    expect(countyIdentity(35.1, -89.95).key ?? null).toBeNull();
  });
});

describe("Arkansas statewide is relayed, and its host is allow-listed", () => {
  it("ar_statewide uses /gis-proxy/gis.arkansas.gov", () => {
    expect(COUNTIES_MAP.ar_statewide.layerUrl).toMatch(/^\/gis-proxy\/gis\.arkansas\.gov\//);
    expect(ALLOWED_HOSTS.has("gis.arkansas.gov")).toBe(true);
  });
});
