import { describe, it, expect } from "vitest";
import { pickScaleBar, screenFurniturePlates } from "../src/workspaces/site-planner/lib/sheetFurniture.js";
// The corner-placement + SVG-string tier now lives in its own module so it rides the LAZY
// export chunk instead of the Site route's boot chunk (see sheetFurnitureLayout.js's header).
// Same functions, moved — every assertion below is unchanged.
import { furnitureLayout, buildSheetFurnitureSvg, buildScreenFurnitureSvg, chooseFurnitureCorners } from "../src/workspaces/site-planner/lib/sheetFurnitureLayout.js";

const NICE = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

// A letter-landscape framed export at a typical working zoom: ppf = 0.5 px/ft, so
// ftPerUnit = 2 ft/unit. A letter sheet (11×8.5 in) → user-unit frame of the same
// aspect; pick a width that represents a realistic site (~1800 ft wide here).
const frame = { x: 100, y: 50, w: 900, h: 695, ftPerUnit: 2 };

describe("pickScaleBar — round distance that fills a band without clipping (NEW-1)", () => {
  it("snaps to a round NICE step", () => {
    const { feet } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(NICE).toContain(feet);
  });

  it("never exceeds the hard ceiling (so the bar can't run off the frame)", () => {
    for (const ppf of [0.05, 0.1, 0.25, 0.5, 1, 2, 4]) {
      const { lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: 1 / ppf });
      // ceiling defaults to 0.30·frameW; allow the documented exception only when even
      // the smallest 10-ft step overflows (extreme zoom-in).
      const tenFt = 10 * ppf;
      if (tenFt <= frame.w * 0.3) expect(lengthU).toBeLessThanOrEqual(frame.w * 0.3 + 1e-6);
    }
  });

  it("lengthU is feet expressed in user units (feet / ftPerUnit)", () => {
    const { feet, lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(lengthU).toBeCloseTo(feet / frame.ftPerUnit, 6);
  });

  it("lands inside a sensible band for a normal export (≈10–30% of the frame width)", () => {
    const { lengthU } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    expect(lengthU).toBeGreaterThan(frame.w * 0.1);
    expect(lengthU).toBeLessThan(frame.w * 0.3 + 1e-6);
  });

  it("zoomed way out picks a large step; zoomed way in picks a small step", () => {
    const out = pickScaleBar({ frameW: frame.w, ftPerUnit: 40 }).feet; // 1 unit = 40 ft
    const inn = pickScaleBar({ frameW: frame.w, ftPerUnit: 0.1 }).feet; // 1 unit = 0.1 ft
    expect(out).toBeGreaterThan(inn);
  });
});

describe("screenFurniturePlates — the on-screen scale bar shrinks with a narrow pane (NEW-3)", () => {
  const ftPerUnit = 1; // 1 canvas user unit == 1 ft, a mid zoom
  const fmtFeet = (n) => String(Math.round(n));

  it("omitting paneW keeps the old fixed 130/240 ceilings exactly (every pre-existing caller)", () => {
    const withPaneW = screenFurniturePlates({ ftPerUnit, fmtFeet, paneW: 5000 }); // absurdly wide — never binds
    const withoutPaneW = screenFurniturePlates({ ftPerUnit, fmtFeet });
    expect(withPaneW.scaleBar.plateW).toBeCloseTo(withoutPaneW.scaleBar.plateW, 6);
  });

  it("a wide (desktop) pane is byte-identical to the fixed ceiling — Math.min never binds there", () => {
    const desktop = screenFurniturePlates({ ftPerUnit, fmtFeet, paneW: 1440 });
    const noPane = screenFurniturePlates({ ftPerUnit, fmtFeet });
    expect(desktop.scaleBar.plateW).toBeCloseTo(noPane.scaleBar.plateW, 6);
  });

  it("a narrow pane shrinks the bar continuously — no second breakpoint", () => {
    let prevW = Infinity;
    for (let paneW = 900; paneW >= 240; paneW -= 20) {
      const { scaleBar } = screenFurniturePlates({ ftPerUnit, fmtFeet, paneW });
      expect(scaleBar.plateW).toBeLessThanOrEqual(prevW + 1e-6);
      prevW = scaleBar.plateW;
    }
  });

  it("at 390px the plate is a small fraction of the pane — the reported \"more than half\" defect", () => {
    const paneW = 390;
    const { scaleBar } = screenFurniturePlates({ ftPerUnit, fmtFeet, paneW });
    expect(scaleBar.plateW).toBeLessThan(paneW * 0.35);
  });
});

