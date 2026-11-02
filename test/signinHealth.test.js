/* NEW-1 (2026-11-02, after B2619760) — the sign-in alarm's RULES, as pure functions: what counts as broken, when the owner
 * is told, that one incident is one email, that recovery needs proof, and that wrong passwords / blocked scripts never alarm. */
import { describe, it, expect } from "vitest";
import {
  THRESHOLDS, overallOf, summariseEvents, rateAlarm, failStreak, unknownStreak, decide, buildSnapshot, snapshotHealth, sweepLine,
} from "../src/shared/auth/signinHealth.js";

const NOW = "2026-11-02T12:00:00.000Z";
const minsAgo = (m) => new Date(Date.parse(NOW) - m * 60000).toISOString();
const ev = (o = {}) => summariseEvents(Object.entries(o).map(([k, n]) => ({ source: "event:auth-" + k, n })));

describe("overallOf — unknown is never a pass", () => {
  const c = (...s) => s.map((status, i) => ({ name: "c" + i, status }));
  it("all pass → pass; skipped is nothing", () => { expect(overallOf(c("pass", "pass", "skipped"))).toBe("pass"); });
  it("any fail → fail, even beside an unknown", () => { expect(overallOf(c("pass", "unknown", "fail"))).toBe("fail"); });
  it("an unknown with no fail → unknown (NEVER pass)", () => { expect(overallOf(c("pass", "unknown"))).toBe("unknown"); });
  it("nothing ran → unknown, not pass", () => { expect(overallOf([])).toBe("unknown"); expect(overallOf(c("skipped"))).toBe("unknown"); });
});

describe("streaks", () => {
  it("fail streak counts fails, steps over unknown, stops at pass", () => {
    expect(failStreak(["fail", "fail", "pass", "fail"])).toBe(2);
    expect(failStreak(["fail", "unknown", "fail", "pass"])).toBe(2);
    expect(failStreak(["pass", "fail", "fail"])).toBe(0);
  });
  it("unknown streak stops at anything else", () => {
    expect(unknownStreak(["unknown", "unknown", "fail"])).toBe(2);
    expect(unknownStreak(["pass", "unknown"])).toBe(0);
  });
});

describe("the client-rate rule — only server captcha refusals can alarm", () => {
  it("fires at the floor when refusals outnumber successes", () => {
    expect(rateAlarm(ev({ "captcha-refused": 3, ok: 0 })).fire).toBe(true);
    expect(rateAlarm(ev({ "captcha-refused": 3, ok: 2 })).fire).toBe(true);
  });
  it("does not fire below the floor or when sign-ins are getting through", () => {
    expect(rateAlarm(ev({ "captcha-refused": 2, ok: 0 })).fire).toBe(false);
    expect(rateAlarm(ev({ "captcha-refused": 3, ok: 3 })).fire).toBe(false);
    expect(rateAlarm(ev({ "captcha-refused": 5, ok: 9 })).fire).toBe(false);
  });
  it("wrong passwords, blocked scripts, widget errors, timeouts and network failures NEVER alarm, however many", () => {
    const loud = ev({ "wrong-password": 500, "captcha-blocked": 500, "captcha-widget-error": 500, "captcha-timeout": 500, network: 500, "user-error": 500, unexpected: 500 });
    expect(rateAlarm(loud).fire).toBe(false);
    expect(decide({ history: ["pass"], events: loud, incident: null, lastAlertAt: null, now: NOW }).action).toBe("none");
  });
  it("unknown sources are ignored, not counted", () => {
    expect(summariseEvents([{ source: "event:other", n: 9 }, { source: "event:auth-captcha-refused", n: "2" }]).refused).toBe(2);
  });
});

