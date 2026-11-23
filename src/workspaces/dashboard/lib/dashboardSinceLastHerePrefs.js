/* dashboardSinceLastHerePrefs — per-user "when did I last see the dashboard" mark, plus the small
 * per-entity snapshot the "Since you were last here" card diffs against to notice a plan that
 * grew, or a schedule date that moved (see lib/sinceLastHereFeed.js's header for why a snapshot,
 * not an event log, is how those two are detected honestly).
 *
 * Reuses the SAME account-scoped store `lib/dashboardPrefs.js` uses (`public.profiles.prefs`
 * jsonb, own-row RLS) under its own top-level key, `sinceLastHere` — a read-modify-write, never a
 * bare `{sinceLastHere}` write, so a concurrent Dashboard-layout save (or the Standards panel,
 * which shares this same row) can't be clobbered. Same shape as dashboardPrefs.js on purpose:
 * mirror-then-cloud, LOUD-FAILURE, a `source` the caller can report.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { getProfileRow, updateProfilePrefs } from "../../../shared/profile/profileRowCache.js";

const MIRROR_KEY = "planyr:sinceLastHere:v1";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

function readMirror() {
  if (!hasLS()) return null;
  try { return JSON.parse(localStorage.getItem(MIRROR_KEY) || "null"); } catch { return null; }
}
function writeMirror(mark) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(mark)); } catch { /* quota / private mode */ }
}

function normalizeMark(raw) {
  const lastVisitAt = raw && typeof raw.lastVisitAt === "string" ? raw.lastVisitAt : null;
  const snapshot = raw && raw.snapshot && typeof raw.snapshot === "object" ? raw.snapshot : {};
  return {
    lastVisitAt,
    snapshot: {
      plans: snapshot.plans && typeof snapshot.plans === "object" ? snapshot.plans : {},
      tasks: snapshot.tasks && typeof snapshot.tasks === "object" ? snapshot.tasks : {},
    },
  };
}

/** Load the signed-in user's last-visit mark + snapshot. Returns { mark, source } where source is
 * "cloud" (the account row) or "local" (mirror only — signed out, or the read failed). Never
 * throws, and a missing mark (first-ever visit under this feature) comes back as
 * `{ lastVisitAt: null, snapshot: {...} }` rather than an error. */
export async function loadSinceLastHere(uid) {
  const mirrorMark = normalizeMark(readMirror());
  if (!supabase || !uid) return { mark: mirrorMark, source: "local" };
  try {
    // NEW-1 — shared, session-cached read (see profileRowCache.js) instead of its own
    // `profiles?select=prefs` round trip.
    const row = await getProfileRow(uid);
    const mark = normalizeMark(row?.prefs?.sinceLastHere);
    writeMirror(mark);
    return { mark, source: "cloud" };
  } catch (e) {
    return { mark: mirrorMark, source: "local", error: e?.message || "since-last-here load failed" };
  }
}

/** Persist a new mark (a fresh lastVisitAt + the snapshot the next visit should diff against).
 * Mirror first (instant, and the signed-out fallback), then a read-modify-write of the cloud row
 * so every OTHER key already in `prefs` survives untouched. */
export async function saveSinceLastHere(uid, mark) {
  const next = normalizeMark(mark);
  writeMirror(next);
  if (!supabase || !uid) return { ok: false, mark: next, error: "not signed in" };
  const r = await updateProfilePrefs(uid, (prev) => ({ ...prev, sinceLastHere: next }));
  return r.ok ? { ok: true, mark: next } : { ok: false, mark: next, error: r.error };
}
