/* Deploy-skew detection (B1373) — the pure decisions.
 *
 * The property that matters most here is the NEGATIVE one: this must be silent whenever it
 * cannot actually know, because a stale-build notice that cries wolf gets dismissed by
 * reflex and then the real one is invisible too. Most of these cases are "no opinion".
 */
import { describe, it, expect, vi } from "vitest";
import { isBuildSkewed, shouldOfferReload, fetchServedBuild, installBuildSkewWatch } from "../src/app/buildSkew.js";

describe("isBuildSkewed", () => {
  it("two different real build ids = skew", () => {
    expect(isBuildSkewed("abc1234", "def5678")).toBe(true);
  });

  it("the same id is not skew, whitespace and all", () => {
    expect(isBuildSkewed("abc1234", "abc1234")).toBe(false);
    expect(isBuildSkewed("abc1234", " abc1234 ")).toBe(false);
  });

  it("has NO opinion when the served id is unknown — offline must never read as stale", () => {
    for (const served of [null, undefined, "", "   ", 42, {}]) {
      expect(isBuildSkewed("abc1234", served)).toBe(false);
    }
  });

  it("has no opinion about a dev build on either side", () => {
    expect(isBuildSkewed("dev", "abc1234")).toBe(false);
    expect(isBuildSkewed("abc1234", "dev")).toBe(false);
  });
});

describe("shouldOfferReload", () => {
  const loaded = "old111";

  it("offers the reload once the server has moved on", () => {
    expect(shouldOfferReload({ loaded, served: "new222", dismissedFor: null })).toBe(true);
  });

  it("stays quiet after a dismissal OF THAT BUILD", () => {
    expect(shouldOfferReload({ loaded, served: "new222", dismissedFor: "new222" })).toBe(false);
  });

  it("...but a LATER deploy speaks up again — one shrug is not permanent deafness", () => {
    expect(shouldOfferReload({ loaded, served: "new333", dismissedFor: "new222" })).toBe(true);
  });

  it("a route this build cannot resolve offers the reload on its own, with no version check", () => {
    expect(shouldOfferReload({ loaded, served: null, dismissedFor: null, routeMissed: true })).toBe(true);
  });

  it("and a dismissed route-miss stays dismissed", () => {
    expect(shouldOfferReload({ loaded, served: null, dismissedFor: "route-miss", routeMissed: true })).toBe(false);
  });

  it("says nothing at all when the server is unreachable and the route resolved fine", () => {
    expect(shouldOfferReload({ loaded, served: null, dismissedFor: null })).toBe(false);
  });
});

describe("fetchServedBuild", () => {
  it("reads the id out of the stamp file, and asks for it uncached", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ build: "abc1234" }) }));
    expect(await fetchServedBuild(fetchImpl)).toBe("abc1234");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("returns null — never throws — for every failure shape", async () => {
    expect(await fetchServedBuild(async () => { throw new Error("offline"); })).toBe(null);
    expect(await fetchServedBuild(async () => ({ ok: false }))).toBe(null);
    expect(await fetchServedBuild(async () => ({ ok: true, json: async () => { throw new Error("not json"); } }))).toBe(null);
    expect(await fetchServedBuild(async () => ({ ok: true, json: async () => ({}) }))).toBe(null);
    expect(await fetchServedBuild(async () => ({ ok: true, json: async () => ({ build: "  " }) }))).toBe(null);
  });
});

describe("installBuildSkewWatch", () => {
  const fakeWin = () => {
    const listeners = {};
    const doc = {
      visibilityState: "visible",
      addEventListener: (k, fn) => { listeners[`doc:${k}`] = fn; },
      removeEventListener: (k) => { delete listeners[`doc:${k}`]; },
    };
    return {
      listeners,
      document: doc,
      addEventListener: (k, fn) => { listeners[k] = fn; },
      removeEventListener: (k) => { delete listeners[k]; },
      setTimeout: () => 1,
      clearTimeout: () => {},
      setInterval: () => 2,
      clearInterval: () => {},
    };
  };

  it("looks again when the tab is focused — the laptop-reopened-next-morning case", async () => {
    const win = fakeWin();
    const seen = [];
    installBuildSkewWatch({ win, onServed: (b) => seen.push(b), fetchImpl: async () => ({ ok: true, json: async () => ({ build: "new222" }) }) });
    await win.listeners.focus();
    expect(seen).toEqual(["new222"]);
  });

  it("does not poll a tab nobody is looking at", async () => {
    const win = fakeWin();
    win.document.visibilityState = "hidden";
    const fetchImpl = vi.fn();
    installBuildSkewWatch({ win, onServed: () => {}, fetchImpl });
    await win.listeners.focus();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops reporting after unsubscribe", async () => {
    const win = fakeWin();
    const seen = [];
    const off = installBuildSkewWatch({ win, onServed: (b) => seen.push(b), fetchImpl: async () => ({ ok: true, json: async () => ({ build: "x" }) }) });
    const look = win.listeners.focus;
    off();
    await look();
    expect(seen).toEqual([]);
  });
});
