/* The plan menu's contents and its icons — B385042 / B366389 (×2), rewritten by NEW-1 (2026-11-04, the plan crumb dropdown redrawn
 * to the owner-approved mockup).
 *
 * B385042, owner verbatim: *"it says Concept A three times here. Let's fix that. That seems like a waste."* The rule it set
 * (the name may appear as the trigger and as the editable field, never additionally as a read-only label) is REPLACED by:
 * the name appears as the crumb and as the CURRENT ROW — and that row is also the rename control. There is no "Plan name"
 * label and no separate name field any more.
 *
 * B366389 (×2), owner verbatim: *"let's improve the emojis for the rename and delete buttons. They just look kinda like shit."* —
 * the menu stays on ONE icon system (drawn, currentColor), asserted below on the new component.
 *
 * Asserted on the SOURCE because the plan menu lives inside a 28k-line component that a unit test cannot mount; the rendered-DOM
 * half is the e2e spec plan-menu-redesign and the live check (V-plan-menu).
 *
 * RED-PROOF: every "gone" assertion below fails against the pre-redesign source (`plan-name-input`, `save-now`,
 * `storage-menu-item`, a ✕ delete button on every plan row) — they were written to go red on main first.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { plannerSource } from "./helpers/plannerSource.js";

const src = plannerSource();
const icons = readFileSync("src/workspaces/site-planner/components/icons.jsx", "utf8");
const menu = readFileSync("src/workspaces/site-planner/components/PlanMenu.jsx", "utf8");
const bin = readFileSync("src/shared/ui/menuBin.jsx", "utf8");
const crumbApp = readFileSync("src/shared/ui/ProjectBreadcrumb.jsx", "utf8");
// The plan crumb as SitePlanner.jsx declares it, from the declaration to the end of the JSX block.
const crumb = (() => {
  const i = src.indexOf("const plannerPlanCrumb = (");
  return src.slice(i, i + src.slice(i).indexOf("\n  );"));
})();
// Everything that draws the plan menu: the crumb + the component it mounts — CODE only (comments describe what was removed).
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const drawn = stripComments(`${crumb}\n${menu}`);

describe("NEW-1 — the old controls are GONE", () => {
  it("has no 'Plan name' label and no separate name field (testid plan-name-input)", () => {
    expect(drawn).not.toContain("plan-name-input");
    expect(drawn).not.toMatch(/>\s*Plan name\s*</);
    expect(drawn).not.toContain("Plan name</div>");
  });

  it("has no 'Save now' row in the menu (saveNow itself stays — the failure banner's Retry calls it)", () => {
    expect(drawn).not.toContain('data-testid="save-now"');
    expect(drawn).not.toContain("Save now");
    expect(src).toMatch(/onClick=\{saveNow\}[^>]*title="Try saving again now"/);   // the banner's Retry is still wired to it
    expect(src).toContain('data-testid="save-now-msg"');                          // …and its confirmation message
  });

  it("has no 'This device' heading and no 'Storage on this device…' row, and the Storage dialog is retired", () => {
    expect(drawn).not.toContain("storage-menu-item");
    expect(drawn).not.toContain("This device");
    expect(drawn).not.toContain("Storage on this device");
    expect(src).not.toContain("StoragePanel");
    expect(src).not.toContain("setStorageOpen");
    expect(src).not.toContain("storageOpen");
  });

  it("has no ✕ delete button on a plan row (Delete plan is in the ⋯ / right-click menu only)", () => {
    expect(drawn).not.toContain("CloseXIcon");
    expect(drawn).not.toContain('title="Delete this plan"');
    expect(drawn).not.toMatch(/aria-label=\{`Delete plan \$\{/);
  });

  it("has no 'Plans in this site' / 'Recently deleted' SECTION HEADINGS (Recently deleted is a row that opens a view)", () => {
    expect(drawn).not.toContain("Plans in this site");
    expect(drawn).not.toMatch(/textTransform: "uppercase"[^}]*\}\}>Recently deleted/);
  });

  it("no longer mixes the old time-ago text into the bin (the exact time replaces it)", () => {
    expect(menu).not.toContain("relTime(");
    expect(src).not.toContain("relTime(p.deletedAt)");
  });

  it("StoragePanel is gone: the file no longer exists and nothing in src/ imports it (NEW-1, 2026-11-04 — the recordings screen was retired)", () => {
    expect(existsSync("src/shared/storage/StoragePanel.jsx")).toBe(false);
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const f = `${dir}/${n}`;
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
    const importers = walk("src")
      .filter((f) => /\.(jsx?|mjs)$/.test(f))
      .filter((f) => /StoragePanel(\.jsx)?["']/.test(stripComments(readFileSync(f, "utf8"))));
    expect(importers).toEqual([]);
  });

  it("the on-device capture store has ONE writer (the recorder) and no UI reader — only ui-audit harnesses read it, straight from IndexedDB", () => {
    const walk = (dir) => readdirSync(dir).flatMap((n) => {
      const f = `${dir}/${n}`;
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
    const users = walk("src")
      .filter((f) => /\.(jsx?|mjs)$/.test(f) && !f.endsWith("telemetry/perfCaptureStore.js"))
      .filter((f) => /perfCaptureStore(\.js)?["']/.test(stripComments(readFileSync(f, "utf8"))));
    expect(users).toEqual(["src/shared/telemetry/perfRecorder.js"]);
  });
});

describe("NEW-1 — what the new menu DOES have", () => {
  it("keeps the TRIGGER and mounts the one PlanMenu component", () => {
    expect(crumb).toContain('data-testid="plan-crumb"');
    expect(crumb).toContain("<PlanMenu");
    expect(src).toMatch(/import PlanMenu from "\.\/components\/PlanMenu\.jsx";/);
  });

  it("shows the current plan once, as a row that is also the rename control", () => {
    expect(menu).toContain('"plan-current-row"');
    expect(menu).toContain("onDoubleClick={current ? onRenameStart : undefined}");
    expect(menu).toContain('data-testid="plan-rename-input"');
    expect(menu).toMatch(/Enter[\s\S]*finish\(true\)/);
    expect(menu).toMatch(/Escape[\s\S]*finish\(false\)/);
    expect(menu).toContain("{...NO_AUTOFILL}");                       // no browser autofill on the rename field or the Find box
  });

  it("filters only at 8+ plans and says 'No plan by that name.'", () => {
    expect(menu).toContain("showFind(");
    expect(menu).toContain("No plan by that name.");
    expect(menu).toContain('data-testid="plan-find"');
  });

  it("makes the list the ONE scrolling region and the footer unpushable (shared with the project switcher)", () => {
    expect(menu).toContain('<MenuScroll testId="plan-list-scroll"');
    expect(menu).toContain('<MenuFooter testId="plan-footer"');
    expect(bin).toMatch(/minHeight: 0, overflowY: "auto"/);
    expect(crumbApp).toContain("<MenuScroll");                          // ProjectBreadcrumb uses the same pieces — not a third copy
    expect(crumbApp).toContain("<MenuFooter");
    expect(crumbApp).toContain("<BinBackRow");
    expect(menu).toContain("<BinBackRow");
  });

  it("footer order: New plan | Duplicate, then Version history…, then Recently deleted (n) ›", () => {
    const iNew = menu.indexOf('data-testid="plan-new"');
    const iDup = menu.indexOf('data-testid="plan-duplicate"');
    const iVer = menu.indexOf('data-testid="plan-version-history"');
    const iBin = menu.indexOf('data-testid="plan-bin-toggle"');
    expect(iNew).toBeGreaterThan(0);
    expect(iDup).toBeGreaterThan(iNew);
    expect(iVer).toBeGreaterThan(iDup);
    expect(iBin).toBeGreaterThan(iVer);
    expect(menu).toMatch(/count > 0 &&[\s\S]*plan-bin-toggle/);          // the row exists only when n > 0
    expect(menu).toContain("ChevronRightIcon");
  });

  it("the ⋯ button and a right-click open the SAME menu (one item list, one renderer)", () => {
    expect(menu).toContain("onContextMenu=");
    expect(menu).toContain("<MoreButton");
    expect((menu.match(/planMenuItems\(/g) || []).length).toBe(1);      // ONE call site for the item list
    expect((menu.match(/<ItemMenu/g) || []).length).toBe(2);            // the plan menu + the bin's single "Delete forever" item — one renderer
  });

  it("Delete keeps the inline confirm, calls handleDeletePlan, and the lock moved to the current plan's ⋯", () => {
    expect(menu).toContain("→ Recently deleted");
    expect(crumb).toContain("onDeletePlan={handleDeletePlan}");
    expect(crumb).toContain("canLock: planShareState.canLock");
    expect(crumb).toContain("onToggle: togglePlanLock");
  });

  it("rename of any plan goes through the one renamePlanChecked; duplicate of any plan through the one duplicate path", () => {
    expect(src).toMatch(/const renamePlanFromMenu = \(id, v\) => renamePlanChecked\(id, v,/);
    expect(src).toMatch(/const handleDuplicatePlan = \(id\) => \{[^}]*onDuplicateSite\?\.\(id \|\| siteId\)/);
  });

  it("Recently deleted: wrapping names, an exact 'Deleted …' time line, Restore + a ⋯ with Delete forever", () => {
    expect(menu).toContain("deletedLine(");
    expect(menu).toContain('data-testid="deleted-at"');
    expect(menu).toContain('label: "Delete forever"');
    expect(menu).toContain("No restore after this.");
    expect(menu).toContain('"deleted-site-plan-file"');
    expect(menu).toContain("site plan</span>");
  });
});

describe("B366389 (×2) — the plan menu ends up on ONE icon system", () => {
  const EMOJI_AND_GLYPHS = ["💾", "🗄", "🔒", "🔓", "⧉", "＋", "↺", "✕"];

  it("carries no colour emoji and no stand-in text glyphs as icons", () => {
    for (const g of EMOJI_AND_GLYPHS) expect(drawn, `${g} is still used as an icon in the plan menu`).not.toContain(g);
  });

  it("keeps the ▾ disclosure caret on the trigger — a deliberate B366389 decision, not an oversight", () => {
    expect(crumb).toContain("▾");
  });

  const used = ["PadlockIcon", "PlusIcon", "DuplicateIcon", "HistoryIcon", "MoreIcon", "ChevronRightIcon"];
  it("uses the route-local stroke icons, and every one of them is defined", () => {
    for (const name of used) {
      expect(icons, `${name} is not defined in components/icons.jsx`).toMatch(new RegExp(`export const ${name} = `));
      expect(menu, `${name} is not used in the plan menu`).toContain(`<${name}`);
    }
    expect(menu).toMatch(/import \{[^}]*MoreIcon[^}]*\} from "\.\/icons\.jsx"/);
  });

  it("the retired icons are gone from the file (nothing draws them any more)", () => {
    expect(icons).not.toMatch(/export const SaveIcon = /);
    expect(icons).not.toMatch(/export const StorageIcon = /);
  });

  const blocks = () => (icons.match(/export const \w+Icon = [\s\S]*?\n\);/g) || []).filter((b) => used.some((n) => b.startsWith(`export const ${n} = `)));

  it("every icon inherits its ROW's colour — currentColor, never a pinned hex", () => {
    const bs = blocks();
    expect(bs.length).toBe(used.length);
    for (const b of bs) {
      expect(b, b.slice(0, 40)).toContain('="currentColor"');
      expect(b, b.slice(0, 40)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(b, b.slice(0, 40)).toContain("aria-hidden");
    }
  });

  it("scales with its row — every icon takes a `size` prop rather than a fixed px literal", () => {
    for (const b of icons.match(/export const \w+Icon = \(\{[^}]*\}\)/g) || []) {
      if (!used.some((n) => b.startsWith(`export const ${n} = `))) continue;
      expect(b).toContain("size =");
    }
  });
});

describe("NEW-1 — tokens and primitives only (docs/DESIGN.md)", () => {
  it("the new component has no raw hex colour, radius number or font-size number", () => {
    const code = menu.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(code).not.toMatch(/borderRadius:\s*\d/);
    expect(code).not.toMatch(/fontSize:\s*\d/);
  });
});
