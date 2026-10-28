/* Team-invite inbox — client store + hook (NEW-1, 2026-10-28). The account menu (AccountControl) reads
 * the signed-in user's PENDING team invitations from here and answers them (Accept / Decline).
 *
 * ONE store, not per-component state: Shell mounts one AccountControl per kept-alive workspace header
 * (see AccountControl.jsx), so the invitation list is module state with subscribers — one fetch, every
 * copy of the badge and the menu agrees. It is keyed by user id, so an account switch can never show the
 * previous account's invitations.
 *
 * The server side is the two SECURITY DEFINER RPCs in site-planner/db/team_invite_inbox.sql. The invitee
 * never reads team_invites directly. The pure half (row mapping, wording) is shared/teams/teamInviteModel.js.
 * This file deliberately does NOT import site-planner/lib/teams.js — that module is kept off the always-
 * loaded shell chunk (the Team tab is lazy); only the Supabase client is needed here.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "../workspaces/site-planner/lib/supabase.js";
import { mapInviteRows, answerNote, TEAMS_CHANGED_EVENT } from "../shared/teams/teamInviteModel.js";

// status: "idle" (never asked) | "ok" | "error" (the last ask failed — the list shown may be stale).
let snap = { uid: null, invites: [], status: "idle" };
let fetchedAt = 0;
let inflight = null;
const listeners = new Set();
const emit = (next) => { snap = next; listeners.forEach((l) => l()); };
const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => snap;

// A Supabase error meaning the RPC isn't deployed yet (DB not migrated): there can be no invitations to
// show, and an error banner on every account menu would be noise — treat as "none".
const isMissingFunction = (error) => {
  const msg = String((error && error.message) || "").toLowerCase();
  return (error && error.code === "PGRST202") || msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist"));
};

/** Forget everything (sign-out / account switch). */
export function resetInvites() { inflight = null; fetchedAt = 0; if (snap.uid !== null || snap.invites.length || snap.status !== "idle") emit({ uid: null, invites: [], status: "idle" }); }

/** Ask the server for this user's open invitations. `minAgeMs` skips the call when the answer is that
 *  fresh (focus / reopen churn); an explicit open of the menu passes 0. Never throws. */
export function refreshInvites(uid, { minAgeMs = 0 } = {}) {
  if (!supabase || !uid) { resetInvites(); return Promise.resolve(); }
  if (snap.uid !== uid) emit({ uid, invites: [], status: "idle" }); // a different account — drop the old list at once
  if (inflight && inflight.uid === uid) return inflight.p;
  if (minAgeMs > 0 && snap.status === "ok" && Date.now() - fetchedAt < minAgeMs) return Promise.resolve();
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc("list_my_invites");
      if (snap.uid !== uid) return; // signed out / switched while the call was out
      if (error && isMissingFunction(error)) { emit({ uid, invites: [], status: "ok" }); fetchedAt = Date.now(); return; }
      if (error) { emit({ uid, invites: snap.invites, status: "error" }); return; }
      emit({ uid, invites: mapInviteRows(data), status: "ok" });
      fetchedAt = Date.now();
    } catch (_) {
      if (snap.uid === uid) emit({ uid, invites: snap.invites, status: "error" });
    } finally { inflight = null; }
  })();
  inflight = { uid, p };
  return p;
}

/** Accept or decline ONE invitation. Resolves { ok, text, accepted }; on success the invitation leaves the
 *  list. An accept fires TEAMS_CHANGED_EVENT so the rest of the app re-reads the user's teams. */
export async function answerInvite(uid, invite, accept) {
  if (!supabase || !uid || !invite) return { ok: false, text: "Sign in to answer an invitation.", accepted: false };
  let res;
  try {
    const { data, error } = await supabase.rpc("respond_to_invite", { p_invite: invite.id, p_accept: !!accept });
    res = error ? { ok: false, error: error.message } : data;
  } catch (e) { res = { ok: false, error: (e && e.message) || "Network error." }; }
  const note = answerNote(res, accept, invite.teamName);
  // "not_found" means it is already gone server-side — drop it from the list too, or it would sit there forever.
  if ((note.ok || (res && res.reason === "not_found")) && snap.uid === uid) {
    emit({ uid, invites: snap.invites.filter((i) => i.id !== invite.id), status: snap.status });
  }
  if (note.ok && accept && typeof window !== "undefined") {
    try { window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT)); } catch (_) { /* nothing listening is fine */ }
  }
  return { ok: note.ok, text: note.text, accepted: note.ok && !!accept };
}

const FOCUS_MIN_AGE_MS = 30000;

/** React face. `user` is the signed-in Supabase user (or null). Starts empty — nothing ever flashes. */
export function useTeamInvites(user) {
  const uid = user?.id || null;
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A render right after an account switch must never read the previous account's list.
  const mine = s.uid === uid && uid ? s : { uid, invites: [], status: "idle" };

  useEffect(() => {
    if (!uid) { resetInvites(); return undefined; }
    refreshInvites(uid, { minAgeMs: FOCUS_MIN_AGE_MS });
    // An invitation sent while this tab sat open shows up the next time the user comes back to it.
    const back = () => { if (document.visibilityState !== "hidden") refreshInvites(uid, { minAgeMs: FOCUS_MIN_AGE_MS }); };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => { document.removeEventListener("visibilitychange", back); window.removeEventListener("focus", back); };
  }, [uid]);

  const refresh = useCallback(() => refreshInvites(uid), [uid]);
  const answer = useCallback((invite, accept) => answerInvite(uid, invite, accept), [uid]);
  return { invites: mine.invites, count: mine.invites.length, status: mine.status, refresh, answer };
}
