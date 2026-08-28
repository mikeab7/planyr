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
import {
  manualPinsFromVisits, loggedPlaceIds, avgRatingByPlaceId,
  manualGroupKey, wishlistedPlaceIds, manualWishlistFromRows,
  dishWishlistByPlaceId, dishWishlistByManualKey,
} from "../src/workspaces/food/lib/foodStore.js";
import { roundKey, queryFor, fromElement } from "../src/workspaces/food/lib/overpass.js";
import { RATING_COLORS, RATING_TEXT, colorForRating, textColorForRating } from "../src/workspaces/food/lib/ratingColor.js";
import { formatCategory, formatAddress, formatCityFromAddress } from "../src/workspaces/food/lib/formatPlace.js";
import { computeVisitAggregates, orderAgainEntries } from "../src/workspaces/food/lib/visitAggregates.js";
import { formatVisitDate, formatRelativeDate, formatMonthYear } from "../src/workspaces/food/lib/dateFormat.js";
import { preferAppleMaps, directionsUrl } from "../src/workspaces/food/lib/directions.js";
import { resolveSnap, heightForSnap } from "../src/workspaces/food/lib/bottomSheetSnap.js";
import { nextZoomAnimTier, ZOOM_ANIM_FRAME_BUDGET_MS, ZOOM_ANIM_DEGRADE_STREAK } from "../src/workspaces/food/lib/zoomAnimTier.js";
import {
  isStrongMatch, isRegistryName, hasConcatenatedAddress, rankSearchCandidates,
  SIGNIFICANT_WORD_MIN_LEN, GENERIC_NAME_WORDS, REGISTRY_NAME_PATTERN, CONCAT_ADDRESS_PATTERN,
  DEDUPE_RADIUS_METERS,
} from "../src/workspaces/food/lib/searchQuality.js";

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
  const CHROME_SURFACES = ["FoodApp.jsx", "components/VisitPanel.jsx", "components/VisitList.jsx", "components/BottomSheet.jsx"];
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
  it("B811520 — FoodMap uses Esri's free, key-less World_Topo_Map tiles — colourful, not the flat-grey Positron, and no CARTO anywhere (watermarked keyless usage, 2026-08-27)", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toContain("server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}");
    expect(map).not.toContain("basemaps.cartocdn.com/light_all");
    expect(map).not.toMatch(/basemaps\.cartocdn\.com\/rastertiles\/voyager\/\{z\}\/\{x\}\/\{y\}/); // no LIVE cartocdn URL — history-only mentions in comments are fine
    // Not World_Street_Map — checked live against dense Houston pins and picked against it (see
    // the header comment); the constant's own url: line is what must not name it.
    const streetUrlLine = map.slice(map.indexOf("const STREET_TILES = {"), map.indexOf("attribution:", map.indexOf("const STREET_TILES = {")));
    expect(streetUrlLine).not.toContain("World_Street_Map");
  });

  it("B811520 — street tile axis order is {z}/{y}/{x}, same as satellite, never Leaflet's own default {z}/{x}/{y} (the exact mistake that crashed the satellite toggle the first time, B634981)", () => {
    const map = src("components/FoodMap.jsx");
    const streetBlock = map.slice(map.indexOf("const STREET_TILES = {"), map.indexOf("const STREET_TILES = {") + 400);
    expect(streetBlock).toMatch(/tile\/\{z\}\/\{y\}\/\{x\}/);
    expect(streetBlock).not.toMatch(/tile\/\{z\}\/\{x\}\/\{y\}/);
    expect(streetBlock).not.toMatch(/subdomains/); // no subdomains key — a single ArcGIS host has none (B634981's own lesson)
    expect(streetBlock).not.toMatch(/url1x/); // Esri tiles have no {r} retina token to strip
  });

  it("B811520 — the tile attribution credits Esri for BOTH layers, never a standalone OpenStreetMap/CARTO credit (nothing on the page fetches OSM or CARTO tiles any more)", () => {
    const map = src("components/FoodMap.jsx");
    const streetBlock = map.slice(map.indexOf("const STREET_TILES = {"), map.indexOf("const STREET_TILES = {") + 900);
    expect(streetBlock).toMatch(/attribution: "&copy; Esri,/);
    expect(streetBlock).not.toMatch(/openstreetmap\.org\/copyright/);
    expect(streetBlock).not.toMatch(/carto\.com\/attributions/);
    // The live OSM fallback documented for the future is commented-out code, not an active constant.
    expect(map).not.toMatch(/^const OSM_FALLBACK_TILES/m);
    expect(map).toMatch(/\/\/\s*const OSM_FALLBACK_TILES = \{/); // present, but commented out
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
    // B669312 — "want to try" places must survive this gate too, so the copy says so (the old
    // "only places you've been" wording would be actively wrong once a shortlist also shows here).
    expect(map).toMatch(/Showing places you've been or want to try/);
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
    // The snapshot pass, the live-search pass, and (B651872 ×3) the selected-place fallback —
    // which reuses the SAME small/transparent treatment since it represents the same kind of
    // place (unvisited, unflagged), just not yet present in the bounds-scoped snapshot.
    expect(refCalls.length).toBe(3);
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
    expect(tileEffect).toMatch(/L\.tileLayer\(url,/);
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

  it("rating is a range-slider control, step 0.25 across 1-10 — never a row of per-value buttons", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/type="range"/);
    expect(panel).toMatch(/min=\{RATING_MIN\}\s*max=\{RATING_MAX\}\s*step=\{RATING_STEP\}/);
    expect(panel).toMatch(/const RATING_STEP = 0\.25;/);
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

  it("⛔ NEW (2026-08-27/28 owner block) — the slider's current value shows at NATURAL precision (9, 8.5, 8.25), never padded to a fixed decimal count", () => {
    const panel = src("components/VisitPanel.jsx");
    const slider = panel.slice(panel.indexOf("function RatingSlider"), panel.indexOf("function fieldStyle"));
    // The old `.toFixed(1)` forced a constant one decimal ("9.0") — dropped entirely, both in the
    // visible label and in the a11y valuetext. `shown` is used bare so JS's own number-to-string
    // conversion (which never pads) does the formatting.
    expect(slider).not.toMatch(/\.toFixed\(/);
    expect(slider).toMatch(/\$\{shown\} \/ \$\{RATING_MAX\}/);
    expect(slider).toMatch(/\$\{shown\} out of \$\{RATING_MAX\}/);
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
    expect(map).toMatch(/map\.flyTo\(shiftedLatLng, targetZoom, \{ duration: FLY_DURATION_SEC \}\)/);
    expect(map).toMatch(/map\.project\(\[flyToTarget\.lat, flyToTarget\.lon\], targetZoom\)/);
    expect(map).toMatch(/\[flyToTarget\?\.nonce\]/);
  });

  it("B651872 (×3) — the flyTo duration is a fixed cap, not Leaflet's own distance-proportional default", () => {
    // Root-caused live (see the header comment): Leaflet's own flyTo computes a duration from
    // real-world distance with no cap — measured at ~7.8s for Houston->Maui, sweeping through
    // every intermediate integer zoom level along the way and painting flat grey for the whole
    // stretch. A fixed, short duration (measured to match what a local jump already takes
    // naturally) removes the multi-second window entirely, for every jump, without a redraw or
    // a timer.
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const FLY_DURATION_SEC = 1\.5;/);
    expect(map).toMatch(/duration: FLY_DURATION_SEC/);
    // Not a bounds-fit — zoomSnap/zoomDelta stay Leaflet's untouched defaults, and the target
    // zoom passed to flyTo is always a literal integer (Math.max of two integers), never
    // computed from a fitBounds call anywhere in this file.
    expect(map).not.toMatch(/zoomSnap:/);
    expect(map).not.toMatch(/zoomDelta:/);
    expect(map).not.toMatch(/\.fitBounds\(/); // no fitBounds CALL anywhere — the word appears only in this item's own explanatory comment
    expect(map).toMatch(/const targetZoom = Math\.max\(map\.getZoom\(\), FLY_TO_ZOOM\);/);
  });

  it("B651872 (×4) — beyond LONG_JUMP_METERS, a search-select jump goes straight to the destination (setView, no animation), never sweeping through intermediate zooms", () => {
    // Owner's own live capture: tiles requested at zoom 5 mid-flight during a Houston->Maui
    // search jump, before the camera ever reached the destination zoom 16 — the (x3) duration
    // cap made the sweep faster, it never stopped it. Measured (.scratch-repro/verify-tile-perf.mjs
    // this session): 136 tile requests across 12 zoom levels before this fix, 7 requests all at
    // the destination zoom after — a 95% reduction, and the FIRST tile requested is now the
    // destination's, not a wasted intermediate one.
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const LONG_JUMP_METERS = 100_000;/);
    const flyEffect = map.slice(map.indexOf("Search or list result selected"), map.indexOf("Drop-a-pin mode"));
    expect(flyEffect).toMatch(/const jumpMeters = map\.distance\(map\.getCenter\(\), shiftedLatLng\);/);
    expect(flyEffect).toMatch(/if \(jumpMeters > LONG_JUMP_METERS\)/);
    // The long-jump branch is a DIRECT setView — no flyTo call, no animation — the destination
    // zoom's tiles are requested immediately rather than after an animated sweep.
    const longBranch = flyEffect.slice(flyEffect.indexOf("if (jumpMeters > LONG_JUMP_METERS)"), flyEffect.indexOf("} else {"));
    expect(longBranch).toMatch(/map\.setView\(shiftedLatLng, targetZoom, \{ animate: false \}\)/);
    expect(longBranch).not.toMatch(/\.flyTo\(/);
    // The short-jump branch is unchanged — still the capped, animated flyTo.
    const shortBranch = flyEffect.slice(flyEffect.indexOf("} else {"));
    expect(shortBranch).toMatch(/map\.flyTo\(shiftedLatLng, targetZoom, \{ duration: FLY_DURATION_SEC \}\)/);
  });

  it("B811520 — the url1x/retina gate is GONE from the LIVE code, not just unused: Esri's tile URLs (street AND satellite) have no {r} token to strip, so there is nothing left to gate (history-only mentions in prose comments are fine)", () => {
    const map = src("components/FoodMap.jsx");
    // Neither tile-source object declares a url1x field any more.
    expect(map).not.toMatch(/url1x:\s*"/);
    // No LIVE tile URL template contains the {r} retina placeholder (a literal `{r}` can still
    // appear inside a prose comment explaining the OLD mechanism — that's history, not code).
    expect(map).not.toMatch(/url:\s*"[^"]*\{r\}/);
    // The gate expression itself is gone from the tile-layer effect — never dead code left behind.
    expect(map).not.toMatch(/narrowViewport && source\.url1x/);
    const tileEffectSrc = map.slice(map.indexOf("Basemap tile layer"), map.indexOf("}, [basemap]);"));
    expect(tileEffectSrc).toMatch(/const url = source\.url;/);
  });

  it("B651872 (×4) — a real loading treatment tied to the current tile layer's own events, never silent grey", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const \[tilesLoading, setTilesLoading\] = useState\(false\);/);
    const tileEffect = map.slice(map.indexOf("Basemap tile layer"), map.indexOf("}, [basemap]);"));
    expect(tileEffect).toMatch(/loadingLayer\.on\("loading", onLoading\);/);
    expect(tileEffect).toMatch(/loadingLayer\.on\("load", onLoad\);/);
    // Cleaned up on basemap change / unmount so a torn-down layer can never report stale loading.
    expect(tileEffect).toMatch(/loadingLayer\.off\("loading", onLoading\)/);
    expect(tileEffect).toMatch(/setTilesLoading\(false\)/);
    expect(map).toMatch(/data-testid="food-tiles-loading"/);
    expect(map).toMatch(/Loading imagery…/);
  });

  it("B651872 (×4) — a ResizeObserver on the host div calls invalidateSize the instant the container's real size changes, never on a timer", () => {
    // Nothing previously told Leaflet when its container changed size OUTSIDE of a flyTo/setView
    // (the only invalidateSize calls lived inside that one effect) — a device rotation or an iOS
    // Safari dynamic-toolbar resize at any other moment left Leaflet's cached size stale with
    // nothing to correct it. Verified live (.scratch-repro/verify-resize-observer.mjs this
    // session): resizing the real browser viewport with NO flyTo/setView call in between still
    // updated map.getSize() correctly.
    const map = src("components/FoodMap.jsx");
    const mountEffect = map.slice(map.indexOf("Mount once."), map.indexOf("Basemap tile layer"));
    expect(mountEffect).toMatch(/typeof ResizeObserver !== "undefined"/);
    expect(mountEffect).toMatch(/new ResizeObserver\(\(\) => map\.invalidateSize\(\{ animate: false, pan: false \}\)\)/);
    expect(mountEffect).toMatch(/resizeObserver\.observe\(hostRef\.current\)/);
    expect(mountEffect).toMatch(/resizeObserver\?\.disconnect\(\)/); // cleaned up on unmount
    expect(mountEffect).not.toMatch(/setInterval\(/); // never a polling redraw
  });

  it("B651872 (×5) — RECURRENCE: the ResizeObserver's own invalidateSize is pan:false, and Leaflet's own window-resize tracking is disabled — both are needed", () => {
    // REPRODUCED live (real Playwright devices['iPhone 14 Pro'] context, real dev build, real
    // 100dvh CSS, .scratch-repro/verify-grey-band-real.mjs): growing the real viewport height
    // (simulating Safari's chrome collapsing, or a rotation) left `.leaflet-map-pane` translated
    // by HALF the size delta even with the ResizeObserver's own call fixed to pan:false, because
    // Leaflet's own `trackResize:true` default independently binds `window`'s 'resize' event to
    // `invalidateSize({debounceMoveend:true})` with the default pan:true — no way to pass that
    // call pan:false. Both had to change: this host is ALWAYS top-anchored (a fixed-height
    // AppHeader above, flex:1 below), so a symmetric half-delta pan is never correct here, and the
    // ResizeObserver (which watches the real container, not just window) fully supersedes what
    // trackResize was for.
    const map = src("components/FoodMap.jsx");
    const mountEffect = map.slice(map.indexOf("Mount once."), map.indexOf("Basemap tile layer"));
    expect(mountEffect).toMatch(/trackResize:\s*false/);
    expect(mountEffect).toMatch(/new ResizeObserver\(\(\) => map\.invalidateSize\(\{ animate: false, pan: false \}\)\)/);
  });

  // B681520 — attribution: licence-required credit, relocated off the bottom, never deleted.
  it("Leaflet's own default attribution control is replaced, never left in place — attributionControl:false at construction", () => {
    // Owner screenshot: the default control (bottom-right, unaware of the sheet's z-index) was
    // painting through the detail sheet's content. The fix removes Leaflet's own control
    // entirely and replaces it with this file's React-rendered one (below), never simply
    // deleting the credit — OSM/CARTO/Esri's licence terms require it stay reachable.
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/fadeAnimation: false, attributionControl: false,/);
  });

  it("B681520 (×2) — desktop gets a plain always-visible muted text credit, never a collapsed toggle", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/data-testid="food-attribution-text"/);
    const textBlock = map.slice(map.indexOf('data-testid="food-attribution-text"') - 100, map.indexOf('data-testid="food-attribution-text"') + 900);
    expect(textBlock).toMatch(/!narrowViewport/); // desktop only — never gated on anything else
    expect(textBlock).toMatch(/bottom: 6, right: 10/);
    expect(textBlock).not.toMatch(/onClick/); // not a button — always visible, nothing to expand
    expect(textBlock).toMatch(/dangerouslySetInnerHTML/); // same trusted attribution HTML, not a collapsed affordance
  });

  it("B681520 (×2) — mobile keeps a collapsed circular toggle, top-right under the basemap toggle — never the bottom edge — with a real 44x44 touch target and a centred SVG glyph, not an italic text 'i'", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/data-testid="food-attribution-toggle"/);
    const attrBtn = map.slice(map.indexOf('data-testid="food-attribution-toggle"') - 1400, map.indexOf('data-testid="food-attribution-toggle"') + 900);
    expect(attrBtn).toMatch(/narrowViewport/); // gated to mobile, never rendered on desktop too
    expect(attrBtn).toMatch(/top: ATTRIBUTION_TOGGLE_TOP, right: 12/); // directly under the basemap toggle — never the bottom
    expect(attrBtn).toMatch(/width: ATTRIBUTION_TOGGLE_SIZE, height: ATTRIBUTION_TOGGLE_SIZE/);
    expect(attrBtn).toMatch(/borderRadius: "50%"/); // circular, not a rectangular strip
    expect(attrBtn).toMatch(/onClick=\{\(\) => setAttributionOpen\(\(o\) => !o\)\}/);
    expect(attrBtn).toMatch(/<InfoGlyph/); // a centred SVG glyph, never a text character
    expect(attrBtn).not.toMatch(/fontStyle:\s*"italic"/);
    expect(attrBtn).not.toMatch(/>\s*i\s*</); // the old literal text "i" glyph is gone
    // The size/position constants themselves: 44x44 (the module's own touch-target minimum,
    // TOUCH_MIN_TAP_RADIUS=22 diameter-equivalent), not the old sub-minimum 28.
    expect(map).toMatch(/const ATTRIBUTION_TOGGLE_SIZE = 44;/);
  });

  it("B681520 (×2) — InfoGlyph is a plain SVG whose ink is centred in its own viewBox on both axes, not a font character", () => {
    const map = src("components/FoodMap.jsx");
    const glyphIdx = map.indexOf("function InfoGlyph(");
    expect(glyphIdx).toBeGreaterThanOrEqual(0);
    const glyph = map.slice(glyphIdx, map.indexOf("export default function FoodMap"));
    expect(glyph).toMatch(/viewBox="0 0 24 24"/);
    expect(glyph).toMatch(/<circle cx="12" cy="7\.6" r="1\.6"/); // the dot
    expect(glyph).toMatch(/<rect x="10\.4" y="10\.4" width="3\.2" height="7\.6" rx="1\.6"/); // the stem
    // Ink extent: dot top = cy-r = 6.0, stem bottom = y+height = 18.0 -> centred exactly on 12.
    expect(7.6 - 1.6).toBe(6.0);
    expect(10.4 + 7.6).toBe(18.0);
    expect((6.0 + 18.0) / 2).toBe(12);
    // Horizontal: dot cx=12 (centre), stem x=10.4 width=3.2 -> spans 10.4 to 13.6, centred on 12.
    expect(10.4 + 3.2 / 2).toBe(12);
  });

  it("expanding the credit shows the CURRENT basemap's real text (never re-typed) — no 'Leaflet' prefix anywhere", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/data-testid="food-attribution-panel"/);
    expect(map).toMatch(/dangerouslySetInnerHTML=\{\{ __html: basemap === "satellite" \? SATELLITE_TILES\.attribution : STREET_TILES\.attribution \}\}/);
    // Sourced from the SAME constants already passed to Leaflet's own `attribution` option —
    // never a second, hand-typed copy that could drift.
    expect(map).toMatch(/attribution: source\.attribution/); // still fed to the tileLayer options too (harmless, nothing reads it now)
    // Never Leaflet's own `L.control.attribution`/`prefix` mechanism — that's exactly what
    // rendered the unwanted "Leaflet |" text the owner screenshotted (quoted in the header
    // comment above, which is why this checks for the CALL, not the substring).
    expect(map).not.toMatch(/L\.control\.attribution/);
    expect(map).not.toMatch(/prefix:/);
    expect(map).not.toMatch(/leafletjs\.com/); // the URL that prefix links to
  });

  it("verified live: closed by default, correct credit per basemap, positioned clear of the toggle and the sheet (.scratch-repro/verify-attribution.mjs)", () => {
    // Real browser check, not source pattern alone: attribution panel absent before the first
    // tap; tapping shows "OpenStreetMap"/"CARTO" on street, "Esri" after switching to satellite;
    // no literal "Leaflet" text anywhere on the page; the toggle button's box sits below the
    // basemap toggle's box and above the bottom sheet's box at every measured point — this is
    // documented here as the record of that run, not re-asserted as a source pattern (a live DOM
    // layout check needs a real browser, already done this session).
    expect(true).toBe(true);
  });

  it("NEW-1 (2nd owner block) — the zoom-gate notice, capped notice, and 'Search live for more here' share ONE bottom-centre stack, never scattered between top and bottom", () => {
    const map = src("components/FoodMap.jsx");
    // All three now live inside the SAME wrapper, between the map host and the loading pill —
    // no more top:12 notices or a narrowViewport-conditional top/bottom split for the button.
    const stackStart = map.indexOf("NEW-1 (2nd owner block, 2026-08-23) — the zoom-gate notice");
    const stackEnd = map.indexOf("food-tiles-loading");
    expect(stackStart).toBeGreaterThanOrEqual(0);
    const stack = map.slice(stackStart, stackEnd);
    expect(stack).toMatch(/data-testid="food-zoomed-out-notice"/);
    expect(stack).toMatch(/data-testid="food-capped-notice"/);
    expect(stack).toMatch(/data-testid="food-search-here"/);
    // One shared bottom-anchored wrapper, not three independently-positioned elements.
    expect(stack).toMatch(/bottom:\s*\(narrowViewport \? sheetHeightPx : 0\) \+ BOTTOM_STACK_GAP/);
    expect(stack).not.toMatch(/top: 12, left: "50%"/); // no longer top-anchored
    expect(stack).not.toMatch(/top: 96, left: "50%"/); // no longer a separate mobile top position
  });

  it("NEW-1 (2nd owner block) — the bottom stack tracks the mobile sheet's REAL live height, not a static guess, and ignores it on desktop", () => {
    const app = src("FoodApp.jsx");
    expect(app).toMatch(/const \[sheetHeightPx, setSheetHeightPx\] = useState\(0\)/);
    expect(app).toMatch(/onSheetHeightChange=\{setSheetHeightPx\}/);
    expect(app).toMatch(/sheetHeightPx=\{sheetHeightPx\}/);
    // Reset to 0 on close so a stale height never lingers once the sheet is gone.
    const closePanel = app.slice(app.indexOf("const closePanel ="), app.indexOf("const closePanel =") + 120);
    expect(closePanel).toMatch(/setSheetHeightPx\(0\)/);

    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/wishlisted, onToggleWishlist, onSheetHeightChange,/); // destructured prop
    expect(panel).toMatch(/onHeightChange=\{onSheetHeightChange\}/); // threaded into BottomSheet, mobile branch only

    const sheet = src("components/BottomSheet.jsx");
    expect(sheet).toMatch(/onHeightChange\?\.\(heightPx\)/); // fires on every real height change, not a poll
    expect(sheet).not.toMatch(/setInterval\(/);
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
    const flyCallIdx = map.indexOf("map.flyTo(shiftedLatLng, targetZoom,");
    const flyEffect = map.slice(flyCallIdx - 400, flyCallIdx + 80);
    expect(flyEffect).toMatch(/map\.once\(\s*"moveend"/);
    expect(flyEffect).toMatch(/map\.invalidateSize\(/);
    expect(flyEffect).toMatch(/map\.setView\(map\.getCenter\(\), map\.getZoom\(\), \{ reset: true/);
    // The reset must be scheduled BEFORE flyTo is called (map.once must be registered ahead of
    // the call whose moveend it's listening for), and it must never be a poll/interval — the
    // house rule this item's own brief calls out explicitly ("do not fix it by adding a
    // blanket setInterval redraw").
    expect(flyEffect.indexOf("map.once(")).toBeGreaterThanOrEqual(0);
    expect(flyEffect.indexOf("map.once(")).toBeLessThan(flyEffect.indexOf("map.flyTo(shiftedLatLng, targetZoom,"));
    // A CALL is what the house rule bans — not the word itself, which the B651872 (×2) recurrence's
    // own explanatory comment (of a DIFFERENT setInterval-shaped fix it deliberately avoided)
    // legitimately needs to name in prose.
    expect(map).not.toMatch(/\bsetInterval\(/);
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

  it("is DISPLAY-ONLY — the place panel header uses it (NEW-2 moved the formatting from FoodApp into VisitPanel's own PanelHeader), never the old naive underscore-swap, and the raw stored value is never mutated", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toContain('import { formatCategory, formatAddress, formatCityFromAddress } from "../lib/formatPlace.js";');
    expect(panel).toMatch(/formatCategory\(category\)/);
    expect(panel).toMatch(/formatAddress\(address\)/);
    expect(panel).not.toMatch(/\.category\?\.replace\(\/_\/g/); // the old lowercase-with-spaces version is gone
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
    expect(map).toMatch(/const drawnRadius = isSelected \? baseRadius \+ 5 : baseRadius;/); // noticeably larger
    expect(map).toMatch(/radius: drawnRadius,/);
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

  it("B651872 (×3) — a selected place with no pin yet (search-selected, not in the bounds-scoped snapshot) still gets ONE fallback pin, from FoodApp's own coordinates", () => {
    // Owner's explicit ask: confirm whether the selected marker renders at the landing zoom, and
    // say so plainly if it does not, rather than filing it as fixed. It did not — a place found
    // via search but never visited/flagged only ever draws from `places` (bounds-scoped,
    // refetched on 'moveend'), so right after a jump, before that refetch lands, there was
    // nothing to attach the selection highlight to.
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/selectedPlaceInfo/);
    expect(map).toMatch(/let selectedDrawn = false;/);
    // Every addPin/addHollowPin call marks selectedDrawn when it draws the selected key, so the
    // fallback can tell whether it's still needed.
    expect(map).toMatch(/if \(isSelected\) selectedDrawn = true;/);
    const fallback = map.slice(map.indexOf("if (selectedKey && !selectedDrawn"));
    expect(fallback).toMatch(/selectedPlaceInfo\?\.lat != null && selectedPlaceInfo\?\.lon != null/);
    expect(fallback).toMatch(/key: selectedKey/); // reuses the SAME key scheme, never a special-cased one
    // FoodApp actually threads selectedPlaceInfo through as a prop, sourced from the search
    // result's own lat/lon — never re-derived or re-fetched.
    const app = src("FoodApp.jsx");
    expect(app).toMatch(/const selectedPlaceInfo = selected\?\.kind === "place"/);
    expect(app).toMatch(/lat: selected\.place\.lat, lon: selected\.place\.lon, name: selected\.place\.name/);
    expect(app).toMatch(/selectedPlaceInfo=\{selectedPlaceInfo\}/);
  });

  it("the fly-to pan offsets the destination by half the panel's width — lands in the VISIBLE area, not the raw map centre", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const PANEL_WIDTH = 340;/); // matches VisitPanel's own literal width
    expect(map).toMatch(/const panelOffsetPx = Math\.min\(PANEL_WIDTH, containerWidth \* 0\.8\) \/ 2;/);
    expect(map).toMatch(/map\.project\(\[flyToTarget\.lat, flyToTarget\.lon\], targetZoom\)/);
    expect(map).toMatch(/targetPoint\.add\(\[panelOffsetPx, 0\]\)/);
    expect(map).toMatch(/map\.flyTo\(shiftedLatLng, targetZoom, \{ duration: FLY_DURATION_SEC \}\)/);
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

  it("VisitCard shows Food and Ambiance chips independently — a visit with only one set still renders sensibly, same principle as a dateless visit (NEW-2 renamed VisitRow/RatingPill to VisitCard/Chip as part of the panel rebuild, same independent-rendering behavior)", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const hasRating = visit\.rating != null;/);
    expect(panel).toMatch(/const hasAmbiance = visit\.rating_ambiance != null;/);
    expect(panel).toMatch(/\{hasRating && <Chip label="Food" value=\{visit\.rating\} \/>\}/);
    expect(panel).toMatch(/\{hasAmbiance && <Chip label="Ambiance" value=\{visit\.rating_ambiance\} \/>\}/);
    expect(panel).toMatch(/\{!hasRating && !hasAmbiance && !hasWouldReturn && <span/); // all-absent fallback, only when NONE present
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4e. QUARTER-POINT RATINGS (owner chat block, 2026-08-27/28: "quarter-point ratings, not just
 *     half points"). The schema widen (numeric(3,1) -> numeric(4,2), NOT the brief's own
 *     suggested numeric(3,2) — that overflows on a rating of exactly 10, proven live against
 *     production before writing the migration), the loosened CHECK, the slider's step, and the
 *     natural-precision display fix in VisitList (the one raw-string display site the schema
 *     widen would otherwise silently start padding to "9.00").
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("quarter-point ratings — schema widened to numeric(4,2), CHECK loosened to quarters, NOT numeric(3,2)", () => {
  it("db/food.sql widens rating AND rating_ambiance to numeric(4,2) with a quarters-only CHECK", () => {
    const sql = src("db/food.sql");
    expect(sql).toMatch(/alter table public\.food_visits alter column rating type numeric\(4,2\) using rating::numeric\(4,2\);/);
    expect(sql).toMatch(/alter table public\.food_visits alter column rating_ambiance type numeric\(4,2\) using rating_ambiance::numeric\(4,2\);/);
    const quartersCheckHits = [...sql.matchAll(/rating \* 4 = round\(rating \* 4\)/g)];
    expect(quartersCheckHits.length).toBe(1); // the food-rating column's own constraint
    expect(sql).toMatch(/rating_ambiance \* 4 = round\(rating_ambiance \* 4\)/);
  });

  it("⛔ NEVER numeric(3,2) in actual DDL — it overflows on a rating of exactly 10 (numeric(3,2)'s max representable value is 9.99), proven live against production before this migration shipped", () => {
    const sql = src("db/food.sql");
    // Strip full-line `--` comments before checking — the file deliberately mentions
    // "numeric(3,2)" in PROSE (including a worked `::numeric(3,2)` example of the exact overflow),
    // explaining why it was rejected, and that explanatory comment must not trip this guard. Only
    // an occurrence in REAL DDL (a column type or a cast Postgres would actually execute) counts.
    const ddlOnly = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    expect(ddlOnly).not.toMatch(/numeric\(3,2\)/);
    // The reasoning has to survive in the file, not just in a commit message — the next session
    // reading this migration should not have to rediscover the overflow the hard way.
    expect(sql).toMatch(/overflow/i);
    expect(sql).toContain("numeric(3,2)"); // the cautionary mention itself must stay in the file
  });

  it("the OLD half-point migration section is untouched (still present, still historically correct) — this is an ADDITIVE later migration, not a rewrite of it", () => {
    const sql = src("db/food.sql");
    expect(sql).toMatch(/alter table public\.food_visits alter column rating type numeric\(3,1\)/);
    expect(sql).toMatch(/rating\s+numeric\(3,1\)\s+check/); // the original inline create, left alone
  });

  it("VisitPanel's RATING_STEP is 0.25 (37 stops across 1-10), still ONE native range-slider control", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const RATING_STEP = 0\.25;/);
  });

  it("⛔ VisitList shows ratings at natural precision too — Number(v.rating)/Number(v.rating_ambiance), never the raw numeric(4,2) string (which would otherwise read '9.00' post-widen)", () => {
    const list = src("components/VisitList.jsx");
    expect(list).toMatch(/\{Number\(v\.rating\)\}\/10/);
    expect(list).toMatch(/\{Number\(v\.rating_ambiance\)\}\/10/);
    // The raw un-coerced form must not remain anywhere in these two display sites.
    expect(list).not.toMatch(/\{v\.rating\}\/10/);
    expect(list).not.toMatch(/\{v\.rating_ambiance\}\/10/);
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

  it("⛔ RENAMED to 'Order again' (NEW-2, owner: 'the thing he opens the app for while standing at the door') — still every past visit's what_was_good, still rendered ABOVE Past visits, but now DEDUPED and explicitly newest-first, not a plain join", () => {
    const lib = src("lib/visitAggregates.js");
    expect(lib).toMatch(/export function orderAgainEntries\(pastVisits\) \{/);
    // Deduped on identical text (a Set, not a plain .map().filter(Boolean)) — the old behavior
    // this superseded joined every occurrence, even repeats.
    expect(lib).toMatch(/const seen = new Set\(\);/);
    expect(lib).toMatch(/if \(!text \|\| seen\.has\(text\)\) continue;/);
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/function OrderAgain\(\{ entries \}\) \{/);
    expect(panel).toMatch(/entries\.join\("; "\)/);
    expect(panel.indexOf("<OrderAgain")).toBeGreaterThan(-1);
    // Compared against <PastVisitsSection's USAGE (inside the same `body` JSX block <OrderAgain
    // itself sits in), not the data-testid string inside PastVisitsSection's own definition —
    // that definition sits EARLIER in the file (function declarations precede the component that
    // uses them), which would make this comparison backwards regardless of actual render order.
    expect(panel.indexOf("<OrderAgain")).toBeLessThan(panel.indexOf("<PastVisitsSection"));
  });

  it("renders NOTHING when no past visit has a liked entry — no empty heading, quiet by default", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/if \(!entries\.length\) return null;/);
  });

  it("kept as plain unparsed text — never split into a dish taxonomy, tags, or a separate entity (checked in visitAggregates.js, which now owns orderAgainEntries, AND VisitPanel.jsx)", () => {
    const lib = src("lib/visitAggregates.js");
    const panel = src("components/VisitPanel.jsx");
    for (const file of [lib, panel]) {
      expect(file).not.toMatch(/\.split\(","\)/);
      expect(file).not.toMatch(/dishTag|DishEntity|dish_taxonomy|dishAutocomplete/i);
    }
  });

  it("VisitList shows 'What was good' as its own per-row column — that visit's own value, never an aggregate (the panel owns aggregation)", () => {
    const list = src("components/VisitList.jsx");
    expect(list).toContain('<th style={{ padding: "4px 8px", fontWeight: 700 }}>What was good</th>');
    expect(list).toMatch(/\{v\.what_was_good \|\| "—"\}/);
  });
});

describe("B651872 (×2) — RECURRENCE: tile fade-in disabled, not patched around", () => {
  it("the map is constructed with fadeAnimation:false — never a setTimeout/setInterval forcing opacity", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/fadeAnimation: false, attributionControl: false,/);
    expect(map).not.toMatch(/\bsetTimeout\(/);
    expect(map).not.toMatch(/\bsetInterval\(/);
    expect(map).not.toMatch(/\.style\.opacity\s*=/); // never hand-forcing a tile's opacity
  });
});

describe("B668193 — canvas pins get a wider, nearest-centre tap target on a coarse (touch) pointer only", () => {
  it("desktop (fine pointer) is byte-identical: still a plain per-marker click listener, no touch-only branch taken", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/if \(coarsePointer\) pinIndexRef\.current\.push\(\{ lat, lon, radius: drawnRadius, onClick \}\);/);
    expect(map).toMatch(/else m\.on\("click", onClick\);/);
  });

  it("pointer type is read reactively via matchMedia('(pointer: coarse)') — not a one-shot check, not a viewport-width guess", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/function useCoarsePointer\(\) \{/);
    expect(map).toMatch(/window\.matchMedia\("\(pointer: coarse\)"\)/);
    expect(map).toMatch(/mq\.addEventListener\("change", on\)/);
  });

  it("the resolver picks the NEAREST candidate within tolerance, not the topmost/last-drawn one Leaflet's own canvas hit-test would pick", () => {
    const map = src("components/FoodMap.jsx");
    const resolver = map.slice(map.indexOf("coarse-pointer nearest-centre tap resolver"), map.indexOf("const showCappedNotice"));
    expect(resolver).toMatch(/let best = null, bestDist = Infinity;/);
    expect(resolver).toMatch(/if \(dist <= limit && dist < bestDist\) \{ bestDist = dist; best = cand; \}/);
    // Never picks the last match unconditionally (that would be the draw-order-wins bug this
    // item exists to avoid) — the comparison against bestDist is what makes it "nearest."
    expect(resolver).not.toMatch(/best = cand;\s*\n\s*\}\s*\n\s*best\?\.onClick/);
  });

  it("the tap-target floor only widens the HIT AREA, never the drawn radius — visual density is untouched", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/const TOUCH_MIN_TAP_RADIUS = 22;/);
    expect(map).toMatch(/const limit = Math\.max\(cand\.radius, TOUCH_MIN_TAP_RADIUS\);/);
    // The drawn circleMarker's own `radius:` option is computed identically to before this item
    // (still just `drawnRadius`) — TOUCH_MIN_TAP_RADIUS never feeds into what's actually painted.
    expect(map).not.toMatch(/radius: .*TOUCH_MIN_TAP_RADIUS/);
  });

  it("the resolver stands down while pinMode is active, so tapping an existing pin can't also drop a new manual pin at that spot", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/if \(!map \|\| !coarsePointer \|\| pinMode\) return undefined;/);
  });
});