describe("furnitureLayout — both plates sit wholly inside the safe area (no clip)", () => {
  const L = furnitureLayout(frame);
  const left = frame.x, right = frame.x + frame.w, top = frame.y, bot = frame.y + frame.h;

  it("north arrow is anchored top-left at the inset and fits inside the frame", () => {
    expect(L.north.tx).toBeCloseTo(frame.x + L.inset, 6);
    expect(L.north.ty).toBeCloseTo(frame.y + L.inset, 6);
    expect(L.north.tx + L.north.plateW).toBeLessThan(right - L.inset + 1e-6);
    expect(L.north.ty + L.north.plateH).toBeLessThan(bot - L.inset + 1e-6);
  });

  it("scale bar is anchored bottom-right at the inset and fits inside the frame", () => {
    expect(L.scaleBar.tx + L.scaleBar.plateW).toBeCloseTo(right - L.inset, 6);
    expect(L.scaleBar.ty + L.scaleBar.plateH).toBeCloseTo(bot - L.inset, 6);
    expect(L.scaleBar.tx).toBeGreaterThan(left + 1e-6);
    expect(L.scaleBar.ty).toBeGreaterThan(top + 1e-6);
  });

  it("the two plates don't overlap (arrow top-left, bar bottom-right)", () => {
    const a = { x: L.north.tx, y: L.north.ty, w: L.north.plateW, h: L.north.plateH };
    const b = { x: L.scaleBar.tx, y: L.scaleBar.ty, w: L.scaleBar.plateW, h: L.scaleBar.plateH };
    const disjoint = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
    expect(disjoint).toBe(true);
  });

  it("the arrow is a modest ~0.35 in tall on a letter sheet (≈0.05 of the short side)", () => {
    expect(L.north.arrowH).toBeCloseTo(L.refS * 0.05, 6);
  });

  it("the whole north plate stays compact (≤ ~0.10 of the short side, not the old ~0.11+)", () => {
    // NEW-1: the plate must hug its glyph, not balloon ~30% past it.
    expect(L.north.plateH).toBeLessThan(L.refS * 0.1);
  });

  it("the scale bar encodes a real round distance as user units (feet / ftPerUnit)", () => {
    expect(NICE).toContain(L.feet);
    expect(L.lengthU).toBeCloseTo(L.feet / frame.ftPerUnit, 6);
  });
});

describe("buildSheetFurnitureSvg — renders the expected sheet furniture", () => {
  const svg = buildSheetFurnitureSvg({ ...frame, fmtFeet: (n) => String(n), pal: { ink: "#111", muted: "#888", panelLine: "#ccc" } });

  it("emits two anchored groups (scale bar + north arrow)", () => {
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(2);
  });

  it("includes the FEET unit label and the N marker", () => {
    expect(svg).toContain(">FEET<");
    expect(svg).toContain(">N<");
  });

  it("draws four alternating bar segments and three tick labels (0 / mid / max)", () => {
    const { feet } = pickScaleBar({ frameW: frame.w, ftPerUnit: frame.ftPerUnit });
    // 4 bar segments + 1 scale plate + 1 north plate = 6 rects
    expect((svg.match(/<rect /g) || []).length).toBe(6);
    expect(svg).toContain(`>${feet}<`);   // max label
    expect(svg).toContain(`>${feet / 2}<`); // midpoint label
    expect(svg).toContain(">0<");          // start label
  });

  it("does not draw a circular compass rose (simple arrow only)", () => {
    expect(svg).not.toContain("<circle");
  });

  it("north-up by default leaves the arrow unrotated; a bearing rotates it", () => {
    expect(svg).not.toContain("rotate(");
    const turned = buildSheetFurnitureSvg({ ...frame, bearingDeg: 30 });
    expect(turned).toContain("rotate(-30");
  });
});

