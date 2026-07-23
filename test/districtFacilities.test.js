// PR-K (K7) — the drainage-district facilities ingest scaffold: discover the BKDD ArcGIS REST
// services behind its Web AppBuilder viewer, ingest facilities, and flag a DISTRICT-designated
// floodway / ROW distinctly from a FEMA floodway. Pure + injectable fetch; fixture-driven.
import { describe, it, expect } from "vitest";
import {
  BKDD_APPVIEWER, ASSUMED_CHANNEL_TAG,
  discoverDistrictServices, classifyDistrictFacilities, facilityKind,
  districtFloodwayNote, districtIdNote,
} from "../src/workspaces/site-planner/lib/districtFacilities.js";

// A mock portal: the WAB app config points at a web map whose operational layers carry REST URLs.
const APP_DATA = { map: { itemId: "webmap123" } };
const MAP_DATA = {
  operationalLayers: [
    { title: "District Floodway", url: "https://gisclient.quiddity.com/rest/services/BKDD/FeatureServer/0" },
    {
      title: "Facilities group", layers: [
        { title: "Major Channels", url: "https://gisclient.quiddity.com/rest/services/BKDD/FeatureServer/1" },
        { title: "Basemap tiles" }, // no url → skipped
      ],
    },
  ],
};
const mockFetch = (map) => async (url) => {
  if (url.includes("/items/" + BKDD_APPVIEWER.itemId + "/data")) return map.app;
  if (url.includes("/items/webmap123/data")) return map.web;
  throw new Error("404 " + url);
};

describe("K7 — facilityKind heuristic", () => {
  it("splits floodway / ROW / channel / other by name", () => {
    expect(facilityKind("District Regulatory Floodway")).toBe("floodway");
    expect(facilityKind("Drainage Right-of-Way")).toBe("row");
    expect(facilityKind("Maintenance Easement")).toBe("row");
    expect(facilityKind("Willow Fork Channel")).toBe("channel");
    expect(facilityKind("Cane Island Branch bayou")).toBe("channel");
    expect(facilityKind("Aerial Imagery 2024")).toBe("other");
  });
});

describe("K7 — discoverDistrictServices (happy path)", () => {
  it("walks app config → web map → operational layers into REST services with kinds", async () => {
    const r = await discoverDistrictServices({ fetchJson: mockFetch({ app: APP_DATA, web: MAP_DATA }) });
    expect(r.ok).toBe(true);
    expect(r.degraded).toBe(false);
    expect(r.districtId).toBe("bkdd");
    expect(r.services.map((s) => s.url)).toEqual([
      "https://gisclient.quiddity.com/rest/services/BKDD/FeatureServer/0",
      "https://gisclient.quiddity.com/rest/services/BKDD/FeatureServer/1",
    ]);
    expect(r.services.map((s) => s.kind)).toEqual(["floodway", "channel"]);
  });
});

describe("K7 — graceful degradation, never fake data", () => {
  it("a config fetch that throws degrades with the district id and a logged attempt", async () => {
    const r = await discoverDistrictServices({ fetchJson: async () => { throw new Error("403 auth wall"); } });
    expect(r.ok).toBe(false);
    expect(r.degraded).toBe(true);
    expect(r.districtId).toBe("bkdd");
    expect(r.services).toEqual([]);
    expect(r.attempts.some((a) => a.ok === false && /403/.test(a.error))).toBe(true);
  });
  it("an app config with no web map degrades (no fabricated services)", async () => {
    const r = await discoverDistrictServices({ fetchJson: async () => ({}) });
    expect(r.degraded).toBe(true);
    expect(r.services).toEqual([]);
  });
  it("a missing fetchJson degrades rather than throwing", async () => {
    const r = await discoverDistrictServices({});
    expect(r.degraded).toBe(true);
  });
});

describe("K7 — classifyDistrictFacilities: DISTRICT floodway flag distinct from FEMA", () => {
  it("a district floodway/ROW over the pond raises a DISTRICT flag (permit note), never FEMA no-rise copy", () => {
    const v = classifyDistrictFacilities({
      facilities: [
        { kind: "floodway", name: "District Floodway" },
        { kind: "channel", name: "Willow Fork Channel" },
      ],
    });
    expect(v.hasDistrictFloodway).toBe(true);
    expect(v.flagNote).toMatch(/district permit/i);
    expect(v.flagNote).not.toMatch(/no-rise/i); // never the FEMA language
    expect(v.channelName).toBe("Willow Fork Channel");
    expect(v.channelTag).toBe("district facility");
  });
  it("no district floodway → no flag; a named channel still feeds the outfall identity", () => {
    const v = classifyDistrictFacilities({ facilities: [{ kind: "channel", name: "Cane Island Branch" }] });
    expect(v.hasDistrictFloodway).toBe(false);
    expect(v.flagNote).toBeNull();
    expect(v.channelName).toBe("Cane Island Branch");
  });
  it("degraded ingest → the receiving channel shows the assumed tag, no invented name", () => {
    const v = classifyDistrictFacilities({ facilities: [], degraded: true });
    expect(v.degraded).toBe(true);
    expect(v.channelName).toBeNull();
    expect(v.channelTag).toBe(ASSUMED_CHANNEL_TAG);
  });
});

describe("K7 — copy is plain-English, district-scoped, and em-dash-free", () => {
  it("the district floodway note names a permit and is NOT the FEMA floodway copy", () => {
    const n = districtFloodwayNote();
    expect(n).toMatch(/Brookshire/);
    expect(n).toMatch(/permit/i);
    expect(n).not.toMatch(/no-rise|FEMA regulatory floodway:/i);
    expect(n.includes("—")).toBe(false);
  });
  it("the district-id (degraded) note is honest about the assumption and em-dash-free", () => {
    const n = districtIdNote();
    expect(n).toMatch(/could not be read/i);
    expect(n.includes("—")).toBe(false);
  });
});
