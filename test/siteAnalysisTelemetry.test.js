/* siteAnalysis.js's logQueryFailure() — NEW-1 (2026-09-23) telemetry wiring.
 *
 * A "couldn't reach the GIS source" failure used to leave nothing durable behind — only a
 * console.warn nobody was watching — so a prior live report of this exact symptom (Goose
 * Creek wetlands) could only be closed by re-checking the endpoint later, never by seeing
 * what actually happened at the moment the owner hit it. This is STANDING RULE #2's
 * "instrument it so it captures itself" disposition: every hard GIS-source failure now also
 * reports a structured client_errors event.
 *
 * clientErrors.js is mocked — same reasoning as authRateLimitTelemetry.test.js: CI's build
 * job carries real production Supabase secrets, so an unmocked call here could write a real
 * telemetry row over a network call this unit test has no business making.
 */
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ events: [] }));

vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (kind, message, extra) => { h.events.push({ kind, message, extra }); },
}));

import { analyzeSource } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { GisFetchError } from "../src/workspaces/site-planner/lib/gisFetch.js";

const SQUARE = [[[-95.80, 29.78], [-95.79, 29.78], [-95.79, 29.79], [-95.80, 29.79], [-95.80, 29.78]]];
const flood = { id: "flood", category: "Floodplain", label: "FEMA flood zones", kind: "polygon", url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer", layer: 28, verified: true, absentLabel: "None found" };
const freshCache = () => { const store = new Map(); return { swr: (key, fetcher) => { const p = Promise.resolve().then(fetcher).then((data) => ({ data, ts: Date.now(), ageMs: 0, updated: true })).catch((error) => ({ data: null, ts: null, ageMs: null, updated: false, error })); return { cached: null, stale: true, fresh: p }; } }; };

describe("logQueryFailure telemetry (NEW-1)", () => {
  it("reports a gis-query-failed event, with the real http status + url, on a hard endpoint failure", async () => {
    h.events.length = 0;
    const err = new GisFetchError("http-5xx", "Server error", { status: 503, url: "https://hazards.fema.gov/…/query", retryable: true });
    const fetchJson = async () => { throw err; };
    const f = await analyzeSource(flood, SQUARE, { cache: freshCache(), fetchJson });
    expect(f.status).toBe("unavailable");
    expect(h.events).toHaveLength(1);
    expect(h.events[0].kind).toBe("gis-query-failed");
    expect(h.events[0].extra.source).toBe("flood");
    expect(h.events[0].extra.httpStatus).toBe(503);
    expect(h.events[0].extra.url).toBe("https://hazards.fema.gov/…/query");
  });

  it("does not fire for a test-fake plain Error (no .diag — never mistaken for a real endpoint failure)", async () => {
    h.events.length = 0;
    const fetchJson = async () => { throw new Error("boom"); };
    await analyzeSource(flood, SQUARE, { cache: freshCache(), fetchJson });
    expect(h.events).toHaveLength(0);
  });

  it("does not fire on success", async () => {
    h.events.length = 0;
    const fetchJson = async () => ({ features: [] });
    await analyzeSource(flood, SQUARE, { cache: freshCache(), fetchJson });
    expect(h.events).toHaveLength(0);
  });
});
