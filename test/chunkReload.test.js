import { describe, it, expect } from "vitest";
import {
  shouldReloadAfterPreloadError,
  recoveryStage,
  hasReloadParam,
  clearReloadGuard,
  RELOAD_COOLDOWN_MS,
  RELOAD_GUARD_KEY,
  RELOAD_PARAM,
  isChunkLoadError,
  reloadFresh,
  stripReloadParam,
} from "../src/app/chunkReload.js";

// B221 — stale chunk after deploy. The guard reloads once when a code-split chunk
// fails to load (a new build replaced the hashed filename this tab still references),
// but must never reload-loop when a chunk is genuinely missing.
describe("chunk-reload guard decision (B221)", () => {
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

// B239 — distinguish a stale/missing chunk (recover by reloading the fresh build) from
// an ordinary render crash (where reloading the same code won't help).
describe("isChunkLoadError (B239)", () => {
  it("matches the dynamic-import failures across browsers", () => {
    [
      "Failed to fetch dynamically imported module: https://planyr.io/assets/Scheduler-733N4NOD.js", // Chrome
      "error loading dynamically imported module: https://planyr.io/assets/DocReview-abc.js",         // Firefox
      "Importing a module script failed.",                                                            // Safari
      "Loading chunk 5 failed.",                                                                       // webpack-style
      'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html".',
    ].forEach((m) => expect(isChunkLoadError(new Error(m))).toBe(true));
    // Bare string and a { message } shape both work.
    expect(isChunkLoadError("Failed to fetch dynamically imported module: x")).toBe(true);
    expect(isChunkLoadError({ message: "error loading dynamically imported module" })).toBe(true);
  });

  it("does NOT match ordinary render crashes", () => {
    expect(isChunkLoadError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isChunkLoadError(new Error("cfgOf is not defined"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

// B447 — escape the dead-end when even the FRESH build is still missing the chunk
// (server mid-deploy / edge skew). A page that arrived via the ?_r= cache-buster and
// still fails must stop auto-reloading and surface a manual escape, not loop.
describe("recoveryStage (B447)", () => {
  it("first failure with no prior reload → reload", () => {
    expect(recoveryStage(false, 1_000_000, 0)).toBe("reload");
  });

  it("first failure after the cooldown elapsed → reload (a later, separate deploy)", () => {
    const last = 1_000_000;
    expect(recoveryStage(false, last + RELOAD_COOLDOWN_MS, last)).toBe("reload");
  });

  it("just reloaded (within cooldown) but NOT via _r → cooldown (suppress, don't loop)", () => {
    const last = 1_000_000;
    expect(recoveryStage(false, last + 500, last)).toBe("cooldown");
  });

  it("arrived via a fresh reload and STILL failed → stuck (regardless of timing)", () => {
    expect(recoveryStage(true, 1_000_000, 0)).toBe("stuck");
    // even long after the cooldown, an _r arrival that fails again is stuck, not a reload
    expect(recoveryStage(true, 9_999_999, 1_000_000)).toBe("stuck");
  });
});

describe("hasReloadParam (B447)", () => {
  it("detects the cache-busting param", () => {
    expect(hasReloadParam({ location: { href: "https://planyr.io/?_r=123" } })).toBe(true);
    expect(hasReloadParam({ location: { href: "https://planyr.io/?keep=1&_r=9#x" } })).toBe(true);
  });
  it("false when absent / no window", () => {
    expect(hasReloadParam({ location: { href: "https://planyr.io/?keep=1" } })).toBe(false);
    expect(hasReloadParam(undefined)).toBe(false);
  });
});

describe("clearReloadGuard (B447)", () => {
  it("removes the cooldown stamp so the next retry isn't suppressed", () => {
    const store = { [RELOAD_GUARD_KEY]: "1000" };
    const win = { sessionStorage: { removeItem: (k) => { delete store[k]; } } };
    clearReloadGuard(win);
    expect(store[RELOAD_GUARD_KEY]).toBeUndefined();
  });
  it("no-ops without a window / when storage is blocked", () => {
    expect(() => clearReloadGuard(undefined)).not.toThrow();
    expect(() => clearReloadGuard({ sessionStorage: { removeItem() { throw new Error("blocked"); } } })).not.toThrow();
  });
});

// B239 — the recovery reload must defeat a hard-cached stale index.html, so it changes
// the cache key (adds a throwaway ?_r=) and uses replace() (no back-button trap).
describe("reloadFresh (B239)", () => {
  const makeWin = (href) => {
    const calls = { replace: [], reload: 0 };
    return [{ location: { href, replace: (u) => calls.replace.push(u), reload: () => { calls.reload++; } } }, calls];
  };

  it("navigates to the same path with a fresh cache-busting param via replace()", () => {
    const [win, calls] = makeWin("https://planyr.io/");
    reloadFresh(win);
    expect(calls.reload).toBe(0);
    expect(calls.replace).toHaveLength(1);
    const u = new URL(calls.replace[0]);
    expect(u.pathname).toBe("/");
    expect(u.searchParams.get(RELOAD_PARAM)).toMatch(/^\d+$/);
  });

  it("replaces (does not stack) an existing reload param and preserves other query", () => {
    const [win, calls] = makeWin("https://planyr.io/?keep=1&_r=111");
    reloadFresh(win);
    const u = new URL(calls.replace[0]);
    expect(u.searchParams.get("keep")).toBe("1");
    expect(u.searchParams.getAll(RELOAD_PARAM)).toHaveLength(1); // not appended twice
  });

  it("no-ops without a window", () => {
    expect(() => reloadFresh(undefined)).not.toThrow();
  });
});

// B239 — the throwaway param is tidied off the address bar on the recovered load.
describe("stripReloadParam (B239)", () => {
  const makeWin = (href) => {
    const replaceState = [];
    return [{ location: { href }, history: { state: { a: 1 }, replaceState: (s, t, url) => replaceState.push(url) } }, replaceState];
  };

  it("removes _r but keeps the rest of the URL", () => {
    const [win, rs] = makeWin("https://planyr.io/?keep=1&_r=999#frag");
    stripReloadParam(win);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toBe("/?keep=1#frag");
  });

  it("does nothing when there is no _r param", () => {
    const [win, rs] = makeWin("https://planyr.io/?keep=1");
    stripReloadParam(win);
    expect(rs).toHaveLength(0);
  });
});
