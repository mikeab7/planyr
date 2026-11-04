/* The plan menu's rules, pure (NEW-1, 2026-11-04 — the plan crumb dropdown redesigned to the owner-approved mockup).
 *
 * `components/PlanMenu.jsx` only DRAWS; every decision lives here so it is unit-testable without mounting a 28k-line planner:
 *   · which plans the Find box filters, and when it exists at all (`FIND_MIN_PLANS`);
 *   · the ONE item list behind a plan's ⋯ button AND its right-click (`planMenuItems`) — one list, one renderer, the same
 *     "one menu" rule as the Parcels menu (`lib/parcelMenu.js`);
 *   · the Recently-deleted view's entries (plans + deleted site-plan files, newest first) and the exact-time line
 *     ("Deleted Oct 20, 2:37 PM") that tells identically-named plans apart.
 * No React, no DOM. */

/** The Find box appears only at this many plans in the site (below it the whole list is on screen anyway). */
export const FIND_MIN_PLANS = 8;

export function showFind(planCount) {
  return planCount >= FIND_MIN_PLANS;
}

/** Plans whose name contains `query` (case-insensitive, trimmed). An empty query keeps every plan. */
export function filterPlans(plans, query) {
  const q = String(query == null ? "" : query).trim().toLowerCase();
  const list = Array.isArray(plans) ? plans : [];
  if (!q) return list;
  return list.filter((p) => String((p && p.name) || "Untitled plan").toLowerCase().includes(q));
}

/** Every plan except the current one, in the order given (the site's own order — never re-sorted here). */
export function otherPlans(plans, currentId) {
  return (Array.isArray(plans) ? plans : []).filter((p) => p && p.id !== currentId);
}

/**
 * The one item list for a plan's ⋯ menu and right-click. Rows are all the same kind (no divider, no extra gap above the red
 * one — owner comment); "Delete plan" is last and `danger`.
 *   Rename · Duplicate · [Lock — the CURRENT plan only, and only when the plan is yours to lock] · Delete plan
 * @param {{isCurrent:boolean, canDelete:boolean, canLock:boolean, locked:boolean}} o
 *   canDelete = the site has 2+ plans (the last plan of a site is never deletable from here — same rule as the old ✕)
 */
export function planMenuItems({ isCurrent = false, canDelete = false, canLock = false, locked = false } = {}) {
  const out = [
    { id: "rename", label: "Rename" },
    { id: "duplicate", label: "Duplicate" },
  ];
  if (isCurrent && canLock) {
    out.push({
      id: "lock",
      label: locked ? "Locked — teammates can view only" : "Lock to view-only for teammates",
      title: locked
        ? "Teammates can view this plan but not change it. Click to let them edit again."
        : "Teammates can edit this plan. Click to make it view-only for them.",
    });
  }
  if (canDelete) out.push({ id: "delete", label: "Delete plan", danger: true });
  return out;
}

const toMs = (ts) => {
  const t = typeof ts === "string" ? (Date.parse(ts) || Number(ts) || 0) : (Number(ts) || 0);
  return t > 0 ? t : 0;
};

/**
 * "Deleted Oct 20, 2:37 PM" in the viewer's local time; the year is added only when it isn't this year
 * ("Deleted Oct 20, 2025, 2:37 PM"). "" when there is no usable time (a deleted file with no `deletedAt` just has no line).
 */
export function deletedLine(ts, now = Date.now(), locale = "en-US") {
  const t = toMs(ts);
  if (!t) return "";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const opts = { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  if (!sameYear) opts.year = "numeric";
  // Newer ICU puts a narrow no-break space before AM/PM; a plain space reads (and matches in tests) the same everywhere.
  const text = new Intl.DateTimeFormat(locale, opts).format(d).replace(/[  ]/g, " ");
  return `Deleted ${text}`;
}

/**
 * Entries of the Recently-deleted view: deleted PLANS and deleted site-plan FILES in one list, newest first; an entry with
 * no time sorts last (stable among themselves). Each keeps its kind so the row can carry the "site plan" tag.
 */
export function deletedEntries(plans, files) {
  const rows = [];
  (Array.isArray(plans) ? plans : []).forEach((p) => rows.push({ kind: "plan", id: p.id, name: p.name || "Untitled plan", deletedAt: p.deletedAt, src: p }));
  (Array.isArray(files) ? files : []).forEach((f) => rows.push({ kind: "file", id: f.id, name: f.name || f.fileName || "Site plan", deletedAt: f.deletedAt, src: f }));
  return rows
    .map((r, i) => ({ r, i, t: toMs(r.deletedAt) }))
    .sort((a, b) => (b.t - a.t) || (a.i - b.i))
    .map((x) => x.r);
}

/** The count on the "Recently deleted (n)" row: deleted plans + deleted site-plan files. */
export function deletedCount(plans, files) {
  return (Array.isArray(plans) ? plans.length : 0) + (Array.isArray(files) ? files.length : 0);
}
