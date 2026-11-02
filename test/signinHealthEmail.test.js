/* NEW-1 (2026-11-02) — the sign-in alarm's EMAIL: plain words, one-email promise, a drill that cannot be mistaken for the real thing. */
import { describe, it, expect } from "vitest";
import { summariseEvents } from "../src/shared/auth/signinHealth.js";
import { ALARM_TO, buildAlertEmail, buildRecoveryEmail } from "../functions/api/lib/signinHealthEmail.js";

const NOW = "2026-11-02T12:00:00.000Z";
const ev = (o = {}) => summariseEvents(Object.entries(o).map(([k, n]) => ({ source: "event:auth-" + k, n })));

describe("email copy", () => {
  it("goes to the owner, says what failed in plain words, promises one email + one all-clear", () => {
    expect(ALARM_TO).toBe("michael@planyr.io");
    const m = buildAlertEmail({ kind: "outside-in", reason: "The hourly outside check failed 2 times in a row.", since: NOW, checks: [{ name: "server-gate", status: "fail", detail: "no site key" }], events: ev({ ok: 1 }), runUrl: "https://github.com/x/y/actions/runs/1" });
    expect(m.subject).toBe("Planyr alarm: Sign-in looks broken from the outside");
    expect(m.text).toMatch(/Supabase's bot check answers the way the site expects — FAILED: no site key/);
    expect(m.text).toMatch(/exactly one email for this problem/);
    expect(m.html).not.toMatch(/<script/i);
  });
  it("a test drill is unmistakably labelled", () => {
    expect(buildAlertEmail({ kind: "outside-in", synthetic: true, checks: [] }).subject).toMatch(/^\[TEST\]/);
    expect(buildAlertEmail({ kind: "outside-in", synthetic: true, checks: [] }).text).toMatch(/THIS IS A TEST/);
    expect(buildRecoveryEmail({ kind: "outside-in", synthetic: true }).subject).toMatch(/^\[TEST\] Planyr alarm cleared/);
  });
  it("escapes anything that came from a check's detail", () => {
    const m = buildAlertEmail({ kind: "outside-in", checks: [{ name: "x", status: "fail", detail: "<img src=x onerror=1>" }] });
    expect(m.html).not.toContain("<img"); expect(m.html).toContain("&lt;img");
  });
});
