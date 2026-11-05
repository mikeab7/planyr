/* NEW-1 (follow-on to B2244016) — a cloud overlay record carrying a `storageKey` is never replaced by a
 * local record with `storageKey: null` + `storageMissing: true` for the same overlay id, in ANY merge
 * direction and whichever copy is newer. Production 2026-10-15: after the pointers were restored (cloud
 * stamped newer), opening the plan re-saved it with the device's stale heal and the key was gone again,
 * deterministically. Red on main: `unionById` is newer-copy-wins per id, so the healed copy won whenever
 * its stamp was >= the other's (the device copy is routinely the newer one — B458's mirror write). */
import { describe, it, expect } from "vitest";
import { mergeSiteContent, createSiteModel } from "../src/workspaces/site-planner/lib/siteModel.js";

const KEY = "b147d90d-b610-423d-af65-7e004f0ad72f/site-overlays/smqfy48tlk9j/e1454628danlgq.pdf";
const keyed = { id: "e1454628danlgq", name: "Master Site Plan", storageKey: KEY, imgW: 100, imgH: 100 };
const healed = { id: "e1454628danlgq", name: "Master Site Plan", storageKey: null, storageMissing: true, imgW: 100, imgH: 100 };
const plan = (ov, updatedAt) => createSiteModel({ id: "smuwvgr36ouh", updatedAt, sheetOverlays: [ov] });
const ov = (m) => m.sheetOverlays.find((o) => o.id === keyed.id);

describe("a storageKey beats a heal flag in every merge direction", () => {
  for (const [label, localAt, cloudAt] of [["local newer", 2000, 1000], ["cloud newer", 1000, 2000], ["tie", 1500, 1500]]) {
    it(`stale local heal + cloud key → key kept (${label})`, () => {
      const m = mergeSiteContent(plan(healed, localAt), plan(keyed, cloudAt));
      expect(ov(m).storageKey).toBe(KEY);
      expect(ov(m).storageMissing).toBeFalsy();
    });
    it(`cloud heal + local key → key kept (${label})`, () => {
      const m = mergeSiteContent(plan(keyed, localAt), plan(healed, cloudAt));
      expect(ov(m).storageKey).toBe(KEY);
      expect(ov(m).storageMissing).toBeFalsy();
    });
  }
  it("two healed copies stay healed (nothing is invented)", () => {
    const m = mergeSiteContent(plan(healed, 2), plan(healed, 1));
    expect(ov(m).storageKey).toBeNull();
    expect(ov(m).storageMissing).toBe(true);
  });
  it("only the healed overlay is touched; another id's own pointer is untouched", () => {
    const other = { id: "e2", storageKey: "u/site-overlays/p/e2.png" };
    const a = createSiteModel({ id: "p", updatedAt: 2, sheetOverlays: [healed, other] });
    const b = createSiteModel({ id: "p", updatedAt: 1, sheetOverlays: [keyed, other] });
    const m = mergeSiteContent(a, b);
    expect(m.sheetOverlays.find((o) => o.id === "e2").storageKey).toBe("u/site-overlays/p/e2.png");
    expect(ov(m).storageKey).toBe(KEY);
  });
});
