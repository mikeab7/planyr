/* CommandPalette.jsx row alignment (NEW-2, B1251889, owner report from a real Ctrl+K screen:
 * "Add Sheet, Align Center, All Borders, Bold, Bottom Border double, Clear Formatting — six
 * different left edges"). Every row used to render `<CATEGORY> <command name>` with the category
 * FIRST, at a variable width, so the command name's own starting x drifted row to row.
 *
 * ⛔ THE FIX IS STRUCTURAL, NOT A MEASUREMENT. The command name is now the row's leading flex
 * child (`flex: "1 1 auto"`), directly after the button's own fixed padding — a flex container
 * always starts its first child at the same content-box edge no matter what a LATER sibling (the
 * category, moved to a trailing muted tag beside the shortcut) measures. That is a property of
 * CSS flexbox layout order, not a number this repo could get wrong again the way the old
 * category-first row did — so the guard below proves the DOM ORDER (name text renders before its
 * category text in every row), which is what that property actually depends on, rather than
 * asserting a specific pixel column CI cannot lay out anyway (no jsdom in this vitest config —
 * see vitest.config.js's own header).
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import CommandPalette from "../src/workspaces/model/components/CommandPalette.jsx";
import { COMMANDS, COMMAND_GROUPS, resolveLabel } from "../src/workspaces/model/lib/commandRegistry.js";

const SOURCE = readFileSync(new URL("../src/workspaces/model/components/CommandPalette.jsx", import.meta.url), "utf8");

// Matches react-dom/server's own text-node escaping closely enough for these labels (&, <, >).
function htmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

describe("CommandPalette rows — command name is a single left-aligned column (NEW-2, B1251889)", () => {
  const ctx = {};
  const html = renderToStaticMarkup(createElement(CommandPalette, { open: true, ctx, onClose: () => {} }));

  it("sanity: the palette actually renders its row list", () => {
    expect(html).toContain('data-testid="model-command-palette-list"');
  });

  it("⛔ for every rendered row, the command NAME text appears in the DOM before its CATEGORY tag text — never the reverse", () => {
    const foundGroups = new Set();
    let foundRows = 0;
    for (const cmd of COMMANDS) {
      const rowMarker = `data-testid="model-command-${cmd.id}"`;
      const rowStart = html.indexOf(rowMarker);
      if (rowStart === -1) continue; // RESULT_LIMIT may cut a handful of the 70 registered commands — fine, test what renders
      const rowEnd = html.indexOf("</button>", rowStart);
      expect(rowEnd).toBeGreaterThan(rowStart);
      const rowHtml = html.slice(rowStart, rowEnd);

      const label = resolveLabel(cmd, ctx);
      const category = COMMAND_GROUPS[cmd.group] || cmd.group;
      const labelIdx = rowHtml.indexOf(htmlEscape(label));
      expect(labelIdx).toBeGreaterThan(-1); // the label really is in this row's markup
      // Several labels literally START WITH their own category word ("Number Format: General" /
      // "Number") — searching the WHOLE row for the category text would match INSIDE the label
      // itself and falsely "pass" a same-position read. So the category is only ever a real find
      // if it appears AFTER the label span's own closing tag, in the trailing group.
      const labelSpanEnd = rowHtml.indexOf("</span>", labelIdx);
      expect(labelSpanEnd).toBeGreaterThan(-1);
      const categoryIdx = rowHtml.indexOf(htmlEscape(category), labelSpanEnd);
      expect(categoryIdx).toBeGreaterThan(-1); // the category tag is really there, after the name
      expect(categoryIdx).toBeGreaterThan(labelSpanEnd); // strictly after the name's own span closes
      expect(labelIdx).toBeLessThan(categoryIdx); // and the name comes first, every time

      foundGroups.add(cmd.group);
      foundRows += 1;
    }
    // A vacuous pass (nothing matched, or one lucky group) would prove nothing — require real
    // coverage across most of the registry and most of its 15 category-name lengths.
    expect(foundRows).toBeGreaterThanOrEqual(50);
    expect(foundGroups.size).toBeGreaterThanOrEqual(10);
  });

  it("the fix is the row's flex order, pinned at the source so a reordering regresses loudly even if a future label happens to dodge the DOM-order check above", () => {
    expect(SOURCE).toContain('flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"');
    // The category tag now lives in the TRAILING group alongside the shortcut, not leading the row.
    const labelSpanIdx = SOURCE.indexOf('flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"');
    const groupSpanIdx = SOURCE.indexOf("COMMAND_GROUPS[r.group]");
    expect(labelSpanIdx).toBeGreaterThan(-1);
    expect(groupSpanIdx).toBeGreaterThan(labelSpanIdx);
  });
});

describe("the auto-colour toggle uses American spelling in the palette (NEW-2, B1251889)", () => {
  it("both toggle states say Coloring, never the British 'Colouring'", () => {
    const cmd = COMMANDS.find((c) => c.id === "autocolor-toggle");
    expect(resolveLabel(cmd, { autoColor: true })).toBe("Turn Off Automatic Cell Coloring");
    expect(resolveLabel(cmd, { autoColor: false })).toBe("Turn On Automatic Cell Coloring");
    expect(resolveLabel(cmd, { autoColor: true })).not.toMatch(/Colouring/);
    expect(resolveLabel(cmd, { autoColor: false })).not.toMatch(/Colouring/);
  });
});