// The owner's iPhone-night-mode report: the scale bar + north arrow plate stayed a fixed
// near-white regardless of theme while ink/muted/panelLine already followed it, so a dark-mode
// session got theme-correct (light) numerals drawn on a plate that never got any darker.
import { scaleBarPlate, northArrowPlate } from "../src/workspaces/site-planner/lib/sheetFurniture.js";

describe("plate fill follows the caller's theme, and print gets a safe fallback (NEW-1)", () => {
  const m = { pad: 8, fs: 11, unitFs: 9, barTh: 6, tickLen: 4, rx: 6, plateStroke: 1, segStroke: 1, nFs: 12, arrowW: 14, arrowH: 30 };

  it("scaleBarPlate paints the plate rect with pal.plateFill when given one", () => {
    const dark = scaleBarPlate({ lengthU: 100, feet: 200, m, pal: { plateFill: "rgba(1,2,3,0.9)" } });
    // the FIRST rect emitted is the plate itself (the bar segments/ticks/text follow)
    const firstRect = dark.markup.match(/<rect[^>]*\/>/)[0];
    expect(firstRect).toContain('fill="rgba(1,2,3,0.9)"');
  });

  it("northArrowPlate paints the plate rect with pal.plateFill when given one", () => {
    const dark = northArrowPlate({ m, pal: { plateFill: "rgba(1,2,3,0.9)" } });
    const firstRect = dark.markup.match(/<rect[^>]*\/>/)[0];
    expect(firstRect).toContain('fill="rgba(1,2,3,0.9)"');
  });

  it("no pal.plateFill (the print/export path) falls back to the fixed light print plate, never blank/transparent", () => {
    const printed = scaleBarPlate({ lengthU: 100, feet: 200, m, pal: {} });
    const firstRect = printed.markup.match(/<rect[^>]*\/>/)[0];
    expect(firstRect).toMatch(/fill="rgba\(249,\s*248,\s*244,\s*0\.84\)"/);
  });

  it("the alternating 'unfilled' bar segment reads as the PLATE colour, never a hardcoded #fff — " +
    "so it can never read as near-identical to a theme-following light ink", () => {
    const dark = scaleBarPlate({ lengthU: 100, feet: 200, m, pal: { plateFill: "rgba(24,27,33,0.93)", ink: "#E8EBF0" } });
    expect(dark.markup).not.toContain('fill="#fff"');
    expect(dark.markup).toContain('fill="rgba(24,27,33,0.93)"');
  });

  // Source guard: the PDF/PNG export must never hand the furniture the app's LIVE theme PAL —
  // a printed sheet has to stay paper-colored even when the app was in dark mode at Download time.
  it("exportSheet.js never passes the live theme PAL into the furniture composition", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/lib/exportSheet.js", import.meta.url), "utf8");
    const i = src.indexOf("buildSheetFurnitureSvg(");
    expect(i).toBeGreaterThan(-1);
    const call = src.slice(i, src.indexOf(");", i));
    expect(call).not.toMatch(/pal:\s*PAL\b/);
  });
});

describe("chooseFurnitureCorners — no-occlude placement (NEW-1)", () => {
  const fr = { x: 0, y: 0, w: 1000, h: 800, inset: 20 };
  const bar = { plateW: 200, plateH: 70 };
  const north = { plateW: 70, plateH: 90 };

  it("with no obstacles, defaults to bar=br / north=tl (historical layout)", () => {
    const p = chooseFurnitureCorners({ ...fr, bar, north, obstacles: null });
    expect(p.bar.corner).toBe("br");
    expect(p.north.corner).toBe("tl");
  });

  it("places furniture away from plan content, in two different corners", () => {
    // A building occupying the center + bottom-right (where the bar would default).
    const obstacles = [{ x: 350, y: 300, w: 600, h: 480 }];
    const p = chooseFurnitureCorners({ ...fr, bar, north, obstacles });
    expect(p.bar.corner).not.toBe(p.north.corner);
    // the bottom-right is occupied, so the bar must avoid it
    expect(p.bar.corner).not.toBe("br");
  });

  it("the chosen corners actually overlap content less than the occupied corner would", () => {
    const obstacles = [{ x: 600, y: 450, w: 400, h: 350 }]; // fills bottom-right
    const p = chooseFurnitureCorners({ ...fr, bar, north, obstacles });
    const barBox = { x: p.bar.tx, y: p.bar.ty, w: bar.plateW, h: bar.plateH };
    const ov = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    expect(ov(barBox, obstacles[0])).toBe(0); // a clear corner exists and was chosen
  });
});

