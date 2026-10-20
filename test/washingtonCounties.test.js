/* NEW-1 (B2349360, 2026-10-19) — every one of Washington's 39 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap that says so
 * ("<County> — no parcel data wired here yet.") AND carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main (70a26e2) not one Washington county was wired, so all 34 of the per-county assertions below go red ("no-source" instead of "ok"); `git stash`-ing the
 * waRaw/waMap spreads in counties.js turns them red again. The county list is the repo's own bundled county polygons (fixture header), never hand-picked. The licence-restricted
 * statewide mosaic (WAGeoservices / WDFW) is deliberately NOT used, so a gap must not borrow it. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote, countyKeyForName, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";
import { WA_ROWS } from "../src/workspaces/site-planner/lib/waParcels.js";
import { WASHINGTON_VERIFICATION } from "../src/workspaces/site-planner/lib/waProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/waCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/waSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
// The key a county SHOULD have, spelled independently of countyKeyForName (so this test cannot agree with the code by construction).
const keyOf = (n) => "wa_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("wa_"));
const NO_OWNER = new Set(["Clark County", "Kitsap County", "Lewis County", "Pierce County", "Spokane County", "Stevens County", "Yakima County", "King County"]);

describe("the county-line and spread points land on the county they name", () => {
  const pts = FX.counties.flatMap((c) => [...c.line.map((p, i) => ["line " + (i + 1), c, p]), ...c.spread.map((p, i) => ["spread " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("WA");
    expect(id.name).toBe(c.name);
  });
});

describe("the computed county list", () => {
  it("is Washington's 39 counties", () => {
    expect(FX.counties).toHaveLength(39);
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    const wired = new Set(wiredKeys);
    const gapNames = Object.keys(FX.gaps);
    expect(wired.size + gapNames.length).toBe(39);
    for (const c of FX.counties) {
      const isWired = wired.has(keyOf(c.name));
      const isGap = bare(c.name) in FX.gaps;
      expect(isWired !== isGap, c.name).toBe(true);
    }
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(owner-decision|login-required|adapter-needed|no-api|none-found)$/);
      expect(g.reason.length, n).toBeGreaterThan(200);
      expect(g.reason, n).toMatch(/2026-10-19/);
    }
  });
});

describe("every county in Washington resolves to a source or an explicit gap", () => {
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
      expect(COUNTIES_MAP[id.key].state).toBe("WA");
    }
  });
});

describe("the wired Washington rows", () => {
  const ROW_KEYS = WA_ROWS.map(([k]) => "wa_" + k);
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set(ROW_KEYS));
    expect(WA_ROWS).toHaveLength(34);
  });
  it("the licence-restricted statewide mosaic is not used by any row", () => {
    for (const k of ROW_KEYS) expect(COUNTIES[k].layerUrl, k).not.toMatch(/jsIt88o09Q0r1j8h|wdfw|WADNR|Current_Parcels/i);
  });
  it("a host that cannot be reached cross-origin rides the relay, and the relay allows it", () => {
    for (const k of ROW_KEYS) {
      const u = COUNTIES[k].layerUrl;
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u)) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("each county's bbox contains its interior point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of WA_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["wa_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired Washington row has a provenance record (publisher + the date it was measured)", () => {
    for (const k of ROW_KEYS) {
      const v = WASHINGTON_VERIFICATION[k];
      expect(v, k).toBeTruthy();
      expect(v.publisher, k).toMatch(/^(own|third-party)$/);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
      expect(v.verifiedOn, k).toBe("2026-10-19");
    }
  });
  it("the three copies not hosted by their county are labelled third-party", () => {
    for (const k of ["wa_adams", "wa_graysharbor", "wa_klickitat"]) expect(WASHINGTON_VERIFICATION[k].publisher, k).toBe("third-party");
  });
});

describe("a recorded real lot from each source reads back parcel id, address, acreage and (where the layer has one) owner", () => {
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(WA_ROWS.map(([, n]) => n + " County").sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const key = keyOf(name);
    const row = COUNTIES[key];
    expect(row, key).toBeTruthy();
    expect(row.idField, key).toBe(s.idField);
    expect(row.layerUrl, key).toBe(s.url);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    // the stored account (what the card/list stamps at identify time) is the county's DECLARED column, never a row number or a map-sheet fragment
    expect(idAttrFor(key, s.attrs), `${name}: stamped id`).toBe(String(s.attrs[s.idField]));
    if (!NO_OWNER.has(name)) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not the parcel number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    }
  });
  it("the layers that publish no owner honestly carry none", () => {
    for (const n of NO_OWNER) expect(ownerName(SAMPLES[n].attrs), n).toBeNull();
  });
});

describe("measured live (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: sampled parcels re-found by a point query, returning the parcel id`).toBeGreaterThanOrEqual(50);
    expect(s.measured.edgeHits, `${name}: parcels beside the county line`).toBeGreaterThanOrEqual(1);
    const ext = s.measured.extent;
    expect(ext[0] >= -124.9 && ext[2] <= -116.9 && ext[1] >= 45.5 && ext[3] <= 49.05, `${name}: extent inside Washington`).toBe(true);
  });
});

describe("San Juan's islands route to San Juan", () => {
  it("a lot on Orcas, Lopez or Shaw (outside the bundled generalised polygon) still reaches wa_sanjuan by bbox", () => {
    for (const [la, ln] of [[48.6, -122.85], [48.5, -122.9], [48.58, -122.95], [48.5169, -123.0054]]) expect(candidateCountiesForPoint(la, ln), `${la},${ln}`).toContain("wa_sanjuan");
  });
});

describe("county-key spelling", () => {
  it("multi-word counties key without spaces", () => {
    expect(countyKeyForName("Grays Harbor County", "WA")).toBe("wa_graysharbor");
    expect(countyKeyForName("Pend Oreille County", "WA")).toBe("wa_pendoreille");
    expect(countyKeyForName("San Juan County", "WA")).toBe("wa_sanjuan");
    expect(countyKeyForName("Walla Walla County", "WA")).toBe("wa_wallawalla");
  });
  it("a Washington county never answers for a same-named county in another state", () => {
    expect(COUNTIES.wa_lincoln.state).toBe("WA");
    expect(COUNTIES.wa_franklin.state).toBe("WA");
    expect(COUNTIES.wa_jefferson.state).toBe("WA");
  });
});
