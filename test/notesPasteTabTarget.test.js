/* notesPasteTabTarget — the collapsed "(Ctrl) ▾" paste tab is a finger-sized target on a touch screen (B2515968).
 *
 * Found by driving the live site in emulated iPhone WebKit (ui-audit/verify-notes-paste-options-phone.mjs): the flyout's buttons
 * had a 44-px coarse-pointer rule, but the tab that OPENS it — the only way to reach the flyout on a phone, there is no Ctrl key —
 * measured 24 px tall. This pins the source rule so the tab cannot fall out of the touch block again; the rendered measurement is the
 * phone harness. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../src/workspaces/notes/components/NoteEditor.jsx", import.meta.url), "utf8");

describe("paste tab touch target", () => {
  const coarse = SRC.split("\n").find((l) => l.includes("@media (pointer: coarse)") && l.includes(".planyr-paste-btn")) || "";
  it("the flyout buttons keep their 44 rule", () => {
    expect(coarse).toMatch(/\.planyr-paste-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  });
  it("the collapsed tab is at least 44 tall under a coarse pointer", () => {
    expect(coarse).toMatch(/\.planyr-paste-tab\s*\{[^}]*min-height:\s*44px/);
  });
});
