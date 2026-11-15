/* NEW-1 (2026-11-15) — the Dashboard Comps card's click must focus the featured comp even when the
 * Comps list is still loading. The measured failure: the focus request was looked up in an empty
 * list and then cleared as handled, so nothing opened. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveCompFocus, COMP_FOCUS_MISSING_NOTICE } from "../src/shared/comps/lib/compFocus.js";

const comps = [{ id: "a" }, { id: "b" }];

describe("resolveCompFocus", () => {
  it("does nothing without a request", () => {
    expect(resolveCompFocus({ focusCompId: null, comps, loaded: true }).action).toBe("idle");
  });
  it("opens the comp when it is in the list (pin click / row click shape)", () => {
    const r = resolveCompFocus({ focusCompId: "b", comps, loaded: true });
    expect(r.action).toBe("open");
    expect(r.comp.id).toBe("b");
  });
  it("WAITS — never drops the request — while the list has not loaded (the cold Dashboard arrival)", () => {
    expect(resolveCompFocus({ focusCompId: "b", comps: [], loaded: false }).action).toBe("wait");
  });
  it("opens as soon as the list arrives with the comp in it", () => {
    expect(resolveCompFocus({ focusCompId: "b", comps, loaded: true }).action).toBe("open");
  });
  it("says so (missing) once the list is known and the comp isn't in it", () => {
    expect(resolveCompFocus({ focusCompId: "zzz", comps, loaded: true }).action).toBe("missing");
    expect(COMP_FOCUS_MISSING_NOTICE).toMatch(/isn't in your list/);
  });
});

describe("CompsPanel wires the focus request through resolveCompFocus", () => {
  const src = readFileSync(new URL("../src/shared/comps/components/CompsPanel.jsx", import.meta.url), "utf8");
  it("the focus effect re-runs when the list loads (not only when the id arrives)", () => {
    expect(src).toMatch(/resolveCompFocus\(\{ focusCompId, comps, loaded: loadedOnce/);
    expect(src).toMatch(/\[focusCompId, comps, loadedOnce, loadError\]/);
  });
  it("never clears the request before the comp is found or the list is known", () => {
    // the old shape: an unconditional onFocusHandled() right after a lookup in a possibly-empty list
    expect(src).not.toMatch(/const c = comps\.find\(\(x\) => x\.id === focusCompId\);\s*\n\s*if \(c\) \{[^\n]*\}\s*\n\s*onFocusHandled\?\.\(\);/);
  });
});
