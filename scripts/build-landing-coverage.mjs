#!/usr/bin/env node
/* Generate the landing page's coverage claims FROM THE APP'S OWN SOURCES.
 *
 * WHY THIS EXISTS. The marketing page shipped claiming "Harris · Fort Bend · Chambers"
 * long after Waller (B629) and nine Colorado counties (PR #848) went live — it undersold
 * the product by roughly four to one, and the Texas-only state-plane footer was simply
 * wrong once Colorado's two zones shipped. Hand-maintained coverage copy goes stale the
 * day a county lands, because nobody remembers a static HTML file in public/ when they
 * add an endpoint. So the copy is DERIVED: this script reads the same two modules the app
 * reads at runtime —
 *     src/workspaces/site-planner/lib/counties.js   (COUNTIES — the live parcel sources)
 *     src/shared/coordinates/statePlane.js          (zoneForCounty — the project grid)
 * — and rewrites three marked regions in public/landing/index.html.
 *
 * The landing page is a standalone static file with no build step, so it cannot import
 * from src/ at runtime; generate-and-commit + a CI drift check is the same pattern this
 * repo already uses for MAP.md and BACKLOG_OPEN.md.
 *
 * Run:  node scripts/build-landing-coverage.mjs            (rewrite)
 *       node scripts/build-landing-coverage.mjs --check    (fail on drift — CI)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "public/landing/index.html");

const { COUNTIES } = await import(
  new URL("../src/workspaces/site-planner/lib/counties.js", import.meta.url).href
);
const { zoneForCounty } = await import(
  new URL("../src/shared/coordinates/statePlane.js", import.meta.url).href
);

/* A county's marketing name, derived from its registry label so a new county needs no
 * edit here: "Harris County · HCAD" → Harris, "City & County of Denver, CO" → Denver. */
function displayName(label) {
  return String(label)
    .split(" · ")[0]
    .replace(/,\s*(TX|CO)$/i, "")
    .replace(/^City\s*&\s*County of\s+/i, "")
    .replace(/\s+County$/i, "")
    .trim();
}

const STATE_NAME = { TX: "Texas", CO: "Colorado" };

const byState = new Map();
for (const c of Object.values(COUNTIES)) {
  if (!c || !c.state || !c.label) continue;
  if (!byState.has(c.state)) byState.set(c.state, []);
  byState.get(c.state).push(displayName(c.label));
}
for (const list of byState.values()) list.sort((a, b) => a.localeCompare(b));

// Texas first (the original market), then the rest alphabetically by state name.
const states = [...byState.keys()].sort((a, b) =>
  a === "TX" ? -1 : b === "TX" ? 1 : STATE_NAME[a].localeCompare(STATE_NAME[b])
);
const total = [...byState.values()].reduce((n, l) => n + l.length, 0);

/* The state plane zones actually in play — read per county through the same resolver the
 * app calls, so a county assigned to a new zone shows up here without a code change. */
const zones = [];
for (const c of Object.values(COUNTIES)) {
  if (!c || !c.state || !c.label) continue;
  const z = zoneForCounty(c.state, displayName(c.label));
  if (z && !zones.some((x) => x.epsg === z.epsg)) zones.push({ epsg: z.epsg, name: z.name, state: c.state });
}
// Same order as the county list: the home market first, then by zone number.
zones.sort((a, b) => (states.indexOf(a.state) - states.indexOf(b.state)) || (a.epsg - b.epsg));

/* "NAD83 / Texas South Central (ftUS)" → "Texas South Central" — the units are stated once
 * for the whole list rather than repeated per zone. */
const zoneLabel = (n) => n.replace(/^NAD83\s*\/\s*/, "").replace(/\s*\(ftUS\)\s*$/, "");

const stateNames = states.map((s) => STATE_NAME[s]);
const stateList = stateNames.join(" &amp; ");   // HTML-escaped for the page
const stateLog = stateNames.join(" & ");        // plain, for the CLI message
const countyList = states
  .map((s) => `${STATE_NAME[s]}: ${byState.get(s).join(" · ")}`)
  .join(". ");

const REGIONS = {
  hero: `          <span>${total} counties · ${stateList}</span>`,

  spec:
    `        <div class="spec-row reveal"><span class="n">01</span><span class="t">Live county parcel data ` +
    `<span class="d">— ${countyList}. Pulled straight from each public GIS.</span></span></div>\n` +
    `        <div class="spec-row reveal"><span class="n">02</span><span class="t">Feet-accurate ` +
    `<span class="d">— true survey feet on your county's own state plane zone, no Web-Mercator stretch</span></span></div>`,

  cred:
    `          planyr.io · NAD83 state plane · US survey feet · ` +
    zones.map((z) => `${zoneLabel(z.name)} (EPSG:${z.epsg})`).join(" · ") +
    `<br>`,
};

let html = readFileSync(PAGE, "utf8");
let changed = false;
for (const [name, body] of Object.entries(REGIONS)) {
  const open = `<!-- landing:coverage:${name} -->`;
  const close = `<!-- /landing:coverage:${name} -->`;
  // Keep whatever indentation the closing marker already has, so the generated block
  // sits in the document exactly like hand-written markup around it.
  const re = new RegExp(`(${open}\\n)[\\s\\S]*?\\n([ \\t]*${close})`);
  if (!re.test(html)) {
    console.error(`✗ landing page is missing the ${open} … ${close} region`);
    process.exit(2);
  }
  const next = html.replace(re, (_m, head, tail) => `${head}${body}\n${tail}`);
  if (next !== html) changed = true;
  html = next;
}

if (process.argv.includes("--check")) {
  if (changed) {
    console.error(
      "✗ public/landing/index.html coverage copy is stale.\n" +
        "  The county list / state plane zones no longer match the app's own sources.\n" +
        "  Fix: node scripts/build-landing-coverage.mjs  (commit the result)"
    );
    process.exit(1);
  }
  console.log(`✓ landing coverage copy matches the repo — ${total} counties, ${stateLog}, ${zones.length} zones`);
  process.exit(0);
}

writeFileSync(PAGE, html);
console.log(
  `${changed ? "✎ updated" : "= unchanged"} public/landing/index.html — ` +
    `${total} counties (${stateLog}), ${zones.length} state plane zones`
);
