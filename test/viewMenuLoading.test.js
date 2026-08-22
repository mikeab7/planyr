/* B558064 — the View card must never present a mid-load empty snapshot as "this plan has
 * nothing to hide". A signed-in plan's cloud header carries no elements (they live in
 * `site_elements` rows — B672), so `counts` legitimately reads all-zero for the second or two
 * between opening a plan and its rows landing. Before this fix, `ViewMenu` read that window as
 * "empty plan" and rendered NO Content section at all — leaving only the Detail/Labels ornament
 * toggles, which is structurally the pre-B653 menu minus dock doors. A user who glanced at the
 * card during that window saw what looked like an old build; the SAME card, untouched, grew a
 * tri-state "Elements" master and per-type hide rows a moment later once the rows landed.
 *
 * These tests render the real component (react-dom/server, no DOM/Leaflet) and prove the fix by
 * SHAPE, not by inspecting `elementsReady` as a value: with real content, whether the section
 * shows the loading placeholder or the live per-type rows must track `elementsReady`, not the
 * transient `counts` snapshot. */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ViewMenu from "../src/workspaces/site-planner/components/ViewMenu.jsx";

const PAL = { ink: "#222", muted: "#888", accent: "#06c", panelLine: "#ddd" };
const BASE_SETTINGS = { hidden: undefined, showAreas: true, showGrid: false, showDims: true, snap: false, gridSize: 20 };

// A plan that genuinely has real drawn content once loaded.
const REAL_COUNTS = {
  els: [{ id: "b1", type: "building" }, { id: "p1", type: "pond" }],
  parcels: 1, markups: 0, measures: 0, callouts: 0,
};
// What `counts` actually reads DURING the load window for that same plan: the cloud header
// (`slimForCloud`) carries no elements at all — they live in `site_elements` rows — so the
// live `els`/`parcels` state SitePlanner passes down is genuinely `[]`/`0` until the rows
// engine's first seed lands, however much content the plan really holds.
const EMPTY_COUNTS = { els: [], parcels: 0, markups: 0, measures: 0, callouts: 0 };

const render = (props) => renderToStaticMarkup(createElement(ViewMenu, {
  open: true, onToggle: () => {}, setSnap: () => {}, patchSettings: () => {},
  settings: BASE_SETTINGS, pal: PAL, ...props,
}));

describe("ViewMenu — loading vs genuinely-empty (B558064)", () => {
  it("mid-load (elementsReady=false, counts still reading empty) shows a Content section with a loading note — never silently nothing", () => {
    const html = render({ counts: EMPTY_COUNTS, elementsReady: false });
    expect(html).toContain("Loading what&#x27;s on this plan");
    // The tri-state master and per-type rows must NOT appear yet — they belong to the real,
    // settled answer, not to a snapshot taken before the rows arrived.
    expect(html).not.toContain('data-testid="view-elements-master"');
    expect(html).not.toContain('data-testid="view-row-el:building"');
  });

  it("once ready, the same real content renders the live tri-state master and per-type rows — no loading note", () => {
    const html = render({ counts: REAL_COUNTS, elementsReady: true });
    expect(html).toContain('data-testid="view-elements-master"');
    expect(html).toContain('data-testid="view-row-el:building"');
    expect(html).toContain('data-testid="view-row-el:pond"');
    expect(html).not.toContain("Loading what&#x27;s on this plan");
  });

  it("a GENUINELY empty plan (ready=true, nothing drawn) still renders no Content section at all — the pre-existing correct behaviour is preserved", () => {
    const html = render({ counts: EMPTY_COUNTS, elementsReady: true });
    expect(html).not.toContain('data-testid="view-elements-master"');
    expect(html).not.toContain("Loading what&#x27;s on this plan");
  });

  it("elementsReady defaults to true (backward compatible) when the prop is omitted", () => {
    const html = render({ counts: REAL_COUNTS });
    expect(html).toContain('data-testid="view-elements-master"');
    expect(html).not.toContain("Loading what&#x27;s on this plan");
  });
});
