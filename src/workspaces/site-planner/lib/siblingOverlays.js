/* SIBLING OVERLAYS (NEW-1, 2026-10-08) — an overlay added on one plan of a site is AVAILABLE on every
 * other plan of that site, hidden until the user turns it on.
 *
 * Owner words (verbatim, also in /CLAUDE.md → Owner product constraints #11): "if I've got a project
 * or a site and I put an overlay on one like concept A, it should also show up on concept B as an
 * option. It shouldn't automatically overlay, but if I go to show it, I should be able to show it."
 *
 * THE DESIGN, decided by the owner and not to be relitigated:
 *  - NO site-level overlay store and NO migration. Every plan keeps its own `sheetOverlays` exactly as
 *    stored today. A "foreign" overlay is one a SIBLING holds that THIS plan does not; it is computed
 *    at read time (never persisted) from a read-only fetch of the sibling rows.
 *  - Turning a foreign row on COPIES the record into this plan. From then on it is this plan's own
 *    record; later edits on either plan do not propagate. There is no code path here that writes a
 *    sibling plan — the only functions in this file that touch the network are read-only selects.
 *
 * WHAT THE ADVERSARIAL REVIEW (against main @ 99c87bb) FOUND, and where each is answered:
 *  1. IDs. `⧉ Duplicate plan` keeps every overlay id, and a removed overlay's id is tombstoned in
 *     `deletedIds` (tombstone wins in `mergeSiteContent`), so a copy that kept the sibling's id would
 *     vanish on the next merge. The legacy aerial uses ONE fixed id on every plan. → a copy always
 *     mints a fresh id (`makeForeignCopy`), and the aerial / any map-fetched backdrop is never offered
 *     (`offerable`).
 *  2. PLACEMENT. `origin` is per plan, raw feet only line up when origins match. → `planForeignCopy`
 *     re-frames through `resolveClipFrame` (the same rule the cross-plan overlay paste uses) and
 *     REFUSES loudly when the frames cannot be related.
 *  3. DEVICE CACHE. A copied `idbKey` is `raster:<siblingId>:overlay:<id>`; two plans would then write
 *     one cache entry. → `idbKey`, `src`, `strippedForCloud`, `storageMissing` are never copied (the
 *     picture rehydrates from `storageKey`). Ref-counting on remove includes the fetched siblings
 *     (`siblingPlansAsRefs` → `collectAssetRefs`), so device + cloud are released together or not at all.
 *  4. IDENTITY. `storageKey` alone is wrong (one PDF on pages 1 and 3 is two overlays with one key).
 *     → identity is (storageKey, page) plus a `sharedFrom: { siteId, overlayId }` stamp. A record with
 *     no storageKey, or `storageMissing`, is never offered.
 *  5. FINDING SIBLINGS. The `group_id` column is a mirror known to drift; the jsonb `groupId` is the
 *     truth. → `fetchSiblingPlans` asks all three ways (id = g, group_id = g, data->>groupId = g),
 *     excludes binned rows, selects ONLY what it needs. No group → no foreign rows.
 *  6. READABILITY. → the caller passes a `probe(key)`; a key the user cannot read is refused up front
 *     rather than copied and then healed to `storageKey: null`.
 *  7. LOUD-FAILURE. A failed sibling fetch returns `{ ok:false, error }` — never an empty list.
 *  8. FRESHNESS. `planForeignCopy` is handed a FRESH fetch and compares it to the row the user clicked;
 *     a sibling that was edited, removed or binned meanwhile is reported, not copied stale.
 *
 * Pure except `fetchSiblingPlans` (a read-only select through an injected client). */

import { resolveClipFrame } from "./planClipboard.js";

/* Same constant as siteModel.js's LEGACY_AERIAL_ID (kept literal: siteModel is a heavy module and this
 * one must stay boot-safe). A test pins the two together. */
export const LEGACY_AERIAL_ID = "legacy-aerial";

/* Fields that must never ride a copy — see rationale 1 and 3 above. */
export const NEVER_COPIED = ["id", "idbKey", "src", "strippedForCloud", "storageMissing", "sharedFrom"];

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const pageOf = (o) => (Number.isFinite(+o.page) && +o.page > 0 ? +o.page : 1);

/** The identity of a placed source: the stored object AND the page it shows. */
export const identityKey = (o) => `${o.storageKey}|${pageOf(o)}`;

