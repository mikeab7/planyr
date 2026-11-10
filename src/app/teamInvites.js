/* Team-invite inbox — client store + hook (NEW-1, 2026-10-28). The account menu (AccountControl) reads
 * the signed-in user's PENDING team invitations from here and answers them (Accept / Decline).
 *
 * ONE store, not per-component state: Shell mounts one AccountControl per kept-alive workspace header
 * (see AccountControl.jsx), so the invitation list is module state with subscribers — one fetch, every
 * copy of the badge and the menu agrees. It is keyed by user id, so an account switch can never show the
 * previous account's invitations.
 *
 * The server side is the SECURITY DEFINER RPCs in site-planner/db/team_invite_proof.sql. The invitee
 * never reads team_invites directly. NEW-1 (2026-11-02): an address match is not proof of the mailbox (email confirmation
 * is off), so an account that hasn't proven it only learns that an invitation is WAITING (no id, no team) and can have the
 * invitation emailed again; the emailed link (redeemInvite) is what proves the mailbox and joins. The pure half (row mapping, wording) is shared/teams/teamInviteModel.js.
 * This file deliberately does NOT import site-planner/lib/teams.js — that module is kept off the always-
 * loaded shell chunk (the Team tab is lazy); only the Supabase client is needed here.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "../workspaces/site-planner/lib/supabase.js";
import { mapInviteRows, splitInvites, answerNote, redeemNote, resendNote, TEAMS_CHANGED_EVENT } from "../shared/teams/teamInviteModel.js";

// status: "idle" (never asked) | "ok" | "error" (the last ask failed — the list shown may be stale).
let snap = { uid: null, invites: [], status: "idle", sentTo: null };
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
export function resetInvites() { inflight = null; fetchedAt = 0; if (snap.uid !== null || snap.invites.length || snap.status !== "idle" || snap.sentTo) emit({ uid: null, invites: [], status: "idle", sentTo: null }); }

/** Ask the server for this user's open invitations. `minAgeMs` skips the call when the answer is that
 *  fresh (focus / reopen churn); an explicit open of the menu passes 0. Never throws. */
export function refreshInvites(uid, { minAgeMs = 0 } = {}) {
  if (!supabase || !uid) { resetInvites(); return Promise.resolve(); }
  if (snap.uid !== uid) emit({ uid, invites: [], status: "idle", sentTo: null }); // a different account — drop the old list at once
  if (inflight && inflight.uid === uid) return inflight.p;
  if (minAgeMs > 0 && snap.status === "ok" && Date.now() - fetchedAt < minAgeMs) return Promise.resolve();
  const p = (async () => {
    try {
      const { data, error } = await supabase.rpc("list_my_invites");
      if (snap.uid !== uid) return; // signed out / switched while the call was out
      if (error && isMissingFunction(error)) { emit({ uid, invites: [], status: "ok", sentTo: snap.sentTo }); fetchedAt = Date.now(); return; }
      if (error) { emit({ uid, invites: snap.invites, status: "error", sentTo: snap.sentTo }); return; }
      emit({ uid, invites: mapInviteRows(data), status: "ok", sentTo: snap.sentTo });
      fetchedAt = Date.now();
    } catch (_) {
      if (snap.uid === uid) emit({ uid, invites: snap.invites, status: "error", sentTo: snap.sentTo });
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
    emit({ ...snap, uid, invites: snap.invites.filter((i) => i.id !== invite.id) });
  }
  // The mailbox is not proven (e.g. proven state changed under us): the list was stale — re-ask, so the card turns into
  // the "waiting" one instead of offering an Accept that cannot work.
  if (note.unproven) refreshInvites(uid);
  if (note.ok && accept && typeof window !== "undefined") {
    try { window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT)); } catch (_) { /* nothing listening is fine */ }
  }
  return { ok: note.ok, text: note.text, accepted: note.ok && !!accept };
}

/** The EMAILED LINK (NEW-1, 2026-11-02): the signed-in holder of an invite link accepts or declines it. The link is the
 *  proof of the mailbox, so this also proves it server-side (redeem_invite_link). Resolves { ok, text, wrongAccount?,
 *  teamName }; an accept fires TEAMS_CHANGED_EVENT and the inbox re-reads (the account now has a proven mailbox). */
export async function redeemInvite(uid, invite, accept) {
  if (!supabase || !uid || !invite) return { ok: false, text: "Sign in to answer an invitation." };
  let res;
  try {
    const { data, error } = await supabase.rpc("redeem_invite_link", { p_invite: invite.id, p_accept: !!accept });
    res = error ? { ok: false, error: error.message } : data;
  } catch (e) { res = { ok: false, error: (e && e.message) || "Network error." }; }
  const note = redeemNote(res, accept, invite.teamName);
  if (note.ok) {
    if (accept && typeof window !== "undefined") { try { window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT)); } catch (_) { /* nothing listening is fine */ } }
    refreshInvites(uid); // proven now: any other invitation to this address can be answered from the menu
  }
  return { ok: note.ok, text: note.text, wrongAccount: !!note.wrongAccount, teamName: (res && res.team_name) || invite.teamName };
}

/** "Email me my invitation again" for an account that hasn't proven its mailbox. The server throttles (one send per
 *  invite per minute) and never returns an invite id. Resolves { ok, text, throttled? } and remembers the address it
 *  wrote to so the menu can keep saying "We sent a confirmation to <address>.". */
export async function resendInvitation(uid, address) {
  if (!supabase || !uid) return { ok: false, text: "Sign in to resend it." };
  let status = 0, body = null;
  try {
    const { authedFetch } = await import("../shared/auth/apiAuth.js"); // lazy: this module is in the entry chunk every route downloads
    const r = await authedFetch("/api/team/invite-resend", { method: "POST" }, { client: supabase });
    if (r.signIn) return { ok: false, signIn: true, text: "Your sign-in expired \u2014 sign in again to resend it." }; // a 401 that survived the renewal reads the same as a refused renewal
    if (!r.resp) return { ok: false, text: "Couldn't reach Planyr \u2014 try again." };
    const resp = r.resp;
    status = resp.status;
    body = await resp.json().catch(() => null);
  } catch (e) { return { ok: false, text: (e && e.message) || "Couldn't reach Planyr \u2014 try again." }; }
  const note = resendNote(status, body, address);
  if ((note.ok || note.throttled) && snap.uid === uid) emit({ ...snap, sentTo: (body && body.email) || address || snap.sentTo || "your email" });
  return note;
}

const FOCUS_MIN_AGE_MS = 30000;

/** React face. `user` is the signed-in Supabase user (or null). Starts empty — nothing ever flashes. */
export function useTeamInvites(user) {
  const uid = user?.id || null;
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // A render right after an account switch must never read the previous account's list.
  const mine = s.uid === uid && uid ? s : { uid, invites: [], status: "idle", sentTo: null };

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
  const address = user?.email || "";
  const resend = useCallback(() => resendInvitation(uid, address), [uid, address]);
  const { ready, waiting } = splitInvites(mine.invites);
  // `invites` = the ones the account can answer now; `waiting` = how many are held back until the mailbox is proven.
  return { invites: ready, waiting: waiting.length, count: mine.invites.length, status: mine.status, sentTo: mine.sentTo, refresh, answer, resend };
}
