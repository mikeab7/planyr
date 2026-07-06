import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { multiwriterEnabled, MULTIWRITER_DEFAULT, MULTIWRITER_KEY } from "../src/workspaces/site-planner/lib/multiwriter.js";

// B674 — the multi-writer switch: default ON in code, client-side localStorage escape hatch
// (`planyr.multiwriter` = "off"), NO build-time env var (the Cloudflare env-at-build trap).

const realLS = globalThis.localStorage;
afterEach(() => { Object.defineProperty(globalThis, "localStorage", { value: realLS, configurable: true, writable: true }); });

const fakeLS = (store = {}) => Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
  configurable: true, writable: true,
});

describe("multiwriterEnabled", () => {
  beforeEach(() => fakeLS());
  it("defaults ON (the code constant)", () => {
    expect(MULTIWRITER_DEFAULT).toBe(true);
    expect(multiwriterEnabled()).toBe(true);
  });
  it("the localStorage escape hatch 'off' restores lock behavior", () => {
    fakeLS({ [MULTIWRITER_KEY]: "off" });
    expect(multiwriterEnabled()).toBe(false);
  });
  it("any other stored value keeps the default (only the literal 'off' disables)", () => {
    fakeLS({ [MULTIWRITER_KEY]: "false" });
    expect(multiwriterEnabled()).toBe(true);
  });
  it("a throwing/blocked localStorage falls back to the default, never crashes", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: { getItem: () => { throw new Error("blocked"); } }, configurable: true, writable: true,
    });
    expect(multiwriterEnabled()).toBe(true);
  });
});
