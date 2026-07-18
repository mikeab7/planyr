// NEW-B5 — NOAA PFDS client: URL build, depth lookup, bounded fetch. Pure (injected fetch).
import { describe, it, expect } from "vitest";
import { buildPfdsUrl, designStormDepthIn, resolvePfds, PFDS_PROXY_PATH } from "../src/workspaces/site-planner/lib/pfdsClient.js";
import { parsePfdsText } from "../src/workspaces/site-planner/lib/pfds.js";

const SAMPLE = [
  "Point precipitation frequency estimates (inches)",
  "NOAA Atlas 14 Volume 11 Version 2",
  "PRECIPITATION FREQUENCY ESTIMATES",
  "by duration for ARI (years):, 1, 2, 5, 10, 25, 50, 100",
  "6-hr:, 2.0, 2.6, 3.5, 4.2, 5.3, 6.2, 7.3",
  "24-hr:, 3.0, 4.0, 5.4, 6.5, 8.2, 9.8, 11.9",
].join("\n");

describe("buildPfdsUrl", () => {
  it("proxy path vs direct NOAA", () => {
    expect(buildPfdsUrl(29.76, -95.37, { proxy: true })).toBe(`${PFDS_PROXY_PATH}?lat=29.76&lon=-95.37`);
    expect(buildPfdsUrl(29.76, -95.37, { proxy: false })).toMatch(/hdsc\.nws\.noaa\.gov\/cgi-bin\/new/);
  });
});

describe("designStormDepthIn", () => {
  it("reads the 24-hr 100-yr cell", () => {
    const t = parsePfdsText(SAMPLE);
    expect(designStormDepthIn(t, 100)).toBe(11.9);
    expect(designStormDepthIn(t, 100, "6-hr")).toBe(7.3);
    expect(designStormDepthIn(t, 2)).toBe(4.0);
  });
});

describe("resolvePfds — bounded fetch", () => {
  const geom = { lat: 29.76, lng: -95.37 };
  it("parses a good body", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => SAMPLE });
    const r = await resolvePfds(geom, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(designStormDepthIn(r.table, 100)).toBe(11.9);
  });
  it("out-of-coverage short body → honest failure, no fabricated depth", async () => {
    const fetchImpl = async () => ({ ok: true, text: async () => "404 not found" });
    expect((await resolvePfds(geom, { fetchImpl })).ok).toBe(false);
  });
  it("HTTP error → failure", async () => {
    const fetchImpl = async () => ({ ok: false, status: 502, text: async () => "" });
    expect((await resolvePfds(geom, { fetchImpl })).ok).toBe(false);
  });
  it("no point → failure", async () => {
    expect((await resolvePfds({}, {})).ok).toBe(false);
  });
});
