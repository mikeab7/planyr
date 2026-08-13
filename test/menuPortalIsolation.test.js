/* NEW-1 + NEW-2 — an overlay must own its own input. CI-RUNNABLE HALF.
 *
 * Both defects are interactions, so the real checks live in ui-audit/verify-grid-overlay-input.mjs
 * (12 assertions in a real browser, mutation-proven three ways). What CI can see is the STRUCTURE,
 * and in particular the two ways these fixes rot:
 *   1. the key guard goes back to asking "is an overlay open?" instead of "did this keystroke begin
 *      while one was?" — the difference is exactly the keystroke that dismisses the overlay, which
 *      is the one that caused the bug;
 *   2. a NEW menu is portalled out of a grid cell without the isolation, re-opening the leak for
 *      that menu only. A sweep is the only thing that catches that, because the next menu does not
 *      exist yet.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const seq = readFileSync(resolve(here, "../public/sequence/index.html"), "utf8");

describe("NEW-1 — the key guard asks the right question", () => {
  it("latches the overlay state in CAPTURE, before React or the document handler sees the key", () => {
    expect(seq, "a latch ref must exist").toMatch(/const overlayAtKeyStartRef = useRef\(false\)/);
    const i = seq.indexOf("overlayAtKeyStartRef.current = overlayOpenRef.current");
    expect(i, "the latch must copy the live ref").toBeGreaterThan(-1);
    const block = seq.slice(i - 200, i + 300);
    expect(block, "it must be registered on window in CAPTURE — window capture runs first")
      .toMatch(/addEventListener\("keydown", latch, true\)/);
  });

  it("the grid's key handler consults the latch, not only the live ref", () => {
    // Anchored on the CODE, not on comment prose — a guard pinned to a sentence breaks the moment
    // someone rewords the comment, which says nothing about whether the guard still works.
    expect(seq, "the guard must read BOTH the live ref and the latch")
      .toMatch(/if \(overlayOpenRef\.current \|\| overlayAtKeyStartRef\.current\) return;/);
    // …and the bare form must be gone, or the latch is dead code.
    expect(seq, "the old live-ref-only guard must not survive anywhere")
      .not.toMatch(/if \(overlayOpenRef\.current\) return;/);
  });

  it("the designed feature is still wired — Enter on a picker column opens its picker", () => {
    // Guards the non-regression the browser harness asserts: this must not be deleted as collateral.
    expect(seq, "Enter/F2 on health|status must still fire the trigger")
      .toMatch(/col\.k === "health" \|\| col\.k === "status"[\s\S]{0,400}trigger\?\.click\(\)/);
  });
});

describe("NEW-2 — every menu a grid cell portals out is isolated from the grid", () => {
  it("the shared isolation exists and stops the two grid-arming pointer events", () => {
    const i = seq.indexOf("const MENU_STOPS_GRID");
    expect(i, "the shared bag must exist — one definition, not a per-menu patch").toBeGreaterThan(-1);
    const b = seq.slice(i, i + 400);
    expect(b, "mousedown is what arms drag-select").toMatch(/onMouseDown:\s*e\s*=>\s*e\.stopPropagation\(\)/);
    expect(b, "mouseup completes the drag").toMatch(/onMouseUp:\s*e\s*=>\s*e\.stopPropagation\(\)/);
    // `click` must NOT be stopped here — each menu's own item handlers rely on it.
    expect(b, "click must be left alone or the menus stop working").not.toMatch(/onClick:/);
  });

  /* The sweep. Every menu rendered by a component that lives INSIDE a grid cell must carry the bag:
     its portal escapes to <body> visually but its events still climb the React tree into the cell. */
  const CELL_LEVEL = ["ContactPicker", "HealthPicker", "StatusPicker", "DepCell"];
  it.each(CELL_LEVEL)("%s's portal(s) carry the isolation", (name) => {
    const start = seq.indexOf(`function ${name}(`);
    expect(start, `${name} must exist`).toBeGreaterThan(-1);
    const next = seq.indexOf("\nfunction ", start + 10);
    const body = seq.slice(start, next > -1 ? next : start + 14000);
    const portals = (body.match(/ReactDOM\.createPortal\(/g) || []).length;
    expect(portals, `${name} should portal at least one menu`).toBeGreaterThan(0);
    const isolated = (body.match(/MENU_STOPS_GRID/g) || []).length;
    expect(isolated,
      `${name} portals ${portals} menu(s) but only ${isolated} carry {...MENU_STOPS_GRID} — an ` +
      `un-isolated menu leaks a drag-select into the grid cell underneath it`).toBeGreaterThanOrEqual(portals);
  });

  it("the isolation is observable from a test (the browser harness needs a handle)", () => {
    expect(seq, "menus must be findable by attribute").toMatch(/"data-menu-isolated":\s*"1"/);
  });
});
