/* The captcha submit gate (NEW-1, amends B1160720) — ONE small state machine that decides when a
 * form that needs a Turnstile token may actually send, for Sign in, Sign up and Forgot password alike.
 *
 * Pure and dependency-free (timers injected) so the rules below are unit-tested in Node:
 *   - a submit with a token in hand sends at once;
 *   - a submit with NO token yet does not fail and is not blocked: it goes PENDING ("Verifying…")
 *     and sends by itself the moment the token arrives (iPhone Keychain / password managers fill the
 *     fields and the person taps straight away, before Cloudflare has answered);
 *   - a second press (button or Enter) while pending or in flight is ignored — never a double submit;
 *   - a token is SINGLE USE and a wrong password burns it, so after EVERY attempt, pass or fail, the
 *     token is dropped and the widget is reset (`reset()`); the next attempt waits for a fresh one;
 *   - never a dead end: if the check never returns (`waitMs`), or the widget reports an error, the gate
 *     enters a `failure` ("timeout" | "error") with a working `retry()`; it never waits forever.
 *     While a visible challenge is on screen (`interactive`) the person is doing the work, so the
 *     timer does not run — Cloudflare's own `timeout-callback` ends that case.
 *
 * `run(token)` is the form's own submit (it reads the latest field values itself) and resolves when
 * the attempt is over. `onChange()` tells the host to re-render. */

export const DEFAULT_WAIT_MS = 15000;

export function createCaptchaGate({ run, reset = () => {}, remount = () => {}, onChange = () => {}, onError = (e) => console.error("[captchaGate] submit threw", e), waitMs = DEFAULT_WAIT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let token = "";
  let widget = "loading";       // loading | ready | interactive | error
  let pending = false;          // a submit is waiting for a token
  let inflight = false;         // run() is executing
  let failure = null;           // null | "timeout" | "error"
  let timer = null;
  let destroyed = false;
  let needsToken = true;

  const emit = () => { if (!destroyed) onChange(); };
  const stopTimer = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const startTimer = () => {
    stopTimer();
    if (widget === "interactive") return;      // a visible challenge: the person is working on it
    timer = setTimer(() => {
      timer = null;
      if (!pending) return;
      pending = false; failure = "timeout";
      emit();
    }, waitMs);
  };

  async function fire() {
    const t = token;
    token = ""; pending = false; inflight = true; failure = null;
    stopTimer(); emit();
    try { await run(t); }
    catch (e) { try { onError(e); } catch (_) {} }   // loud, but never an unhandled rejection that wedges the gate
    finally {
      // Single-use token: pass or fail, it is spent. A fresh one comes from the reset widget.
      inflight = false;
      if (needsToken) { try { reset(); } catch (_) {} }
      emit();
    }
  }

  return {
    /** The host calls this for every press of the submit button / Enter. */
    submit({ needsToken: need = true } = {}) {
      if (destroyed || inflight || pending) return "ignored";
      needsToken = need;
      if (!need) { fire(); return "sent"; }
      if (token) { fire(); return "sent"; }
      if (widget === "error") { failure = "error"; emit(); return "failed"; }
      pending = true; failure = null; startTimer(); emit();
      return "pending";
    },
    /** Widget callback: a token arrived ("" = it was cleared / expired). */
    setToken(t) {
      token = t || "";
      if (token) {
        if (widget === "error" || widget === "loading") widget = "ready";
        failure = null;                           // a late / auto-retried token recovers any failure
        if (pending && !inflight) { fire(); return; }
      }
      emit();
    },
    /** Widget callback: loading | ready | interactive | error. */
    setWidgetState(s) {
      widget = s;
      if (s === "error") {
        token = "";
        if (pending) { pending = false; stopTimer(); failure = "error"; }
      } else if (s === "interactive") stopTimer();       // challenge visible: no clock
      else if (s === "ready" && pending) startTimer();
      emit();
    },
    /** Cloudflare's own interactive-challenge timeout. */
    widgetTimedOut() {
      token = "";
      if (pending) { pending = false; stopTimer(); failure = "timeout"; }
      emit();
    },
    /** A mode switch: drop a waiting submit and any shown failure, KEEP the token (the widget is still
     * the same live one and will not call back again). Never touches inflight. */
    cancelPending() {
      pending = false; failure = null; stopTimer();
      emit();
    },
    /** Panel close / unmount: drop everything, including the token. Never touches inflight. */
    cancel() {
      pending = false; failure = null; token = ""; stopTimer();
      emit();
    },
    /** "Try again" after a failure: clear it and re-render the widget from scratch. */
    retry() {
      pending = false; failure = null; token = ""; widget = "loading"; stopTimer();
      try { remount(); } catch (_) {}
      emit();
    },
    destroy() { destroyed = true; stopTimer(); },
    view() { return { token, widget, pending, inflight, failure, hasToken: !!token }; },
  };
}