describe("buildScreenFurnitureSvg — on-screen furniture anchored to the viewport", () => {
  const vw = 1280, vh = 720, ftPerUnit = 2; // 1 px = 2 ft (ppf 0.5)
  const svg = buildScreenFurnitureSvg({ vw, vh, ftPerUnit, fmtFeet: (n) => String(n), pal: {} });

  it("renders the same furniture (two groups, FEET + N, no rose)", () => {
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(2);
    expect(svg).toContain(">FEET<");
    expect(svg).toContain(">N<");
    expect(svg).not.toContain("<circle");
  });

  it("snaps the bar to a round distance for a ~130 px target", () => {
    const { feet, lengthU } = pickScaleBar({ ftPerUnit, targetU: 130, maxU: Math.min(240, vw * 0.4) });
    expect(NICE).toContain(feet);
    expect(lengthU).toBeLessThanOrEqual(240 + 1e-6);
    expect(svg).toContain(`>${feet}<`);
  });

  it("anchors both plates above the status bar, inside the viewport", () => {
    const ys = [...svg.matchAll(/translate\([\d.]+,([\d.]+)\)/g)].map((m) => Number(m[1]));
    // both group origins sit above the bottom gap (40 px) and on-screen
    for (const y of ys) { expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(vh - 40 + 1e-6); }
  });
});

// ── B881 / NEW-1: bottom furniture never overlaps in a narrowed map pane ──────
import { calibBadgePlacement } from "../src/workspaces/site-planner/lib/sheetFurniture.js";

describe("calibBadgePlacement — badge/scale-bar/zoom never collide at any pane width (B881)", () => {
  const badgeH = 24;
  // Boxes in "px from the pane's bottom-left"; y measured UP from the bottom.
  const box = { badge: (p, badgeW) => ({ x: p.left, w: (p.maxWidth != null ? Math.min(badgeW, p.maxWidth) : badgeW), y: p.bottom, h: badgeH }) };
  const scaleBarBox = (paneW, sbW, sbH) => ({ x: paneW - 14 - sbW, w: sbW, y: 40, h: sbH });
  const zoomBox = (paneW) => ({ x: paneW - 44, w: 30, y: 100, h: 90 }); // three 30px zoom buttons
  const overlap = (a, b) => {
    const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    return ox * oy;
  };

  it("keeps the original bottom:40 row layout when the pane is wide", () => {
    const p = calibBadgePlacement({ paneW: 1200, badgeW: 240, scaleBarW: 160, scaleBarH: 32 });
    expect(p.raise).toBe(false);
    expect(p.bottom).toBe(40);
    expect(p.left).toBe(56);
    expect(p.maxWidth).toBeNull();
  });

  it("never raises before the badge is measured (badgeW=0)", () => {
    const p = calibBadgePlacement({ paneW: 260, badgeW: 0, scaleBarW: 150, scaleBarH: 32 });
    expect(p.raise).toBe(false);
  });

  it("lifts the badge to its own row when it would meet the scale bar", () => {
    const p = calibBadgePlacement({ paneW: 280, badgeW: 240, scaleBarW: 150, scaleBarH: 32 });
    expect(p.raise).toBe(true);
    expect(p.bottom).toBe(40 + 32 + 2);         // clears the bar below
    expect(p.bottom + 24).toBeLessThanOrEqual(100); // clears the zoom controls above (start at 100)
    expect(p.maxWidth).toBeGreaterThan(0);
  });

  it("produces ZERO overlap among badge / scale bar / zoom across the whole width range", () => {
    for (let paneW = 240; paneW <= 1200; paneW += 5) {
      for (const badgeW of [120, 160, 200, 240, 260]) {
        for (const sbW of [120, 150, 200, 240]) {
          const sbH = 32;
          const p = calibBadgePlacement({ paneW, badgeW, scaleBarW: sbW, scaleBarH: sbH });
          const b = box.badge(p, badgeW);
          expect(overlap(b, scaleBarBox(paneW, sbW, sbH))).toBeLessThanOrEqual(1);
          expect(overlap(b, zoomBox(paneW))).toBeLessThanOrEqual(1);
          // and the badge stays within the pane's right edge
          expect(b.x + b.w).toBeLessThanOrEqual(paneW + 1e-6);
        }
      }
    }
  });
});

