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
import { manualPinsFromVisits, loggedPlaceIds, avgRatingByPlaceId } from "../src/workspaces/food/lib/foodStore.js";
import { roundKey, queryFor, fromElement } from "../src/workspaces/food/lib/overpass.js";
import { RATING_COLORS, RATING_TEXT, colorForRating, textColorForRating } from "../src/workspaces/food/lib/ratingColor.js";
import { formatCategory, formatAddress } from "../src/workspaces/food/lib/formatPlace.js";

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

  it("manualPinsFromVisits carries the mean of that pin's rated visits as avgRating", () => {
    const visits = [
      { id: "v1", place_id: null, custom_name: "Taco Truck", custom_lat: 29.76, custom_lon: -95.37, rating: 6 },
      { id: "v2", place_id: null, custom_name: "Taco Truck", custom_lat: 29.76, custom_lon: -95.37, rating: 8 },
      { id: "v3", place_id: null, custom_name: "Unrated Spot", custom_lat: 30, custom_lon: -96, rating: null },
    ];
    const pins = manualPinsFromVisits(visits);
    expect(pins.find((p) => p.name === "Taco Truck").avgRating).toBe(7);
    expect(pins.find((p) => p.name === "Unrated Spot").avgRating).toBeUndefined();
  });

  it("avgRatingByPlaceId means only the rated visits for a place, ignoring nulls, keyed by place_id", () => {
    const visits = [
      { id: "v1", place_id: "a", rating: 4 }, { id: "v2", place_id: "a", rating: 10 },
      { id: "v3", place_id: "b", rating: null }, { id: "v4", place_id: null, rating: 9 },
    ];
    const avgs = avgRatingByPlaceId(visits);
    expect(avgs.get("a")).toBe(7);
    expect(avgs.has("b")).toBe(false); // visited, never rated -> no entry, not a 0
    expect(avgs.has(null)).toBe(false); // manual pins are never keyed here
  });

  it("⛔ avgRatingByPlaceId/manualPinsFromVisits coerce a STRING rating (Postgres numeric over PostgREST) and handle halves", () => {
    // rating is numeric(3,1); PostgREST returns numeric columns as JSON strings ("7.5") to
    // avoid float-precision loss over the wire. A raw string summed with `+=` would concatenate
    // ("7"+"8" -> "78") instead of adding -- this proves the Number() coercion actually runs.
    const byPlace = avgRatingByPlaceId([
      { id: "v1", place_id: "a", rating: "7" }, { id: "v2", place_id: "a", rating: "8" },
    ]);
    expect(byPlace.get("a")).toBe(7.5);

    const pins = manualPinsFromVisits([
      { id: "v1", place_id: null, custom_name: "Truck", custom_lat: 29.76, custom_lon: -95.37, rating: "7.5" },
      { id: "v2", place_id: null, custom_name: "Truck", custom_lat: 29.76, custom_lon: -95.37, rating: "8.5" },
    ]);
    expect(pins[0].avgRating).toBe(8);
  });
});

