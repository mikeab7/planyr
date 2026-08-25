/* B385042 + B366389 (×2) — the plan switcher's contents and its icons.
 *
 * B385042, owner verbatim: *"it says Concept A three times here. Let's fix that. That seems like a
 * waste."* The crumb button, the PLAN NAME input and a row in "Plans in this site" all carried the
 * current plan's name at once; on a single-plan site that list is a ONE-ROW list whose only row is
 * the plan being renamed in the field directly above it.
 *
 * B366389 (×2), owner verbatim on the earlier batch: *"let's improve the emojis for the rename and
 * delete buttons. They just look kinda like shit."* That sweep fixed `ProjectBreadcrumb` and the
 * planner's `📍` sites and MISSED this menu, which mixed a full-colour emoji floppy with flat text
 * glyphs in the same list of rows.
 *
 * Both are asserted on the SOURCE because the plan menu lives inside a 28k-line component that a
 * unit test cannot mount; the rendered-DOM half is the live check (V187138 / V187139).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
const icons = readFileSync("src/workspaces/site-planner/components/icons.jsx", "utf8");
// The plan crumb + its AnchoredMenu, from the declaration to the end of the JSX block.
const crumb = (() => {
  const i = src.indexOf("const plannerPlanCrumb = (");
  return src.slice(i, i + src.slice(i).indexOf("\n  );"));
})();

describe("B385042 — the current plan's name appears TWICE, never three times", () => {
  it("keeps the TRIGGER and the EDITOR — the two that are not read-only labels", () => {
    expect(crumb).toContain('data-testid="plan-crumb"');       // the trigger
    expect(crumb).toContain('data-testid="plan-name-input"');  // the editor (the rename affordance)
  });

  it("hides the 'Plans in this site' HEADING when there is nowhere to switch to", () => {
    const line = crumb.split("\n").find((l) => l.includes("Plans in this site"));
    expect(line, "the heading line went missing entirely — it must still render at ≥2 plans").toBeTruthy();
    expect(line).toMatch(/plansHere\.length > 1 && /);
  });

  it("hides the LIST itself too — a heading with no rows is the same waste", () => {
    expect(crumb).toMatch(/plansHere\.length > 1 && plansHere\.map\(/);
  });

  it("does NOT gate on `!cur` — the current plan STAYS in a multi-plan switcher, deliberately", () => {
    /* The argued call (see the comment at the render site): at ≥2 plans this list is also where a
       plan is DELETED and where the `current` marker tells you which of five siblings you are on,
       and it matches the sibling project switcher, whose row list includes the current project.
       At 1 plan the row is a pure echo. Only the echo goes. */
    const rows = crumb.slice(crumb.indexOf("plansHere.map("));
    expect(rows).toMatch(/const cur = s\.id === siteId;/);
    expect(rows).toMatch(/\{cur && <span[^>]*>current<\/span>\}/);
    expect(rows).not.toMatch(/if \(cur\) return null/);
  });
});

describe("B366389 (×2) — the plan menu ends up on ONE icon system", () => {
  const EMOJI_AND_GLYPHS = ["💾", "🗄", "🔒", "🔓", "⧉", "＋"];

  it("carries no colour emoji and no stand-in text glyphs as icons", () => {
    for (const g of EMOJI_AND_GLYPHS) expect(crumb, `${g} is still used as an icon in the plan menu`).not.toContain(g);
    // `↺` is still legitimately used elsewhere in the file (the "set ↺" revert chips), so it is
    // asserted absent HERE rather than repo-wide.
    expect(crumb).not.toContain("↺");
    expect(crumb).not.toContain("✕");
  });

  it("keeps the ▾ disclosure caret — a deliberate B366389 decision, not an oversight", () => {
    expect(crumb).toContain("▾");
  });

  it("uses the route-local stroke icons, and every one of them is defined", () => {
    const used = ["SaveIcon", "HistoryIcon", "StorageIcon", "PadlockIcon", "PlusIcon", "DuplicateIcon", "CloseXIcon"];
    for (const name of used) {
      expect(icons, `${name} is not defined in components/icons.jsx`).toMatch(new RegExp(`export const ${name} = `));
      expect(crumb, `${name} is imported but unused in the plan menu`).toContain(`<${name}`);
    }
    expect(src).toMatch(/import \{[^}]*SaveIcon[^}]*\} from "\.\/components\/icons\.jsx"/);
  });

  // ⛔ TOOLBAR PASS (B727504) — `icons.jsx` now hosts a SECOND, deliberately different icon family
  // (Undo/Redo/ZoomFit/Layers): fill="currentColor" single-path Material Design Icons shapes, not
  // this file's route-local stroke idiom. That's an owner-approved, intentional split — a filled
  // MDI glyph has no stroke to check — so these two assertions scope to the icons the PLAN MENU
  // actually uses (the `used` list above) rather than sweeping every export in the file.
  const planMenuIconBlocks = () => {
    const names = ["SaveIcon", "HistoryIcon", "StorageIcon", "PadlockIcon", "PlusIcon", "DuplicateIcon", "CloseXIcon"];
    const all = icons.match(/export const \w+Icon = [\s\S]*?\n\);/g) || [];
    return all.filter((b) => names.some((n) => b.startsWith(`export const ${n} = `)));
  };

  it("every icon inherits its ROW's colour — currentColor, never a pinned hex", () => {
    const blocks = planMenuIconBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(7); // the 7 names in `used` above, one block each
    for (const b of blocks) {
      expect(b, b.slice(0, 40)).toContain('stroke="currentColor"');
      expect(b, b.slice(0, 40)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(b, b.slice(0, 40)).toContain("aria-hidden");
    }
  });

  it("scales with its row — every icon takes a `size` prop rather than a fixed px literal", () => {
    const names = ["SaveIcon", "HistoryIcon", "StorageIcon", "PadlockIcon", "PlusIcon", "DuplicateIcon", "CloseXIcon"];
    for (const b of icons.match(/export const \w+Icon = \(\{[^}]*\}\)/g) || []) {
      if (!names.some((n) => b.startsWith(`export const ${n} = `))) continue;
      expect(b).toContain("size =");
    }
  });
});
