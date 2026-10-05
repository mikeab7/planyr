// B2095123: a visit logged on an OPEN manual pin must appear in Past visits at once. The panel used to
// filter by the `visitIds` snapshot taken at selection time, which cannot contain a later visit.
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const src = readFileSync(new URL("../src/workspaces/food/FoodApp.jsx", import.meta.url), "utf8");
describe("visitsForSelected tracks live visits for a manual pin", () => {
  it("does not filter by the selection-time visitIds snapshot", () => {
    const block = src.slice(src.indexOf("const visitsForSelected"), src.indexOf("const visitsById"));
    expect(block).not.toMatch(/selected\.pin\.visitIds/);
    expect(block).toMatch(/manualGroupKey\(selected\.pin\.name/);
  });
});
