/* NEW-1 (B2343936, 2026-10-19) — every one of South Dakota's 66 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap
 * ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on main (a85f799) only Pennington + Minnehaha (and Sioux Falls, a city) had rows, so the 15 counties wired here fell through to no-source;
 * dropping counties.js's sdRaw/sdMap spread turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture), never
 * hand-picked. South Dakota has no free statewide parcel layer (sdgis.sd.gov publishes boundaries, PLSS and tax-match districts only), so a gap must not
 * borrow one. Adding a county to the fixture's `gaps` is a claim (docs/STATEWIDE-PARCELS.md "South Dakota counties (2026-10-19)" records what was
 * searched); removing one requires wiring it. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { SD_ROWS } from "../src/workspaces/site-planner/lib/sdParcels.js";
import { SOUTH_DAKOTA_VERIFICATION } from "../src/workspaces/site-planner/lib/sdProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/southDakotaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/southDakotaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "sd_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
// Minnehaha's interior can sit inside Sioux Falls' city limits, where the city-scoped row answers first (cityScopes.js).
const MINNEHAHA_KEYS = ["sd_minnehaha", "sd_siouxfalls"];

describe("the computed county list", () => {
  it("is South Dakota's 66 counties", () => {
    expect(FX.counties).toHaveLength(66);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["SD"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("sd_") && k !== "sd_siouxfalls"));
    expect(wired.size + Object.keys(GAPS).length).toBe(66);
    for (const c of FX.counties) expect(wired.has(slugOf(c.name)) !== (bare(c.name) in GAPS), c.name).toBe(true);
  });
});

describe("a point inside each South Dakota county resolves to that county's source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in GAPS) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toBe(`${c.name} — no parcel data wired here yet.`);
    } else {
      expect(id.status).toBe("ok");
      if (bare(c.name) === "Minnehaha") expect(MINNEHAHA_KEYS).toContain(id.key);
      else expect(id.key).toBe(slugOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("SD");
    }
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("SD");
  });
});

describe("the wired South Dakota rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of SD_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no two rows share a layer, and none is the Pennington copy another county's org republishes", () => {
    const urls = SD_ROWS.map((r) => r[2]);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u).not.toMatch(/PenningtonCountySDParcels|PenningtonParcels/);
  });
  it("Dewey excludes the tribal-trust polygons whose parcel id reads TRIBAL", () => {
    expect(COUNTIES.sd_dewey.scopeWhere).toMatch(/TRIBAL/);
  });
  it("Brown keeps only parcel-type polygons, never road / rail / water rows", () => {
    expect(COUNTIES.sd_brown.scopeWhere).toMatch(/CITY PARCEL/);
    expect(COUNTIES.sd_brown.scopeWhere).not.toMatch(/ROAD ROW|WATER|RAILROAD/);
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , , la, ln, bb] of SD_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("keys do not collide with the hand-written rows", () => {
    const hand = new Set(["pennington", "minnehaha", "siouxfalls"]);
    for (const [k] of SD_ROWS) expect(hand.has(k), k).toBe(false);
  });
  it("every row carries a dated verification record", () => {
    for (const [k] of SD_ROWS) expect(SOUTH_DAKOTA_VERIFICATION["sd_" + k]?.verifiedOn, k).toBe("2026-10-19");
  });
  it("Lincoln County (behind a Cloudflare bot challenge) and District III's counties are not wired on an unmeasured host", () => {
    for (const [k, , u] of SD_ROWS) expect(u, k).not.toMatch(/lincolncountysd|districtiii\.org|beacon\.schneidercorp|equatorstudios/);
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
  it("Brown's NAME column (the parcel number) is never read as the owner", () => {
    const rec = countyRecord(SAMPLES.Brown.attrs, { idField: "nParcelID" });
    expect(rec.owner).not.toBe(String(SAMPLES.Brown.attrs.NAME));
  });
});
