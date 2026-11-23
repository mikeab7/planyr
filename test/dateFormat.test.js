import { describe, it, expect } from "vitest";
import * as shared from "../src/shared/units/dateFormat.js";
import { relTime } from "../src/shared/projects/projectModel.js";
import { relativeTimeShort } from "../src/workspaces/dashboard/lib/relativeTime.js";
import { relativeTimeLabel } from "../src/workspaces/dashboard/lib/compsCardModel.js";
import { ageWords } from "../src/workspaces/site-planner/lib/siteChecks.js";
import { formatAge } from "../src/workspaces/site-planner/lib/gisCache.js";
import { relativeAgo } from "../src/workspaces/site-planner/lib/presencePill.js";
import { ago } from "../src/workspaces/admin/lib/adminPanels.js";
import { relativeTime } from "../src/workspaces/notes/lib/notesTime.js";

/* Audit batch I5 — each relative-time formatter moved to shared/units/dateFormat.js with its body untouched.
 * The OLD_* functions below are verbatim copies of the pre-move bodies; every call site must still answer
 * exactly what its old body answered, over a grid of ages (and bad inputs). */
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, DAYMS = DAY;
const NOW = Date.UTC(2026, 10, 23, 12, 0, 0);

function OLD_relTime_relCompact(ts, now = Date.now()) {
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

function OLD_ago_agoMinHr(iso, now = Date.now()) {
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

function OLD_relativeTime_notesRelative(ms, { now = Date.now() } = {}) {
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

function OLD_fmtAge_agoMinHrShort(ms) {
  const m = Math.max(0, Math.round(Number(ms) / 60000));
  if (!isFinite(m)) return "age unknown";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function OLD_formatAge_cacheAge(ms) {
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

function OLD_relativeAgo_presenceAgo(atMs, nowMs = Date.now()) {
  if (!Number.isFinite(atMs)) return null;
  const deltaMs = nowMs - atMs;
  if (deltaMs < 0 || deltaMs < 45 * 1000) return "just now";
  const mins = Math.round(deltaMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return "a while ago";
}

function OLD_ageWords_ageWordsLong(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 45 * 1000) return "just now";
  if (ms < HOUR) { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? "" : "s"} ago`; }
  if (ms < DAYMS) { const h = Math.round(ms / HOUR); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const d = Math.round(ms / DAYMS);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function OLD_relativeDays_daysAgoWords(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function OLD_relativeTimeLabel_daysAgoWords(iso) {
  if (!iso) return null;
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function OLD_relativeTimeShort_dashboardShort(iso, nowMs = Date.now()) {
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

const AGES = [0, 1000, 44000, 45000, 59000, 60000, 61000, 5 * MIN, 59 * MIN, 60 * MIN, 61 * MIN, 5 * HOUR, 23 * HOUR, 24 * HOUR, 47 * HOUR, 48 * HOUR, 50 * HOUR, 3 * DAY, 6 * DAY, 7 * DAY, 20 * DAY, 29 * DAY, 30 * DAY, 45 * DAY, 59 * DAY, 60 * DAY, 90 * DAY, 400 * DAY, 800 * DAY, -5000];
const BAD = [null, undefined, "", NaN, "junk", -1, Infinity];
const grid = [...AGES, ...BAD];
const at = (age) => (typeof age === "number" && Number.isFinite(age) ? NOW - age : age);
const iso = (age) => (typeof age === "number" && Number.isFinite(age) ? new Date(NOW - age).toISOString() : age);
const same = (a, b, label) => { for (const g of grid) { const x = a(g), y = b(g); expect(x, `${label} @ ${String(g)}`).toEqual(y); } };

describe("relative-time formatters moved verbatim (audit batch I5)", () => {
  it("projectModel.relTime", () => same((g) => relTime(at(g), NOW), (g) => OLD_relTime_relCompact(at(g), NOW), "relTime"));
  it("adminPanels.ago", () => same((g) => ago(iso(g), NOW), (g) => OLD_ago_agoMinHr(iso(g), NOW), "ago"));
  it("notesTime.relativeTime", () => same((g) => relativeTime(at(g), { now: NOW }), (g) => OLD_relativeTime_notesRelative(at(g), { now: NOW }), "notes"));
  it("gisCache.formatAge", () => same((g) => formatAge(g), (g) => OLD_formatAge_cacheAge(g), "formatAge"));
  it("presencePill.relativeAgo", () => same((g) => relativeAgo(at(g), NOW), (g) => OLD_relativeAgo_presenceAgo(at(g), NOW), "relativeAgo"));
  it("siteChecks.ageWords", () => same((g) => ageWords(g), (g) => OLD_ageWords_ageWordsLong(g), "ageWords"));
  it("flood age + dashboard short + days-ago words (via the shared exports)", () => {
    same((g) => shared.agoMinHrShort(g), (g) => OLD_fmtAge_agoMinHrShort(g), "fmtAge");
    same((g) => relativeTimeShort(iso(g), NOW), (g) => OLD_relativeTimeShort_dashboardShort(iso(g), NOW), "short");
  });
  it("daysAgoWords is what both dashboard copies said", () => {
    const real = Date.now; Date.now = () => NOW;
    try { same((g) => relativeTimeLabel(iso(g)), (g) => OLD_relativeDays_daysAgoWords(iso(g)), "days"); } finally { Date.now = real; }
  });
});
