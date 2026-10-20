/* NEW-1 (Pennsylvania, 2026-10-19) — every one of Pennsylvania's 67 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so
 * ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main only Allegheny, Northampton, Cumberland, Lehigh, Luzerne and Lackawanna were wired, so 60 of these counties fell through to "no-source" and the per-county assertions
 * below go red; `git stash`-ing the paRaw/paMap spreads in counties.js turns 60 of them red again. The county list is the repo's own bundled county polygons (fixture header), never hand-picked.
 * Pennsylvania has no free statewide parcel service with owners, so a gap must not borrow one. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { PA_ROWS } from "../src/workspaces/site-planner/lib/paParcels.js";
import { PENNSYLVANIA_VERIFICATION } from "../src/workspaces/site-planner/lib/paProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/paCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/paSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "pa_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const hand = new Set(["pa_allegheny", "pa_northampton", "pa_cumberland", "pa_lehigh", "pa_luzerne", "pa_lackawanna"]); // hand-written in counties.js since 2026-09, not in PA_ROWS
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("pa_"));

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("PA");
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Pennsylvania's 67 counties", () => {
    expect(FX.counties).toHaveLength(67);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(67);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(owner-decision|login-required|adapter-needed|no-api|none-found)$/);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
  it("the hand-written six are still there", () => {
    for (const k of hand) expect(COUNTIES[k], k).toBeTruthy();
  });
});

describe("every county in Pennsylvania resolves to a source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in FX.gaps) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toBe(`${c.name} — no parcel data wired here yet.`);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(keyOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("PA");
    }
  });
});

describe("Philadelphia is one consolidated city-county", () => {
  it("keys as pa_philadelphia and a downtown point resolves to it", () => {
    expect(countyKeyForName("Philadelphia County", "PA")).toBe("pa_philadelphia");
    expect(countyIdentity(39.9526, -75.1652).key).toBe("pa_philadelphia");
    expect(COUNTIES.pa_philadelphia.layerUrl).toContain("PWD_PARCELS");
  });
});

describe("the wired Pennsylvania rows", () => {
  const ROW_KEYS = PA_ROWS.map(([k]) => "pa_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...ROW_KEYS, ...hand]));
    expect(PA_ROWS).toHaveLength(60);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no row carries a token or key in its URL", () => {
    for (const k of ROW_KEYS) expect(COUNTIES[k].layerUrl, k).not.toMatch(/token|key=/i);
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , id, , la, ln, bb] of PA_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["pa_" + k].pinIdField, k).toBe(true);
      expect(COUNTIES["pa_" + k].idField, k).toBe(id);
    }
  });
  it("every wired Pennsylvania row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = PENNSYLVANIA_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-19");
    }
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  // Counties whose recorded row carries no owner column the card can read — geometry + parcel id only (the owner/tax table is not on the published layer).
  const NO_OWNER = new Set(["Blair", "Cambria", "Centre", "Columbia", "Crawford", "Delaware", "Elk", "Erie", "Fulton", "Lycoming", "McKean", "Mifflin", "Monroe", "Montour", "Perry", "Snyder", "Sullivan", "Tioga", "Union", "Venango", "Warren"]);
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(PA_ROWS.map(([, n]) => n + " County").sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = keyOf(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    // the stored account (what the card/list stamps at identify time) is the county's DECLARED column, never a row number or a map-sheet fragment
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs[s.idField]));
    if (!NO_OWNER.has(bare(name))) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toBe(String(s.attrs[s.idField]));
    } else {
      expect(ownerName(s.attrs), `${name}: honestly no owner on this layer`).toBeNull();
    }
  });
  it("Franklin's bare `Name` column is its parcel number, never the owner (the owner is FULL_OWNER)", () => {
    expect(ownerName({ Name: "22-0P20.-016.-000000", FULL_OWNER: "STEPHEN B ETAL WELLER" })).toBe("STEPHEN B ETAL WELLER");
    expect(ownerName({ Name: "22-0P20.-016.-000000" })).toBeNull();
  });
  it("a real person's name in a bare `Name` column is still an owner", () => {
    expect(ownerName({ Name: "HILLER MAURICE E SR" })).toBe("HILLER MAURICE E SR");
    expect(ownerName({ Name: "1ST NATIONAL BANK" })).toBe("1ST NATIONAL BANK");
  });
});

describe("measured on the live relay (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at 5 spread + 4 county-line points`).toBeGreaterThanOrEqual(5);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    if (ext) expect(ext[0] >= -80.6 && ext[2] <= -74.6 && ext[1] >= 39.6 && ext[3] <= 42.4, `${name}: extent inside Pennsylvania`).toBe(true);
  });
});
