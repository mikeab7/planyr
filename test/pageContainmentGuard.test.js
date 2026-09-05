import { describe, it, expect, vi } from "vitest";
import { detectDrift, installPageContainmentGuard } from "../src/shared/ui/pageContainmentGuard.js";

describe("pageContainmentGuard — detectDrift (pure)", () => {
  it("reports no drift when the document is at rest and unzoomed", () => {
    expect(detectDrift({ scrollX: 0, scrollY: 0, scale: 1 })).toBe(null);
  });
  it("reports no drift with no reading at all (defaults)", () => {
    expect(detectDrift()).toBe(null);
  });
  it("flags a nonzero scrollX as drift — html/body are pinned, so this should be impossible", () => {
    const d = detectDrift({ scrollX: 42, scrollY: 0, scale: 1 });
    expect(d).not.toBe(null);
    expect(d.kind).toBe("page-containment-drift");
    expect(d.extra.scrollDrift).toBe(true);
    expect(d.extra.scaleDrift).toBe(false);
    expect(d.message).toContain("(42, 0)");
  });
  it("flags a nonzero scrollY as drift", () => {
    const d = detectDrift({ scrollX: 0, scrollY: -13, scale: 1 });
    expect(d.extra.scrollDrift).toBe(true);
    expect(d.message).toContain("(0, -13)");
  });
  it("flags a visualViewport scale drift away from 1", () => {
    const d = detectDrift({ scrollX: 0, scrollY: 0, scale: 1.4 });
    expect(d.extra.scaleDrift).toBe(true);
    expect(d.extra.scrollDrift).toBe(false);
    expect(d.message).toContain("1.4");
  });
  it("tolerates float rounding noise in scale (does not false-positive)", () => {
    expect(detectDrift({ scrollX: 0, scrollY: 0, scale: 1.001 })).toBe(null);
    expect(detectDrift({ scrollX: 0, scrollY: 0, scale: 0.999 })).toBe(null);
  });
  it("reports BOTH facts when scroll and scale drift at once, in one message", () => {
    const d = detectDrift({ scrollX: 20, scrollY: 5, scale: 1.2 });
    expect(d.extra.scrollDrift).toBe(true);
    expect(d.extra.scaleDrift).toBe(true);
    expect(d.message).toContain("scrolled");
    expect(d.message).toContain("scale");
  });
});

// A minimal fake `window` — just enough surface for the installer's addEventListener /
// removeEventListener / scrollTo / visualViewport / location contract.
function makeFakeWindow({ visualViewport = true } = {}) {
  const listeners = new Map(); // event name -> Set(handler)
  const vvListeners = new Map();
  const win = {
    document: { querySelector: () => null },
    scrollX: 0, scrollY: 0,
    location: { hash: "#/site" },
    scrollTo: vi.fn((x, y) => { win.scrollX = x; win.scrollY = y; }),
    addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener: (name, fn) => { listeners.get(name)?.delete(fn); },
    visualViewport: visualViewport ? {
      scale: 1,
      addEventListener: (name, fn) => { if (!vvListeners.has(name)) vvListeners.set(name, new Set()); vvListeners.get(name).add(fn); },
      removeEventListener: (name, fn) => { vvListeners.get(name)?.delete(fn); },
    } : undefined,
  };
  const fire = (name) => { for (const fn of listeners.get(name) || []) fn(); };
  const fireVv = (name) => { for (const fn of vvListeners.get(name) || []) fn(); };
  return { win, fire, fireVv, listeners, vvListeners };
}

describe("pageContainmentGuard — installPageContainmentGuard (DOM-driven, injected reporter)", () => {
  it("does nothing at rest — a normal session never reports or scrolls", () => {
    const { win, fire } = makeFakeWindow();
    const reporter = vi.fn();
    installPageContainmentGuard(win, reporter);
    fire("scroll");
    expect(reporter).not.toHaveBeenCalled();
    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it("self-heals AND reports the instant the document is found scrolled", () => {
    const { win, fire } = makeFakeWindow();
    const reporter = vi.fn();
    installPageContainmentGuard(win, reporter);
    win.scrollX = 87; win.scrollY = 214; // what a real drag-off-the-pin would leave behind
    fire("scroll");
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
    expect(reporter).toHaveBeenCalledTimes(1);
    const [kind, message, extra] = reporter.mock.calls[0];
    expect(kind).toBe("page-containment-drift");
    expect(message).toContain("(87, 214)");
    expect(extra.scrollX).toBe(87);
    expect(extra.scrollY).toBe(214);
    expect(extra.url).toBe("#/site");
  });

  it("reports a visualViewport scale drift via the visualViewport's own events", () => {
    const { win, fireVv } = makeFakeWindow();
    const reporter = vi.fn();
    installPageContainmentGuard(win, reporter);
    win.visualViewport.scale = 1.35;
    fireVv("resize");
    expect(reporter).toHaveBeenCalledTimes(1);
    expect(reporter.mock.calls[0][2].scale).toBe(1.35);
  });

  it("never throws when visualViewport doesn't exist on this browser", () => {
    const { win, fire } = makeFakeWindow({ visualViewport: false });
    const reporter = vi.fn();
    expect(() => installPageContainmentGuard(win, reporter)).not.toThrow();
    win.scrollX = 10;
    expect(() => fire("scroll")).not.toThrow();
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("throttles a repeating/stuck drift to at most one report per window", () => {
    const { win, fire } = makeFakeWindow();
    const reporter = vi.fn();
    installPageContainmentGuard(win, reporter);
    win.scrollX = 50;
    fire("scroll"); // reports, then self-heals scrollX back to 0
    win.scrollX = 50; // drifts again immediately (simulating a stuck/repeating gesture)
    fire("scroll");
    expect(reporter).toHaveBeenCalledTimes(1);
  });

  it("is idempotent — a second install on the same window is a no-op", () => {
    const { win, fire } = makeFakeWindow();
    const reporter1 = vi.fn();
    const reporter2 = vi.fn();
    installPageContainmentGuard(win, reporter1);
    installPageContainmentGuard(win, reporter2);
    win.scrollX = 5;
    fire("scroll");
    expect(reporter1).toHaveBeenCalledTimes(1);
    expect(reporter2).not.toHaveBeenCalled();
  });

  it("uninstall removes the listeners — no further reports fire", () => {
    const { win, fire } = makeFakeWindow();
    const reporter = vi.fn();
    const uninstall = installPageContainmentGuard(win, reporter);
    uninstall();
    win.scrollX = 5;
    fire("scroll");
    expect(reporter).not.toHaveBeenCalled();
  });

  it("returns a no-op installer for a window with no document", () => {
    expect(() => installPageContainmentGuard(undefined, vi.fn())()).not.toThrow();
    expect(() => installPageContainmentGuard({}, vi.fn())()).not.toThrow();
  });
});
