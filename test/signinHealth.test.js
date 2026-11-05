/* NEW-1 (2026-11-02, after B2619760) — the sign-in alarm's RULES, as pure functions: what counts as broken, when the owner
 * is told, that one incident is one email, that recovery needs proof, and that wrong passwords / blocked scripts never alarm. */
import { describe, it, expect } from "vitest";
import {
  THRESHOLDS, overallOf, summariseEvents, rateAlarm, failStreak, unknownStreak, decide, buildSnapshot, snapshotHealth, sweepLine,
  coverageGaps, isUncovered,
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

describe("coverage gaps — a step the runner cannot run is reported, never counted (owner decision 2026-11-03)", () => {
  const chk = (name, status, extra = {}) => ({ name, status, detail: "", ...extra });
  const gapRun = [chk("site-key-in-bundle", "pass"), chk("server-gate", "pass"), chk("panel-renders", "pass"), chk("real-sign-in", "unknown", { uncovered: true }), chk("email-link", "skipped")];

  it("an uncovered real-sign-in does not make the run 'unknown' — the other steps decide", () => {
    expect(overallOf(gapRun)).toBe("pass");
  });
  it("…but any OTHER unknown still does (unknown is never a pass)", () => {
    expect(overallOf([...gapRun.slice(0, 2), chk("panel-renders", "unknown"), gapRun[3]])).toBe("unknown");
  });
  it("only an unknown step can be uncovered: the flag never discounts a pass or a fail", () => {
    expect(isUncovered(chk("real-sign-in", "fail", { uncovered: true }))).toBe(false);
    expect(isUncovered(chk("real-sign-in", "pass", { uncovered: true }))).toBe(false);
    expect(overallOf([chk("server-gate", "pass"), chk("real-sign-in", "fail", { uncovered: true })])).toBe("fail");
  });
  it("if EVERY counted step is uncovered/skipped, nothing was verified: unknown, not pass", () => {
    expect(overallOf([chk("real-sign-in", "unknown", { uncovered: true }), chk("email-link", "skipped")])).toBe("unknown");
  });
  it("a real sign-in that is uncovered for MANY days never opens the blind incident or sends an email", () => {
    const history = Array(24 * 14).fill(overallOf(gapRun));                       // two weeks of hourly runs
    expect(history.every((o) => o === "pass")).toBe(true);
    expect(unknownStreak(history)).toBe(0);
    expect(decide({ history, events: ev(), incident: null, lastAlertAt: null, now: NOW })).toMatchObject({ action: "none", email: null });
  });
  it("the blind email STAYS for what it was for: a day of genuinely unknown runs still opens it", () => {
    const stuck = [chk("site-key-in-bundle", "unknown"), chk("server-gate", "unknown"), chk("panel-renders", "unknown"), chk("real-sign-in", "unknown", { uncovered: true })];
    expect(overallOf(stuck)).toBe("unknown");
    expect(decide({ history: Array(THRESHOLDS.blindStreak).fill("unknown"), events: ev(), incident: null, lastAlertAt: null, now: NOW })).toMatchObject({ action: "open", kind: "blind", email: "alert" });
  });
  it("the snapshot keeps the flag and lists the gap in plain words", () => {
    const snap = buildSnapshot({ now: NOW, latestChecks: gapRun, latestOverall: "pass", latestAt: NOW, history: ["pass"], events: ev(), incident: null });
    expect(snap.checks.find((c) => c.name === "real-sign-in")).toMatchObject({ status: "unknown", uncovered: true });
    expect(snap.gaps).toEqual([expect.objectContaining({ name: "real-sign-in", text: expect.stringMatching(/NOT covered from GitHub's runner/) })]);
    expect(coverageGaps(gapRun)).toHaveLength(1);
  });
  it("a healthy snapshot is OK and still carries the gap; the sweep line states it every time", () => {
    const snap = buildSnapshot({ now: NOW, latestChecks: gapRun, latestOverall: "pass", latestAt: NOW, history: ["pass"], events: ev({ ok: 2 }), incident: null });
    const h = snapshotHealth(snap, NOW);
    expect(h.state).toBe("ok"); expect(h.gaps).toHaveLength(1);
    expect(sweepLine(snap, NOW)).toMatch(/Coverage gap: Real sign-in through the panel is NOT covered from GitHub's runner/);
  });
  it("no gap → no 'Coverage gap' text", () => {
    const snap = buildSnapshot({ now: NOW, latestChecks: gapRun.map((c) => ({ ...c, uncovered: undefined, status: c.status === "unknown" ? "pass" : c.status })), latestOverall: "pass", latestAt: NOW, history: ["pass"], events: ev(), incident: null });
    expect(sweepLine(snap, NOW)).not.toMatch(/Coverage gap/);
  });
});

/* ── NEW-1 (2026-11-04, B2650848) — two sources of reports + the per-source dead-man's switch ─────────────────────────── */
import { SOURCES, effectiveHistory, mergeLatestChecks, evaluateStops, ageWords, staleLimitMin } from "../src/shared/auth/signinHealth.js";

describe("thresholds — chosen from the measured gaps, written down", () => {
  it("the fast check's limit is three missed 15-minute beats; the browser check's is longer than any GitHub gap measured (8.5 h)", () => {
    expect(THRESHOLDS.staleEdgeMin).toBe(45);
    expect(THRESHOLDS.staleRunnerMin).toBeGreaterThan(8.5 * 60);
    expect(staleLimitMin("edge")).toBe(45); expect(staleLimitMin("runner")).toBe(THRESHOLDS.staleRunnerMin);
    // The old single limit (150 min) would have fired on EVERY measured GitHub gap (5, 7, 7.5, 8.5 h).
    for (const gapH of [5, 7, 7.5, 8.5]) expect(gapH * 60).toBeGreaterThan(THRESHOLDS.staleMin);
  });
});

describe("effectiveHistory — each source keeps its own streak", () => {
  const row = (source, overall) => ({ source, overall });
  it("a fast-check PASS never ends the browser check's failure (the fast check does not look at the sign-in form)", () => {
    const rows = [row("edge", "pass"), row("runner", "fail"), row("edge", "pass"), row("edge", "pass"), row("runner", "fail")];
    expect(failStreak(effectiveHistory(rows))).toBe(2);
  });
  it("two fast-check failures between browser passes still alarm", () => {
    expect(failStreak(effectiveHistory([row("edge", "fail"), row("runner", "pass"), row("edge", "fail")]))).toBe(2);
  });
  it("nothing failing → just the newest overall (recovery needs a fresh pass from the source that failed)", () => {
    expect(effectiveHistory([row("edge", "pass"), row("runner", "fail")])[0]).toBe("fail");
    expect(effectiveHistory([row("runner", "pass"), row("edge", "pass")])).toEqual(["pass"]);
    expect(effectiveHistory([])).toEqual([]);
  });
  it("a single-source history reads exactly as it did before (rows default to the runner)", () => {
    const old = ["fail", "unknown", "fail", "pass"];
    expect(failStreak(effectiveHistory(old.map((o) => ({ overall: o }))))).toBe(failStreak(old));
  });
  it("an unknown in one source is stepped over, like before", () => {
    expect(failStreak(effectiveHistory([row("runner", "fail"), row("runner", "unknown"), row("runner", "fail")]))).toBe(2);
  });
});

describe("mergeLatestChecks — the newest observation of each check, across sources", () => {
  it("takes the freshest result per check and never lets a newer 'skipped' hide a real one", () => {
    const rows = [
      { source: "edge", at: "T3", checks: [{ name: "server-gate", status: "pass" }, { name: "email-link", status: "pass" }] },
      { source: "runner", at: "T2", checks: [{ name: "server-gate", status: "fail" }, { name: "panel-renders", status: "pass" }, { name: "email-link", status: "skipped" }] },
    ];
    const m = Object.fromEntries(mergeLatestChecks(rows).map((c) => [c.name, c]));
    expect(m["server-gate"]).toMatchObject({ status: "pass", source: "edge" });
    expect(m["panel-renders"]).toMatchObject({ status: "pass", source: "runner" });
    expect(m["email-link"].status).toBe("pass");
    const skipFirst = mergeLatestChecks([{ source: "runner", at: "T4", checks: [{ name: "email-link", status: "skipped" }] }, { source: "edge", at: "T3", checks: [{ name: "email-link", status: "pass" }] }]);
    expect(skipFirst[0].status).toBe("pass");
  });
});

describe("evaluateStops — a source that goes quiet is flagged ONCE", () => {
  const watch = { edge: 45, runner: 720 };
  const at = (m) => minsAgo(m);
  it("a late beat (30 min) is a normal delayed run: nothing", () => {
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(30), runner: at(60) }, state: {} })).toEqual([]);
  });
  it("past the limit → open (email); a source that never reported is NOT stopped", () => {
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(46), runner: null }, state: {} })).toEqual([expect.objectContaining({ source: "edge", action: "open" })]);
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: null, runner: null }, state: {} })).toEqual([]);
  });
  it("the measured GitHub gaps (up to 8.5 h) are not a stop; 12 h+ is", () => {
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(5), runner: at(8.5 * 60) }, state: {} })).toEqual([]);
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(5), runner: at(13 * 60) }, state: {} })).toEqual([expect.objectContaining({ source: "runner", action: "open" })]);
  });
  it("already flagged and emailed → silent while it stays stopped (one email per episode)", () => {
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(300) }, state: { edge: { since: at(200), emailed_at: at(199) } } })).toEqual([]);
  });
  it("flagged but the email never went → retry; reports again → clear (no email)", () => {
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: at(300) }, state: { edge: { since: at(200), emailed_at: null } } })[0].action).toBe("retry-alert");
    expect(evaluateStops({ now: NOW, watch, lastAt: { edge: NOW }, state: { edge: { since: at(200), emailed_at: at(199) } } })[0].action).toBe("clear");
  });
  it("ageWords speaks minutes then hours", () => { expect(ageWords(45)).toBe("45 minutes"); expect(ageWords(1)).toBe("1 minute"); expect(ageWords(8.5 * 60)).toMatch(/about (8|9) hours/); });
});

