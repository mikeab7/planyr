/* NEW-1 (B821280) — the browser tab title names the current module instead of a fixed
 * marketing string. AUDIT-FIRST found exactly one prior `document.title` in the whole app
 * (the static <title> in index.html); no dynamic title code existed before this. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pageTitle } from "../src/app/pageTitle.js";
import { MODULE_TAB_LABEL } from "../src/shared/ui/moduleTabLabel.js";

describe("pageTitle — reads the SAME label the nav tabs render", () => {
  it("names every real workspace by its own nav tab label, with the existing em dash", () => {
    expect(pageTitle({ module: "site-planner" })).toBe("Planyr — Site");
    expect(pageTitle({ module: "scheduler" })).toBe("Planyr — Schedule");
    expect(pageTitle({ module: "doc-review" })).toBe("Planyr — Review");
    expect(pageTitle({ module: "library" })).toBe("Planyr — Library");
    expect(pageTitle({ module: "notes" })).toBe("Planyr — Notes");
  });

  it("falls back to the bare brand for a module with no nav tab (Food, deliberately unlisted)", () => {
    expect(pageTitle({ module: "food" })).toBe("Planyr");
  });

  it("falls back to the bare brand on the unlisted /admin surface, even though route.module resolves to site-planner there", () => {
    expect(pageTitle({ module: "site-planner", isAdmin: true })).toBe("Planyr");
  });

  it("falls back to the bare brand for any module id it doesn't recognize, rather than inventing a label", () => {
    expect(pageTitle({ module: "not-a-real-module" })).toBe("Planyr");
    expect(pageTitle({})).toBe("Planyr");
    expect(pageTitle()).toBe("Planyr");
  });

  it("never appends a plan/project name — module only", () => {
    expect(pageTitle({ module: "site-planner" })).not.toMatch(/\(.*\)|Concept|Plan \d/);
  });

  it("carries every label straight from MODULE_TAB_LABEL — no second hardcoded list", () => {
    for (const [id, label] of Object.entries(MODULE_TAB_LABEL)) {
      expect(pageTitle({ module: id })).toBe(`Planyr — ${label}`);
    }
  });
});

/* Single-source guard: AppHeader's nav tabs must read their label from the SAME table this
 * module reads, so a future nav rename updates the tab title for free instead of drifting. */
describe("AppHeader's module tabs read MODULE_TAB_LABEL — no parallel hardcoded label list", () => {
  const appHeaderSrc = readFileSync(
    fileURLToPath(new URL("../src/shared/ui/AppHeader.jsx", import.meta.url)), "utf8",
  );

  it("imports the shared label table", () => {
    expect(appHeaderSrc).toMatch(/import \{ MODULE_TAB_LABEL \} from "\.\/moduleTabLabel\.js";/);
  });

  it("builds its tab list's label from that table, not a hardcoded string per module", () => {
    expect(appHeaderSrc).toMatch(/label:\s*MODULE_TAB_LABEL\[m\.id\]/);
    // None of the five real labels may appear as a hardcoded `label: "..."` literal anymore.
    for (const label of Object.values(MODULE_TAB_LABEL)) {
      expect(appHeaderSrc).not.toMatch(new RegExp(`label:\\s*"${label}"`));
    }
  });
});

describe("Shell wires the title to the live route, not just the initial load", () => {
  const shellSrc = readFileSync(
    fileURLToPath(new URL("../src/app/Shell.jsx", import.meta.url)), "utf8",
  );

  it("imports pageTitle and sets document.title from it inside a useEffect keyed on the route", () => {
    expect(shellSrc).toMatch(/import \{ pageTitle \} from "\.\/pageTitle\.js";/);
    expect(shellSrc).toMatch(/document\.title\s*=\s*pageTitle\(\{\s*module:\s*active,\s*isAdmin:\s*isAdminHash\s*\}\)/);
  });

  it("the title effect's dep array includes both the module and the admin-route flag, so it re-runs on every client-side route change", () => {
    const m = shellSrc.match(/document\.title\s*=\s*pageTitle\([^)]*\)\s*;\s*\},\s*\[([^\]]*)\]/);
    expect(m, "could not find the title effect's dependency array").toBeTruthy();
    expect(m[1]).toMatch(/active/);
    expect(m[1]).toMatch(/isAdminHash/);
  });
});
