import { describe, it, expect } from "vitest";
import {
  shouldReloadAfterPreloadError,
  RELOAD_COOLDOWN_MS,
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

// B228 — distinguish a stale/missing chunk (recover by reloading the fresh build) from
// an ordinary render crash (where reloading the same code won't help).
describe("isChunkLoadError (B228)", () => {
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

// B228 — the recovery reload must defeat a hard-cached stale index.html, so it changes
// the cache key (adds a throwaway ?_r=) and uses replace() (no back-button trap).
describe("reloadFresh (B228)", () => {
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

// B228 — the throwaway param is tidied off the address bar on the recovered load.
describe("stripReloadParam (B228)", () => {
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
