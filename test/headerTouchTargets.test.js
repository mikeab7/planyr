/* NEW-1 (B1343200) — every interactive element in both header strips gets a minimum ~44x44 CSS px
 * tap area, without growing the visible chip. Read `.tap-target`'s own header in index.css for
 * the mechanism (a generated ::after box, centered, floored at 44px on each axis, never smaller
 * than the control's own visible box).
 *
 * ⛔ THE REAL PROOF IS A HIT TEST IN A BROWSER — `ui-audit/verify-header-touch-targets.mjs` reads
 * `getComputedStyle(el, "::after")` for every control this repo ships in the header at several
 * phone widths and asserts the resolved box is >= 44 on both axes. CI cannot run a browser, so
 * this suite guards what CAN be checked without one: the CSS rule's own arithmetic, and — by
 * reading the real source — that the shared primitives (and the header's own bespoke crumb
 * buttons) actually carry the class, so a new control built from them inherits the floor rather
 * than missing it. A markdown note rots; a source guard does not.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("the .tap-target CSS rule itself", () => {
  const css = read("src/index.css");
  const block = css.slice(css.indexOf(".tap-target {"), css.indexOf(".tap-target {") + css.slice(css.indexOf(".tap-target {")).indexOf("}\n\n") + 2);

  it("establishes a positioning context for its own generated content", () => {
    expect(css).toMatch(/\.tap-target\s*\{\s*position:\s*relative;\s*\}/);
  });

  it("floors BOTH axes at 44px and never shrinks below the control's own box", () => {
    expect(block).toContain("width: max(44px, 100%);");
    expect(block).toContain("height: max(44px, 100%);");
  });

  it("centers the generated hit box rather than growing off one edge", () => {
    expect(block).toContain("top: 50%;");
    expect(block).toContain("left: 50%;");
    expect(block).toContain("transform: translate(-50%, -50%);");
  });

  it("is invisible — no border/background/content beyond the empty string", () => {
    expect(block).toMatch(/content:\s*"";/);
    expect(block).not.toMatch(/background:/);
    expect(block).not.toMatch(/border:/);
  });
});

describe("the shared primitives carry the class, so a new control inherits the floor", () => {
  const controls = read("src/shared/ui/controls.jsx");

  it("IconButton — every FullscreenButton/SettingsMenu-style icon control in the header", () => {
    const fn = controls.slice(controls.indexOf("export const IconButton"), controls.indexOf("/* Field —"));
    expect(fn).toMatch(/className=\{className \? `tap-target \$\{className\}` : "tap-target"\}/);
  });

  it("Tab — the module tab strip (Row 2)", () => {
    const fn = controls.slice(controls.indexOf("export function Tab("), controls.indexOf("/* MenuTrigger —"));
    expect(fn).toContain('className={className ? `tap-target ${className}` : "tap-target"}');
  });

  it("MenuTrigger — the account pill / cloud-off trigger / sign-in pill in Row 1's right zone", () => {
    const fn = controls.slice(controls.indexOf("export const MenuTrigger"), controls.indexOf("/* Menu primitives —"));
    expect(fn).toContain('className={className ? `tap-target ${className}` : "tap-target"}');
  });
});

describe("the header's own bespoke chips (not built from a shared primitive) carry the class too", () => {
  const header = read("src/shared/ui/AppHeader.jsx");
  const crumb = read("src/shared/ui/ProjectBreadcrumb.jsx");
  const planner = read("src/workspaces/site-planner/SitePlanner.jsx");
  const badge = read("src/shared/ui/CloudSyncBadge.jsx");

  it("the wordmark button (Row 1, left zone)", () => {
    expect(header).toMatch(/ref=\{wordmarkRef\}\s*\n\s*className="tap-target"/);
  });

  it("the cloud-sync badge (Row 1, right zone)", () => {
    expect(badge).toContain('className="tap-target"');
  });

  it("the Dashboard and project crumbs (Row 1, breadcrumb)", () => {
    expect(crumb).toMatch(/ref=\{dashboardRef\}\s*\n\s*className="tap-target"/);
    expect(crumb).toMatch(/ref=\{anchorRef\}\s*\n\s*className="tap-target"/);
  });

  it("the Site Planner's plan crumb (Row 1, trailing crumb)", () => {
    expect(planner).toContain('className="dbtn tap-target"');
  });
});