/* ------------------------------------------ where a transient canvas pill may sit (the Apply toast)
 *
 * "The banner doesn't need to pop up in the middle of the site, it's a little too centered."
 *
 * The Standards Apply toast was viewport-centred (left:50%, translateX(-50%)), which put it in the
 * optical middle of the plan, over the buildings — and, being viewport-anchored, it could sit over
 * an open side panel. It is now anchored to the CANVAS pane, bottom-left, stacked clear of every
 * piece of bottom furniture. This is that stacking rule.
 */
import { canvasPillBottom } from "../src/workspaces/site-planner/lib/sheetFurniture.js";

describe("canvasPillBottom — the toast clears the north arrow, scale bar and calibration badge", () => {
  it("clears the TALLEST piece of furniture on the bottom row", () => {
    expect(canvasPillBottom({ northH: 44, scaleBarH: 32 })).toBe(40 + 44 + 10);
    expect(canvasPillBottom({ northH: 20, scaleBarH: 32 })).toBe(40 + 32 + 10);
  });
  it("clears the calibration badge when one is showing", () => {
    expect(canvasPillBottom({ northH: 20, scaleBarH: 20, calibBottom: 40, calibH: 26 })).toBe(40 + 26 + 10);
  });
  it("clears the calibration badge even when it has LIFTED to its own row above the bar", () => {
    const lifted = calibBadgePlacement({ paneW: 400, badgeW: 300, scaleBarW: 160, scaleBarH: 32 });
    expect(lifted.raise).toBe(true);
    expect(canvasPillBottom({ northH: 20, scaleBarH: 32, calibBottom: lifted.bottom }))
      .toBeGreaterThan(lifted.bottom + 20);
  });
  it("no calibration badge → the badge never contributes", () => {
    expect(canvasPillBottom({ northH: 44, scaleBarH: 32, calibBottom: null })).toBe(94);
  });
  it("is always a positive offset inside the pane, never a viewport centre", () => {
    expect(canvasPillBottom({})).toBeGreaterThan(0);
  });
});

/* Placement guard at the source: the toast must be anchored to the canvas pane, never re-centred
 * on the viewport. (The exact regression: position:fixed; left:50%; transform:translateX(-50%).) */
describe("the Standards Apply toast is anchored to the canvas, not the viewport", () => {
  it("renders absolutely inside the pane, low and to one side", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const i = src.indexOf('data-testid="standards-apply-toast"');
    expect(i).toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf("</div>", i));
    expect(block).toContain('position: "absolute"');
    expect(block).toContain("canvasPillBottom(");
    expect(block).not.toContain('left: "50%"');
    expect(block).not.toContain("translateX(-50%)");
    expect(block).not.toContain('position: "fixed"');
  });
});

/* ------------------------------------------ the calibration badge matches the scale-bar card (B1795456)
 *
 * "The green 'Scaled · county GIS' badge … is the only map-overlay control that does not match the
 * rest of the chrome." Option B: the badge's container reuses the scale-bar card's OWN background,
 * border and radius — not a resemblance, a shared derivation. `mapChromeCardStyle` is that shared
 * function; these tests prove its output is literally what `scaleBarPlate`/`northArrowPlate` paint
 * into their SVG `<rect>` (a computed-style assertion's SVG-side equivalent — an inline `fill`/
 * `stroke`/`rx` attribute IS that element's rendered/"computed" style, there being no separate CSS
 * cascade to resolve for an SVG presentation attribute set inline).
 */
import { mapChromeCardStyle, MAP_CHROME_REF_S, furnitureMetrics } from "../src/workspaces/site-planner/lib/sheetFurniture.js";

function firstRectAttrs(markup) {
  const m = markup.match(/^<rect[^>]*\brx="([^"]+)"[^>]*\bfill="([^"]+)"[^>]*\bstroke="([^"]+)"/);
  if (!m) throw new Error("no plate <rect> found in markup");
  return { rx: Number(m[1]), fill: m[2], stroke: m[3] };
}