/** Can this sibling record be offered as a foreign row? { ok } or { ok:false, reason }. */
export function offerable(o) {
  if (!isObj(o) || !o.id) return { ok: false, reason: "no-id" };
  if (o.id === LEGACY_AERIAL_ID) return { ok: false, reason: "legacy-aerial" };
  if (o.fromMap === true) return { ok: false, reason: "map-backdrop" }; // derived from each plan's own bbox
  if (o.storageMissing) return { ok: false, reason: "storage-missing" };
  if (typeof o.storageKey !== "string" || !o.storageKey) return { ok: false, reason: "no-storage-key" }; // local-only overlay: out of scope (constraint #11)
  return { ok: true };
}

/** What a sibling record looked like when listed — compared again at copy time (rationale 8). */
export function overlaySignature(o) {
  if (!isObj(o)) return "";
  return JSON.stringify([o.storageKey, pageOf(o), o.x, o.y, o.ftPerPx, o.ftPerPxY ?? null, o.rotation || 0,
    o.imgW, o.imgH, o.crop ?? null, o.knockout ?? null, o.aboveParcel ?? null, o.name ?? null]);
}

/**
 * The foreign rows for one plan.
 * @param own       this plan's `sheetOverlays`
 * @param siblings  [{ id, name, deletedAt?, origin, overlays }] — the fetched sibling plans
 * @param selfId    this plan's id (never offered to itself, even if the fetch returned it)
 * @returns [{ key, planId, planName, overlay, signature, sharedFrom, origin }] in a stable order
 */
export function foreignOverlaysFor({ own, siblings, selfId } = {}) {
  const mine = Array.isArray(own) ? own : [];
  const heldIdentity = new Set();
  const heldFrom = new Set();
  for (const o of mine) {
    if (!isObj(o)) continue;
    if (typeof o.storageKey === "string" && o.storageKey) heldIdentity.add(identityKey(o));
    if (o.sharedFrom && o.sharedFrom.siteId) heldFrom.add(`${o.sharedFrom.siteId}:${o.sharedFrom.overlayId}`);
  }
  const rows = [];
  const seen = new Set();
  const plans = (Array.isArray(siblings) ? siblings : [])
    .filter((p) => isObj(p) && p.id && p.id !== selfId && !p.deletedAt)
    .slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")) || String(a.id).localeCompare(String(b.id)));
  for (const p of plans) {
    for (const o of Array.isArray(p.overlays) ? p.overlays : []) {
      if (!offerable(o).ok) continue;
      const ident = identityKey(o);
      if (heldIdentity.has(ident) || seen.has(ident)) continue;
      if (heldFrom.has(`${p.id}:${o.id}`)) continue;
      seen.add(ident);
      rows.push({
        key: `${p.id}:${o.id}`, planId: p.id, planName: p.name || "another plan",
        overlay: o, signature: overlaySignature(o), sharedFrom: { siteId: p.id, overlayId: o.id }, origin: p.origin || null,
      });
    }
  }
  return rows;
}

/** Fetched sibling plans in the shape `collectAssetRefs` reads, so a remove ref-counts against them. */
export const siblingPlansAsRefs = (siblings) =>
  (Array.isArray(siblings) ? siblings : [])
    .filter((p) => isObj(p) && p.id)
    .map((p) => ({ id: p.id, deletedAt: p.deletedAt || null, sheetOverlays: Array.isArray(p.overlays) ? p.overlays : [] }));

/** Which sibling plans (by name) still hold the same source+page as `o` — for the "Still on …" toast. */
export function siblingsStillHolding(o, siblings, selfId) {
  if (!isObj(o) || typeof o.storageKey !== "string" || !o.storageKey) return [];
  const ident = identityKey(o);
  return (Array.isArray(siblings) ? siblings : [])
    .filter((p) => isObj(p) && p.id && p.id !== selfId && !p.deletedAt)
    .filter((p) => (Array.isArray(p.overlays) ? p.overlays : []).some((x) => offerable(x).ok && identityKey(x) === ident))
    .map((p) => p.name || "another plan");
}

/** The new record for THIS plan. Fresh id, no cache/pixel/heal fields, stamped with where it came from. */
export function makeForeignCopy(foreign, { dx = 0, dy = 0, mint } = {}) {
  const src = foreign.overlay;
  const out = {};
  for (const k of Object.keys(src)) if (!NEVER_COPIED.includes(k)) out[k] = src[k];
  out.id = mint();
  out.x = (Number(src.x) || 0) + dx;
  out.y = (Number(src.y) || 0) + dy;
  out.locked = false;
  out.visible = true;
  out.sharedFrom = { siteId: foreign.sharedFrom.siteId, overlayId: foreign.sharedFrom.overlayId };
  return out;
}

