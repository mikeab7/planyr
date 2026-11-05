/* NEW-1 (B2317920, 2026-10-19) — every one of Idaho's 44 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap
 * ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on main (a8d440d) only the 13 OITS counties had rows, so the 21 counties wired here fell through to no-source; `git stash`-ing
 * counties.js's idRaw/idMap spread turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture header),
 * never hand-picked. Idaho has no free statewide parcel layer covering the other 31 counties (the State's OITS layer carries 13), so a gap must not
 * borrow one. Adding a county to GAPS is a claim (docs/STATEWIDE-PARCELS.md "Idaho counties (2026-10-19)" records what was searched);
 * removing one requires wiring it. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { ID_ROWS } from "../src/workspaces/site-planner/lib/idParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/idahoCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/idahoSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "id_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");

describe("the computed county list", () => {
  it("is Idaho's 44 counties", () => {
    expect(FX.counties).toHaveLength(44);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["ID"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("id_")));
    expect(wired.size + Object.keys(GAPS).length).toBe(44);
    for (const c of FX.counties) expect(wired.has(slugOf(c.name)) !== (bare(c.name) in GAPS), c.name).toBe(true);
  });
});

describe("a point inside each Idaho county resolves to that county's source or an explicit gap", () => {
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
      expect(COUNTIES_MAP[id.key].state).toBe("ID");
    }
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("ID");
  });
});

describe("the wired Idaho rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of ID_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no row borrows the State OITS layer or another county's layer", () => {
    const urls = ID_ROWS.map((r) => r[2]);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of urls) expect(u).not.toMatch(/Public_Idaho_Parcels_/);
  });
  it("never uses the IDWR compiled-parcel service, whose own text says it cannot be shared outside IDWR", () => {
    for (const [k, , u] of ID_ROWS) expect(u, k).not.toMatch(/idwr\.idaho\.gov/);
    expect(ALLOWED_HOSTS.has("gis.idwr.idaho.gov")).toBe(false);
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , , la, ln, bb] of ID_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("keys do not collide with the 13 hand-written OITS rows", () => {
    const hand = new Set(["ada", "bearlake", "boise", "camas", "gooding", "jerome", "lincoln", "minidoka", "nezperce", "oneida", "teton", "valley", "washington"]);
    for (const [k] of ID_ROWS) expect(hand.has(k), k).toBe(false);
  });
});

describe("a recorded real lot from each source reads back parcel id and (where the layer has one) owner", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const row = COUNTIES[slugOf(name)];
    expect(row, name).toBeTruthy();
    expect(row.idField, name).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) expect(rec.owner, `${name}: owner`).toBeTruthy();
  });
});
