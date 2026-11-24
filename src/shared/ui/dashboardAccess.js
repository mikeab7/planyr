/* dashboardAccess — the Dashboard is OWNER-ONLY (owner request 2026-11-24: "get rid of the
 * dashboard for everyone else but me").
 *
 * ONE gate: the same `is_admin()` answer the #/admin page already uses (admin/lib/adminStatus.js,
 * allowlist `admin_users`) — no second flag, no hardcoded email. Everyone else never sees the
 * Dashboard anywhere: not in the wordmark, not in the breadcrumb root, not at "#/" or "#/dashboard"
 * (those redirect to the Map, "#/site"), and its component (and so every card's data fetch) is
 * never mounted for them.
 *
 * This file holds the pure decision, the little module-level store that lets deep header
 * components (breadcrumb, wordmark, "Go to Dashboard" buttons) know which word to show without
 * threading a prop through every workspace, and the hook that reads it. Fail CLOSED: until Shell
 * has confirmed an admin answer the store says "not owner". */
import { useSyncExternalStore } from "react";

export const MAP_HASH = "#/site";
export const DASHBOARD_HASH = "#/";

/* Pure: what should the shell do about the Dashboard right now?
 *   "off"      — the hash is not the Dashboard
 *   "wait"     — on the Dashboard hash but identity / admin answer not in yet (show a loader, fetch nothing)
 *   "show"     — confirmed owner
 *   "redirect" — signed out, or a confirmed non-owner (or the check errored: fail closed) → Map */
export function dashboardGate({ isDashboardHash, authKnown, user, adminStatus } = {}) {
  if (!isDashboardHash) return "off";
  if (!authKnown) return "wait";
  if (!user) return "redirect";
  if (adminStatus === "admin") return "show";
  if (adminStatus === "unknown" || adminStatus == null) return "wait";
  return "redirect";
}

/* Pure: where "go to the Dashboard" (wordmark, crumb, Go to Dashboard buttons) leads. */
export function dashboardTarget(isOwner) { return isOwner ? DASHBOARD_HASH : MAP_HASH; }

/* The word a control should show for that destination. */
export function dashboardWord(isOwner) { return isOwner ? "Dashboard" : "Map"; }

/* Pure: rewrite user-facing copy that names the Dashboard for a non-owner ("Dashboard: all
 * projects" -> "Map: all projects"). The owner's text passes through untouched. */
export function dashboardCopy(text, isOwner) {
  if (isOwner || typeof text !== "string") return text;
  return text.replace(/\bDashboard\b/g, "Map");
}

/* ---- tiny external store (Shell writes, header controls read) ---- */
let owner = false;
const listeners = new Set();
export function setDashboardOwner(next) {
  const v = !!next;
  if (v === owner) return;
  owner = v;
  listeners.forEach((l) => l());
}
export function getDashboardOwner() { return owner; }
function subscribe(l) { listeners.add(l); return () => listeners.delete(l); }
export function useDashboardOwner() { return useSyncExternalStore(subscribe, getDashboardOwner, () => false); }
