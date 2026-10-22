/* B2436065 (Imagery & Layers NEW-2) — no layer row is ever rendered faded.
 * The relevance "Dim" treatment greyed a real layer (Master Plan Floodplains on Grand Port) — building hierarchy by fading text toward the
 * background, which the theming rule forbids. "Layers with no data here" is now Show / Hide; a stored "dim" reads as Show. The rendered
 * guard (computed opacity / colour equal to a normal row in every relevance state, both themes) is ui-audit verify-imagery-layers-panel. */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { RELEVANCE_MODES, DEFAULT_RELEVANCE, normalizeMode, getRelevanceMode, setRelevanceMode, _resetRelevancePrefs } from "../src/workspaces/site-planner/lib/coverage.js";

const panel = readFileSync(new URL("../src/workspaces/site-planner/components/LayerPanel.jsx", import.meta.url), "utf8");

describe("the Dim mode is gone", () => {
  it("only Show and Hide exist; Show is the default", () => {
    expect(RELEVANCE_MODES).toEqual(["all", "hide"]);
    expect(DEFAULT_RELEVANCE).toBe("all");
  });
  it("the ⋯ menu offers Show / Hide only", () => {
    expect(panel).toMatch(/const RELEVANCE_OPTIONS = \[\{ key: "all", label: "Show" \}, \{ key: "hide", label: "Hide" \}\]/);
    expect(panel).not.toMatch(/label: "Dim"/);
  });
  it("no dead dim branch survives in the panel (spec.dim, a dim render option, the faded-row opacity, the no-data caption)", () => {
    expect(panel).not.toMatch(/spec\.dim/);
    expect(panel).not.toMatch(/\bdim:\s*(true|false)/);
    expect(panel).not.toMatch(/mode === "dim"/);
    expect(panel).not.toMatch(/opacity:\s*[^,}]*0\.55/);
    expect(panel).not.toMatch(/No data in this area\.", tone/);
  });
  it("a zoom-gated row is not faded either — no row-level opacity or muted name colour; the hollow status dot carries that state", () => {
    expect(panel).not.toMatch(/minHeight: 24[^\n]*opacity/);
    expect(panel).not.toMatch(/color: dormant \? MUTED/);
    expect(panel).toMatch(/hollow = dormant \|\| hidden/); // the dot is still how a dormant row announces itself
  });
});

describe("a stored 'dim' preference (the old default) reads as Show", () => {
  beforeEach(() => {
    const store = {};
    globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, _s: store };
    _resetRelevancePrefs();
  });
  it("normalizeMode maps dim and anything unknown to Show", () => {
    expect(normalizeMode("dim")).toBe("all");
    expect(normalizeMode("bogus")).toBe("all");
    expect(normalizeMode("hide")).toBe("hide");
  });
  it("loading a saved {mode:'dim'} yields Show, and the next write stores it normalised", () => {
    globalThis.localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "dim", radius: 4 }));
    _resetRelevancePrefs();
    expect(getRelevanceMode()).toBe("all");
    setRelevanceMode("all");
    expect(JSON.parse(globalThis.localStorage.getItem("planarfit:relevance:v1")).mode).toBe("all");
  });
  it("a saved 'hide' still hides", () => {
    globalThis.localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "hide", radius: 2.5 }));
    _resetRelevancePrefs();
    expect(getRelevanceMode()).toBe("hide");
  });
});
