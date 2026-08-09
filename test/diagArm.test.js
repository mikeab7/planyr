/* ⛔ B280403 — an instrument built to answer "why did it fail on HIS machine" has to be armable on
 * his machine. `window.__plannerHitWhy` was gated on a flag read AT MOUNT, so the one place the
 * defect lived was the one place the instrument could not be switched on; the session that needed it
 * armed the flag by hand and forced a remount by switching plans and back. That is folklore, not a
 * feature — it requires knowing the hook's dependency array. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDiagArmed, latchDiagArm, DIAG_KEY, DIAG_PARAM } from "../src/workspaces/site-planner/lib/diagArm.js";

const win = (over = {}) => ({ location: { search: "", hash: "" }, ...over });
const store = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
};

describe("arming the read-only diagnostic surface", () => {
  it("is OFF by default — production is not a debug build", () => {
    expect(isDiagArmed(win({ sessionStorage: store() }))).toBe(false);
  });

  it("the existing harness flag still arms it, so no harness changes", () => {
    expect(isDiagArmed(win({ __PLANYR_E2E: true }))).toBe(true);
    expect(isDiagArmed(win({ __PLANYR_E2E: "yes" })), "only a real true — not any truthy value").toBe(false);
  });

  it(`a URL arms a tab with no console at all (?${DIAG_PARAM}=1)`, () => {
    expect(isDiagArmed(win({ location: { search: `?${DIAG_PARAM}=1`, hash: "" } }))).toBe(true);
    expect(isDiagArmed(win({ location: { search: `?foo=1&${DIAG_PARAM}=1`, hash: "" } }))).toBe(true);
    expect(isDiagArmed(win({ location: { search: "", hash: `#/plan?${DIAG_PARAM}=1` } })), "the planner navigates by hash").toBe(true);
  });

  it("a near-miss does not arm it", () => {
    for (const search of [`?${DIAG_PARAM}=0`, `?${DIAG_PARAM}`, `?x${DIAG_PARAM}=1`, `?${DIAG_PARAM}=11`])
      expect(isDiagArmed(win({ location: { search, hash: "" } })), search).toBe(false);
  });

  it("the session key arms it, and it is SESSION-scoped so it cannot leak into a later visit", () => {
    expect(isDiagArmed(win({ sessionStorage: store({ [DIAG_KEY]: "1" }) }))).toBe(true);
    expect(isDiagArmed(win({ sessionStorage: store({ [DIAG_KEY]: "0" }) }))).toBe(false);
  });

  it("a URL-armed tab LATCHES, so an in-app plan switch does not disarm it mid-diagnosis", () => {
    const ss = store();
    const w = win({ sessionStorage: ss, location: { search: `?${DIAG_PARAM}=1`, hash: "" } });
    expect(latchDiagArm(w)).toBe(true);
    expect(ss._m[DIAG_KEY]).toBe("1");
    // …and the latch survives the parameter going away
    expect(isDiagArmed(win({ sessionStorage: ss }))).toBe(true);
  });

  it("latching an UNARMED tab writes nothing — it never arms by being asked", () => {
    const ss = store();
    expect(latchDiagArm(win({ sessionStorage: ss }))).toBe(false);
    expect(ss._m[DIAG_KEY]).toBeUndefined();
  });

  /* Storage throws outright in some privacy modes, and a location can be absent. An instrument that
   * crashes the app it is meant to observe is worse than no instrument. */
  it("survives a hostile environment rather than throwing into the app", () => {
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => isDiagArmed(win({ sessionStorage: boom }))).not.toThrow();
    expect(isDiagArmed(win({ sessionStorage: boom }))).toBe(false);
    expect(isDiagArmed({})).toBe(false);
    expect(isDiagArmed(undefined)).toBe(false);
    expect(() => latchDiagArm(win({ sessionStorage: boom, __PLANYR_E2E: true }))).not.toThrow();
  });
});

describe("source guard — the hooks must not go back to a mount-time gate", () => {
  const SP = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

  it("both diagnostic hooks read the gate at CALL time", () => {
    expect(SP).toMatch(/const hook = \(x, y\) => \(isDiagArmed\(window\) && dblResolveRef\.current/);
    expect(SP).toMatch(/const why = \(x, y\) => \(isDiagArmed\(window\) && dblWhyRef\.current/);
  });

  it("their effect does not refuse to install on an unarmed tab (that is the remount trap)", () => {
    const at = SP.indexOf("window.__plannerHitWhy = why");
    const block = SP.slice(Math.max(0, at - 700), at);
    expect(block).toMatch(/if \(typeof window === "undefined"\) return;/);
    expect(block, "gating the INSTALL on the flag is what made it unreachable in production")
      .not.toMatch(/!window\.__PLANYR_E2E\) return;/);
  });

  it("arming is latched so an in-app plan switch keeps it", () => {
    expect(SP).toMatch(/latchDiagArm\(window\)/);
  });
});
