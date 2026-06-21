import { describe, it, expect } from "vitest";
import { buildUpstreamUrl, isAllowedOrigin, GRAPH } from "../functions/api/mapillary/_proxy.js";
import { mapillaryRequestUrl, pickDetections, MLY_PROXY_PATH } from "../src/workspaces/site-planner/lib/mapillaryClient.js";

const params = (s) => new URLSearchParams(s);
const VALID = "fields=id,object_value,geometry&bbox=-95.5,29.7,-95.4,29.8&limit=500";

// ---------------------------------------------------------------------------
// Server proxy (B308) — the security boundary that holds the token.
describe("buildUpstreamUrl — allow-list + token injection", () => {
  it("builds the Graph URL with the server token for an allowed request", () => {
    const u = buildUpstreamUrl("map_features", params(VALID), "MLY|SECRET");
    expect(u.startsWith(`${GRAPH}/map_features?`)).toBe(true);
    const sp = new URL(u).searchParams;
    expect(sp.get("access_token")).toBe("MLY|SECRET");
    expect(sp.get("fields")).toBe("id,object_value,geometry");
    expect(sp.get("bbox")).toBe("-95.5,29.7,-95.4,29.8");
    expect(sp.get("limit")).toBe("500");
  });
  it("rejects a non-allow-listed path", () => {
    expect(buildUpstreamUrl("images", params(VALID), "T")).toBe(null);
    expect(buildUpstreamUrl("map_features/../graph", params(VALID), "T")).toBe(null);
  });
  it("rejects a field outside the allow-list", () => {
    expect(buildUpstreamUrl("map_features", params("fields=id,creator,geometry&bbox=-95.5,29.7,-95.4,29.8"), "T")).toBe(null);
    expect(buildUpstreamUrl("map_features", params("bbox=-95.5,29.7,-95.4,29.8"), "T")).toBe(null); // no fields
  });
  it("rejects a malformed bbox (not 4 numbers)", () => {
    expect(buildUpstreamUrl("map_features", params("fields=id&bbox=1,2,3"), "T")).toBe(null);
    expect(buildUpstreamUrl("map_features", params("fields=id&bbox=a,b,c,d"), "T")).toBe(null);
    expect(buildUpstreamUrl("map_features", params("fields=id"), "T")).toBe(null); // no bbox
  });
  it("clamps limit to 1..2000; falsy/junk → default 500; negative → min 1", () => {
    const lim = (v) => new URL(buildUpstreamUrl("map_features", params(`fields=id&bbox=-95.5,29.7,-95.4,29.8&limit=${v}`), "T")).searchParams.get("limit");
    expect(lim("99999")).toBe("2000"); // over cap
    expect(lim("-5")).toBe("1");        // negative → min 1
    expect(lim("0")).toBe("500");       // falsy → default
    expect(lim("abc")).toBe("500");     // junk → default
  });
});

describe("isAllowedOrigin — don't be an open gateway", () => {
  it("allows same-origin (no Origin header) and our own hosts", () => {
    expect(isAllowedOrigin(null, "planyr.io")).toBe(true);                       // same-origin GET omits Origin
    expect(isAllowedOrigin("https://planyr.io", "planyr.io")).toBe(true);
    expect(isAllowedOrigin("https://abc123.planyr.pages.dev", "planyr.io")).toBe(true); // preview
    expect(isAllowedOrigin("https://localhost:4173", "localhost:4173")).toBe(true);     // selfHost match
  });
  it("blocks a foreign Origin and garbage", () => {
    expect(isAllowedOrigin("https://evil.example.com", "planyr.io")).toBe(false);
    expect(isAllowedOrigin("https://planyr.io.evil.com", "planyr.io")).toBe(false);     // suffix trick
    expect(isAllowedOrigin("not-a-url", "planyr.io")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Client (B308 acceptance) — the DEFAULT path must carry NO token.
describe("mapillaryRequestUrl — proxy by default, token never in the default URL", () => {
  const bounds = { w: -95.5, s: 29.7, e: -95.4, n: 29.8 };
  it("with no token → same-origin proxy path, NO access_token, no MLY token", () => {
    const u = mapillaryRequestUrl(bounds, "");
    expect(u.startsWith(`${MLY_PROXY_PATH}?`)).toBe(true);
    expect(u).not.toMatch(/access_token/);
    expect(u).not.toMatch(/MLY/);
    expect(u).not.toMatch(/graph\.mapillary\.com/);
    expect(u).toContain("bbox=-95.5,29.7,-95.4,29.8");
  });
  it("with a pasted token → direct Graph URL using that token (optional override)", () => {
    const u = mapillaryRequestUrl(bounds, "MLY|MINE");
    expect(u).toContain("https://graph.mapillary.com/map_features");
    expect(u).toContain(`access_token=${encodeURIComponent("MLY|MINE")}`);
  });
});

describe("pickDetections — keep only poles + hydrants", () => {
  it("filters by object_value", () => {
    const out = pickDetections([
      { object_value: "object--support--utility-pole" },
      { object_value: "object--fire-hydrant" },
      { object_value: "object--street-light" },
      {},
    ]);
    expect(out).toHaveLength(2);
  });
});
