/* NEW-1 — the Site Planner's left module rail never scrolls sideways and its scrollbar never covers a label.
 * The behavioural proof is e2e/left-rail-scrollbar.spec.js (real classic scrollbars, painted); this is the cheap source half that
 * fails the build if the three pieces drift apart: the rail's width constant, the class that reserves the scrollbar gutter, and the
 * rail element that uses both. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { LEFT_RAIL_W, LEFT_RAIL_W_TOUCH } from "../src/workspaces/site-planner/lib/mapChromeStack.js";
import { plannerSource } from "./helpers/plannerSource.js";

const css = fs.readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("left module rail — gutter beside the labels", () => {
  it("the desktop rail is wider than the touch rail by exactly the reserved scrollbar strip (7 + 1 slack)", () => {
    expect(LEFT_RAIL_W - LEFT_RAIL_W_TOUCH).toBe(8);
  });
  it("the stylesheet hides x-overflow, reserves a stable gutter and fixes the scrollbar at 7px for fine pointers", () => {
    expect(css).toMatch(/\.left-rail\s*\{\s*overflow-x:\s*hidden;\s*\}/);
    expect(css).toMatch(/@media \(pointer: fine\)\s*\{[^@]*\.left-rail\s*\{\s*scrollbar-gutter:\s*stable;/);
    expect(css).toMatch(/\.left-rail::-webkit-scrollbar\s*\{\s*width:\s*7px;/);
  });
  it("the rail element carries the class, the width constant and overflow-x hidden — and no literal 54 is left beside it", () => {
    const src = plannerSource();
    expect(src).toMatch(/className="left-rail" data-testid="left-module-rail" style=\{\{ width: leftRailW,/);
    expect(src).toMatch(/overflowY: "auto", overflowX: "hidden"/);
    expect(src).toMatch(/const leftRailW = narrow && coarsePointer \? LEFT_RAIL_W_TOUCH : LEFT_RAIL_W;/);
    expect(src).not.toMatch(/left: 54, top: 0, bottom: 0, zIndex: 1100/);
  });
});
