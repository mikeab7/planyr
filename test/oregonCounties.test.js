/* NEW-1 (B2347696, 2026-10-19) — every one of Oregon's 36 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap
 * ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on main (70a26e2) only Multnomah and Clackamas had rows, so the 31 counties wired here fell through to no-source; `git stash`-ing
 * counties.js's orRaw/orMap spread turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture header),
 * never hand-picked. Oregon has no free queryable statewide taxlot layer (DOR ORMAP is permission-gated, ODF's TaxlotsDisplay has no Query), so a
 * gap must not borrow one. Adding a county to GAPS is a claim (docs/STATEWIDE-PARCELS.md "Oregon counties (2026-10-19)" records what was
 * searched); removing one requires wiring it. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { OR_ROWS } from "../src/workspaces/site-planner/lib/orParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/oregonCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/oregonSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "or_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");

describe("the computed county list", () => {
  it("is Oregon's 36 counties", () => {
    expect(FX.counties).toHaveLength(36);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["OR"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("or_")));
    expect(wired.size + Object.keys(GAPS).length).toBe(36);
    for (const c of FX.counties) expect(wired.has(slugOf(c.name)) !== (bare(c.name) in GAPS), c.name).toBe(true);
  });
});

describe("a point inside each Oregon county resolves to that county's source or an explicit gap", () => {
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
      expect(COUNTIES_MAP[id.key].state).toBe("OR");
    }
  });
});

describe("a point near each county line still lands on the county it belongs to", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.state).toBe("OR");
  });
});

describe("the wired Oregon rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const [k, , u] of OR_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no row borrows another county's layer unless it is scoped to its own county", () => {
    const seen = new Map();
    for (const [k, , u, , , scope] of OR_ROWS) {
      const key = u + "|" + (scope || "");
      expect(seen.has(key), `${k} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, k);
      if (OR_ROWS.filter((r) => r[2] === u).length > 1) expect(scope, `${k} shares a layer, so it must be scoped`).toBeTruthy();
    }
  });
  it("never uses the Union County, New Mexico viewer layer or a retired state layer", () => {
    for (const [k, , u] of OR_ROWS) {
      expect(u, k).not.toMatch(/gnb0XNi8MQr59YEn/); // Union_County_Assessor_Rnumbers — Union County NM
      expect(u, k).not.toMatch(/or_cadastral_wm/); // retired (HTTP 400)
      expect(u, k).not.toMatch(/DOR_ORMAP/); // permission-gated
    }
  });
  it("each county's bbox contains its centre point", () => {
    for (const [, n, , , , , , la, ln, bb] of OR_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("keys do not collide with the two hand-written rows", () => {
    for (const [k] of OR_ROWS) expect(["multnomah", "clackamas"].includes(k), k).toBe(false);
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
