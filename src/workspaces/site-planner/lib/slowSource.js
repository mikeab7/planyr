/* NEW-1 (B2424384, 2026-10-22) — ONE rule for a parcel source that is SLOW, shared by every lookup a person is waiting on (the Site search's
 * parcel-ID path and the lot click's retry round), so no source gets a private timeout story.
 *
 * Measured on the Tennessee Comptroller layer and the county layers it sits beside (2026-10-22): a warm answer is ~50 ms, a cold one 0.5–1 s, and
 * the first ask after a quiet spell has taken 27 s (Williamson), 44 s and a 504 at 59 s (Hamilton). The app used to give up at 8 s and ask once
 * more at 8 s, so a source that needed 15–25 s lost twice and the person was told it could not be checked, with nothing to press.
 *
 * The rule: wait longer than a healthy server needs (`ASK_BUDGETS_MS`), ask again on a timeout or transient failure, and only then give up with a
 * typed failure the caller words as "didn't answer" — never as "not found". Pure but for the injected `sleep` / `setTimer`. */

/** Per-attempt time a SEARCH the person is watching will wait: a generous first ask, a longer second. Worst case ≈ 45 s of visible "looking". */
export const ASK_BUDGETS_MS = [20000, 25000];
/** The click's quick first round keeps the app's 8 s (a dead host must not stall it); the retry round waits this long. */
export const CLICK_RETRY_BUDGET_MS = 25000;
/** How long a lookup runs before the person is told it is still going (and that the server is slow). */
export const SLOW_HINT_MS = 4000;
/** Gap between attempts. */
export const RETRY_GAP_MS = 400;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Ask `run({ timeoutMs, attempt })` once per budget until it answers. ANY thrown error is retried (a config error throws instantly and costs nothing);
 *  when every attempt failed the LAST error is rethrown, so the caller still sees the typed `ParcelFetchError` (kind: timeout | http | arcgis | network). */
export async function askUntilAnswered(run, { budgets = ASK_BUDGETS_MS, retryMs = RETRY_GAP_MS, sleep = realSleep } = {}) {
  let last = null;
  for (let attempt = 0; attempt < budgets.length; attempt++) {
    try {
      return await run({ timeoutMs: budgets[attempt], attempt });
    } catch (e) {
      last = e;
      if (attempt < budgets.length - 1) await sleep(retryMs);
    }
  }
  throw last;
}

/** Start a one-shot "still looking" timer; call the returned function to stop it (idempotent). `onSlow` is never called once stopped. */
export function watchSlow(onSlow, { afterMs = SLOW_HINT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  if (typeof onSlow !== "function") return () => {};
  let t = setTimer(() => { t = null; onSlow(); }, afterMs);
  return () => { if (t != null) { clearTimer(t); t = null; } };
}

/** The sentence shown while a lookup is taking long. `who` is the source's display name ("Tennessee statewide", "Perry County"). */
export function stillLookingMessage(who) {
  return `Still looking — the ${who || "county"} parcel server is slow to answer.`;
}
