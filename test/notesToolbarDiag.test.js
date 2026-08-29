/* ⛔ B831600 ×3 / B280403 — same reason as `diagArm.js`'s own suite: an instrument built to answer
 * "why did it fail on HIS machine" has to be armable on his machine, gated at CALL time, and must
 * be a true no-op when unarmed (the guard the owner explicitly asked to be proven before shipping
 * this as its own PR, separate from the still-unresolved B831600). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isToolbarDiagArmed, latchToolbarDiag, recordToolbarDiag,
  TOOLBAR_DIAG_STORAGE_KEY, TOOLBAR_DIAG_PARAM, TOOLBAR_DIAG_LOG_KEY,
} from "../src/workspaces/notes/lib/notesToolbarDiag.js";

const win = (over = {}) => ({ location: { search: "", hash: "" }, ...over });
const store = (init = {}) => {
  const m = { ...init };
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m };
};

describe("arming the toolbar-jump diagnostic", () => {
  it("is OFF by default — production is not a debug build", () => {
    expect(isToolbarDiagArmed(win({ sessionStorage: store() }))).toBe(false);
  });

  it("a plain console flag arms an already-open tab", () => {
    expect(isToolbarDiagArmed(win({ __PLANYR_TOOLBAR_DIAG_ARM: true }))).toBe(true);
    expect(isToolbarDiagArmed(win({ __PLANYR_TOOLBAR_DIAG_ARM: "yes" })), "only a real true").toBe(false);
  });

  it(`a URL arms it before the FIRST render — the case this diagnostic exists for (?${TOOLBAR_DIAG_PARAM}=1)`, () => {
    expect(isToolbarDiagArmed(win({ location: { search: `?${TOOLBAR_DIAG_PARAM}=1`, hash: "" } }))).toBe(true);
    expect(isToolbarDiagArmed(win({ location: { search: `?foo=1&${TOOLBAR_DIAG_PARAM}=1`, hash: "" } }))).toBe(true);
    expect(isToolbarDiagArmed(win({ location: { search: "", hash: `#/notes?${TOOLBAR_DIAG_PARAM}=1` } })), "notes navigates by hash").toBe(true);
  });

  it("a near-miss does not arm it", () => {
    for (const search of [`?${TOOLBAR_DIAG_PARAM}=0`, `?${TOOLBAR_DIAG_PARAM}`, `?x${TOOLBAR_DIAG_PARAM}=1`, `?${TOOLBAR_DIAG_PARAM}=11`])
      expect(isToolbarDiagArmed(win({ location: { search, hash: "" } })), search).toBe(false);
  });

  it("the session key arms it, and it is SESSION-scoped so it cannot leak into a later visit", () => {
    expect(isToolbarDiagArmed(win({ sessionStorage: store({ [TOOLBAR_DIAG_STORAGE_KEY]: "1" }) }))).toBe(true);
    expect(isToolbarDiagArmed(win({ sessionStorage: store({ [TOOLBAR_DIAG_STORAGE_KEY]: "0" }) }))).toBe(false);
  });

  it("a URL-armed tab LATCHES, so the reload the repro itself needs does not disarm it", () => {
    const ss = store();
    const w = win({ sessionStorage: ss, location: { search: `?${TOOLBAR_DIAG_PARAM}=1`, hash: "" } });
    expect(latchToolbarDiag(w)).toBe(true);
    expect(ss._m[TOOLBAR_DIAG_STORAGE_KEY]).toBe("1");
    expect(isToolbarDiagArmed(win({ sessionStorage: ss })), "survives the parameter going away").toBe(true);
  });

  it("latching an UNARMED tab writes nothing — it never arms by being asked", () => {
    const ss = store();
    expect(latchToolbarDiag(win({ sessionStorage: ss }))).toBe(false);
    expect(ss._m[TOOLBAR_DIAG_STORAGE_KEY]).toBeUndefined();
  });

  it("survives a hostile environment rather than throwing into the app it observes", () => {
    const boom = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => isToolbarDiagArmed(win({ sessionStorage: boom }))).not.toThrow();
    expect(isToolbarDiagArmed(win({ sessionStorage: boom }))).toBe(false);
    expect(isToolbarDiagArmed({})).toBe(false);
    expect(isToolbarDiagArmed(undefined)).toBe(false);
    expect(() => latchToolbarDiag(win({ sessionStorage: boom, __PLANYR_TOOLBAR_DIAG_ARM: true }))).not.toThrow();
  });
});

describe("recording — the read-only sink", () => {
  it("pushes onto a window array, creating it on first use", () => {
    const w = {};
    recordToolbarDiag({ a: 1 }, w);
    recordToolbarDiag({ a: 2 }, w);
    expect(w[TOOLBAR_DIAG_LOG_KEY]).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("never throws into the app, even with no window or a hostile one", () => {
    expect(() => recordToolbarDiag({ a: 1 }, undefined)).not.toThrow();
    const hostile = {};
    Object.defineProperty(hostile, TOOLBAR_DIAG_LOG_KEY, { set() { throw new Error("blocked"); }, get() { return undefined; } });
    expect(() => recordToolbarDiag({ a: 1 }, hostile)).not.toThrow();
  });

  it("does not disturb a caller's own array shape if one is already there and is not an array", () => {
    const w = { [TOOLBAR_DIAG_LOG_KEY]: "not-an-array" };
    recordToolbarDiag({ a: 1 }, w);
    expect(w[TOOLBAR_DIAG_LOG_KEY]).toEqual([{ a: 1 }]);
  });
});

describe("source guard — the gate is read at CALL time, never at mount", () => {
  const NE = readFileSync(fileURLToPath(new URL("../src/workspaces/notes/components/NoteEditor.jsx", import.meta.url)), "utf8");

  it("applyToolbarDelta checks isToolbarDiagArmed() itself, not a flag threaded in from a mount-time read", () => {
    expect(NE).toMatch(/const applyToolbarDelta = useCallback\(\(nextHeight, trigger\) => \{\s*const diagOn = isToolbarDiagArmed\(\);/);
  });

  it("both the layout effect and the ResizeObserver install unconditionally — no arm check gates the useEffect itself", () => {
    const layoutEffectAt = NE.indexOf("useLayoutEffect(() => {\n    const toolbarEl = noteRootRef.current");
    const roEffectAt = NE.indexOf("const ro = new ResizeObserver(");
    expect(layoutEffectAt).toBeGreaterThan(-1);
    expect(roEffectAt).toBeGreaterThan(-1);
    const layoutBlock = NE.slice(layoutEffectAt, layoutEffectAt + 300);
    const roBlock = NE.slice(Math.max(0, roEffectAt - 400), roEffectAt);
    expect(layoutBlock, "the layout effect must not gate on the diag flag before measuring").not.toMatch(/isToolbarDiagArmed/);
    expect(roBlock, "the RO setup effect must not gate on the diag flag before observing").not.toMatch(/isToolbarDiagArmed/);
  });

  it("both call sites pass a trigger label so a captured entry says which mechanism fired", () => {
    expect(NE).toMatch(/applyToolbarDelta\(toolbarEl\.getBoundingClientRect\(\)\.height, "layout-effect"\)/);
    expect(NE).toMatch(/applyToolbarDelta\(toolbarEl\.getBoundingClientRect\(\)\.height, "resize-observer"\)/);
  });
});
