/* NEW-1 — A DELETE IN ONE PLAN MUST NEVER DESTROY BYTES ANOTHER PLAN IS USING.
 *
 * The production failure this guards (2026-08-13): `⧉ Duplicate plan` copies an overlay record
 * wholesale, so two plans point at ONE cloud object and ONE device raster. Every delete path
 * ref-counted that share against the CURRENT plan's `sheetOverlays`, which cannot see the sibling
 * — so removing the picture from the duplicate hard-deleted the original's image out of both
 * tiers. On the owner's data the bytes for `…/site-overlays/smsrrlk9u576/e1454691snsene.png` are
 * GONE, and six further plans were armed the same way (Goose Creek ×4, Bain ×2).
 *
 * ⛔ THE PRE-FIX RULE IS REPLAYED VERBATIM BELOW (`legacyCanRelease`) AS THE MUTATION CHECK. A test
 * that only asserts the new rule cannot tell a real fix from a no-op — this one fails if the old
 * rule ever starts passing, or if the new rule ever starts agreeing with it on the shared case. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  collectAssetRefs, planAssetKeys, assetHolders, canReleaseAsset,
  releasePlanForOverlay, idbKeysReleasableOnPlanDelete,
} from "../src/workspaces/site-planner/lib/sharedAssetRefs.js";

/* The owner's real shape: an overlay whose bytes live in the cloud AND on the device. */
const overlay = (id, { skey, ikey, dwg } = {}) => ({
  id, name: "Untitled picture.png", imgW: 1244, imgH: 1008,
  ...(skey ? { storageKey: skey } : {}), ...(ikey ? { idbKey: ikey } : {}),
  ...(dwg ? { sourceDwgKey: dwg } : {}),
});
const plan = (id, overlays = [], extra = {}) => ({ id, sheetOverlays: overlays, ...extra });

// The two keys the owner's Woods Road plans shared, verbatim in shape.
const SKEY = "b147d90d/site-overlays/smsrrlk9u576/e1454691snsene.png";
const IKEY = "raster:smsrrlk9u576:overlay:e1454691snsene";

/* THE PRE-FIX RULE, replayed: ref-count against the CURRENT plan's overlay list only.
 * This is `SitePlanner.jsx`'s old `sheetOverlays.some((x) => x.id !== id && x.storageKey === …)`. */
function legacyCanRelease(currentPlanOverlays, ov, key, field = "storageKey") {
  const shared = ov[field] && currentPlanOverlays.some((x) => x.id !== ov.id && x[field] === ov[field]);
  return !!(ov[field] === key && !shared);
}

describe("the pre-fix rule DESTROYS a sibling plan's image (the production defect)", () => {
  it("releases a key the ORIGINAL plan still holds, because it can only see the copy", () => {
    // The duplicate's own overlay list holds exactly one overlay — the copied one.
    const copyOverlays = [overlay("e1454691snsene", { skey: SKEY, ikey: IKEY })];
    // The old rule says "nothing else points at it" and deletes the shared object.
    expect(legacyCanRelease(copyOverlays, copyOverlays[0], SKEY)).toBe(true);
    expect(legacyCanRelease(copyOverlays, copyOverlays[0], IKEY, "idbKey")).toBe(true);
  });
});

describe("the fixed rule — the ref-count spans EVERY plan", () => {
  const original = plan("smsrrlk9u576", [overlay("e1454691snsene", { skey: SKEY, ikey: IKEY })]);
  const copy = plan("smss0bulpy84", [overlay("e1454691snsene", { skey: SKEY, ikey: IKEY })]);
  const refs = collectAssetRefs([original, copy]);

  it("refuses to release the cloud object while the original still holds it", () => {
    const v = canReleaseAsset(refs, "storage", SKEY, "smss0bulpy84");
    expect(v.release).toBe(false);
    expect(v.reason).toBe("shared");
    expect(v.heldBy).toEqual(["smsrrlk9u576"]); // NAMED, so the refusal can be reported out loud
  });

  it("refuses to release the DEVICE raster on the same gesture (both tiers together)", () => {
    expect(canReleaseAsset(refs, "idb", IKEY, "smss0bulpy84").release).toBe(false);
  });

  it("disagrees with the pre-fix rule on exactly the case that lost the bytes", () => {
    const copyOverlays = copy.sheetOverlays;
    const legacy = legacyCanRelease(copyOverlays, copyOverlays[0], SKEY);
    const fixed = canReleaseAsset(refs, "storage", SKEY, "smss0bulpy84").release;
    expect(legacy).toBe(true);   // old: delete it
    expect(fixed).toBe(false);   // new: keep it
    expect(fixed).not.toBe(legacy);
  });

  it("DOES release once the last plan lets go (no permanent orphan)", () => {
    const alone = collectAssetRefs([plan("smss0bulpy84", [overlay("e1", { skey: SKEY })])]);
    const v = canReleaseAsset(alone, "storage", SKEY, "smss0bulpy84");
    expect(v.release).toBe(true);
    expect(v.reason).toBe("sole-holder");
  });

  it("releases both tiers of an overlay no one else holds, and neither when shared", () => {
    const sole = collectAssetRefs([plan("p1", [overlay("e1", { skey: SKEY, ikey: IKEY, dwg: "d.dwg" })])]);
    const r1 = releasePlanForOverlay(sole, overlay("e1", { skey: SKEY, ikey: IKEY, dwg: "d.dwg" }), "p1");
    expect(r1.release.map((x) => x.what).sort()).toEqual(["dwg", "object", "raster"]);
    expect(r1.shared).toBe(false);

    const r2 = releasePlanForOverlay(refs, copy.sheetOverlays[0], "smss0bulpy84");
    expect(r2.release).toEqual([]);        // rule 3 — never one tier without the other
    expect(r2.shared).toBe(true);
  });
});

