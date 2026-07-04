/* Dense site test-fit regression against the versioned fixture (B278/B280 harness — real-project-data
 * + tombstone-delete LIVE-VERIFY classes, deterministic in the sandbox). Loads the synthetic dense
 * test-fit, deletes a building + its bonded children (recording tombstones), and proves a merge with a
 * stale copy that still holds them does NOT resurrect them (B276). Yield/count goldens catch a silent
 * model or migration change. The live dense-canvas render is auth-only (e2e/site-testfit.spec.js). */
import { describe, it, expect } from "vitest";
import { loadFixture, loadGolden } from "../e2e/fixtures/index.js";
import { createSiteModel, mergeSiteContent, contentCount, migrate, SITE_MODEL_VERSION } from "../src/workspaces/site-planner/lib/siteModel.js";

const fx = loadFixture("sites/dense-testfit.fixture.json");
const golden = loadGolden("sites/dense-testfit.golden.json");

describe("dense site test-fit fixture", () => {
  it("migrates losslessly to the current SITE_MODEL_VERSION and matches the yield/count golden", () => {
    const site = migrate(fx.site);
    expect(site.schemaVersion).toBe(SITE_MODEL_VERSION);
    expect(site.schemaVersion).toBe(golden.schemaVersion);
    expect(contentCount(site)).toBe(golden.contentCount);
    expect(site.els.length).toBe(golden.elCount);
  });

  it("deleting a building tombstones its full bonded cascade, and a stale merge does NOT resurrect it (B276)", () => {
    const site = createSiteModel(fx.site);
    const target = fx.deleteTarget;
    const kill = new Set([
      target,
      ...site.els.filter((e) => e.attachedTo === target || e.forCourt === target || e.forTrailer === target).map((e) => e.id),
    ]);
    expect(kill.size).toBe(golden.killedCount);

    const afterDelete = createSiteModel({ ...site, els: site.els.filter((e) => !kill.has(e.id)), deletedIds: [...site.deletedIds, ...kill], updatedAt: 2 });
    expect(contentCount(afterDelete)).toBe(golden.afterDeleteContentCount);

    // a stale "other copy" that still holds the killed ids + the pre-existing ghosts
    const staleFull = createSiteModel({ ...site, ...fx.staleOtherCopy, updatedAt: 1 });
    const merged = mergeSiteContent(afterDelete, staleFull);
    const mergedIds = new Set(merged.els.map((e) => e.id));
    const resurrected = [...kill].some((id) => mergedIds.has(id)) || fx.site.deletedIds.some((gh) => mergedIds.has(gh));
    expect(resurrected).toBe(false);
    expect(resurrected).toBe(golden.resurrectedAny);
    expect(contentCount(merged)).toBe(golden.mergedContentCount);
  });
});
