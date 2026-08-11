/* NEW-1 / NEW-2 / NEW-3 — the project switcher dropdown: no duplicate controls, one rename entry
 * point that is actually reachable, and real icons.
 *
 * Owner report (2026-08-11): "I don't know that I need an all projects map button because I have
 * that right to the top left right there. And I don't need a rename Clay & Porter right there… there
 * already is the option for the three dots, so I don't need a second option there. And then let's
 * improve the emojis for the rename and delete buttons. They just look kinda like shit."
 *
 * ⛔ THE ONE GUARD THAT IS NOT COSMETIC is the kebab's reachability (NEW-2). Removing the crumb-level
 * rename is only safe BECAUSE the per-row kebab stopped being hover-gated: it used to render solely
 * while `hoverRow === p.id`, so on a touch device there was no rename or delete at all, and for a
 * keyboard user the button was not in the DOM to tab to. Deleting one of two entry points must never
 * leave zero — that is what the removed block's own comment warned about ("invisible, and dead on
 * touch"), and it is why this file asserts presence, not absence, for that control.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// Comments quote the removed markup verbatim (so the next reader knows what NOT to re-add), which
// would satisfy or trip every grep below. Strip them: guards read CODE ONLY.
const code = (p) => readFileSync(resolve(here, p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const crumb = code("../src/shared/ui/ProjectBreadcrumb.jsx");

describe("NEW-1 — the duplicate 'All projects' row is gone from the dropdown", () => {
  it("no dropdown row renders an 'All projects (…)' label", () => {
    expect(crumb).not.toMatch(/All projects \(/);
  });

  it("goDashboard now has exactly ONE caller: the always-visible Dashboard crumb", () => {
    // The row and the crumb called the same handler, inches apart. One call site == one control.
    expect((crumb.match(/onClick=\{goDashboard\}/g) || []).length).toBe(1);
  });

  it("⛔ the 'current' signal the removed row carried is NOT lost — the crumb still carries it", () => {
    // NEW-1 asked this explicitly: if the row conveyed something the crumb doesn't, move the signal
    // rather than lose it. It doesn't — the crumb already answers in the a11y tree AND in colour.
    expect(crumb).toMatch(/aria-current=\{onDash \? "page" : undefined\}/);
    expect(crumb).toMatch(/color: onDash \? INK : MUTED/);
  });
});

describe("NEW-2 — one rename entry point, and it is reachable without a mouse", () => {
  it("the crumb-level 'Rename “…”' row and its test hook are gone", () => {
    expect(crumb).not.toContain("project-rename-current");
    expect(crumb).not.toMatch(/Rename “/);
  });

  it("the per-row kebab still exists, and Rename/Delete still live in its menu", () => {
    expect(crumb).toMatch(/data-testid=\{`project-kebab-\$\{p\.id\}`\}/);
    expect(crumb).toContain('data-testid="project-rename"');
    expect(crumb).toContain('data-testid="project-delete"');
  });

  it("⛔ MUTATION CHECK: the kebab is NOT gated on hover — `canManage && active ?` is gone", () => {
    // The exact pre-fix gate. With it, touch and keyboard users had no rename at all, which is why
    // the crumb-level duplicate could not simply be deleted.
    expect(crumb).not.toMatch(/canManage\s*&&\s*active\s*\?/);
    expect(crumb).toMatch(/\{canManage\s*&&\s*\(/);
  });

  it("hover only changes the kebab's COLOUR — presentation is never the hit-test gate", () => {
    expect(crumb).toMatch(/color: active \? "var\(--text-secondary\)" : "var\(--text-tertiary\)"/);
  });

  it("the row's timestamp / 'current' marker is no longer swapped out BY the kebab", () => {
    // Both render now, side by side; hovering a row used to hide when it was last edited.
    expect(crumb).toMatch(/relTime\(p\.updatedAt\)/);
  });

  it("`editingWhere` is removed, since one id no longer addresses two editors", () => {
    expect(crumb).not.toMatch(/editingWhere/);
    expect(crumb).not.toMatch(/setEditingWhere/);
    expect(crumb).toMatch(/const startRename = \(p\) =>/);   // the `where` parameter is gone too
    expect(crumb).toMatch(/const editing = editingId === p\.id;/);
  });

  it("RenameInput SURVIVES — the per-row rename still uses it", () => {
    expect(crumb).toMatch(/function RenameInput\(/);
    expect(crumb).toMatch(/<RenameInput/);
  });
});

describe("NEW-3 — real SVG icons, inheriting their row's colour", () => {
  it("the pencil and wastebasket glyphs are gone from the manage menu", () => {
    expect(crumb).not.toContain("✎");      // ✎  a TEXT glyph in the UI font
    expect(crumb).not.toContain("\u{1F5D1}");   // 🗑  a COLOUR emoji from the OS font
  });

  it("both are drawn components in this file's existing stroke idiom", () => {
    for (const name of ["PencilIcon", "TrashIcon", "KebabIcon", "CalendarIcon", "WarnIcon"]) {
      expect(crumb).toMatch(new RegExp(`const ${name} = \\(\\{ size`));
      expect(crumb).toContain(`<${name} `.trim().replace(" ", "")); // used, not just defined
    }
    // The whole point: colour comes from the row, so Delete's icon is red because its row is red.
    const icons = crumb.split("const crumbBtn")[0];
    expect((icons.match(/stroke="currentColor"/g) || []).length).toBeGreaterThanOrEqual(5);
  });

  it("Delete's row is still the danger token, so its icon inherits that red", () => {
    expect(crumb).toMatch(/menuItem\(\{ color: "var\(--danger, #dc2626\)" \}\)/);
  });

  it("the ⋯ text ellipsis and the 📅 / ⚠ emoji are gone from this file too", () => {
    expect(crumb).not.toContain("⋯");      // ⋯
    expect(crumb).not.toContain("\u{1F4C5}");   // 📅
    expect(crumb).not.toContain("⚠");      // ⚠
  });

  it("the disclosure triangles are DELIBERATELY left as text glyphs", () => {
    // Owner's own call: "a disclosure triangle as a text glyph is defensible". They are monochrome
    // text on every platform and inherit colour already, so they are not the reported defect.
    expect(crumb).toMatch(/binOpen \? "▾" : "▸"/);
  });
});

describe("NEW-3 (sweep) — the 📍 emoji is gone from every Site Planner control that used it", () => {
  const files = ["LayerPanel", "ParcelRecordPanel", "JurisdictionBadge", "ParcelInfoCard"];
  for (const f of files) {
    it(`${f}.jsx uses PinIcon instead of the emoji`, () => {
      const src = code(`../src/workspaces/site-planner/components/${f}.jsx`);
      expect(src).not.toContain("\u{1F4CD}");
      expect(src).toMatch(/PinIcon/);
      expect(src).toMatch(/from "\.\/icons\.jsx"/);
    });
  }

  it("ParcelInfoCard's ONE status slot no longer mixes an emoji with two text glyphs", () => {
    const src = code("../src/workspaces/site-planner/components/ParcelInfoCard.jsx");
    expect(src).toMatch(/<PinIcon size=\{13\} \/>/);
    expect(src).toMatch(/<EmptyCircleIcon size=\{13\} \/>/);
    expect(src).toMatch(/<WarnTriangleIcon size=\{13\} \/>/);
  });

  it("the icon module stays ROUTE-LOCAL — moving it to shared/ui would charge every route", () => {
    const icons = readFileSync(resolve(here, "../src/workspaces/site-planner/components/icons.jsx"), "utf8");
    expect(icons).toMatch(/Do not move this to `shared\/ui\/`/);
    expect(icons).not.toMatch(/^import /m);   // dependency-free, so it cannot drag a chunk with it
  });
});