describe("fail toward KEEPING the bytes (rule 2 — an unknown answer releases nothing)", () => {
  it("refuses with no index, no key, or an unknown tier", () => {
    const refs = collectAssetRefs([plan("a", [overlay("e1", { skey: SKEY })])]);
    expect(canReleaseAsset(null, "storage", SKEY, "a").reason).toBe("no-index");
    expect(canReleaseAsset(refs, "storage", "", "a").reason).toBe("no-key");
    expect(canReleaseAsset(refs, "nope", SKEY, "a").reason).toBe("unknown-tier");
  });

  it("counts a SOFT-DELETED plan as a holder — a binned plan is restorable, its bytes are owed", () => {
    const refs = collectAssetRefs([
      plan("orig", [overlay("e1", { skey: SKEY })], { deletedAt: 1 }),
      plan("copy", [overlay("e1", { skey: SKEY })]),
    ]);
    expect(canReleaseAsset(refs, "storage", SKEY, "copy").release).toBe(false);
  });

  it("indexes the aerial underlay's pair too, not just sheet overlays", () => {
    const keys = planAssetKeys({ id: "a", underlay: { storageKey: "u.png", idbKey: "raster:a:underlay" } });
    expect([...keys.storage]).toEqual(["u.png"]);
    expect([...keys.idb]).toEqual(["raster:a:underlay"]);
  });
});

/* ⛔ THE BIGGER BLAST RADIUS — same bug, asked at plan-delete. `deleteSite` evicted
 * `raster:<siteId>:*` blindly, and a duplicate carries the SOURCE plan's idbKey. */
describe("deleting a PLAN must not wipe a sibling's device copy", () => {
  const original = plan("smsrrlk9u576", [overlay("e1", { ikey: IKEY })]);
  const copy = plan("smss0bulpy84", [overlay("e1", { ikey: IKEY })]);

  it("keeps the shared raster when the SOURCE plan is deleted", () => {
    const { release, kept } = idbKeysReleasableOnPlanDelete([original, copy], "smsrrlk9u576");
    expect(release).toEqual([]);                    // the prefix rule would have evicted IKEY here
    expect(kept.map((k) => k.key)).toEqual([IKEY]);
    expect(kept[0].heldBy).toEqual(["smss0bulpy84"]);
  });

  it("still evicts a raster no surviving plan references", () => {
    const lone = plan("solo", [overlay("e1", { ikey: "raster:solo:overlay:e1" })]);
    const { release } = idbKeysReleasableOnPlanDelete([lone], "solo");
    expect(release.map((r) => r.key)).toEqual(["raster:solo:overlay:e1"]);
  });

  it("proves the OLD prefix rule would have taken the shared one", () => {
    // `idbDeleteByPrefix('raster:smsrrlk9u576:')` matches IKEY, which the copy still needs.
    expect(IKEY.startsWith("raster:smsrrlk9u576:")).toBe(true);
  });
});

/* SOURCE GUARDS — a pure rule nobody calls is not a fix. These pin the WIRING, because every
 * instance of this defect was a correct-looking delete at a call site that asked the wrong scope. */
describe("the call sites ask the shared rule, not the current plan's list", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const planner = read("../src/workspaces/site-planner/SitePlanner.jsx");
  const storage = read("../src/workspaces/site-planner/lib/storage.js");

  it("SitePlanner no longer ref-counts a delete against `sheetOverlays`", () => {
    expect(planner).not.toMatch(/sheetOverlays\.some\(\(x\)\s*=>\s*x\.id\s*!==\s*id\s*&&\s*x\.storageKey/);
    expect(planner).not.toMatch(/sheetOverlays\.some\(\(x\)\s*=>\s*x\.id\s*!==\s*id\s*&&\s*x\.idbKey/);
  });

  it("SitePlanner routes BOTH overlay and underlay removal through the shared rule", () => {
    expect(planner).toMatch(/releasePlanForOverlay\(assetRefs, o, siteId\)/);
    expect(planner).toMatch(/releaseUnderlayAssets/);
    // the underlay button must not delete either tier directly any more
    expect(planner).not.toMatch(/if \(underlay\?\.idbKey\) idbDelete/);
    expect(planner).not.toMatch(/if \(underlay\?\.storageKey\) deleteOverlayObject/);
  });

  it("deleteSite evicts by REFERENCE, never by the `raster:<id>:` prefix", () => {
    expect(storage).toMatch(/idbKeysHeldByOtherPlans\(all, id\)/);
    expect(storage).toMatch(/idbDeleteByPrefix\(`raster:\$\{id\}:`, \{ keep \}\)/);
    expect(storage).not.toMatch(/idbDeleteByPrefix\(`raster:\$\{id\}:`\)/);
  });

  it("the database guard ships with the fix (the client list is only ever best-effort)", () => {
    const sql = read("../src/workspaces/site-planner/db/overlay_object_release_guard.sql");
    expect(sql).toMatch(/before delete on storage\.objects/i);
    expect(sql).toMatch(/raise exception/i);              // LOUD — never a silent skip
    expect(sql).toMatch(/sites_referencing_storage_key/);
  });
});

describe("assetHolders reports every plan naming a key", () => {
  it("names all four Goose-Creek-shaped holders, sorted", () => {
    const shared = "b147d90d/site-overlays/smqfy48tlk9j/e1454628danlgq.pdf";
    const refs = collectAssetRefs(["p4", "p2", "p1", "p3"].map((id) => plan(id, [overlay("e1", { skey: shared })])));
    expect(assetHolders(refs, "storage", shared)).toEqual(["p1", "p2", "p3", "p4"]);
  });
});
