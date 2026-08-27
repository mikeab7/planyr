/* NEW-2 (B806081) — placing a callout leader must land wherever the pointer is, buildings, paving,
 * trailer parking and markups included.
 *
 * The owner's repro: "Add Leader" arms `addLeaderFor` and the next canvas click is meant to drop the
 * new leader's tip there (`onBgDown`'s `addLeaderFor` branch). Every element/markup shape renders
 * with `pointerEvents="all"` and its own `onPointerDown` (`startMoveEl` / `startMoveMarkup`), which
 * calls `e.stopPropagation()` before `onBgDown` (bound higher up, on the root <svg>) ever sees the
 * press — so a click over any element or markup silently moved/selected it instead of placing the
 * leader, and the placement could only ever land on blank canvas.
 *
 * The fix is the same shape as `handleStackPick` (B548822) — an existing precedent for "this armed
 * gesture must win over whatever's under the pointer" — intercepted in the CAPTURE phase, which runs
 * before any target's own bubble-phase handler, so it can consume the press before an element/markup
 * gets a chance to stop it. This is a SOURCE guard: the property (captured before any content
 * handler can steal it) is about wiring order, which only a source read or a real browser can prove;
 * the e2e spec drives the real thing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("NEW-2: Add Leader placement wins the press in the CAPTURE phase", () => {
  it("a capture-phase handler for addLeaderFor exists", () => {
    expect(SP).toMatch(/const handleAddLeaderCapture = \(e\) => \{/);
  });

  it("it is wired into onPointerDownCapture, ahead of the stack picker and the vertex-edit capture", () => {
    const wireIdx = SP.search(/onPointerDownCapture=\{\(e\) => \{[^}]*handleAddLeaderCapture/);
    expect(wireIdx, "handleAddLeaderCapture must be called from onPointerDownCapture").toBeGreaterThan(-1);
    const line = SP.slice(SP.indexOf("onPointerDownCapture={(e) =>"), SP.indexOf("onContextMenuCapture="));
    const iAddLeader = line.indexOf("handleAddLeaderCapture");
    const iStackPick = line.indexOf("handleStackPick");
    const iVtxCapture = line.indexOf("onCanvasVtxDownCapture");
    expect(iAddLeader).toBeGreaterThan(-1);
    expect(iAddLeader, "Add Leader must be checked before the stack picker").toBeLessThan(iStackPick);
    expect(iAddLeader, "Add Leader must be checked before the vertex-edit capture").toBeLessThan(iVtxCapture);
  });

  it("it consumes the press (stops propagation) so no element/markup handler underneath can also fire", () => {
    const start = SP.indexOf("const handleAddLeaderCapture = (e) => {");
    const body = SP.slice(start, SP.indexOf("\n  };", start));
    expect(body).toMatch(/e\.stopPropagation\(\)/);
    expect(body).toMatch(/addLeaderToCallout/);
    expect(body).toMatch(/setAddLeaderFor\(null\)/);
  });

  it("the old bubble-phase addLeaderFor branch in onBgDown is retired, not duplicated", () => {
    const bg = SP.slice(SP.indexOf("const onBgDown = (e) => {"), SP.indexOf("const onBgDown = (e) => {") + 4000);
    expect(bg, "addLeaderFor is now handled exclusively in the capture phase").not.toMatch(/if \(addLeaderFor\)/);
  });
});
