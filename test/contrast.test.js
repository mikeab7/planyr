/* WCAG contrast guard (B321) — every defined theme-token pair must clear its floor
 * (4.5:1 normal text · 3:1 large/graphic) in BOTH light and dark, parsed from the real
 * src/index.css. Documented exceptions (locked brand fills, owner-exempt subtle borders)
 * are allowed as WARN and listed explicitly. This is the programmatic check that the
 * contrast-regression audit replaced eyeballing with — so a future palette edit that
 * re-introduces a low-contrast pair fails here instead of shipping. */
import { describe, it, expect } from "vitest";
import { auditAll } from "../ui-audit/contrast-audit.mjs";

const result = auditAll();

describe("theme token contrast (WCAG AA)", () => {
  for (const theme of ["light", "dark"]) {
    it(`${theme}: no actionable pair below its WCAG floor`, () => {
      const fails = result.themes[theme].fails;
      // Surface the offenders in the assertion message if this ever regresses.
      expect(fails, JSON.stringify(fails, null, 2)).toEqual([]);
    });
  }

  it("documented exceptions stay limited to the locked fills + exempt borders", () => {
    // Guard against new silent WARNs creeping in: only the 3 accepted classes per theme.
    const labels = new Set(
      [...result.themes.light.warns, ...result.themes.dark.warns].map((w) => w.label),
    );
    for (const l of labels) {
      expect(
        /on-fill · (Site|Schedule)|Markup underline|strong border/.test(l),
        `unexpected accepted exception: ${l}`,
      ).toBe(true);
    }
  });
});