describe("ratingColor — the 1-10 pin colour ramp (no clustering, no red/green, measured contrast)", () => {
  function relLum(hex) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrast(hexA, hexB) {
    const [a, b] = [relLum(hexA), relLum(hexB)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  }

  it("has exactly 10 steps, one per rating value", () => {
    expect(RATING_COLORS).toHaveLength(10);
    expect(RATING_TEXT).toHaveLength(10);
  });

  it("contains no green — a red/green ramp is exactly what was ruled out", () => {
    for (const hex of RATING_COLORS) {
      const g = parseInt(hex.slice(3, 5), 16);
      const r = parseInt(hex.slice(1, 3), 16);
      // "no green" as a colour-identity claim: green channel never dominant over red.
      expect(g, `${hex} reads green-dominant`).toBeLessThanOrEqual(r);
    }
  });

  it("relative luminance falls STRICTLY from step 1 to step 10 (measured, not eyeballed)", () => {
    const lums = RATING_COLORS.map(relLum);
    for (let i = 1; i < lums.length; i++) expect(lums[i], `step ${i + 1} did not darken`).toBeLessThan(lums[i - 1]);
  });

  it("every step's paired text colour clears WCAG AA (>=4.5:1, the small-bold-text bar)", () => {
    RATING_COLORS.forEach((hex, i) => {
      const ratio = contrast(hex, RATING_TEXT[i]);
      expect(ratio, `step ${i + 1} (${hex} on ${RATING_TEXT[i]}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  });

  it("step 8 matches the module's own --accent-food token — the ramp ties to the module's brand colour", () => {
    const css = read(REPO, "src/index.css");
    expect(css).toMatch(/--accent-food:\s*#BE3B22/i);
    expect(RATING_COLORS[7]).toBe("#BE3B22");
  });

  it("colorForRating/textColorForRating round, clamp to [1,10], and return null for no rating", () => {
    expect(colorForRating(null)).toBeNull();
    expect(colorForRating(undefined)).toBeNull();
    expect(colorForRating(NaN)).toBeNull();
    expect(colorForRating(7.4)).toBe(RATING_COLORS[6]); // rounds to 7
    expect(colorForRating(0)).toBe(RATING_COLORS[0]); // clamped up to 1
    expect(colorForRating(15)).toBe(RATING_COLORS[9]); // clamped down to 10
    expect(textColorForRating(null)).toBeNull();
    expect(textColorForRating(3)).toBe(RATING_TEXT[2]);
  });

  it("⛔ handles half-point ratings (the slider control) — a .5 value lands on a real ramp step, never null", () => {
    expect(colorForRating(7.5)).toBe(RATING_COLORS[7]); // rounds up to 8
    expect(colorForRating(1.5)).toBe(RATING_COLORS[1]); // rounds up to 2
    expect(colorForRating(9.5)).toBe(RATING_COLORS[9]); // rounds up to 10
    expect(textColorForRating(7.5)).toBe(RATING_TEXT[7]);
  });

  it("⛔ coerces a STRING rating — Postgres numeric round-trips as a JSON string over PostgREST", () => {
    // rating is now numeric(3,1) (was smallint); PostgREST returns numeric columns as strings
    // ("7.5") to avoid float-precision loss over the wire, exactly like `cost` already does.
    // Without Number() coercion, Number.isFinite("7.5") is false and every rated pin would
    // silently fall back to the flat "logged" colour instead of the ramp.
    expect(colorForRating("7.5")).toBe(RATING_COLORS[7]);
    expect(colorForRating("7")).toBe(RATING_COLORS[6]);
    expect(textColorForRating("9.0")).toBe(RATING_TEXT[8]);
    expect(colorForRating("not-a-number")).toBeNull();
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
 * 4b. NEW-4 — the viewport-aware, PROPORTIONALLY-distributed capped query. Superseded once
 *     already: the first RPC gave every grid cell the SAME fixed cap, which was ITSELF a
 *     biased slice (measured on production: a dense cell returned ~6% of its true content, a
 *     sparse cell ~88% — a >13x disparity) — exactly the "focusing on the middle of the
 *     screen... distribution is uneven" the owner reported even after the first fix shipped.
 *     Each cell's share of the cap is now weighted by its OWN true count.
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

  it("the RPC partitions the bbox into a grid AND weights each cell's cap by its own true count — never a flat 1/N share", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("width_bucket(lat, p_south, p_north, greatest(p_grid, 1)) as gy");
    expect(sql).toContain("width_bucket(lon, p_west, p_east, greatest(p_grid, 1)) as gx");
    expect(sql).toContain("partition by gy, gx");
    expect(sql).toContain("count(*) over () as total_matched");
    // The proportional weighting — this is the line that fixed the >13x disparity. A flat
    // `p_cap / (grid*grid)` cap (the superseded version) must never come back.
    expect(sql).toContain("count(*) over (partition by gy, gx) as cell_count");
    expect(sql).toMatch(/ceil\(p_cap::numeric \* cell_count \/ greatest\(total_matched,\s*1\)\)/);
    expect(sql).not.toMatch(/p_cap\s*\/\s*\(greatest\(p_grid,\s*1\)\s*\*\s*greatest\(p_grid,\s*1\)\)/);
  });

  it("the rating scale is 1-10 in the schema, not 1-5", () => {
    const sql = src("db/food.sql");
    expect(sql).not.toMatch(/rating between 1 and 5/);
    // The inline check only governs a first-ever `create table` — an already-existing
    // production table needs an explicit ALTER, which must also be present and idempotent.
    expect(sql).toMatch(/alter table public\.food_visits drop constraint if exists food_visits_rating_check/);
  });

  it("the rating column allows half-point steps — numeric(3,1), not smallint", () => {
    // Owner request, 2026-08-18: "let me pick intervals of .5 too". numeric(3,1) matches this
    // table's own `cost numeric(8,2)` precedent for decimal values (never re-invent a second
    // decimal representation like an integer half-point count).
    const sql = src("db/food.sql");
    expect(sql).toMatch(/rating\s+numeric\(3,1\)\s+check/);
    expect(sql).not.toMatch(/rating\s+smallint/);
    expect(sql).toMatch(/alter table public\.food_visits alter column rating type numeric\(3,1\)/);
    // Both the inline (fresh-install) and the ALTER (already-existing table) checks must
    // reject anything that isn't a whole or half point, e.g. 7.3 — never just clamp 1-10.
    const halvesCheckHits = [...sql.matchAll(/rating \* 2 = round\(rating \* 2\)/g)];
    expect(halvesCheckHits.length).toBeGreaterThanOrEqual(2);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4c. NEW-5 (revised) — a colourful key-less basemap (CARTO Voyager, not the flat-grey
 *     Positron this module shipped first) + NO CLUSTERING (the owner rejected the whole
 *     clustering model, not the tuning: "i dont want to lump things together"). Below the
 *     zoom threshold, ONLY his own logged/rated places draw — the 34,000-place reference
 *     snapshot is a lookup he reaches into once zoomed in, never metro-wide content.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("NEW-5 (revised) — colourful basemap, no clustering, his places always visible", () => {
  it("FoodMap uses CARTO's free, key-less Voyager tiles — colourful, not the flat-grey Positron", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toContain("basemaps.cartocdn.com/rastertiles/voyager");
    expect(map).not.toContain("basemaps.cartocdn.com/light_all");
    expect(map).not.toContain("tile.openstreetmap.org");
  });

  it("the tile attribution still credits OpenStreetMap (CARTO's own tiles are OSM data restyled)", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/openstreetmap\.org\/copyright/);
    expect(map).toMatch(/carto\.com\/attributions/);
  });

  it("clustering is gone — no clusterer module, no import of one, no clustering package added", () => {
    expect(existsSync(join(FOOD, "lib", "markerCluster.js"))).toBe(false);
    const map = src("components/FoodMap.jsx");
    expect(map).not.toMatch(/clusterPoints|markerCluster/);
    const pkg = JSON.parse(read(REPO, "package.json"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(Object.keys(allDeps).some((k) => /cluster/i.test(k))).toBe(false);
  });

  it("below the zoom threshold, only loggedPlaces + manualPins draw — the reference snapshot is gated on !tooSmall", () => {
    const map = src("components/FoodMap.jsx");
    const drawEffect = map.slice(map.indexOf("Redraw markers"), map.indexOf("const showCappedNotice"));
    // His own places are drawn OUTSIDE any tooSmall gate.
    const hisPlacesBlock = drawEffect.slice(0, drawEffect.indexOf("if (!tooSmall)"));
    expect(hisPlacesBlock).toMatch(/for \(const p of loggedPlaces \|\| \[\]\)/);
    expect(hisPlacesBlock).toMatch(/for \(const pin of manualPins \|\| \[\]\)/);
    // The reference snapshot (`places`) and the live-search fallback are BOTH inside the gate.
    const gatedBlock = drawEffect.slice(drawEffect.indexOf("if (!tooSmall)"));
    expect(gatedBlock).toMatch(/for \(const p of places \|\| \[\]\)/);
    expect(gatedBlock).toMatch(/for \(const p of overpassPlaces \|\| \[\]\)/);
  });

  it("his places are coloured by the 1-10 rating ramp when rated, falling back to the flat logged/manual colour otherwise", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/colorForRating\(p\.avgRating\)\s*\|\|\s*COLORS\.logged/);
    expect(map).toMatch(/colorForRating\(pin\.avgRating\)\s*\|\|\s*COLORS\.manual/);
  });

  it("the zoomed-out empty state reads as intentional, not broken — no 'zoom in to see food places' copy left over", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/Zoom in to browse restaurants near you/);
    expect(map).toMatch(/Showing only places you've been/);
  });

  it("⛔ RECURRENCE GUARD — the zoom threshold is neighbourhood-scale (15), not the whole-metro view (12) it shipped at first", () => {
    // The first ship set MIN_PIN_ZOOM = 12, which is STILL the default/whole-metro view — the
    // rule never actually engaged at the zoom people look at Houston from. Measured against
    // production: at z15 even downtown/midtown (the single densest cluster in the metro) stays
    // under the RPC's 2,000-row cap (1,251); at z14 the same box already exceeds it (2,641).
    // A regression back toward 12-13 would silently reopen the exact defect this guards.
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const MIN_PIN_ZOOM = 15;/);
    expect(map).not.toMatch(/const MIN_PIN_ZOOM = 1[0-4];/);
  });

  it("reference (unrated) pins render smaller and more transparent than his own places — not a flat blob at density", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/REFERENCE_PIN\s*=\s*\{\s*radius:\s*5,\s*fillOpacity:\s*0\.7\s*\}/);
    // His own places call addPin with no opts (full radius 7 / opacity 0.95 defaults);
    // the reference snapshot and live-search fallback both pass REFERENCE_PIN explicitly.
    const drawEffect = map.slice(map.indexOf("Redraw markers"), map.indexOf("const showCappedNotice"));
    const hisPlacesBlock = drawEffect.slice(
      drawEffect.indexOf("for (const p of loggedPlaces"),
      drawEffect.indexOf("const REFERENCE_PIN"),
    );
    expect(hisPlacesBlock).not.toContain("REFERENCE_PIN");
    const gatedBlock = drawEffect.slice(drawEffect.indexOf("if (!tooSmall)"));
    const refCalls = [...gatedBlock.matchAll(/REFERENCE_PIN/g)];
    expect(refCalls.length).toBe(2); // the snapshot pass and the live-search pass
  });
});

describe("satellite toggle — one control, two states, reused Esri source, legible pins on imagery", () => {
  it("ONE toggle button, two states — never a basemap gallery, never a layers panel", () => {
    const map = src("components/FoodMap.jsx");
    expect([...map.matchAll(/data-testid="food-basemap-toggle"/g)]).toHaveLength(1);
    expect(map).toMatch(/setBasemap\(\(b\) => \(b === "satellite" \? "street" : "satellite"\)\)/);
    expect(map).not.toMatch(/BASEMAP_CHOICES|basemapGallery|LayerPanel/);
  });

  it("the satellite source is duplicated from the Site Planner's Esri World Imagery, not imported — BUNDLE ISOLATION", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toContain("server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile");
    expect(map).toMatch(/Imagery &copy; Esri, Maxar/);
    // No API key, no account, no billing — a bare tile URL, same shape as the street source.
    expect(map).not.toMatch(/apikey|api_key|access_token/i);
    // BUNDLE ISOLATION — this file may still import nothing from site-planner, even though it
    // reuses that module's SOURCE VALUES (copied as literals, not through an import edge).
    expect(map).not.toMatch(/from\s+["'][^"']*site-planner[^"']*["']/);
  });

  it("the two tile sources are swapped WHOLE on toggle (fresh layer + removal), never `setUrl` on a shared layer", () => {
    const map = src("components/FoodMap.jsx");
    const tileEffect = map.slice(map.indexOf("Basemap tile layer"), map.indexOf("}, [basemap]);"));
    expect(tileEffect).toMatch(/L\.tileLayer\(source\.url/);
    expect(tileEffect).toMatch(/map\.removeLayer\(layer\)/); // the cleanup that removes the PREVIOUS layer
    expect(map).not.toMatch(/\.setUrl\(/);
  });

  it("satellite mode widens the pin's white keyline stroke so the rating ramp stays legible over photo imagery", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const strokeWeight = basemap === "satellite" \? 3 : 2;/);
    // Every addPin call must use the computed weight (directly, or via the isSelected ternary
    // that still falls back to it) — never a value hardcoded back to a constant 2.
    const drawEffect = map.slice(map.indexOf("Redraw markers"), map.indexOf("}, [places, loggedPlaces"));
    expect(drawEffect).toMatch(/weight:\s*(strokeWeight|isSelected \? 4 : strokeWeight)/);
    expect(drawEffect).not.toMatch(/weight:\s*2\b/);
  });
});

/* ⛔ B634981 — THE SATELLITE TOGGLE SHIPPED CRASHING THE WHOLE MODULE. Real production report
 * with a console stack trace: clicking Satellite threw inside Leaflet's `_getSubdomain`
 * ("Cannot read properties of undefined (reading 'length')"), caught by the workspace error
 * boundary — the whole /food route blanked out. Confirmed live with a real headless-browser
 * harness (ui-audit/verify-food-satellite-toggle.mjs): the pre-fix build reproduced the crash
 * exactly (the module's own [data-testid="food-map"] disappeared and the error-boundary fallback
 * text appeared after a forced click), and the fixed build passed clean across four toggles with
 * real tiles present each time. These are the FAST, CI-gated structural guards for the same
 * defect classes — the harness above is the slower, real-browser proof; both exist because a
 * source scan alone would have missed this bug the first time (an `undefined`-valued object key
 * reads as "present" to any regex that only checks the key exists, not what it maps to). */
describe("satellite crash fix — no explicit undefined subdomains, mirrors the planner's real config, degrades instead of crashing (B634981)", () => {
  it("subdomains is only added to the tile-layer options when the source actually declares one — never an explicit `subdomains: undefined`", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/if \(source\.subdomains\) opts\.subdomains = source\.subdomains;/);
    // The exact defect shape: an unconditional key in the options OBJECT LITERAL passed to
    // L.tileLayer, which is `undefined` for a source with no subdomains and clobbers Leaflet's
    // own internal default rather than leaving it alone.
    expect(map).not.toMatch(/L\.tileLayer\([^)]*subdomains:\s*source\.subdomains[^)]*\)/s);
  });

  it("SATELLITE_TILES declares no subdomains key at all — a single ArcGIS host has none, matching the Site Planner's own layer", () => {
    const map = src("components/FoodMap.jsx");
    const satelliteBlock = map.slice(map.indexOf("const SATELLITE_TILES"), map.indexOf("const LABELS_TILES"));
    expect(satelliteBlock).not.toMatch(/subdomains/);
  });

  it("mirrors the planner's real config: maxZoom 21 with maxNativeZoom 19 (upscale past Esri's native ceiling, never hard-refuse)", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const SATELLITE_TILES = \{[\s\S]{0,300}?maxZoom: 21, maxNativeZoom: 19,/);
  });

  it("axis order is {z}/{y}/{x} — Y before X, Esri's convention — for BOTH the imagery and the labels overlay", () => {
    const map = src("components/FoodMap.jsx");
    const arcgisUrls = [...map.matchAll(/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/[^"]+"/g)].map((m) => m[0]);
    expect(arcgisUrls.length).toBeGreaterThanOrEqual(2); // imagery + labels
    for (const url of arcgisUrls) expect(url).toMatch(/\/tile\/\{z\}\/\{y\}\/\{x\}/);
  });

  it("a faint labels overlay (World_Transportation) is added ONLY in satellite mode, so street names stay readable over the imagery", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/Reference\/World_Transportation\/MapServer\/tile/);
    expect(map).toMatch(/if \(basemap === "satellite"\) \{/);
    expect(map).toMatch(/L\.tileLayer\(LABELS_TILES\.url/);
  });

  it("the tile-layer mount is wrapped in try/catch — a bad config degrades to an 'Imagery unavailable' state, never crashes the module", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const \[basemapError, setBasemapError\] = useState\(false\);/);
    expect(map).toMatch(/try \{[\s\S]{0,300}?const opts = \{ maxZoom: source\.maxZoom, attribution: source\.attribution \};/);
    expect(map).toMatch(/\} catch \(err\) \{/);
    expect(map).toMatch(/setBasemapError\(true\)/);
    expect(map).toMatch(/data-testid="food-basemap-error"/);
    expect(map).toContain("Imagery unavailable");
  });

  it("a real headless-browser guard exists for this defect class (ui-audit/verify-food-satellite-toggle.mjs) — proven RED on the pre-fix build and GREEN on the fix", () => {
    expect(existsSync(join(REPO, "ui-audit", "verify-food-satellite-toggle.mjs"))).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4d. RATING SLIDER + NO-DEFAULT DATE (owner correction, 2026-08-18): half-point ratings via
 *     ONE control (never a row of 19-20 buttons), and the date field starts empty — rating a
 *     place he can't remember the date for must not quietly record today's date instead.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("VisitPanel — rating slider (not a button row) and a date field that never defaults", () => {
  it("the date field starts empty — never pre-filled with today", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const \[visitedOn, setVisitedOn\] = useState\(""\)/);
    expect(panel).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  });

  it("rating is a range-slider control, step 0.5 across 1-10 — never a row of per-value buttons", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/type="range"/);
    expect(panel).toMatch(/min=\{RATING_MIN\}\s*max=\{RATING_MAX\}\s*step=\{RATING_STEP\}/);
    expect(panel).toMatch(/const RATING_STEP = 0\.5;/);
    // The old design this replaces: ten separate <button> elements, one per whole number.
    expect(panel).not.toMatch(/role="radiogroup"/);
    expect(panel).not.toContain("RatingPicker");
    // Exactly ONE range-input DEFINITION in the source (RatingSlider) — but rendered TWICE
    // (Food + Ambiance, B634978) as the same reused component, never a second hand-rolled slider
    // or per-value buttons re-added for either.
    const rangeInputs = [...panel.matchAll(/type="range"/g)];
    expect(rangeInputs.length).toBe(1);
    const sliderUsages = [...panel.matchAll(/<RatingSlider /g)];
    expect(sliderUsages.length).toBe(2);
  });

  it("the slider's current value is always shown as a number, not only implied by thumb position", () => {
    const panel = src("components/VisitPanel.jsx");
    const slider = panel.slice(panel.indexOf("function RatingSlider"), panel.indexOf("function fieldStyle"));
    expect(slider).toMatch(/shown\.toFixed\(1\)/);
  });

  it("the rating stays optional — no value is committed until the slider is actually touched, and it can be cleared", () => {
    const panel = src("components/VisitPanel.jsx");
    const slider = panel.slice(panel.indexOf("function RatingSlider"), panel.indexOf("function fieldStyle"));
    // The rest position is a purely visual thumb placement, distinct from a committed value —
    // onChange(null) (Clear) is reachable, and the rest constant is never passed to onChange
    // directly from a mount-time effect (no useEffect in RatingSlider ITSELF — the panel's own
    // Escape-key useEffect, added B634976, is a different, unrelated concern, elsewhere in the file).
    expect(slider).toMatch(/onChange\(null\)/);
    expect(slider).not.toMatch(/useEffect/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4e. SEARCH (owner chat block, 2026-08-18): the whole 34,000+-place snapshot, searched by
 *     name, never scoped to the viewport. His own places (manual pins + anywhere logged) rank
 *     first. The existing "Search live for more here" Overpass path is reused inline as a
 *     fallback, and a no-results state offers the manual drop-a-pin flow. ONE control — ties
 *     into VisitList's own filtering rather than adding a second search box.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("SearchBox — whole-snapshot name search, his places first, one control", () => {
  it("foodStore.searchPlacesByName calls the trigram RPC, not a client-side scan of 34,000 rows", () => {
    const store = src("lib/foodStore.js");
    expect(store).toContain('supabase.rpc("food_places_search_by_name"');
    expect(store).toMatch(/p_query:\s*query\.trim\(\)/);
  });

  it("the migration defines a trigram-indexed, word-similarity search RPC over the WHOLE table (no bbox filter)", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("create extension if not exists pg_trgm");
    expect(sql).toContain("using gin (lower(name) gin_trgm_ops)");
    expect(sql).toContain("create or replace function public.food_places_search_by_name(");
    expect(sql).toMatch(/word_similarity\(lower\(p_query\), lower\(name\)\)/);
    expect(sql).toMatch(/lower\(p_query\) <% lower\(name\)/);
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_name\(text, integer, double precision, double precision\) to anon, authenticated/);
    // Whole-snapshot: this function must never filter by south/west/north/east like the
    // viewport RPC does — that would silently reintroduce the "can't find what's off-screen"
    // defect the owner explicitly called out ("a viewport-scoped search would be useless").
    const createAt = sql.indexOf("create or replace function public.food_places_search_by_name(");
    const fnBody = sql.slice(createAt, sql.indexOf("$$;", createAt));
    expect(fnBody).not.toMatch(/p_south|p_west|p_north|p_east/);
  });

  // ⛔ RECURRENCE GUARD (B634980, self-discovered 2026-08-19): this file went out of sync with the
  // LIVE function after B632178 — that session's distance-ranking rewrite was applied directly to
  // production but never actually landed in this committed file, so a fresh install would have
  // silently shipped the OLD 2-arg, no-distance version. Asserts the file matches production's
  // real signature, not just that a function of this name exists.
  it("the search RPC is distance-aware and drops its old 2-arg overload — matches what's actually live in production, not a stale file", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("drop function if exists public.food_places_search_by_name(text, integer);");
    expect(sql).toMatch(/p_center_lat double precision default null, p_center_lon double precision default null/);
    expect(sql).toContain("distance_km double precision");
    expect(sql).toContain("metro text, sim real, distance_km double precision");
    expect(sql).toMatch(/order by sim desc, distance_km asc nulls last, name asc/);
  });

  it("SearchBox debounces, requires a minimum query length, and never fires the snapshot RPC in List view", () => {
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/const DEBOUNCE_MS = \d+;/);
    expect(box).toMatch(/const MIN_QUERY_LEN = \d+;/);
    expect(box).toMatch(/if \(view !== "map"\) return undefined;/);
  });

  it("his own places (manual pins + logged snapshot places) are ranked ahead of everywhere he hasn't been", () => {
    const box = src("components/SearchBox.jsx");
    // The merge order is the ranking: manual matches, then logged snapshot hits, then the rest.
    const order = box.slice(box.indexOf("const results = ["), box.indexOf("];", box.indexOf("const results = [")));
    const manualIdx = order.indexOf("manualMatches");
    const mineIdx = order.indexOf("snapshotRanked.filter((p) => p.mine)");
    const restIdx = order.indexOf("snapshotRanked.filter((p) => !p.mine)");
    expect(manualIdx).toBeGreaterThanOrEqual(0);
    expect(manualIdx).toBeLessThan(mineIdx);
    expect(mineIdx).toBeLessThan(restIdx);
    // And a result carrying `mine` renders a visible "Been here" mark, not just a sort position.
    expect(box).toMatch(/Been here/);
  });

  it("selecting a result flies the map AND opens the panel — both, not one or the other", () => {
    const box = src("components/SearchBox.jsx");
    const selectPlace = box.slice(box.indexOf("const selectPlace ="), box.indexOf("const selectManual ="));
    expect(selectPlace).toMatch(/onSelectPlace\(place\)/);
    expect(selectPlace).toMatch(/onFlyTo\(/);
  });

  it("⛔ RECURRENCE GUARD — the results panel renders through AnchoredMenu's document.body portal, never a plain position:absolute div nested in the toolbar", () => {
    // The FIRST ship nested the dropdown inside this component's own DOM tree at
    // `position: absolute`. Live-measured by the owner's colleague: the results genuinely
    // rendered and matched (five "Torchy's Tacos" rows in body.innerText) but were VISUALLY
    // CLIPPED to nothing, because an ancestor toolbar row is `overflow: hidden` for its own
    // layout — no z-index can fix an ancestor overflow clip. AnchoredMenu escapes every
    // ancestor's overflow/stacking context via a portal to document.body; a regression back to
    // a locally-nested absolute div would silently reintroduce the exact defect.
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/import AnchoredMenu from ".*shared\/ui\/AnchoredMenu\.jsx"/);
    expect(box).toMatch(/<AnchoredMenu\b/);
    expect(box).toMatch(/anchorRef=\{inputRef\}/);
    // The old shape this replaces: a `position: "absolute"` div anchored inside this
    // component's own render tree instead of delegating to the portal.
    expect(box).not.toMatch(/position:\s*"absolute"/);
  });

  it("the search input can be re-clicked without the dropdown swallowing the click (hoverSafe, not the default full-viewport backdrop)", () => {
    // The default AnchoredMenu backdrop is a full-viewport click-away layer with NO exemption
    // for the anchor — correct for a button-triggered menu (click the button again to close),
    // wrong for a text input, where re-clicking it should reposition the cursor, not close the
    // dropdown. hoverSafe mode exempts both the anchor and the panel from the click-away.
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/<AnchoredMenu[\s\S]{0,300}?\bhoverSafe\b/);
  });

  it("FoodMap flies to a search result, keyed on a nonce (so re-selecting the same place still flies)", () => {
    const map = src("components/FoodMap.jsx");
    // Flies to a PANEL-OFFSET point derived from the target (see the panel-aware-centring
    // describe block below), not the raw [lat, lon] directly — map.project/unproject shift it.
    expect(map).toMatch(/map\.flyTo\(shiftedLatLng, targetZoom\)/);
    expect(map).toMatch(/map\.project\(\[flyToTarget\.lat, flyToTarget\.lon\], targetZoom\)/);
    expect(map).toMatch(/\[flyToTarget\?\.nonce\]/);
  });

  it("B651872 — a search-select flyTo forces a hard view reset once it settles, so the tile grid can never stay stale", () => {
    // A programmatic flyTo can leave Leaflet's own tile-grid positioning stale (traced into
    // Leaflet's source: GridLayer only computes a zoom level's pixel origin once, at creation,
    // and can create it mid-flight from a not-yet-settled camera position; separately,
    // GridLayer._onMoveEnd no-ops entirely while map._animatingZoom is true, a flag flyTo()
    // never waits for) — reported live as the map painting flat grey until a manual zoom/pan.
    // A manual zoom/pan "fixes" it because it forces Leaflet's own hard view-reset path
    // (setView -> _resetView -> 'viewprereset'/'viewreset'), which wipes and rebuilds every
    // cached tile level fresh. So the flyTo effect forces that SAME reset itself, once, the
    // moment the flight's own moveend fires — no polling, no setInterval.
    const map = src("components/FoodMap.jsx");
    const flyEffect = map.slice(map.indexOf("map.flyTo(shiftedLatLng, targetZoom)") - 400, map.indexOf("map.flyTo(shiftedLatLng, targetZoom)") + 40);
    expect(flyEffect).toMatch(/map\.once\(\s*"moveend"/);
    expect(flyEffect).toMatch(/map\.invalidateSize\(/);
    expect(flyEffect).toMatch(/map\.setView\(map\.getCenter\(\), map\.getZoom\(\), \{ reset: true/);
    // The reset must be scheduled BEFORE flyTo is called (map.once must be registered ahead of
    // the call whose moveend it's listening for), and it must never be a poll/interval — the
    // house rule this item's own brief calls out explicitly ("do not fix it by adding a
    // blanket setInterval redraw").
    expect(flyEffect.indexOf("map.once(")).toBeGreaterThanOrEqual(0);
    expect(flyEffect.indexOf("map.once(")).toBeLessThan(flyEffect.indexOf("map.flyTo(shiftedLatLng, targetZoom)"));
    expect(map).not.toMatch(/setInterval/);
  });

  it("the live-Overpass path is REUSED, not duplicated — offered inline only when the snapshot has few/no good matches", () => {
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/onRequestLiveSearch\(\)/); // the same searchHere already wired to the existing button
    expect(box).toMatch(/results\.length < 3/);
    expect(box).not.toMatch(/overpass-api\.de/); // no second network client — goes through the prop, not a new fetch
  });

  it("a genuine no-results state offers the manual drop-a-pin escape hatch, pre-seeded with what he typed", () => {
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/onStartDropPinFor\(trimmed\)/);
    const app = src("FoodApp.jsx");
    const startDropPinFor = app.slice(app.indexOf("const startDropPinFor"), app.indexOf("}, []);", app.indexOf("const startDropPinFor")));
    expect(startDropPinFor).toMatch(/setManualDraftName\(name\)/);
    expect(startDropPinFor).toMatch(/setView\("map"\)/);
    expect(startDropPinFor).toMatch(/setPinMode\(true\)/);
  });

  it("ONE control: FoodApp renders exactly one SearchBox, wired to both views", () => {
    const app = src("FoodApp.jsx");
    expect([...app.matchAll(/<SearchBox\b/g)]).toHaveLength(1);
    expect(app).toMatch(/query=\{searchQuery\}\s+onQueryChange=\{setSearchQuery\}/);
  });

  it("VisitList takes `query` as a controlled prop — no local search input of its own", () => {
    const list = src("components/VisitList.jsx");
    expect(list).not.toMatch(/useState\(""\)/); // the old local `const [query, setQuery] = useState("")` is gone
    expect(list).not.toMatch(/type="search"/); // no input element left in this file
    expect(list).toMatch(/function VisitList\(\{ visits, query, onSelect, selectedKey \}\)/);
  });
});

/* ⛔ B634982 — "add maui too", the loader-parameterisation test (owner, 2026-08-19: "This is the
 * test of whether you actually parameterised the loader by metro as instructed — if adding Maui
 * is anything more than one config row with a name and a bounding box, the refactor did not
 * land"). Confirmed by actually RUNNING it: `python3 scripts/load-food-places.py --metro Maui`
 * scanned the real Overture release and kept 1,313 real food-and-drink places for the island — a
 * genuinely smaller count than the mainland metros (an island's bbox is mostly ocean), which is
 * the EXPECTED shape, not a sign the load failed. Loaded into production the same way as
 * DFW/Austin (`execute_sql`, verified below); no code change beyond the one registry row. */
describe("Maui — the metro-parameterisation test (B634982)", () => {
  it("scripts/load-food-places.py's METROS registry has a Maui row, and nothing else in the file changed to support it", () => {
    const loader = readFileSync(join(REPO, "scripts", "load-food-places.py"), "utf8");
    expect(loader).toMatch(/\{"name": "Maui", "bbox": \([-\d.]+, [-\d.]+, [-\d.]+, [-\d.]+\)\}/);
    // Still exactly one METROS list, one scan_metros() function — a fourth metro is a config
    // row, not a fourth code path.
    expect([...loader.matchAll(/^METROS = \[/gm)]).toHaveLength(1);
    expect([...loader.matchAll(/^def scan_metros\(/gm)]).toHaveLength(1);
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

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2026-08-19 owner chat block, on a colleague's live report after searching "soto": three
 * follow-ups — B634976 (selection is unmistakable), B634977 (category/address formatting),
 * B634978 (ambiance rating) — plus a fourth item dropped mid-turn, B634979 (liked dishes).
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("formatPlace — display-only category title-casing and address tidy (B634977)", () => {
  it("title-cases a plain multi-word category — the owner's own example", () => {
    expect(formatCategory("japanese_restaurant")).toBe("Japanese Restaurant");
    expect(formatCategory("mexican_restaurant")).toBe("Mexican Restaurant");
    expect(formatCategory("sports_bar")).toBe("Sports Bar");
  });

  it("keeps a real acronym upper-case (DIY) rather than title-casing it into nonsense", () => {
    // The only genuine acronym among all 202 distinct production category values (checked
    // directly against the database before writing this rule — see the file's header comment).
    expect(formatCategory("diy_foods_restaurant")).toBe("DIY Foods Restaurant");
  });

  it("BBQ/BYOB stay in the exception list defensively even though they don't actually occur in production data", () => {
    expect(formatCategory("bbq_joint")).toBe("BBQ Joint");
    expect(formatCategory("byob_restaurant")).toBe("BYOB Restaurant");
  });

  it("lower-cases a minor connector word when it isn't the first word, so it reads naturally", () => {
    expect(formatCategory("eat_and_drink")).toBe("Eat and Drink");
    expect(formatCategory("bar_and_grill_restaurant")).toBe("Bar and Grill Restaurant");
  });

  it("handles null/empty without throwing", () => {
    expect(formatCategory(null)).toBe(null);
    expect(formatCategory("")).toBe(null);
  });

  it("trims a ZIP+4 suffix and the comma before it — the owner's own example", () => {
    expect(formatAddress("224 Westheimer Rd, Houston, TX, 77006-3222")).toBe("224 Westheimer Rd, Houston, TX 77006");
  });

  it("fixes the same extra comma even without a ZIP+4 suffix", () => {
    expect(formatAddress("100 Main St, Houston, TX, 77002")).toBe("100 Main St, Houston, TX 77002");
  });

  it("leaves an address with no matching trailing-zip pattern completely unchanged — never mangles a shape it wasn't built for", () => {
    const odd = "Somewhere, no zip on the end";
    expect(formatAddress(odd)).toBe(odd);
  });

  it("null passthrough", () => {
    expect(formatAddress(null)).toBe(null);
  });

  it("is DISPLAY-ONLY — FoodApp's panel subtitle uses it, never the old naive underscore-swap, and the raw stored value is never mutated", () => {
    const app = src("FoodApp.jsx");
    expect(app).toContain('import { formatCategory, formatAddress } from "./lib/formatPlace.js";');
    expect(app).toMatch(/formatCategory\(selected\.place\.category\)/);
    expect(app).toMatch(/formatAddress\(selected\.place\.address\)/);
    expect(app).not.toMatch(/\.category\?\.replace\(\/_\/g/); // the old lowercase-with-spaces version is gone
  });
});

describe("selected-place highlight — unmistakable pin, tied panel, centred pan, row highlight, Escape clears (B634976)", () => {
  it("FoodApp computes ONE selectedKey and hands the identical string to both FoodMap and VisitList", () => {
    const app = src("FoodApp.jsx");
    expect(app).toMatch(/const selectedKey = selected\?\.kind === "place" \? `place:\$\{selected\.place\.id\}`/);
    expect(app).toMatch(/: selected\?\.kind === "manualPin" \? `pin:\$\{selected\.pin\.name\}`/);
    const matches = [...app.matchAll(/selectedKey=\{selectedKey\}/g)];
    expect(matches.length).toBe(2); // <FoodMap> and <VisitList>, both fed the same value
  });

  it("FoodMap draws the selected pin larger, with an accent-coloured ring AND a soft halo behind it — never just the plain white-stroke look every other state uses", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const SELECTED_ACCENT = "#BE3B22";/); // literal — canvas context, see COLORS' own comment
    expect(map).toMatch(/radius: baseRadius \+ 12, weight: 0,/); // the halo, non-interactive
    expect(map).toMatch(/fillColor: SELECTED_ACCENT, fillOpacity: 0\.22, interactive: false,/);
    expect(map).toMatch(/radius: isSelected \? baseRadius \+ 5 : baseRadius,/); // noticeably larger
    expect(map).toMatch(/color: isSelected \? SELECTED_ACCENT : "#fff",/); // accent ring, not the usual white
  });

  it("every addPin call carries a stable key matching selectedKey's own scheme — his places, the reference snapshot, and overpass results alike", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/key: `place:\$\{p\.id\}`/);
    expect(map).toMatch(/key: `pin:\$\{pin\.name\}`/);
    // The reference-snapshot AND overpass passes both key by place id too (loggedIds already
    // excludes anything drawn above, so there's no double-draw to worry about).
    const refKeys = [...map.matchAll(/key: `place:\$\{p\.id\}`/g)];
    expect(refKeys.length).toBeGreaterThanOrEqual(3); // his logged places + reference snapshot + overpass
  });

  it("the fly-to pan offsets the destination by half the panel's width — lands in the VISIBLE area, not the raw map centre", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const PANEL_WIDTH = 340;/); // matches VisitPanel's own literal width
    expect(map).toMatch(/const panelOffsetPx = Math\.min\(PANEL_WIDTH, containerWidth \* 0\.8\) \/ 2;/);
    expect(map).toMatch(/map\.project\(\[flyToTarget\.lat, flyToTarget\.lon\], targetZoom\)/);
    expect(map).toMatch(/targetPoint\.add\(\[panelOffsetPx, 0\]\)/);
    expect(map).toMatch(/map\.flyTo\(shiftedLatLng, targetZoom\)/);
  });

  it("selecting from the LIST also sets flyToTarget with real lat/lon — not just from search", () => {
    const app = src("FoodApp.jsx");
    expect(app).toMatch(/openPlace\(\{ id: v\.place_id, name: p\.name, lat: p\.lat, lon: p\.lon \}\);/);
    expect(app).toMatch(/if \(p\.lat != null && p\.lon != null\) flyTo\(\{ lat: p\.lat, lon: p\.lon \}\);/);
    expect(app).toMatch(/if \(pin\.lat != null && pin\.lon != null\) flyTo\(\{ lat: pin\.lat, lon: pin\.lon \}\);/);
  });

  it("VisitList highlights the matching row with a light tint + accent stripe — never a solid fill that would clash with the rating pills' own colours", () => {
    const list = src("components/VisitList.jsx");
    expect(list).toMatch(/function rowKey\(v\) \{/);
    expect(list).toMatch(/const isSelected = selectedKey != null && rowKey\(v\) === selectedKey;/);
    expect(list).toMatch(/color-mix\(in srgb, var\(--accent-food\) 12%, transparent\)/);
    expect(list).toMatch(/boxShadow: isSelected \? "inset 3px 0 0 var\(--accent-food\)" : "none",/);
  });

  it("VisitPanel shows a small accent dot tied to the exact colour FoodMap's ring uses — a theme TOKEN, not a raw hex, since this is real DOM/CSS chrome", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/data-testid="food-panel-accent-dot"/);
    expect(panel).toMatch(/const SELECTED_ACCENT = "var\(--accent-food\)";/);
  });

  it("Escape clears the selection exactly like the close button — same onClose, no separate escape state", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const onKey = \(e\) => \{ if \(e\.key === "Escape"\) onClose\(\); \};/);
    expect(panel).toMatch(/window\.addEventListener\("keydown", onKey\)/);
    expect(panel).toMatch(/return \(\) => window\.removeEventListener\("keydown", onKey\)/);
  });
});

describe("ambiance rating — a second, independent 1-10 rating; the map pin stays keyed to FOOD only (B634978)", () => {
  it("db/food.sql defines rating_ambiance with the SAME halves-only 1-10 check as rating — nullable and independent", () => {
    const sql = src("db/food.sql");
    expect(sql).toMatch(/rating_ambiance numeric\(3,1\) check \(rating_ambiance is null or \(rating_ambiance between 1 and 10 and rating_ambiance \* 2 = round\(rating_ambiance \* 2\)\)\)/);
    expect(sql).toContain("alter table public.food_visits add column if not exists rating_ambiance numeric(3,1);");
    expect(sql).toContain("food_visits_rating_ambiance_check");
  });

  it("VisitForm renders the RatingSlider TWICE, clearly labelled Food and Ambiance — never a bare 'Rating' now that there are two", () => {
    const panel = src("components/VisitPanel.jsx");
    const sliderUsages = [...panel.matchAll(/<RatingSlider /g)];
    expect(sliderUsages.length).toBe(2);
    expect(panel).toMatch(/Food\s*<RatingSlider value=\{rating\} onChange=\{setRating\} label="Food rating" \/>/);
    expect(panel).toMatch(/Ambiance\s*<RatingSlider value=\{ratingAmbiance\} onChange=\{setRatingAmbiance\} label="Ambiance rating" \/>/);
    expect(panel).not.toMatch(/>Rating</); // the old ambiguous bare label is gone
  });

  it("the submit payload includes rating_ambiance as its own independent field — never averaged or merged with rating", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/rating_ambiance: ratingAmbiance,/);
  });

  it("VisitList sorts by Ambiance independently of Rating, and shows both as their own column", () => {
    const list = src("components/VisitList.jsx");
    expect(list).toMatch(/ambiance: \{ label: "Ambiance", get: \(v\) => \(v\.rating_ambiance == null \? -1 : Number\(v\.rating_ambiance\)\), dir: -1 \}/);
    expect(list).toContain('<th style={{ padding: "4px 8px", fontWeight: 700 }}>Ambiance</th>');
  });

  it("⛔ THE MAP PIN NEVER READS rating_ambiance — the colour-driving code stays food-only, structurally asserted so it can't silently drift", () => {
    expect(src("lib/foodStore.js")).not.toMatch(/rating_ambiance/);
    expect(src("components/FoodMap.jsx")).not.toMatch(/rating_ambiance/);
  });

  it("VisitRow shows Food and Ambiance pills independently — a visit with only one set still renders sensibly, same principle as a dateless visit", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const hasRating = visit\.rating != null;/);
    expect(panel).toMatch(/const hasAmbiance = visit\.rating_ambiance != null;/);
    expect(panel).toMatch(/\{hasRating && <RatingPill label="Food" value=\{visit\.rating\} \/>\}/);
    expect(panel).toMatch(/\{hasAmbiance && <RatingPill label="Ambiance" value=\{visit\.rating_ambiance\} \/>\}/);
    expect(panel).toMatch(/\{!hasRating && !hasAmbiance && <span/); // both-absent fallback, only when BOTH missing
  });
});

describe("'What was good' — a liked-dishes shortlist, separate from 'What I had', accumulated across every visit at a place (B634979)", () => {
  it("db/food.sql adds what_was_good as its own nullable text column, distinct from what_i_had", () => {
    const sql = src("db/food.sql");
    expect(sql).toMatch(/what_was_good text,\s*-- the SHORTLIST/);
    expect(sql).toContain("alter table public.food_visits add column if not exists what_was_good text;");
  });

  it("the form has a SEPARATE 'What was good' field, sitting directly under 'What I had' — never merged into it", () => {
    const panel = src("components/VisitPanel.jsx");
    const whatIHadIdx = panel.indexOf("What I had");
    const whatWasGoodIdx = panel.indexOf("What was good");
    expect(whatIHadIdx).toBeGreaterThan(-1);
    expect(whatWasGoodIdx).toBeGreaterThan(whatIHadIdx);
    expect(panel).toMatch(/placeholder="The hamachi, the agedashi…"/);
    expect(panel).toMatch(/what_was_good: whatWasGood \|\| null,/);
    // Genuinely a separate field — never appended onto what_i_had's own value.
    expect(panel).not.toMatch(/whatIHad \+ .*whatWasGood/);
  });

  it("the PLACE PANEL aggregates liked dishes across ALL past visits, rendered ABOVE 'Past visits' — not buried one visit deep", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/function LikedDishes\(\{ pastVisits \}\) \{/);
    expect(panel).toMatch(/const entries = \(pastVisits \|\| \[\]\)\.map\(\(v\) => v\.what_was_good\)\.filter\(Boolean\);/);
    expect(panel).toMatch(/entries\.join\("; "\)/);
    expect(panel.indexOf("<LikedDishes")).toBeGreaterThan(-1);
    expect(panel.indexOf("<LikedDishes")).toBeLessThan(panel.indexOf("Past visits ("));
  });

  it("renders NOTHING when no past visit has a liked entry — no empty heading, quiet by default", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/if \(!entries\.length\) return null;/);
  });

  it("kept as plain unparsed text — never split into a dish taxonomy, tags, or a separate entity", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).not.toMatch(/\.split\(","\)/);
    expect(panel).not.toMatch(/dishTag|DishEntity|dish_taxonomy|dishAutocomplete/i);
  });

  it("VisitList shows 'What was good' as its own per-row column — that visit's own value, never an aggregate (the panel owns aggregation)", () => {
    const list = src("components/VisitList.jsx");
    expect(list).toContain('<th style={{ padding: "4px 8px", fontWeight: 700 }}>What was good</th>');
    expect(list).toMatch(/\{v\.what_was_good \|\| "—"\}/);
  });
});