/**
 * Everything the "show it here" action has to decide, in order, so each refusal names its reason.
 * @param foreign     the row the user clicked
 * @param fresh       { ok, plans } — a FRESH `fetchSiblingPlans` result (never the list that was on screen)
 * @param selfOrigin  this plan's map origin
 * @param probe       async (storageKey) => "ok" | "missing" | "network"
 * @param mint        () => new overlay id
 * @returns { ok:true, overlay } | { ok:false, reason, message, refresh? }
 */
export async function planForeignCopy({ foreign, fresh, selfOrigin, probe, mint }) {
  if (!fresh || !fresh.ok) {
    return { ok: false, reason: "fetch-failed", message: `Couldn't reach the cloud to copy this from ${foreign.planName} — nothing was changed. Try again.` };
  }
  const plan = fresh.plans.find((p) => p.id === foreign.planId && !p.deletedAt);
  if (!plan) return { ok: false, reason: "plan-gone", refresh: true, message: `${foreign.planName} is no longer available, so there's nothing to copy.` };
  const now = (plan.overlays || []).find((o) => o && o.id === foreign.sharedFrom.overlayId);
  if (!now || !offerable(now).ok) return { ok: false, reason: "overlay-gone", refresh: true, message: `That drawing was just removed from ${foreign.planName} — the list has been refreshed.` };
  if (overlaySignature(now) !== foreign.signature) {
    return { ok: false, reason: "changed", refresh: true, message: `${foreign.planName} just changed that drawing — the list has been refreshed. Turn it on again to copy the new version.` };
  }
  const w = (Number(now.imgW) || 0) * (Number(now.ftPerPx) || 0);
  const h = (Number(now.imgH) || 0) * (Number(now.ftPerPxY ?? now.ftPerPx) || 0);
  const frame = resolveClipFrame(plan.origin || null, selfOrigin || null, {
    ref: { x: (Number(now.x) || 0) + w / 2, y: (Number(now.y) || 0) + h / 2 }, extentFt: Math.max(w, h),
  });
  if (!frame.ok) return { ok: false, reason: frame.reason, message: frame.message };
  const readable = typeof probe === "function" ? await probe(now.storageKey) : "ok";
  if (readable === "missing") return { ok: false, reason: "unreadable", message: `The file behind this drawing can't be opened from your account, so it can't be copied from ${foreign.planName}.` };
  if (readable !== "ok") return { ok: false, reason: "probe-failed", message: "Couldn't check the file behind this drawing — check your connection and try again." };
  const row = { ...foreign, overlay: now };
  return { ok: true, overlay: makeForeignCopy(row, { dx: frame.dx, dy: frame.dy, mint }), frame };
}

/**
 * READ-ONLY. The sibling plans of `groupId` (never `selfId`; binned ones are flagged `deletedAt`), reduced to what the
 * panel needs. `client` is the supabase client (injected so this is testable). Three queries because
 * the `group_id` column is a mirror known to drift from the jsonb `groupId` (see this file's header).
 * @returns { ok:true, plans:[{id,name,deletedAt,origin,overlays}] } | { ok:false, error }
 */
export async function fetchSiblingPlans(client, groupId, selfId) {
  if (!client || !groupId) return { ok: true, plans: [], skipped: true };
  const cols = "id, name, group_id, deleted_at, origin:data->origin, overlays:data->sheetOverlays";
  // Binned rows ARE returned (flagged `deletedAt`): a plan in the bin is restorable, so its bytes are
  // still owed to it by the ref-count. Everything that LISTS or COPIES filters them out.
  const base = () => client.from("sites").select(cols);
  try {
    const res = await Promise.all([
      base().eq("id", groupId),
      base().eq("group_id", groupId),
      base().eq("data->>groupId", groupId),
    ]);
    const err = res.find((r) => r && r.error);
    if (err) return { ok: false, error: err.error.message || "sibling fetch failed" };
    const byId = new Map();
    for (const r of res) for (const row of (r && r.data) || []) {
      if (!row || !row.id || row.id === selfId) continue;
      byId.set(row.id, {
        id: row.id, name: row.name || null, deletedAt: row.deleted_at || null, origin: isObj(row.origin) ? row.origin : null,
        overlays: Array.isArray(row.overlays) ? row.overlays.filter(isObj) : [],
      });
    }
    return { ok: true, plans: [...byId.values()] };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "sibling fetch threw" };
  }
}
