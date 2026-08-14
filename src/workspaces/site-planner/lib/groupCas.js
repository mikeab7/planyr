/* B1341 STAGE 2 — THE KILL SWITCH. It shipped OFF, and it is now ON by default (NEW-1, 2026-08-13).
 *
 * Stage 2's own definition (on B1341) is "group CAS **behind a flag**… with the per-row path
 * untouched underneath". That is not timidity, it is what makes the stage shippable on its own: the
 * server overload is additive and inert, the client path is inert, and turning it on is a separate,
 * reversible act with its own live verification. A stage that could only be landed by switching
 * every writer over at once would be stage 3 wearing stage 2's name.
 *
 * ⛔ THE CONSEQUENCE THAT USED TO BE STATED HERE — "while this is off, NOTHING in production
 * exercises the group check" — was true and is now spent: it is on. What replaced the honesty it
 * was protecting is the ordinary-hour driver described below, which exercises the check where the
 * code actually is rather than hoping a live race turns up.
 *
 * HOW TO TURN IT OFF:
 *   • at runtime, per device — `localStorage.setItem("planarfit:groupCas", "0")` and reload
 *   • build-time, for everyone — `VITE_GROUP_CAS=0`
 * The runtime one WINS in both directions, so a single device can be switched without a deploy —
 * which is what makes a rollback instant and a re-test cheap.
 *
 * Deliberately NOT a user-facing setting and not a per-plan value: it is a rollout control for one
 * migration, not a preference, and it will be deleted at stage 3 when the group path becomes the
 * only path.
 */
export const GROUP_CAS_KEY = "planarfit:groupCas";

/* ⛔ ON BY DEFAULT SINCE 2026-08-13 (NEW-1). READ THIS BEFORE CHANGING THE DEFAULT BACK.
 *
 * ⛔ THE ONE-LINE UNDO, WRITTEN OUT SO NOBODY HAS TO GO FIND IT:
 *     ONE DEVICE, no deploy, effective immediately —
 *         localStorage.setItem("planarfit:groupCas", "0")     …then reload
 *     EVERYONE — set `VITE_GROUP_CAS=0` in the Cloudflare Pages build environment and redeploy.
 *     THE DATABASE needs no rollback: the 4-arg overload is inert for a client that stops sending
 *     `p_groups` (it delegates to the 3-arg form). The drop statements are at the bottom of
 *     `db/commit_elements_group_cas.sql` if it is ever genuinely being removed.
 *
 * The flag did not flip on a decision that it "looked ready". It flipped after an ordinary hour of
 * editing was driven through the real write engine with the check forced on
 * (`ui-audit/session-group-cas.mjs`) — and the FIRST such hour found two defects, the second found
 * a third, and all three were the same shape: a refusal no retry could clear, i.e. a save silently
 * lost. They are named on B484336 (ordering), B447472 (membership by kind) and the three engine
 * fixes around `groupsFor`. The run that justified the flip: 20 seeded hours, 8,042 commits, 3,880
 * group bets, 312 refusals — every one caused by a real concurrent edit and every one converged —
 * **0 spurious, 0 stuck, 0 lost**, with the driver mutation-proven to go red on each defect.
 *
 * So: if this is ever turned back off, say WHY on the item, and re-run that driver before turning
 * it on again. "It seemed fine" is what this flag exists to make unnecessary. */
const envFlag = () => {
  try {
    // Absence means ON. `VITE_GROUP_CAS=0` in the build env is the global off switch.
    return String(import.meta.env?.VITE_GROUP_CAS ?? "1") !== "0";
  } catch (_) { return true; }
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
