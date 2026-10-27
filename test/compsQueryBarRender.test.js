// NEW-1 — the Records query bar renders (SSR smoke): search row, Filters count, the open panel's sections in
// record order, type-dependent fields, sticky footer, closed-state chips + results line, "No comps match".
// Pure markup, no DOM needed.
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
  comps, counts: { shown: 2, total: 2 }, onClearAll() {}, ...over,
}));
const text = (h) => h.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'"); // what a person can read, not the CSS
const sections = (h) => [...h.matchAll(/data-filter-section="([a-z]+)"/g)].map((m) => m[1]);
const F = (patch) => ({ ...defaultFilters(), ...patch });

describe("CompsQueryBar render — closed", () => {
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
  it("active filters: count on the button, removable chips, Clear all at the end of the chip row, plain results line", () => {
    const h = render({ filters: F({ types: ["lease"], power: { min: "2000", max: "" }, q: "dock" }), counts: { shown: 1, total: 2 } });
    expect(h).toContain("Filters · 2");
    expect(h).toContain("Remove filter: Lease");
    expect(h).toContain("Power ≥ 2k A");
    expect(h).toContain(">1 of 2 comps<");
    const chips = h.slice(h.indexOf("comps-active-chips"));
    expect(chips.indexOf("Clear all")).toBeGreaterThan(chips.indexOf("Power ≥ 2k A"));
    expect(chips.indexOf("Clear all")).toBeLessThan(chips.indexOf("comps-results-line"));
  });
  it("outlined accent when closed with filters, plain with none", () => {
    const btn = (h) => h.match(/<button[^>]*aria-controls="comps-filter-panel"/)[0];
    expect(btn(render({ filters: F({ types: ["lease"] }) }))).toMatch(/border-color:var\(--accent\)/);
    expect(btn(render({ filters: F({ types: ["lease"] }) }))).not.toMatch(/background:var\(--accent\)/);
    expect(btn(render())).not.toMatch(/border-color:var\(--accent\)/);
  });
  it("no match: says so with a Clear filters button", () => {
    const h = render({ counts: { shown: 0, total: 2 }, filters: F({ q: "zzz" }) });
    expect(h).toContain("No comps match");
    expect(h).toContain("Clear filters");
  });
});

describe("CompsQueryBar render — open panel", () => {
  const open = (filters = defaultFilters(), over = {}) => render({ panelOpen: true, filters, ...over });
  it("sections in the record's order, no cards, the heavy rule on top", () => {
    const h = open();
    expect(sections(h)).toEqual(["type", "date", "location", "deal", "building", "land", "parties"]);
    for (const t of ["Type", "Date signed", "Location", "Deal", "Building", "Land", "Parties"]) expect(h).toContain(`>${t}<`);
    expect(h).toContain("border-top:2px solid var(--text-primary)");
    const panel = h.slice(h.indexOf('id="comps-filter-panel"'));
    expect(panel).not.toMatch(/<section[^>]*border-radius|<section[^>]*background/); // no bordered rounded cards, no fills
  });
  it("the retired sentence and every undated / blank callout are gone", () => {
    for (const f of [defaultFilters(), F({ types: ["lease"], date: { mode: "3mo", from: "", to: "" } })]) {
      const h = open(f, { counts: { shown: 0, total: 5 } });
      expect(text(h)).not.toMatch(/blank fields|hidden|include them|undated|have no size/i);
      expect(text(render({ filters: f, counts: { shown: 0, total: 5 } }))).not.toMatch(/hidden|include them|undated/i);
    }
  });
  it("header right-hand value: muted Any when unset, accent text when set", () => {
    expect(open()).toMatch(/data-filter-value[^>]*>Any</);
    const h = open(F({ types: ["lease"], date: { mode: "12mo", from: "", to: "" }, sf: { min: "100000", max: "300000" } }));
    expect(h).toContain(">Lease<");
    expect(h).toContain(">Past 12 months<");
    expect(h).toContain("100,000 – 300,000 SF");
  });
  it("county chips carry counts, in the Location section", () => {
    const h = open();
    expect(h).toContain("Harris 1");
    expect(h).toContain("Fort Bend 1");
  });
  it("Lease: lease fields only; Bldg Sale: sale fields + Seller/Buyer; Land only: Land section, no Building", () => {
    const lease = open(F({ types: ["lease"] }));
    for (const t of ["Rate $/SF/yr", "Term (yrs)", "Escalations %", "Free rent (mo)", "TI $/SF", "NNN", "Gross", "Size SF", "Landlord", "Tenant"]) expect(lease, t).toContain(t);
    for (const t of ["Cap rate", "NOI", "Acres"]) expect(lease, t).not.toContain(t);
    expect(sections(lease)).toEqual(["type", "date", "location", "deal", "building", "parties"]);
    const sale = open(F({ types: ["building_sale"] }));
    for (const t of ["Price $/SF", "Cap rate %", "NOI $", "Seller", "Buyer"]) expect(sale, t).toContain(t);
    expect(sale).not.toContain("Rate $/SF/yr");
    expect(sale).not.toContain("Landlord");
    const land = open(F({ types: ["land"] }));
    expect(sections(land)).toEqual(["type", "date", "location", "deal", "land", "parties"]);
    expect(land).toContain("Acres");
    expect(land).not.toContain("Dock doors");
    expect(land).toContain("Seller");
  });
  it("no type selected: the union, grouped lease / sale / land", () => {
    const h = open();
    expect(h.indexOf(">Lease<", h.indexOf('data-filter-section="deal"'))).toBeLessThan(h.indexOf(">Bldg Sale<", h.indexOf('data-filter-section="deal"')));
    expect(h.indexOf(">Bldg Sale<", h.indexOf('data-filter-section="deal"'))).toBeLessThan(h.indexOf(">Land<", h.indexOf('data-filter-section="deal"')));
    expect(h).toContain("Landlord / seller");
    expect(h).toContain("Tenant / buyer");
  });
  it("every range is one row: label, Min, the word to, Max; digits only, no autofill; year uses From / To", () => {
    const h = open(F({ types: ["lease"] }));
    expect(h).toContain('placeholder="Min"');
    expect(h).toContain('placeholder="Max"');
    expect(h).toContain(">to<");
    expect(h).toContain('placeholder="From"');
    expect(h).toContain('placeholder="Min ft"');
    expect(h).toMatch(/data-1p-ignore/);
  });
  it("accent border on an active box", () => {
    const on = open(F({ types: ["lease"], term: { min: "5", max: "" } }));
    expect(on).toMatch(/<input[^>]*aria-label="Term \(yrs\) min"[^>]*border:1px solid var\(--accent\)/);
    expect(on).toMatch(/<input[^>]*aria-label="Term \(yrs\) max"[^>]*border:1px solid var\(--border-default\)/);
  });
  it("sticky footer: Clear all on the left, a solid Show N comps button, live count", () => {
    const h = open(defaultFilters(), { counts: { shown: 12, total: 41 } });
    expect(h).toContain("position:sticky;bottom:0");
    expect(h).toContain("Show 12 comps");
    expect(h.indexOf("Clear all")).toBeLessThan(h.indexOf("Show 12 comps"));
    expect(open(defaultFilters(), { counts: { shown: 1, total: 41 } })).toContain("Show 1 comp<");
  });
  it("filled accent while open", () => {
    expect(open().match(/<button[^>]*aria-controls="comps-filter-panel"/)[0]).toMatch(/background:var\(--accent\)/);
  });
});
