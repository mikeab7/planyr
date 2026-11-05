/* dashboardProjectOrderPrefs — per-user persisted project order (NEW-1, 2026-10-08).
 *
 * The order itself (shape, fallback rules, moves) is src/shared/projects/projectOrder.js; this is
 * only where it lives: ONE key, `dashboardProjectOrder`, in the account's `profiles.prefs` jsonb —
 * the same own-row-RLS store the card layout uses (dashboardPrefs.js), so it follows him across
 * devices and survives reload and sign-out/in, and NO migration is needed (a new top-level key in
 * an existing jsonb bag). Per user by construction: the row is the signed-in user's own, so a
 * shared project is ordered independently by each person who sees it.
 *
 * Writes are a FRESH read-modify-write of only this key (never a cached/in-memory bag) so a card
 * layout or pin saved concurrently is carried through untouched, serialised so two quick moves land
 * in order. LOUD-FAILURE: a failed cloud write returns { ok:false, error } — the caller keeps the
 * on-screen order and says so. Signed out there is no account to sync to: the on-device mirror
 * holds it and `local: true` tells the caller that is expected, not an error.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { getProfileRow, invalidateProfileRow } from "../../../shared/profile/profileRowCache.js";
import { normalizeProjectOrder } from "../../../shared/projects/projectOrder.js";

export const PROJECT_ORDER_PREF_KEY = "dashboardProjectOrder";
const MIRROR_KEY = "planyr:dashboardProjectOrder:v1";

const hasLS = () => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } };

function readMirror() {
  if (!hasLS()) return null;
  try { return normalizeProjectOrder(JSON.parse(localStorage.getItem(MIRROR_KEY) || "null")); } catch { return null; }
}
function writeMirror(order) {
  if (!hasLS()) return;
  try { localStorage.setItem(MIRROR_KEY, JSON.stringify(order)); } catch { /* quota / private mode */ }
}

/** The signed-in user's saved project order. { order: {ids, at} | null, source: "cloud" | "local" }.
 * `null` order = never positioned anything (today's order applies). Never throws. */
export async function loadProjectOrder(uid) {
  if (!supabase || !uid) return { order: readMirror(), source: "local" };
  try {
    const row = await getProfileRow(uid);
    const order = normalizeProjectOrder(row?.prefs?.[PROJECT_ORDER_PREF_KEY]);
    if (order) writeMirror(order);
    return { order, source: "cloud" };
  } catch (e) {
    return { order: readMirror(), source: "local", error: e?.message || "order load failed" };
  }
}

/* The order changed on THIS device (a save from the Dashboard card or the Task Report). The Schedule
 * tab stays mounted behind other tabs, so a surface already on screen listens for this instead of
 * waiting for a remount — that is what makes "reorder in either place changes both" hold live. */
export const PROJECT_ORDER_EVENT = "planyr:project-order-changed";
export function onProjectOrderChanged(fn) {
  if (typeof window === "undefined") return () => {};
  const h = (e) => fn(e && e.detail ? e.detail.order : null);
  window.addEventListener(PROJECT_ORDER_EVENT, h);
  return () => window.removeEventListener(PROJECT_ORDER_EVENT, h);
}
function announce(order) {
  try { if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(PROJECT_ORDER_EVENT, { detail: { order } })); } catch { /* no window */ }
}

let writeChain = Promise.resolve();

/** Persist `order` ({ids, at}). Mirror first (instant; the signed-out home), then a fresh
 * read-modify-write of the cloud row. Resolves { ok, order, local?, error? }. */
export function saveProjectOrder(uid, order) {
  const next = normalizeProjectOrder(order);
  if (!next) return Promise.resolve({ ok: false, order: null, error: "invalid order" });
  writeMirror(next);
  announce(next);
  if (!supabase || !uid) return Promise.resolve({ ok: true, order: next, local: true });
  const run = async () => {
    try {
      const { data: row, error: readErr } = await supabase.from("profiles").select("prefs").eq("id", uid).maybeSingle();
      if (readErr) return { ok: false, order: next, error: readErr.message };
      const prev = (row?.prefs && typeof row.prefs === "object") ? row.prefs : {};
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: uid, prefs: { ...prev, [PROJECT_ORDER_PREF_KEY]: next }, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) return { ok: false, order: next, error: error.message };
      invalidateProfileRow(uid); // the next load must see this write, not a cached pre-write row
      return { ok: true, order: next };
    } catch (e) {
      return { ok: false, order: next, error: e?.message || "order save failed" };
    }
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}
