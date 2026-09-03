/* B1076480 — AnchoredMenu's full-viewport click-away backdrop used to close only on `onClick`,
 * which per spec fires ONLY for the primary (left) mouse button. A right-click anywhere on that
 * backdrop — e.g. aimed at a DIFFERENT trigger while one AnchoredMenu-based dropdown was already
 * open — produced no `click` at all, so the backdrop never closed and the browser's own
 * `contextmenu` hit-test resolved to the backdrop (topmost, full-viewport) instead of whatever was
 * actually underneath: a silent dead right-click, live-reproduced on the Model workspace's own
 * (now-replaced) point-anchor use of this component. `onMouseDown` fires for every button and
 * precedes the native `contextmenu` event, so closing there clears the backdrop from the DOM in
 * time for the real target to receive the click.
 *
 * Asserted on the SOURCE, not a DOM render: AnchoredMenu is a portal + layout-effect-driven
 * component with no lightweight mount path in this suite (see planMenuChrome.test.js for the same
 * reasoning) — the live-browser behavior is covered by e2e/model-spreadsheet.spec.js's B1076480
 * suite, which mutation-proved this exact fix (reverting AnchoredMenu.jsx alone leaves those
 * specs green, because the Model context menu no longer routes through this component at all —
 * this source guard is what actually pins the fix down for AnchoredMenu's OTHER consumers:
 * button dropdowns, the account menu, ribbon flyouts, anything else built on this primitive).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/shared/ui/AnchoredMenu.jsx", "utf8");

// The backdrop div: the click-away layer, identified by its own comment + `data-menu-owner`.
const backdropLine = src.split("\n").find((l) => l.includes("!hoverSafe && pos &&") && l.includes("data-menu-owner"));

describe("B1076480 — AnchoredMenu's click-away backdrop dismisses on ANY mouse button, not left-click only", () => {
  it("the backdrop div exists and is gated on pos/hoverSafe as before (sanity)", () => {
    expect(backdropLine, "could not find the click-away backdrop div — did it move or get renamed?").toBeTruthy();
  });

  it("wires BOTH onClick and onMouseDown to onClose — onClick alone is the exact regression", () => {
    expect(backdropLine).toMatch(/onClick=\{onClose\}/);
    expect(backdropLine).toMatch(/onMouseDown=\{onClose\}/);
  });
});
