/* modelModule — the workspace-registration guards for the Model spreadsheet module, same
 * eight-place checklist test/notesModule.test.js and test/foodModule.test.js already prove
 * for their own workspaces: a module registered in seven of the eight places it needs still
 * "works", it just loses its accent, or its loader caption, or its prefetch, or its budget.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { MODULE_BY_SLUG, SLUG_BY_MODULE, parseRoute, buildHash } from "../src/app/route.js";
import { MODULE_ACCENT } from "../src/shared/ui/moduleAccent.js";
import { MODULE_TAB_LABEL } from "../src/shared/ui/moduleTabLabel.js";
import { LOADER_SKINS, resolveLoaderTheme } from "../src/shared/ui/moduleLoaderTheme.js";
import { ROUTE_KEYS } from "../ui-audit/lib/bundleMetrics.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = (rel) => readFileSync(join(REPO, rel), "utf8");
const MODULE_ID = "model";

describe("workspace registration — all EIGHT places", () => {
  it("(1) the Shell's WORKSPACES registry lazy-loads the workspace", () => {
    const shell = src("src/app/Shell.jsx");
    expect(shell).toMatch(/id:\s*"model"[\s\S]{0,80}lazy\(\(\)\s*=>\s*import\("\.\.\/workspaces\/model\/ModelApp\.jsx"\)\)/);
  });

  it("(1b) the Shell passes every workspace the signed-in user id, so Model can scope its own storage", () => {
    const shell = src("src/app/Shell.jsx");
    // One shared prop spread onto every mounted workspace (not per-module wiring) — assert the
    // prop exists at all on the <Comp> the WORKSPACES array renders.
    expect(shell).toMatch(/userId=\{user\?\.id \|\| null\}/);
  });

  it("(2) route.js maps the slug BOTH ways, and the two maps agree", () => {
    expect(MODULE_BY_SLUG.model).toBe(MODULE_ID);
    expect(SLUG_BY_MODULE[MODULE_ID]).toBe("model");
  });

  it("(2b) the route round-trips, including with a project", () => {
    expect(parseRoute("#/model")).toEqual({ module: MODULE_ID, projectId: null, cross: false, org: false });
    expect(buildHash({ module: MODULE_ID })).toBe("#/model");
    const withProject = parseRoute(buildHash({ module: MODULE_ID, projectId: "abc" }));
    expect(withProject).toEqual({ module: MODULE_ID, projectId: "abc", cross: false, org: false });
  });

  it("(2c) the Cloudflare clean-path redirect exists for the slug (bare and trailing-slash)", () => {
    const redirects = src("public/_redirects");
    expect(redirects).toMatch(/^\/model\s+\/#\/model\s+302/m);
    expect(redirects).toMatch(/^\/model\/\s+\/#\/model\s+302/m);
  });

  it("(3) modulePrefetch can warm the chunk on navigation intent", () => {
    const prefetch = src("src/app/modulePrefetch.js");
    expect(prefetch).toMatch(/"model":\s*\(\)\s*=>\s*import\("\.\.\/workspaces\/model\/ModelApp\.jsx"\)/);
  });

  it("(3b) the prefetch specifier is byte-identical to the Shell's, so Vite dedupes to ONE chunk", () => {
    const shellSpec = src("src/app/Shell.jsx").match(/import\("(\.\.\/workspaces\/model\/ModelApp\.jsx)"\)/)?.[1];
    const prefetchSpec = src("src/app/modulePrefetch.js").match(/import\("(\.\.\/workspaces\/model\/ModelApp\.jsx)"\)/)?.[1];
    expect(shellSpec).toBeTruthy();
    expect(prefetchSpec).toBe(shellSpec);
  });

  it("(4) moduleAccent carries the module's hue", () => {
    expect(MODULE_ACCENT.model).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it("(5) moduleLoaderTheme gives it a NAMED caption, not the generic fallback", () => {
    expect(LOADER_SKINS.model?.label).toBeTruthy();
    const theme = resolveLoaderTheme("model");
    expect(theme.label).not.toBe("Loading…");
    expect(theme.accent).toBe(MODULE_ACCENT.model);
  });

  it("(6) AppHeader has a module tab, with an icon and BOTH accent maps", () => {
    const header = src("src/shared/ui/AppHeader.jsx");
    expect(header).toMatch(/id:\s*"model"/);
    expect(header).toMatch(/"model":\s*"var\(--accent-model\)"/);
    expect(header).toMatch(/"model":\s*"var\(--accent-model-text\)"/);
    expect(MODULE_TAB_LABEL.model).toBe("Model");
  });

  it("(7) bundleMetrics ROUTE_KEYS names the route, so its budget can be evaluated at all", () => {
    expect(ROUTE_KEYS.model).toEqual({ src: "src/workspaces/model/ModelApp.jsx", stem: "ModelApp" });
  });

  it("(8) the route carries a committed byte budget, wired into the audit AND the ratchet", () => {
    const budgets = JSON.parse(src("ui-audit/perf-budgets.json"));
    expect(budgets.bundle.modelRouteJsBytes).toBeTruthy();
    expect(typeof budgets.bundle.modelRouteJsBytes.baseline).toBe("number");
    const ratchet = src("scripts/perf-ratchet.mjs");
    expect(ratchet).toMatch(/"bundle\.modelRouteJsBytes":\s*measured\.routes\.model\?\.bytes/);
  });

  it("every registry that names the peer workspaces also names this one — no gaps", () => {
    const peers = ["site-planner", "scheduler", "doc-review", "library", "notes"];
    for (const p of peers) expect(MODULE_ACCENT[p], `MODULE_ACCENT missing ${p}`).toBeTruthy();
    expect(MODULE_ACCENT.model, "MODULE_ACCENT missing model").toBeTruthy();
    for (const p of peers) expect(MODULE_TAB_LABEL[p], `MODULE_TAB_LABEL missing ${p}`).toBeTruthy();
    expect(MODULE_TAB_LABEL.model, "MODULE_TAB_LABEL missing model").toBeTruthy();
  });
});

describe("theme tokens, not raw hex, in the module's own chrome", () => {
  const FILES = [
    "src/workspaces/model/ModelApp.jsx",
    "src/workspaces/model/components/SheetView.jsx",
    "src/workspaces/model/components/FormulaBar.jsx",
    // Ribbon.jsx (Stage 2) is deliberately NOT in this list — its TEXT_PALETTE/FILL_PALETTE are
    // CONTENT colours a user picks for their own cells, not app chrome, the same distinction
    // design-drift-audit.mjs's own `// design-exempt:` escape hatch draws (and where those two
    // lines are actually guarded — this file's plain regex has no exemption mechanism).
  ];
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("no bare hex colour literal — every colour is a theme token", () => {
    for (const f of FILES) {
      const code = stripComments(readFileSync(join(REPO, f), "utf8"));
      const hexHits = code.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
      expect(hexHits, `${f} has a raw hex colour: ${hexHits}`).toEqual([]);
    }
  });

  it("no window.prompt/confirm/alert anywhere in the module (owner rule: no dialog boxes)", () => {
    for (const f of FILES) {
      const code = stripComments(readFileSync(join(REPO, f), "utf8"));
      expect(code, `${f} calls a dialog box`).not.toMatch(/window\.(prompt|confirm|alert)\s*\(/);
    }
  });
});
