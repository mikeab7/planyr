import { describe, it, expect } from "vitest";
import {
  candidateCountiesForPoint, COUNTIES_MAP, STATEWIDE_KEYS,
  STATEWIDE_PARCEL_LAYER, statewideFallbackFor,
} from "../src/workspaces/site-planner/lib/counties.js";

// candidateCountiesForPoint routes a map click to the CAD service(s) that could
// own the clicked lot, WITHOUT a county pre-pick (B11). The statewide TxGIO layer
// (its own `txgio_statewide` key since B784 decoupled it from Chambers) paints parcel
// outlines across all of Texas, so it must also be queryable everywhere as a universal
// fallback — otherwise a click over a county whose own CAD is down/unconfigured sees an
// outline it can't select (the Fort Bend symptom, B130).
describe("candidateCountiesForPoint — click routing (B11/B130/B784)", () => {
  const STATEWIDE = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

  it("the statewide source is its own `txgio_statewide` key, not chambers (B784)", () => {
    expect(STATEWIDE).toEqual(["txgio_statewide"]);
    expect(STATEWIDE).not.toContain("chambers"); // chambers is now a real CAD (CCAD)
  });

  it("a Fort Bend point includes fortbend AND the statewide source (the B130 fix)", () => {
    // Sugar Land — squarely in Fort Bend, outside the narrow Chambers bbox.
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    expect(cand).toContain("fortbend");
    // txgio_statewide == the statewide TxGIO layer; before B130 it was NOT a candidate
    // here, so a click found nothing whenever FBCAD was down.
    expect(cand).toContain("txgio_statewide");
    expect(cand).not.toContain("chambers"); // Sugar Land isn't in the Chambers bbox
  });

  it("the statewide source is appended LAST so a county's own CAD answers first", () => {
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    // every non-statewide (real CAD bbox match) precedes every statewide key
    const lastBboxIdx = Math.max(...cand.filter((k) => !STATEWIDE.includes(k)).map((k) => cand.indexOf(k)));
    const firstStatewideIdx = Math.min(...STATEWIDE.map((k) => cand.indexOf(k)).filter((i) => i >= 0));
    expect(lastBboxIdx).toBeLessThan(firstStatewideIdx);
  });

  it("a Chambers point routes to the real CCAD key first, with the statewide source appended once", () => {
    // A point inside the Chambers bbox: chambers now matches by bbox (a real CAD), and
    // txgio_statewide is appended once as the trailing fallback — neither is duplicated.
    const cand = candidateCountiesForPoint(29.7, -94.66);
    expect(cand.filter((k) => k === "chambers")).toHaveLength(1);
    expect(cand.filter((k) => k === "txgio_statewide")).toHaveLength(1);
    expect(cand.indexOf("chambers")).toBeLessThan(cand.indexOf("txgio_statewide"));
  });

  it("a Harris point still routes to harris first, with statewide as the trailing fallback", () => {
    const cand = candidateCountiesForPoint(29.76, -95.37);
    expect(cand[0]).toBe("harris");
    expect(cand).toContain("txgio_statewide"); // fallback present, but harris answers first
  });

  it("a point outside every county bbox returns ALL counties, harris-first (jurisdiction default preserved)", () => {
    // Far West Texas — outside all configured county bboxes. The Layers-panel jurisdiction
    // resolver reads candidate[0], so this must stay harris-first (the documented
    // away-from-Houston default), while still including the statewide source so a click out
    // there still has coverage. txgio_statewide has NO bbox, so it can only ever arrive via
    // this "return all" branch or the trailing append — never as candidate[0].
    const cand = candidateCountiesForPoint(31.7619, -106.485); // El Paso
    expect(cand[0]).toBe("harris");
    expect(cand).toContain("txgio_statewide");
    expect(cand).toEqual(Object.keys(COUNTIES_MAP));
  });
});

// The statewide TxGIO layer is the universal fallback when a county's own CAD server
// is down. statewideFallbackFor returns that layer scoped to the requested county, so
// an ID/address search can't leak into another county (B244).
describe("statewideFallbackFor — county-scoped TxGIO backup (B244/B784)", () => {
  it("exposes the statewide key(s) and the all-Texas layer URL", () => {
    expect(STATEWIDE_KEYS).toEqual(["txgio_statewide"]); // B784: its own key, not chambers
    expect(STATEWIDE_PARCEL_LAYER).toMatch(/stratmap_land_parcels/);
  });

  it("Fort Bend → the TxGIO layer scoped to FORT BEND", () => {
    const fb = statewideFallbackFor("fortbend");
    expect(fb.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(fb.scopeWhere).toBe("county='FORT BEND'");
    expect(fb.idField).toBe("prop_id");
    expect(fb.addrField).toBe("situs_addr");
  });

  it("Harris → the TxGIO layer scoped to HARRIS", () => {
    expect(statewideFallbackFor("harris").scopeWhere).toBe("county='HARRIS'");
  });

  it("Chambers → the TxGIO layer scoped to CHAMBERS (B784: CCAD primary now HAS a backup)", () => {
    const ch = statewideFallbackFor("chambers");
    expect(ch).not.toBeNull();
    expect(ch.layerUrl).toBe(STATEWIDE_PARCEL_LAYER);
    expect(ch.scopeWhere).toBe("county='CHAMBERS'");
  });

  it("Waller → null (its PRIMARY is already TxGIO; no separate backup)", () => {
    expect(statewideFallbackFor("waller")).toBeNull();
  });

  it("an unknown county → null", () => {
    expect(statewideFallbackFor("nowhere")).toBeNull();
  });
});
