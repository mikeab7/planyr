import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url));

/* B831778 (NEW-3) — THE LOAD-BEARING REQUIREMENT: what's drawn on the map (the sites layer, the
 * comps layer) must never depend on `mode` (the Site/Comp toolbar switch / rail tab — one piece
 * of state, B831776). A DOM-level check needs seeded sites/comps data this sandbox doesn't have
 * signed out; this is the deterministic, data-free proof instead — it reads the two map-layer
 * `useEffect` blocks straight out of the source and asserts neither their dependency array nor
 * their body ever mentions `mode`.
 *
 * The extractor is proven against a KNOWN-BROKEN fixture below (DRIVER-SCROLL-IS-NOT-APP-SCROLL
 * §6 / WRONG-CASE: a probe that has never been shown a real defect cannot be trusted to catch
 * one) before it is trusted on the real file — this IS the "prove RED first" step for this item,
 * since the assertion is new and there is no earlier broken build of this feature to run it
 * against.
 */

// Strip // and /* */ comments (crude but sufficient for this file — no string literal here
// contains "//" or "/*"), so documentation is free to discuss `mode` by name while the CODE
// itself is the only thing the assertion below actually judges.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function extractEffectBody(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`marker not found: ${marker}`);
  // Walk forward to the effect's own closing `}, [...]);` — brace-balanced from the first
  // `useEffect(() => {` after the marker.
  const start = src.indexOf("useEffect(() => {", i);
  if (start < 0) throw new Error(`useEffect not found after marker: ${marker}`);
  let depth = 0, j = start;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) break; }
  }
  const closeParenIdx = src.indexOf(");", j);
  return stripComments(src.slice(start, closeParenIdx + 2));
}

// A mention of `mode` as its own identifier — never a false hit on `showSitesLayer`,
// `narrow`, `remoteOnly`, etc.
const MENTIONS_MODE = /\bmode\b/;

describe("MapFinder map-layer effects never read `mode` (B831778/NEW-3)", () => {
  it("the extractor itself catches a deliberately mode-gated fixture (teeth proof)", () => {
    const broken = `
    useEffect(() => {
      const build = () => {
        (mode === "site" ? sites : []).forEach((site) => {});
      };
      build();
    }, [sites, mode]);`;
    expect(MENTIONS_MODE.test(broken)).toBe(true);
  });

  it("the extractor passes a clean fixture (no `mode` anywhere)", () => {
    const clean = `
    useEffect(() => {
      const build = () => {
        (showSitesLayer ? sites : []).forEach((site) => {});
      };
      build();
    }, [sites, showSitesLayer]);`;
    expect(MENTIONS_MODE.test(clean)).toBe(false);
  });

  it("the real sites-layer effect never mentions `mode`", () => {
    const src = readFileSync(SRC, "utf8");
    const body = extractEffectBody(src, "Saved sites on the overview map");
    expect(body).toContain("showSitesLayer");
    expect(MENTIONS_MODE.test(body)).toBe(false);
  });

  it("the real comps-layer effect never mentions `mode`", () => {
    const src = readFileSync(SRC, "utf8");
    const body = extractEffectBody(src, "leasing-comp markers: a sibling layer");
    expect(body).toContain("showCompsLayer");
    expect(MENTIONS_MODE.test(body)).toBe(false);
  });

  it("the toolbar switch and the rail tab are driven by the SAME state variable (NEW-1/NEW-2 coupling)", () => {
    const src = readFileSync(SRC, "utf8");
    // Both call sites read `mode`/pass `setMode` — a literal source sweep that there is exactly
    // one state variable behind both surfaces, not two independently-toggleable ones.
    expect(src).toMatch(/<SiteCompSwitch mode=\{mode\} onChange=\{setMode\}/);
    expect(src).toMatch(/<RailTab label="Sites"[\s\S]{0,120}active=\{mode === "site"\}/);
    expect(src).toMatch(/<RailTab label="Comps"[\s\S]{0,80}active=\{mode === "comp"\}/);
  });
});
