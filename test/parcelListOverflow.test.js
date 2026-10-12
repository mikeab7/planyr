/* The armed, read-only overflow self-report for the Parcels panel (B2243424 x4). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("parcel list overflow instrument", () => {
  const panel = readFileSync("src/workspaces/site-planner/components/ParcelsPanel.jsx", "utf8");
  const lib = readFileSync("src/workspaces/site-planner/lib/parcelListOverflow.js", "utf8");
  it("is installed unconditionally and gated at CALL time by the shared diagnostic arm (never at mount)", () => {
    expect(panel).toMatch(/window\.__parcelListOverflow = \(\) => \(isDiagArmed\(\) \? measureListOverflow/);
  });
  it("only reads — it names offenders and writes nothing", () => {
    expect(lib).not.toMatch(/\.style\.|setAttribute|localStorage\.setItem|dispatchEvent/);
    expect(lib).toMatch(/offenders/);
  });
});
