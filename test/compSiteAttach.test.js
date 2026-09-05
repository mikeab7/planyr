import { describe, it, expect, beforeEach } from "vitest";
import { setActiveUser } from "../src/workspaces/site-planner/lib/activeUser.js";
import { resolveOwningSite, autoAttachNote } from "../src/shared/comps/lib/compSiteAttach.js";

const SITES_KEY = "planarfit:sites:v1";

describe("resolveOwningSite — NEW-2/NEW-3 (adversarial review of B1156864)", () => {
  beforeEach(() => {
    setActiveUser(null); // logged-out store — deterministic, no network
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

  it("returns null (nothing to resolve) when the comp already has an explicit projectId", async () => {
    const out = await resolveOwningSite({ projectId: "already-set", title: "X", anchor: { lat: 1, lon: 1 } }, {});
    expect(out).toBeNull();
  });

  it("resolves deterministically off a site_plan anchor's own owning project — no matching needed", async () => {
    const overlaysById = { ov1: { projectId: "plan-owner-id", docTitle: "Airtex Flyer" } };
    const comp = { projectId: null, title: "Building B", anchor: { kind: "site_plan", sitePlanOverlayId: "ov1" } };
    const out = await resolveOwningSite(comp, { overlaysById });
    expect(out).toEqual({ projectId: "plan-owner-id", confidence: "site-plan", siteLabel: "Airtex Flyer" });
  });

  it("attaches to an existing site by exact title match, never creating a duplicate", async () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      trk1: { id: "trk1", groupId: "trk1", site: "Core 5 - West Hardy", name: "Market record", role: "tracked", updatedAt: 1 },
    }));
    const comp = { projectId: null, title: "Core 5 - West Hardy", anchor: { lat: 29.86, lon: -95.48 } };
    const out = await resolveOwningSite(comp, {});
    expect(out.projectId).toBe("trk1");
    expect(out.confidence).toBe("exact-title");
    expect(out.siteLabel).toBe("Core 5 - West Hardy");
  });

  it("attaches to the nearest existing site within radius when no title matches", async () => {
    localStorage.setItem(SITES_KEY, JSON.stringify({
      p1: { id: "p1", groupId: "p1", site: "Airtex Building A", role: "tracked", origin: { lat: 29.86, lon: -95.48 }, updatedAt: 1 },
    }));
    const comp = { projectId: null, title: "Airtex Building B", anchor: { lat: 29.8601, lon: -95.48 } };
    const out = await resolveOwningSite(comp, {});
    expect(out.projectId).toBe("p1");
    expect(out.confidence).toBe("near");
  });
});

describe("autoAttachNote — the 'attach and say so' sentence (NEW-3)", () => {
  it("says nothing for a deterministic site-plan or exact-title resolution", () => {
    expect(autoAttachNote({ confidence: "site-plan", siteLabel: "X" })).toBeNull();
    expect(autoAttachNote({ confidence: "exact-title", siteLabel: "X" })).toBeNull();
  });
  it("names the site and the distance for an uncertain proximity match", () => {
    const note = autoAttachNote({ confidence: "near", siteLabel: "Core 5 - West Hardy", distanceMiles: 0.31 });
    expect(note).toMatch(/Core 5 - West Hardy/);
    expect(note).toMatch(/0\.31 mi/);
    expect(note).toMatch(/Project dropdown/);
  });
  it("says a new tracked site was created when nothing matched", () => {
    const note = autoAttachNote({ confidence: "created", createdSite: true, siteLabel: "Tesla - TGS DC4" });
    expect(note).toMatch(/new tracked site/);
    expect(note).toMatch(/Tesla - TGS DC4/);
  });
  it("returns null with no resolution or no label", () => {
    expect(autoAttachNote(null)).toBeNull();
    expect(autoAttachNote({ confidence: "near" })).toBeNull();
  });
});
