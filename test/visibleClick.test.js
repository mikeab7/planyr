/* B463922 — a driver that scrolls to reach its target is measuring itself, not the product.
 *
 * The browser half of this guard lives in `ui-audit/verify-grid-row-hold.mjs`, which every run aims
 * `visibleClick` at the off-screen toggle the old harness clicked and requires it to REFUSE. This
 * file pins the pure verdict (which cannot run a browser in CI) and keeps the harness honest about
 * using it — a harness that stops calling the gate silently gets the old, false numbers back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibilityVerdict } from "../ui-audit/lib/visibleClick.mjs";

const CONTAINER = { top: 86, bottom: 950 };

describe("visibilityVerdict", () => {
  it("refuses a target rendered ABOVE the viewport — the virtualiser's buffer, the exact B463922 case", () => {
    const v = visibilityVerdict({ y: 11, height: 13 }, CONTAINER);   // 75px above the container top
    expect(v.visible).toBe(false);
    expect(v.reason).toMatch(/ABOVE/);
    expect(v.offset).toBe(-75);
  });

  it("refuses a target BELOW the viewport, which moved the view the other way", () => {
    const v = visibilityVerdict({ y: 945, height: 13 }, CONTAINER);
    expect(v.visible).toBe(false);
    expect(v.reason).toMatch(/BELOW/);
  });

  it("allows a target a human could actually see", () => {
    const v = visibilityVerdict({ y: 400, height: 13 }, CONTAINER);
    expect(v.visible).toBe(true);
    expect(v.offset).toBe(314);
  });

  it("refuses a target that is not rendered at all rather than reporting it visible", () => {
    expect(visibilityVerdict(null, CONTAINER).visible).toBe(false);
    expect(visibilityVerdict({ y: 400, height: 13 }, null).visible).toBe(false);
  });

  it("treats a target flush with either edge as visible (no sub-pixel false refusals)", () => {
    expect(visibilityVerdict({ y: 86, height: 13 }, CONTAINER).visible).toBe(true);
    expect(visibilityVerdict({ y: 937, height: 13 }, CONTAINER).visible).toBe(true);
  });
});

describe("the row-hold harness keeps using the gate", () => {
  const src = readFileSync(new URL("../ui-audit/verify-grid-row-hold.mjs", import.meta.url), "utf8");

  it("routes its clicks through visibleClick", () => {
    expect(src).toMatch(/import \{[^}]*visibleClick[^}]*\} from "\.\/lib\/visibleClick\.mjs"/);
    expect(src).toMatch(/visibleClick\(page, GRID/);
  });

  it("still runs the refusal self-test, so the gate cannot rot green", () => {
    expect(src).toMatch(/self-test/);
    expect(src).toMatch(/REFUSED|allowed an off-screen click/);
  });

  it("carries both witnesses — the model changed, and the selection did not wander", () => {
    expect(src).toMatch(/NOTHING CHANGED/);
    expect(src).toMatch(/the selection moved/);
  });
});
