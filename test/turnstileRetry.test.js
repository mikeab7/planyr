import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decideWidgetError, isPermanentWidgetError, silentRetryDelay, MAX_SILENT_RETRIES } from "../src/shared/turnstile/turnstileRetry.js";

describe("Turnstile silent retry (NEW-1 2026-11-28)", () => {
  it("a transient code like 300010 retries silently, three times with growing waits, then is reported", () => {
    expect(decideWidgetError("300010", 0)).toEqual({ action: "retry", ms: 1500 });
    expect(decideWidgetError("300010", 1).ms).toBe(3000);
    expect(decideWidgetError("300010", 2).ms).toBe(6000);
    expect(decideWidgetError("300010", MAX_SILENT_RETRIES)).toEqual({ action: "report" });
    expect(silentRetryDelay(-1)).toBeNull();
  });
  it("permanent codes (wrong domain/key, clock, bad params) are reported at once", () => {
    for (const c of ["110200", "110100", "110500", "200100", "400020"]) {
      expect(isPermanentWidgetError(c)).toBe(true);
      expect(decideWidgetError(c, 0)).toEqual({ action: "report" });
    }
    expect(isPermanentWidgetError("600010")).toBe(false);
  });
  it("the widget uses it and never weakens the check", () => {
    const src = readFileSync(new URL("../src/shared/turnstile/Turnstile.jsx", import.meta.url), "utf8");
    expect(src).toContain("decideWidgetError(");
    expect(src).toContain('retry: "never"');
  });
});

describe("PasswordInput (NEW-2)", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const pw = read("../src/shared/ui/PasswordInput.jsx");
  it("is accessible and keeps one input element", () => {
    expect(pw).toContain("aria-pressed={shown}");
    expect(pw).toMatch(/aria-label=\{shown \? "Hide password" : "Show password"\}/);
    expect(pw).toContain('type="button"');
    expect(pw).toContain("onMouseDown={(e) => e.preventDefault()}");
  });
  it("no password box is a bare input any more", () => {
    for (const f of ["../src/workspaces/site-planner/components/AuthPanel.jsx", "../src/app/InviteLanding.jsx"]) {
      expect(read(f)).not.toMatch(/<input[^>]*type="password"/);
    }
  });
});
