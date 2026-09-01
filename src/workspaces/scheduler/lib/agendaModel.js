/* B1020930 — the org-scoped agenda: pure data model for operational items that have a date
 * and can recur, but have NO dependencies, NO parent/child roll-ups and NO critical path — the
 * owner's own reasoning for why the project Gantt (`public/sequence/index.html`) is the wrong
 * shape for them. This file, `agendaStore.js` and `components/AgendaView.jsx` never import
 * from or touch the embedded scheduler in any way; they are a wholly separate, lightweight
 * surface that only happens to live in the same workspace folder.
 *
 * RECURRENCE GRAMMAR, stated plainly because it is intentionally bounded (see
 * RECURRENCE_PRESETS below): daily / weekly / every-2-weeks / monthly / yearly, each a single
 * fixed interval. This covers the owner's own two examples — "monthly" and "every other
 * Tuesday" (weekly, interval 2, anchored on whatever weekday the item's date already falls on).
 * NOT supported, deliberately: an arbitrary N-day/week/month interval, a "nth weekday of the
 * month" rule (e.g. "the second Tuesday"), an end date or an occurrence count. A recurring item
 * simply advances its own `date` forward by one step each time it is checked off, forever.
 *
 * Date math is done with plain y/m/d integers, using `Date.UTC` ONLY as scratch arithmetic
 * (never read back as a moment in time) so a month/year rollover can never be corrupted by a
 * DST transition. `todayISO`, by contrast, deliberately reads LOCAL date parts — it answers
 * "what calendar day is it for the person looking at the screen", the same day a native
 * `<input type="date">` would show them.
 */

export const RECURRENCE_PRESETS = [
  { id: "none", label: "Does not repeat", recurrence: null },
  { id: "daily", label: "Daily", recurrence: { freq: "daily", interval: 1 } },
  { id: "weekly", label: "Weekly", recurrence: { freq: "weekly", interval: 1 } },
  { id: "biweekly", label: "Every 2 weeks", recurrence: { freq: "weekly", interval: 2 } },
  { id: "monthly", label: "Monthly", recurrence: { freq: "monthly", interval: 1 } },
  { id: "yearly", label: "Yearly", recurrence: { freq: "yearly", interval: 1 } },
];

export function presetIdFor(recurrence) {
  if (!recurrence) return "none";
  const hit = RECURRENCE_PRESETS.find(
    (p) => p.recurrence && p.recurrence.freq === recurrence.freq && p.recurrence.interval === recurrence.interval
  );
  return hit ? hit.id : "none";
}

export function recurrenceForPresetId(id) {
  return (RECURRENCE_PRESETS.find((p) => p.id === id) || RECURRENCE_PRESETS[0]).recurrence;
}

export function describeRecurrence(recurrence) {
  const id = presetIdFor(recurrence);
  return RECURRENCE_PRESETS.find((p) => p.id === id)?.label || "Does not repeat";
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function pad(n, len) { return String(n).padStart(len, "0"); }
function toISODate({ y, m, d }) { return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m is 1-based

/** "What calendar day is it right now", in the viewer's OWN local time — not UTC. */
export function todayISO(at = Date.now()) {
  const d = new Date(at);
  return toISODate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() });
}

/** The next due date after `dateStr`, per `recurrence`. Returns null for a one-off item
 *  (no recurrence) or a dateless item — there is nothing to advance. */
export function nextOccurrence(dateStr, recurrence) {
  if (!recurrence || !dateStr) return null;
  const { freq, interval = 1 } = recurrence;
  const { y, m, d } = parseISODate(dateStr);
  if (freq === "daily" || freq === "weekly") {
    const step = freq === "daily" ? interval : interval * 7;
    const dt = new Date(Date.UTC(y, m - 1, d + step));
    return toISODate({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  }
  if (freq === "monthly") {
    let ny = y, nm = m + interval;
    while (nm > 12) { nm -= 12; ny += 1; }
    return toISODate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) }); // Jan 31 + 1mo -> Feb 28/29
  }
  if (freq === "yearly") {
    const ny = y + interval;
    return toISODate({ y: ny, m, d: Math.min(d, daysInMonth(ny, m)) }); // Feb 29 anchor, non-leap target
  }
  return null;
}

/** overdue (undone, dated before today) / today / upcoming (dated after today) / someday
 *  (no date at all) — the four buckets AgendaView groups by. Pure: takes today's date string
 *  rather than reading the clock itself. */
export function bucketFor(dateStr, todayStr) {
  if (!dateStr) return "someday";
  if (dateStr < todayStr) return "overdue";
  if (dateStr === todayStr) return "today";
  return "upcoming";
}

let seq = 0;
function makeId(at) { return `agenda_${at}_${(seq++).toString(36)}`; }

export function createAgendaItem({ text, date = null, recurrence = null } = {}, at = Date.now()) {
  return {
    id: makeId(at),
    text: (text || "").trim(),
    date: date || null,
    recurrence: recurrence || null,
    done: false,
    createdAt: at,
    updatedAt: at,
    lastCompletedAt: null,
  };
}

/** Checking off a RECURRING item never marks it done — it rolls `date` to the next occurrence
 *  and stays open, forever, exactly like a real recurring chore. A one-off item toggles `done`
 *  normally (so an accidental check is one more click to undo). */
export function toggleAgendaItem(item, at = Date.now()) {
  if (item.recurrence && item.date) {
    return { ...item, date: nextOccurrence(item.date, item.recurrence), done: false, lastCompletedAt: at, updatedAt: at };
  }
  return { ...item, done: !item.done, updatedAt: at };
}

export function updateAgendaItem(items, id, patch, at = Date.now()) {
  return items.map((it) => (it.id === id ? { ...it, ...patch, updatedAt: at } : it));
}

export function deleteAgendaItem(items, id) {
  return items.filter((it) => it.id !== id);
}

/** Not done above done; within a group, dated items ascending by date (undated last); ties by
 *  creation order. This is display order only — buckets are still computed separately. */
export function sortAgendaItems(items) {
  return [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.createdAt - b.createdAt;
  });
}
