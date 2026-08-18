/* foodModule — the guards that keep /food wired up and, above all, ISOLATED from site-planner.
 *
 * The owner's brief for this module was explicit that bundle isolation is "the ONE thing that
 * matters most" — a restaurant tracker must never cost the Site route a byte. So this suite
 * checks the ordinary eight-place workspace-registration checklist (same shape as
 * notesModule.test.js) AND, more load-bearing here, a source scan proving zero imports from
 * src/workspaces/site-planner anywhere under src/workspaces/food/.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { MODULE_BY_SLUG, SLUG_BY_MODULE, parseRoute, buildHash } from "../src/app/route.js";
import { MODULE_ACCENT } from "../src/shared/ui/moduleAccent.js";
import { LOADER_SKINS, resolveLoaderTheme } from "../src/shared/ui/moduleLoaderTheme.js";
import { ROUTE_KEYS } from "../ui-audit/lib/bundleMetrics.mjs";
import { manualPinsFromVisits, loggedPlaceIds } from "../src/workspaces/food/lib/foodStore.js";
import { roundKey, queryFor, fromElement } from "../src/workspaces/food/lib/overpass.js";
import { clusterPoints, dominantKind } from "../src/workspaces/food/lib/markerCluster.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOOD = join(REPO, "src", "workspaces", "food");
const read = (...p) => readFileSync(join(...p), "utf8");
const src = (rel) => read(FOOD, rel);
const MODULE_ID = "food";

function walk(dir, onFile) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. BUNDLE ISOLATION — the module's one hard rule
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("bundle isolation — zero site-planner imports", () => {
  const files = [];
  walk(FOOD, (f) => { if (/\.(js|jsx)$/.test(f)) files.push(f); });

  it("found the food workspace's source files (the scan below is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const f of files) {
    const rel = f.slice(REPO.length + 1);
    it(`${rel} imports nothing from src/workspaces/site-planner`, () => {
      const code = stripComments(readFileSync(f, "utf8"));
      const hits = [...code.matchAll(/from\s+["']([^"']*site-planner[^"']*)["']/g)].map((m) => m[1]);
      expect(hits, `${rel} imports ${hits.join(", ")} from site-planner`).toEqual([]);
    });
  }

  it("has its own Supabase client rather than importing site-planner's", () => {
    expect(existsSync(join(FOOD, "lib", "supabaseClient.js"))).toBe(true);
    const client = src("lib/supabaseClient.js");
    expect(client).toContain("createClient");
    expect(client).not.toMatch(/from\s+["'][^"']*site-planner[^"']*["']/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. THE ROUTE WORKS — Shell + route.js still resolve #/food to FoodApp
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("the route itself still works (NEW-2 changes discoverability, not the route)", () => {
  it("(1) the Shell's WORKSPACES registry lazy-loads the workspace", () => {
    const shell = read(REPO, "src/app/Shell.jsx");
    expect(shell).toMatch(/id:\s*"food"[\s\S]{0,120}?FoodApp\.jsx/);
  });

  it("(2) route.js maps the slug both ways, and the two maps agree", () => {
    expect(MODULE_BY_SLUG.food).toBe(MODULE_ID);
    expect(SLUG_BY_MODULE[MODULE_ID]).toBe("food");
    for (const [slug, mod] of Object.entries(MODULE_BY_SLUG)) expect(SLUG_BY_MODULE[mod]).toBe(slug);
  });

  it("(2b) the route round-trips: #/food -> {module:'food'} -> #/food", () => {
    expect(parseRoute("#/food")).toEqual({ module: "food", projectId: null, cross: false });
    expect(buildHash({ module: "food" })).toBe("#/food");
  });

  it("(3) bundleMetrics ROUTE_KEYS names the route, so its budget can be evaluated at all", () => {
    expect(ROUTE_KEYS.food).toEqual({ src: "src/workspaces/food/FoodApp.jsx", stem: "FoodApp" });
  });

  it("(4) the route carries a committed byte budget, wired into the audit AND the ratchet", () => {
    const budgets = JSON.parse(read(REPO, "ui-audit/perf-budgets.json"));
    expect(budgets.bundle.foodRouteJsBytes, "no budget = the route can grow without limit").toBeTruthy();
    expect(budgets.bundle.foodRouteJsBytes.baseline).toBeTypeOf("number");
    expect(budgets.bundle.foodRouteJsBytes.baseline).toBeGreaterThan(0);
    expect(budgets.bundle.foodRouteJsBytes.ceiling, "byte metrics derive their ceiling; they never hand-pin one").toBeUndefined();
    expect(read(REPO, "ui-audit/perf-bundle-audit.mjs")).toContain("bundle.foodRouteJsBytes");
    expect(read(REPO, "scripts/perf-ratchet.mjs")).toContain("bundle.foodRouteJsBytes");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2b. ⛔ UNLISTED, NOT A WORKSPACE (NEW-2, owner correction to B568400) — /food is reachable
 *     ONLY by typing the URL. "an Easter egg", verbatim. Every surface that enumerates
 *     workspaces FOR DISPLAY must not name it; the route plumbing above is untouched.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("/food is unlisted — no discoverability surface names it", () => {
  it("the workspace tab list must not contain a food entry (the guard NEW-2 asks for)", () => {
    const hdr = read(REPO, "src/shared/ui/AppHeader.jsx");
    const modulesBlock = hdr.slice(hdr.indexOf("const MODULES = ["), hdr.indexOf("\n];", hdr.indexOf("const MODULES = [")));
    expect(modulesBlock).not.toMatch(/id:\s*"food"/);
    expect(modulesBlock, "and no peer went missing in the edit").toMatch(/id:\s*"notes"/);
  });

  it("neither accent map in AppHeader names food (no tab underline/label color to wire up)", () => {
    const hdr = read(REPO, "src/shared/ui/AppHeader.jsx");
    expect(hdr).not.toMatch(/"food":\s*"var\(--accent-food\)"/);
    expect(hdr).not.toMatch(/"food":\s*"var\(--accent-food-text\)"/);
  });

  it("modulePrefetch has no food importer — nothing would ever call it (no tab to hover)", () => {
    const prefetch = read(REPO, "src/app/modulePrefetch.js");
    expect(prefetch).not.toMatch(/"food":\s*\(\)\s*=>/);
  });

  it("moduleAccent and moduleLoaderTheme don't name food — it gets the generic loader fallback", () => {
    expect(MODULE_ACCENT.food).toBeUndefined();
    expect(LOADER_SKINS.food).toBeUndefined();
    const theme = resolveLoaderTheme("food");
    expect(theme.label).toBe("Loading…");
  });

  it("navigating to module='food' renders NO active tab — same as any unrecognized route, no special case", () => {
    const hdr = read(REPO, "src/shared/ui/AppHeader.jsx");
    // moduleTabButtons maps MODULES (not some food-aware superset) and marks isActive by
    // m.id === module — with no food entry in MODULES, module="food" cannot match any tab.
    // This asserts the MECHANISM (one map, one predicate, no branch for an unlisted module)
    // rather than a rendered snapshot, so the property holds regardless of chrome styling.
    expect(hdr).toMatch(/MODULES\.map\(\(m\)\s*=>\s*[\s\S]{0,80}?isActive=\{m\.id === module\}/);
  });

  it("every OTHER (listed) workspace is still fully wired — this is a food-only removal", () => {
    const peers = ["site-planner", "doc-review", "library", "scheduler", "notes"];
    for (const registry of [MODULE_ACCENT, LOADER_SKINS, SLUG_BY_MODULE]) {
      for (const p of peers) expect(registry[p], `peer ${p}`).toBeTruthy();
    }
    const hdr = read(REPO, "src/shared/ui/AppHeader.jsx");
    for (const p of peers) expect(hdr, `peer ${p}'s tab`).toMatch(new RegExp(`id:\\s*"${p}"`));
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2c. CLEAN-PATH ENTRANCES (B576000/NEW-3) — planyr.io/food (no hash) must not 404.
 *     "The Food module was not supposed to be its own item in the header... it's basically
 *     an Easter egg" (NEW-2) made /food unlisted, but the owner still types the clean path
 *     into the address bar — that's the whole point of "an Easter egg you have to know about".
 *     Cloudflare Pages has no SPA catch-all (B449, see public/_redirects's own header), so a
 *     bare /food request never reaches the React app at all — it hits public/404.html, a
 *     static file with none of the app's JS. No in-app fix (a boot-time shim, a route.js
 *     change) can run in a request that never loads the app's JS in the first place. So the
 *     fix lives in public/_redirects: one real HTTP redirect per KNOWN slug, straight to its
 *     hash form, before the browser ever requests page content.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("clean-path entrances — public/_redirects sends every known slug to its hash route", () => {
  const redirectsText = read(REPO, "public/_redirects");
  const rules = redirectsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status };
    });

  const ruleFor = (path) => rules.find((r) => r.from === path);

  it("found the redirect rules (the scan below is not vacuous)", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("the /assets/* stale-chunk 404 (B449) is untouched by this addition", () => {
    const assetsRule = ruleFor("/assets/*");
    expect(assetsRule).toBeTruthy();
    expect(assetsRule.to).toBe("/404.html");
    expect(assetsRule.status).toBe("404");
  });

  for (const [module, slug] of Object.entries(SLUG_BY_MODULE)) {
    describe(`slug "${slug}" (module "${module}")`, () => {
      it(`/${slug} redirects to /#/${slug} with a real HTTP redirect status`, () => {
        const rule = ruleFor(`/${slug}`);
        expect(rule, `no /_redirects rule for /${slug} — planyr.io/${slug} will 404`).toBeTruthy();
        expect(rule.to).toBe(`/#/${slug}`);
        expect(Number(rule.status), "a 200 here would rewrite silently, not redirect — the hash still wouldn't be set").toBeGreaterThanOrEqual(300);
        expect(Number(rule.status)).toBeLessThan(400);
      });

      it(`/${slug}/ (trailing slash) redirects too — Cloudflare's matching is exact-path, not prefix`, () => {
        const rule = ruleFor(`/${slug}/`);
        expect(rule, `no /_redirects rule for /${slug}/ — planyr.io/${slug}/ will 404`).toBeTruthy();
        expect(rule.to).toBe(`/#/${slug}`);
        expect(Number(rule.status)).toBeGreaterThanOrEqual(300);
        expect(Number(rule.status)).toBeLessThan(400);
      });

      it(`the redirect target round-trips back to module "${module}" via parseRoute`, () => {
        expect(parseRoute(`#/${slug}`).module).toBe(module);
      });
    });
  }

  it("no slug in SLUG_BY_MODULE is missing a rule, and no stray top-level rule names an unknown slug", () => {
    const knownSlugs = new Set(Object.values(SLUG_BY_MODULE));
    const topLevelSlugPattern = /^\/([a-z-]+)\/?$/;
    const namedInRedirects = new Set(
      rules
        .map((r) => r.from.match(topLevelSlugPattern))
        .filter(Boolean)
        .map((m) => m[1])
    );
    for (const slug of knownSlugs) expect(namedInRedirects, `${slug} has no /_redirects rule`).toContain(slug);
    for (const named of namedInRedirects) expect(knownSlugs, `/_redirects names unknown slug "${named}"`).toContain(named);
  });

  it("/food specifically still resolves to the food module with no visible surface added", () => {
    // The route mapping is proven generically above; this pins the one slug NEW-3 was filed
    // for, so a future refactor of SLUG_BY_MODULE can't silently drop "food" and pass anyway.
    const rule = ruleFor("/food");
    expect(rule.to).toBe("/#/food");
    expect(MODULE_BY_SLUG.food).toBe("food");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. HOUSE RULES: no dialog boxes, chrome is theme tokens
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("no dialog boxes", () => {
  const files = [];
  walk(FOOD, (f) => { if (/\.jsx$/.test(f)) files.push(f); });
  for (const f of files) {
    const rel = f.slice(FOOD.length + 1);
    it(`${rel} never calls window.prompt/confirm/alert`, () => {
      const code = stripComments(readFileSync(f, "utf8"));
      expect(code).not.toMatch(/\b(window\.)?(prompt|confirm|alert)\s*\(/);
    });
  }
});

describe("chrome is theme tokens only", () => {
  const CHROME_SURFACES = ["FoodApp.jsx", "components/VisitPanel.jsx", "components/VisitList.jsx"];
  for (const f of CHROME_SURFACES) {
    it(`${f} contains no raw hex — a hardcoded colour is the B341 trap`, () => {
      const hits = [...stripComments(src(f)).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
      expect(hits, `${f} hardcodes ${hits.join(", ")} instead of a theme token`).toEqual([]);
    });
  }

  it("FoodMap's only literal colours are the canvas marker palette — documented, not an oversight", () => {
    const text = src("components/FoodMap.jsx");
    const paletteBlock = text.slice(text.indexOf("const COLORS"), text.indexOf("function boundsOf"));
    const all = [...text.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    // The canvas marker's white keyline stroke ("#fff") is also a Leaflet canvas style value,
    // not CSS — same reasoning as the palette itself, so it's allowed alongside it.
    const allowed = [...paletteBlock.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]).concat(["#fff"]);
    expect(all.length).toBeGreaterThan(0);
    for (const hex of all) expect(allowed, `${hex} is outside the documented canvas palette`).toContain(hex);
  });

  it("the module's chrome actually uses its accent tokens", () => {
    const all = CHROME_SURFACES.map(src).join("\n");
    for (const token of ["var(--accent-food)", "var(--on-accent-food)"]) {
      expect(all, `${token} is declared but never used`).toContain(token);
    }
  });

  it("the CSS tokens exist in both themes", () => {
    const css = read(REPO, "src/index.css");
    expect(css).toMatch(/--accent-food:\s*#BE3B22/);
    expect(css).toMatch(/--on-accent-food:\s*#FFFFFF/);
    expect([...css.matchAll(/--accent-food-text:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1])).toEqual(["#9E3019", "#F0906F"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. PURE LIB UNIT TESTS
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("foodStore — manualPinsFromVisits / loggedPlaceIds", () => {
  it("groups manual-pin visits by (name, rounded lat/lon) into one pin per spot", () => {
    const visits = [
      { id: "v1", place_id: null, custom_name: "Taco Truck", custom_lat: 29.7601, custom_lon: -95.3701 },
      { id: "v2", place_id: null, custom_name: "Taco Truck", custom_lat: 29.76011, custom_lon: -95.37009 }, // same spot, tiny float noise
      { id: "v3", place_id: null, custom_name: "Other Truck", custom_lat: 30.1, custom_lon: -96.0 },
      { id: "v4", place_id: "overture:abc", custom_name: null, custom_lat: null, custom_lon: null }, // not a manual pin
    ];
    const pins = manualPinsFromVisits(visits);
    expect(pins).toHaveLength(2);
    const truck = pins.find((p) => p.name === "Taco Truck");
    expect(truck.visitIds.sort()).toEqual(["v1", "v2"]);
  });

  it("returns nothing when there are no manual pins", () => {
    expect(manualPinsFromVisits([{ id: "v1", place_id: "x" }])).toEqual([]);
  });

  it("loggedPlaceIds collects only the place_id-bearing visits, deduped", () => {
    const visits = [
      { id: "v1", place_id: "a" }, { id: "v2", place_id: "a" }, { id: "v3", place_id: "b" },
      { id: "v4", place_id: null },
    ];
    const ids = loggedPlaceIds(visits);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });
});

describe("overpass — pure query/response shaping (no network)", () => {
  const bounds = { south: 29.7501, west: -95.3901, north: 29.7699, east: -95.3701 };

  it("roundKey collapses near-identical bboxes to the same cache key", () => {
    const a = roundKey(bounds);
    const b = roundKey({ south: 29.75009, west: -95.39011, north: 29.76991, east: -95.37009 });
    expect(a).toBe(b);
  });

  it("roundKey distinguishes genuinely different areas", () => {
    expect(roundKey(bounds)).not.toBe(roundKey({ south: 30, west: -96, north: 30.5, east: -95.5 }));
  });

  it("queryFor builds an Overpass QL query naming the eat-and-drink tags and the bbox", () => {
    const q = queryFor(bounds);
    expect(q).toContain("restaurant");
    expect(q).toContain("cafe");
    expect(q).toContain(String(bounds.south));
    expect(q).toContain(String(bounds.east));
  });

  it("fromElement shapes an OSM node into the same fields the Overture rows carry", () => {
    const el = {
      type: "node", id: 12345, lat: 29.76, lon: -95.37,
      tags: { name: "Joe's BBQ", amenity: "restaurant", cuisine: "barbecue", "addr:housenumber": "10", "addr:street": "Main St" },
    };
    const place = fromElement(el);
    expect(place).toMatchObject({
      id: "osm:node/12345", name: "Joe's BBQ", lat: 29.76, lon: -95.37,
      category: "restaurant", cuisine: "barbecue", address: "10 Main St",
      source: "OpenStreetMap", source_licence: "ODbL-1.0",
    });
  });

  it("fromElement never throws on a nameless/tagless node", () => {
    const place = fromElement({ type: "node", id: 1, lat: 0, lon: 0 });
    expect(place.name).toBe("Unnamed place");
    expect(place.address).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4b. NEW-4 — the viewport-aware, spatially-distributed capped query (the LIMIT-with-no-
 *     ORDER-BY bug the owner reported as "clearly all grouped in a specific section").
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-4 — food_places_in_bounds_sampled wiring", () => {
  it("foodStore calls the grid-sampled RPC, not a plain capped .limit() query", () => {
    const store = src("lib/foodStore.js");
    expect(store).toContain('supabase.rpc("food_places_in_bounds_sampled"');
    expect(store).not.toMatch(/\.from\("food_places"\)[\s\S]{0,200}?\.limit\(/);
  });

  it("fetchPlacesInBounds reports capped/totalMatched so the UI can say so, never silently truncate", () => {
    const store = src("lib/foodStore.js");
    expect(store).toMatch(/capped:\s*totalMatched\s*>\s*rows\.length/);
  });

  it("the committed migration defines the RPC and grants it the same public-read shape as the table", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("create or replace function public.food_places_in_bounds_sampled(");
    expect(sql).toMatch(/grant execute on function public\.food_places_in_bounds_sampled\([\s\S]{0,120}?\) to anon, authenticated/);
  });

  it("the RPC partitions the bbox into a grid and takes an even share per cell (never a bare LIMIT)", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("width_bucket(lat, p_south, p_north, greatest(p_grid, 1)) as gy");
    expect(sql).toContain("width_bucket(lon, p_west, p_east, greatest(p_grid, 1)) as gx");
    expect(sql).toContain("partition by gy, gx");
    expect(sql).toContain("count(*) over () as total_matched");
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4c. NEW-5 — the basemap swap (reused what already exists first, chose the free/no-key/
 *     no-account/no-billing option) + the hand-rolled grid clusterer (pure, so it's unit-
 *     tested directly rather than only through a browser).
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-5 — basemap + clustering", () => {
  it("FoodMap uses the free, key-less CARTO Positron tiles, not the busy default OSM raster", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toContain("basemaps.cartocdn.com/light_all");
    expect(map).not.toContain("tile.openstreetmap.org");
  });

  it("the tile attribution still credits OpenStreetMap (CARTO's own tiles are OSM data restyled)", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/openstreetmap\.org\/copyright/);
    expect(map).toMatch(/carto\.com\/attributions/);
  });

  it("no marker-clustering package was added — package.json still names no clustering dependency", () => {
    const pkg = JSON.parse(read(REPO, "package.json"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(allDeps).some((k) => /cluster/i.test(k))).toBe(false);
  });

  it("FoodMap draws through the pure clusterer rather than one marker per point unconditionally", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toContain("clusterPoints(combined, project, CLUSTER_CELL_PX)");
  });
});

describe("markerCluster — pure grid clustering (no Leaflet, no DOM)", () => {
  it("dominantKind prefers manual > logged > unlogged, so a cluster never hides a visited place", () => {
    expect(dominantKind(["unlogged", "unlogged"])).toBe("unlogged");
    expect(dominantKind(["unlogged", "logged"])).toBe("logged");
    expect(dominantKind(["logged", "manual"])).toBe("manual");
    expect(dominantKind(["manual", "logged", "unlogged"])).toBe("manual");
  });

  it("two points that land in the same screen cell merge into one cluster", () => {
    const items = [
      { lat: 29.76, lon: -95.37, kind: "unlogged" },
      { lat: 29.7601, lon: -95.3701, kind: "unlogged" },
    ];
    const project = () => [100, 100]; // both land at the identical screen point
    const clusters = clusterPoints(items, project, 60);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(2);
  });

  it("two points far apart on screen stay as two singleton clusters", () => {
    const items = [
      { lat: 29.76, lon: -95.37, kind: "unlogged" },
      { lat: 29.9, lon: -95.1, kind: "logged" },
    ];
    const project = (lat) => (lat === 29.76 ? [10, 10] : [900, 900]);
    const clusters = clusterPoints(items, project, 60);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.count === 1)).toBe(true);
  });

  it("a singleton cluster carries its original item back out, so a caller needs no second lookup", () => {
    const item = { lat: 29.76, lon: -95.37, kind: "manual", name: "Taco Truck" };
    const clusters = clusterPoints([item], () => [50, 50], 60);
    expect(clusters[0].items[0]).toMatchObject({ name: "Taco Truck" });
  });

  it("a mixed-kind cluster reports the dominant kind, not the first or last point's kind", () => {
    const items = [
      { lat: 1, lon: 1, kind: "unlogged" },
      { lat: 1, lon: 1, kind: "logged" },
      { lat: 1, lon: 1, kind: "unlogged" },
    ];
    const clusters = clusterPoints(items, () => [0, 0], 60);
    expect(clusters[0].kind).toBe("logged");
  });

  it("empty input returns no clusters, and a non-finite projection is skipped rather than thrown", () => {
    expect(clusterPoints([], () => [0, 0], 60)).toEqual([]);
    const items = [{ lat: 999, lon: 999, kind: "unlogged" }];
    expect(clusterPoints(items, () => [NaN, NaN], 60)).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE RLS SHAPE, AS COMMITTED SQL (the live-database proof is db/test/food_rls.test.sql,
 *    already run against production — see its own header for the 7/7 result)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("db/food.sql — the committed migration matches the two-table RLS design", () => {
  const sql = src("db/food.sql");

  it("food_places is public-read (anon AND authenticated)", () => {
    expect(sql).toMatch(/create policy "Public read food_places"[\s\S]{0,80}?for select to anon, authenticated using \(true\)/);
    expect(sql).toMatch(/grant select on public\.food_places to anon, authenticated/);
  });

  it("food_places has no insert/update/delete policy for anon or authenticated — service-role-write-only", () => {
    expect(sql).not.toMatch(/create policy[^;]*food_places[^;]*for (insert|update|delete)/i);
  });

  it("food_visits has all four owner-only policies, keyed on auth.uid(), and NO anon policy", () => {
    // INSERT policies only ever have a WITH CHECK clause in Postgres; the other three use USING.
    const clauseFor = { select: "using", insert: "with check", update: "using", delete: "using" };
    for (const op of ["select", "insert", "update", "delete"]) {
      const re = new RegExp(`create policy "Users ${op} own food_visits"[\\s\\S]{0,200}?for ${op} to authenticated ${clauseFor[op]} \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`, "i");
      expect(sql, `missing/mismatched ${op} policy`).toMatch(re);
    }
    expect(sql).not.toMatch(/food_visits[\s\S]{0,300}?to anon/);
  });

  it("RLS is enabled on both tables", () => {
    expect(sql).toMatch(/alter table public\.food_places enable row level security/);
    expect(sql).toMatch(/alter table public\.food_visits enable row level security/);
  });

  it("the RLS proof script exists and is self-rolling-back (raises at the end)", () => {
    const proof = src("db/test/food_rls.test.sql");
    expect(proof).toMatch(/raise exception/);
    expect(proof).toContain("PASS 5"); // the different-signed-in-user isolation check
  });
});
