/* NEW-1 (switcher, grouped cards) — source guards for the dropdown's NO-LABEL grouping and pin control.
 *
 * History: the #1870 restyle showed small uppercase "PINNED" / "RECENT" labels and a hover-only pin.
 * The grouped-cards follow-up (owner-approved "Option 2b") REMOVES the labels entirely — one card holds
 * every project, pinned first — and makes a PINNED row's pin always visible, filled in the app's green;
 * an UNPINNED row's pin still appears only on hover/keyboard focus (never on touch: Pin/Unpin stays in
 * the three-dot menu there).
 *
 * This is a source-string guard (this repo does not render React through a DOM library in unit
 * tests). The behavioural proof is `ui-audit/verify-project-switcher-cards.mjs`, which drives the
 * real dropdown in a headless browser.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const code = (p) => readFileSync(resolve(here, p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const crumb = code("../src/shared/ui/ProjectBreadcrumb.jsx");
const body = crumb.split("const renderProjectRow")[1];

describe("no section labels", () => {
  it("renders no PINNED / RECENT label, and the label style is gone", () => {
    expect(crumb).not.toMatch(/SECTION_LABEL/);
    expect(crumb).not.toMatch(/>Pinned<\/div>/);
    expect(crumb).not.toMatch(/>Recent<\/div>/);
    expect(crumb).not.toMatch(/project-group-pinned|project-group-recent/);
  });
  it("every project sits in ONE card: current, then pinned, then the rest", () => {
    expect(crumb).toMatch(/data-testid="project-card"/);
    expect(crumb).toMatch(/\[\.\.\.\(currentRow \? \[currentRow\] : \[\]\), \.\.\.pinnedRows, \.\.\.restRows\]/);
  });
});

describe("pin icon", () => {
  it("the old always-on `{isPinned && (<span title=\"Pinned\">…<PinIcon/>)}` marker is still gone — the pin is the BUTTON", () => {
    expect(crumb).not.toMatch(/\{isPinned && \(/);
    expect(crumb).not.toMatch(/title="Pinned"/);
    expect(crumb).not.toMatch(/aria-label="Pinned"/);
  });
  it("a pinned row's pin is always visible and green; an unpinned row's is hover/focus-only and never shown on touch", () => {
    expect(body).toMatch(/className="psw-pin"/);
    expect(body).toMatch(/data-pinned=\{isPinned \? "1" : "0"\}/);
    expect(body).toMatch(/color: "var\(--accent-site\)"/);
    const css = readFileSync(resolve(here, "../src/index.css"), "utf8");
    expect(css).toMatch(/\.psw-row \.psw-pin\[data-pinned="0"\] \{ opacity: 0;/);
    expect(css).not.toMatch(/\.psw-row \.psw-pin \{ opacity: 0;/);
    expect(css).toMatch(/\.psw-row:hover \.psw-pin, \.psw-row:focus-within \.psw-pin \{ opacity: 1; \}/);
    expect(css).toMatch(/@media \(hover: none\) \{ \.psw-row \.psw-pin\[data-pinned="0"\] \{ visibility: hidden; \} \}/);
  });
});

describe("the pin button", () => {
  it("carries an aria-label, swaps Pin/Unpin, fills the icon when pinned, and does not open the project", () => {
    expect(body).toMatch(/aria-label=\{isPinned \? `Unpin \$\{p\.name\}` : `Pin \$\{p\.name\}`\}/);
    expect(body).toMatch(/<PinIcon size=\{13\} filled=\{isPinned\} \/>/);
    expect(body).toMatch(/e\.stopPropagation\(\); togglePinned\(p\.id\)/);
  });
  it("is the FIRST slot of the right cluster: pin, calendar, time, menu — in that order", () => {
    const at = (s) => body.indexOf(s);
    const order = ["style={SLOT_PIN}", "style={SLOT_CAL}", "{ ...SLOT_TIME", "style={SLOT_MENU}"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it("every slot has a fixed width, so the columns line up on every row", () => {
    for (const k of ["SLOT_PIN", "SLOT_CAL", "SLOT_TIME", "SLOT_MENU"]) expect(crumb).toMatch(new RegExp(`const ${k} = \\{ \\.\\.\\.SLOT, width: \\d+`));
  });
  it("the calendar slot is ALWAYS rendered; only its icon is conditional", () => {
    expect(body).toMatch(/<span data-testid=\{`project-slot-cal-\$\{p\.id\}`\} style=\{SLOT_CAL\}>\s*\{p\.scheduleProjectId != null && \(/);
    expect(body).toMatch(/title="Has a schedule"/);
  });
});

describe("nothing else in the row was disturbed", () => {
  it("the per-row kebab, the search box and the Pin item in the kebab menu are all still present", () => {
    expect(body).toMatch(/data-testid=\{`project-kebab-\$\{p\.id\}`\}/);
    expect(crumb).toMatch(/onChange=\{\(e\) => setQ\(e\.target\.value\)\}/);
    expect(crumb).toContain('data-testid="project-pin"');
  });
});
