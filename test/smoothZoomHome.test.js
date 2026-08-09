/* B286000 — WHERE THE SMOOTH-ZOOM SWITCH LIVES, guarded in BOTH directions.
 *
 * B1449 shipped the toggle into the PLAN menu — the flyout that opens off the plan name in the
 * breadcrumb. That menu is otherwise entirely plan-scoped (plan name, plans in this site, New
 * plan, Duplicate, Save now, Version history) and carries no visible label anywhere in the UI,
 * so nothing on screen suggested a rendering preference might be inside it. The owner could not
 * find it. Smooth zoom is a per-DEVICE rendering preference — persisted in localStorage under
 * `smoothZoom`, following neither the plan, the project nor the account — so its home is the
 * on-canvas View menu, where view and rendering behaviour already live.
 *
 * ⛔ A ONE-DIRECTION GUARD WOULD ROT. Asserting only "the toggle is in ViewMenu" passes on a build
 * that renders it in BOTH places, which is the likeliest way this regresses (a merge that keeps
 * both sides). So the absence from the plan menu is asserted as hard as the presence here, and the
 * three things the owner said not to change — the storage key, the default, and the disarm on
 * turn-off — are pinned by value, because a relocation that quietly flips the default is a
 * behaviour change wearing a refactor's clothes.
 *
 * This is a SOURCE guard by necessity: which menu a control sits in is a rendering arrangement
 * inside a React component with nothing pure to call. The behavioural half — the real card, opened
 * and clicked in a browser — is the e2e spec `smooth-zoom-view-menu`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const planner = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
const viewMenu = readFileSync(join(ROOT, "src/workspaces/site-planner/components/ViewMenu.jsx"), "utf8");

/* The plan menu is one `<AnchoredMenu>` inside the `plannerPlanCrumb` block. Slicing it out by
 * name rather than by line number so the guard survives any edit above or below it.
 *
 * Comments are STRIPPED, and that is not cosmetic: the block carries a long note explaining why
 * Smooth zoom left and why Storage stayed, so an un-stripped slice would fail on its own
 * documentation. The question this guard asks is what the menu RENDERS. */
function planMenuSource() {
  const start = planner.indexOf("const plannerPlanCrumb = (");
  expect(start, "plannerPlanCrumb block not found — this guard has lost its subject").toBeGreaterThan(-1);
  const open = planner.indexOf("<AnchoredMenu open={planMenu}", start);
  expect(open, "the plan menu's AnchoredMenu not found").toBeGreaterThan(-1);
  const close = planner.indexOf("</AnchoredMenu>", open);
  expect(close, "the plan menu's AnchoredMenu is unterminated").toBeGreaterThan(open);
  return stripComments(planner.slice(open, close));
}

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

describe("the smooth-zoom switch lives in the View menu", () => {
  it("ViewMenu renders it, under the data-testid every harness addresses", () => {
    expect(viewMenu).toContain('data-testid="smooth-zoom-toggle"');
    expect(viewMenu).toContain("Smooth zoom");
  });

  it("ViewMenu takes the state and the setter as props — it owns no copy of the decision", () => {
    // The persist + disarm pair stays in ONE place (`applySmoothZoom`). A card that wrote
    // localStorage itself would be a second copy of a rule that has to stay identical.
    expect(viewMenu).toMatch(/export default function ViewMenu\(\{[^}]*smoothZoom[^}]*onSmoothZoom[^}]*\}\)/);
    expect(viewMenu).toContain("onChange={(e) => onSmoothZoom(e.target.checked)}");
    expect(viewMenu, "the card must not persist the setting itself").not.toContain("smoothZoom\"");
  });

  it("the planner passes both props to ViewMenu", () => {
    expect(planner).toContain("smoothZoom={smoothZoom} onSmoothZoom={applySmoothZoom}");
  });
});

describe("…and NOT in the plan menu", () => {
  it("the plan menu no longer renders the toggle", () => {
    const menu = planMenuSource();
    expect(menu).not.toContain("smooth-zoom-toggle");
    expect(menu).not.toContain("Smooth zoom");
  });

  it("the toggle's testid appears exactly once in the whole planner + card pair", () => {
    // Belt and braces for the both-places merge: count occurrences rather than trust the slice.
    const hits = (planner + viewMenu).match(/data-testid="smooth-zoom-toggle"/g) || [];
    expect(hits).toHaveLength(1);
  });

  it("Storage on this device stays in the plan menu, and now SAYS it is device-scoped", () => {
    // The deliberate other half of B286000: `StoragePanel` is mounted from this menu because the
    // header gear and AuthPanel land in the entry chunk every route downloads (see
    // src/shared/CLAUDE.md — a lazy stub there cost +0.8 KB on all four routes and breached the
    // Notes route's bundle ceiling). So the row stays and gains a caption instead of moving.
    const menu = planMenuSource();
    expect(menu).toContain('data-testid="storage-menu-item"');
    expect(menu).toContain(">This device</div>");
  });
});

describe("the relocation changed nothing about what the switch DOES", () => {
  it("the localStorage key and the default (on) are untouched", () => {
    expect(planner).toContain('const [smoothZoom, setSmoothZoom] = useState(() => lsGet("smoothZoom", "1") !== "0");');
  });

  it("turning it OFF still disarms the live view anchor, in the same commit", () => {
    // Without this a gesture's scaled frame is left on screen with nothing to re-bake it.
    expect(planner).toMatch(/lsSet\("smoothZoom", nx \? "1" : "0"\);\s*\n\s*if \(!nx\) disarmViewAnchor\(\);/);
  });

  it("the title text a hover shows is carried over verbatim", () => {
    expect(viewMenu).toContain("Zoom scales the drawing as one piece while the wheel is turning, then re-draws it sharp the moment you stop. Turn off to re-draw on every notch instead.");
  });
});
