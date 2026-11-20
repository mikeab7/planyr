/* NEW-1 (2026-11-02) — the scheduled e2e run states the REAL state of its sign-in step. A skipped setup is a skip, never green. */
import { describe, it, expect } from "vitest";
import { signinState, describeDoor } from "../scripts/lib/e2eSigninState.mjs";

const report = (setupStatus, extra = []) => ({
  config: { rootDir: "/w/planyr/e2e" },
  suites: [
    { title: "auth.setup.js", file: "auth.setup.js", specs: [{ title: "authenticate once", file: "auth.setup.js", line: 9, ok: setupStatus !== "unexpected", tests: [{ status: setupStatus, results: setupStatus === "skipped" ? [] : [{ status: "x" }] }] }] },
    { title: "a.spec.js", file: "a.spec.js", specs: extra.map((s, i) => ({ title: "t" + i, file: "a.spec.js", line: i + 1, ok: s === "expected", tests: [{ status: s, results: s === "skipped" ? [] : [{ status: "x" }] }] })) },
  ],
});

describe("e2e sign-in state", () => {
  it("names the door that was used", () => {
    expect(describeDoor({ key: true, password: true }).door).toBe("key");
    expect(describeDoor({ key: false, password: true }).door).toBe("password");
    expect(describeDoor({ key: false, password: false }).text).toMatch(/NO account/);
  });
  it("a passing setup is ok; the line says which door", () => {
    const s = signinState(report("expected", ["expected", "unexpected"]), { E2E_LOGIN_KEY: "k" });
    expect(s).toMatchObject({ setupStatus: "passed", verdict: "ok", door: "key", counts: { total: 3, passed: 2, failed: 1 } });
  });
  it("a SKIPPED setup is stated as skipped — never passed", () => {
    const s = signinState(report("skipped", ["expected"]), {});
    expect(s.setupStatus).toBe("skipped"); expect(s.line).toMatch(/SKIPPED/); expect(s.line).toMatch(/not a pass/);
  });
  it("a FAILED setup is its own named failure", () => {
    const s = signinState(report("unexpected", ["skipped"]), { E2E_EMAIL: "e", E2E_PASSWORD: "p" });
    expect(s).toMatchObject({ setupStatus: "failed", verdict: "fail", door: "password" });
    expect(s.line).toMatch(/SIGN-IN SETUP FAILED/);
  });
  it("a report with no setup case says so", () => {
    expect(signinState({ config: { rootDir: "/w/e2e" }, suites: [] }, {}).setupStatus).toBe("absent");
  });
});
