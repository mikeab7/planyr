import { describe, it, expect, vi, afterEach } from "vitest";
import { geocodeAddress } from "../src/workspaces/site-planner/lib/geocode.js";

const center = { lat: 29.78, lng: -95.55 };
afterEach(() => { vi.restoreAllMocks(); });

const ok = (json) => ({ ok: true, json: async () => json });
const bad = () => ({ ok: false, json: async () => ({}) });

describe("geocodeAddress (B384) — shared Esri-first, Nominatim-fallback geocoder", () => {
  it("returns the Esri candidate (lat=y, lon=x) and biases the query to the centre", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).toContain("geocode.arcgis.com");
      expect(url).toContain("location=-95.55,29.78"); // centre bias
      return ok({ candidates: [{ location: { x: -95.7, y: 29.8 }, address: "123 Main St" }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const hit = await geocodeAddress("123 Main St", center);
    expect(hit).toEqual({ lat: 29.8, lon: -95.7, label: "123 Main St" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // Esri hit → no Nominatim call
  });

  it("falls back to Nominatim when Esri has no candidate", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url.includes("geocode.arcgis.com")) return ok({ candidates: [] });
      expect(url).toContain("nominatim.openstreetmap.org");
      expect(url).toContain("viewbox="); // centre-biased box
      return ok([{ lat: "29.9", lon: "-95.6", display_name: "Somewhere, TX" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const hit = await geocodeAddress("nowhere", center);
    expect(hit).toEqual({ lat: 29.9, lon: -95.6, label: "Somewhere, TX" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to Nominatim when the Esri request errors (HTTP not ok)", async () => {
    const fetchMock = vi.fn(async (url) =>
      url.includes("geocode.arcgis.com") ? bad() : ok([{ lat: "30.0", lon: "-95.0", display_name: "Fallback" }]));
    vi.stubGlobal("fetch", fetchMock);
    const hit = await geocodeAddress("x", center);
    expect(hit).toEqual({ lat: 30.0, lon: -95.0, label: "Fallback" });
  });

  it("returns null when both services were REACHED but miss (genuinely not found)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.includes("geocode.arcgis.com") ? ok({ candidates: [] }) : ok([])));
    expect(await geocodeAddress("???", center)).toBeNull();
  });

  it("B540: returns { error } (not null) when NO service is reachable — never throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const r = await geocodeAddress("anything", center);
    expect(r).not.toBeNull();
    expect(typeof r.error).toBe("string");
    expect(r.error.length).toBeGreaterThan(0);
  });

  it("B540: a non-OK from BOTH providers is 'unreachable' ({ error }), not 'not found'", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => bad()));
    const r = await geocodeAddress("x", center);
    expect(r && r.error).toBeTruthy();
  });

  it("B540: reached one provider (Esri OK, empty) then the other threw → null (authoritatively not found)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.includes("geocode.arcgis.com") ? ok({ candidates: [] }) : (() => { throw new Error("nom down"); })()));
    expect(await geocodeAddress("???", center)).toBeNull();
  });

  it("works without a centre (no bias params)", async () => {
    const fetchMock = vi.fn(async (url) => {
      expect(url).not.toContain("location=");
      return ok({ candidates: [{ location: { x: -96, y: 31 } }] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const hit = await geocodeAddress("Dallas", null);
    expect(hit).toEqual({ lat: 31, lon: -96, label: "Dallas" });
  });

  it("ignores an Esri candidate with a non-finite location", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) =>
      url.includes("geocode.arcgis.com")
        ? ok({ candidates: [{ location: { x: "bad", y: null } }] })
        : ok([{ lat: "29.5", lon: "-95.5", display_name: "OSM" }])));
    const hit = await geocodeAddress("garbled", center);
    expect(hit.label).toBe("OSM"); // fell through to Nominatim
  });
});
