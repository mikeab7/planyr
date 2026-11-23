/* compsRatePeriodPrefs — per-user, per-account display preference: whether a lease rate reads
 * PER YEAR or PER MONTH everywhere the app shows one. This is the layer on top of the Comps
 * card's own period NORMALIZATION (`dashboard/lib/compsCardModel.js` — every rate on the card
 * converts to ONE period so two comps entered in different periods are never compared 12x
 * apart): that work decides every rate on a surface is in the SAME period; this decides WHICH
 * period that is, as a choice Michael makes himself (the Comps card's small "per year / per
 * month" toggle) rather than a period the app always picks for him. Read by every surface that
 * shows a lease rate — the Dashboard's Comps card AND the map's Comps rail — so flipping the
 * toggle never leaves one of them behind.
 *
 * Reuses the SAME account-scoped store `dashboard/lib/dashboardPrefs.js` /
 * `dashboardSinceLastHerePrefs.js` use (`public.profiles.prefs` jsonb, own-row RLS) under its
 * own top-level key, `compsRatePeriod` — a plain "annual" | "monthly" string, not an object,
 * since there's exactly one fact to remember. Same shape on purpose: mirror-then-cloud,
 * LOUD-FAILURE, a `source` the caller can report, a read-modify-write so a concurrent write to a
 * DIFFERENT key in the same jsonb row (the dashboard layout, the Standards panel, "since last
 * here") can never be clobbered.
 */
import { supabase } from "../../../workspaces/site-planner/lib/supabase.js";
import { updateProfilePrefs } from "../../profile/profilePrefsWriter.js";
import { getProfileRow } from "../../profile/profileRowCache.js";

const MIRROR_KEY = "planyr:compsRatePeriod:v1";
export const DEFAULT_COMPS_RATE_PERIOD = "annual";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

export function _normalizePeriod(raw) {
  return raw === "monthly" ? "monthly" : DEFAULT_COMPS_RATE_PERIOD;
}
const normalizePeriod = _normalizePeriod;

function readMirror() {
  if (!hasLS()) return null;
  try { return localStorage.getItem(MIRROR_KEY); } catch { return null; }
}
function writeMirror(period) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, period); } catch { /* quota / private mode */ }
}

/** Load the signed-in user's comps-rate display period. Returns { period, source } where source
 * is "cloud" (the account row) or "local" (mirror only — signed out, or the read failed). Never
 * throws — a prefs read can't be allowed to block any comps display from rendering its default. */
export async function loadCompsRatePeriod(uid) {
  const mirrorPeriod = normalizePeriod(readMirror());
  if (!supabase || !uid) return { period: mirrorPeriod, source: "local" };
  try {
    // NEW-1 — routed through the shared, session-cached `profileRowCache` (MapFinder.jsx and
    // CompsPanel.jsx both call this on mount, and MapFinder mounts CompsPanel itself, so this
    // used to fire the SAME `profiles?select=prefs` read twice on one project open).
    const row = await getProfileRow(uid);
    const period = normalizePeriod(row?.prefs?.compsRatePeriod);
    writeMirror(period);
    return { period, source: "cloud" };
  } catch (e) {
    return { period: mirrorPeriod, source: "local", error: e?.message || "comps rate period load failed" };
  }
}

/** Persist the chosen period. Mirror first (instant, and the signed-out fallback), then a
 * read-modify-write of the cloud row so every OTHER key already in `prefs` survives untouched.
 * LOUD-FAILURE: a failed cloud write is reported, never swallowed into a silent "saved". */
export async function saveCompsRatePeriod(uid, period) {
  const next = normalizePeriod(period);
  writeMirror(next);
  if (!supabase || !uid) return { ok: false, period: next, error: "not signed in" };
  const r = await updateProfilePrefs(uid, (prev) => ({ ...prev, compsRatePeriod: next }));
  return r.ok ? { ok: true, period: next } : { ok: false, period: next, error: r.error };
}
