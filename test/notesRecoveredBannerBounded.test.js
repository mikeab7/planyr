import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import IntegrityBanner, { LIST_MAX_PX } from "../src/workspaces/notes/components/IntegrityBanner.jsx";

// NEW-1 (V2115860 follow-up) — the "recovered notes" bar sits IN FLOW above the page, so a row per
// recovered note made it as tall as the count. Measured live on the test account: 20 recovered pages =
// a 598 px bar in a 768 px window, ~50 px left for the page, the first box's border below the fold.
// A notice must never take the working surface away: the rows scroll inside a fixed ceiling.
const recovered = (n) => Array.from({ length: n }, (_, i) => ({ pageId: `pg_${i}`, title: `Recovered — note ${i}`, firstLine: `note ${i}`, chars: 10 + i }));
const render = (n) => renderToStaticMarkup(createElement(IntegrityBanner, {
  duplicates: [], writeRefused: 0, purgeFailed: 0, recovered: recovered(n), projects: [], projectNames: new Map(),
  onOpen() {}, onFile() {}, onBin() {}, onKeepOne() {}, onKeepBoth() {}, onDismiss() {},
}));
const listStyle = (html) => (html.match(/data-testid="notes-recovered-list"[^>]*style="([^"]*)"/) || [])[1] || "";

describe("the recovered-notes bar is bounded however many notes were recovered", () => {
  for (const n of [1, 3, 20, 60]) {
    it(`${n} recovered: the list is a scroll box with a ceiling`, () => {
      const st = listStyle(render(n));
      expect(st, "the rows must live in notes-recovered-list").not.toBe("");
      expect(st).toMatch(/overflow-y:\s*auto/);
      const mh = Number((st.match(/max-height:\s*(\d+)px/) || [])[1]);
      expect(mh).toBe(LIST_MAX_PX);
      expect(mh).toBeLessThanOrEqual(160);
    });
  }
  it("every recovered note is still in the markup (nothing is dropped to save room)", () => {
    const html = render(20);
    for (let i = 0; i < 20; i++) expect(html).toContain(`notes-recovered-open-pg_${i}`);
  });
  it("the summary line and the Dismiss button are outside the scroll box", () => {
    const html = render(20);
    const list = html.indexOf('data-testid="notes-recovered-list"');
    expect(html.indexOf('data-testid="notes-recovered-summary"')).toBeLessThan(list);
    expect(html.lastIndexOf(">Dismiss<")).toBeGreaterThan(html.lastIndexOf("notes-recovered-bin-pg_19"));
  });
});
