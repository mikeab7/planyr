/* NEW-1 — the full-screen control only exists where full screen can happen. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { fullscreenApiAvailable, fullscreenAvailable, runningChromeless } from "../src/shared/ui/fullscreenSupport.js";

const fakeDoc = (o = {}) => ({ documentElement: { requestFullscreen() {} }, ...o });

function stubWindow({ modes = [], standalone } = {}) {
  vi.stubGlobal("window", { matchMedia: (q) => ({ matches: modes.some((m) => q.includes(m)) }) });
  vi.stubGlobal("navigator", { standalone });
  vi.stubGlobal("document", fakeDoc({ fullscreenEnabled: true }));
}
afterEach(() => vi.unstubAllGlobals());

describe("fullscreenApiAvailable", () => {
  it("is false on iPhone Safari (neither flag, no element method)", () => {
    expect(fullscreenApiAvailable({ documentElement: {} })).toBe(false);
  });
  it("is false when the flag is on but the element has no request method", () => {
    expect(fullscreenApiAvailable({ fullscreenEnabled: true, documentElement: {} })).toBe(false);
  });
  it("is false when the method exists but the browser disables it", () => {
    expect(fullscreenApiAvailable(fakeDoc({ fullscreenEnabled: false }))).toBe(false);
  });
  it("is true for the standard API (desktop, iPad)", () => {
    expect(fullscreenApiAvailable(fakeDoc({ fullscreenEnabled: true }))).toBe(true);
  });
  it("is true for the webkit-prefixed API", () => {
    expect(fullscreenApiAvailable({ webkitFullscreenEnabled: true, documentElement: { webkitRequestFullscreen() {} } })).toBe(true);
  });
  it("is false with no document", () => { expect(fullscreenApiAvailable(null)).toBe(false); });
});

describe("fullscreenAvailable (API + display mode)", () => {
  it("true on a normal browser tab", () => { stubWindow(); expect(fullscreenAvailable()).toBe(true); });
  it("false when installed (display-mode: standalone)", () => {
    stubWindow({ modes: ["standalone"] }); expect(runningChromeless()).toBe(true); expect(fullscreenAvailable()).toBe(false);
  });
  it("false at display-mode: fullscreen", () => { stubWindow({ modes: ["fullscreen"] }); expect(fullscreenAvailable()).toBe(false); });
  it("false for iOS navigator.standalone", () => { stubWindow({ standalone: true }); expect(fullscreenAvailable()).toBe(false); });
});
