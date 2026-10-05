// A saved plan can carry an element whose `type` is no longer in planStyle's TYPE table (legacy
// "line" setback markers on e2e-fixture-testfit). Reading `.label` off TYPE[type] unguarded crashed
// the whole Site Planner on open ("Cannot read properties of undefined (reading 'label')").
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("SitePlanner never reads TYPE[<element type>].label unguarded", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("every TYPE[el|selEl.type] label read is optional-chained", () => {
    const bad = src.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /TYPE\[(?:el|selEl)\.type\]\.label/.test(l));
    expect(bad.map(([n]) => n)).toEqual([]);
  });
});

describe("the draw list skips elements of an unknown type", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  it("drawEls filters on TYPE[el.type]", () => {
    const block = src.slice(src.indexOf("const drawEls = useMemo"), src.indexOf("/* ------------ grid lines"));
    expect(block).toMatch(/TYPE\[el\.type\]/);
  });
});
