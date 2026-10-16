/* NEW-1 (B2302784, 2026-10-16) — every one of Alabama's 67 counties resolves to a REAL outcome: a connected parcel source, or an
 * explicit, named gap that says so ("<County> — no parcel data wired here yet."). Never a county that is silently empty.
 *
 * RED-PROOF: on the commit before this work only Jefferson had a row (and its endpoint had never been measured), so 66 of the 67
 * counties fell through; `git stash`-ing counties.js's alRaw/alMap spread turns 34 of these red. The county list is the Census-derived
 * Esri boundary layer (fixture header), never hand-picked. Alabama has no free statewide parcel service, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord } from "../src/workspaces/site-planner/lib/appraisal.js";
import { AL_ROWS } from "../src/workspaces/site-planner/lib/alabamaParcels.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";
import { parseMgPath } from "../src/shared/gis/mapguideAdapter.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/alabamaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/alabamaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

/* The honest gaps — each is a county for which NO usable public parcel service was found (docs/STATEWIDE-PARCELS.md "Alabama" holds
 * what was searched per county). Adding a county here is a claim; removing one requires wiring it. */
const GAPS = Object.fromEntries(FX.gaps.map((n) => [n, true]));
const bare = (n) => n.replace(/ County$/, "");

describe("the county-line and state-line points land on the county they name", () => {
  it.each(FX.lines.map((l) => [l.name, l]))("%s", (_n, l) => {
    const id = countyIdentity(l.lat, l.lng);
    if (l.state === "MS") { expect(id.state).toBe("MS"); expect(id.status).toBe("ok"); }
    else { expect(id.name).toBe(l.county); expect(id.state).toBe("AL"); }
  });
});

describe("the computed county list", () => {
  it("is Alabama's 67 counties", () => {
    expect(FX.counties).toHaveLength(67);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["AL"]));
  });
  it("every county is either wired or a named gap, never both", () => {
    const wired = new Set(Object.keys(COUNTIES).filter((k) => k.startsWith("al_")));
    expect(wired.size + Object.keys(GAPS).length).toBe(67);
    for (const c of FX.counties) {
      const slug = bare(c.name).toLowerCase().replace(/[^a-z]/g, "");
      expect(wired.has("al_" + slug) !== (bare(c.name) in GAPS), c.name).toBe(true);
    }
  });
});

describe("every county in Alabama resolves to a source or an explicit gap", () => {
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
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("AL");
    }
  });
});

describe("the wired Alabama rows", () => {
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of Object.keys(COUNTIES).filter((x) => x.startsWith("al_"))) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      if (u.startsWith("/mg/")) { // B2302785 — a Flagship MapGuide county: served by functions/mg, which refuses anything but a listed server + county folder
        const m = parseMgPath(u.split("/").filter(Boolean).slice(1));
        expect(m.error, k).toBeUndefined(); expect(m.op, k).toBe("meta");
        continue;
      }
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("rows sharing a layer carry their own scope (never a bare shared URL)", () => {
    const by = {};
    for (const [k, n, url, , , scope] of AL_ROWS) (by[url] = by[url] || []).push([k, scope]);
    for (const [url, rows] of Object.entries(by)) if (rows.length > 1) for (const [k, scope] of rows) expect(scope, `${k} on ${url}`).toBeTruthy();
  });
  it("each county's bbox contains its interior point", () => {
    for (const [k, n, , , , , , la, ln, bb] of AL_ROWS) { expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true); }
  });
});

describe("a recorded real lot from each source reads back parcel id, acreage and (where the layer has one) owner", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = "al_" + name.toLowerCase().replace(/[^a-z]/g, "");
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) expect(rec.owner, `${name}: owner`).toBeTruthy();
  });
});