describe("decide — one incident, one email", () => {
  const base = { events: ev(), lastAlertAt: null, now: NOW };
  it("one failed run does NOT alert (a blip); two in a row opens an incident and emails once", () => {
    expect(decide({ ...base, history: ["fail", "pass"], incident: null }).action).toBe("none");
    const d = decide({ ...base, history: ["fail", "fail", "pass"], incident: null });
    expect(d).toMatchObject({ action: "open", kind: "outside-in", email: "alert" });
  });
  it("while the incident stays open and failing, NO further email", () => {
    const d = decide({ ...base, history: ["fail", "fail", "fail", "fail"], incident: { kind: "outside-in", alert_emailed_at: minsAgo(10) } });
    expect(d).toMatchObject({ action: "none", email: null });
  });
  it("an alert that never got out (mail down) is retried on the next report", () => {
    const d = decide({ ...base, history: ["fail", "fail", "fail"], incident: { kind: "outside-in", alert_emailed_at: null } });
    expect(d).toMatchObject({ action: "retry-alert", email: "alert" });
  });
  it("recovery needs a PASS — silence or unknown does not close it", () => {
    const open = { kind: "outside-in", alert_emailed_at: minsAgo(30) };
    expect(decide({ ...base, history: ["unknown", "fail", "fail"], incident: open }).action).toBe("none");
    expect(decide({ ...base, history: ["pass", "fail", "fail"], incident: open })).toMatchObject({ action: "close", email: "recovery" });
  });
  it("closing an incident whose alert never went out sends no recovery note", () => {
    expect(decide({ ...base, history: ["pass", "fail", "fail"], incident: { kind: "outside-in", alert_emailed_at: null } })).toMatchObject({ action: "close", email: null });
  });
  it("a fresh incident inside the cooldown opens but does not email again", () => {
    const d = decide({ ...base, history: ["fail", "fail"], incident: null, lastAlertAt: minsAgo(20) });
    expect(d).toMatchObject({ action: "open", email: null, suppressed: "cooldown" });
  });
  it("browsers being refused alarms on its own (outside check blind or passing)", () => {
    const d = decide({ ...base, history: ["pass"], events: ev({ "captcha-refused": 4, ok: 1 }), incident: null });
    expect(d).toMatchObject({ action: "open", kind: "client-rate", email: "alert" });
  });
  it("a client-rate incident clears once refusals fall and a run passes", () => {
    const open = { kind: "client-rate", alert_emailed_at: minsAgo(70) };
    expect(decide({ ...base, history: ["pass"], events: ev({ "captcha-refused": 4, ok: 0 }), incident: open }).action).toBe("none");
    expect(decide({ ...base, history: ["pass"], events: ev({ ok: 4 }), incident: open })).toMatchObject({ action: "close", email: "recovery" });
  });
  it("a day of unknown opens ONE 'blind' incident; a non-unknown run clears it", () => {
    const hist = Array(THRESHOLDS.blindStreak).fill("unknown");
    expect(decide({ ...base, history: hist, incident: null })).toMatchObject({ action: "open", kind: "blind", email: "alert" });
    expect(decide({ ...base, history: hist, incident: { kind: "blind", alert_emailed_at: minsAgo(5) } }).email).toBe(null);
    expect(decide({ ...base, history: ["pass", ...hist], incident: { kind: "blind", alert_emailed_at: minsAgo(5) } })).toMatchObject({ action: "close", email: "recovery" });
  });
  it("fewer unknowns than a day is not an alert (Cloudflare refusing a datacenter is a sweep count, not an email)", () => {
    expect(decide({ ...base, history: Array(THRESHOLDS.blindStreak - 1).fill("unknown"), incident: null }).action).toBe("none");
  });
});

describe("snapshotHealth — read-time state (the dead-man's switch)", () => {
  const snap = (over = {}) => ({ lastCheckAt: minsAgo(20), overall: "pass", failStreak: 0, events: ev({ ok: 3, "wrong-password": 1 }), incident: null, ...over });
  it("fresh + pass → ok", () => { expect(snapshotHealth(snap(), NOW).state).toBe("ok"); });
  it("no report in 2.5 h → STALE, whatever the last result said", () => {
    expect(snapshotHealth(snap({ lastCheckAt: minsAgo(THRESHOLDS.staleMin + 1) }), NOW).state).toBe("stale");
    expect(snapshotHealth(snap({ lastCheckAt: minsAgo(THRESHOLDS.staleMin + 1), overall: "pass" }), NOW).line).toMatch(/stopped/);
  });
  it("never reported → none, in words that say the check is not running", () => {
    const h = snapshotHealth(null, NOW); expect(h.state).toBe("none"); expect(h.line).toMatch(/not running/);
  });
  it("an open incident reads broken, and says whether the email went", () => {
    expect(snapshotHealth(snap({ incident: { kind: "outside-in", emailedAt: minsAgo(5) } }), NOW).line).toMatch(/you were emailed/);
    expect(snapshotHealth(snap({ incident: { kind: "outside-in", emailedAt: null } }), NOW).line).toMatch(/NOT gone out/);
  });
  it("unknown reads blind, never ok", () => { expect(snapshotHealth(snap({ overall: "unknown" }), NOW).state).toBe("blind"); });
  it("the sweep line carries the browser counts", () => { expect(sweepLine(snap(), NOW)).toMatch(/3 signed in, 1 wrong passwords/); });
  it("buildSnapshot keeps detail short and records the thresholds it used", () => {
    const s = buildSnapshot({ now: NOW, latestChecks: [{ name: "a", status: "pass", detail: "x".repeat(900) }], latestOverall: "pass", latestAt: NOW, history: ["pass"], events: ev(), incident: null });
    expect(s.checks[0].detail.length).toBe(200); expect(s.thresholds).toEqual(THRESHOLDS);
  });
});
