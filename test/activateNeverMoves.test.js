/* B1986032 (amended 2026-09-30) — Site Analysis "Activate layer" / "Deactivate layer" must NOT
 * change the view at all: no pan, no zoom in, no zoom out. Owner, verbatim: "The activate layer
 * button shouldn't move the screen anywhere."
 *
 * HOW THIS PROVES IT. The handler lives inside the SitePlanner component, so it cannot be
 * imported. This test lifts the REAL `toggleAnalysisLayer` body out of SitePlanner.jsx and runs it
 * in a scope where every free identifier the body touches is recorded. Only the three things it is
 * ALLOWED to touch (setOverlays, ensureBasemapOn, ALL_LAYERS) are provided; ANY other identifier
 * (setView, requestFit, setFitReq, a framing helper, zoomAround…) counts as a view mutation. The
 * view held here (ppf/offX/offY) is asserted identical afterwards, in the three cases the owner
 * named. RED-PROOF: `ACTIVATE_SRC=<path to the pre-fix SitePlanner.jsx>` runs the same test on it
 * and it fails (the old body calls frameToActiveParcels). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SRC_PATH = process.env.ACTIVATE_SRC || new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url);
const src = readFileSync(SRC_PATH, "utf8");

function liftHandler() {
  const m = src.match(/const toggleAnalysisLayer = useCallback\(\((layerId, wantOn)\) => \{([\s\S]*?)\n  \}, \[/);
  if (!m) throw new Error("toggleAnalysisLayer not found in SitePlanner.jsx");
  return m[2];
}

/* Run the handler with a recording scope. Returns { touched, overlays, basemapCalls }. */
function run(layerId, wantOn, view) {
  const body = liftHandler();
  const touched = [];
  let overlays = {};
  let basemapCalls = 0;
  const provided = {
    setOverlays: (u) => { overlays = typeof u === "function" ? u(overlays) : u; },
    ensureBasemapOn: () => { basemapCalls++; },
    ALL_LAYERS: { fema: { opacity: 0.7 }, wetlands: { opacity: 0.7 } },
    layerId, wantOn,
  };
  const scope = new Proxy({}, {
    has: (_, k) => typeof k === "string" && !["undefined", "Object", "Array", "Math", "Number", "JSON", "String", "Boolean", "console"].includes(k),
    get: (_, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in provided) return provided[k];
      touched.push(String(k));                       // any other identifier = a view/helper touch
      return (...a) => { touched.push(`${String(k)}()`); };
    },
  });
  // eslint-disable-next-line no-new-func
  new Function("scope", `with (scope) { ${body} }`)(scope);
  return { touched, overlays, basemapCalls, view };
}

const CASES = {
  "close view (site fills the screen)": { ppf: 1.6, offX: 150, offY: 100 },
  "site fully off-screen": { ppf: 1.6, offX: 5000, offY: 5000 },
  "very wide view (below a gated layer's draw level)": { ppf: 0.05, offX: 400, offY: 300 },
};

describe("Activate / Deactivate never move the view", () => {
  for (const [name, view] of Object.entries(CASES)) {
    for (const wantOn of [true, false]) {
      it(`${wantOn ? "Activate" : "Deactivate"} — ${name}: ppf, offX, offY unchanged and nothing view-related touched`, () => {
        const before = { ...view };
        const r = run("fema", wantOn, view);
        expect(r.touched).toEqual([]);                       // no setView / requestFit / framing helper
        expect(r.view.ppf).toBe(before.ppf);
        expect(r.view.offX).toBe(before.offX);
        expect(r.view.offY).toBe(before.offY);
        expect(r.overlays.fema.on).toBe(wantOn);             // the layer itself still toggles
        expect(r.basemapCalls).toBe(wantOn ? 1 : 0);         // basemap ensured on enable only
      });
    }
  }
  it("ten activations in a row leave the view untouched (no accumulating drift)", () => {
    for (let i = 0; i < 10; i++) expect(run(i % 2 ? "wetlands" : "fema", true, CASES["close view (site fills the screen)"]).touched).toEqual([]);
  });
});

describe("no other path reframes on activate / layer load", () => {
  it("the activate framing helper is gone", () => {
    expect(src).not.toMatch(/frameToActiveParcels|activateLayerView|activeParcelBox/);
  });
  it("layers.js never fits or re-centres the map on a layer load", () => {
    const layers = readFileSync(new URL("../src/workspaces/site-planner/lib/layers.js", import.meta.url), "utf8");
    expect(layers).not.toMatch(/fitBounds|requestFit|fitReq/);
  });
  it("the button tooltip and the panel footer promise no framing", () => {
    const sa = readFileSync(new URL("../src/workspaces/site-planner/components/SiteAnalysis.jsx", import.meta.url), "utf8");
    expect(sa).not.toMatch(/frames? (to )?the site|framed to the site/i);
  });
});

describe("a gated layer says so on its card instead of the map moving", () => {
  it("SiteAnalysis renders the read-only zoom note from layerZoomNote (text only, no click)", () => {
    const sa = readFileSync(new URL("../src/workspaces/site-planner/components/SiteAnalysis.jsx", import.meta.url), "utf8");
    expect(sa).toMatch(/data-analysis-zoom-note/);
    const line = sa.split("\n").find((l) => l.includes("data-analysis-zoom-note"));
    expect(line).not.toMatch(/onClick/);
  });
  it("the note is the shared layerVisibility answer, and never calls setView", () => {
    const m = src.match(/const analysisLayerZoomNote = useCallback\([\s\S]*?\n  \}, \[/);
    expect(m).toBeTruthy();
    expect(m[0]).toMatch(/layerVisibility\(/);
    expect(m[0]).not.toMatch(/setView|requestFit/);
  });
});
