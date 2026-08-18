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

  it("rating is ONE range-slider control, step 0.5 across 1-10 — never a row of per-value buttons", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/type="range"/);
    expect(panel).toMatch(/min=\{RATING_MIN\}\s*max=\{RATING_MAX\}\s*step=\{RATING_STEP\}/);
    expect(panel).toMatch(/const RATING_STEP = 0\.5;/);
    // The old design this replaces: ten separate <button> elements, one per whole number.
    expect(panel).not.toMatch(/role="radiogroup"/);
    expect(panel).not.toContain("RatingPicker");
    // Exactly one range input in the whole file (the slider) — confirms it's a single
    // control, not a slider ADDED alongside the old per-value buttons.
    const rangeInputs = [...panel.matchAll(/type="range"/g)];
    expect(rangeInputs.length).toBe(1);
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
    // directly from a mount-time effect (no useEffect in this component at all).
    expect(slider).toMatch(/onChange\(null\)/);
    expect(panel).not.toMatch(/useEffect/);
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
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_name\(text, integer\) to anon, authenticated/);
    // Whole-snapshot: this function must never filter by south/west/north/east like the
    // viewport RPC does — that would silently reintroduce the "can't find what's off-screen"
    // defect the owner explicitly called out ("a viewport-scoped search would be useless").
    const fnBody = sql.slice(sql.indexOf("food_places_search_by_name("), sql.indexOf("$$;", sql.indexOf("food_places_search_by_name(")));
    expect(fnBody).not.toMatch(/p_south|p_west|p_north|p_east/);
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

  it("FoodMap flies to a search result, keyed on a nonce (so re-selecting the same place still flies)", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/map\.flyTo\(\[flyToTarget\.lat, flyToTarget\.lon\]/);
    expect(map).toMatch(/\[flyToTarget\?\.nonce\]/);
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
    expect(list).toMatch(/function VisitList\(\{ visits, query, onSelect \}\)/);
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
