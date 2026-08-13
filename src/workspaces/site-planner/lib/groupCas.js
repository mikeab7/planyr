/* B1341 STAGE 2 — THE KILL SWITCH, and why stage 2 ships with it OFF.
 *
 * Stage 2's own definition (on B1341) is "group CAS **behind a flag**… with the per-row path
 * untouched underneath". That is not timidity, it is what makes the stage shippable on its own: the
 * server overload is additive and inert, the client path is inert, and turning it on is a separate,
 * reversible act with its own live verification. A stage that could only be landed by switching
 * every writer over at once would be stage 3 wearing stage 2's name.
 *
 * ⛔ AND THE HONEST CONSEQUENCE, stated rather than glossed: WHILE THIS IS OFF, NOTHING IN
 * PRODUCTION EXERCISES THE GROUP CHECK. The server half is proven against a real Postgres by
 * `db/test/commit_elements_group_cas.test.sql` (which drives the rejection path and is
 * mutation-proven), and the client half by `test/assemblyGroupCas.test.js` — but neither is a live
 * two-writer race. Turning the switch on is stage 2's live-verify, not a formality.
 *
 * HOW TO TURN IT ON:
 *   • build-time — `VITE_GROUP_CAS=1`
 *   • at runtime, per device — `localStorage.setItem("planarfit:groupCas", "1")` and reload
 * Either is enough; the runtime one wins so a device can be switched without a deploy, which is
 * what makes the FIRST live test cheap and the rollback instant.
 *
 * Deliberately NOT a user-facing setting and not a per-plan value: it is a rollout control for one
 * migration, not a preference, and it will be deleted at stage 3 when the group path becomes the
 * only path.
 */
export const GROUP_CAS_KEY = "planarfit:groupCas";

const envFlag = () => {
  try { return String(import.meta.env?.VITE_GROUP_CAS || "") === "1"; } catch (_) { return false; }
};

/* Is group CAS armed on this device? Read at CALL time, never snapshotted — a snapshot taken at
 * module load cannot be turned off without a reload, and a kill switch you have to reload to use
 * is not a kill switch. (Same lesson as B377891's `selfUid`.) */
export function groupCasEnabled() {
  try {
    const v = globalThis.localStorage?.getItem(GROUP_CAS_KEY);
    if (v === "1" || v === "true") return true;
    if (v === "0" || v === "false") return false;   // an explicit OFF beats the build flag
  } catch (_) { /* no storage (SSR, privacy mode) → fall through to the build flag */ }
  return envFlag();
}
