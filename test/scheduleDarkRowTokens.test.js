/* Schedule page, dark mode (audit batch J3, colour step) — the grid's row colours are theme tokens, not light-only hexes.
 * The "white filler stripes" in the empty grid came from a hard-coded light alternate-row colour; once that was a token the
 * health-tinted rows and the task-name ink (also light-only) had to follow, or the names went dark-on-dark. These checks keep:
 *   1. the light values byte-for-byte what they were (nothing changes in light mode),
 *   2. every dark row tint dark enough for the dark body text to read on it (WCAG AA 4.5:1),
 *   3. the page code reading the tokens, never the old hexes. */
import { describe, it, expect } from "vitest";
import { sequenceHtmlSource, sequenceModulesSource } from "./helpers/sequenceSource.js";

const html = sequenceHtmlSource();
const mods = sequenceModulesSource();

const block = (re) => { const m = html.match(re); expect(m, String(re)).toBeTruthy(); return m[1]; };
const LIGHT = block(/\n:root \{([^}]*)\}/);
const DARK = block(/:root\[data-theme="dark"\] \{([^}]*)\}/);
const tok = (css, name) => { const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`)); expect(m, `--${name}`).toBeTruthy(); return m[1].toLowerCase(); };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const ROW_TOKENS = {
  "row-alt": "#f8fafc", "row-red": "#ffdfdf", "row-yellow": "#fff7b9", "row-green": "#d6fae2",
  "row-paused": "#f3f4f6", "row-focus": "#eff6ff", "row-mover": "#fff8ee", "row-target": "#f3f0ff", "row-create": "#ecfdf3", "gantt-ink": "#1a1a1a",
};

describe("Schedule row colours are theme tokens", () => {
  for (const [name, was] of Object.entries(ROW_TOKENS)) {
    it(`--${name}: light value unchanged, dark value defined`, () => {
      expect(tok(LIGHT, name)).toBe(was);
      expect(tok(DARK, name)).not.toBe(was);
    });
  }
  it("dark body text reads on every dark row tint (AA 4.5:1), and the dark Gantt ink reads on the dark page", () => {
    const txt = tok(DARK, "txt");
    for (const name of Object.keys(ROW_TOKENS).filter((n) => n.startsWith("row-"))) {
      expect(contrast(txt, tok(DARK, name)), `--${name} against --txt`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(tok(DARK, "gantt-ink"), tok(DARK, "bg"))).toBeGreaterThanOrEqual(4.5);
  });
  it("the grid, Gantt and Task Report read the tokens, not the light-only hexes", () => {
    for (const hex of ["#f8fafc", "#ffdfdf", "#fff7b9", "#d6fae2", "#eff6ff", "#fff8ee", "#f3f0ff", "#ecfdf3"]) {
      const used = mods.split("\n").filter((l) => l.includes(`"${hex}"`) && /ri%2|rowBg|isNewTaskFocused|__rv|creating/.test(l));
      expect(used, hex).toEqual([]);
    }
    expect(mods).toMatch(/var\(--row-alt\)/);
    expect(mods).toMatch(/var\(--row-green\)/);
  });
  it("the task name falls back to the theme text colour, and the on-screen Gantt label uses the Gantt ink token (print keeps its dark ink)", () => {
    expect(mods).toMatch(/\(fColor\|\|"var\(--txt\)"\)/);
    expect(mods).toMatch(/color:"var\(--gantt-ink\)"/);
    expect(mods).toMatch(/fill="\$\{GANTT_INK\}"/);   // buildGanttSVG: printed paper stays dark ink in either theme
  });
});
