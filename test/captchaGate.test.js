/* The captcha submit gate (NEW-1) — pure state machine, timers injected. These are the behaviours the
 * owner's phone bug and brief depend on; the panel only renders what the gate says. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCaptchaGate, DEFAULT_WAIT_MS } from "../src/shared/turnstile/captchaGate.js";

function rig(runImpl) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const log = { runs: [], resets: 0, remounts: 0, changes: 0 };
  const gate = createCaptchaGate({
    run: async (t) => { log.runs.push(t); return runImpl ? runImpl(t, log.runs.length) : undefined; },
    reset: () => { log.resets++; },
    remount: () => { log.remounts++; },
    onChange: () => { log.changes++; },
  });
  return { gate, log };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("captchaGate", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends at once when the token is already in hand, then spends it and resets the widget", async () => {
    const { gate, log } = rig();
    gate.setToken("tok1");
    expect(gate.submit()).toBe("sent");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["tok1"]);
    expect(log.resets).toBe(1);
    expect(gate.view().hasToken).toBe(false);
  });

  it("SUBMIT BEFORE TOKEN: goes pending (never blocked, never failed) and sends by itself when the token lands", async () => {
    const { gate, log } = rig();
    expect(gate.submit()).toBe("pending");
    expect(gate.view().pending).toBe(true);
    expect(log.runs).toEqual([]);
    gate.setToken("late");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["late"]);
    expect(gate.view().pending).toBe(false);
  });

  it("a second press (tap or Enter) while pending or in flight sends nothing more", async () => {
    let release; const hold = new Promise((r) => { release = r; });
    const { gate, log } = rig(() => hold);
    expect(gate.submit()).toBe("pending");
    expect(gate.submit()).toBe("ignored");           // Enter while Verifying…
    gate.setToken("t");
    expect(gate.view().inflight).toBe(true);
    expect(gate.submit()).toBe("ignored");           // tap while the request is out
    gate.setToken("t2");                             // a stray extra token changes nothing
    release(); await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["t"]);
  });

  it("WRONG PASSWORD THEN RIGHT PASSWORD: the spent token is never reused; the retry waits for the fresh one", async () => {
    const outcomes = [{ error: "Invalid login credentials" }, { error: null }];
    const seen = [];
    const { gate, log } = rig((t, n) => { seen.push({ t, ...outcomes[n - 1] }); });
    gate.setToken("tokA");
    gate.submit();                                   // typo
    await vi.runAllTimersAsync();
    expect(log.resets).toBe(1);                      // burnt token → widget asked for a new one
    expect(gate.view().hasToken).toBe(false);
    // the person fixes the password and taps before Cloudflare has answered again
    expect(gate.submit()).toBe("pending");
    expect(log.runs).toEqual(["tokA"]);              // tokA was NOT resent
    gate.setToken("tokB");                           // the reset widget's fresh token
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["tokA", "tokB"]);
    expect(log.resets).toBe(2);
  });

  it("resets the widget after a FAILED attempt too (run throws), and stays usable", async () => {
    const { gate, log } = rig((t, n) => { if (n === 1) throw new Error("boom"); });
    gate.setToken("a");
    gate.submit();
    await vi.runAllTimersAsync();
    expect(log.resets).toBe(1);
    expect(gate.view().inflight).toBe(false);
    gate.setToken("b");
    expect(gate.submit()).toBe("sent");
  });

  it("an expired token while the panel sits open: a press waits for the refreshed one", async () => {
    const { gate, log } = rig();
    gate.setToken("old");
    gate.setToken("");                               // expired-callback
    expect(gate.submit()).toBe("pending");
    gate.setToken("fresh");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["fresh"]);
  });

  it("NEVER AN ENDLESS 'Verifying…': after the wait it stops, says timeout, and Try again re-renders the widget", async () => {
    const { gate, log } = rig();
    gate.submit();
    vi.advanceTimersByTime(DEFAULT_WAIT_MS + 1);
    expect(gate.view().pending).toBe(false);
    expect(gate.view().failure).toBe("timeout");
    expect(log.runs).toEqual([]);
    gate.retry();
    expect(log.remounts).toBe(1);
    expect(gate.view().failure).toBe(null);
  });

  it("a visible challenge stops the clock (the person is working); Cloudflare's own timeout ends it", () => {
    const { gate } = rig();
    gate.setWidgetState("interactive");
    gate.submit();
    vi.advanceTimersByTime(DEFAULT_WAIT_MS * 4);
    expect(gate.view().pending).toBe(true);
    expect(gate.view().failure).toBe(null);
    gate.widgetTimedOut();
    expect(gate.view().pending).toBe(false);
    expect(gate.view().failure).toBe("timeout");
  });

  it("a challenge shown AFTER the press also stops the clock", () => {
    const { gate } = rig();
    gate.submit();
    vi.advanceTimersByTime(DEFAULT_WAIT_MS - 1000);
    gate.setWidgetState("interactive");
    vi.advanceTimersByTime(DEFAULT_WAIT_MS * 2);
    expect(gate.view().pending).toBe(true);
  });

  it("a blocked / failed widget: pending ends immediately with 'error'; pressing again fails fast, not forever", () => {
    const { gate, log } = rig();
    gate.submit();
    gate.setWidgetState("error");
    expect(gate.view().pending).toBe(false);
    expect(gate.view().failure).toBe("error");
    expect(gate.submit()).toBe("failed");
    expect(log.runs).toEqual([]);
  });

  it("Turnstile's own auto-retry recovering from an error clears the failure and unblocks sending", async () => {
    const { gate, log } = rig();
    gate.setWidgetState("error");
    gate.submit();
    gate.setToken("recovered");
    expect(gate.view().failure).toBe(null);
    expect(gate.submit()).toBe("sent");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["recovered"]);
  });

  it("a mode switch drops a waiting submit but KEEPS the live token", async () => {
    const { gate, log } = rig();
    gate.submit();                                   // pending on Sign in
    gate.cancelPending();                            // → Forgot password
    expect(gate.view().pending).toBe(false);
    gate.setToken("tok");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual([]);                    // the abandoned submit never fires
    expect(gate.submit()).toBe("sent");              // the token survived the switch
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual(["tok"]);
  });

  it("with no captcha configured it sends at once with no token and never touches the widget", async () => {
    const { gate, log } = rig();
    expect(gate.submit({ needsToken: false })).toBe("sent");
    await vi.runAllTimersAsync();
    expect(log.runs).toEqual([""]);
    expect(log.resets).toBe(0);
  });
});
