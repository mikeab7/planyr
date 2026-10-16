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
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/memphisRadiusCounties.json", import.meta.url), "utf8"));
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* The honest gaps: no public parcel service exists (or none Planyr may reach) — each must SAY so. */
const NO_SOURCE = new Set(["KY:Fulton County", "MO:Butler County", "MO:Dunklin County",
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

describe("Tennessee — Shelby on the Assessor's own countywide service; Chester on the Chester County Assessor's CaptureCAMA layer", () => {
  it("Shelby (Memphis, Germantown, Collierville, Bartlett, Millington) resolves to tn_shelby, never the statewide layer", () => {
    for (const p of [[35.1495, -90.049], [35.03, -89.95], [35.0868, -89.81], [35.042, -89.664], [35.205, -89.87], [35.34, -89.90]]) {
      expect(countyIdentity(...p), String(p)).toMatchObject({ status: "ok", key: "tn_shelby", name: "Shelby County" });
    }
    expect(COUNTIES.tn_shelby.layerUrl).toMatch(/^\/gis-proxy\/scgis\.shelbycountytn\.gov\/.*CERTParcel\/MapServer\/0$/);
    expect(ALLOWED_HOSTS.has("scgis.shelbycountytn.gov")).toBe(true);
    expect(COUNTIES.tn_shelby.idField).toBe("PARCELID");
  });
  it("Chester (Henderson) resolves to tn_chester, never the statewide layer; Tipton rides the statewide layer", () => {
    for (const p of [[35.4398, -88.6420], [35.36321, -88.71964], [35.397, -88.452]]) {
      expect(countyIdentity(...p), String(p)).toMatchObject({ status: "ok", key: "tn_chester", name: "Chester County" });
    }
    expect(COUNTIES.tn_chester.layerUrl).toMatch(/^\/gis-proxy\/gis\.capturecama\.com\/.*ChesterCapture\/MapServer\/7$/);
    expect(ALLOWED_HOSTS.has("gis.capturecama.com")).toBe(true);
    expect(COUNTIES.tn_chester.idField).toBe("L15Parce_2");
    expect(countyIdentity(35.564, -89.6495).statewideKey).toBe("tn_statewide");
  });
  it("the owner-less Germantown/Collierville city scopes are gone (folded into tn_shelby)", () => {
    expect(COUNTIES_MAP.tn_germantown).toBeUndefined();
    expect(COUNTIES_MAP.tn_collierville).toBeUndefined();
  });
});

describe("Arkansas statewide is relayed, and its host is allow-listed", () => {
  it("ar_statewide uses /gis-proxy/gis.arkansas.gov", () => {
    expect(COUNTIES_MAP.ar_statewide.layerUrl).toMatch(/^\/gis-proxy\/gis\.arkansas\.gov\//);
    expect(ALLOWED_HOSTS.has("gis.arkansas.gov")).toBe(true);
  });
});

/* NEW-1 (Memphis radius ×2) — the owner's report: a Shelby click in the map's lot picker ("No parcel right there").
 * RED on the merged B2289168 code: every Shelby point below returned ["tn_statewide"] — a layer that holds none of Shelby. Now
 * Shelby routes to its own Assessor source, and a county a composite declares excluded (Chester) is routed nowhere, so a
 * slow/dead statewide layer can never turn its honest gap into an outage message. */
describe("the owner's case: Shelby clicks reach Shelby's source; an excluded county is not routed to the composite", () => {
  const SHELBY = [["airport east (owner's screenshot)", 35.03, -89.95], ["Getwell / Shelby Dr", 35.02, -89.92],
    ["downtown Memphis", 35.1495, -90.049], ["Bartlett", 35.205, -89.87], ["Millington", 35.34, -89.90]];
  it.each(SHELBY)("Shelby — %s: routed to tn_shelby, never tn_statewide", (_l, lat, lng) => {
    const c = candidateCountiesForPoint(lat, lng);
    expect(c[0]).toBe("tn_shelby");
    expect(c).not.toContain("tn_statewide");
  });
  it("Chester (Henderson TN): routed to tn_chester, never the composite that holds none of it", () => {
    const c = candidateCountiesForPoint(35.4398, -88.6420);
    expect(c[0]).toBe("tn_chester");
    expect(c).not.toContain("tn_statewide");
  });
  it("Chester's CaptureCAMA columns reach the parcel card (owner, situs, parcel id, GIS acres) — the real Henderson + rural rows", () => {
    const rec = countyRecord({ L15Parce_2: "012033M I 01500", L15Parce_4: 0.39423707, GPDATA__OW: "CITY OF HENDERSON", GPDATA__PR: "CROOK AVENUE 111",
      GPDATA__MA: "PO BOX 68", GPDATA__DA: "0.00", GPDATA__CA: "0.0" }, { idField: "L15Parce_2", addrField: "GPDATA__PR" });
    expect(rec).toMatchObject({ owner: "CITY OF HENDERSON", account: "012033M I 01500", address: "CROOK AVENUE 111", deedAcres: 0.39423707 });
    const rural = countyRecord({ L15Parce_2: "012076    02700", L15Parce_4: 36.30162137, GPDATA__OW: "SILLS THOMAS ETUX EDITH", GPDATA__PR: "SILERTON ROAD 1280" }, { idField: "L15Parce_2", addrField: "GPDATA__PR" });
    expect(rural).toMatchObject({ owner: "SILLS THOMAS ETUX EDITH", deedAcres: 36.30162137 });
  });
  it("a covered TN county (Tipton) still routes to the statewide layer", () => {
    expect(candidateCountiesForPoint(35.564, -89.6495)).toContain("tn_statewide");
  });
});
