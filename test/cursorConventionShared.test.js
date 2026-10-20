/* Cursor convention — SHARED UI slice (owner convention 2026-10-20, docs/DESIGN.md "Cursor convention").
 * Red-proof on the pre-fix tree: the primitives hard-coded `cursor: "pointer"`, NumberBox / RotationStepper /
 * SitePlansSection used `not-allowed`, and nothing in index.css made a disabled control show the arrow.
 * The runtime half (computed cursor at named points, signed in on the deployed build) is
 * ui-audit/verify-cursors-shared.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROTATE_CURSOR, pinDragCursor } from "../src/shared/ui/cursors.js";

const read = (p) => readFileSync(p, "utf8");
const css = read("src/index.css");
const controls = read("src/shared/ui/controls.jsx");

const SLICE = ["src/shared", "src/app", "src/workspaces/library", "src/workspaces/dashboard", "src/workspaces/food",
  "src/workspaces/model", "src/workspaces/admin", "src/workspaces/design-gallery"];
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}
const files = SLICE.flatMap((d) => walk(d));

describe("the stylesheet owns the disabled and busy cursors", () => {
  it("a disabled control shows the arrow, !important, so an inline `cursor: pointer` cannot survive it", () => {
    expect(css).toMatch(/button:disabled,[^{]*\[aria-disabled="true"\][^{]*\{\s*cursor:\s*default\s*!important/);
  });
  it("a disabled control that is WORKING (aria-busy) shows progress", () => {
    expect(css).toMatch(/button:disabled\[aria-busy="true"\][^{]*\{\s*cursor:\s*progress\s*!important/);
  });
  it("native checkbox, radio, select and range show the pointer app-wide when enabled, and range grabs while dragged", () => {
    expect(css).toMatch(/input\[type="checkbox"\]:enabled[^{]*select:enabled[^{]*\{\s*cursor:\s*pointer/);
    expect(css).toMatch(/input\[type="range"\]:enabled:active\s*\{\s*cursor:\s*grabbing/);
  });
  it("Food's Drop-a-pin owns the cursor over everything on the map", () => {
    expect(css).toMatch(/\.food-pin-mode,\s*\.food-pin-mode \*\s*\{\s*cursor:\s*crosshair\s*!important/);
    expect(read("src/workspaces/food/components/FoodMap.jsx")).toMatch(/food-pin-mode/);
  });
});

describe("primitives set pointer only when enabled", () => {
  for (const name of ["ToggleChip", "IconButton", "Tab", "MenuTrigger"]) {
    it(`${name} drops to the arrow when disabled`, () => {
      const start = controls.search(new RegExp(`(function|const) ${name}\\b`));
      expect(start).toBeGreaterThan(-1);
      const body = controls.slice(start, start + 2600);
      expect(body).toMatch(/cursor:\s*rest\.disabled \? "default" : "pointer"/);
    });
  }
  it("no unconditional `cursor: \"pointer\"` is left inside those four", () => {
    for (const name of ["ToggleChip", "IconButton", "Tab", "MenuTrigger"]) {
      const start = controls.search(new RegExp(`(function|const) ${name}\\b`));
      const next = controls.indexOf("\nexport ", start + 10);
      const body = controls.slice(start, next < 0 ? undefined : next);
      expect(body.match(/cursor:\s*"pointer"/g) || []).toEqual([]);
    }
  });
});

describe("nothing in the slice uses not-allowed (a disabled control shows the arrow)", () => {
  it("no file sets cursor: not-allowed", () => {
    const bad = files.filter((f) => /cursor:\s*["']?not-allowed|\.cursor\s*=\s*["']not-allowed/.test(read(f)));
    expect(bad).toEqual([]);
  });
});

describe("shared cursor vocabulary", () => {
  it("ROTATE_CURSOR is an SVG data-URI with a grab fallback", () => {
    expect(ROTATE_CURSOR.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(ROTATE_CURSOR.endsWith(", grab")).toBe(true);
  });
  it("pinDragCursor is a safe no-op without a DOM", () => {
    expect(typeof pinDragCursor("move")).toBe("function");
    expect(() => pinDragCursor("grabbing")()).not.toThrow();
  });
  it("drags that used to flip back to the arrow now pin their cursor", () => {
    const need = {
      "src/shared/ui/FloatingPanel.jsx": 'pinDragCursor("move")',
      "src/workspaces/dashboard/components/PursuitsCard.jsx": 'pinDragCursor("grabbing")',
      "src/workspaces/dashboard/Dashboard.jsx": 'pinDragCursor("grabbing")',
      "src/workspaces/model/components/TabStrip.jsx": 'pinDragCursor("grabbing")',
      "src/workspaces/model/components/SheetView.jsx": 'pinDragCursor("col-resize")',
      "src/shared/comps/components/CompEntryGrid.jsx": 'pinDragCursor("row-resize")',
      "src/shared/sitePlans/components/ImageCropTool.jsx": "pinDragCursor(HANDLE_CURSOR",
    };
    for (const [f, s] of Object.entries(need)) expect(read(f), f).toContain(s);
  });
  it("the floating-panel header is a move cursor, the dock edge a row-resize, the (i) a help cursor", () => {
    expect(read("src/shared/ui/PanelChrome.jsx")).toMatch(/onDragStart \? "move"/);
    expect(read("src/shared/comps/components/CompEntryGrid.jsx")).not.toMatch(/cursor: "ns-resize"/);
    expect(read("src/shared/ui/RowInfo.jsx")).toMatch(/cursor: "help"/);
  });
  it("the window file-drag guard shows no-drop on a dead spot", () => {
    expect(read("src/shared/files/fileDrag.js")).toMatch(/dropEffect = "none"/);
  });
  it("the crop tool shows grab(bing) on every grip while the hand / Space pan is armed", () => {
    const s = read("src/shared/sitePlans/components/ImageCropTool.jsx");
    expect(s).toMatch(/cursor: panCursor \|\| cursor/);
    expect(s).toMatch(/cursor: panCursor \|\| "move"/);
  });
});
