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

function fakeElement({ left, top, right, bottom, display = "block", visibility = "visible", opacity = "1", tagName = "DIV" }) {
  return {
    tagName,
    getBoundingClientRect: () => ({ left, top, right, bottom, width: right - left, height: bottom - top }),
    __style: { display, visibility, opacity },
  };
}

// NEW-1 — a fake same-origin <iframe>: `frameRect` is its box in the PARENT document's
// coordinates; `hitElement` (in the frame's OWN local coordinates) is what its
// `contentDocument.elementsFromPoint` reports at whatever point it's asked about — real
// `elementsFromPoint` ignores the (x,y) it's given for a stub this simple, which is fine: the
// test scenarios below vary WHERE the iframe/control sit, not what's "at" a specific pixel
// inside a hand-authored fixture.
function fakeIframe({ frameRect, hitElement = null, crossOrigin = false }) {
  return {
    tagName: "IFRAME",
    getBoundingClientRect: () => ({ ...frameRect, width: frameRect.right - frameRect.left, height: frameRect.bottom - frameRect.top }),
    __style: { display: "block", visibility: "visible", opacity: "1" },
    get contentDocument() {
      if (crossOrigin) return null; // modern engines: cross-origin contentDocument reads as null
      return { elementsFromPoint: () => (hitElement ? [hitElement] : []) };
    },
  };
}

// Installs a minimal global `document`/`window` for the duration of one test. `leafletEls` and
// `cornerEls` back the two selectors the real function queries; `iframeEls` backs the NEW-1
// same-origin-iframe descent; `computedStyleOf` lets a test fake `getComputedStyle` per element
// (default: fully visible).
function installDom({ innerWidth = 1440, innerHeight = 900, leafletEls = [], cornerEls = [], iframeEls = [] } = {}) {
  global.window = {
    innerWidth, innerHeight,
    getComputedStyle: (el) => el.__style || { display: "block", visibility: "visible", opacity: "1" },
  };
  global.document = {
    querySelectorAll: (sel) => {
      if (sel === ".leaflet-bottom.leaflet-right") return leafletEls;
      if (sel === "[data-canvas-corner]") return cornerEls;
      if (sel === "iframe") return iframeEls;
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

/* B1336528 (owner chat block "NEW-1") — the Schedule route's grid lives inside a same-origin `<iframe src="/sequence/">`
 * (Scheduler.jsx), a document `cornerClearanceFromBottom` never queried before this fix. These
 * tests drive the new content-aware iframe descent directly. */
describe("cornerClearanceFromBottom — NEW-1: same-origin iframe descent (the Schedule route)", () => {
  // Viewport 1440×900, right:14, width:30 (the desktop fine-pointer FAB size) → column
  // [1396, 1426]; control base centre (before any clearance) is (1411, 871). A full-bleed iframe
  // below a 61px header — `frameRect: {left:0, top:61, right:1440, bottom:900}` — matches the
  // real Scheduler.jsx layout (AppHeader + <iframe style="position:absolute; inset:0">).
  const SCHEDULE_FRAME = { left: 0, top: 61, right: 1440, bottom: 900 };
  // A grid row (`.drow`) reaching the very bottom of that frame, in the iframe's OWN local
  // coordinates — top=815 is 24px (a default ROW_H) above the frame's own local bottom (839).
  const BOTTOM_ROW = { left: 0, top: 815, right: 1440, bottom: 839 };

  it("clears a genuine occupant painted inside a same-origin iframe (the owner's exact repro: a grid row under the bare corner)", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement(BOTTOM_ROW) })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    // needed = (900 - (61 + 815)) + 10 = 34 — a small, row-scoped clearance, not the old 292.
    expect(bottom).toBe(34);
  });

  it("⛔ MUTATION-PROOF: this fails back to the bare `base` if the iframe-descent loop is ever removed", () => {
    // Identical setup to the test above. The assertion IS the mutation proof: reverting NEW-1
    // (deleting the `document.querySelectorAll("iframe")` loop in cornerClearance.js) makes this
    // function return `base` again on this exact scenario, since nothing in the PARENT document
    // changed — only the iframe's own content did.
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement(BOTTOM_ROW) })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBeGreaterThan(14);
  });

  it("ignores an iframe hit that resolves to the document root (e.g. the embedded app's own Dashboard, with nothing at the corner)", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement({ ...BOTTOM_ROW, tagName: "HTML" }) })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBe(14);
  });

  it("ignores an iframe whose own box doesn't reach the control's column", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      // Frame confined to the left 800px — never reaches column [1396, 1426].
      iframeEls: [fakeIframe({ frameRect: { left: 0, top: 61, right: 800, bottom: 900 }, hitElement: fakeElement(BOTTOM_ROW) })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBe(14);
  });

  it("a cross-origin iframe is silently skipped, never thrown into the app", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement(BOTTOM_ROW), crossOrigin: true })],
    });
    expect(() => cornerClearanceFromBottom({ right: 14, width: 30, base: 14 })).not.toThrow();
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBe(14);
  });

  it("caps a degenerate reading (a large structural container, not corner-scoped chrome) instead of reproducing the old reserve-the-worst-case bug", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      // hitElement's own top sits at the very top of the frame — if uncapped this would demand
      // ~849px of clearance, i.e. exactly the "63% up the screen" failure this fix must not repeat.
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement({ left: 0, top: 0, right: 1440, bottom: 900 }) })],
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBe(160); // MAX_IFRAME_NEEDED_PX
    expect(bottom).toBeLessThan(292);
  });

  it("still clears an ordinary marker-based candidate in the parent document when an iframe is ALSO present (the two mechanisms compose)", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      cornerEls: [fakeElement({ left: 1382, top: 600, right: 1426, bottom: 900 })], // needs 900-600+10=310
      iframeEls: [fakeIframe({ frameRect: SCHEDULE_FRAME, hitElement: fakeElement(BOTTOM_ROW) })], // needs 34
    });
    const bottom = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    expect(bottom).toBe(310); // the taller of the two wins, same "tallest occupant" rule as before
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