describe("snapshotHealth with two sources — each judged on its own clock", () => {
  const snap = (edgeMin, runnerMin, over = {}) => ({ lastCheckAt: minsAgo(Math.min(edgeMin ?? 1e9, runnerMin ?? 1e9)), overall: "pass", failStreak: 0, events: ev(), incident: null, checks: [], sources: { edge: { lastAt: edgeMin == null ? null : minsAgo(edgeMin) }, runner: { lastAt: runnerMin == null ? null : minsAgo(runnerMin) } }, ...over });
  it("both fresh enough → ok (the browser check at 6 h is normal here)", () => { expect(snapshotHealth(snap(5, 6 * 60), NOW).state).toBe("ok"); });
  it("the fast check silent 46 min → STOPPED, naming it, even though the browser check just ran", () => {
    const h = snapshotHealth(snap(46, 2), NOW);
    expect(h.state).toBe("stale"); expect(h.line).toMatch(/fast sign-in check/); expect(h.line).toMatch(/stopped/);
  });
  it("the browser check silent 13 h → STOPPED, naming it", () => {
    const h = snapshotHealth(snap(5, 13 * 60), NOW);
    expect(h.state).toBe("stale"); expect(h.line).toMatch(/browser sign-in check/);
  });
  it("a source that has never reported is not 'stopped' (not armed yet)", () => { expect(snapshotHealth(snap(5, null), NOW).state).toBe("ok"); });
  it("a snapshot written before 2026-11-04 (no `sources`) keeps the old single 150-minute rule", () => {
    expect(snapshotHealth({ lastCheckAt: minsAgo(THRESHOLDS.staleMin + 1), overall: "pass", failStreak: 0, events: ev(), incident: null }, NOW).state).toBe("stale");
  });
  it("buildSnapshot records the sources and the open stops", () => {
    const s = buildSnapshot({ now: NOW, latestChecks: [], latestOverall: "pass", latestAt: NOW, history: ["pass"], events: ev(), incident: null, sources: { edge: { lastAt: NOW }, runner: { lastAt: null } }, stops: [{ source: "runner", since: NOW, emailedAt: null }] });
    expect(s.sources.edge.lastAt).toBe(NOW); expect(s.stops).toHaveLength(1);
  });
  it("SOURCES names exactly the two", () => { expect([...SOURCES]).toEqual(["edge", "runner"]); });
});
