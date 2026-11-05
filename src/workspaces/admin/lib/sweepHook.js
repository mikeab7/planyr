/* The weekly Claude Code session sweep records itself (B2159507). The sweep runs in the owner's own signed-in
 * browser; once it has opened `#/admin` it calls this one function instead of a person filling in the Ops form:
 *
 *   await window.pfAdminRecordSweep({ archived: 12, stillOpen: [{ title, waitingOn }], note })  →  { ok, error }
 *
 * It is only a thin caller of admin_record_session_sweep(), which checks is_admin() on the server — the hook adds no
 * access: for anyone else it returns an error and writes nothing. It exists only while the admin page is mounted.
 * LOUD-FAILURE: never throws, always answers { ok, error } so the sweep can say whether it recorded. */
import { recordSessionSweep } from "./adminPanels.js";

/** Normalise whatever the sweep hands over into the RPC's shape (waiting_on, whole-number archived). */
export function normalizeSweep(input) {
  const i = input && typeof input === "object" ? input : {};
  const stillOpen = (Array.isArray(i.stillOpen) ? i.stillOpen : []).map((o) => {
    const t = o && typeof o === "object" ? o : { title: String(o ?? "") };
    return { title: String(t.title || "").slice(0, 300), waiting_on: String(t.waitingOn ?? t.waiting_on ?? "").slice(0, 300) };
  }).filter((o) => o.title);
  return { archived: Math.max(0, Math.floor(Number(i.archived)) || 0), stillOpen, note: i.note ? String(i.note).slice(0, 2000) : "" };
}

export async function recordSweepFromRun(client, input) {
  try {
    const { error } = await recordSessionSweep(client, normalizeSweep(input));
    return error ? { ok: false, error } : { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

/** Attach to `win` for as long as the admin page is mounted; returns the detach function. */
export function installSweepHook(win, client) {
  if (!win) return () => {};
  const fn = (input) => recordSweepFromRun(client, input);
  win.pfAdminRecordSweep = fn;
  return () => { if (win.pfAdminRecordSweep === fn) delete win.pfAdminRecordSweep; };
}
