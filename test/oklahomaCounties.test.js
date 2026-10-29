/* NEW-1 (Oklahoma, 2026-10-19) — every one of Oklahoma's 77 counties resolves to a REAL outcome: a connected parcel source, or an explicit, named gap
 * ("<County> — no parcel data wired here yet.") that carries a recorded, re-searched reason. Never a county that is silently empty.
 *
 * RED-PROOF: on main only Oklahoma and Tulsa counties had rows, so the 14 counties wired here fell through to no-source; `git stash`-ing counties.js's okRaw/okMap spreads
 * turns every "wired" case below red. The county list is the Census-derived polygon asset (fixture header), never hand-picked. The state's statewide parcel mosaic is WMS-only (no ArcGIS layer),
 * so a gap must not borrow one; the second pass (B2497472) wired every former gap — 52 to that mosaic through /okparcels. Adding a county to gaps is a claim (docs/STATEWIDE-PARCELS.md "Oklahoma counties (2026-10-19)" records what was searched). */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, COUNTIES_MAP, countyIdentity, noParcelSourceNote } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { countyRecord, ownerName } from "../src/workspaces/site-planner/lib/appraisal.js";
import { OK_ROWS } from "../src/workspaces/site-planner/lib/okParcels.js";
import { OKLAHOMA_VERIFICATION } from "../src/workspaces/site-planner/lib/okProvenance.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/oklahomaCounties.json", import.meta.url), "utf8"));
const SAMPLES = JSON.parse(readFileSync(new URL("./fixtures/oklahomaSamples.json", import.meta.url), "utf8")).rows;
beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const bare = (n) => n.replace(/ County$/, "");
const slugOf = (n) => "ok_" + bare(n).toLowerCase().replace(/[^a-z]/g, "");
const HAND = new Set(["Oklahoma", "Tulsa"]); // hand-written in counties.js
const wiredKeys = Object.keys(COUNTIES).filter((k) => k.startsWith("ok_"));

describe("the computed county list", () => {
  it("is Oklahoma's 77 counties", () => {
    expect(FX.counties).toHaveLength(77);
    expect(new Set(FX.counties.map((c) => c.state))).toEqual(new Set(["OK"]));
  });
  it("every county is either wired or a named gap, never both and never neither", () => {
    expect(wiredKeys.length + Object.keys(FX.gaps).length).toBe(77);
    for (const c of FX.counties) expect(wiredKeys.includes(slugOf(c.name)) !== (bare(c.name) in FX.gaps), c.name).toBe(true);
  });
  it("every gap records WHY, after a re-search — a bare 'no source' is not a reason", () => {
    for (const [n, g] of Object.entries(FX.gaps)) {
      expect(g.kind, n).toMatch(/^(none-found|no-public-service|viewer-no-rest|tax-roll-only|partial-coverage|token-required)$/);
      expect(g.reason.length, n).toBeGreaterThan(80);
    }
  });
});

describe("a point inside each Oklahoma county resolves to that county's source or an explicit gap", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_l, c) => {
    const id = countyIdentity(c.lat, c.lng);
    expect(id.status, "must not be 'outside' or 'pending'").not.toBe("outside");
    expect(id.name).toBe(c.name);
    if (bare(c.name) in FX.gaps) {
      expect(id.status).toBe("no-source");
      expect(id.statewideKey, "a gap must not borrow a statewide layer").toBeUndefined();
      expect(noParcelSourceNote(id)).toContain(c.name);
    } else {
      expect(id.status).toBe("ok");
      expect(id.key).toBe(slugOf(c.name));
      expect(COUNTIES[id.key].layerUrl).toBeTruthy();
      expect(COUNTIES_MAP[id.key].state).toBe("OK");
    }
  });
});

describe("spread and county-line points land on the county they belong to", () => {
  const pts = FX.counties.flatMap((c) => [...c.spread.map((p, i) => ["spread " + (i + 1), c, p]), ...c.line.map((p, i) => ["line " + (i + 1), c, p])]);
  it.each(pts.map((x) => [`${x[1].name} · ${x[0]}`, x]))("%s", (_n, [, c, [la, ln]]) => {
    const id = countyIdentity(la, ln);
    expect(id.state).toBe("OK");
    expect(id.name).toBe(c.name);
  });
});

