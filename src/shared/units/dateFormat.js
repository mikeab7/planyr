/* HOW A MOMENT IS SPELLED — one home for the relative-time ("5m ago") formatters (audit batch I5, 2026-11-23).
 *
 * Ten surfaces each carried a private copy, and they DISAGREE on purpose-or-accident ("5m ago" vs "5 min ago" vs
 * "5 minutes ago" vs "5m"). Same rule as numberFormat.js: THIS FILE DOES NOT UNIFY THEM. Each export is the body a call
 * site already used, character for character, so moving it changes no output; which wording a surface should use is a
 * product decision (what Michael sees) and a separate change. `test/dateFormat.test.js` pins every body against a
 * verbatim copy of the old one over a grid of ages. Pure: no React, no DOM.
 */
const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const DAYMS = DAY;

export function relCompact(ts, now = Date.now()) {
  const t = typeof ts === "string" ? (Date.parse(ts) || Number(ts) || 0) : (Number(ts) || 0);
  if (!t) return "";
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function agoMinHr(iso, now = Date.now()) {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hr ago`;
  return `${Math.floor(h / 24)} days ago`;
}

export function notesRelative(ms, { now = Date.now() } = {}) {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const d = now - ms;
  if (d < 0) return "just now";              // a clock that ran backwards is not a future note
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d`;
  if (d < 60 * DAY) return `${Math.floor(d / (7 * DAY))}w`;
  try {
    const then = new Date(ms);
    const sameYear = then.getFullYear() === new Date(now).getFullYear();
    return then.toLocaleDateString(undefined, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" });
  } catch (_) { return ""; }
}

export function agoMinHrShort(ms) {
  const m = Math.max(0, Math.round(Number(ms) / 60000));
  if (!isFinite(m)) return "age unknown";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function cacheAge(ms) {
  if (ms == null || !isFinite(ms) || ms < 0) return "";
  const s = Math.floor(ms / 1000);
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s ago`;
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function presenceAgo(atMs, nowMs = Date.now()) {
  if (!Number.isFinite(atMs)) return null;
  const deltaMs = nowMs - atMs;
  if (deltaMs < 0 || deltaMs < 45 * 1000) return "just now";
  const mins = Math.round(deltaMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return "a while ago";
}

export function ageWordsLong(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 45 * 1000) return "just now";
  if (ms < HOUR) { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? "" : "s"} ago`; }
  if (ms < DAYMS) { const h = Math.round(ms / HOUR); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const d = Math.round(ms / DAYMS);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function daysAgoWords(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

export function dashboardShort(iso, nowMs = Date.now()) {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Math.max(0, nowMs - then);
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.round(day / 30);
  return month <= 1 ? "1mo ago" : `${month}mo ago`;
}

