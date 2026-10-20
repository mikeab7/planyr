// NEW-1 — the Records query bar renders (SSR smoke): search row, Filters count, open panel sections,
// chips with ✕, results line + undated note, and the "No comps match" state. Pure markup, no DOM needed.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import CompsQueryBar from "../src/shared/comps/components/CompsQueryBar.jsx";
import { defaultFilters } from "../src/shared/comps/lib/compsQuery.js";

const comps = [
  { id: "a", compType: "lease", anchor: { county: "harris" } },
  { id: "b", compType: "land", anchor: { county: "fort_bend" } },
];
const render = (over = {}) => renderToStaticMarkup(React.createElement(CompsQueryBar, {
  filters: defaultFilters(), setFilters() {}, sort: "newest", setSort() {}, panelOpen: false, setPanelOpen() {},
  comps, counts: { shown: 2, total: 2, undatedHidden: 0 }, onClearAll() {}, ...over,
}));

describe("CompsQueryBar render", () => {
  it("search row: a type=search input, Filters, sort, and the count line", () => {
    const h = render();
    expect(h).toContain('type="search"');
    expect(h).toContain('aria-label="Search comps"');
    expect(h).toContain(">Filters<");
    expect(h).toContain("2 of 2 comps");
    expect(h).toContain("Price/SF high to low");
    expect(h).not.toContain("Clear all");
  });
  it("no browser autofill on the search input", () => {
    expect(render()).toMatch(/data-1p-ignore/);
  });
  it("active filters: count on the button, removable chips, Clear all, undated note", () => {
    const f = { ...defaultFilters(), types: ["lease"], powerMin: "2000", q: "dock" };
    const h = render({ filters: f, counts: { shown: 1, total: 2, undatedHidden: 3 } });
    expect(h).toContain("Filters · 2");
    expect(h).toContain("Remove filter: Lease");
    expect(h).toContain("Power ≥ 2,000 A");
    expect(h).toContain("1 of 2 comps · 3 undated hidden");
    expect(h).toContain("Clear all");
  });
  it("open panel: every section, the blank-fields hint, county chips with counts; acres only when Land can match", () => {
    const h = render({ panelOpen: true });
    for (const t of ["Type", "Date", "Size", "Building", "Rate / price", "County / market"]) expect(h).toContain(`>${t}<`);
    expect(h).toContain("Blank fields don&#x27;t match a range.");
    expect(h).toContain("Bldg Sale");
    expect(h).toContain("Harris County, TX · 1");
    expect(h).toContain("Land size");
    const leaseOnly = render({ panelOpen: true, filters: { ...defaultFilters(), types: ["lease"] } });
    expect(leaseOnly).not.toContain("Land size");
    expect(leaseOnly).toContain("Lease rate");
  });
  it("no match: says so with a Clear filters button", () => {
    const h = render({ counts: { shown: 0, total: 2, undatedHidden: 0 }, filters: { ...defaultFilters(), q: "zzz" } });
    expect(h).toContain("No comps match");
    expect(h).toContain("Clear filters");
  });
});
