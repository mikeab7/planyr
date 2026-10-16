/* NEW-1 (Mississippi, 2026-10-16) — all 82 Mississippi counties resolve to a parcel source or an explicit named gap.
 *
 * RED-PROOF: on main only 25 of the 82 had a source (24 MARIS + DeSoto); the other 57 reported "no parcel data wired here
 * yet". The county list is the 82 MS polygons in public/geo/county-polygons.json (Census-derived), never hand-picked.
 * MARIS (gis.mississippi.edu, Cadastral/MS_Parcels_August_2024) holds each county on exactly ONE of its two layers
 * (1 West / 2 East) — pinned per county, measured live 2026-10-16 (count>0 on exactly one layer for every county). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, countyIdentity, noParcelSourceNote, candidateCountiesForPoint } from "../src/workspaces/site-planner/lib/counties.js";
import { buildIndex, pointInRing } from "../src/workspaces/site-planner/lib/countyPolygonsCore.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { beforeAll } from "vitest";

const RAW = JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8"));
beforeAll(async () => { await setCountyPolygons(RAW); });
const idx = buildIndex(RAW);
const MS = idx.counties.filter((c) => c.state === "MS");
/* No MS county lacks a source today; a county MARIS cannot serve would be listed here with its reason. */
const NAMED_GAPS = new Set([]);

/* An interior point nearest the bbox centre, found by scanning (counties are concave). Quantised units → degrees. */
function interior(c) {
  const [x0, y0, x1, y1] = c.bbox, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, S = idx.scale;
  let best = null, bd = Infinity;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
    const x = x0 + ((x1 - x0) * i) / 40, y = y0 + ((y1 - y0) * j) / 40;
    if (!c.rings.some((r) => pointInRing(r, x, y))) continue;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return [best[1] / S, best[0] / S, best];
}

describe("Mississippi — every one of the 82 counties", () => {
  it("is 82 counties", () => expect(MS).toHaveLength(82));
  it.each(MS.map((c) => [c.name, c]))("%s resolves to a source or an explicit named gap", (_n, c) => {
    const [lat, lng] = interior(c);
    const id = countyIdentity(lat, lng);
    expect(id.name).toBe(c.name);
    if (NAMED_GAPS.has(c.name)) {
      expect(id.status).toBe("no-source");
      expect(noParcelSourceNote(id)).toMatch(/no parcel data/);
      return;
    }
    expect(id.status, `${c.name} has no source`).toBe("ok");
    const src = COUNTIES[id.key];
    expect(src.layerUrl).toBeTruthy();
    expect(candidateCountiesForPoint(lat, lng)).toContain(id.key);
    if (id.key !== "ms_desoto") {
      expect(src.layerUrl).toMatch(/^\/gis-proxy\/gis\.mississippi\.edu\/.*MS_Parcels_August_2024\/MapServer\/[12]$/);
      expect(src.scopeWhere).toMatch(/^CNTYNAME='[A-Z_]+'$/);
    }
  });

  it("points just inside the county line still route to that county's own source", () => {
    const bad = [];
    for (const c of MS) {
      const [lat0, lng0, [ix, iy]] = interior(c);
      const ring = c.rings[0];
      for (let k = 0; k < ring.length; k += Math.max(1, Math.floor(ring.length / 6))) {
        const [vx, vy] = ring[k];
        // step 25% toward the interior point: well off the simplified line, near the county edge
        const x = vx + (ix - vx) * 0.25, y = vy + (iy - vy) * 0.25;
        if (!c.rings.some((r) => pointInRing(r, x, y))) continue;
        const lat = y / idx.scale, lng = x / idx.scale;
        const id = countyIdentity(lat, lng);
        if (id.name !== c.name) continue; // the simplified asset puts this on the neighbour's side; not our county's point
        if (!candidateCountiesForPoint(lat, lng).includes(id.key)) bad.push(`${c.name} @ ${lat.toFixed(4)},${lng.toFixed(4)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the two layers are split sensibly: Hinds/Rankin/Madison West, Harrison/Jackson/Lauderdale East; Jefferson Davis + Pearl River use MARIS's own spellings", () => {
    for (const k of ["hinds", "rankin", "madison", "adams", "washington"]) expect(COUNTIES["ms_" + k].layerUrl, k).toMatch(/\/1$/);
    for (const k of ["harrison", "jackson", "lauderdale", "forrest", "lowndes"]) expect(COUNTIES["ms_" + k].layerUrl, k).toMatch(/\/2$/);
    expect(COUNTIES.ms_jeffersondavis.scopeWhere).toBe("CNTYNAME='JEFFERSON_DAVIS'");
    expect(COUNTIES.ms_pearlriver.scopeWhere).toBe("CNTYNAME='PEARLRIVER'");
  });
});
