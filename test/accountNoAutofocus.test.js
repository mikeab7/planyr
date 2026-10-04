/* NEW-1 — source guard: the Account/Settings modal never focuses a text input on a touch device,
 * and Settings never does anywhere. (No jsdom in this repo; the browser half is
 * e2e/touch-no-autofocus-account.spec.js.) */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/workspaces/site-planner/components/AuthPanel.jsx", import.meta.url), "utf8");

describe("AuthPanel focus-in (NEW-1)", () => {
  it("gates first-input focus on a fine pointer", () => {
    expect(src).toMatch(/isCoarsePointer/);
    expect(src).toMatch(/focusFirstInput && !isCoarsePointer\(\)/);
  });
  it("Settings opts out of first-input focus entirely", () => {
    expect(src).toMatch(/title="Settings" focusFirstInput=\{false\}/);
  });
  it("the Profile / Team / Security / Interface sections carry no autoFocus", () => {
    expect(src).not.toMatch(/autoFocus/);
  });
});
