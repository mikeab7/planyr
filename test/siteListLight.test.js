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

  it("passes through role as-is for a tracked site", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Tesla - TGS DC4", role: "tracked", updatedAt: 5 },
      p2: { id: "p2", groupId: "p2", site: "Ordinary project", updatedAt: 3 },
    }));
    const out = loadSiteSummaries();
    expect(out.find((s) => s.id === "p1").role).toBe("tracked");
    expect(out.find((s) => s.id === "p2").role).toBe("pursuit");
  });

  it("defaults role to pursuit for a record with no role key (legacy + current alike)", () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Old", updatedAt: 1 },
    }));
    expect(loadSiteSummaries()[0].role).toBe("pursuit");
  });
});
