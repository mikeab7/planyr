import { describe, it, expect } from "vitest";
import { markProgrammaticScroll, consumeProgrammaticScroll } from "../src/shared/ui/programmaticScroll.js";

// B1107632 — the explicit guard that replaced ContextMenu's one-rAF-late scroll-dismiss arm. A
// WeakMap keyed by element identity, so plain objects stand in for DOM elements here with no DOM
// needed (WeakMap only cares about reference identity). `now` is always passed explicitly so the
// grace-window edge is deterministic rather than racing the real clock.

describe("programmaticScroll (B1107632)", () => {
  it("consumeProgrammaticScroll is false for an element that was never marked", () => {
    expect(consumeProgrammaticScroll({})).toBe(false);
  });

  it("a mark is consumed exactly once — a second scroll on the same element is never masked", () => {
    const el = {};
    markProgrammaticScroll(el, 1000);
    expect(consumeProgrammaticScroll(el, 1010)).toBe(true); // the deferred nudge scroll
    expect(consumeProgrammaticScroll(el, 1020)).toBe(false); // a later, genuine user scroll
  });

  it("marks on different elements don't cross-consume (row + column nudge on separate containers)", () => {
    const rowContainer = {}, colContainer = {};
    markProgrammaticScroll(rowContainer, 1000);
    expect(consumeProgrammaticScroll(colContainer, 1005)).toBe(false); // never marked
    expect(consumeProgrammaticScroll(rowContainer, 1005)).toBe(true); // still claims its own mark
  });

  it("a mark still within the measured deferred-dispatch window (up to 55ms, throttled) is honoured", () => {
    const el = {};
    markProgrammaticScroll(el, 1000);
    expect(consumeProgrammaticScroll(el, 1055)).toBe(true);
  });

  it("a STALE mark (the write was a no-op, so no scroll event ever consumed it) expires rather than excusing an unrelated later scroll forever", () => {
    const el = {};
    markProgrammaticScroll(el, 1000);
    // Nothing consumes it for a long time — e.g. this exact container is reused by a LATER,
    // unrelated ContextMenu instance. Once stale, it must not swallow that instance's own dismiss.
    expect(consumeProgrammaticScroll(el, 5000)).toBe(false);
  });

  it("a stale mark is still cleared on the check that expires it (no dangling grant to a THIRD read)", () => {
    const el = {};
    markProgrammaticScroll(el, 1000);
    consumeProgrammaticScroll(el, 5000); // expires and clears
    markProgrammaticScroll(el, 5001); // a fresh, unrelated mark
    expect(consumeProgrammaticScroll(el, 5010)).toBe(true); // the fresh mark, not a leftover
  });

  it("marking twice (a row AND a column write in the same layout-effect run) still consumes as one grant", () => {
    const el = {};
    markProgrammaticScroll(el, 1000); // scrollTop write
    markProgrammaticScroll(el, 1000); // scrollLeft write, same pass
    expect(consumeProgrammaticScroll(el, 1010)).toBe(true); // one coalesced scroll event
    expect(consumeProgrammaticScroll(el, 1020)).toBe(false); // no second grant left over
  });

  it("marking a null/undefined element is a no-op, never throws", () => {
    expect(() => markProgrammaticScroll(null)).not.toThrow();
    expect(consumeProgrammaticScroll(null)).toBe(false);
    expect(consumeProgrammaticScroll(undefined)).toBe(false);
  });
});
