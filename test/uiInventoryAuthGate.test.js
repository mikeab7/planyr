/* test/uiInventoryAuthGate.test.js — NEW-15 / B846608.
 *
 * WHAT THIS PROTECTS. `docs/UI-INVENTORY.md`'s Signature-budget gate (ui-audit/ui-inventory.mjs)
 * failed two unrelated PRs (#1397, #1398, both 2026-09-03) because the committed doc was
 * regenerated against a build with Supabase NOT configured (`VITE_SUPABASE_URL`/
 * `VITE_SUPABASE_ANON_KEY` empty), rendering AccountControl's "Cloud sync isn't set up" pill,
 * while CI's real build always carries real secrets and renders "Sign in or create an account"
 * instead — a different branch of the same component. `classifyAuthState` is the pure decision
 * behind the fix: a hard, unconditional refusal (both `--check` and regen mode) unless the crawl
 * confirms it is looking at CI's canonical signed-out+configured branch, so this exact class of
 * drift can no longer ship silently regardless of how the script is invoked.
 *
 * This tests only the pure classifier — no browser. `assertCanonicalAuthState` (the Playwright
 * probe that feeds it) has no headless-DOM equivalent worth mocking here; it is exercised for
 * real every time `ui-inventory.mjs --check` runs in CI, which is the same coverage shape every
 * other browser-driving check in this file already relies on.
 */
import { describe, it, expect } from "vitest";
import { classifyAuthState } from "../ui-audit/ui-inventory.mjs";

describe("classifyAuthState (NEW-15 / B846608)", () => {
  it("passes when signed-out+configured is the only marker present — CI's canonical state", () => {
    const verdict = classifyAuthState({ cloudOff: false, signedOut: true });
    expect(verdict.ok).toBe(true);
    expect(verdict.state).toBe("signed-out-configured");
    expect(verdict.message).toBeNull();
  });

  it("refuses when only the Cloud-off marker is present — the exact PR #1397/#1398 defect", () => {
    const verdict = classifyAuthState({ cloudOff: true, signedOut: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.state).toBe("cloud-off");
    expect(verdict.message).toMatch(/Supabase NOT configured/);
    expect(verdict.message).toMatch(/VITE_SUPABASE_URL/);
    expect(verdict.message).toMatch(/VITE_SUPABASE_ANON_KEY/);
    expect(verdict.message).toMatch(/npm run ci-parity/);
  });

  it("refuses when neither marker is present — markup drifted out from under the gate", () => {
    const verdict = classifyAuthState({ cloudOff: false, signedOut: false });
    expect(verdict.ok).toBe(false);
    expect(verdict.state).toBe("unknown");
    expect(verdict.message).toMatch(/could not determine/i);
    expect(verdict.message).toMatch(/signedOut: false, cloudOff: false/);
  });

  it("refuses when BOTH markers are present — an impossible/contradictory render, never silently trusted", () => {
    const verdict = classifyAuthState({ cloudOff: true, signedOut: true });
    expect(verdict.ok).toBe(false);
    expect(verdict.state).toBe("unknown");
  });

  it("never returns ok:true without state signed-out-configured, and never returns a message on ok:true", () => {
    // A cheap mutation-style guard: the ONLY passing shape is exactly {cloudOff:false, signedOut:true}.
    const combos = [
      { cloudOff: false, signedOut: false },
      { cloudOff: true, signedOut: false },
      { cloudOff: false, signedOut: true },
      { cloudOff: true, signedOut: true },
    ];
    const passing = combos.filter((c) => classifyAuthState(c).ok);
    expect(passing).toEqual([{ cloudOff: false, signedOut: true }]);
  });
});