describe("the wired Oklahoma rows", () => {
  it("the table and the registry agree on which counties are wired", () => {
    expect(new Set(wiredKeys)).toEqual(new Set([...OK_ROWS.map(([k]) => "ok_" + k), ...[...HAND].map((n) => "ok_" + n.toLowerCase())]));
    expect(OK_ROWS).toHaveLength(75); // 14 from the first pass + 61 from the second (B2497472): no Oklahoma gap is left
  });
  it("a host that is not *.arcgis.com rides the relay (and the relay allows it) or is the state-layer adapter (/okparcels, our own Pages Function)", () => {
    for (const [k, , u] of OK_ROWS) {
      if (/^https:\/\/[^/]*arcgis\.com\//.test(u) || u.startsWith("/okparcels/")) continue;
      expect(u, k).toMatch(/^\/gis-proxy\//);
      expect(ALLOWED_HOSTS.has(u.split("/")[2]), `${k} → ${u.split("/")[2]}`).toBe(true);
    }
  });
  it("no two counties share a layer AND a scope (a shared layer is scoped per county — test/oklahomaSecondPass.test.js)", () => {
    const keys = OK_ROWS.map((r) => r[2] + "|" + (r[9] || ""));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("each county's bbox contains its centre point, and every row pins its measured id column", () => {
    for (const [k, n, , , , , la, ln, bb] of OK_ROWS) {
      expect(la >= bb[0] && la <= bb[2] && ln >= bb[1] && ln <= bb[3], n).toBe(true);
      expect(COUNTIES["ok_" + k].pinIdField, k).toBe(true);
    }
  });
  it("every wired row has a provenance record, and a dated copy says so", () => {
    for (const [k] of OK_ROWS) {
      const v = OKLAHOMA_VERIFICATION["ok_" + k];
      expect(v, k).toBeTruthy();
      expect(["2026-10-19", "2026-10-29"], k).toContain(v.verifiedOn);
      expect(v.publisherName.length, k).toBeGreaterThan(5);
    }
    // Garfield's 2015 county copy was replaced 2026-10-29 by the City of Enid's current layer (B2497472)
    expect(OKLAHOMA_VERIFICATION.ok_garfield.publisherName).toMatch(/City of Enid/);
  });
});

describe("a recorded real lot from each source reads back parcel id and (where the layer has one) owner", () => {
  it("the fixture covers every wired county", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(OK_ROWS.map(([, n]) => n).sort());
  });
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    const row = COUNTIES[slugOf(name)];
    expect(row, name).toBeTruthy();
    expect(row.idField, name).toBe(s.idField);
    expect(s.attrs[s.idField], `${name}: the recorded row carries the pinned id column`).toBeTruthy();
    const rec = countyRecord(s.attrs, { idField: row.idField, addrField: row.addrField });
    expect(rec.account, `${name}: parcel id`).toBeTruthy();
    if (s.expectOwner) {
      expect(rec.owner, `${name}: owner`).toBeTruthy();
      expect(rec.owner, `${name}: the owner is not a number`).not.toMatch(/^[0-9][0-9.\-\s/]*$/);
    } else expect(ownerName(s.attrs)).toBeNull();
  });
});

describe("measured on live services (recorded by the wiring session)", () => {
  it.each(Object.entries(SAMPLES))("%s", (name, s) => {
    expect(s.measured.hits, `${name}: polygons with a parcel id at 5 interior + 4 county-line points`).toBeGreaterThanOrEqual(5);
    expect(s.measured.edgeHits, `${name}: points beside the county line`).toBeGreaterThanOrEqual(1);
    const e = s.measured.extent;
    expect(e[0] >= -103.1 && e[2] <= -94.4 && e[1] >= 33.6 && e[3] <= 37.1, `${name}: extent inside Oklahoma`).toBe(true);
  });
});
