/* B2573312 (NEW-1 / NEW-2) — the Zoning dropdown legend: grouped under a heading per jurisdiction, EVERY entry on its own row, no per-row "(Olive Branch)" suffix. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { StackedLegend } from "../src/workspaces/site-planner/components/ViewLegend.jsx";
import { zoningLegend } from "../src/workspaces/site-planner/lib/desotoZoningNames.js";
import { ZONING_NAMES } from "../src/workspaces/site-planner/lib/desotoZoningNames.js";
import { viewLegendSame } from "../src/workspaces/site-planner/lib/viewLegendStore.js";

const entries = zoningLegend([
  { code: "A-R", jurisdiction: "Olive Branch", color: "#4d7c0f" }, { code: "A-R", jurisdiction: "Unincorporated DeSoto County", color: "#4d7c0f" },
  { code: "C-4", jurisdiction: "Olive Branch", color: "#ea580c" }, { code: "PUD", jurisdiction: "Olive Branch", color: "#0f766e" }, { code: "PUD", jurisdiction: "Unincorporated DeSoto County", color: "#0f766e" },
  { code: "O", jurisdiction: "Olive Branch", color: "#ea580c" }, { code: "PB", jurisdiction: "Olive Branch", color: "#ea580c" },
], ZONING_NAMES).map((e) => ({ ...e, stacked: true }));
const html = renderToStaticMarkup(createElement(StackedLegend, { items: entries }));
const rows = [...html.matchAll(/data-part="legend-row"[^>]*>(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
const heads = [...html.matchAll(/data-part="legend-heading"[^>]*>(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("the Zoning legend as the Layers panel draws it", () => {
  it("one heading per jurisdiction in view, in order, each printed once", () => {
    expect(heads).toEqual(["Olive Branch", "Unincorporated DeSoto County"]);
  });
  it("every entry is its own row — 'O · Office' and 'PB' are two rows, never one line", () => {
    expect(rows.length).toBe(entries.length);
    expect(rows).toContain("O · Office");
    expect(rows).toContain("PB");
    expect(rows.every((r) => !/ · .* · /.test(r) || r.split(" · ").length === 2)).toBe(true);   // no row holds two entries
  });
  it("no row carries a jurisdiction suffix, and the bare PB inside Olive Branch is not given the county's name", () => {
    for (const r of rows) expect(r).not.toMatch(/\((Olive Branch|Unincorporated)/);
    expect(rows).not.toContain("PB · Planned Business");
  });
  it("the layout is a column that lets a long name wrap under itself (never a wrapping row of inline chips)", () => {
    expect(html).toMatch(/flex-direction:column/);
    expect(html).toMatch(/overflow-wrap:anywhere/);
  });
  it("a heading change is a store change: the same labels under a different heading re-render", () => {
    const a = [{ label: "C-2", color: "#000", group: "Olive Branch" }], b = [{ label: "C-2", color: "#000", group: "Unincorporated DeSoto County" }];
    expect(viewLegendSame(a, b)).toBe(false);
    expect(viewLegendSame(a, [{ ...a[0] }])).toBe(true);
  });
});
