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
/* …and, because a control-map number REPEATS across counties (found live: Hamilton "066  018" also reads as Chester's 012066 01800), every other source that could read the id answers with a
 * DECOY lot built from the same map / letters / parcel — a different lot in a different county, in that source's own shape. The recorded lot must still win with the map nowhere near it. */
const decoyFor = (site, p) => {
  const f = p.form;
  if (!f) return null;
  const link = `${f.map}${(f.tag || "").padEnd(2, " ")} ${" ".repeat(0)}${f.parcel5}`.replace(/\s+/g, " ");
  const attrs = { CMAP: `${f.map}${(f.tag || "")[0] || ""}`, GP: (f.tag || "").slice(1) || " ", PARCEL: `${f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}`, COUNTY_ID: 66, COUNTY_NAME: "Obion", PARCELID: `066 ${link} 000 2026`,
    GISLINK: `066${f.map}${(f.tag || "").padEnd(2, " ")} ${f.parcel5}`.replace(/(\d{3})(\d{3})/, "$1$2"), gislink_1: `066${f.map}    ${f.parcel5}`, L15Parce_2: `066${f.map}    ${f.parcel5}`, ParcelID: `${f.map}-${f.parcel5.slice(0, 3)}.${f.parcel5.slice(3)}-000` };
  return { attributes: attrs, geometry: SQ };
};
const server = (site) => {
  const row = { attributes: site.attrs, geometry: SQ };
  const plan = tnParcelIdPlan(site.id);
  const decoy = (county, where) => { const p = plan.find((q) => q.county === county && (!where || q.where === where)); const d = p && decoyFor(site, p); return d ? [d] : []; };
  return {
    lookup: async ({ county }) => ({ feats: county === site.source ? [row] : decoy(county) }),
    lookupWhere: async ({ county, where }) => ({ feats: county === site.source ? [row] : decoy(county, where) }),
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
