import { describe, it, expect } from "vitest";
import { shouldReloadAfterPreloadError, RELOAD_COOLDOWN_MS } from "../src/app/chunkReload.js";

// B218 — stale chunk after deploy. The guard reloads once when a code-split chunk
// fails to load (a new build replaced the hashed filename this tab still references),
// but must never reload-loop when a chunk is genuinely missing.
describe("chunk-reload guard decision (B218)", () => {
  it("reloads when there was no prior auto-reload", () => {
    const now = 1_000_000;
    expect(shouldReloadAfterPreloadError(now, 0)).toBe(true);
    expect(shouldReloadAfterPreloadError(now, undefined)).toBe(true);
    expect(shouldReloadAfterPreloadError(now, null)).toBe(true);
    expect(shouldReloadAfterPreloadError(now, NaN)).toBe(true);
    expect(shouldReloadAfterPreloadError(now, "")).toBe(true);
  });

  it("does NOT reload again within the cooldown (genuinely-missing chunk → no loop)", () => {
    const last = 1_000_000;
    expect(shouldReloadAfterPreloadError(last + 1, last)).toBe(false);
    expect(shouldReloadAfterPreloadError(last + 1_000, last)).toBe(false);
    expect(shouldReloadAfterPreloadError(last + RELOAD_COOLDOWN_MS - 1, last)).toBe(false);
  });

  it("re-arms once the cooldown elapses (a later, separate deploy recovers)", () => {
    const last = 1_000_000;
    expect(shouldReloadAfterPreloadError(last + RELOAD_COOLDOWN_MS, last)).toBe(true);
    expect(shouldReloadAfterPreloadError(last + RELOAD_COOLDOWN_MS + 5_000, last)).toBe(true);
  });

  it("honors a custom cooldown window", () => {
    expect(shouldReloadAfterPreloadError(150, 100, 100)).toBe(false); // 50ms after, within 100ms
    expect(shouldReloadAfterPreloadError(200, 100, 100)).toBe(true);  // exactly at the window edge
    expect(shouldReloadAfterPreloadError(260, 100, 100)).toBe(true);  // well past
  });
});
