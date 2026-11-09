/* B329408 — the plan editor stays its own lazy chunk. SitePlannerApp reaches SitePlanner.jsx only through lib/plannerChunk.js's dynamic import(), so the
 * Site route's landing map never pays for the ~1.7 MB editor. A static `import … from "./SitePlanner.jsx"` coming back would put it all on the route again
 * (siteRouteJsBytes +1.7 MB, over its ceiling) — this fails first, without a build. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the plan editor is a lazy chunk", () => {
  const app = code(read("src/workspaces/site-planner/SitePlannerApp.jsx"));
  it("SitePlannerApp has no static import of SitePlanner.jsx", () => {
    expect(app).not.toMatch(/^\s*import\s[^;]*from\s*["']\.\/SitePlanner\.jsx["']/m);
    expect(app).not.toMatch(/import\(\s*["']\.\/SitePlanner\.jsx["']\s*\)/); // only plannerChunk.js holds the import()
  });
  it("it renders the editor through lazy(loadPlanner) inside a Suspense, and warms through the same door", () => {
    expect(app).toMatch(/const SitePlanner = lazy\(loadPlanner\)/);
    expect(app).toMatch(/<Suspense fallback=\{null\}>\s*<SitePlanner/);
    expect(app).toMatch(/loadPlanner\(\)\.then\(\(m\) => m\.warmPlanForMount\(id\)\)/);
    expect(app).toMatch(/prefetchPlanner\(\)/);
  });
  it("no other always-loaded module imports SitePlanner.jsx statically", () => {
    const hits = [];
    for (const f of ["src/app/Shell.jsx", "src/main.jsx", "src/workspaces/site-planner/MapFinder.jsx", "src/shared/ui/AppHeader.jsx"]) {
      if (/^\s*import\s[^;]*from\s*["'][^"']*\/SitePlanner\.jsx["']/m.test(code(read(f)))) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
});

describe("plannerChunk — one shared promise, a failure is forgotten", () => {
  it("the module exposes the door and holds the only import() of the editor", async () => {
    const m = await import("../src/workspaces/site-planner/lib/plannerChunk.js");
    expect(typeof m.loadPlanner).toBe("function");
    expect(typeof m.prefetchPlanner).toBe("function");
    expect(code(read("src/workspaces/site-planner/lib/plannerChunk.js"))).toMatch(/import\("\.\.\/SitePlanner\.jsx"\)/);
  });
});
