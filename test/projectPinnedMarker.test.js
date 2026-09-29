/* NEW-1 (switcher restyle) — source guards for the dropdown's group labels and pin control.
 *
 * History: B<earlier NEW-1> removed the "Pinned" header and marked each pinned row with a pin icon.
 * The 2026-09-29 restyle REVERSES the icon half on purpose (owner, verbatim spec): the group LABEL
 * ("PINNED" / "RECENT") alone marks the group, NO pin icon is shown on rows at rest, and the pin is a
 * hover/focus-revealed BUTTON at the left of each row's right-hand cluster. The header-with-a-count
 * stays gone — the label carries no count.
 *
 * This is a source-string guard (this repo does not render React through a DOM library in unit
 * tests). The behavioural proof is `ui-audit/verify-project-switcher-restyle.mjs`, which drives the
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

describe("group labels", () => {
  it("renders small PINNED and RECENT section labels (uppercase via CSS, no count)", () => {
    expect(crumb).toMatch(/<div style=\{SECTION_LABEL\}>Pinned<\/div>/);
    expect(crumb).toMatch(/<div style=\{SECTION_LABEL\}>Recent<\/div>/);
    expect(crumb).toMatch(/textTransform: "uppercase"/);
    expect(crumb).not.toMatch(/\{pinnedRows\.length\}<\/span>/);
  });
});

describe("no pin icon at rest", () => {
  it("the old always-on `{isPinned && (<span title=\"Pinned\">…<PinIcon/>)}` marker is gone", () => {
    expect(crumb).not.toMatch(/\{isPinned && \(/);
    expect(crumb).not.toMatch(/title="Pinned"/);
    expect(crumb).not.toMatch(/aria-label="Pinned"/);
  });
  it("the only pin on a row is the hover/focus-revealed button, hidden at rest by CSS", () => {
    expect(body).toMatch(/className="psw-pin"/);
    const css = readFileSync(resolve(here, "../src/index.css"), "utf8");
    expect(css).toMatch(/\.psw-row \.psw-pin \{ opacity: 0;/);
    expect(css).toMatch(/\.psw-row:hover \.psw-pin, \.psw-row:focus-within \.psw-pin \{ opacity: 1; \}/);
  });
});

describe("the pin button", () => {
  it("carries an aria-label, swaps Pin/Unpin, fills the icon when pinned, and does not open the project", () => {
    expect(body).toMatch(/aria-label=\{isPinned \? `Unpin \$\{p\.name\}` : `Pin \$\{p\.name\}`\}/);
    expect(body).toMatch(/<PinIcon size=\{12\} filled=\{isPinned\} \/>/);
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
