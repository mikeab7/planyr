import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardCard from "../src/workspaces/dashboard/components/DashboardCard.jsx";

// B1426608 — the "Going quiet" card (and its list-shaped siblings) used to
// stretch to fill its reserved grid tile no matter how little it had to show, so a single row
// sat above ~200px of bare card surface. The fix: DashboardCard's `sizeToContent` prop lets the
// card's own rendered height follow its content, capped (never exceeding) the tile react-grid-
// layout reserved — see that component's own header for the full reasoning.
describe("DashboardCard — sizeToContent", () => {
  it("defaults to filling the whole tile (unchanged behavior) when sizeToContent is omitted", () => {
    const html = renderToStaticMarkup(createElement(DashboardCard, { title: "Test" }, "body"));
    const rootStyle = html.match(/^<div style="([^"]*)"/)[1];
    expect(rootStyle).toMatch(/height:100%/);
    expect(rootStyle).toMatch(/max-height:100%/);
  });

  it("switches to content-driven height when sizeToContent is true, still capped at the tile height", () => {
    const html = renderToStaticMarkup(createElement(DashboardCard, { title: "Test", sizeToContent: true }, "body"));
    const rootStyle = html.match(/^<div style="([^"]*)"/)[1];
    expect(rootStyle).toMatch(/height:auto/);
    expect(rootStyle).toMatch(/max-height:100%/);
  });

  it("stamps cardKey as data-card-key so a headless check can find a specific card (NEW-1, 2026-09-17)", () => {
    const html = renderToStaticMarkup(createElement(DashboardCard, { title: "Test", cardKey: "jumpBackIn" }, "body"));
    expect(html).toMatch(/data-card-key="jumpBackIn"/);
  });

  it("never drops the cap — a card with more content than fits its tile must still be able to scroll internally", () => {
    // The content wrapper keeps flex:1 + overflow:auto regardless of sizeToContent, so a card
    // whose real content exceeds the (capped) tile height scrolls internally rather than
    // spilling into whatever sits below it on the grid.
    const html = renderToStaticMarkup(createElement(DashboardCard, { title: "Test", sizeToContent: true }, "body"));
    expect(html).toMatch(/overflow:auto/);
  });
});

describe("Dashboard — which cards opt into sizeToContent", () => {
  const src = readFileSync(new URL("../src/workspaces/dashboard/Dashboard.jsx", import.meta.url), "utf8");

  it("opts in the short text/number list cards — the ones the reported bug (and its siblings) affects", () => {
    const setLine = src.match(/const SIZE_TO_CONTENT_CARDS = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const key of ["jumpBackIn", "pipelineStatus", "needsAttention", "pursuitsTable", "scheduleHealth", "goingQuiet", "sinceLastHere"]) {
      expect(setLine, `expected ${key} to opt into sizeToContent`).toMatch(new RegExp(`"${key}"`));
    }
  });

  it("leaves out the cards that must fill their tile (map, thumbnail grid, scale-bar layout)", () => {
    const setLine = src.match(/const SIZE_TO_CONTENT_CARDS = new Set\(\[([\s\S]*?)\]\);/)[1];
    for (const key of ["recentPlans", "compsSummary", "locationsMap"]) {
      expect(setLine, `expected ${key} to stay off sizeToContent`).not.toMatch(new RegExp(`"${key}"`));
    }
  });

  it("gates sizeToContent on dataReady — never shrinks a card while it's still showing the loading skeleton", () => {
    expect(src).toMatch(/sizeToContent=\{dataReady && SIZE_TO_CONTENT_CARDS\.has\(entry\.key\)\}/);
  });
});
