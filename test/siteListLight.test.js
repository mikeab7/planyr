import { describe, it, expect, beforeEach } from "vitest";
import { setActiveUser } from "../src/workspaces/site-planner/lib/activeUser.js";
import { loadSiteSummaries } from "../src/workspaces/site-planner/lib/siteListLight.js";

const SITES_KEY = "planarfit:sites:v1";

describe("siteListLight — loadSiteSummaries (adversarial review of B1156864, NEW-1)", () => {
  beforeEach(() => {
    setActiveUser(null); // logged-out store — no network, deterministic
    const store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      clear: () => { for (const k of Object.keys(store)) delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
  });

  it("passes through origin as a plain {lat,lon}, never the fuller Site Model", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Tesla - TGS DC4", role: "tracked", origin: { lat: 29.73, lon: -94.87 }, updatedAt: 5 },
      p2: { id: "p2", groupId: "p2", site: "No Origin", updatedAt: 3 },
    }));
    const out = loadSiteSummaries();
    const tracked = out.find((s) => s.id === "p1");
    const noOrigin = out.find((s) => s.id === "p2");
    expect(tracked.origin).toEqual({ lat: 29.73, lon: -94.87 });
    expect(tracked.role).toBe("tracked");
    expect(noOrigin.origin).toBeNull();
  });

  it("never fabricates an origin from a malformed record", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Bad", origin: { lat: "29.73", lon: null }, updatedAt: 1 },
      p2: { id: "p2", groupId: "p2", site: "AlsoBad", origin: "not-an-object", updatedAt: 1 },
    }));
    const out = loadSiteSummaries();
    expect(out.find((s) => s.id === "p1").origin).toBeNull();
    expect(out.find((s) => s.id === "p2").origin).toBeNull();
  });

  it("defaults role to pursuit for a record with no role key (legacy + current alike)", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Old", updatedAt: 1 },
    }));
    expect(loadSiteSummaries()[0].role).toBe("pursuit");
  });
});
