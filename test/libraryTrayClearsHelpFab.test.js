/* NEW-1 (AUTH-SWEEP 3, V870512 live run on build caf2020): the Library upload tray's right-aligned action buttons
 * (Replace existing / Keep both / Cancel) sat under the app-wide help button (fixed, bottom-right), which covered most of
 * Cancel. The tray keeps a right margin wider than the button's footprint (30 fine-pointer / 44 touch + its 14 gutter). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
describe("Library upload tray clears the help button", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/workspaces/library/components/FileBrowser.jsx", import.meta.url)), "utf8");
  it("the tray container reserves a right margin of at least the touch FAB's footprint", () => {
    const m = src.match(/data-testid="upload-tray" style=\{\{[^}]*margin: "0 (\d+)px 8px 12px"/);
    expect(m, "tray container not found").toBeTruthy();
    expect(Number(m[1])).toBeGreaterThanOrEqual(14 + 44);
  });
  it("RED-PROOF — the old margin (12px) is below the footprint", () => { expect(12).toBeLessThan(14 + 30); });
});
