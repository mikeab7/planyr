import { describe, it, expect } from "vitest";
import {
  b64urlEncode,
  b64urlDecode,
  proxyServiceUrl,
  parseUpstream,
  cacheKey,
  freshness,
  DEFAULT_TTL_MS,
  ALLOWED_GIS_HOST_RE,
} from "../src/shared/gis/gisProxyCore.js";

const FEMA = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";
const COH = "https://geogimstest.houstontx.gov/arcgis/rest/services/HW/Water_gx/MapServer";

describe("b64url round-trip", () => {
  it("encodes URL-safe (no +,/,=) and decodes back", () => {
    const enc = b64urlEncode(FEMA);
    expect(enc).not.toMatch(/[+/=]/);
    expect(b64urlDecode(enc)).toBe(FEMA);
  });
});

describe("proxyServiceUrl", () => {
  it("builds /api/gis-cache/svc/<b64> that decodes back to the service", () => {
    const p = proxyServiceUrl(FEMA);
    expect(p.startsWith("/api/gis-cache/svc/")).toBe(true);
    const seg = p.split("/").pop();
    expect(b64urlDecode(seg)).toBe(FEMA);
  });
  it("honors a custom base", () => {
    expect(proxyServiceUrl(FEMA, "/x").startsWith("/x/svc/")).toBe(true);
  });
});

describe("parseUpstream — the esri-appended path round-trips", () => {
  it("reconstructs <service>/export?<params> from the proxy path", () => {
    const segs = ["svc", b64urlEncode(FEMA), "export"];
    const r = parseUpstream(segs, "?bbox=1,2,3,4&size=256,256&f=image");
    expect(r).not.toBeNull();
    expect(r.url).toBe(`${FEMA}/export?bbox=1,2,3,4&size=256,256&f=image`);
    expect(r.host).toBe("hazards.fema.gov");
  });
  it("reconstructs a bare metadata (?f=json) request with no tail", () => {
    const segs = ["svc", b64urlEncode(COH)];
    const r = parseUpstream(segs, "?f=json");
    expect(r.url).toBe(`${COH}?f=json`);
  });
  it("normalizes a search string with no leading ?", () => {
    const r = parseUpstream(["svc", b64urlEncode(FEMA), "export"], "f=image");
    expect(r.url).toBe(`${FEMA}/export?f=image`);
  });
  it("rejects a foreign host (not an open relay)", () => {
    const segs = ["svc", b64urlEncode("https://evil.example.com/x/MapServer"), "export"];
    expect(parseUpstream(segs, "?f=image")).toBeNull();
  });
  it("rejects a non-http scheme", () => {
    const segs = ["svc", b64urlEncode("file:///etc/passwd")];
    expect(parseUpstream(segs, "")).toBeNull();
  });
  it("rejects a malformed shape", () => {
    expect(parseUpstream(["nope"], "")).toBeNull();
    expect(parseUpstream([], "")).toBeNull();
    expect(parseUpstream(["svc"], "")).toBeNull();
    expect(parseUpstream("svc/x", "")).toBeNull();
  });
  it("allows the agency hosts the layers actually use", () => {
    for (const h of ["hazards.fema.gov", "www.fws.gov", "server.arcgisonline.com", "geogimstest.houstontx.gov"]) {
      expect(ALLOWED_GIS_HOST_RE.test(h)).toBe(true);
    }
    expect(ALLOWED_GIS_HOST_RE.test("notfema.gov.evil.com")).toBe(false);
  });
});

describe("cacheKey", () => {
  it("is stable and Drive-filename-safe for the same URL", () => {
    const k = cacheKey(`${FEMA}/export?bbox=1,2,3,4`);
    expect(k).toBe(cacheKey(`${FEMA}/export?bbox=1,2,3,4`));
    expect(k).toMatch(/^gis_[0-9a-f]{8}$/);
  });
  it("differs when the view (bbox) differs", () => {
    expect(cacheKey(`${FEMA}/export?bbox=1,2,3,4`)).not.toBe(cacheKey(`${FEMA}/export?bbox=5,6,7,8`));
  });
});

describe("freshness", () => {
  it("flags no copy as stale with null age", () => {
    expect(freshness(undefined, 1000)).toEqual({ stale: true, ageMs: null });
  });
  it("is fresh within the ttl, stale past it", () => {
    const now = 10 * DEFAULT_TTL_MS;
    expect(freshness(now - 1000, now).stale).toBe(false);
    expect(freshness(now - 1000, now).ageMs).toBe(1000);
    expect(freshness(now - (DEFAULT_TTL_MS + 1), now).stale).toBe(true);
  });
  it("never reports a negative age", () => {
    expect(freshness(2000, 1000).ageMs).toBe(0);
  });
});
