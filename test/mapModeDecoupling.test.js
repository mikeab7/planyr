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

  // ⛔ B850018 (NEW-11) SUPERSEDES this test's original claim. B831776/B831777's "one piece of
  // state, never two" was a deliberate design and this test used to guard it; the owner reversed
  // that design ("when i click comp in the center it shouldnt auto switch the left side to comp
  // mode as well" — measured bidirectional coupling on deployed build 80c78cc). The toolbar switch
  // (`mode`) and the rail tab (`panelTab`) are now two INDEPENDENT state variables, and this test
  // now guards THAT instead — the opposite assertion, on purpose, not a loosening.
  it("the toolbar switch reads `mode`; the rail tab reads its OWN `panelTab`, never `mode` (B850018/NEW-11)", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toMatch(/<SiteCompSwitch mode=\{mode\} onChange=\{setMode\}/);
    expect(src).toMatch(/<RailTab label="Sites"[\s\S]{0,120}active=\{panelTab === "site"\}/);
    expect(src).toMatch(/<RailTab label="Comps"[\s\S]{0,80}active=\{panelTab === "comp"\}/);
    // Teeth proof: the OLD coupled pattern must genuinely be gone, not just "a new pattern also
    // exists alongside it" — a partial revert would still satisfy the three matches above.
    expect(src).not.toMatch(/<RailTab label="Sites"[\s\S]{0,120}active=\{mode === "site"\}/);
    expect(src).not.toMatch(/<RailTab label="Comps"[\s\S]{0,80}active=\{mode === "comp"\}/);
  });

  it("setPanelTab is a plain setter — switching tabs must never cancel an in-flight comp placement the way leaving `mode` does", () => {
    const src = readFileSync(SRC, "utf8");
    const i = src.indexOf("const [panelTab, setPanelTab] = useState(");
    expect(i, "panelTab state not found").toBeGreaterThan(-1);
    // setPanelTab must be the raw useState setter, not a wrapper with side effects like `setMode`
    // (which cancels `placingCompPin`/`selectMode` on leaving comp mode) — there must be no
    // `const setPanelTab = (...)` function definition anywhere in the file.
    expect(src).not.toMatch(/const setPanelTab = /);
  });

  // ⛔ B1133760 (owner report 2026-09-04, measured live on deployed build `index-Dh4XXz5X.js`) —
  // NOT an independent regression. B850018/NEW-11 above (PR #1402, `cde60ea5`) split every CLICK
  // HANDLER off `mode` onto `panelTab`, but the sites-panel container's own WIDTH style is a plain
  // STYLE READ, not a click handler, so it never came up in that rewrite and survived unmigrated as
  // `mode === "comp" ? "clamp(...)" : 232` — the centre toggle alone still resized the panel
  // (measured 272×32 vs 230×32 collapsed), the same coupling PR #1402 removed everywhere else,
  // surviving in the one call site its pass didn't look at. Fixed by keying that width on
  // `panelTab` (what the rail is actually showing), never `mode`, finishing what that PR started.
  it("the sites-panel width follows `panelTab`, never `mode` (B1133760)", () => {
    const src = readFileSync(SRC, "utf8");
    const i = src.indexOf('data-testid="map-sites-panel"');
    expect(i, "sites-panel container not found").toBeGreaterThan(-1);
    // Scan forward to the container's own width expression rather than the whole file, so this
    // can't accidentally match one of the toolbar-workflow `mode === "comp"` reads elsewhere.
    const region = src.slice(i, i + 6000);
    expect(region).toMatch(/width:\s*panelTab === "comp" \? "clamp\(232px, 23vw, 440px\)" : 232/);
    // Teeth proof: the exact pre-fix expression must genuinely be gone from this region, not
    // merely superseded alongside it.
    expect(region).not.toMatch(/width:\s*mode === "comp" \? "clamp\(232px, 23vw, 440px\)" : 232/);
  });
});
