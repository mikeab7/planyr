/* NEW-2 (Tennessee, all 95 counties, 2026-10-22) — Check C of the sweep, offline: the parcel id each county's card SHOWS (read off the real source by ui-audit/sweep-tn-counties.mjs and kept in
 * test/fixtures/tnSweepPoints.json with the few attribute columns a search reads) typed back into the Site search lands on the same lot, in the same county, for all 95 — at both recorded lots, with the
 * map nowhere near and with the county named first. The network is replaced by the recorded row; what is proven here is the READING (which sources are asked, how the id is parsed, whether the returned
 * row is accepted as that id) — the where-clauses themselves are proven against the live layers by the sweep.
 * RED-PROOF: on ff7be38 only Davidson and Rutherford were asked and 93 of 95 ids came back `none`. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveParcelId } from "../src/workspaces/site-planner/lib/parcelIdSearch.js";
import { tnParcelIdPlan } from "../src/workspaces/site-planner/lib/tnParcelId.js";
import { idAttrFor } from "../src/workspaces/site-planner/lib/parcelQuery.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/tnSweepPoints.json", import.meta.url), "utf8"));
const SQ = { rings: [[[-86.5, 36.0], [-86.4999, 36.0], [-86.4999, 36.0001], [-86.5, 36.0001], [-86.5, 36.0]]] };
const norm = (v) => String(v == null ? "" : v).toUpperCase().replace(/[^A-Z0-9]/g, "");

const sites = [];
for (const c of FX.counties) {
  if (c.source === "(none)") continue;
  if (c.id) sites.push({ county: c.name, source: c.source, id: c.id, attrs: c.matchAttrs, where: "middle" });
  if (c.dense && c.dense.id) sites.push({ county: c.name, source: c.source, id: c.dense.id, attrs: c.dense.matchAttrs, where: c.dense.town });
}
/* a stand-in server: the recorded row for the source it came from, nothing from any other */
const server = (site) => {
  const row = { attributes: site.attrs, geometry: SQ };
  return {
    lookup: async ({ county }) => ({ feats: county === site.source ? [row] : [] }),
    lookupWhere: async ({ county }) => ({ feats: county === site.source ? [row] : [] }),
  };
};

describe("the id every card shows finds that lot", () => {
  it("covers the 94 counties that have a source, at two lots each where the county has a named place", () => {
    expect(new Set(sites.map((s) => s.county)).size).toBe(94);
    expect(sites.length).toBeGreaterThanOrEqual(180);
  });
  it.each(sites.map((s) => [`${s.county} · ${s.where} · ${String(s.id).trim()}`, s]))("%s", async (_n, s) => {
    expect(tnParcelIdPlan(s.id).length, "the id is read as an id at all").toBeGreaterThan(0);
    const r = await resolveParcelId(s.id, { ...server(s), retryMs: 0, near: { lat: 36.4, lng: -82.4 } });
    expect(r.status, JSON.stringify({ tried: r.tried })).toBe("found");
    expect(r.county).toBe(s.source);
    expect(norm(idAttrFor(r.county, r.feature.attributes))).toBe(norm(s.id));
  });
  it.each(sites.map((s) => [`${s.county} · ${s.where} named first`, s]))("%s", async (_n, s) => {
    const r = await resolveParcelId(`${s.county} ${s.id}`, { ...server(s), retryMs: 0, near: { lat: 36.4, lng: -82.4 } });
    expect(r.status).toBe("found");
    expect(r.county).toBe(s.source);
  });
  it("a county named first asks only that county's source", () => {
    for (const s of sites.slice(0, 40)) {
      const own = new Set(tnParcelIdPlan(`${s.county} ${s.id}`).map((p) => p.county));
      expect(own.size, s.county).toBe(1);
    }
  });
});
