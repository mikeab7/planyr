// B2257584 — the placement-handles <svg> must never be 0x0: a zero-size outer svg disables rendering of
// its children (SVG spec), so the dashed frame, corner squares, rotate diamond and readout were never
// painted in a real browser although the invisible grips still answered presses.
import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/workspaces/site-planner/lib/overlayPlacementHandles.js", import.meta.url), "utf8");

test("placement-handles svg has a non-zero size", () => {
  const m = src.match(/svgEl\("svg",\s*\{([^}]*)\}/);
  expect(m).toBeTruthy();
  expect(m[1]).not.toMatch(/width:\s*0\b/);
  expect(m[1]).not.toMatch(/height:\s*0\b/);
  expect(m[1]).toMatch(/width:\s*[1-9]/);
  expect(m[1]).toMatch(/height:\s*[1-9]/);
});
