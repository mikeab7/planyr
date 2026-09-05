/* AuthPanel wires Turnstile in only where it should (B1160720, NEW-1) — a source guard,
 * same shape as authMailCopy.test.js's checks on the same file. There's no jsdom in this
 * repo's vitest config (test/**), so the widget itself isn't rendered here; this instead
 * pins the load-bearing lines that make the feature config-gated and fail-safe:
 *   - the widget only mounts in signup mode AND when a site key is configured
 *   - the captcha token (not a hardcoded truthy value) gates Submit
 *   - the widget is reset after every signup attempt (single-use token)
 *   - a mid-load or errored widget disables Submit with real copy, not a blank state
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const panelSrc = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");

describe("AuthPanel — Turnstile wiring (B1160720, NEW-1)", () => {
  it("imports the shared widget and its config gate, never a local reimplementation", () => {
    expect(panelSrc).toContain('from "../../../shared/turnstile/Turnstile.jsx"');
    expect(panelSrc).toContain('from "../../../shared/turnstile/turnstileConfig.js"');
  });

  it("only mounts the widget for signup, gated on turnstileEnabled()", () => {
    expect(panelSrc).toMatch(/mode === "signup" && turnstileEnabled\(\)/);
  });

  it("Submit is disabled until a real token is present, not merely until the widget mounts", () => {
    expect(panelSrc).toMatch(/captchaState !== "ready" \|\| !captchaToken/);
  });

  it("resets the widget after a signup attempt so a single-use token is never resubmitted", () => {
    expect(panelSrc).toMatch(/turnstileRef\.current\?\.reset\(\)/);
  });

  it("shows real copy while loading and on error, never a silent dead end", () => {
    expect(panelSrc).toMatch(/Loading verification/);
    expect(panelSrc).toMatch(/Couldn't load verification/);
  });

  it("forwards the captured token into signUp() rather than a stand-in", () => {
    expect(panelSrc).toContain("captchaToken || undefined)");
  });
});
