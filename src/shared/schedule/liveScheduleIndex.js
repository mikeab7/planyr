// src/shared/schedule/liveScheduleIndex.js
//
// NEW-2 (2026-10-05) — the app's one in-memory answer to "which schedules are live right now", published by
// whoever just read the schedules (the Dashboard from the rows, the Schedule tab from its nav-state) and read
// by the surfaces that only hold a stored HINT (the project switcher's calendar icon). It is a CACHE of a
// read, never a store: nothing writes it back anywhere, `null` means "nobody has read yet", and a reader
// that gets null shows the stored hint unchanged (see scheduleLinkHints.resolveScheduleHint).
import { useSyncExternalStore } from "react";
import { ownerOf, OWNER_KIND_SITE } from "./scheduleOwnership.js";

let live = null; // null = unknown · [] = a real "no schedules" answer · [{id, linkedSiteId, ownerKind, …}]
const subs = new Set();

export function publishLiveSchedules(list) {
  const next = Array.isArray(list) ? list : null;
  if (next === live) return;
  live = next;
  for (const f of subs) { try { f(); } catch (_) {} }
}
export function getLiveSchedules() { return live; }
export function subscribeLiveSchedules(cb) { subs.add(cb); return () => subs.delete(cb); }
export function useLiveSchedules() { return useSyncExternalStore(subscribeLiveSchedules, getLiveSchedules, () => null); }

/* NEW-2 (2026-10-05) — READ-TIME verification of the "has a schedule" hint. The hint is only a mirror, and
 * a mirror can outlive its source (production 2026-10-05: two live Goose Creek plans named schedule 23, a
 * row that does not exist, so the switcher drew a calendar that led nowhere). Every reader that SHOWS the
 * hint asks this instead of trusting the stored id: given the schedules known to be live (`liveList`, the
 * same nav-list shape as above) it answers the schedule id the group REALLY has — the stored hint when it
 * still names one of the group's live schedules, else the group's own first live schedule (the fallback),
 * else null. `liveList === null` means "not known yet": the stored hint is returned unchanged (never blank
 * a real icon on nothing-known-yet). */
export function resolveScheduleHint(group, liveList) {
  const cur = group && group.scheduleProjectId != null ? group.scheduleProjectId : null;
  if (!Array.isArray(liveList)) return cur;
  const linked = group ? liveList.filter((p) => { const o = p && typeof p === "object" ? ownerOf(p) : null; return o && o.kind === OWNER_KIND_SITE && o.siteId === group.id; }) : [];
  const keep = cur != null ? linked.find((p) => String(p.id) === String(cur)) : null;
  const want = keep || linked[0] || null;
  return want ? want.id : null;
}
