import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Dashboard from "../src/workspaces/dashboard/Dashboard.jsx";
import { CardSkeleton } from "../src/workspaces/dashboard/components/DashboardCards.jsx";
import { CARD_DEFS } from "../src/workspaces/dashboard/lib/dashboardLayout.js";

// B1218496 — every Dashboard card used to reveal its real (variable-height) content the moment
// its OWN data source resolved, independently of the other five cards. A card in an EARLIER grid
// row growing after a LATER card had already rendered its final content shoved that later card's
// still-pressable rows down the page mid-gesture (event:click-swallowed, "moved": true). The fix:
// nothing renders real content until every source has settled (Promise.allSettled), and every
// card renders the identical CardSkeleton placeholder until then.
//
// `renderToStaticMarkup` never runs effects (no useEffect), so this exercises exactly the
// property that matters here: what a user's FIRST paint looks like, before any fetch has had a
// chance to resolve — the html: must show a skeleton in *every* card, never real card copy that
// could be pressed and then grow out from under someone.
describe("Dashboard — no card shows real content before every source has settled", () => {
  it("first render (dataReady still false) shows the skeleton for every default card, no real content", () => {
    const html = renderToStaticMarkup(createElement(Dashboard, {}));
    // None of the real cards' own distinguishing copy may appear on the very first paint.
    expect(html).not.toMatch(/No projects yet\./);
    expect(html).not.toMatch(/No open pursuits right now\./);
    expect(html).not.toMatch(/Nothing's gone quiet/);
    expect(html).not.toMatch(/No comps recorded yet\./);
    expect(html).not.toMatch(/No schedules yet\./);
    expect(html).not.toMatch(/Nothing to jump back into yet\./);
    // Every default-layout card title still renders (the shell/title never gates on data).
    for (const key of Object.keys(CARD_DEFS)) {
      expect(html, `card title "${CARD_DEFS[key].title}" missing from first paint`).toMatch(
        new RegExp(CARD_DEFS[key].title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      );
    }
  });

  it("CardSkeleton renders a stable, deterministic number of placeholder bars", () => {
    const html = renderToStaticMarkup(createElement(CardSkeleton, { rows: 3 }));
    const bars = html.match(/<span[^>]*>/g) || [];
    expect(bars.length).toBe(3);
  });
});

// Source-guard: the async behavior (all four sources gate one `dataReady` flag via
// Promise.allSettled, and every card renderer is swapped to a skeleton until it's true) can't be
// observed through a one-shot static render, since effects never run there — assert it holds in
// the real source instead, the same shape test/accountControlAdmin.test.js uses for its own
// effect-driven gate.
describe("Dashboard — dataReady source shape", () => {
  const src = readFileSync(new URL("../src/workspaces/dashboard/Dashboard.jsx", import.meta.url), "utf8");

  it("gates on ALL FOUR sources via Promise.allSettled, never on any one source alone", () => {
    expect(src).toMatch(/Promise\.allSettled\(\s*\[/);
    expect(src).toMatch(/fetchSiteSummaries\(\)/);
    expect(src).toMatch(/fetchCompsCounts\(\)/);
    expect(src).toMatch(/fetchLastTouchedDoc\(\)/);
    expect(src).toMatch(/fetchScheduleProjects\(\)/);
    expect(src).toMatch(/setDataReady\(true\)/);
  });

  it("resets dataReady to false on every re-run (a userId change re-arms the gate, never skips it)", () => {
    expect(src).toMatch(/setDataReady\(false\);/);
  });

  it("every CARD_RENDERERS entry is skeleton-only while !dataReady — no per-card early reveal", () => {
    expect(src).toMatch(/const CARD_RENDERERS = dataReady \? \{/);
    expect(src).toMatch(/Object\.fromEntries\(Object\.keys\(CARD_DEFS\)\.map\(/);
  });
});
