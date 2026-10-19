/* NEW-1 (Kentucky, 2026-10-19) — every one of Kentucky's 120 counties resolves to a REAL outcome: a connected parcel source, or an
 * explicit, named gap that says so ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on a8d440d only Jefferson had a row (its endpoint never measured, direct CORS-blocked host), so 21 of the 120 counties fell
 * through to "no-source"/outside; removing the kyRaw/kyMap spread from counties.js turns 21 of the county cases below red.
 * Kentucky has no free statewide parcel service, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { KY_ROWS } from "../src/workspaces/site-planner/lib/kyParcels.js";
import { COUNTY_VERIFICATION } from "../src/workspaces/site-planner/lib/countiesProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/kentuckyCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/kentuckySamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});
const bare = (n) => n.replace(/ County$/, "");
const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
/* Fulton is an OWNER-ACCEPTED gap (2026-10-16) — never reopen it. */
const wiredKeys = () => Object.keys(COUNTIES).filter((k) => k.startsWith("ky_"));

describe("the computed county list", () => {
  it("is Kentucky's 120 counties", () => {
    expect(FX.counties).toHaveLength(120);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["KY"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    expect(wiredKeys().length + FX.gaps.length).toBe(120);
    for (const c of FX.counties) {
      const slug = bare(c.name).toLowerCase().replace(/[^a-z]/g, "");
      expect(wiredKeys().includes("ky_" + slug) !== (bare(c.name) in GAPS), c.name).toBe(true);
    }
    expect("Fulton" in GAPS).toBe(true);
  });
});

describe("every county in Kentucky resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.state).toBe("KY");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in GAPS) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toBe(`${c.name} — no parcel data wired here yet.`);
    } else {
      expect(id.status).toBe("ok");
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("KY");
    }
  });
});

describe("the wired Kentucky rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of wiredKeys()) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("each county's bbox contains its interior point", () => {
    for (const [, n, , , , , , la, ln, bb] of KY_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("every row carries a dated verification record", () => {
    for (const k of wiredKeys()) expect(COUNTY_VERIFICATION[k]?.verifiedOn, k).toBe("2026-10-19");
  });
  it("a trap rejected on measurement stays rejected: no Kentucky row points at another state's same-named county", () => {
    const urls = wiredKeys().map((k) => COUNTIES[k].layerUrl).join("\n");
    expect(urls).not.toMatch(/S14quRRuDSaYoUKA|33TOOklri9xpic7U/); // Hopkins TX / Grant (outside KY State Plane) layers
  });
});

describe("a recorded real lot from each source reads back parcel id and (where the layer has one) owner", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = "ky_" + name.toLowerCase().replace(/[^a-z]/g, "");
    const row = COUNTIES[key] || (key === "ky_jefferson" ? COUNTIES.ky_jefferson : null);
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (name === "Fayette") expect(rec.owner, "Fayette's NAME is the street name — never an owner").toBeNull();
    if (name === "Simpson") expect(rec.address, "the property line, not the owner PO box").toBe("3100 BOWLING GREEN ROAD");
    if (name === "Henderson") expect(rec.address, "LOCATION=COUNTY is a jurisdiction flag, never an address").toBeNull();
    if (name === "Boone") expect(rec.owner, "Boone's PRCLOWNR1").toBeTruthy();
  });
});
