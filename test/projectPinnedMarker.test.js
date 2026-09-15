/* NEW-1 — the project switcher dropdown's "Pinned" section header + count are gone; every
 * pinned row now carries its own small pin icon instead.
 *
 * Owner report: the dropdown opened from the project name in the top breadcrumb rendered a
 * section header row reading "Pinned" with a count on the right (2 on his account). Ask: drop
 * the header + count entirely, mark each pinned project's row with a pin icon instead. Pinned
 * projects keep their position/ordering; the separator that used to sit under the header stays,
 * so the grouping still reads without the text label.
 *
 * This file is a source-string regression guard, same shape as projectSwitcherChrome.test.js
 * (this repo doesn't render React components through a DOM library in its unit tests — the real
 * DOM/behavioral proof is the headless browser harness at
 * ui-audit/verify-project-pinned-marker.mjs, which drives the real dropdown, seeds pinned
 * projects via the same account-prefs mirror the app itself writes, and asserts the rendered DOM
 * directly: no "Pinned" text node, no count element, each pinned row's pin icon carrying its
 * accessible name, and the project name ORDER unchanged).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const code = (p) => readFileSync(resolve(here, p), "utf8")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const crumb = code("../src/shared/ui/ProjectBreadcrumb.jsx");

describe("NEW-1 — the 'Pinned' section header + count are gone from the dropdown", () => {
  it("no dropdown row renders the literal 'Pinned' section-header text", () => {
    // The removed header rendered a dedicated <span>Pinned</span> label; that literal text node
    // must not appear anywhere in the file any more (comments are stripped above).
    expect(crumb).not.toMatch(/>Pinned</);
  });

  it("⛔ MUTATION CHECK: the exact removed header markup (icon + 'Pinned' label + count span) is gone", () => {
    // The pre-fix shape, verbatim, so a recurrence is caught even if reworded slightly.
    expect(crumb).not.toMatch(/fontWeight: 700, color: "var\(--text-primary\)" \}\}>Pinned<\/span>/);
    expect(crumb).not.toMatch(/color: "var\(--text-tertiary\)", fontWeight: 700, fontSize: 10\.5 \}\}>\{pinnedRows\.length\}<\/span>/);
  });

  it("the separator that used to sit under the header is kept, so the grouping still reads", () => {
    // pinnedRows.length > 0 still renders exactly one boundary divider after the pinned rows.
    expect(crumb).toMatch(/\{pinnedRows\.length > 0 && \(/);
    expect(crumb).toMatch(/<div style=\{divider\} \/>/);
  });
});

describe("NEW-1 — every pinned row carries its own pin icon instead", () => {
  it("renderProjectRow computes isPinned from the live pinnedIds list", () => {
    expect(crumb).toMatch(/const isPinned = pinnedIds\.includes\(p\.id\);/);
  });

  it("the pin icon renders inside the row, gated on isPinned, ahead of the project name", () => {
    const body = crumb.split("const renderProjectRow")[1];
    expect(body).toMatch(/\{isPinned && \(/);
    // The icon carries an accessible name AND a tooltip, since the visible text label is gone.
    expect(body).toMatch(/title="Pinned"/);
    expect(body).toMatch(/aria-label="Pinned"/);
    expect(body).toMatch(/<PinIcon size=\{11\} \/>/);
  });

  it("the marker sits BEFORE the truncatable name span (icon leads, name follows)", () => {
    const body = crumb.split("const renderProjectRow")[1];
    const pinIdx = body.indexOf('aria-label="Pinned"');
    const nameIdx = body.search(/>\s*\{p\.name\}\s*</);
    expect(pinIdx).toBeGreaterThan(-1);
    expect(nameIdx).toBeGreaterThan(-1);
    expect(pinIdx).toBeLessThan(nameIdx);
  });
});

describe("NEW-1 — nothing else in the row was disturbed", () => {
  it("the 'current' marker, the per-row kebab, and the calendar chip are all still present", () => {
    const body = crumb.split("const renderProjectRow")[1];
    expect(body).toMatch(/>current</);
    expect(body).toMatch(/data-testid=\{`project-kebab-\$\{p\.id\}`\}/);
    expect(body).toMatch(/<CalendarIcon \/>/);
  });

  it("the search box and the pinned-reorder drag handle are untouched", () => {
    expect(crumb).toMatch(/onChange=\{\(e\) => setQ\(e\.target\.value\)\}/);
    expect(crumb).toMatch(/<DragGripIcon \/>/);
  });
});
