/* B1106256 (was B1076480's backdrop-based guard) — AnchoredMenu no longer dismisses via a
 * full-viewport interactive backdrop element at all: that backdrop was itself the mechanism that
 * swallowed a left-click aimed at a control underneath it (NEW-1, B1106256 — "a click next to an
 * open menu is swallowed"). It is replaced by a document-level, CAPTURE-phase `mousedown` listener
 * that isn't a hit-test target, so it can never stand between a press and the real element beneath
 * it. This test used to assert the backdrop wired BOTH `onClick` and `onMouseDown` to `onClose` (the
 * B1076480 fix); it now asserts the REPLACEMENT mechanism carries the same guarantee — every mouse
 * button dismisses, not just the left one — plus that the backdrop shape is actually gone, so a
 * regression back to a rendered click-away layer is caught here rather than rediscovered live.
 *
 * Asserted on the SOURCE, not a DOM render: AnchoredMenu is a portal + layout-effect-driven
 * component with no lightweight mount path in this suite (see planMenuChrome.test.js for the same
 * reasoning) — the live-browser behavior is covered by e2e/model-spreadsheet.spec.js's B1076480
 * suite (right-click) and by the NEW-1 click-swallow regression spec (left-click while a menu is
 * open), both mutation-proven against AnchoredMenu.jsx alone.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/shared/ui/AnchoredMenu.jsx", "utf8");

describe("B1106256 — AnchoredMenu dismisses via a document listener, never a hit-test-blocking backdrop", () => {
  it("renders no full-viewport click-away backdrop element — a single portalled div, not a backdrop-plus-panel pair", () => {
    // The old shape was two sibling JSX nodes inside the portal: a backdrop `<div onClick={onClose}
    // onMouseDown={onClose} ... style={{ position: "fixed", inset: 0, zIndex }} />` plus the panel
    // `<div ref={menuRef} ...>`. `onClick={onClose}` in JSX (as opposed to `onClose?.()` inside the
    // dismiss handler) only ever appeared on that backdrop; `data-menu-owner` is now stamped on
    // exactly one rendered node (the panel).
    expect(src).not.toMatch(/onClick=\{onClose\}/);
    const ownerAttrCount = (src.match(/data-menu-owner=\{ownerScope\}/g) || []).length;
    expect(ownerAttrCount).toBe(1);
  });

  it("wires a document-level mousedown listener, in the CAPTURE phase, to close on an outside press", () => {
    expect(src).toMatch(/document\.addEventListener\("mousedown",\s*onDown,\s*true\)/);
  });

  it("the listener excludes the panel and the anchor — a re-press of the menu's own trigger isn't double-handled", () => {
    expect(src).toMatch(/panel\s*&&\s*panel\.contains\(e\.target\)/);
    expect(src).toMatch(/anchor\s*&&\s*anchor\.contains\(e\.target\)/);
  });

  it("closes by calling onClose, never by calling preventDefault/stopPropagation on the real event", () => {
    // The whole point of the fix: the underlying press must still reach its own target natively.
    const dismissEffect = src.slice(src.indexOf("const onDown = (e) => {"), src.indexOf("document.addEventListener(\"mousedown\", onDown, true)"));
    expect(dismissEffect).toMatch(/onClose\?\.\(\)/);
    expect(dismissEffect).not.toMatch(/preventDefault/);
    expect(dismissEffect).not.toMatch(/stopPropagation/);
  });
});
