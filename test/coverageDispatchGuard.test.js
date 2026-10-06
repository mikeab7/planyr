/* NEW-1 — the hard page freeze on a LOCATED plan (Properties rail tab + an immediate Escape, looped).
 *
 * Root cause (measured on the unfixed build, ~300 commits/s, page unresponsive indefinitely): the planner's
 * Layers-coverage effect depended on the `view` / `size` OBJECTS and dispatched an unconditional
 * `setCoverage(<fresh object>)` from an already-resolved promise (a microtask). Once a panel toggle leaves
 * `setSize`'s updater retained (B1189), every render mints a value-identical `size`, the effect re-runs, the
 * microtask dispatches, and the microtask queue never drains. React's error-185 breaker never fires because
 * each dispatch lands after the commit that scheduled it.
 *
 * Two halves are asserted here: the pure dispatch guard (`sameCoverage`) and a source guard on the effect
 * itself — its dependency list may name only view/size NUMBERS, and `setCoverage` may only be reached behind
 * `sameCoverage`. The source guard carries its own teeth: it is run against the PRE-FIX effect verbatim and
 * must flag both defects there. The real loop in a browser is ui-audit/verify-properties-escape-freeze.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sameCoverage } from "../src/workspaces/site-planner/lib/coverage.js";

const SRC = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

/* The pre-fix effect, verbatim from build 6000483 — the mutation check. */
const PRE_FIX = `  useEffect(() => {
    if (!origin) return;
    let t;
    const recompute = () => setCoverage(computeCoverage(boundsFromLeaflet(geoMapRef.current), overlays, getNearbyRadiusMiles()));
    prefetchExtents(ALL_LAYERS, probeService).then(recompute);
    t = setTimeout(recompute, 300); // let the basemap commit (≤160ms) settle first
    const unsub = subscribeRelevance(recompute);
    return () => { clearTimeout(t); unsub(); };
  }, [overlays, origin, view, size]);`;

/** Find the coverage effect in a source text and judge it. */
function auditCoverageEffect(text) {
  const at = text.indexOf("computeCoverage(boundsFromLeaflet(geoMapRef.current)");
  if (at < 0) return { found: false };
  const start = text.lastIndexOf("useEffect(() => {", at);
  const depsM = /\n\s*\}, \[([^\]]*)\]\);/.exec(text.slice(at));
  const body = text.slice(start, at + depsM.index);
  const deps = depsM[1].split(",").map((d) => d.trim()).filter(Boolean);
  const problems = [];
  for (const d of deps) if (d === "view" || d === "size") problems.push(`dependency on the whole \`${d}\` object (identity churns — B1189)`);
  const setAt = body.indexOf("setCoverage(");
  const guardAt = body.indexOf("sameCoverage(");
  if (setAt >= 0 && (guardAt < 0 || guardAt > setAt)) problems.push("setCoverage dispatched without the sameCoverage guard");
  return { found: true, deps, problems };
}

describe("sameCoverage — the dispatch guard", () => {
  it("equal verdict maps are the same, whatever their identity", () => {
    expect(sameCoverage({ a: "in", b: "out" }, { b: "out", a: "in" })).toBe(true);
    expect(sameCoverage({}, {})).toBe(true);
    const m = { a: "in" };
    expect(sameCoverage(m, m)).toBe(true);
  });
  it("any changed, added or removed verdict is a change", () => {
    expect(sameCoverage({ a: "in" }, { a: "out" })).toBe(false);
    expect(sameCoverage({ a: "in" }, { a: "in", b: "in" })).toBe(false);
    expect(sameCoverage({ a: "in", b: "in" }, { a: "in" })).toBe(false);
    expect(sameCoverage({ a: "in" }, { b: "in" })).toBe(false);
    expect(sameCoverage(null, {})).toBe(false);
    expect(sameCoverage({}, undefined)).toBe(false);
  });
});

describe("the planner's coverage effect cannot pump renders", () => {
  it("TEETH: the audit flags both defects on the pre-fix effect", () => {
    const r = auditCoverageEffect(PRE_FIX);
    expect(r.found).toBe(true);
    expect(r.problems).toHaveLength(3); // view, size, unguarded dispatch
  });
  it("the shipped effect depends on view/size NUMBERS and guards its dispatch", () => {
    const r = auditCoverageEffect(SRC);
    expect(r.found).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.deps).toEqual(expect.arrayContaining(["view.ppf", "view.offX", "view.offY", "size.w", "size.h"]));
  });
});
