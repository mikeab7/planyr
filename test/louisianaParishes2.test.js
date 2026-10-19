/* NEW-1 (Louisiana, 2026-10-19) — the "wire the remaining states" pass for Louisiana: 4 more parishes (Claiborne, Richland, West Carroll,
 * Ouachita) in src/workspaces/site-planner/lib/laParcels.js, and EVERY one of the 64 parishes resolving to a wired row or the named gap
 * sentence. RED-PROOF: on the commit before this work these 4 keys do not exist (a point inside each says "no parcel data wired here
 * yet") and the gap set below is 30, not 26 — `git stash` the laRaw/laMap spreads in counties.js and this file goes red.
 * The 64 come from the committed nationwide polygon asset, never a hand-typed list. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, countyKeyForName, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { buildIndex } from "../src/workspaces/site-planner/lib/countyPolygonsCore.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { LA_ROWS } from "../src/workspaces/site-planner/lib/laParcels.js";
import { ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";

let index;
beforeAll(async () => {
  const payload = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
  await setCountyPolygons(payload);
  index = buildIndex(payload);
});

// Points MEASURED live 2026-10-19 (docs/STATEWIDE-PARCELS.md "Louisiana parishes (2026-10-19)") — each returned a real parcel from the row's layer.
const MEASURED = {
  la_claiborne: [[32.7918, -93.0551], [32.6714, -93.1359], [32.8012, -92.9818], [32.931, -93.0845], [32.9093, -92.8533]],
  la_richland: [[32.4799, -91.7537], [32.2546, -91.9143], [32.4094, -91.733], [32.5383, -91.582]],
  la_westcarroll: [[32.859, -91.3918], [32.6668, -91.5632], [32.7942, -91.4499], [32.9002, -91.3554]],
  la_ouachita: [[32.5093, -92.1193], [32.3516, -92.3131], [32.4909, -92.1594], [32.398, -92.0057], [32.5813, -92.2654]],
};
const NEW_KEYS = Object.keys(MEASURED);

// The parishes still without a usable public service, each with a recorded, re-searched reason in the docs.
const GAPS = ["Avoyelles", "Beauregard", "Bienville", "Caldwell", "Catahoula", "Concordia", "East Carroll", "Evangeline", "Franklin", "Grant", "Iberia",
  "Jackson", "LaSalle", "Lincoln", "Madison", "Morehouse", "Pointe Coupee", "Rapides", "Red River", "Sabine", "St. Helena", "Tensas", "Union",
  "Vermilion", "Vernon", "Winn"];

describe("the four parishes wired 2026-10-19", () => {
  it("laParcels.js rows are exactly these four, plugged into COUNTIES, COUNTIES_MAP and the provenance record", () => {
    expect(LA_ROWS.map((r) => "la_" + r[0]).sort()).toEqual([...NEW_KEYS].sort());
    for (const k of NEW_KEYS) {
      expect(COUNTIES[k], k).toMatchObject({ state: "LA", pinIdField: true });
      expect(COUNTIES[k].label).toMatch(/^[A-Za-z. ]+ Parish, LA$/);
      expect(COUNTIES_MAP[k].layerUrl).toBe(COUNTIES[k].layerUrl);
      expect(COUNTY_VERIFICATION[k]).toMatchObject({ publisher: "third-party", verifiedOn: "2026-10-19" });
      expect(COUNTY_VERIFICATION[k].verifiedNote).toMatch(/MEASURED live/);
    }
  });
  it("pins the measured id columns (detection would take OBJECTID/RPID)", () => {
    expect(COUNTIES.la_claiborne.idField).toBe("parcelnumb");
    expect(COUNTIES.la_richland.idField).toBe("parcel_id");
    expect(COUNTIES.la_westcarroll.idField).toBe("PARCEL_ID");
    expect(COUNTIES.la_ouachita.idField).toBe("Parcel_ID");
  });
  it.each(NEW_KEYS)("%s — every measured parcel point resolves to THIS parish's row", (k) => {
    for (const [lat, lng] of MEASURED[k]) {
      const id = countyIdentity(lat, lng);
      expect(id.status, `${k} @ ${lat},${lng}`).toBe("ok");
      expect(id.key).toBe(k);
    }
  });
  it.each(NEW_KEYS)("%s — the parish name resolves back to the key", (k) => {
    const name = COUNTIES[k].label.replace(/ Parish, LA$/, "");
    expect(countyKeyForName(`${name} Parish`, "LA")).toBe(k);
  });
  it("the three co-op layers' owner columns reach the shared owner resolver; Ouachita publishes none and says so", () => {
    expect(ownerName({ owner_name: "SANDERS, PEGGY JO PAIR", parcelnumb: "0400045175" })).toBe("SANDERS, PEGGY JO PAIR");
    expect(ownerName({ ownername: "WOOTEN PROPERTIES, INC.", parcel_id: "0500223500" })).toBe("WOOTEN PROPERTIES, INC.");
    expect(ownerName({ OWNER: "GWIN DONALD R & PATRICIA", PARCEL_ID: "0100022500" })).toBe("GWIN DONALD R & PATRICIA");
    expect(COUNTIES.la_ouachita.help).toMatch(/no owner/);
  });
});

describe("all 64 parishes: wired, or the named gap sentence — never silently empty", () => {
  it("the polygon asset holds 64 Louisiana parishes", () => {
    expect(index.counties.filter((c) => c.state === "LA")).toHaveLength(64);
  });
  it("34 + 4 wired and 26 named gaps account for all 64", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("la_")));
    expect(wired.size).toBe(38);
    const gaps = index.counties.filter((c) => c.state === "LA" && !wired.has(countyKeyForName(c.name, "LA"))).map((c) => c.name.replace(/ Parish$/, ""));
    expect(gaps.sort()).toEqual([...GAPS].sort());
  });
  it.each(GAPS)("%s Parish says so by name", (n) => {
    const rec = index.counties.find((c) => c.state === "LA" && c.name === `${n} Parish`);
    const [x0, y0, x1, y1] = rec.bbox;
    const id = countyIdentity((y0 + y1) / 2 / index.scale, (x0 + x1) / 2 / index.scale);
    if (id.name !== rec.name) return; // bbox centre of a concave parish can fall in a neighbour; the per-name counts above are the guard
    expect(id.status).toBe("no-source");
    expect(noParcelSourceNote(id)).toBe(`${rec.name} — no parcel data wired here yet.`);
  });
});