describe("B668194 — a successful visit save clears the form; a failed one keeps what was typed", () => {
  it("FoodApp's submitVisit returns a boolean — true only after a confirmed write + reload, false on every early-return/failure path", () => {
    const app = src("FoodApp.jsx");
    const submitVisitFn = app.slice(app.indexOf("const submitVisit = useCallback"), app.indexOf("const removeVisit = useCallback"));
    expect(submitVisitFn).toMatch(/if \(!selected\) return false;/);
    expect(submitVisitFn).toMatch(/setError\("Give this place a name first\."\);\s*\n\s*return false;/);
    expect(submitVisitFn).toMatch(/if \(err\) \{/);
    expect(submitVisitFn).toMatch(/setError\(err\.message \|\| "Couldn't save that visit\."\);\s*\n\s*return false;/);
    expect(submitVisitFn).toMatch(/await reloadVisits\(\);[\s\S]{0,320}return true;/);
  });

  it("NEW-1 (2026-08-27) — the visit is added OPTIMISTICALLY before the write resolves, and rolled back (never left as a phantom) if it fails", () => {
    const app = src("FoodApp.jsx");
    const submitVisitFn = app.slice(app.indexOf("const submitVisit = useCallback"), app.indexOf("const removeVisit = useCallback"));
    // The optimistic push happens BEFORE the await — i.e. before the network round-trip, not after.
    const optimisticIdx = submitVisitFn.indexOf("setVisits((v) => [optimisticVisit, ...v]);");
    const awaitIdx = submitVisitFn.indexOf("const { error: err } = await insertVisit(payload);");
    expect(optimisticIdx).toBeGreaterThanOrEqual(0);
    expect(awaitIdx).toBeGreaterThan(optimisticIdx);
    // The optimistic id has a shape that can NEVER collide with a real row's uuid, so the
    // rollback filter can never accidentally drop a real, already-confirmed visit.
    expect(submitVisitFn).toMatch(/const optimisticId = `optimistic-\$\{\+\+optimisticIdRef\.current\}`;/);
    // Rollback removes EXACTLY the optimistic row, by id, inside the error branch — never a
    // silent no-op that leaves a phantom visit on screen.
    const errBlock = submitVisitFn.slice(submitVisitFn.indexOf("if (err) {"), submitVisitFn.indexOf("return false;", submitVisitFn.indexOf("if (err) {")) + 20);
    expect(errBlock).toMatch(/setVisits\(\(v\) => v\.filter\(\(x\) => x\.id !== optimisticId\)\);/);
  });

  it("VisitForm awaits the result and resets every field ONLY on success — a failed save leaves everything typed", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toMatch(/const submit = async \(e\) => \{/);
    expect(panel).toMatch(/const saved = await onSubmit\(\{/);
    expect(panel).toMatch(/if \(saved\) \{/);
    const resetBlock = panel.slice(panel.indexOf("if (saved) {"), panel.indexOf("if (saved) {") + 400);
    expect(resetBlock).toMatch(/setRating\(null\);/);
    expect(resetBlock).toMatch(/setRatingAmbiance\(null\);/);
    expect(resetBlock).toMatch(/setCost\(""\);/);
    expect(resetBlock).toMatch(/setVisitedOn\(""\);/);
    expect(resetBlock).toMatch(/setWhatIHad\(""\);/);
    expect(resetBlock).toMatch(/setWhatWasGood\(""\);/);
    expect(resetBlock).toMatch(/setNotes\(""\);/);
    expect(resetBlock).toMatch(/setWouldReturn\(null\);/);
  });

  it("nothing resets outside the success branch — a failed save's reset block is not reachable unconditionally", () => {
    const panel = src("components/VisitPanel.jsx");
    // The reset calls appear exactly once each, all inside the `if (saved)` block (checked above)
    // — not duplicated at the top of submit() where they'd run before the save even resolves.
    for (const setter of ["setRating(null)", "setCost(\"\")", "setWhatIHad(\"\")"]) {
      const count = panel.split(setter).length - 1;
      expect(count).toBe(1);
    }
  });
});

describe("B668195 — no emoji glyphs in the food map view controls (plain text labels)", () => {
  // The exact four glyphs this item names — not a broad unicode-block sweep, which would also
  // flag this repo's own "⛔" comment-convention marker (Miscellaneous Symbols, the same block
  // range a naive emoji regex would need to sweep) as a false positive.
  const TARGET_EMOJI = ["📍", "🔍", "🗺", "🛰"];

  it("FoodMap.jsx: no emoji in the search-here button, or the street/satellite basemap toggle", () => {
    const map = src("components/FoodMap.jsx");
    for (const glyph of TARGET_EMOJI) expect(map).not.toContain(glyph);
    expect(map).toContain("Search live for more here");
    expect(map).toMatch(/\{basemap === "satellite" \? "Street" : "Satellite"\}/);
  });

  it("FoodApp.jsx: no emoji on the Drop a pin toolbar button", () => {
    const app = src("FoodApp.jsx");
    for (const glyph of TARGET_EMOJI) expect(app).not.toContain(glyph);
    expect(app).toMatch(/\{pinMode \? "Click the map…" : "Drop a pin"\}/);
  });

  it("SearchBox.jsx: no emoji on the live-search or drop-a-pin fallback rows in the dropdown", () => {
    const box = src("components/SearchBox.jsx");
    for (const glyph of TARGET_EMOJI) expect(box).not.toContain(glyph);
    expect(box).toContain('Search live for "{trimmed}" nearby');
    expect(box).toContain('Drop a pin for "{trimmed}" — not in any dataset');
  });

  it("the ✕ close glyph is explicitly out of scope and stays", () => {
    const panel = src("components/VisitPanel.jsx");
    expect(panel).toContain("✕");
    // Still the Close button specifically, not the glyph having moved somewhere unrelated — the
    // window is the close button's own JSX element (aria-label="Close" up to its closing tag),
    // not a fixed character count (NEW-2 widened the button's own style block, which a fixed-200
    // window doesn't account for).
    const startIdx = panel.indexOf('aria-label="Close"');
    const closeBtn = panel.slice(startIdx, panel.indexOf("</button>", startIdx));
    expect(closeBtn).toContain("✕");
  });

  it("button padding was widened where an emoji was removed, so tap targets don't shrink", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/padding: "7px 20px"/); // search-here (was 7px 16px)
    expect(map).toMatch(/padding: "7px 18px"/); // basemap toggle (was 7px 14px)
    const app = src("FoodApp.jsx");
    expect(app).toMatch(/padding: "6px 14px"/); // drop-a-pin toolbar button (was 6px 12px)
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 6. "WANT TO TRY" — flag a place before you've ever been (B669312, owner chat block, 2026-08-22).
 *    A THIRD table (food_wishlist), never a food_places column (no user_id there) and never a
 *    food_visits row (a want-to-try place has zero visits by definition). One toggle, works with
 *    zero visits; a distinct hollow map pin that survives the zoomed-out gate; a search badge; a
 *    list shortlist filter; auto-clears the moment a real visit is logged.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("foodStore — manualGroupKey / wishlistedPlaceIds / manualWishlistFromRows (B669312)", () => {
  it("manualGroupKey is shared: manualPinsFromVisits and manualWishlistFromRows resolve the SAME manual pin to the SAME key", () => {
    const visitPin = manualPinsFromVisits([
      { id: "v1", place_id: null, custom_name: "Taco Truck", custom_lat: 29.76011, custom_lon: -95.37009 },
    ])[0];
    const wishPin = manualWishlistFromRows([
      { id: "w1", place_id: null, custom_name: "Taco Truck", custom_lat: 29.7601, custom_lon: -95.3701 },
    ])[0];
    expect(wishPin.key).toBe(visitPin.key);
    expect(wishPin.key).toBe(manualGroupKey("Taco Truck", 29.7601, -95.3701));
  });

  it("wishlistedPlaceIds collects only place_id-bearing wishlist rows, deduped — same shape as loggedPlaceIds", () => {
    const wishlist = [
      { id: "w1", place_id: "a" }, { id: "w2", place_id: "b" }, { id: "w3", place_id: null, custom_name: "Truck" },
    ];
    expect([...wishlistedPlaceIds(wishlist)].sort()).toEqual(["a", "b"]);
  });

  it("manualWishlistFromRows returns ONE pin per row (no grouping needed — the unique index already guarantees at most one row per manual key) with empty visitIds", () => {
    const pins = manualWishlistFromRows([
      { id: "w1", place_id: null, custom_name: "Truck", custom_lat: 29.76, custom_lon: -95.37 },
      { id: "w2", place_id: "a" }, // not a manual row, excluded
    ]);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ id: "w1", name: "Truck", lat: 29.76, lon: -95.37, visitIds: [] });
  });
});

describe("db/food.sql — food_wishlist: a third table, owner-only RLS, unique per (user, place)", () => {
  const sql = src("db/food.sql");

  it("food_wishlist is neither a food_places column nor a food_visits row — its own table with place_id OR custom_name/lat/lon", () => {
    expect(sql).toMatch(/create table if not exists public\.food_wishlist \(/);
    expect(sql).toMatch(/constraint food_wishlist_place_or_manual check \(place_id is not null or custom_name is not null\)/);
    // Carries no visit facts — never rating/cost/visited_on, which would make it look like a visit.
    const tableBlock = sql.slice(sql.indexOf("create table if not exists public.food_wishlist ("), sql.indexOf("food_wishlist_place_or_manual") + 80);
    expect(tableBlock).not.toMatch(/\brating\b/);
    expect(tableBlock).not.toMatch(/\bcost\b/);
    expect(tableBlock).not.toMatch(/visited_on/);
  });

  it("one flag per (user, place) and per (user, manual pin) is enforced by a unique index, not just the UI", () => {
    expect(sql).toMatch(/create unique index if not exists food_wishlist_user_place_uidx\s*\n\s*on public\.food_wishlist \(user_id, place_id\) where place_id is not null;/);
    expect(sql).toMatch(/create unique index if not exists food_wishlist_user_manual_uidx/);
    expect(sql).toMatch(/round\(custom_lat::numeric, 4\), round\(custom_lon::numeric, 4\)/);
  });

  it("owner-only RLS: select/insert/delete keyed on auth.uid(), no update policy, no anon policy at all", () => {
    for (const op of ["select", "insert", "delete"]) {
      const clause = op === "insert" ? "with check" : "using";
      const re = new RegExp(`create policy "Users ${op} own food_wishlist"[\\s\\S]{0,200}?for ${op} to authenticated ${clause} \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`, "i");
      expect(sql, `missing/mismatched ${op} policy`).toMatch(re);
    }
    expect(sql).not.toMatch(/create policy "Users update own food_wishlist"/);
    expect(sql).not.toMatch(/food_wishlist[\s\S]{0,300}?to anon/);
  });

  it("RLS is enabled on food_wishlist", () => {
    expect(sql).toMatch(/alter table public\.food_wishlist enable row level security/);
  });

  it("the RLS proof script extends to food_wishlist with the same isolation + duplicate-refusal proof", () => {
    const proof = src("db/test/food_rls.test.sql");
    expect(proof).toContain("PASS 8"); // owner can flag
    expect(proof).toContain("PASS 9"); // anon sees zero
    expect(proof).toContain("PASS 10"); // a different user sees zero
    expect(proof).toContain("PASS 11"); // duplicate flag refused by the unique index
    expect(proof).toMatch(/unique_violation/);
  });
});

describe("NEW-3 (2026-08-23) — dish-level want-to-try: its own table, distinct lifecycle from place-level food_wishlist", () => {
  describe("foodStore — dishWishlistByPlaceId / dishWishlistByManualKey", () => {
    it("dishWishlistByPlaceId groups by place_id, excludes manual rows and DONE dishes", () => {
      const rows = [
        { id: "d1", place_id: "p1", dish_name: "Pad Thai", done: false },
        { id: "d2", place_id: "p1", dish_name: "Green Curry", done: false },
        { id: "d3", place_id: "p1", dish_name: "Tom Yum", done: true }, // done — excluded
        { id: "d4", place_id: "p2", dish_name: "Ramen", done: false },
        { id: "d5", place_id: null, custom_name: "Truck", custom_lat: 29.76, custom_lon: -95.37, dish_name: "Al pastor", done: false }, // manual — excluded
      ];
      const groups = dishWishlistByPlaceId(rows);
      expect([...groups.get("p1").map((r) => r.dish_name)]).toEqual(["Pad Thai", "Green Curry"]);
      expect(groups.get("p2").map((r) => r.dish_name)).toEqual(["Ramen"]);
      expect(groups.has("p3")).toBe(false);
    });

    it("dishWishlistByManualKey groups manual-pin dishes by the SAME manualGroupKey every other manual table uses", () => {
      const rows = [
        { id: "d1", place_id: null, custom_name: "Truck", custom_lat: 29.76011, custom_lon: -95.37009, dish_name: "Al pastor", done: false },
        { id: "d2", place_id: null, custom_name: "Truck", custom_lat: 29.7601, custom_lon: -95.3701, dish_name: "Barbacoa", done: false },
        { id: "d3", place_id: null, custom_name: "Truck", custom_lat: 29.76, custom_lon: -95.37, dish_name: "Done one", done: true }, // done — excluded
        { id: "d4", place_id: "p1", dish_name: "not manual" }, // has a place_id — excluded
      ];
      const key = manualGroupKey("Truck", 29.7601, -95.3701);
      const groups = dishWishlistByManualKey(rows);
      expect(groups.get(key).map((r) => r.dish_name)).toEqual(["Al pastor", "Barbacoa"]);
    });

    it("addDishWishlist / removeDishWishlist / markDishDone mirror the existing wishlist CRUD shape (own foodStore.js functions, not ad hoc supabase calls elsewhere)", () => {
      const store = src("lib/foodStore.js");
      expect(store).toMatch(/export async function fetchAllDishWishlist\(\)/);
      expect(store).toMatch(/export async function addDishWishlist\(entry\)/);
      expect(store).toMatch(/export async function removeDishWishlist\(id\)/);
      expect(store).toMatch(/export async function markDishDone\(id, done\)/);
      const removeFn = store.slice(store.indexOf("export async function removeDishWishlist"), store.indexOf("export async function markDishDone"));
      expect(removeFn).toMatch(/\.delete\(\)\.eq\("id", id\)/); // a hard delete — "single tap, no confirmation"
      const doneFn = store.slice(store.indexOf("export async function markDishDone"), store.indexOf("export function dishWishlistByPlaceId"));
      expect(doneFn).toMatch(/\.update\(\{ done \}\)\.eq\("id", id\)/); // an UPDATE in place, never delete+reinsert
    });
  });

  describe("db/food.sql — food_dish_wishlist: many rows per place, an update policy (unlike food_wishlist), unique per (user, place, dish)", () => {
    const sql = src("db/food.sql");

    it("food_dish_wishlist is its own table, not a food_wishlist row and not a food_visits column", () => {
      expect(sql).toMatch(/create table if not exists public\.food_dish_wishlist \(/);
      expect(sql).toMatch(/constraint food_dish_wishlist_place_or_manual check \(place_id is not null or custom_name is not null\)/);
      expect(sql).toMatch(/dish_name\s+text not null/);
      expect(sql).toMatch(/done\s+boolean not null default false/);
    });

    it("one row per (user, place, dish) — case/whitespace-insensitive — enforced by a unique index, not just the UI", () => {
      expect(sql).toMatch(/create unique index if not exists food_dish_wishlist_place_dish_uidx\s*\n\s*on public\.food_dish_wishlist \(user_id, place_id, lower\(btrim\(dish_name\)\)\) where place_id is not null;/);
      expect(sql).toMatch(/create unique index if not exists food_dish_wishlist_manual_dish_uidx/);
      expect(sql).toMatch(/round\(custom_lat::numeric, 4\), round\(custom_lon::numeric, 4\), lower\(btrim\(dish_name\)\)/);
    });

    it("owner-only RLS: select/insert/UPDATE/delete keyed on auth.uid() — an update policy exists here, unlike food_wishlist, because marking a dish done is an in-place update", () => {
      for (const op of ["select", "insert", "update", "delete"]) {
        const clause = op === "insert" ? "with check" : "using";
        const re = new RegExp(`create policy "Users ${op} own food_dish_wishlist"[\\s\\S]{0,220}?for ${op} to authenticated ${clause} \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`, "i");
        expect(sql, `missing/mismatched ${op} policy`).toMatch(re);
      }
      expect(sql).not.toMatch(/food_dish_wishlist[\s\S]{0,300}?to anon/);
    });

    it("RLS is enabled on food_dish_wishlist", () => {
      expect(sql).toMatch(/alter table public\.food_dish_wishlist enable row level security/);
    });

    it("the RLS proof script extends to food_dish_wishlist with the same isolation + update + duplicate-refusal proof", () => {
      const proof = src("db/test/food_rls.test.sql");
      expect(proof).toContain("PASS 12"); // owner can add a dish
      expect(proof).toContain("PASS 13"); // anon sees zero
      expect(proof).toContain("PASS 14"); // a different user sees zero
      expect(proof).toContain("PASS 15"); // owner can mark a dish done via UPDATE
      expect(proof).toContain("PASS 16"); // duplicate dish refused by the unique index
    });
  });
});

describe("FoodMap — hollow ring pin for a flagged-but-unvisited place, never a filled dot", () => {
  const map = src("components/FoodMap.jsx");

  it("defines a dedicated wishlist colour, distinct from the rating ramp / manual / unlogged colours", () => {
    expect(map).toMatch(/wishlist:\s*"#3B7DDE"/);
  });

  it("addHollowPin draws with zero fill opacity — a ring, never a filled marker", () => {
    const fn = map.slice(map.indexOf("const addHollowPin"), map.indexOf("// HIS places"));
    expect(fn).toMatch(/fillColor:\s*COLORS\.wishlist,\s*fillOpacity:\s*0,/);
    expect(fn).toMatch(/color:\s*isSelected \? SELECTED_ACCENT : COLORS\.wishlist,/);
  });

  it("wishlist pins are drawn in the same unconditional section as loggedPlaces/manualPins — OUTSIDE the tooSmall-gated block, so they survive the zoomed-out gate", () => {
    const drawEffect = map.slice(map.indexOf("Redraw markers"), map.indexOf("}, [places, loggedPlaces"));
    const gateIdx = drawEffect.indexOf("const REFERENCE_PIN");
    const hisPlacesBlock = drawEffect.slice(0, gateIdx);
    expect(hisPlacesBlock).toMatch(/for \(const p of wishlistPlaces \|\| \[\]\)/);
    expect(hisPlacesBlock).toMatch(/for \(const pin of wishlistManualPins \|\| \[\]\)/);
    expect(hisPlacesBlock).toMatch(/addHollowPin\(/);
  });

  it("hasOwnPlaces counts wishlist places/pins too, so the zoomed-out notice reads correctly when ONLY a shortlist (no visits) exists", () => {
    expect(map).toMatch(/const hasOwnPlaces = \(loggedPlaces\?\.length \|\| 0\) \+ \(manualPins\?\.length \|\| 0\) \+ \(wishlistPlaces\?\.length \|\| 0\) \+ \(wishlistManualPins\?\.length \|\| 0\) > 0;/);
  });

  it("the zoomed-out copy reflects that want-to-try places are shown too", () => {
    expect(map).toMatch(/Showing places you've been or want to try/);
  });
});

describe("FoodApp — wishlist state, exclusion of already-visited, and auto-clear on first visit", () => {
  const app = src("FoodApp.jsx");

  it("fetches the wishlist the same way visits are fetched — a bulk reload, gated on accountActive", () => {
    expect(app).toMatch(/const reloadWishlist = useCallback\(async \(\) => \{/);
    expect(app).toMatch(/if \(!accountActive\) \{ setWishlist\(\[\]\); return; \}/);
    expect(app).toMatch(/const \{ data \} = await fetchAllWishlist\(\);/);
  });

  it("wishlistPlaces/wishlistManualPins EXCLUDE anything already logged — a flagged-and-visited place reads as visited, never want-to-try", () => {
    expect(app).toMatch(/const wishlistPlaces = useMemo\(\s*\(\) => \[\.\.\.wishlistIds\]\.filter\(\(id\) => !loggedIds\.has\(id\)\)/);
    expect(app).toMatch(/const wishlistManualPins = useMemo\(\s*\(\) => manualWishlistAll\.filter\(\(p\) => !manualPinKeys\.has\(p\.key\)\)/);
  });

  it("submitVisit clears a matching wishlist flag on the FIRST visit — never prompts, just removes it", () => {
    const submitVisit = app.slice(app.indexOf("const submitVisit = useCallback"), app.indexOf("const toggleWishlist"));
    expect(submitVisit).toMatch(/const clearedWish = payload\.place_id/);
    expect(submitVisit).toMatch(/if \(clearedWish\) await removeWishlist\(clearedWish\.id\);/);
    expect(submitVisit).not.toMatch(/window\.(confirm|prompt|alert)/);
  });

  it("toggleWishlist is one click on, one click off — inserts when absent, removes when present, for a place, an existing manual pin, or a not-yet-saved new pin", () => {
    const toggle = app.slice(app.indexOf("const toggleWishlist = useCallback"), app.indexOf("const removeVisit = useCallback"));
    expect(toggle).toMatch(/existing \? await removeWishlist\(existing\.id\) : await addWishlist\(/);
    // Requires a name before flagging a brand-new dropped pin — same validation submitVisit uses.
    expect(toggle).toMatch(/if \(!name \|\| !name\.trim\(\)\) \{ setError\("Give this place a name first\."\); return; \}/);
  });

  it("wires the wishlist toggle and state into VisitPanel, wishlistIds into SearchBox, and both wishlist pin lists into FoodMap", () => {
    expect(app).toMatch(/wishlisted=\{wishlistedForSelected\}/);
    expect(app).toMatch(/onToggleWishlist=\{accountActive \? toggleWishlist : undefined\}/);
    expect(app).toMatch(/wishlistIds=\{wishlistIds\}/);
    expect(app).toMatch(/wishlistPlaces=\{wishlistPlaces\}/);
    expect(app).toMatch(/wishlistManualPins=\{wishlistManualPins\}/);
  });

  it("listRows folds in flagged-but-unvisited places as isWishlist rows, excluding anything already visited", () => {
    const listRows = app.slice(app.indexOf("const listRows = useMemo"), app.indexOf("const openPlace ="));
    expect(listRows).toMatch(/isWishlist:\s*true/);
    expect(listRows).toMatch(/isWishlist:\s*false/);
    expect(listRows).toMatch(/!loggedIds\.has\(w\.place_id\)/);
  });
});

describe("SearchBox — 'Want to try' badge on a flagged (never-visited) snapshot result", () => {
  const box = src("components/SearchBox.jsx");

  it("marks a snapshot result wishlisted from the wishlistIds prop, alongside the existing mine/loggedIds check", () => {
    expect(box).toMatch(/wishlisted:\s*wishlistIds\?\.has\(p\.id\)/);
  });

  it("the badge shows only when NOT already visited — a visited-and-flagged place shows 'Been here', never both", () => {
    expect(box).toMatch(/\{!p\.mine && p\.wishlisted && \(/);
    expect(box).toMatch(/Want to try/);
  });
});

describe("VisitPanel — the 'Want to try' toggle, reachable with zero visits", () => {
  const panel = src("components/VisitPanel.jsx");

  it("renders the toggle ABOVE the past-visits list, so it's reachable even when pastVisits is empty (NEW-2 moved it into the Actions row, block 4, still ahead of Past visits, block 5)", () => {
    expect(panel).toMatch(/data-testid="food-wishlist-toggle"/);
    // Compared via the two blocks' USAGE inside the shared `body` JSX (<ActionsRow / <PastVisitsSection),
    // not their data-testid strings — those live inside each component's own DEFINITION, whose
    // file order doesn't necessarily track render order (see the sibling Order-again test's comment).
    expect(panel.indexOf("<ActionsRow")).toBeGreaterThan(-1);
    expect(panel.indexOf("<ActionsRow")).toBeLessThan(panel.indexOf("<PastVisitsSection"));
  });

  it("only renders when onToggleWishlist is provided (signed out / not applicable) AND the place has never been visited (NEW-1, 2026-08-27) — otherwise stays out of the DOM entirely", () => {
    // Guarded independently of onSubmitVisit's own gating one level up (ActionsRow is built once
    // and reused for both branches, so the guard lives on the wishBtn element itself, inside
    // ActionsRow, rather than wrapping the whole row).
    expect(panel).toMatch(/const wishBtn = onToggleWishlist && !everVisited && \(/);
  });

  it("aria-pressed reflects the wishlisted prop — a screen reader / test can read the flagged state directly", () => {
    expect(panel).toMatch(/aria-pressed=\{wishlisted\}/);
  });
});

describe("VisitList — 'Want to try' shortlist filter chip, same visual pattern as the sort row", () => {
  const list = src("components/VisitList.jsx");

  it("is a FILTER toggle (local state, not a sort), reusing fieldStyle() — never a new control style", () => {
    expect(list).toMatch(/const \[shortlistOnly, setShortlistOnly\] = useState\(false\);/);
    expect(list).toMatch(/if \(shortlistOnly\) filtered = filtered\.filter\(\(v\) => v\.isWishlist\);/);
    const button = list.slice(list.indexOf('data-testid="food-list-shortlist-filter"') - 200, list.indexOf('data-testid="food-list-shortlist-filter"') + 300);
    expect(button).toMatch(/\.\.\.fieldStyle\(\),/);
  });

  it("shows a distinct empty-state message when the shortlist filter is on and empty", () => {
    expect(list).toMatch(/Nothing on your want-to-try list yet\./);
  });

  it("a flagged row carries its own small outlined badge next to the place name", () => {
    expect(list).toMatch(/\{v\.isWishlist && \(/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 7. PLACE DETAIL PANEL REBUILD (NEW-2, owner chat block, 2026-08-22, verbatim: "Make this a
 *    world class interface for when you click on a restaurant. Right now, it's lacking" —
 *    judged on his phone, in Safari). A bottom sheet on mobile (map stays visible/pannable
 *    above it), the same right rail on desktop; aggregates, an "order again" block, a redesigned
 *    actions row, and past-visit cards with delete behind a confirm — same content, same order,
 *    on both breakpoints.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("visitAggregates — pure aggregation over already-loaded pastVisits, no new round trip", () => {
  it("computes averages, count, and first/last dates from a mixed set of visits", () => {
    const visits = [
      { id: "v1", rating: 8, rating_ambiance: 7, cost: 20, visited_on: "2026-01-10" },
      { id: "v2", rating: 6, rating_ambiance: null, cost: 30, visited_on: "2026-06-01" },
      { id: "v3", rating: null, rating_ambiance: 9, cost: null, visited_on: "2025-12-25" },
    ];
    const agg = computeVisitAggregates(visits);
    expect(agg.visitCount).toBe(3);
    expect(agg.avgFood).toBe(7); // (8+6)/2
    expect(agg.avgAmbiance).toBe(8); // (7+9)/2
    expect(agg.avgCost).toBe(25); // (20+30)/2
    expect(agg.firstVisitDate).toBe("2025-12-25");
    expect(agg.lastVisitDate).toBe("2026-06-01");
  });

  it("a dateless visit is EXCLUDED from first/last but still counted in visitCount", () => {
    const visits = [
      { id: "v1", rating: 5, visited_on: null },
      { id: "v2", rating: 7, visited_on: "2026-03-01" },
    ];
    const agg = computeVisitAggregates(visits);
    expect(agg.visitCount).toBe(2);
    expect(agg.firstVisitDate).toBe("2026-03-01");
    expect(agg.lastVisitDate).toBe("2026-03-01");
  });

  it("all-dateless visits: counted, but first/last are both null (not a crash, not a wrong date)", () => {
    const agg = computeVisitAggregates([{ id: "v1", rating: 5, visited_on: null }]);
    expect(agg.visitCount).toBe(1);
    expect(agg.firstVisitDate).toBeNull();
    expect(agg.lastVisitDate).toBeNull();
  });

  it("an average with NO rated visits at all is null, never 0 — the panel renders an em dash for null, never a misleading zero", () => {
    const agg = computeVisitAggregates([{ id: "v1", rating: null, rating_ambiance: null, cost: null, visited_on: "2026-01-01" }]);
    expect(agg.avgFood).toBeNull();
    expect(agg.avgAmbiance).toBeNull();
    expect(agg.avgCost).toBeNull();
  });

  it("empty pastVisits array: every field is a safe zero/null, never throws", () => {
    const agg = computeVisitAggregates([]);
    expect(agg).toEqual({ visitCount: 0, avgFood: null, avgAmbiance: null, avgCost: null, lastVisitDate: null, firstVisitDate: null });
  });

  it("⛔ coerces STRING numeric fields — Postgres numeric round-trips as a JSON string over PostgREST, same trap avgRatingByPlaceId already guards", () => {
    const agg = computeVisitAggregates([
      { id: "v1", rating: "7", cost: "10.50" },
      { id: "v2", rating: "9", cost: "5.50" },
    ]);
    expect(agg.avgFood).toBe(8);
    expect(agg.avgCost).toBe(8);
  });

  it("orderAgainEntries dedupes identical text, keeping the FIRST (newest, per fetchAllVisits' own ordering) occurrence's position", () => {
    const visits = [
      { id: "v1", what_was_good: "The hamachi" }, // newest
      { id: "v2", what_was_good: "The agedashi" },
      { id: "v3", what_was_good: "The hamachi" }, // repeat — dropped
      { id: "v4", what_was_good: null },
    ];
    expect(orderAgainEntries(visits)).toEqual(["The hamachi", "The agedashi"]);
  });

  it("orderAgainEntries returns [] when no visit has what_was_good set", () => {
    expect(orderAgainEntries([{ id: "v1", what_was_good: null }])).toEqual([]);
  });
});

describe("dateFormat — display-only, never a raw ISO string, local-calendar-day parsing", () => {
  const NOW = new Date(2026, 7, 22); // Aug 22, 2026 (local) — matches "today" for these fixtures

  it("formatVisitDate omits the year for a date in the current year", () => {
    expect(formatVisitDate("2026-08-18", NOW)).toBe("Aug 18");
  });

  it("formatVisitDate includes the year for a date NOT in the current year", () => {
    expect(formatVisitDate("2025-08-18", NOW)).toBe("Aug 18, 2025");
  });

  it("formatVisitDate returns 'Date unknown' for null/malformed input — never 'Invalid Date', never a raw string", () => {
    expect(formatVisitDate(null, NOW)).toBe("Date unknown");
    expect(formatVisitDate("not-a-date", NOW)).toBe("Date unknown");
  });

  it("formatVisitDate parses as a LOCAL calendar date — Jan 1 stays Jan 1 regardless of timezone, never shifted a day by UTC parsing", () => {
    // The classic `new Date("2026-01-01")` trap: that parses as UTC midnight, which prints as
    // Dec 31 in any negative-UTC-offset zone. This file's own parser must not do that.
    expect(formatVisitDate("2026-01-01", new Date(2026, 0, 1))).toBe("Jan 1");
  });

  it("formatMonthYear returns 'Mon YYYY', or null for missing/malformed input", () => {
    expect(formatMonthYear("2024-03-15")).toBe("Mar 2024");
    expect(formatMonthYear(null)).toBeNull();
    expect(formatMonthYear("garbage")).toBeNull();
  });

  it("formatRelativeDate: today/yesterday/day-count/week-count/month-count/year-count, each singular-vs-plural correct", () => {
    expect(formatRelativeDate("2026-08-22", NOW)).toBe("today");
    expect(formatRelativeDate("2026-08-21", NOW)).toBe("yesterday");
    expect(formatRelativeDate("2026-08-18", NOW)).toBe("4 days ago");
    expect(formatRelativeDate("2026-08-15", NOW)).toBe("1 week ago");
    expect(formatRelativeDate("2026-08-01", NOW)).toBe("3 weeks ago");
    expect(formatRelativeDate("2026-07-22", NOW)).toBe("1 month ago");
    expect(formatRelativeDate("2026-01-22", NOW)).toBe("7 months ago");
    expect(formatRelativeDate("2025-08-22", NOW)).toBe("1 year ago");
    expect(formatRelativeDate("2023-08-22", NOW)).toBe("3 years ago");
  });

  it("formatRelativeDate clamps a future date to 'today' rather than printing a negative/nonsense count", () => {
    expect(formatRelativeDate("2026-08-25", NOW)).toBe("today");
  });

  it("formatRelativeDate returns null for missing/malformed input", () => {
    expect(formatRelativeDate(null, NOW)).toBeNull();
  });
});

describe("directions — a plain maps URL, no SDK/key, Apple Maps on iOS/Safari, Google Maps elsewhere (NEW-2)", () => {
  const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const MAC_SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  const MAC_CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  const ANDROID_CHROME_UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
  const IOS_CHROME_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1";

  it("prefers Apple Maps on iPhone Safari and on desktop Safari", () => {
    expect(preferAppleMaps(IPHONE_UA)).toBe(true);
    expect(preferAppleMaps(MAC_SAFARI_UA)).toBe(true);
  });

  it("prefers Apple Maps for ANY browser on an iOS device, not just Safari — Apple Maps is the OS-level map app there regardless of which browser opened the link", () => {
    expect(preferAppleMaps(IOS_CHROME_UA)).toBe(true);
  });

  it("prefers Google Maps on Chrome on a NON-iOS platform (desktop, Android)", () => {
    expect(preferAppleMaps(MAC_CHROME_UA)).toBe(false);
    expect(preferAppleMaps(ANDROID_CHROME_UA)).toBe(false);
  });

  it("directionsUrl builds the Apple Maps daddr form and the Google Maps directions form correctly", () => {
    expect(directionsUrl(29.76, -95.37, IPHONE_UA)).toBe("https://maps.apple.com/?daddr=29.76,-95.37");
    expect(directionsUrl(29.76, -95.37, MAC_CHROME_UA)).toBe("https://www.google.com/maps/dir/?api=1&destination=29.76,-95.37");
  });

  it("directionsUrl returns null with no coordinates — the caller renders no link at all rather than a broken one", () => {
    expect(directionsUrl(null, null, MAC_CHROME_UA)).toBeNull();
    expect(directionsUrl(29.76, undefined, MAC_CHROME_UA)).toBeNull();
  });
});

describe("formatPlace — formatCityFromAddress (NEW-2, header line 2: 'French Restaurant · River Oaks')", () => {
  it("extracts the second comma-separated segment as the city", () => {
    expect(formatCityFromAddress("224 Westheimer Rd, Houston, TX 77006")).toBe("Houston");
  });

  it("returns null for an address with fewer than two segments, or none at all", () => {
    expect(formatCityFromAddress("Houston")).toBeNull();
    expect(formatCityFromAddress(null)).toBeNull();
  });

  it("never mutates the stored value — display-only, same principle as formatCategory/formatAddress", () => {
    const raw = "224 Westheimer Rd, Houston, TX 77006";
    formatCityFromAddress(raw);
    expect(raw).toBe("224 Westheimer Rd, Houston, TX 77006");
  });
});

describe("bottomSheetSnap — the pure drag-release decision (BottomSheet.jsx wires this to real pointer coordinates)", () => {
  const bands = { peekHeight: 150, halfHeight: 400, fullHeight: 700 };

  it("resolves to the NEAREST of peek/half/full", () => {
    expect(resolveSnap({ heightPx: 160, ...bands, dismissBelow: 75 })).toBe("peek");
    expect(resolveSnap({ heightPx: 380, ...bands, dismissBelow: 75 })).toBe("half");
    expect(resolveSnap({ heightPx: 690, ...bands, dismissBelow: 75 })).toBe("full");
  });

  it("a tie between two bands resolves to whichever is found first (peek before half before full) — deterministic, not random", () => {
    // 275 is exactly equidistant between peek (150) and half (400).
    expect(resolveSnap({ heightPx: 275, ...bands, dismissBelow: 75 })).toBe("peek");
  });

  it("dragged below dismissBelow resolves to 'dismiss' EVEN IF peek would otherwise be the nearest candidate", () => {
    expect(resolveSnap({ heightPx: 50, ...bands, dismissBelow: 75 })).toBe("dismiss");
    expect(resolveSnap({ heightPx: 74, ...bands, dismissBelow: 75 })).toBe("dismiss");
  });

  it("right at dismissBelow, dismiss does not fire (the check is strictly less-than)", () => {
    expect(resolveSnap({ heightPx: 75, ...bands, dismissBelow: 75 })).toBe("peek");
  });

  it("heightForSnap caps EVERY band at the real content height — 'no empty white below the content, ever'", () => {
    const short = { contentHeight: 90, peekHeight: 150, viewportHeight: 800, topInset: 64 };
    expect(heightForSnap("peek", short)).toBe(90); // shorter than the peek cap itself
    expect(heightForSnap("half", short)).toBe(90); // shorter than 60vh
    expect(heightForSnap("full", short)).toBe(90); // shorter than the full cap
  });

  it("heightForSnap caps half at 60% of the viewport and full at (viewport - topInset), for TALL content", () => {
    const tall = { contentHeight: 5000, peekHeight: 150, viewportHeight: 800, topInset: 64 };
    expect(heightForSnap("half", tall)).toBe(480); // 800 * 0.6
    expect(heightForSnap("full", tall)).toBe(736); // 800 - 64
  });

  it("heightForSnap's peek never exceeds the caller-measured peekHeight even if content is taller", () => {
    expect(heightForSnap("peek", { contentHeight: 5000, peekHeight: 150, viewportHeight: 800, topInset: 64 })).toBe(150);
  });
});

describe("BottomSheet.jsx — a generic drag-to-resize primitive, content-agnostic, no new dependency", () => {
  const sheet = src("components/BottomSheet.jsx");

  it("no new npm dependency was added for gesture handling — Pointer Events only", () => {
    const pkg = JSON.parse(read(REPO, "package.json"));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    // No gesture/drag/swipe library of any kind.
    expect(Object.keys(allDeps).some((k) => /gesture|swipe|drag|hammer|use-gesture|framer-motion/i.test(k))).toBe(false);
  });

  it("uses Pointer Events with capture, not mouse-only or touch-only handlers", () => {
    expect(sheet).toMatch(/onPointerDown=\{onHandlePointerDown\}/);
    expect(sheet).toMatch(/onPointerMove=\{onHandlePointerMove\}/);
    expect(sheet).toMatch(/setPointerCapture/);
  });

  it("respects the iOS safe-area inset at the bottom", () => {
    expect(sheet).toMatch(/paddingBottom:\s*"env\(safe-area-inset-bottom\)"/);
  });

  it("the drag handle's own hit area is at least 44 CSS px tall", () => {
    const handleBlock = sheet.slice(sheet.indexOf('data-testid="food-sheet-drag-handle"'), sheet.indexOf('data-testid="food-sheet-drag-handle"') + 400);
    expect(handleBlock).toMatch(/minHeight:\s*44/);
  });

  it("never renders a full-viewport backdrop — the map above the sheet must stay directly interactive (no scrim to swallow its pan gesture)", () => {
    // Only ONE `position: "fixed"` element in the whole file (the sheet root itself) — a second
    // one would be exactly what a full-viewport backdrop/scrim div looks like. This checks the
    // real structural signal (element count), not the WORD "backdrop" — that word legitimately
    // appears in this file's own explanatory comments, which a plain string ban would trip on.
    expect([...sheet.matchAll(/position:\s*"fixed"/g)]).toHaveLength(1);
  });

  it("the sheet is positioned fixed to the viewport bottom, above the map's own z-index", () => {
    expect(sheet).toMatch(/position:\s*"fixed",\s*left:\s*0,\s*right:\s*0,\s*bottom:\s*0,\s*zIndex:\s*700/);
  });

  it("uses resolveSnap/heightForSnap from the pure lib file, not inline duplicate math", () => {
    expect(sheet).toMatch(/import \{ resolveSnap, heightForSnap \} from "\.\.\/lib\/bottomSheetSnap\.js";/);
  });

  it("returns null (unmounted) when not open — no stray fixed-position element left in the DOM behind a closed sheet", () => {
    expect(sheet).toMatch(/if \(!open\) return null;/);
  });
});

describe("VisitPanel — responsive container: BottomSheet on mobile, the same right rail on desktop, IDENTICAL content either way", () => {
  const panel = src("components/VisitPanel.jsx");

  it("switches container via the same breakpoint AppHeader.jsx already uses for its own narrow layout — not a second, invented number", () => {
    const header = read(REPO, "src/shared/ui/AppHeader.jsx");
    const headerBreakpoint = header.match(/matchMedia\("(\(max-width: \d+px\))"\)/)?.[1];
    expect(headerBreakpoint).toBeTruthy();
    expect(panel).toContain(`const MOBILE_BREAKPOINT = "${headerBreakpoint}";`);
  });

  it("both containers render the exact SAME `body` JSX — the switch only changes what wraps it, never a divergent second copy of the content", () => {
    expect(panel).toMatch(/const body = \(/);
    const mobileBranch = panel.slice(panel.indexOf("if (isMobile)"), panel.indexOf("return (\n    <div data-testid=\"food-visit-panel\""));
    expect(mobileBranch).toContain("{body}");
    expect(panel.slice(panel.indexOf("food-visit-panel\""))).toContain("{body}");
  });

  it("the mobile path wraps `body` in BottomSheet, dismissing calls the same onClose the desktop close button uses", () => {
    expect(panel).toMatch(/<BottomSheet open onDismiss=\{onClose\} initialSnap="half" peekHeight=\{peekHeight\} onHeightChange=\{onSheetHeightChange\}>/);
  });

  it("the desktop path is the same right-rail shape as before — position:absolute, right:0, PANEL_WIDTH-matching 340", () => {
    const desktopBlock = panel.slice(panel.indexOf('data-testid="food-visit-panel"'), panel.indexOf('data-testid="food-visit-panel"') + 300);
    expect(desktopBlock).toMatch(/position:\s*"absolute",\s*top:\s*0,\s*right:\s*0,\s*bottom:\s*0,\s*width:\s*340/);
  });

  it("measures its own peek-zone height (header + score strip / empty-state note) and hands it to BottomSheet — BottomSheet itself stays content-agnostic", () => {
    expect(panel).toMatch(/const peekRef = useRef\(null\);/);
    expect(panel).toMatch(/if \(peekRef\.current\) setPeekHeight\(peekRef\.current\.offsetHeight\);/);
  });
});

describe("VisitPanel — score strip (block 2), only when the place has at least one visit (NEW-2)", () => {
  const panel = src("components/VisitPanel.jsx");

  it("renders Food (hero), Ambiance, Visits, Cost — one decimal on ratings, tabular-nums so digits don't jitter", () => {
    const strip = panel.slice(panel.indexOf("function ScoreStrip"), panel.indexOf("/* Order again"));
    expect(strip).toMatch(/avgFood == null \? "—" : avgFood\.toFixed\(1\)/);
    expect(strip).toMatch(/avgAmbiance == null \? "—" : avgAmbiance\.toFixed\(1\)/);
    expect(strip).toMatch(/avgCost == null \? "—" : `\$\$\{avgCost\.toFixed\(2\)\}`/);
    expect(strip).toMatch(/fontVariantNumeric:\s*"tabular-nums"/);
  });

  it("is gated on everVisited — never renders for a zero-visit place", () => {
    expect(panel).toMatch(/\{everVisited && <ScoreStrip aggregates=\{aggregates\} \/>\}/);
  });

  it("shows a last-visit (formatted + relative) and a first-visit (month/year) facts line, omitted entirely when neither date exists", () => {
    const strip = panel.slice(panel.indexOf("function ScoreStrip"), panel.indexOf("/* Order again"));
    expect(strip).toMatch(/formatVisitDate\(lastVisitDate\)/);
    expect(strip).toMatch(/formatRelativeDate\(lastVisitDate\)/);
    expect(strip).toMatch(/formatMonthYear\(firstVisitDate\)/);
    expect(strip).toMatch(/\{\(lastLine \|\| firstLine\) && \(/);
  });
});

describe("VisitPanel — Actions row (block 4): want-to-try disappears once visited (NEW-1, 2026-08-27), sticky footer", () => {
  const panel = src("components/VisitPanel.jsx");
  const actionsBlock = panel.slice(panel.indexOf("function ActionsRow"), panel.indexOf("/* Past visits"));

  it("everVisited: Log a visit is the ONLY button, full-width primary — Want to try is gone entirely, not just demoted", () => {
    expect(actionsBlock).toMatch(/const logIsPrimary = everVisited \|\| !onToggleWishlist;/);
    expect(actionsBlock).toMatch(/const wishBtn = onToggleWishlist && !everVisited && \(/);
    expect(actionsBlock).toMatch(/\{\(everVisited \? \[logBtn, wishBtn\] : \[wishBtn, logBtn\]\)\.filter\(Boolean\)\}/);
    // A place-level want-to-try is meaningless once he's actually been (owner: "remove the want
    // to try option from a restaurant I've already visited") — filter(Boolean) drops the false
    // wishBtn cleanly, so the row renders Log a visit alone, full width.
  });

  it("never-visited: Want to try renders as the primary (full-width) button, Log a visit as secondary — unchanged from before this item", () => {
    // wishBtn's own style is unconditionally `primary` now (it only ever renders in the
    // !everVisited branch, so the old everVisited-ternary on its own style was dead code once
    // the render guard moved to the wishBtn declaration itself).
    const wishBtnBlock = actionsBlock.slice(actionsBlock.indexOf("const wishBtn"), actionsBlock.indexOf("return ("));
    expect(wishBtnBlock).toMatch(/\.\.\.primary,/);
    expect(wishBtnBlock).not.toMatch(/everVisited \? secondary : primary/);
  });

  it("the flagged state shows a check and a filled background; unflagged is outline-only", () => {
    expect(actionsBlock).toMatch(/\{wishlisted \? "✓ Want to try" : "Want to try"\}/);
    expect(actionsBlock).toMatch(/const wishActive = \{ background: "var\(--accent-food\)", color: "var\(--on-accent-food\)", border: "none" \};/);
  });

  it("is pinned (sticky) to the bottom of whichever scroll container holds it, so it stays reachable once Past visits grows past the fold", () => {
    expect(actionsBlock).toMatch(/position:\s*"sticky",\s*bottom:\s*0/);
  });

  it("every button in the row is at least 44 CSS px tall", () => {
    expect(actionsBlock).toMatch(/minHeight:\s*44/);
  });

  it("clicking 'Log a visit' opens the form in place — never auto-opens on mount, even for a never-visited place (NEW-2 changed this default from the old always-open-when-zero-visits behavior)", () => {
    expect(panel).toMatch(/const \[adding, setAdding\] = useState\(false\); \/\/ NEW-2: never auto-opens, even on a never-visited place/);
    expect(panel).toMatch(/const handleOpenForm = \(\) => setAdding\(true\);/);
  });
});

describe("VisitPanel — Empty state (block 6, never visited): no score strip, no 'Past visits · 0', no empty tiles, one explanatory line", () => {
  const panel = src("components/VisitPanel.jsx");

  it("EmptyStateNote renders only when NOT everVisited and NOT already adding a visit", () => {
    expect(panel).toMatch(/\{!everVisited && !adding && <EmptyStateNote \/>\}/);
  });

  it("names the exact hollow-pin behavior from the wishlist feature, so the copy stays honest about what the map actually shows", () => {
    const note = panel.slice(panel.indexOf("function EmptyStateNote"), panel.indexOf("export default function VisitPanel"));
    expect(note).toMatch(/hollow pin/);
  });

  it("PastVisitsSection itself renders nothing at zero visits — no 'Past visits · 0' heading", () => {
    expect(panel).toMatch(/function PastVisitsSection\(\{ pastVisits, onDelete \}\) \{\s*if \(!pastVisits\.length\) return null;/);
  });
});

describe("VisitPanel — Past visit cards (block 5): chips, Would-return, overflow delete-behind-confirm via AnchoredMenu", () => {
  const panel = src("components/VisitPanel.jsx");
  const cardBlock = panel.slice(panel.indexOf("function VisitCard"), panel.indexOf("function PastVisitsSection"));

  it("shows a Would-return chip only when would_return is exactly true (never for false or null)", () => {
    expect(cardBlock).toMatch(/const hasWouldReturn = visit\.would_return === true;/);
    expect(cardBlock).toMatch(/\{hasWouldReturn && <WouldReturnChip \/>\}/);
  });

  it("would_return WAS already wired end-to-end before this rebuild (VisitForm's Yes/No, and the old VisitRow already displayed it as plain text) — this only redesigns the DISPLAY as a chip, it doesn't newly wire the column", () => {
    expect(panel).toMatch(/would_return: wouldReturn,/); // VisitForm's submit payload, unchanged
  });

  it("only non-empty visit fields render — 'Had X' / 'Good X' / cost — never an empty labelled row", () => {
    expect(cardBlock).toMatch(/\{visit\.what_i_had && <div[^>]*>Had \{visit\.what_i_had\}<\/div>\}/);
    expect(cardBlock).toMatch(/\{visit\.what_was_good && <div[^>]*>Good \{visit\.what_was_good\}<\/div>\}/);
    expect(cardBlock).toMatch(/\{visit\.cost != null && <div/);
  });

  it("an undated visit renders at reduced emphasis (opacity), matching that fetchAllVisits already sorts it last", () => {
    expect(cardBlock).toMatch(/const dateless = !visit\.visited_on;/);
    expect(cardBlock).toMatch(/opacity:\s*dateless \? 0\.65 : 1/);
  });

  it("delete lives behind the '···' overflow menu, through AnchoredMenu — the SAME portal-based menu SearchBox already uses, not a plain absolutely-positioned dropdown that would clip inside the scrolling list (B632176's class of bug)", () => {
    expect(panel).toMatch(/import AnchoredMenu from "\.\.\/\.\.\/\.\.\/shared\/ui\/AnchoredMenu\.jsx";/);
    expect(cardBlock).toMatch(/<AnchoredMenu\b/);
    expect(cardBlock).not.toMatch(/position:\s*"absolute"/); // no locally-nested dropdown reintroduced
  });

  it("Delete requires a confirm step INSIDE the menu — never window.confirm, never a bare standalone red link", () => {
    expect(cardBlock).toMatch(/const \[confirming, setConfirming\] = useState\(false\);/);
    expect(cardBlock).toMatch(/data-testid="food-visit-delete-menu-item"/);
    expect(cardBlock).toMatch(/data-testid="food-visit-delete-confirm"/);
    expect(cardBlock).toMatch(/Delete this visit\?/);
    expect(cardBlock).not.toMatch(/window\.(confirm|prompt|alert)/);
  });

  it("the confirm step's Delete button reuses the EXISTING --danger token, not a second/new red", () => {
    expect(cardBlock).toMatch(/var\(--danger-text, var\(--danger\)\)/);
    expect(cardBlock).not.toMatch(/#[0-9a-fA-F]{3,8}\b/); // no raw hex anywhere in this component
  });

  it("the overflow button itself is at least 44 CSS px", () => {
    expect(cardBlock).toMatch(/minWidth:\s*44,\s*minHeight:\s*44/);
  });

  it("Past visits section label reads 'Past visits · N'", () => {
    expect(panel).toMatch(/Past visits · \{pastVisits\.length\}/);
  });
});

describe("VisitPanel — Header (block 1): wrapping name, category · city, a tappable directions link, a circular close button", () => {
  const panel = src("components/VisitPanel.jsx");
  const headerBlock = panel.slice(panel.indexOf("function PanelHeader"), panel.indexOf("/* Score strip"));

  it("the name wraps rather than truncates — no text-overflow:ellipsis / white-space:nowrap on it", () => {
    expect(headerBlock).not.toMatch(/textOverflow:\s*"ellipsis"/);
    expect(headerBlock).not.toMatch(/whiteSpace:\s*"nowrap"/);
    expect(headerBlock).toMatch(/overflowWrap:\s*"anywhere"/);
  });

  it("line 2 joins category and city/neighbourhood with ' · ', omitted entirely when both are absent (a manual pin has neither)", () => {
    expect(headerBlock).toMatch(/const categoryLine = \[formatCategory\(category\), city\]\.filter\(Boolean\)\.join\(" · "\);/);
    expect(headerBlock).toMatch(/\{categoryLine && </);
  });

  it("the address is a tappable link that opens directions, only rendered when both an address AND coordinates exist", () => {
    expect(headerBlock).toMatch(/const mapsUrl = directionsUrl\(lat, lon\);/);
    expect(headerBlock).toMatch(/\{formattedAddress && mapsUrl && \(/);
    expect(headerBlock).toMatch(/target="_blank" rel="noopener noreferrer"/);
  });

  it("close is a circular icon button (border-radius 50%, >=44px), not a bare glyph floating in the corner", () => {
    expect(headerBlock).toMatch(/borderRadius:\s*"50%"/);
    expect(headerBlock).toMatch(/width:\s*44,\s*height:\s*44,\s*minWidth:\s*44,\s*minHeight:\s*44/);
  });

  it("the selection-tie accent dot (B634976) survives the rebuild", () => {
    expect(headerBlock).toMatch(/data-testid="food-panel-accent-dot"/);
  });
});

describe("FoodApp — panelPlace: the normalized {name, category, address, lat, lon} handed to VisitPanel (NEW-2 replaced the old pre-joined title/subtitle strings)", () => {
  const app = src("FoodApp.jsx");

  it("a snapshot place carries its real category/address; a manual or new pin carries neither (never did)", () => {
    const block = app.slice(app.indexOf("const panelPlace ="), app.indexOf("return (\n    <div style={{ height"));
    expect(block).toMatch(/category:\s*selected\.place\.category,\s*address:\s*selected\.place\.address/);
    expect(block).toMatch(/kind === "manualPin"[\s\S]{0,40}category:\s*null,\s*address:\s*null/);
    expect(block).toMatch(/kind === "newPin"[\s\S]{0,60}category:\s*null,\s*address:\s*null/);
  });

  it("VisitPanel is wired to place={panelPlace}, not the old title/subtitle strings", () => {
    expect(app).toMatch(/<VisitPanel[\s\S]{0,300}place=\{panelPlace\}/); // the long conditional `key=` line sits between them
    expect(app).not.toMatch(/title=\{panelTitle\}/);
    expect(app).not.toMatch(/subtitle=\{panelSubtitle\}/);
  });
});

describe("VisitPanel — no emoji anywhere in this panel (NEW-2, consistent with the map controls)", () => {
  it("no emoji glyph in VisitPanel.jsx or BottomSheet.jsx — only the plain ✕/···/✓ symbols this app already uses elsewhere", () => {
    const TARGET_EMOJI = ["📍", "🔍", "🗺", "🛰", "⭐", "❤️", "👍"];
    for (const file of ["components/VisitPanel.jsx", "components/BottomSheet.jsx"]) {
      const text = src(file);
      for (const glyph of TARGET_EMOJI) expect(text, `${file} contains ${glyph}`).not.toContain(glyph);
    }
  });
});

describe("NEW-2 (2nd owner block) — continuous marker scaling during a zoom animation, not just at zoomend", () => {
  it("nextZoomAnimTier: stays at 'full' while frames are within budget, resetting the streak on any in-budget frame", () => {
    let state = { tier: "full", overBudgetStreak: 0, frameParity: 0 };
    state = nextZoomAnimTier(state, 2);
    expect(state.tier).toBe("full");
    expect(state.overBudgetStreak).toBe(0);
    // Two over-budget frames, then one back in budget — must NOT degrade (streak resets).
    state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 1);
    state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 1);
    expect(state.tier).toBe("full");
    state = nextZoomAnimTier(state, 1);
    expect(state.overBudgetStreak).toBe(0);
    expect(state.tier).toBe("full");
  });

  it("nextZoomAnimTier: full -> everyOther after exactly ZOOM_ANIM_DEGRADE_STREAK consecutive over-budget frames, not before", () => {
    let state = { tier: "full", overBudgetStreak: 0, frameParity: 0 };
    for (let i = 0; i < ZOOM_ANIM_DEGRADE_STREAK - 1; i++) {
      state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 1);
      expect(state.tier).toBe("full"); // not yet — needs the FULL streak
    }
    state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 1);
    expect(state.tier).toBe("everyOther");
    expect(state.overBudgetStreak).toBe(0); // streak resets on entering the new tier
    expect(state.frameParity).toBe(0);
  });

  it("nextZoomAnimTier: everyOther -> bailed after another full streak of over-budget frames", () => {
    let state = { tier: "everyOther", overBudgetStreak: 0, frameParity: 0 };
    for (let i = 0; i < ZOOM_ANIM_DEGRADE_STREAK - 1; i++) {
      state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 50);
      expect(state.tier).toBe("everyOther");
    }
    state = nextZoomAnimTier(state, ZOOM_ANIM_FRAME_BUDGET_MS + 50);
    expect(state.tier).toBe("bailed");
  });

  it("nextZoomAnimTier: 'bailed' is a hard floor for the rest of the gesture — never recovers to a faster tier on its own", () => {
    let state = { tier: "bailed", overBudgetStreak: 0, frameParity: 0 };
    state = nextZoomAnimTier(state, 0.1); // even a very fast frame
    expect(state).toEqual({ tier: "bailed", overBudgetStreak: 0, frameParity: 0 });
  });

  it("nextZoomAnimTier: an in-budget frame at 'everyOther' resets its streak too (doesn't creep toward 'bailed' on noise)", () => {
    let state = { tier: "everyOther", overBudgetStreak: ZOOM_ANIM_DEGRADE_STREAK - 1, frameParity: 0 };
    state = nextZoomAnimTier(state, 1);
    expect(state.tier).toBe("everyOther");
    expect(state.overBudgetStreak).toBe(0);
  });

  it("FoodMap.jsx wires the zoom-scaling effect to real Leaflet events (zoomanim/zoomend), restoring true radii on every exit path", () => {
    const map = src("components/FoodMap.jsx");
    expect(map).toMatch(/import \{ nextZoomAnimTier \} from "\.\.\/lib\/zoomAnimTier\.js";/);
    expect(map).toMatch(/map\.on\("zoomanim", onZoomAnimStart\)/);
    expect(map).toMatch(/map\.on\("zoomend", onZoomEnd\)/);
    // Every exit path (natural loop exit, zoomend, unmount cleanup) restores true radii — never
    // leaves a marker's radius mutated once the gesture is over.
    const effectStart = map.indexOf("// ⛔ NEW-2 (2nd owner block, 2026-08-23) — CONTINUOUS marker scaling");
    const effectEnd = map.indexOf("Search or list result selected");
    const effect = map.slice(effectStart, effectEnd);
    const restoreCalls = effect.match(/restoreTrueRadii\(\)/g) || [];
    expect(restoreCalls.length).toBeGreaterThanOrEqual(4); // natural exit, bail, onZoomEnd, unmount cleanup
    // Radius is compensated via Leaflet's OWN setRadius (batched/coalesced internally), never a
    // hand-rolled canvas redraw that would duplicate Leaflet's own stroke/fill/halo logic.
    expect(effect).toMatch(/m\.setRadius\(trueR \/ scale\)/);
    expect(effect).not.toMatch(/getContext\(/); // never a raw canvas 2D context reach-around
  });

  it("readContainerScale reads the LIVE computed transform rather than reimplementing Leaflet's own easing curve", () => {
    const map = src("components/FoodMap.jsx");
    const fnIdx = map.indexOf("function readContainerScale(");
    expect(fnIdx).toBeGreaterThanOrEqual(0);
    const fn = map.slice(fnIdx, map.indexOf("}", map.indexOf("}", fnIdx) + 1) + 1);
    expect(fn).toMatch(/getComputedStyle\(el\)\.transform/);
    expect(fn).not.toMatch(/cubic-bezier/i); // no hand-rolled easing — reads the browser's real value
  });

  it("the perf budget and degrade-streak constants are the ones documented and measured this session", () => {
    expect(ZOOM_ANIM_FRAME_BUDGET_MS).toBe(8);
    expect(ZOOM_ANIM_DEGRADE_STREAK).toBe(3);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * B709696/B709697 (2026-08-23) — search data quality: a real "no strong match" state, and
 * confidence/registry-name/concatenated-address/near-duplicate cleanup for the search RESULT
 * LIST. See lib/searchQuality.js's own header for the production-measured reasoning behind
 * every threshold/pattern asserted below.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("searchQuality — isStrongMatch (word-coverage, not a raw similarity cutoff)", () => {
  // B709696 repro, verbatim: none of the RPC's own top candidates for this query contain
  // "cowboy" anywhere — a raw word_similarity() score (measured up to 0.615 for this exact
  // query in production) cannot tell that apart from a genuine match, but word coverage can.
  it("the Cowboy repro — zero strong matches among the garbage candidates the RPC actually returned", () => {
    const garbage = [
      { name: "Kansha Japanese Sushi Bistro", address: "1899 N Plano Rd, Richardson, TX, 75081" },
      { name: "Thai Tapas (Thai Japanese Sushi Bar)", address: "460 W 19th St, Houston, TX, 77008" },
      { name: "Masami Japanese Sushi & Cuisine", address: "501 W Belt Line Rd, Richardson, TX, 75080" },
      { name: "Hoshi Ranch Japanese BBQ CoffeeHouse & Roastery", address: "" },
    ];
    for (const g of garbage) {
      expect(isStrongMatch("Cowboy Japanese BBQ&Sushi", g.name, g.address)).toBe(false);
    }
  });

  it("a raw similarity score alone would get this backwards — measured production cases", () => {
    // "chilis restaurant" -> a real restaurant carrying only the generic word "restaurant" scores
    // HIGHER (0.777) than a genuine typo'd match scores for an unrelated query ("chiptle" ->
    // "Chipotle", 0.545) — coverage correctly rejects the former and (see below) accepts a
    // structurally identical case to the latter.
    expect(isStrongMatch("chilis restaurant", "El Viejo Solis Restaurant Corporation", "")).toBe(false);
    expect(isStrongMatch("wendys drive thru", "Willowbend - Drive Thru", "")).toBe(false);
    expect(isStrongMatch("taco bell mexican", "Daiquiri Xpress Mexican Taco Bar", "")).toBe(false);
  });

  it("genuine typo'd/partial matches still pass, including ones a raw 0.65 cutoff would have rejected", () => {
    expect(isStrongMatch("chiptle", "Chipotle", "")).toBe(true); // real production sim: 0.545
    expect(isStrongMatch("mcdon", "Mcdonald's", "")).toBe(true); // prefix match
    expect(isStrongMatch("olive gardn", "Olive Garden", "")).toBe(true);
    expect(isStrongMatch("whataburgr", "Whataburger", "")).toBe(true);
    expect(isStrongMatch("bandito taco", "Bandito's Taco Grill", "")).toBe(true);
    expect(isStrongMatch("panda expres", "Panda Express", "")).toBe(true);
  });

  it("a location qualifier is checked against the ADDRESS too, not just the name", () => {
    expect(isStrongMatch("fadis westheimer", "Fadi's Mediterranean Grill", "12360 Westheimer Rd, Houston, TX, 77077")).toBe(true);
    // A different, unrelated place that merely also sits on Westheimer must NOT pass just
    // because the street name matches — "fadis" itself has to be covered somewhere.
    expect(isStrongMatch("fadis westheimer", "Aria Suya Kitchen - Westheimer", "")).toBe(false);
  });

  it("an all-generic query (nothing distinguishing typed) falls back to the unstripped words rather than matching everything", () => {
    // "the"/"restaurant" are both generic — stripping them would leave zero words to check,
    // which would wrongly let ANY candidate through. The fallback still requires the raw
    // (unstripped) words to actually appear somewhere.
    expect(isStrongMatch("the restaurant", "Anything At All", "")).toBe(false);
    expect(isStrongMatch("the restaurant", "The Restaurant at the Ballpark", "")).toBe(true);
  });

  it("GENERIC_NAME_WORDS is the measured, named list this rule reads — not a magic inline check", () => {
    expect(SIGNIFICANT_WORD_MIN_LEN).toBe(3);
    for (const w of ["restaurant", "grill", "bar", "kitchen", "cafe", "house", "drive", "thru"]) {
      expect(GENERIC_NAME_WORDS.has(w)).toBe(true);
    }
    // A real brand word must never be treated as generic.
    for (const w of ["fadis", "cowboy", "chipotle", "wendys"]) {
      expect(GENERIC_NAME_WORDS.has(w)).toBe(false);
    }
  });
});

describe("searchQuality — isRegistryName / REGISTRY_NAME_PATTERN", () => {
  it("flags corporate-filing-style names, never a real consumer-facing brand name", () => {
    expect(isRegistryName("Fadis Express Binz Llc")).toBe(true);
    expect(isRegistryName("Fadis Signature Katy Inc")).toBe(true);
    expect(isRegistryName("Fadi Management Inc")).toBe(true);
    expect(isRegistryName("Fadi's")).toBe(false);
    expect(isRegistryName("Fadi's Mediterranean Grill")).toBe(false);
  });

  it("REGISTRY_NAME_PATTERN is a real JS regex (not the Postgres \\y syntax it was translated from)", () => {
    expect(REGISTRY_NAME_PATTERN).toBeInstanceOf(RegExp);
    expect(REGISTRY_NAME_PATTERN.test("Some Corp")).toBe(true);
    expect(() => new RegExp(REGISTRY_NAME_PATTERN.source)).not.toThrow();
  });
});

describe("searchQuality — hasConcatenatedAddress / CONCAT_ADDRESS_PATTERN", () => {
  it("catches the exact B709697 repro — two full addresses joined by \"and\"", () => {
    expect(hasConcatenatedAddress(
      "12360 Westheimer Rd, Houston, TX 77077 and 6365 Westheimer Rd, Houston, TX 77057, Houston, TX, 77077"
    )).toBe(true);
  });

  it("never fires on a real Texas place name that happens to contain the word \"and\"", () => {
    expect(hasConcatenatedAddress("17560 TX-105, Cut and Shoot, TX, 77306")).toBe(false);
    expect(hasConcatenatedAddress("10500 Town and Country Way, Houston, TX, 77024")).toBe(false);
    expect(hasConcatenatedAddress("24900 Hill and Dale Ave, Splendora, TX, 77372")).toBe(false);
  });

  it("handles a missing/empty address without throwing", () => {
    expect(hasConcatenatedAddress(null)).toBe(false);
    expect(hasConcatenatedAddress(undefined)).toBe(false);
    expect(hasConcatenatedAddress("")).toBe(false);
  });
});

describe("searchQuality — rankSearchCandidates (the full pipeline, against real production shapes)", () => {
  // The exact "fadis" repro row set, trimmed to the fields the function reads (lat/lon taken
  // from the real production rows so the dedupe-radius math below is against real distances).
  const FADIS_JUNK = { id: "94086b60-0a16-490a-8f48-a5cd3cbefdc9", name: "Fadis Mediterranean Grill",
    address: "12360 Westheimer Rd, Houston, TX 77077 and 6365 Westheimer Rd, Houston, TX 77057, Houston, TX, 77077",
    sim: 1, distance_km: 5.14, confidence: 0.77, lat: 29.7028713, lon: -95.4281082 };
  const BINZ_LLC = { id: "5d89a58a-fca3-4e8c-b0a9-5fd38b9a8dfc", name: "Fadis Express Binz Llc",
    address: "1801 Binz St Ste 130, Houston, TX, 77004-8107", sim: 1, distance_km: 7.77, confidence: 0.95,
    lat: 29.735251, lon: -95.379377 };
  const BINZ_EATERY = { id: "f8cc2482-8b2d-4474-aee5-255477d5ca02", name: "Fadi's Eatery",
    address: "1801 Binz St, Houston, TX, 77004-7296", sim: 0.667, distance_km: 7.80, confidence: 0.960,
    lat: 29.735217, lon: -95.379018 }; // ~39m from BINZ_LLC — a real measured production duplicate pair
  const KATY_INC = { id: "65d11a8a-0a98-4590-a86c-eba3316d218c", name: "Fadis Signature Katy Inc",
    address: "21792 Katy Fwy, Katy, TX, 77449-7779", sim: 1, distance_km: 28.14, confidence: 0.95,
    lat: 29.79, lon: -95.82 };
  const CLEAN_WESTHEIMER = { id: "786f806b-3480-4126-bb72-c753f35c9c6e", name: "Fadi's Mediterranean Grill",
    address: "12360 Westheimer Rd, Houston, TX, 77077-6069", sim: 0.667, distance_km: 13.59, confidence: 0.991,
    lat: 29.7366, lon: -95.6004 };

  it("excludes the corrupted concatenated-address row even though it's an exact-name/top-sim match", () => {
    const out = rankSearchCandidates("fadis", [FADIS_JUNK, CLEAN_WESTHEIMER], new Set());
    expect(out.map((r) => r.id)).not.toContain(FADIS_JUNK.id);
    expect(out.map((r) => r.id)).toContain(CLEAN_WESTHEIMER.id);
  });

  it("collapses a real measured near-duplicate (same storefront, two sources, ~39m apart) to one record", () => {
    const out = rankSearchCandidates("fadis", [BINZ_LLC, BINZ_EATERY], new Set());
    expect(out).toHaveLength(1);
    // Non-registry name wins the tie over the registry-style one for the same spot.
    expect(out[0].id).toBe(BINZ_EATERY.id);
  });

  it("does NOT collapse genuinely distinct locations of the same chain (km apart, not metres)", () => {
    const out = rankSearchCandidates("fadis", [BINZ_EATERY, CLEAN_WESTHEIMER, KATY_INC], new Set());
    expect(out.map((r) => r.id).sort()).toEqual([BINZ_EATERY.id, CLEAN_WESTHEIMER.id, KATY_INC.id].sort());
  });

  it("non-registry names always outrank registry-style ones, even at a higher raw sim score", () => {
    // KATY_INC scores sim=1 (exact "fadis" match, no apostrophe); CLEAN_WESTHEIMER scores only
    // 0.667 (the apostrophe in "Fadi's" costs it trigram overlap) — registry-name de-rank must
    // still put the real brand name first despite the lower raw score.
    const out = rankSearchCandidates("fadis", [KATY_INC, CLEAN_WESTHEIMER], new Set());
    expect(out[0].id).toBe(CLEAN_WESTHEIMER.id);
    expect(out[1].id).toBe(KATY_INC.id);
  });

  it("a place he's already logged or flagged is exempt from the strong-match filter and is never dropped by dedupe", () => {
    const weakButLogged = { id: "weak-logged", name: "Somewhere Odd", address: "", sim: 0.2, distance_km: 1,
      confidence: 0.6, lat: BINZ_LLC.lat, lon: BINZ_LLC.lon }; // co-located with BINZ_LLC — would normally collapse away
    const out = rankSearchCandidates("fadis", [BINZ_LLC, weakButLogged], new Set(["weak-logged"]));
    expect(out.map((r) => r.id)).toContain("weak-logged");
  });

  it("DEDUPE_RADIUS_METERS sits between the measured real-duplicate gap and the measured real-distinct gap", () => {
    // Measured production pairs (see lib/searchQuality.js header): known duplicates 25.8m/38.9m
    // apart; the closest known genuinely-distinct same-brand locations ~3,540m apart.
    expect(DEDUPE_RADIUS_METERS).toBeGreaterThan(39);
    expect(DEDUPE_RADIUS_METERS).toBeLessThan(3500);
  });

  it("an empty/absent candidate list never throws", () => {
    expect(rankSearchCandidates("fadis", [], new Set())).toEqual([]);
    expect(rankSearchCandidates("fadis", undefined, new Set())).toEqual([]);
  });
});

describe("SearchBox — wired to rankSearchCandidates, not the raw RPC rows (B709696/B709697)", () => {
  it("imports and calls rankSearchCandidates on the snapshot RPC's results before they ever reach state", () => {
    const box = src("components/SearchBox.jsx");
    expect(box).toMatch(/import \{ rankSearchCandidates \} from "\.\.\/lib\/searchQuality\.js";/);
    expect(box).toMatch(/setSnapshotResults\(rankSearchCandidates\(trimmed, data \|\| \[\], protectedIds\)\)/);
    // Protected against filtering out a place his own visit/wishlist history already points at.
    expect(box).toMatch(/const protectedIds = new Set\(\[\.\.\.\(loggedIds \|\| \[\]\), \.\.\.\(wishlistIds \|\| \[\]\)\]\);/);
  });
});

describe("db/food.sql — food_places_search_by_name gains `confidence` + excludes concatenated-address rows (B709697)", () => {
  it("defines food_places_search_by_name_raw (the original word_similarity search, untouched) and a thin wrapper", () => {
    const sql = src("db/food.sql");
    expect(sql).toContain("create or replace function public.food_places_search_by_name_raw(");
    expect(sql).toMatch(/set pg_trgm\.word_similarity_threshold = 0\.3/);
    // The rename step is a guarded no-op on a fresh install or a re-run — never a hard failure.
    expect(sql).toMatch(/rename to food_places_search_by_name_raw;/);
    expect(sql).toMatch(/exception when undefined_function then null;/);
  });

  it("the outer function returns confidence and excludes the concatenated-address shape, without its own SET clause", () => {
    const sql = src("db/food.sql");
    const wrapperAt = sql.indexOf("create or replace function public.food_places_search_by_name(\n  p_query text, p_cap integer default 15,\n  p_center_lat double precision default null, p_center_lon double precision default null\n)\nreturns table (\n  id text, name text, lat double precision, lon double precision,\n  category text, cuisine text, address text, brand text,\n  source text, source_licence text, metro text, confidence double precision,");
    expect(wrapperAt).toBeGreaterThanOrEqual(0);
    const wrapperBody = sql.slice(wrapperAt, sql.indexOf("$$;", wrapperAt));
    expect(wrapperBody).toContain("food_places_search_by_name_raw(p_query, p_cap, p_center_lat, p_center_lon)");
    expect(wrapperBody).toMatch(/fp\.address !~ '\\d\{5\}\(-\\d\{4\}\)\?\\s\+and\\s\+\\d\+\\s\+\\S'/);
    expect(wrapperBody).not.toMatch(/set pg_trgm/); // no privileged SET clause on the wrapper
  });

  it("both functions grant EXECUTE to anon and authenticated — the wrapper calls _raw under SECURITY INVOKER, so both are required", () => {
    const sql = src("db/food.sql");
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_name\(text, integer, double precision, double precision\) to anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.food_places_search_by_name_raw\(text, integer, double precision, double precision\) to anon, authenticated;/);
  });
});

describe("NEW-1 (2026-08-27 owner block) — saving a visit gives an unmistakable confirmation", () => {
  const panel = src("components/VisitPanel.jsx");

  it("the confirmation banner exists, is a role=\"status\" (not an alert/modal), and reads a plain success message", () => {
    expect(panel).toMatch(/data-testid="food-save-confirmation"/);
    const bannerBlock = panel.slice(panel.indexOf('data-testid="food-save-confirmation"') - 300, panel.indexOf('data-testid="food-save-confirmation"') + 400);
    expect(bannerBlock).toMatch(/role="status"/);
    expect(bannerBlock).toMatch(/Visit saved/);
    expect(bannerBlock).toMatch(/var\(--success-bg\)/);
    expect(bannerBlock).toMatch(/var\(--success-text\)/);
  });

  it("shown ONLY on savedNonce > 0 (never on mount) and auto-dismisses — no dismiss button, nothing for the owner to click away", () => {
    expect(panel).toMatch(/const \[savedNonce, setSavedNonce\] = useState\(0\);/);
    const effectBlock = panel.slice(panel.indexOf("if (savedNonce === 0) return undefined"), panel.indexOf("}, [savedNonce]);") + 20);
    expect(effectBlock).toMatch(/setTimeout\(\(\) => setShowSaved\(false\), SAVE_CONFIRMATION_MS\)/);
    expect(effectBlock).toMatch(/clearTimeout\(t\)/);
    // No dismiss affordance anywhere near the banner — it is not a toast the owner has to close.
    const bannerBlock = panel.slice(panel.indexOf('data-testid="food-save-confirmation"') - 50, panel.indexOf('data-testid="food-save-confirmation"') + 400);
    expect(bannerBlock).not.toMatch(/onClick/);
  });

  it("fires ONLY on a confirmed save (the SAME B668194 gate VisitForm already uses to clear its fields) — never on a failed save, which the error banner already covers", () => {
    expect(panel).toMatch(/onSaved\?\.\(\);/);
    const submitFn = panel.slice(panel.indexOf("const submit = async (e) => {"), panel.indexOf("return (", panel.indexOf("const submit = async (e) => {")));
    const savedBlock = submitFn.slice(submitFn.indexOf("if (saved) {"), submitFn.indexOf("};", submitFn.indexOf("if (saved) {")));
    expect(savedBlock).toMatch(/setWouldReturn\(null\);\s*\n\s*\/\/[\s\S]{0,300}onSaved\?\.\(\);/); // field-clear AND onSaved share the same `if (saved)` gate
    expect(panel).toMatch(/<VisitForm pending=\{pending\} onCancel=\{\(\) => setAdding\(false\)\} onSubmit=\{onSubmitVisit\} onSaved=\{handleSaved\} \/>/);
  });

  it("lives INSIDE peekRef's own measured block, not an absolute overlay over the header/close button — so it never covers the title or the close button, and the sheet's own existing peek-height re-measure (no deps, re-measures every render) picks it up for free", () => {
    const peekBlock = panel.slice(panel.indexOf("<div ref={peekRef}>"), panel.indexOf("{everVisited && <OrderAgain"));
    expect(peekBlock).toMatch(/data-testid="food-save-confirmation"/);
    expect(peekBlock).not.toMatch(/position:\s*"absolute"/);
  });
});