describe("mapChromeCardStyle — the badge's chrome literally equals the scale-bar card's, both themes", () => {
  const themes = [
    { name: "light", pal: { plateFill: "rgb(249, 248, 244)", panelLine: "#dcd5c4", ink: "#2c2a26", muted: "#8a8473" } },
    { name: "dark", pal: { plateFill: "rgb(24, 27, 33)", panelLine: "#3a3f4a", ink: "#e7e5df", muted: "#9a9890" } },
  ];

  for (const { name, pal } of themes) {
    it(`${name} theme: background + border colour + radius match the scale-bar card's rendered <rect>`, () => {
      const m = furnitureMetrics(MAP_CHROME_REF_S);
      const sb = scaleBarPlate({ lengthU: 100, feet: 100, m, pal });
      const rect = firstRectAttrs(sb.markup);
      const chrome = mapChromeCardStyle(pal);
      expect(chrome.background).toBe(rect.fill);
      expect(chrome.borderColor).toBe(rect.stroke);
      expect(chrome.borderRadius).toBeCloseTo(rect.rx, 6);
    });

    it(`${name} theme: the compass (north arrow) plate uses the SAME background + border colour as the badge`, () => {
      const m = furnitureMetrics(MAP_CHROME_REF_S);
      const na = northArrowPlate({ m, pal });
      const rect = firstRectAttrs(na.markup);
      const chrome = mapChromeCardStyle(pal);
      expect(chrome.background).toBe(rect.fill);
      expect(chrome.borderColor).toBe(rect.stroke);
    });
  }

  it("uses the SAME refS the on-screen furniture itself defaults to (not a second, independent guess)", () => {
    expect(MAP_CHROME_REF_S).toBe(540); // screenFurniturePlates' own default `refS`
  });

  it("falls back to the same plate-fill / panel-line constants scaleBarPlate falls back to (no pal supplied)", () => {
    const withoutPal = mapChromeCardStyle();
    const m = furnitureMetrics(MAP_CHROME_REF_S);
    const sb = scaleBarPlate({ lengthU: 100, feet: 100, m });
    const rect = firstRectAttrs(sb.markup);
    expect(withoutPal.background).toBe(rect.fill);
    expect(withoutPal.borderColor).toBe(rect.stroke);
  });
});

describe("the calibration badge — one dot, chrome container, no stray literals (source guard)", () => {
  it("the badge's JSX block uses mapChromeCardStyle for its container, not a hardcoded fill/RADIUS.pill", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    const commentStart = src.indexOf("calibration / accuracy badge");
    expect(commentStart).toBeGreaterThan(-1);
    // Scope the CODE checks below to the `cfg`/JSX body only — the preceding explanatory
    // comment legitimately names the retired "●"/"▲" glyph and "RADIUS.pill" in prose.
    const start = src.indexOf("const cfg = {", commentStart);
    expect(start).toBeGreaterThan(commentStart);
    // The badge's own IIFE ends at the first "})()}" after its opening comment.
    const end = src.indexOf("})()}", start);
    expect(end).toBeGreaterThan(start);
    const block = src.slice(start, end);
    expect(block).toContain("mapChromeCardStyle(PAL)");
    expect(block).not.toMatch(/borderRadius:\s*RADIUS\.pill/); // the old fully-rounded capsule
    expect(block).not.toMatch(/rgba\(22,\s*101,\s*52/); // the old solid-green fill
    expect(block).not.toMatch(/rgba\(180,\s*83,\s*9/); // the old solid-amber fill
    // exactly one literal circular "dot" (width/height + borderRadius: 99) — the coloured
    // status dot — never a second one reintroduced alongside it.
    const dotMatches = block.match(/width:\s*7,\s*height:\s*7,\s*borderRadius:\s*99/g) || [];
    expect(dotMatches.length).toBe(1);
    // the decorative "●"/"▲" glyph that used to double the dot is gone from the badge's own
    // cfg/JSX (it may still be named in the explanatory comment above `start`, which this
    // slice deliberately excludes).
    expect(block).not.toContain("●");
    expect(block).not.toContain("▲");
  });
});
