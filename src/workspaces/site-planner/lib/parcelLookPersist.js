/* Persisting the workspace parcel-look default (NEW-2) — the account write behind a debounced burst of edits.
 *
 * The edits are ALREADY on screen (applied to the on-device mirror on every input event). This writes the burst to
 * the account in one fresh read-modify-write, and decides what a failure means — never a silent "saved":
 *   · ok                → nothing to say
 *   · "not signed in"   → the mirror IS the store; keep the value and say it lives on this computer only
 *   · any other failure → REVERT every field the batch covered to what it was before the burst, and say so
 * Pure over its collaborators (injected) so the failure paths are unit-tested rather than hoped for.
 */
export async function persistLookBatch({ batch, prev, uid, updateUserPrefs, applyPrefsLocal, setParcelLookPref, warn }) {
  const edits = new Map(batch.map((e) => [`${e.section}.${e.field}`, e])); // last write per field wins
  const res = await updateUserPrefs(uid, (p) => [...edits.values()].reduce((acc, e) => setParcelLookPref(acc, e.section, e.field, e.value), p));
  if (res.ok) return { ok: true };
  if (res.error === "not signed in") {
    warn("⚠ Style saved on this computer only — sign in to keep it on your account.", 7000);
    return { ok: false, localOnly: true };
  }
  applyPrefsLocal((p) => [...edits.keys()].reduce((acc, k) => {
    const [section, field] = k.split(".");
    const before = prev.get(k);
    return setParcelLookPref(acc, section, field, before === undefined ? null : before);
  }, p));
  warn(`⚠ Couldn't save your style — it was put back (${res.error}).`, 8000);
  return { ok: false, reverted: true };
}
