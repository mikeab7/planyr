/* NEW-1 — boot-time auto-fit races the user's first gesture and silently undoes it.
 *
 * THE BUG. "Reframe when this view becomes active" fires an UNCONDITIONAL requestFit() 120ms
 * after the Site Planner canvas becomes the visible mode. Under real main-thread load (GIS/comp/
 * parcel network congestion right after boot — the owner measured two in-page polling scripts
 * killed by 45s renderer-unresponsive watchdogs immediately after load on planyr.io) that timer's
 * ACTUAL fire time stretches well past 120ms, so it routinely lands AFTER the user has already
 * started zooming or panning — and silently overwrites the gesture ("the map fights back", "a
 * zoom gets undone"). Enumerated every setView(/requestFit( call site in SitePlanner.jsx: this is
 * the ONE that fires with no user action anywhere in its call chain.
 *
 * THE FIX mirrors MapFinder.jsx's pre-existing `userMovedRef`, built for the identical bug class
 * on the app's other Leaflet map: a ref set at the three real view-changing gestures (a real
 * wheel notch, a real pinch move, a drag-pan actually arming past its dead zone), checked before
 * the automatic fit fires. It must NOT be set on a mere click/tap, so USER-INITIATED fits (the
 * "Fit view" button, drawing a parcel, placing a looked-up parcel) are untouched — only the
 * automatic boot-time reframe is gated.
 *
 * TEETH: every assertion below fails on the pre-fix source (the guard ref absent, the effect
 * calling requestFit() unconditionally, none of the three gesture sites setting the flag) — see
 * the mutation check at the bottom, which replays the pre-fix shape and requires the guard test
 * to go red on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC_PATH = fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url));
const src = readFileSync(SRC_PATH, "utf8");

const REFRAME_EFFECT_ANCHOR = "// Reframe when this view becomes active — its real size is known only once shown.";

function reframeEffectBlock(source) {
  const at = source.indexOf(REFRAME_EFFECT_ANCHOR);
  expect(at, "the boot-time reframe effect comment was not found — has it moved or been reworded?").toBeGreaterThan(-1);
  const depsAt = source.indexOf("}, [active]);", at);
  expect(depsAt, "the reframe effect's [active] dependency close was not found").toBeGreaterThan(-1);
  return source.slice(at, depsAt + "}, [active]);".length);
}

describe("NEW-1 — boot-time auto-fit does not race the user's first gesture", () => {
  it("declares a userMovedViewRef guard, initialised false", () => {
    expect(src).toMatch(/const userMovedViewRef = useRef\(false\)/);
  });

  it("the reframe-when-active effect skips requestFit() when the user has already moved the view", () => {
    const block = reframeEffectBlock(src);
    // The automatic fit call must be conditioned on the guard being false.
    expect(block).toMatch(/if\s*\(\s*!userMovedViewRef\.current\s*\)\s*requestFit\(\)/);
    // setViewFramed(true) must still run unconditionally — the opening window still closes even
    // when the automatic fit itself is skipped, or downstream layer-gate logic never unlatches.
    expect(block).toMatch(/setViewFramed\(true\)/);
  });

  it("a real wheel notch sets the guard before the zero-delta early-return", () => {
    const at = src.indexOf("const onWheel = (e) => {");
    expect(at, "the wheel handler was not found").toBeGreaterThan(-1);
    const end = src.indexOf("wrap.addEventListener(\"wheel\"", at);
    const block = src.slice(at, end);
    expect(block).toMatch(/if \(f === 1\) return;[^\n]*\n\s*userMovedViewRef\.current = true;/);
  });

  it("a real pinch move sets the guard", () => {
    const at = src.indexOf("const onTouchMovePinch = (e) => {");
    expect(at, "onTouchMovePinch was not found").toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("\n  };", at));
    expect(block).toMatch(/pinchNextRef\.current = \{[^}]*\};\s*\n\s*userMovedViewRef\.current = true;/);
  });

  it("an armed drag-pan sets the guard — never a mere click/tap that hasn't crossed the dead zone", () => {
    const at = src.indexOf("if (!d.panArmed) armViewAnchor(view.ppf, d.ox, d.oy);");
    expect(at, "the pan-arm site was not found").toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("setView((v) => ({ ...v, offX: d.ox + (e.clientX - d.sx)", at));
    expect(block).toMatch(/d\.panArmed = true;\s*\n\s*userMovedViewRef\.current = true;/);
    // The set must happen strictly AFTER the dead-zone early-return, i.e. inside the same `if
    // (d.mode === "pan")` block, past the `<= PARCEL_CLICK_SLOP_PX) return;` guard — never before
    // it, which would arm on the first pixel of a click that never becomes a pan.
    const modeAt = src.lastIndexOf('if (d.mode === "pan") {', at);
    const slopAt = src.indexOf("PARCEL_CLICK_SLOP_PX) return;", modeAt);
    expect(slopAt).toBeGreaterThan(modeAt);
    expect(at).toBeGreaterThan(slopAt);
  });

  it("user-initiated fits (Fit view button, requestFit elsewhere) remain unconditional", () => {
    // Every OTHER requestFit() call site — user-driven (Fit view button, drawing a parcel,
    // placing a looked-up parcel) — must stay unguarded. Only the boot-time effect above may
    // condition its call on userMovedViewRef.
    const calls = [...src.matchAll(/requestFit\(\)/g)].map((m) => m.index);
    const guardedAt = src.indexOf("if (!userMovedViewRef.current) requestFit();");
    expect(guardedAt).toBeGreaterThan(-1);
    const guardedCallIdx = guardedAt + "if (!userMovedViewRef.current) ".length;
    const others = calls.filter((i) => i !== guardedCallIdx);
    expect(others.length, "expected at least one other, user-initiated requestFit() call site").toBeGreaterThan(0);
    for (const i of others) {
      const line = src.slice(src.lastIndexOf("\n", i) + 1, i);
      expect(line, `requestFit() at ${i} is unexpectedly guarded`).not.toMatch(/userMovedViewRef/);
    }
  });

  it("MUTATION CHECK — replaying the pre-fix shape (unconditional requestFit, no guard set anywhere) fails the guard assertion", () => {
    // This is the teeth proof: strip the guard back out and confirm the SAME regex this suite
    // relies on now reports the pre-fix shape as broken, rather than passing on any input.
    const preFix = src
      .replace(/if \(!userMovedViewRef\.current\) requestFit\(\);/, "requestFit();")
      .replace(/userMovedViewRef\.current = true;\s*\/\/ NEW-1[^\n]*\n/g, "");
    const block = reframeEffectBlock(preFix);
    expect(block).not.toMatch(/if\s*\(\s*!userMovedViewRef\.current\s*\)\s*requestFit\(\)/);
    expect(preFix).not.toMatch(/const onWheel = \(e\) => \{[\s\S]{0,400}userMovedViewRef\.current = true;/);
  });
});
