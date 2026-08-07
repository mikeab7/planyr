/* NEW-5 / NEW-6 — the Colorado county registry, its provenance discipline, and the map zoom floor.
 *
 * The registry tests are about HONESTY as much as correctness: the brief's instruction was to
 * verify each endpoint live rather than trust a guessed URL, so the tests below assert that every
 * shipped primary is either (a) live-probed, with a date, or (b) the statewide composite standing
 * in — and never a plausible-looking URL nobody could reach.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  COUNTIES, COUNTIES_MAP, candidateCountiesForPoint, statewideFallbackFor,
  countyKeyForName, countyKeysForState, stateForCountyKey,
} from "../src/workspaces/site-planner/lib/counties.js";
import { JURISDICTION_SOURCES, countySourcesForPoint } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";
import { COUNTY_VERIFICATION, verifiedOnFor, candidateUrlFor, provenanceFor } from "../src/workspaces/site-planner/lib/countiesProvenance.js";

const CO_KEYS = ["co_adams", "co_denver", "co_arapahoe", "co_larimer", "co_weld", "co_jefferson", "co_elpaso", "co_boulder", "co_broomfield"];
const CO_STATEWIDE = "https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0";

describe("NEW-5 · all nine Colorado counties are registered", () => {
  it("registers each target county in both the search and map registries", () => {
    for (const k of CO_KEYS) {
      expect(COUNTIES[k], k).toBeTruthy();
      expect(COUNTIES_MAP[k], k).toBeTruthy();
      expect(COUNTIES[k].state, k).toBe("CO");
      expect(COUNTIES_MAP[k].state, k).toBe("CO");
      expect(COUNTIES[k].layerUrl, k).toMatch(/^https:\/\//);
    }
    expect(countyKeysForState("CO")).toHaveLength(9);
    // B209503 grew the Texas side from four counties to nine (the Houston metro is nine counties).
    // Asserted in full, in config order, because this list IS the click-routing fallback order.
    expect(countyKeysForState("TX")).toEqual([
      "harris", "fortbend", "chambers", "waller",
      "montgomery", "brazoria", "galveston", "liberty", "austintx",
    ]);
  });

  it("uses co_-prefixed keys so the El Paso / Jefferson collisions are impossible", () => {
    // Both states have an El Paso County AND a Jefferson County. The Texas keys are persisted in
    // saved plans and could not be renamed, so the Colorado ones carry the prefix.
    expect(COUNTIES_MAP.co_elpaso).toBeTruthy();
    expect(COUNTIES_MAP.elpaso).toBeUndefined();
    expect(stateForCountyKey("co_jefferson")).toBe("CO");
    expect(stateForCountyKey("harris")).toBe("TX");
  });

  it("keeps an unqualified name lookup Texas-only, and reaches Colorado only with a state", () => {
    expect(countyKeyForName("Harris")).toBe("harris");
    expect(countyKeyForName("Adams")).toBeNull();          // unqualified → Texas only
    expect(countyKeyForName("El Paso")).toBeNull();        // ambiguous unqualified → refuse
    expect(countyKeyForName("Adams", "CO")).toBe("co_adams");
    expect(countyKeyForName("El Paso", "CO")).toBe("co_elpaso");
    expect(countyKeyForName("City and County of Broomfield", "CO")).toBe("co_broomfield");
    expect(countyKeyForName("Harris", "CO")).toBeNull();   // wrong state → refuse, never guess
  });
});

describe("NEW-5 · endpoint provenance is recorded, never assumed", () => {
  it("every shipped primary is either live-probed or the statewide composite", () => {
    for (const k of CO_KEYS) {
      const c = COUNTIES[k];
      const probed = !!verifiedOnFor(k);
      const onComposite = c.layerUrl === CO_STATEWIDE;
      expect(probed || onComposite, `${k} ships an endpoint that is neither probed nor the composite`).toBe(true);
      if (probed) expect(verifiedOnFor(k), k).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("records a candidate endpoint WITH its provenance rather than shipping it unverified", () => {
    for (const k of CO_KEYS) {
      const c = COUNTIES[k];
      if (!candidateUrlFor(k)) continue;
      expect(c.layerUrl, `${k} shipped its unverified candidate as the primary`).toBe(CO_STATEWIDE);
      // Provenance lives in a Node-only sidecar so its prose stays off the browser bundle; it is
      // no less required for that, and the audit fails the build without it.
      expect(provenanceFor(k), k).toBeTruthy();
      expect(provenanceFor(k), k).toMatch(/ArcGIS Online item|blocked|pending/i);
    }
  });

  it("has the four live-probed counties pointing at their own service", () => {
    for (const k of ["co_adams", "co_denver", "co_weld", "co_broomfield"]) {
      expect(verifiedOnFor(k), k).toBe("2026-07-29");
      expect(COUNTIES[k].layerUrl, k).not.toBe(CO_STATEWIDE);
      expect(COUNTIES[k].layerUrl, k).toMatch(/arcgis\.com/);   // AGOL-hosted → CORS-open, no key
    }
  });

  it("scopes every composite-backed county to its own county name", () => {
    for (const k of CO_KEYS) {
      if (COUNTIES[k].layerUrl !== CO_STATEWIDE) continue;
      expect(COUNTIES[k].scopeWhere, k).toMatch(/^countyName='/);
    }
  });
});

describe("NEW-5 · the fallback chain has a Colorado bottom tier", () => {
  it("gives each own-service county a statewide backup, scoped to that county", () => {
    for (const k of ["co_adams", "co_denver", "co_weld", "co_broomfield"]) {
      const fb = statewideFallbackFor(k);
      expect(fb, k).toBeTruthy();
      expect(fb.layerUrl, k).toBe(CO_STATEWIDE);
      expect(fb.scopeWhere, k).toMatch(/^countyName='/);
      expect(fb.label, k).toMatch(/Colorado/);
    }
  });

  it("returns null for a county already ON the composite — no self-referential backup", () => {
    // Exactly the Waller case in Texas.
    expect(statewideFallbackFor("co_jefferson")).toBeNull();
    expect(statewideFallbackFor("waller")).toBeNull();
  });

  it("keeps the two states' statewide layers distinct", () => {
    expect(statewideFallbackFor("co_adams").layerUrl).toBe(CO_STATEWIDE);
    expect(statewideFallbackFor("harris").layerUrl).toMatch(/stratmap_land_parcels/);
    expect(statewideFallbackFor("harris").label).toMatch(/TxGIO/);
    expect(statewideFallbackFor("co_adams").label).toMatch(/Colorado/);
  });

  it("never mixes a Texas backup into a Colorado click, or vice versa", () => {
    const co = candidateCountiesForPoint(40.4233, -104.7091);   // Greeley, Weld County
    const tx = candidateCountiesForPoint(29.7604, -95.3698);
    expect(co).toContain("co_statewide");
    expect(co).not.toContain("txgio_statewide");
    expect(tx).toContain("txgio_statewide");
    expect(tx).not.toContain("co_statewide");
  });
});

describe("NEW-5 · county identify is region-routed, and Texas gets the SAME object", () => {
  it("returns the identical TxDOT source object for Texas and for anywhere outside Colorado", () => {
    // Identity, not equality: proving Texas resolves to the exact same registry row it always did
    // is the whole "additive, not refactored" claim for this file.
    for (const [lat, lng] of [[29.7604, -95.3698], [30.0, -95.86], [31.76, -106.485], [45.5, -122.6], [NaN, NaN]]) {
      const srcs = countySourcesForPoint(lat, lng);
      expect(srcs).toHaveLength(1);
      expect(srcs[0], `${lat},${lng}`).toBe(JURISDICTION_SOURCES.county);
    }
  });

  it("routes a Colorado point to Colorado's own county layer", () => {
    for (const [lat, lng] of [[39.7392, -104.9903], [40.5853, -105.0844], [38.8339, -104.8214]]) {
      expect(countySourcesForPoint(lat, lng)[0]).toBe(JURISDICTION_SOURCES.countyCo);
    }
    expect(JURISDICTION_SOURCES.countyCo.role).toBe("county");  // downstream consumers read `role`
    expect(JURISDICTION_SOURCES.countyCo.url).toBe(GIS_SOURCES.countyCo.serviceUrl);
  });

  it("keeps the verification record OFF the browser bundle but still complete", () => {
    // The sidecar is Node-only by design (bundle budget). "Not shipped" must not become
    // "not recorded", so every county still has an entry.
    for (const k of [...CO_KEYS, "harris", "fortbend", "chambers"]) expect(COUNTY_VERIFICATION[k], k).toBeTruthy();
    for (const k of CO_KEYS) expect(COUNTIES[k].verifiedOn, `${k} leaked its verification date into the browser module`).toBeUndefined();
  });

  it("registers the Colorado boundary layer as a production, live-verified source", () => {
    expect(GIS_SOURCES.countyCo.tier).toBe("production");
    expect(GIS_SOURCES.countyCo.lastVerified).toBe("2026-07-29");
    expect(GIS_SOURCES.countyCo.fields.name).toBe("NAME20");
  });
});

describe("NEW-6 · the map can be zoomed out far enough to reach both states", () => {
  it("does not floor the map finder above a continental zoom", () => {
    // The reported "can't zoom out far enough" was a hard `minZoom: 8` on the Leaflet map — not a
    // bounds clamp (none is set), not tile coverage (Esri and USGS both serve from z0), and not
    // the projection (one Web Mercator worldwide). At z8 the view spans a few counties, so there
    // was no way to pull back and see another state. This guards the regression.
    const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    const m = src.match(/L\.map\([^)]*minZoom:\s*(\d+)/);
    expect(m, "MapFinder no longer sets minZoom on the Leaflet map — check this guard still applies").toBeTruthy();
    expect(Number(m[1]), "minZoom is too high to see two states at once").toBeLessThanOrEqual(4);
  });

  it("sets no maxBounds that could re-introduce a regional clamp", () => {
    const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/setMaxBounds|maxBounds\s*:/);
  });
});
