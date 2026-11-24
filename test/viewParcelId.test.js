/* NEW-1 (Meriwether GA, 2026-11-24) — a typed parcel number finds its lot in the county the map is looking at, on both surfaces' shared front door. */
import { describe, it, expect } from "vitest";
import { looksLikeParcelNumber } from "../src/workspaces/site-planner/lib/parcelNumberShape.js";
import { resolveViewParcelId, viewIdCounties, viewParcelIdMessage } from "../src/workspaces/site-planner/lib/viewParcelId.js";
import { buildPlaceRows } from "../src/workspaces/site-planner/lib/placeSuggestRows.js";

const MER = { lat: 33.03, lng: -84.673 }; // Meriwether County GA
const lot = (id, ring = [[-84.8, 33.2], [-84.79, 33.2], [-84.79, 33.21], [-84.8, 33.21], [-84.8, 33.2]]) => ({ attributes: { Parcel_No: id }, geometry: { rings: [ring] } });

describe("looksLikeParcelNumber", () => {
  it("numbers: spaced, dashed, lettered, long digit run", () => {
    for (const t of ["023 012", "023-012", "069A 009", "004 016 001", "023012", "069A009"]) expect(looksLikeParcelNumber(t), t).toBe(true);
  });
  it("addresses, places and short house numbers are not numbers", () => {
    for (const t of ["27092 Roosevelt Hwy", "123 Main St", "Katy, TX", "Greenville GA", "12345", "N Main 5", "", "   "]) expect(looksLikeParcelNumber(t), t).toBe(false);
  });
});

describe("viewIdCounties", () => {
  it("Meriwether County answers an id search at its own point", () => {
    expect(viewIdCounties(MER.lat, MER.lng)).toContain("ga_meriwether");
  });
});

describe("resolveViewParcelId", () => {
  it("'023 012' finds the padded lot and returns a point inside it", async () => {
    const calls = [];
    const lookup = async (a) => { calls.push(a); return { feats: [lot("023    012"), lot("023    0120")] }; };
    const r = await resolveViewParcelId("023 012", { ...MER, lookup });
    expect(calls.every((c) => c.mode === "id" && c.value === "023 012")).toBe(true);
    expect(r.status).toBe("found");
    expect(r.county).toBe("ga_meriwether");
    expect(r.point.lat).toBeGreaterThan(33.2); expect(r.point.lat).toBeLessThan(33.21);
    expect(r.label).toMatch(/^Parcel 023 012 · Meriwether/);
  });
  it("a miss is 'notfound' naming where it looked; a server that did not answer is 'unavailable', never a miss", async () => {
    const miss = await resolveViewParcelId("999 999", { ...MER, lookup: async () => ({ feats: [] }) });
    expect(miss.status).toBe("notfound");
    expect(viewParcelIdMessage(miss, "999 999")).toMatch(/No parcel numbered "999 999" in Meriwether/);
    const down = await resolveViewParcelId("023 012", { ...MER, lookup: async () => { throw Object.assign(new Error("slow"), { unavailable: true }); } });
    expect(down.status).toBe("unavailable");
    expect(viewParcelIdMessage(down, "023 012")).toMatch(/didn't answer/);
  });
  it("text that is not a number, or a view with no wired county, is 'none' (the caller geocodes)", async () => {
    expect((await resolveViewParcelId("27092 Roosevelt Hwy", { ...MER, lookup: async () => ({ feats: [] }) })).status).toBe("none");
    expect((await resolveViewParcelId("023 012", { lat: 0, lng: 0, lookup: async () => ({ feats: [] }) })).status).toBe("none");
  });
});

describe("the suggestion list", () => {
  it("leads with the parcel-ID row for a Georgia-style number, and says Tennessee only for a Tennessee-shaped one", () => {
    const a = buildPlaceRows("nomatch", [], "023 012").rows[0];
    expect(a.kind).toBe("parcelId"); expect(a.tn).toBe(false);
    const b = buildPlaceRows("nomatch", [], "156-027.00-000").rows[0];
    expect(b.kind).toBe("parcelId"); expect(b.tn).toBe(true);
  });
});
