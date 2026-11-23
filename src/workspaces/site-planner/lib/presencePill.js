import { presenceAgo } from "../../../shared/units/dateFormat.js";
// Header presence chip — pure data + presentation derivation (B674, rebuilt NEW-1).
//
// Presence rides the SAME per-site realtime channel the element rows stream on (Supabase Realtime
// Presence: each connected client announces itself; the channel keeps a live roster). The chip
// shows only when there is something worth reporting — working alone in one window stays
// chrome-quiet (PANEL-BREVITY's spirit applied to the header, not just panels).
//
// presenceState() shape (supabase-js): { [presenceKey]: [meta, meta, ...] } — one key per tracked
// IDENTITY (we key by uid), one meta per connected SESSION (window/tab/device) under that key. That
// is already the answer to "which sessions are MINE": every session sharing this account's uid is
// one of this account's own tabs, and every OTHER key is a genuinely different signed-in person —
// no second backend, no per-session identity to invent, it was already there in the grouping.
//
// ⛔ THE BUG THIS REBUILD FIXES (owner report, "4 people here" with one account, several tabs open):
// the previous `presenceSummary` folded every connected session — self's own extra tabs included —
// into one people-shaped count ("N here"), so Michael's own second and third tab read as strangers.
// B674 had already fixed the undercount half of this (two windows of one account must not disappear
// as "alone"); this fixes the OTHER half — those extra windows must not read as OTHER PEOPLE either.

// B472048 (NEW-7 · NEW-2) — "who is here" answered WHO; this answers "and what were they doing".
// Hovering a presence chip is the one moment the owner is already looking at someone else's
// presence, so it is where "what has X been doing" belongs — rather than a second surface nobody
// opens. `lastOpByUid` is keyed the same way presence already groups sessions (by account uid, not
// by the finer-grained per-tab actor_session_id the write path stamps): two windows of one
// teammate already collapse into that teammate's ONE `others` entry (`windows: 2`), so "their last
// operation" is naturally a per-PERSON fact here, not a per-tab one — asking which of their tabs
// did it is a question this chip was never going to answer anyway. Caller-tracked (from realtime
// site_elements rows; see SitePlanner.jsx), because this module stays pure/DOM-free.
//   lastOpByUid: Map|object, uid -> { opKind, at } — `at` a comparable value (epoch ms recommended)
//
// presenceParties(state, selfUid, lastOpByUid) → null (nothing to show) or:
//   { selfWindows, others, totalSessions }
//     selfWindows   — how many of THIS account's own sessions are connected right now (>=1 when
//                     any are; the caller is one of them)
//     others        — one entry per OTHER real person present, alphabetized by display name/email:
//                     { uid, name, email, windows, lastOp } — name/email are `null` when the
//                     session never announced one; `lastOp` is `{opKind, at}` or `null` when
//                     nothing has been seen from them yet this page load (never a guess).
//     totalSessions — every connected session, self's included
// Returns null when there is only one session total (this window, alone, nothing else open) —
// the one case with nothing to report.
export function presenceParties(state, selfUid, lastOpByUid = null) {
  const entries = state instanceof Map ? state.entries() : Object.entries(state || {});
  const lastOps = lastOpByUid instanceof Map ? lastOpByUid : new Map(Object.entries(lastOpByUid || {}));
  let selfWindows = 0;
  const others = [];
  for (const [key, metas] of entries) {
    const list = metas || [];
    if (!list.length) continue;
    const windows = list.length;
    if (key === selfUid) { selfWindows += windows; continue; }
    const m = list[0] || {};
    const name = (m.name == null ? "" : String(m.name)).trim();
    const email = (m.email == null ? "" : String(m.email)).trim();
    others.push({ uid: key, name: name || null, email: email || null, windows, lastOp: lastOps.get(key) || null });
  }
  others.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  const totalSessions = selfWindows + others.reduce((n, o) => n + o.windows, 0);
  if (totalSessions <= 1) return null; // alone, single tab → no chip
  return { selfWindows, others, totalSessions };
}

// One-word verb for a person's last-seen operation, from the SAME closed vocabulary the activity
// view reads (operationEnvelope.js's OP_KINDS) — so the chip and the activity feed never disagree
// about what to call a move/merge/split. An op_kind this module doesn't recognize (a future
// addition, or a stale build) falls back to "changed" rather than throwing or going blank.
const OP_LABELS = {
  create: "created", delete: "deleted", move: "moved", resize: "resized", rotate: "rotated",
  edit: "edited", paste: "pasted", import: "imported", merge: "merged", split: "split", replace: "replaced",
};

// relativeAgo(atMs, nowMs) → "just now" | "4m ago" | "3h ago" | "a while ago". Coarse buckets on
// purpose (never seconds) — shared by the presence hover below AND the plan-activity feed
// (SitePlanner.jsx), so "how recent" always reads the same way everywhere the app says it.
export const relativeAgo = presenceAgo;

// presenceLastOpLabel(lastOp, nowMs) → "moved · 3m ago" | "moved · just now" | null (nothing seen yet).
export function presenceLastOpLabel(lastOp, nowMs = Date.now()) {
  if (!lastOp || !Number.isFinite(lastOp.at)) return null;
  const verb = OP_LABELS[lastOp.opKind] || "changed";
  return `${verb} · ${relativeAgo(lastOp.at, nowMs)}`;
}

// One-or-two-letter initials for a presence badge: from the display name when there is one
// ("Sam Alvarez" → "SA", "Sam" → "SA"), else the first letter of the account email, else "?" —
// never blank, so a badge with no hover text isn't unreadable furniture. Two people can
// legitimately collide on the same initials (that's expected, not a bug) — the full name/email
// on hover is what disambiguates them, not the badge itself.
export function presenceInitials(person) {
  const name = (person && person.name) || "";
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    if (parts[0]) return parts[0].slice(0, 2).toUpperCase();
  }
  const email = (person && person.email) || "";
  if (email) return email[0].toUpperCase();
  return "?";
}

// The full display name for the hover/tap breakdown — never blank.
export function presenceDisplayName(person) {
  return (person && person.name) || (person && person.email) || "Someone";
}

// How many of another person's OWN initials badges are shown before the rest collapse into a
// single "+N" overflow badge. Kept small on purpose — this chip lives in the header's right zone,
// which never shrinks (NAVIGATION WINS), so its width has to stay bounded regardless of how many
// people are on a plan at once.
export const PRESENCE_INITIALS_CAP = 3;

// presenceChipContent(parties) → null (render nothing) or the fully-decided presentation, so the
// component below is a pure mapping from this to JSX and every case here is unit-testable without
// mounting anything. `kind` picks the icon/wording family:
//   "people"    — at least one other real person is present (the two-person silhouette glyph)
//   "self-tabs" — only this account's own extra tabs (no other person here at all)
export function presenceChipContent(parties) {
  if (!parties) return null;
  const { selfWindows, others } = parties;
  if (!others.length) {
    // Alone, but in more than one tab/window. Never the people glyph — there is no one else here.
    return { kind: "self-tabs", selfWindows, visible: [], overflow: 0, tooltip: `You — open in ${selfWindows} tabs` };
  }
  const visible = others.slice(0, PRESENCE_INITIALS_CAP);
  const overflow = others.length - visible.length;
  const lines = [];
  if (selfWindows > 1) lines.push(`You — ${selfWindows} tabs`);
  for (const o of others) {
    const label = presenceDisplayName(o);
    lines.push(o.windows > 1 ? `${label} (${o.windows} windows)` : label);
  }
  return { kind: "people", selfWindows, visible, overflow, tooltip: lines.join(" · ") };
}
