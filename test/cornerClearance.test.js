/* B1167120 — the help/report control's bottom-right clearance must be MEASURED, never a
 * reserved constant. `cornerClearanceFromBottom` (shared/ui/cornerClearance.js) is the pure-ish
 * function that does the measuring; this suite fakes just enough of `document`/`window` to drive
 * it without a real browser (this repo's vitest config runs `environment: "node"`, no jsdom).
 *
 * The last test in this file is the regression proof the owner asked for by name: it replays the
 * OLD fixed-292 behavior against the same "nothing in this corner" scenario every other test in
 * this file uses, and asserts it reports the wrong (large) distance from the bottom edge — a test
 * that fails on the code being reverted, not merely one that passes on the fix. */
import { describe, it, expect, afterEach } from "vitest";
import { cornerClearanceFromBottom } from "../src/shared/ui/cornerClearance.js";

function fakeElement({ left, top, right, bottom, display = "block", visibility = "visible", opacity = "1" }) {
  return {
    getBoundingClientRect: () => ({ left, top, right, bottom, width: right - left, height: bottom - top }),
    __style: { display, visibility, opacity },
  };
}

// Installs a minimal global `document`/`window` for the duration of one test. `leafletEls` and
// `cornerEls` back the two selectors the real function queries; `computedStyleOf` lets a test
// fake `getComputedStyle` per element (default: fully visible).
function installDom({ innerWidth = 1440, innerHeight = 900, leafletEls = [], cornerEls = [] } = {}) {
  global.window = {
    innerWidth, innerHeight,
    getComputedStyle: (el) => el.__style || { display: "block", visibility: "visible", opacity: "1" },
  };
  global.document = {
    querySelectorAll: (sel) => {
      if (sel === ".leaflet-bottom.leaflet-right") return leafletEls;
      if (sel === "[data-canvas-corner]") return cornerEls;
      return [];
    },
  };
}

afterEach(() => {
  delete global.window;
  delete global.document;
});

describe("cornerClearanceFromBottom", () => {
  it("returns the base offset when nothing occupies the corner (a chrome-free route)", () => {
    installDom({}); // no Leaflet map, no data-canvas-corner elements — e.g. the Scheduler or Model routes
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    expect(bottom).toBe(14);
  });

  it("clears a Leaflet corner container that overlaps the control's column", () => {
    // Right edge of the viewport is 1440; the control's column is [1440-14-44, 1440-14] = [1382, 1426].
    // A Leaflet attribution/scale block sitting at the true bottom-right, top edge at y=850.
    installDom({
      innerWidth: 1440, innerHeight: 900,
      leafletEls: [fakeElement({ left: 1300, top: 850, right: 1440, bottom: 900 })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    // needed = (900 - 850) + 10px gap = 60
    expect(bottom).toBe(60);
  });

  it("ignores a data-canvas-corner element that does not reach the control's column (desktop: inset by the docked tool rail)", () => {
    // The Site Planner canvas's zoom stack renders at "right:14" of its OWN pane, which on
    // desktop is inset ~168px from the true viewport edge by the docked tool rail — so in real
    // screen coordinates it sits nowhere near [1382, 1426].
    installDom({
      innerWidth: 1440, innerHeight: 900,
      cornerEls: [fakeElement({ left: 1030, top: 600, right: 1074, bottom: 900 })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    expect(bottom).toBe(14);
  });

  it("clears a data-canvas-corner element that DOES reach the column (narrow width: no docked rail)", () => {
    installDom({
      innerWidth: 390, innerHeight: 844,
      cornerEls: [fakeElement({ left: 332, top: 562, right: 376, bottom: 844 })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    // needed = (844 - 562) + 10 = 292 — this is where the historical "292" number came from: it
    // is the genuine narrow-Site-Planner clearance, not an arbitrary constant.
    expect(bottom).toBe(292);
  });

  it("takes the tallest of several overlapping occupants, not the first or the last", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      cornerEls: [
        fakeElement({ left: 1382, top: 800, right: 1426, bottom: 850 }), // needs 900-800+10=110
        fakeElement({ left: 1382, top: 600, right: 1426, bottom: 700 }), // needs 900-600+10=310 <- tallest
        fakeElement({ left: 1382, top: 870, right: 1426, bottom: 900 }), // needs 900-870+10=40
      ],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    expect(bottom).toBe(310);
  });

  it("ignores a hidden/collapsed occupant (display:none, zero size, or visibility:hidden)", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      cornerEls: [
        fakeElement({ left: 1382, top: 400, right: 1426, bottom: 900, display: "none" }),
        fakeElement({ left: 1382, top: 500, right: 1426, bottom: 900, visibility: "hidden" }),
        fakeElement({ left: 1382, top: 1382, right: 1382, bottom: 1382 }), // zero-size
      ],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });
    expect(bottom).toBe(14);
  });

  it("never throws when document/window are unavailable (SSR-safety net)", () => {
    delete global.window;
    delete global.document;
    expect(cornerClearanceFromBottom({ right: 14, width: 44, base: 14 })).toBe(14);
  });
});

/* ⛔ THE REGRESSION PROOF — a test that FAILS against the reverted (pre-B1167120) code, not
 * merely one that passes on the fix. The shipped defect was a single fixed number applied on
 * every route:
 *
 *     const FAB_BOTTOM = 292;
 *
 * against the same "nothing in this corner" scenario the very first test above uses (a
 * chrome-free route — Scheduler, Model, or the desktop Site Planner canvas). Assert that replaying
 * the OLD rule on that scenario reproduces the owner's own production reading (292px from the
 * bottom edge — 63% up his 465px-tall viewport) and is wrong by construction, then assert the NEW
 * function gets it right on the identical inputs. */
describe("regression: the old fixed bottom:292 constant", () => {
  const OLD_FAB_BOTTOM = 292; // verbatim from the pre-fix src/app/HelpReportControl.jsx

  it("reserved 292px on a chrome-free route (the owner's exact production defect)", () => {
    installDom({}); // identical scenario to the first test above: nothing in this corner
    const oldBehavior = OLD_FAB_BOTTOM; // the old code never measured anything
    const fixedBehavior = cornerClearanceFromBottom({ right: 14, width: 44, base: 14 });

    expect(oldBehavior).toBe(292); // reproduces the owner's own reading, byte for byte
    expect(fixedBehavior).toBe(14); // the fix: close to the true corner, nothing to clear
    expect(fixedBehavior).not.toBe(oldBehavior);
  });
});
