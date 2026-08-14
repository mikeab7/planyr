/* ⛔ WHO ELSE IS USING THIS FILE? — the ONE answer, and the reason it is a module rather than a
 * line at each delete site (NEW-1, 2026-08-13, after a reference image was DESTROYED in production).
 *
 * THE FAILURE IT COMES FROM, recorded so this is not read as an abstraction. `⧉ Duplicate plan`
 * copies an overlay record WHOLESALE — including `storageKey` (the cloud object) and `idbKey` (this
 * device's cached raster). Two plans then point at ONE set of bytes. Every delete path ref-counted
 * that share against `sheetOverlays` — the CURRENT plan's overlay list — which by construction
 * cannot see the sibling plan holding the other reference. So removing the picture from a duplicate
 * hard-deleted the shared object out from under the original, in both tiers at once.
 *
 * Measured on the owner's production data (2026-08-13): plan `smsrrlk9u576` ("Concept A 1M SF",
 * Woods Road) still carries an overlay record naming
 * `…/site-overlays/smsrrlk9u576/e1454691snsene.png`, and `storage.objects` holds ZERO rows for it.
 * The bytes are gone. Six further plans were armed the same way at the time of the fix — Goose
 * Creek (FOUR plans sharing one site-plan PDF) and Bain (two).
 *
 * THREE RULES, all load-bearing:
 *
 * (1) THE REF-COUNT SPANS EVERY PLAN, NEVER THE CURRENT ONE. A holder is any plan that names the
 *     key, so the question is asked against the whole plan list. The client's list is a
 *     best-effort view (it knows only what this device has hydrated), which is exactly why the
 *     DATABASE is the authority — `db/overlay_object_release_guard.sql` REFUSES a delete of an
 *     object any live plan still references, so a stale tab or a direct API call cannot orphan
 *     bytes either.
 *
 * (2) FAIL TOWARD KEEPING THE BYTES. An orphaned object costs storage; a destroyed one costs the
 *     owner's work, and there is no bucket versioning and no point-in-time restore that covers
 *     storage bytes to undo it. So an UNKNOWN answer — no plan list, a key we cannot attribute —
 *     releases NOTHING. `canReleaseAsset` returns a NAMED reason for every outcome (LOUD-FAILURE)
 *     rather than a bare boolean, so a refusal can be reported instead of being silent.
 *
 * (3) THE TWO TIERS ARE RELEASED TOGETHER OR NOT AT ALL. `storageKey` (cloud) and `idbKey`
 *     (device) are copies of ONE source. Releasing one while the other survives leaves a plan that
 *     renders from a cache it can never rebuild, or a cloud object nothing points at — both were
 *     reachable before this module, because the two ref-counts were written separately at the same
 *     call site. `releasePlanForOverlay` answers for both in one pass.
 *
 * ⛔ AND THE BIGGER BLAST RADIUS, which is the same bug and not a separate one: `deleteSite` evicted
 * cached rasters by the PREFIX `raster:<siteId>:`. A duplicate carries the SOURCE plan's idbKey, so
 * deleting the SOURCE plan wiped the device copy for every plan copied from it. `idbKeysReleasableOnPlanDelete`
 * is that path's answer, and it is the same question asked with the same rule.
 *
 * Pure: no DOM, no network, no storage. Guards: test/sharedAssetRefs.test.js. */

/** Asset tiers a plan can hold a reference to. Both are copies of ONE source. */
export const ASSET_TIERS = ["storage", "idb"];

/* Every key a single plan record references, by tier. Overlays carry the source object
 * (`storageKey`), the B748 DWG provenance copy (`sourceDwgKey`) and the device raster
 * (`idbKey`); the aerial underlay carries its own pair. A missing/!string value is not a key. */
export function planAssetKeys(plan) {
  const storage = new Set();
  const idb = new Set();
  const add = (set, v) => { if (typeof v === "string" && v) set.add(v); };
  if (!plan || typeof plan !== "object") return { storage, idb };
  const overlays = Array.isArray(plan.sheetOverlays) ? plan.sheetOverlays : [];
  for (const o of overlays) {
    if (!o || typeof o !== "object") continue;
    add(storage, o.storageKey);
    add(storage, o.sourceDwgKey);
    add(idb, o.idbKey);
  }
  const u = plan.underlay;
  if (u && typeof u === "object") { add(storage, u.storageKey); add(idb, u.idbKey); }
  return { storage, idb };
}

