import { describe, it, expect, vi, afterEach } from "vitest";
import { suggestPlaces } from "../src/workspaces/site-planner/lib/placeSuggest.js";

const center = { lat: 29.78, lng: -95.55 };
afterEach(() => { vi.restoreAllMocks(); });

const ok = (json) => ({ ok: true, json: async () => json });
const bad = () => ({ ok: false, json: async () => ({}) });

describe("suggestPlaces (B831779/NEW-4) — the map toolbar's typeahead lookup", () => {
  it("returns several Esri candidates, biased to the centre", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain("geocode.arcgis.com");
      expect(url).toContain("maxLocations=6");
      expect(url).toContain("location=-95.55,29.78");
      return ok({ candidates: [
        { location: { x: -95.7, y: 29.8 }, address: "123 Main St" },
        { location: { x: -95.71, y: 29.81 }, address: "123 Main St, Katy, TX" },
      ] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { results, reachedAny } = await suggestPlaces("123 Main", center);
    expect(reachedAny).toBe(true);
    expect(results).toEqual([
      { label: "123 Main St", lat: 29.8, lon: -95.7 },
      { label: "123 Main St, Katy, TX", lat: 29.81, lon: -95.71 },
    ]);
  });

  it("falls back to Nominatim when Esri has no candidates", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("geocode.arcgis.com")) return ok({ candidates: [] });
      expect(url).toContain("nominatim.openstreetmap.org");
      expect(url).toContain("limit=6");
      return ok([{ lat: "29.9", lon: "-95.6", display_name: "Somewhere, TX" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { results, reachedAny } = await suggestPlaces("nowhere", center);
    expect(reachedAny).toBe(true);
    expect(results).toEqual([{ label: "Somewhere, TX", lat: 29.9, lon: -95.6 }]);
  });

  it("LOUD-FAILURE (B709696 precedent): both providers reached, neither found anything → empty results, reachedAny true (a genuine no-match, distinct from an outage)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.includes("geocode.arcgis.com") ? ok({ candidates: [] }) : ok([])));
    const { results, reachedAny } = await suggestPlaces("zzzznotaplace", center);
    expect(results).toEqual([]);
    expect(reachedAny).toBe(true);
  });

  it("neither provider reachable → reachedAny false (an outage, never mistaken for a no-match)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bad()));
    const { results, reachedAny } = await suggestPlaces("x", center);
    expect(results).toEqual([]);
    expect(reachedAny).toBe(false);
  });

  it("re-throws AbortError rather than reporting it as a no-match or an outage", async () => {
    const err = new DOMException("aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn(async () => { throw err; }));
    await expect(suggestPlaces("x", center, { signal: new AbortController().signal })).rejects.toBe(err);
  });

  it("dedupes identical labels across a single provider's results", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => (url.includes("geocode.arcgis.com")
      ? ok({ candidates: [
          { location: { x: -95.7, y: 29.8 }, address: "123 Main St" },
          { location: { x: -95.7, y: 29.8 }, address: "123 Main St" },
        ] })
      : ok([]))));
    const { results } = await suggestPlaces("123 Main", center);
    expect(results).toHaveLength(1);
  });
});
