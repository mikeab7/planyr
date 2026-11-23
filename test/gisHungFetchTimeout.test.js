// source-scan: reads the shipped source text because the guarded wiring cannot run in node (added by Batch A to unblock the guard from audit batch D).
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import { fetchWithRetry, GIS_FETCH_TIMEOUT_MS, GIS_MAX_GET_URL } from "../src/workspaces/site-planner/lib/gisFetch.js";
import { MAX_QUERY_URL } from "../src/workspaces/site-planner/lib/jurisdiction.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("audit B2 item 4 — a hung GIS fetch rejects instead of hanging", () => {
  it("fetchWithRetry (the health probe's fetch) aborts a fetch that never answers", async () => {
    vi.useFakeTimers();
    // A fetch that only ever settles when its signal aborts — i.e. a host that never answers.
    vi.stubGlobal("fetch", (_u, o) => new Promise((_res, rej) => { o && o.signal && o.signal.addEventListener("abort", () => rej(new Error("aborted"))); }));
    const p = fetchWithRetry("https://hung.example/arcgis", {}, 1);
    const settled = p.then(() => "resolved", (e) => e.message);
    await vi.advanceTimersByTimeAsync(GIS_FETCH_TIMEOUT_MS + 50);
    expect(await settled).toBe("aborted");
  });
  it("the two URL-length caps are one constant", () => {
    expect(MAX_QUERY_URL).toBe(GIS_MAX_GET_URL);
  });
  it("vectorLayers' default fetch and the raster identify getJson carry the shared timeout (source guard)", () => {
    const v = fs.readFileSync("src/workspaces/site-planner/lib/vectorLayers.js", "utf8");
    expect(v).toMatch(/timeoutMs == null\) timeoutMs = GIS_FETCH_TIMEOUT_MS/);
    expect(v).not.toMatch(/timeoutMs: null/);
    const r = fs.readFileSync("src/workspaces/site-planner/lib/rasterIdentifyMap.js", "utf8");
    expect(r).toMatch(/GIS_FETCH_TIMEOUT_MS/);
  });
});
