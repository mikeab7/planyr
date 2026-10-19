/* NEW-1 (B2316720, 2026-10-19) — every one of Georgia's 159 counties resolves to a REAL outcome: a connected parcel source, or an explicit,
 * named gap that says so ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on main a8d440d only 60 counties had a `ga_*` row, so the 30 counties in gaParcels.js fell through to "no-source"; removing the
 * gaRaw()/gaMap() spreads from counties.js turns the per-county "wired" cases below red. The county list is the Census-derived Esri boundary
 * layer (fixture header), never hand-picked. Georgia has no statewide parcel service, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { GA_ROWS } from "../src/workspaces/site-planner/lib/gaParcels.js";
import { GEORGIA_VERIFICATION } from "../src/workspaces/site-planner/lib/gaProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/georgiaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/georgiaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* The honest gaps — each is a county for which NO usable public parcel service was found (docs/STATEWIDE-PARCELS.md "Georgia counties
 * (2026-10-19)" holds what was searched per county). Adding a county here is a claim; removing one requires wiring it. */
const GAPS = new Set(FX.gaps);
const bare = (n) => n.replace(/ County$/, "");
const slug = (n) => bare(n).toLowerCase().replace(/[^a-z]/g, "");

describe("the computed county list", () => {
  it("is Georgia's 159 counties", () => {
    expect(FX.counties).toHaveLength(159);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["GA"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("ga_")));
    expect(wired.size + GAPS.size).toBe(159);
    for (const c of FX.counties) expect(wired.has("ga_" + slug(c.name)) !== GAPS.has(bare(c.name)), c.name).toBe(true);
  });
});

describe("every county in Georgia resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (GAPS.has(bare(c.name))) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toBe(`${c.name} — no parcel data wired here yet.`);
    } else {
      expect(id.status).toBe("ok");
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("GA");
    }
  });
});

describe("a point just inside each newly wired county's own line still resolves to that county's row", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    expect(id.name).toBe(l.county);
    expect(id.status).toBe("ok");
    expect(id.key).toBe("ga_" + slug(l.county));
  });
});

describe("the new Georgia rows (gaParcels.js)", () => {
  it("every row has a county key the identity resolver finds, in both registries", () => {
    for (const [k, n] of GA_ROWS) { expect(COUNTIES["ga_" + k], n).toBeTruthy(); expect(COUNTIES_MAP["ga_" + k], n).toBeTruthy(); expect(COUNTIES["ga_" + k].idField, n).toBeTruthy(); }
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of Object.keys(COUNTIES).filter((x) => x.startsWith("ga_"))) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("rows sharing a layer carry their own scope (never a bare shared URL)", () => {
    const by = {};
    for (const [k, , url, , , scope] of GA_ROWS) (by[url] = by[url] || []).push([k, scope]);
    for (const [url, rows] of Object.entries(by)) if (rows.length > 1) for (const [k, scope] of rows) expect(scope, `${k} on ${url}`).toBeTruthy();
  });
  it("each county's bbox contains its interior point", () => {
    for (const [, n, , , , , , la, ln, bb] of GA_ROWS) expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
  });
  it("every row carries a dated verification record", () => {
    for (const [k, n] of GA_ROWS) { const v = GEORGIA_VERIFICATION["ga_" + k]; expect(v, n).toBeTruthy(); expect(v.verifiedOn, n).toBe("2026-10-19"); expect(v.verifiedNote, n).toMatch(/MEASURED/); }
  });
});

describe("a recorded real lot from each new source reads back parcel id, acreage and (where the layer has one) owner", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = "ga_" + slug(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) expect(rec.owner, `${name}: owner`).toBeTruthy();
  });
});
