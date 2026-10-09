/* B2233521 (round 5) — the canvas guess remembered across page loads (lib/canvasGuess.js). It is only ever a GUESS for the first render, so what must hold is: it is offered ONLY for
 * the window it was measured in, anything unreadable is "no guess" (the old behaviour), an unchanged measurement is not re-written, and storage failing never throws. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CANVAS_GUESS_KEY, geometryOf, readCanvasGuess, writeCanvasGuess } from "../src/workspaces/site-planner/lib/canvasGuess.js";

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, _m: m }; };
const geom = { vw: 1722, vh: 700, dpr: 2.15 };
const meas = { box: { w: 1222.5, h: 603.25, rawW: 1222.5, rawH: 603.25 }, dockX: 480, toastCx: 1111 };

describe("canvasGuess", () => {
  it("round-trips a measurement for the same window", () => {
    const st = mem();
    const sig = writeCanvasGuess(st, geom, meas, null);
    const r = readCanvasGuess(st, geom);
    expect(r.guess).toEqual(meas);
    expect(r.sig).toBe(sig);
  });
  it.each([
    ["a different window width", { ...geom, vw: 1600 }],
    ["a different window height", { ...geom, vh: 800 }],
    ["a different pixel ratio", { ...geom, dpr: 1 }],
  ])("offers nothing for %s", (_n, other) => {
    const st = mem(); writeCanvasGuess(st, geom, meas, null);
    expect(readCanvasGuess(st, other)).toBeNull();
  });
  it("unchanged measurement is not re-written; a changed one is", () => {
    const st = mem(); let writes = 0; const orig = st.setItem; st.setItem = (k, v) => { writes++; orig(k, v); };
    let sig = writeCanvasGuess(st, geom, meas, null);
    sig = writeCanvasGuess(st, geom, { ...meas }, sig);
    expect(writes).toBe(1);
    sig = writeCanvasGuess(st, geom, { ...meas, dockX: 500 }, sig);
    expect(writes).toBe(2);
    expect(readCanvasGuess(st, geom).guess.dockX).toBe(500);
  });
  it.each([
    ["not JSON", "{nope"],
    ["null", "null"],
    ["no box", JSON.stringify({ ...geom, dockX: 1, toastCx: null })],
    ["a degenerate box", JSON.stringify({ ...geom, box: { w: 1, h: 1, rawW: 1, rawH: 1 }, dockX: 1, toastCx: null })],
    ["a non-numeric dock edge", JSON.stringify({ ...geom, box: meas.box, dockX: "x", toastCx: null })],
    ["a non-numeric toast centre", JSON.stringify({ ...geom, box: meas.box, dockX: 1, toastCx: "x" })],
  ])("treats %s as no guess", (_n, raw) => {
    const st = mem(); st.setItem(CANVAS_GUESS_KEY, raw);
    expect(readCanvasGuess(st, geom)).toBeNull();
  });
  it("a null toast centre is a valid guess (the toast falls back to the viewport centre)", () => {
    const st = mem(); writeCanvasGuess(st, geom, { ...meas, toastCx: null }, null);
    expect(readCanvasGuess(st, geom).guess.toastCx).toBeNull();
  });
  it("never throws: a missing, throwing or full store is just no guess / no write", () => {
    expect(readCanvasGuess(null, geom)).toBeNull();
    expect(readCanvasGuess({ getItem() { throw new Error("blocked"); } }, geom)).toBeNull();
    expect(writeCanvasGuess({ setItem() { throw new Error("quota"); } }, geom, meas, "x")).toBe("x");
    expect(writeCanvasGuess(null, geom, meas, "y")).toBe("y");
    expect(writeCanvasGuess(mem(), geom, { box: { w: 0, h: 0 }, dockX: 0 }, "z")).toBe("z");   // a degenerate measurement is never remembered
  });
  it("geometryOf reads the window's size and ratio (and a missing pixel ratio is 1)", () => {
    expect(geometryOf({ innerWidth: 10, innerHeight: 20, devicePixelRatio: 2 })).toEqual({ vw: 10, vh: 20, dpr: 2 });
    expect(geometryOf({ innerWidth: 10, innerHeight: 20 })).toEqual({ vw: 10, vh: 20, dpr: 1 });
    expect(geometryOf(null)).toBeNull();
  });
});

describe("wiring (source guards)", () => {
  const sp = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("the module's guess is seeded from the remembered one and persisted from the FULL measurement only", () => {
    expect(sp).toMatch(/let lastMeasuredCanvas = initialCanvasGuess \? initialCanvasGuess\.guess : null/);
    expect(sp).toMatch(/lastMeasuredCanvas = \{ box: canvasBox\(r\), dockX: left, toastCx: cx \}; persistCanvasGuess\(lastMeasuredCanvas\)/);
    // the box-only update (no dock edge / toast centre yet) must never be persisted as if it were a full measurement
    expect(sp).toMatch(/lastMeasuredCanvas = \{ \.\.\.\(lastMeasuredCanvas \|\| \{ dockX: 0, toastCx: null \}\), box: canvasBox\(r\) \};/);
  });
  it("the guess never sets the measured flag (the boot framing's reveal gate is untouched)", () => {
    expect(sp).not.toMatch(/sizeMeasuredRef\.current = true;[^\n]*lastMeasuredCanvas/);
  });
});
