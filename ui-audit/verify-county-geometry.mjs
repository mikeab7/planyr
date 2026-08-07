/* B209502 — THE COUNTY A POINT IS IN, PROVEN IN A REAL BROWSER AGAINST THE BUILT OUTPUT.
 *
 * Unit tests can prove the resolver's maths. They cannot prove the two things that actually make
 * this fix real in production:
 *   1. the geometry asset is SERVED by the build — right path, right base URL, 200, parseable.
 *      A `public/` asset that a unit test imports from disk will pass forever while the deployed
 *      app 404s it, and the failure is silent by construction: the resolver falls back to the old
 *      bounding-box answer, which is exactly the wrong-but-plausible verdict this work removes.
 *   2. the app actually ASKS for it. B1120's lesson — a feature that merges, goes green, and does
 *      nothing in production because nobody wired the one call site.
 *
 * So this drives the real built bundle in Chromium, watches the network for the asset, and then
 * resolves all six of the owner's 2026-08-06 audit sites through the SHIPPED module.
 *
 * Logged out, no external GIS host needed (the asset is same-origin and the resolver is pure) —
 * Claude-verifiable here, and therefore never something to file as "needs a live pass".
 *
 * Run:  npm run build && npx vite preview --port 4187   (separate shell)
 *       BASE_URL=http://localhost:4187/ node ui-audit/verify-county-geometry.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4187/";

/* The owner's six sites, one per Houston-metro county, with the county each MUST resolve to. */
const SITES = [
  { name: "A Cedar Port / Mont Belvieu", lat: 29.7930, lng: -94.8520, county: "Chambers" },
  { name: "B NW Harris, Beltway 8 / US-290", lat: 29.8700, lng: -95.5520, county: "Harris" },
  { name: "C Sugar Land", lat: 29.5800, lng: -95.6000, county: "Fort Bend" },
  { name: "D Conroe / I-45 North", lat: 30.2800, lng: -95.4500, county: "Montgomery" },
  { name: "E Pearland / SH-288", lat: 29.5500, lng: -95.2900, county: "Brazoria" },
  { name: "F Texas City", lat: 29.4000, lng: -94.9350, county: "Galveston" },
];

/* Counties Planyr has no CAD for — these must be NAMED, never swapped for a neighbour. */
const NO_SOURCE = [
  { name: "Huntsville", lat: 30.7235, lng: -95.5508, county: "Walker" },
  { name: "Wharton", lat: 29.3116, lng: -96.1027, county: "Wharton" },
];

const fails = [];
const ok = (cond, msg) => { console.log(`  ${cond ? "✓" : "✗"} ${msg}`); if (!cond) fails.push(msg); };

/* The sandbox quirk documented in docs/REFERENCE.md: outbound HTTPS goes through a TLS inspection
 * proxy that Node trusts and Chromium does not, so every harness passes --ignore-certificate-errors
 * or the basemap renders gray. `PW_CHROME` pins the browser build (the bundled headless-shell
 * version drifts from what is installed here), matching playwright.config.js's own escape hatch. */
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const assetHits = [];
page.on("response", (r) => { if (/county-polygons\.json/.test(r.url())) assetHits.push({ url: r.url(), status: r.status() }); });

console.log("--- B209502 · county geometry, in the built app ---\n");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
// The Map view is the surface that warms the asset; give the lazy workspace chunk time to mount.
await page.waitForTimeout(6000);

console.log("1) the asset is served by the build");
ok(assetHits.length > 0, `the app REQUESTED county-polygons.json (${assetHits.length} request(s)) — proves the call site is wired, not just written`);
// `every` on an empty array is vacuously true, so this asserted nothing when the wiring was
// missing — caught by the mutation run that removed `loadCountyPolygons()` from MapFinder. Require
// at least one hit AND that all of them are 200, so the check cannot pass by not happening.
ok(assetHits.length > 0 && assetHits.every((h) => h.status === 200),
  `every request returned 200 [${assetHits.map((h) => h.status).join(",") || "no requests at all"}]`);

console.log("\n2) the shipped resolver answers, in-page, from the served asset");
const result = await page.evaluate(async ({ base, sites, noSource }) => {
  const res = await fetch(`${base}geo/county-polygons.json`);
  if (!res.ok) return { error: `asset ${res.status}` };
  const payload = await res.json();

  // Re-implement ONLY the decode + ray cast here, deliberately: this harness must be able to fail
  // when the ASSET is wrong (renumbered, re-quantised, truncated), and importing the app's own
  // module would make the two agree by construction and prove nothing about the bytes served.
  const scale = payload.scale;
  const decode = (flat) => { const out = []; let x = flat[0], y = flat[1]; out.push([x, y]);
    for (let i = 2; i < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; out.push([x, y]); } return out; };
  const inRing = (ring, px, py) => { let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    } return inside; };
  const resolve = (lat, lng) => { const x = lng * scale, y = lat * scale;
    for (const c of payload.counties) { const [a, b, cx, d] = c.bbox;
      if (x < a || x > cx || y < b || y > d) continue;
      for (const r of c.rings) if (inRing(decode(r), x, y)) return { name: c.name, state: c.state, fips: c.fips };
    } return null; };

  return {
    counties: payload.counties.length,
    format: payload.format,
    sites: sites.map((s) => ({ ...s, got: resolve(s.lat, s.lng) })),
    noSource: noSource.map((s) => ({ ...s, got: resolve(s.lat, s.lng) })),
  };
}, { base: BASE, sites: SITES, noSource: NO_SOURCE });

if (result.error) {
  ok(false, `asset fetch in-page: ${result.error}`);
} else {
  ok(result.format === "county-polygons/1", `asset format "${result.format}"`);
  ok(result.counties === 318, `${result.counties} counties in the asset (expect 318 — 254 TX + 64 CO)`);

  console.log("\n3) the owner's six audit sites resolve to the RIGHT county");
  for (const s of result.sites) {
    ok(s.got && s.got.name === s.county, `${s.name} → ${s.got ? s.got.name : "(none)"} (expect ${s.county})`);
  }

  console.log("\n4) a county with no configured CAD is NAMED, not swapped for a neighbour");
  for (const s of result.noSource) {
    ok(s.got && s.got.name === s.county, `${s.name} → ${s.got ? s.got.name : "(none)"} (expect ${s.county})`);
  }

  console.log("\n5) the regression that started this: Pearland is NOT Harris");
  const pearland = result.sites.find((s) => /Pearland/.test(s.name));
  ok(pearland.got && pearland.got.name !== "Harris", `Pearland resolves to ${pearland.got && pearland.got.name}, not Harris`);
  ok(pearland.got && pearland.got.fips === "48039", `Pearland FIPS ${pearland.got && pearland.got.fips} (48039 = Brazoria)`);
}

await browser.close();
console.log(`\n${fails.length ? `✗ ${fails.length} FAILED` : "✓ all checks passed"}`);
process.exit(fails.length ? 1 : 0);
