/* B1176480 — safeAreaInsets() reads env(safe-area-inset-*) as numbers via a hidden probe
 * element's computed style (env() has no JS-readable form of its own). Faked document/window,
 * same shape as test/cornerClearance.test.js (this repo's vitest config runs `environment:
 * "node"`, no jsdom). */
import { describe, it, expect, afterEach, vi } from "vitest";
import { safeAreaInsets } from "../src/shared/ui/safeAreaInsets.js";

function installDom({ padding = { paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px" } } = {}) {
  const created = [];
  const appendChild = vi.fn();
  const doc = {
    createElement: vi.fn(() => {
      const el = { style: {}, setAttribute: () => {} };
      created.push(el);
      return el;
    }),
    body: { appendChild },
    documentElement: { appendChild },
  };
  global.document = doc;
  global.window = {
    getComputedStyle: (el) => (created.includes(el) ? padding : { paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px" }),
  };
  return { doc, created };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe("safeAreaInsets", () => {
  it("returns all zeros when document/window are unavailable (SSR safety net)", () => {
    expect(safeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("returns zeros when env() resolves to 0 (desktop, or this sandbox's headless Chromium — no notch to inset around)", () => {
    installDom();
    expect(safeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("parses a non-zero computed inset (a notched/home-indicator device) into numbers", () => {
    installDom({ padding: { paddingTop: "47px", paddingRight: "0px", paddingBottom: "34px", paddingLeft: "0px" } });
    expect(safeAreaInsets()).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
  });

  it("reads a non-zero RIGHT inset too (landscape — the notch/dynamic island rotates to a side edge)", () => {
    installDom({ padding: { paddingTop: "0px", paddingRight: "44px", paddingBottom: "21px", paddingLeft: "0px" } });
    expect(safeAreaInsets()).toEqual({ top: 0, right: 44, bottom: 21, left: 0 });
  });

  it("creates the probe element only once per document (caches it rather than re-creating on every call)", () => {
    const { doc } = installDom();
    safeAreaInsets();
    safeAreaInsets();
    safeAreaInsets();
    expect(doc.createElement).toHaveBeenCalledTimes(1);
  });

  it("recreates the probe when the document changes (e.g. a fresh test/page) rather than reading a stale element", () => {
    const first = installDom();
    safeAreaInsets();
    expect(first.doc.createElement).toHaveBeenCalledTimes(1);

    const second = installDom({ padding: { paddingTop: "0px", paddingRight: "0px", paddingBottom: "34px", paddingLeft: "0px" } });
    const result = safeAreaInsets();
    expect(second.doc.createElement).toHaveBeenCalledTimes(1);
    expect(result.bottom).toBe(34);
  });

  it("never throws if createElement/getComputedStyle throw", () => {
    global.document = { createElement: () => { throw new Error("nope"); }, body: {} };
    global.window = { getComputedStyle: () => { throw new Error("nope"); } };
    expect(safeAreaInsets()).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