/* Build the reference index across EVERY plan. `plans` is the whole plan list — a group is not
 * enough, because a cross-project paste shares the same source ref (SitePlanner's `copyOverlay`
 * snapshots `storageKey` deliberately). Soft-deleted plans are INCLUDED by default: a plan in the
 * bin is restorable, so its bytes are still owed to it. */
export function collectAssetRefs(plans, { includeDeleted = true } = {}) {
  const storage = new Map();
  const idb = new Map();
  const list = Array.isArray(plans) ? plans : [];
  for (const p of list) {
    if (!p || typeof p !== "object" || !p.id) continue;
    if (!includeDeleted && p.deletedAt) continue;
    const keys = planAssetKeys(p);
    for (const k of keys.storage) { if (!storage.has(k)) storage.set(k, new Set()); storage.get(k).add(p.id); }
    for (const k of keys.idb) { if (!idb.has(k)) idb.set(k, new Set()); idb.get(k).add(p.id); }
  }
  return { storage, idb };
}

/** Which plans hold `key` in `tier`. Sorted, so a report is stable. */
export function assetHolders(refs, tier, key) {
  const m = refs && refs[tier];
  const set = m instanceof Map ? m.get(key) : null;
  return set ? [...set].sort() : [];
}

/* THE decision. `release:true` only when the ONLY holder is the plan letting go — never when the
 * answer is unknown. Every outcome carries a `reason` so a caller can say WHY out loud. */
export function canReleaseAsset(refs, tier, key, releasingSiteId) {
  if (!key || typeof key !== "string") return { release: false, heldBy: [], reason: "no-key" };
  if (!ASSET_TIERS.includes(tier)) return { release: false, heldBy: [], reason: "unknown-tier" };
  if (!refs || !(refs[tier] instanceof Map)) return { release: false, heldBy: [], reason: "no-index" };
  const holders = assetHolders(refs, tier, key);
  const others = holders.filter((id) => id !== releasingSiteId);
  if (others.length) return { release: false, heldBy: others, reason: "shared" };
  return { release: true, heldBy: [], reason: holders.length ? "sole-holder" : "unreferenced" };
}

/* Both tiers of ONE overlay, answered together (rule 3). Returns what may be released and the
 * holders that blocked anything, so the caller reports one honest line instead of three. */
export function releasePlanForOverlay(refs, overlay, releasingSiteId) {
  const o = overlay && typeof overlay === "object" ? overlay : {};
  const asked = [
    { tier: "storage", key: o.storageKey, what: "object" },
    { tier: "storage", key: o.sourceDwgKey, what: "dwg" },
    { tier: "idb", key: o.idbKey, what: "raster" },
  ].filter((a) => typeof a.key === "string" && a.key);
  const release = [];
  const kept = [];
  for (const a of asked) {
    const v = canReleaseAsset(refs, a.tier, a.key, releasingSiteId);
    (v.release ? release : kept).push({ ...a, ...v });
  }
  return { release, kept, shared: kept.some((k) => k.reason === "shared") };
}

/* PLAN DELETE, the set to PROTECT. The prefix sweep is what evicts genuine orphans (rasters no
 * plan names any more), so it stays — but every device key a SURVIVING plan still references is
 * spared. That is the whole difference between "clean up after a deleted plan" and "wipe the
 * pictures out of the plans copied from it". */
export function idbKeysHeldByOtherPlans(plans, siteId) {
  const keep = new Set();
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!p || typeof p !== "object" || !p.id || p.id === siteId) continue;
    for (const k of planAssetKeys(p).idb) keep.add(k);
  }
  return keep;
}

/* PLAN DELETE. `deleteSite` used to evict `raster:<siteId>:*` blindly; a duplicate carries the
 * SOURCE plan's idbKey, so that wiped siblings' device copies. Answer the same question instead:
 * of the raster keys this plan holds, which does NO surviving plan still name? */
export function idbKeysReleasableOnPlanDelete(plans, siteId) {
  if (!siteId) return { release: [], kept: [] };
  const refs = collectAssetRefs(plans);
  const mine = planAssetKeys((Array.isArray(plans) ? plans : []).find((p) => p && p.id === siteId));
  const release = [];
  const kept = [];
  for (const key of mine.idb) {
    const v = canReleaseAsset(refs, "idb", key, siteId);
    (v.release ? release : kept).push({ key, ...v });
  }
  return { release, kept };
}
