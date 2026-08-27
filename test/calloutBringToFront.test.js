/* NEW-1 (B806080) — "Bring to front" on a callout is inert once an element LABEL covers it.
 *
 * The owner's repro (production, read-only SELECT): a callout's z was already the highest in its
 * band after Bring to Front, and it still could not clear a nearby element's dimension label. The
 * cause is not the z value — it is structural. `test/paintOrder.test.js`'s PAINT_LADDER proves the
 * callout-above band (rung 9) paints over every element (rung 5/6), but element/dimension LABELS
 * (`labelEls`) are rendered in a SEPARATE pass, dead last before the handle layer — after every
 * annotation-above rung, callouts included. No z value a callout can hold changes that, because
 * paint order between the two passes is fixed by render position, not by z.
 *
 * The fix moves `{labelEls}` to render immediately after the element pass (`drawElsZ.above`) and
 * before the annotation-above rungs begin, so a label is treated as belonging to its element's rung
 * rather than sitting above the whole annotation stack. This is a SOURCE guard (document order),
 * exactly like handleLayerOrder.test.js, because the property is about render position, which a
 * screenshot can't see and a re-render can silently change.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

const idx = (re) => {
  const m = SP.search(re);
  if (m < 0) throw new Error(`marker not found: ${re}`);
  return m;
};

describe("NEW-1: element/dimension labels render at the ELEMENT rung, not above the whole annotation stack", () => {
  it("labelEls paints before every annotation-above rung (markup/reference/callout/measure)", () => {
    const iLabels = idx(/\{labelEls\}/);
    const iMarkupAbove = idx(/\{drawMarkupsZ\.filter\(\(m\) => !m\.behindEls\)\.map\(/);
    const iCalloutAbove = idx(/\{calloutBands\.above\.map\(/);
    const iMeasureAbove = idx(/\{measureBands\.above\.map\(/);
    expect(iLabels, "labelEls must render before markups-above").toBeLessThan(iMarkupAbove);
    expect(iLabels, "labelEls must render before callouts-above").toBeLessThan(iCalloutAbove);
    expect(iLabels, "labelEls must render before measurements-above").toBeLessThan(iMeasureAbove);
  });

  it("labelEls paints immediately after the element pass, so it is the element rung's own decoration", () => {
    const iElsAbove = idx(/\{drawElsZ\.above\.map\(/);
    const iLabels = idx(/\{labelEls\}/);
    const between = SP.slice(iElsAbove, iLabels);
    // Nothing that belongs to a LATER rung (the annotation-above passes, or another content .map)
    // may sit between the element pass and its labels — otherwise a label could still end up above
    // an annotation the user explicitly brought forward, recreating the exact defect.
    expect(between).not.toMatch(/drawMarkupsZ|calloutBands\.above|measureBands\.above|overlayBands\.above/);
  });

  it("a callout brought to front is therefore never structurally blocked by an element label — only rung 9 (callout-above) and rung 10 (measure-above) can still outrank it, both documented, not silent", () => {
    const iLabels = idx(/\{labelEls\}/);
    const iCalloutAbove = idx(/\{calloutBands\.above\.map\(/);
    // The callout-above rung must be reachable AFTER labels now — this is the whole fix.
    expect(iCalloutAbove).toBeGreaterThan(iLabels);
  });
});
