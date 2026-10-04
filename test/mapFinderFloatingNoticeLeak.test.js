/* NEW-1 (B1462256, owner screenshot 2026-09-10) — MapFinder's floating notices must never paint
 * over the Site Planner. MapFinder stays MOUNTED when a project's planner is open (only its
 * `visible` prop goes false), and every notice it renders is a `FloatingNotice`, which
 * `createPortal`s to a host appended to `document.body` OUTSIDE MapFinder's own (hidden) DOM
 * subtree — so nothing about MapFinder being invisible stops a portal from painting.
 *
 * The owner's report: inside a project's planner, the bottom-center banner still read the
 * select-parcels guidance ("Click a lot on the map to add it...") for the MAP, because
 * `selectMode` was never reset on LEAVING the map — only on returning to it. The same gap
 * applied to the statewide-backup and cached-snapshot notices, which additionally were never
 * cleared even on return.
 *
 * This is a SOURCE guard (the `handleLayerOrder`/`headerNavPriority` shape in this repo) rather
 * than a render assertion, because MapFinder pulls in Leaflet and is not unit-render-tested; the
 * property under test — every notice call site is gated on `visible`, and the reset effect
 * clears the relevant state on BOTH halves of the map<->plan flip — is exactly what a source
 * read can prove, and what a future notice added here without the gate would violate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const MF = readFileSync(join(here, "../src/workspaces/site-planner/MapFinder.jsx"), "utf8");

describe("NEW-1 (B1462256): every MapFinder FloatingNotice is gated on `visible`", () => {
  // Matches the `{<condition> && (\n  <FloatingNotice` shape every call site in this file uses.
  const CALL_SITE_RE = /\{([^{}]*?)&&\s*\(\s*\n\s*<FloatingNotice/g;

  it("finds all three known call sites (select-parcels tip, backup notice, cached notice)", () => {
    const matches = [...MF.matchAll(CALL_SITE_RE)];
    expect(matches.length, "expected MapFinder to render exactly 3 FloatingNotice call sites").toBe(3);
  });

  it("every <FloatingNotice call site's guarding condition checks `visible` — a future notice added without it fails here", () => {
    const matches = [...MF.matchAll(CALL_SITE_RE)];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      const cond = m[1].trim();
      expect(cond, `condition "${cond}" gates a <FloatingNotice but never checks \`visible\``).toMatch(/\bvisible\b/);
    }
  });

  // NEW-1 (B2041360, owner iPhone screenshot 2026-10-03): `visible` is the map<->plan MODE flip
  // only; leaving the Site WORKSPACE (Dashboard / any module) leaves it true, and the portal then
  // paints over the other module. Every call site must ALSO check `isActive`.
  it("every <FloatingNotice call site's guarding condition ALSO checks `isActive` (the Dashboard-leak guard)", () => {
    for (const m of [...MF.matchAll(CALL_SITE_RE)]) {
      const cond = m[1].trim();
      expect(cond, `condition "${cond}" gates a <FloatingNotice but never checks \`isActive\``).toMatch(/\bisActive\b/);
    }
  });

  it("the Site workspace's two ToastHosts are gated on their active flag too", () => {
    const app = readFileSync(join(here, "../src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");
    const planner = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
    expect(app).toMatch(/\{isActive && <ToastHost toasts=\{statusToasts\}/);
    expect(planner).toMatch(/\{active && <ToastHost toasts=\{toasts\}/);
  });
});

describe("NEW-1 (B1462256): the map<->plan reset effect clears select-mode + both provenance notices on BOTH halves of the flip", () => {
  const effectComment = "Returning to the map (e.g. after committing parcels and planning)";
  const effectStart = MF.indexOf(effectComment);

  it("the reset effect still exists", () => {
    expect(effectStart, "the map<->plan reset effect's comment is gone — did it move or get removed?").toBeGreaterThan(-1);
  });

  it("setSelectMode(false)/setBackupNotice(null)/setCachedNotice(null) run UNCONDITIONALLY on the flip, not only inside `if (visible)`", () => {
    const closeIdx = MF.indexOf("}, [visible]);", effectStart);
    expect(closeIdx).toBeGreaterThan(effectStart);
    const effectBlock = MF.slice(effectStart, closeIdx);

    const ifIdx = effectBlock.indexOf("if (visible)");
    expect(ifIdx, "expected an `if (visible)` branch inside the reset effect").toBeGreaterThan(-1);

    // The three calls must appear BEFORE the `if (visible)` branch — i.e. unconditionally on
    // every flip in either direction — not nested inside it (which would only run on return).
    const unconditionalPart = effectBlock.slice(0, ifIdx);
    expect(unconditionalPart, "setSelectMode(false) must run unconditionally on the flip").toMatch(/setSelectMode\(false\)/);
    expect(unconditionalPart, "setBackupNotice(null) must run unconditionally on the flip").toMatch(/setBackupNotice\(null\)/);
    expect(unconditionalPart, "setCachedNotice(null) must run unconditionally on the flip").toMatch(/setCachedNotice\(null\)/);
  });

  it("stays keyed on `visible` alone (never `isActive`), so peeking another module tab and back never wipes a parcel selection", () => {
    const closeIdx = MF.indexOf("}, [visible]);", effectStart);
    const effectBlock = MF.slice(effectStart, closeIdx + 20);
    expect(effectBlock).not.toMatch(/\}, \[visible, isActive\]/);
    expect(effectBlock).toMatch(/\}, \[visible\]\);/);
  });
});