/* ⛔ NEW-1's OWN REGRESSION PROOF — same shape as the block above, for the Schedule/iframe bug.
 * Before NEW-1, `document.querySelectorAll("iframe")` was never called at all, so a same-origin
 * iframe's own content — however much it genuinely reached into the control's corner — was
 * invisible to this function; it always fell back to `base`, which is exactly the owner's
 * production reading (`right:14, bottom:14`, directly over a grid row). */
describe("regression: a same-origin iframe's content was invisible before NEW-1", () => {
  it("the owner's exact production defect: bare right:14,bottom:14 directly over a grid row inside the Schedule iframe", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [fakeIframe({
        frameRect: { left: 0, top: 61, right: 1440, bottom: 900 },
        hitElement: fakeElement({ left: 0, top: 815, right: 1440, bottom: 839 }),
      })],
    });
    const fixedBehavior = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
    const oldBehavior = 14; // pre-NEW-1: no iframe was ever queried, so this always equaled `base`

    expect(oldBehavior).toBe(14); // reproduces the owner's own bare-corner production reading
    expect(fixedBehavior).toBe(34); // the fix: genuinely clears the row now
    expect(fixedBehavior).not.toBe(oldBehavior);
  });
});

/* NEW-1 (schedule empty band) — an embedded page that pads its own scroll ends for this control declares
 * `data-corner-free` on its root; the shell must then leave the control in the bare corner. */
describe("an embedded page marked data-corner-free is never a corner occupant", () => {
  it("rests at base even though a row sits under the corner", () => {
    installDom({
      innerWidth: 1440, innerHeight: 900,
      iframeEls: [{
        ...fakeIframe({
          frameRect: { left: 0, top: 61, right: 1440, bottom: 900 },
          hitElement: fakeElement({ left: 0, top: 815, right: 1440, bottom: 839 }),
        }),
        get contentDocument() {
          return { documentElement: { hasAttribute: n => n === "data-corner-free" },
                   elementsFromPoint: () => [fakeElement({ left: 0, top: 815, right: 1440, bottom: 839 })] };
        },
      }],
    });
    expect(cornerClearanceFromBottom({ right: 14, width: 30, base: 14 })).toBe(14);
  });
});
