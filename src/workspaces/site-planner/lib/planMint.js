/* planMint.js — what happens when the app tries to CREATE a plan (duplicate / new plan on the same parcel / new site from the map) and the device
 * refuses to store it. NEW-1 (2026-11-03, owner report: a teammate duplicated a plan, the banner said "saved on this device but couldn't sync", a reload
 * said "This project doesn't exist").
 *
 * THE BUG THIS CLOSES: `saveSite` returned false (the device's storage refused the record — nothing was written anywhere), `duplicatePlan` ignored the
 * boolean, fired a cloud push for an id that exists nowhere ("missing"), told the user the plan was "saved on this device", and navigated into an id with
 * no record — which the URL writer then published as the project id. Three lies from one swallowed `false`.
 *
 * ⛔ A LEAF: no imports. The decision and the words live here, pure, so a Node test can drive them (SitePlannerApp.jsx cannot be mounted under Node).
 * The caller injects `save` / `exists` / `makeRoom` / `refusal` / `report`.
 *
 *   • `runMint` — save; if the device refused, make room ONCE (the caller's `makeRoom`, which is `planStore.requestRoom`) and retry the SAME id once;
 *     the result says whether to navigate. `navigate` is true ONLY when the record is really on the device (`exists(id)`), never from `save`'s say-so alone.
 *   • `mintRefusedMessage` — the honest banner words. Never "saved on this device", never "sync" — nothing was saved.
 *   • `describePushFailure` — `pushSiteToCloud` answers `{ok:false, error:"missing"}` when the LOCAL record is absent. That is not a cloud failure and
 *     has nothing to retry; every other error keeps today's wording.
 */

/** pushSiteToCloud's "the local record is not here" answer. Other code matches this string — do not rename. */
export const PUSH_MISSING = "missing";

export function isQuotaReason(reason) { return reason === "quota"; }

/** The owner-facing banner for a refused create. `noun` is what was being made ("copy" | "plan" | "site"). */
export function mintRefusedMessage(noun, reason) {
  const made = noun === "copy" ? "make the copy" : noun === "site" ? "create the new site" : "create the new plan";
  if (isQuotaReason(reason)) return `Couldn't ${made}. This browser's storage for Planyr is full, so nothing was saved. Free up space, or try on another device.`;
  return `Couldn't ${made}. This browser wouldn't store it, so nothing was saved. Try again, or use another device.`;
}

/** The banner for a refused EDIT of an existing plan (rename, status, dates): the change is not on this device, so it is not "saved". */
export function saveRefusedMessage(what, reason) {
  const lead = isQuotaReason(reason) ? "This browser's storage for Planyr is full" : "This browser wouldn't store it";
  return `Couldn't save ${what.charAt(0).toLowerCase()}${what.slice(1)}. ${lead}, so nothing was changed. Free up space, or try on another device.`;
}

/** What to say (and whether a cloud Retry exists) for a failed cloud push. `error` is the raw message pushSiteToCloud / cloudUpsert returned. */
export function describePushFailure(what, error) {
  if (String(error || "") === PUSH_MISSING) {
    return { kind: "missing", retryable: false, record: false, text: `${what} is not on this device, so there is nothing to sync. It was not saved. Try making it again.` };
  }
  return { kind: "cloud", retryable: true, record: true, text: `${what} is saved on this device but couldn't sync to the cloud — it'll catch up on your next edit or reload.` };
}

/**
 * Create a record through the device store and decide what the UI may do next.
 *   save()        → boolean — writes the record (saveSite). Must be safe to call twice with the SAME id.
 *   exists()      → boolean — is the record really on the device now (siteExistsLocally)?
 *   makeRoom()    → Promise<{freedChars}> — free proven-safe storage (planStore.requestRoom); optional.
 *   refusal()     → { reason } | null — why the store said no (planStore.lastRefusal); optional.
 *   report(kind, message, extra) — telemetry (reportClientEvent).
 * Returns { ok, navigate, reason, message, roomFreed }.  `navigate` ⇒ ok ⇒ the record exists.
 */
export async function runMint({ id, noun, what, save, exists, makeRoom, refusal, report }) {
  const say = typeof report === "function" ? report : () => {};
  let saved = false;
  try { saved = !!save(); } catch (e) { saved = false; say("site-mint-threw", `creating ${what || noun} threw`, { id, error: (e && e.message) || String(e) }); }
  let roomFreed = null;
  if (!saved && typeof makeRoom === "function") {
    try { const res = await makeRoom(); roomFreed = (res && res.freedChars) || 0; } catch (e) { roomFreed = 0; say("site-mint-room-failed", "making room for the new record failed", { id, error: (e && e.message) || String(e) }); }
    if (roomFreed > 0) { try { saved = !!save(); } catch (_) { saved = false; } }
  }
  const there = saved && !!(typeof exists === "function" ? exists() : true);
  if (there) return { ok: true, navigate: true, reason: null, message: "", roomFreed };
  const r = (typeof refusal === "function" && refusal()) || null;
  const reason = (r && r.reason) || (saved ? "not-stored" : "unknown");
  say("site-mint-refused", `${what || noun} was refused by this device — nothing was saved`, { what: what || noun, id, reason, roomFreed });
  return { ok: false, navigate: false, reason, message: mintRefusedMessage(noun, reason), roomFreed };
}
