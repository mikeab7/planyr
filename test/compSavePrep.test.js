/* NEW-2 — every comp save path (hand entry, paste grid, KML/KMZ promote) resolves county and a
 * tracked market site through the ONE shared step, compSavePrep.prepareCompForSave. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prepareCompForSave } from "../src/shared/comps/lib/compSavePrep.js";
import { draftToComp, emptyDraft } from "../src/shared/comps/lib/comps.js";
import { anchorFromGeometry } from "../src/shared/comps/components/CompDraftsPanel.jsx";

const promoted = () => {
  // Exactly what CompDraftsPanel hands to onPromote for a KML point: no county on the anchor.
  const anchor = anchorFromGeometry({ kind: "point", lat: 29.927, lon: -95.442 });
  return draftToComp({ ...emptyDraft(null), compType: "lease", title: "Example Park - Acme", anchor });
};

describe("prepareCompForSave", () => {
  it("a promoted KML draft gets its county AND a tracked-site link", async () => {
    const resolveCounty = vi.fn(async () => "harris");
    const resolveSite = vi.fn(async () => ({ groupId: "trk1", created: true, matched: false }));
    const { comp, site } = await prepareCompForSave(promoted(), { resolveCounty, resolveSite });
    expect(comp.anchor.county).toBe("harris");
    expect(comp.projectId).toBe("trk1");
    expect(site.created).toBe(true);
    expect(resolveCounty).toHaveBeenCalledWith(29.927, -95.442);
    expect(resolveSite).toHaveBeenCalledWith({ title: "Example Park - Acme", lat: 29.927, lon: -95.442, county: "harris" });
  });
  it("never overwrites a county or a site that is already there", async () => {
    const resolveCounty = vi.fn(async () => "fortbend");
    const resolveSite = vi.fn();
    const c = { ...promoted(), projectId: "real1", anchor: { kind: "pin", lat: 29.9, lon: -95.4, county: "harris" } };
    const { comp, site } = await prepareCompForSave(c, { resolveCounty, resolveSite });
    expect(comp.anchor.county).toBe("harris");
    expect(comp.projectId).toBe("real1");
    expect(site).toBeNull();
    expect(resolveCounty).not.toHaveBeenCalled();
    expect(resolveSite).not.toHaveBeenCalled();
  });
  it("a county miss stays an honest null; a site failure is reported, never thrown", async () => {
    const { comp, site } = await prepareCompForSave(promoted(), {
      resolveCounty: async () => { throw new Error("offline"); },
      resolveSite: async () => ({ groupId: null, error: "Couldn't create a site" }),
    });
    expect(comp.anchor.county).toBeNull();
    expect(comp.projectId).toBeFalsy();
    expect(site).toEqual({ failed: true, message: "Couldn't create a site" });
  });
  it("drops the paste-time countyPending marker and never mutates its input", async () => {
    const input = { ...promoted(), anchor: { kind: "pin", lat: 29.9, lon: -95.4, county: null, countyPending: true } };
    const { comp } = await prepareCompForSave(input, { resolveCounty: async () => "harris", resolveSite: async () => ({ groupId: "g" }) });
    expect(comp.anchor).toEqual({ kind: "pin", lat: 29.9, lon: -95.4, county: "harris" });
    expect(input.anchor.countyPending).toBe(true);
    expect(input.projectId).toBeFalsy();
  });
});

describe("every save path calls the shared step (source guard)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src/shared/comps/components/CompsPanel.jsx"), "utf8");
  it("single save, grid save and KML promote all run prepareCompForSave; none calls the site resolver directly", () => {
    expect(src.match(/await prepareCompForSave\(/g)?.length).toBe(3);
    expect(src).toMatch(/prepareCompForSave\(comp\);\s*\n\s*const result = await promoteDraft\(draftId, prep\.comp\)/);
    expect(src).not.toMatch(/\{\s*resolveOrCreateTrackedSiteForComp\s*\}\s*=\s*await import/);
  });
});
