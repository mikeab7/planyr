/* B1173(×2) — FULLSCREEN KEEPS BOTH HEADER ROWS, and NEW-4 — Settings has sections.
 *
 * Two source guards over `AppHeader` and `AuthPanel`, both of which are pure rendering arrangement
 * with nothing to call. The behavioural halves are `e2e/module-keepalive.spec.js` (fullscreen,
 * driven in a real browser) and the ui-audit harness `verify-new1-fullscreen.mjs`.
 *
 * ⛔ WHY A SOURCE GUARD IS WORTH HAVING HERE ANYWAY. The failure this repo has actually shipped
 * twice is a MERGE that keeps both sides — the reveal machinery coming back alongside the
 * always-visible header, giving one header two opinions about where it is. That is invisible to a
 * screenshot (the header is visible either way, until you move the pointer) and cheap to catch by
 * counting.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const header = read("src/shared/ui/AppHeader.jsx");
const authPanel = read("src/workspaces/site-planner/components/AuthPanel.jsx");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const headerBody = stripComments(header);
const authBody = stripComments(authPanel);

describe("the header does not move, hide or slide in fullscreen", () => {
  it("has ONE style for the <header>, with no fullscreen branch", () => {
    expect(headerBody).toContain('style={{ flex: "none", background: CHROME, borderBottom: `1px solid ${LINE}`, position: "relative", zIndex: 60 }}');
    // The three mechanisms that used to take it off screen, each asserted absent by name. The
    // `position: fixed` check is scoped to the <header> tag itself — the two banners below it
    // (fullscreen-refused, cross-tab-conflict) are floating notices positioned by the shared
    // FloatingNotice primitive (B1000400), not by a `position: "fixed"` literal in this file.
    const tag = headerBody.slice(headerBody.indexOf("<header"), headerBody.indexOf("data-fullscreen=") + 60);
    expect(tag).not.toContain('position: "fixed"');
    expect(headerBody).not.toContain("translateY(-100%)");
    expect(headerBody).not.toContain("fsReveal");
  });

  it("keeps no reveal timers, and no pointermove listener to drive them", () => {
    expect(headerBody).not.toContain("FS_EDGE_PX");
    expect(headerBody).not.toContain("FS_ARM_MS");
    expect(headerBody).not.toContain("FS_HIDE_MS");
    expect(headerBody).not.toContain("FS_HOLD_PX");
    expect(headerBody).not.toContain("pointermove");
  });

  it("drops the floating exit button — the row-1 toggle is the one exit control", () => {
    expect(headerBody).not.toContain("exit-fullscreen");
    expect(headerBody).toContain('data-testid="toggle-fullscreen"');
    expect(headerBody).toContain('aria-pressed={active}');
  });

  it("still REPORTS the mode, so a check can prove exactly one header claims it", () => {
    expect(headerBody).toContain('data-fullscreen={fullscreen ? "on" : undefined}');
  });

  it("both rows are still rendered unconditionally — module tabs included", () => {
    // The tabs are built once and used by both Row-2 layouts; a `fullscreen &&` anywhere near
    // them is the regression this line exists for.
    expect(headerBody).toContain("const moduleTabButtons = visibleModules.map(");
    expect(headerBody).not.toMatch(/\{\s*!?fullscreen\s*&&\s*moduleTabButtons/);
  });
});

describe("a refused fullscreen request is LOUD, because there is no fallback left", () => {
  it("says so instead of hiding the chrome", () => {
    expect(headerBody).toContain('setFsNotice("Your browser wouldn\'t allow full screen here.")');
    expect(headerBody).toContain('data-testid="fullscreen-refused"');
    // The old fallback set fullscreen state on rejection; that is now a lie about the document.
    expect(headerBody).not.toMatch(/requestFs\(\)\.catch\(\(\) => \{ nativeFsRef\.current = false; setFullscreen\(true\); \}\)/);
  });

  it("no longer fights Escape anywhere — the browser owns it in the only mode that exists", () => {
    expect(headerBody).not.toContain('e.key === "Escape"');
  });
});

describe("NEW-4 — Settings has an information architecture", () => {
  it("declares four named sections, and change password is not one of the front doors", () => {
    for (const id of ["profile", "team", "security", "interface"]) {
      expect(authBody).toContain(`id: "${id}"`);
    }
    expect(authBody).toContain('label: "Account & security"');
  });

  it("the account menu's Settings row lands on Interface, NOT on the password form", () => {
    expect(authBody).toContain('const SECTION_ALIAS = { settings: "interface", profile: "profile", team: "team" };');
  });

  it("change password lives INSIDE Account & security", () => {
    const start = authBody.indexOf('data-settings-panel="security"');
    expect(start).toBeGreaterThan(-1);
    const end = authBody.indexOf('data-settings-panel="interface"');
    expect(end).toBeGreaterThan(start);
    expect(authBody.slice(start, end)).toContain("Change password");
    // …and not in the Interface section, which is the front door.
    expect(authBody.slice(end)).not.toContain("Change password");
  });

  it("Account & security carries a REAL action beside it — an empty section never ships", () => {
    expect(authBody).toContain('data-testid="sign-out-everywhere"');
    expect(authBody).toContain("signOutEverywhere");
    // ⛔ And no "active sessions" list: enumerating sessions needs the service-role admin API,
    // which may never reach the browser. Furniture pretending to be a security feature is worse
    // than an honest absence.
    expect(authBody).not.toContain("Active sessions");
  });

  it("Interface holds the app-not-drawing preferences, from the shared component", () => {
    const iface = authBody.slice(authBody.indexOf('data-settings-panel="interface"'));
    expect(iface).toContain("<InterfaceSettings />");
  });

  it("the old three-tab row is gone — Profile and Team are sections, not peers of 'Settings'", () => {
    expect(authBody).not.toContain('tabBtn("settings", "Settings")');
    expect(authBody).toContain('aria-label="Settings sections"');
  });
});
