#!/usr/bin/env node
/* verify-comps-panel-tab-decouple — B850018 (NEW-11), owner chat block 2026-09-03: "when i click
 * comp in the center it shouldnt auto switch the left side to comp mode as well." Measured live
 * on deployed build `80c78cc`: the centre Site/Comp search-mode toggle and the left rail's
 * Sites/Comps tab were ONE piece of state (B831776's own deliberate original design) — flipping
 * either flipped the other, in BOTH directions.
 *
 * Fixed by splitting `MapFinder.jsx`'s single `mode` state into `mode` (what an address search
 * creates — the centre toggle, the toolbar's placement workflow) and `panelTab` (which list the
 * left rail browses). Neither setter touches the other any more. This harness proves the split
 * holds in both directions, and records what the four related "does X move the panel too?"
 * questions the report asked about actually do:
 *   - clicking a comp marker / a freshly-dropped comp pin → DOES move the panel to Comps (kept,
 *     deliberately — selecting a specific comp should surface its detail), but no longer touches
 *     the centre search-mode toggle (that part of the SAME coupling is also fixed).
 *   - dropping a file onto the map (creates a site-plan overlay under a comp) → arms the toolbar
 *     AND moves the panel to Comps (a direct enough action that surfacing it makes sense).
 *   - clicking a site polygon → navigates directly into that site's plan (a different workspace
 *     entirely), never touches `mode`/`panelTab` — not a relevant case.
 *   - the comp detail's "← All comps" back link → stays on the Comps tab, returns to the list
 *     within CompsPanel's own local state, never touches `mode`/`panelTab`.
 *
 * Run against a local dev server (signed out, fixture-seeded, no network egress):
 *   node ui-audit/verify-comps-panel-tab-decouple.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SHOT_DIR = "ui-audit/.artifacts/comps-panel-tab-decouple";
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const fixture = readFixture("bain");
const ctx = await browser.newContext({ viewport: { width: 1191, height: 700 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(fixtureSeed(fixture, { id: "panel-tab-decouple" }));
await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
const page = await ctx.newPage();
await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
await pacedWait(page, 2500);
await assertMeasurable(page, "verify-comps-panel-tab-decouple");

async function state() {
  return page.evaluate(() => {
    const list = document.querySelector('[role="tablist"][aria-label="What an address search creates"]');
    const tabs = list ? [...list.querySelectorAll('[role="tab"]')] : [];
    const railTabs = [...document.querySelectorAll('[role="tab"]')].filter((el) => /^Sites|^Comps/.test(el.textContent));
    return {
      centreSite: tabs.find((t) => t.textContent === "Site")?.getAttribute("aria-selected"),
      centreComp: tabs.find((t) => t.textContent === "Comp")?.getAttribute("aria-selected"),
      railSites: railTabs.find((t) => t.textContent.startsWith("Sites"))?.getAttribute("aria-selected"),
      railComps: railTabs.find((t) => t.textContent.startsWith("Comps"))?.getAttribute("aria-selected"),
    };
  });
}
const centreBtn = (label) => page.locator(`[role="tablist"][aria-label="What an address search creates"] button:has-text("${label}")`);

console.log("=== NEW-11 — the centre toggle and the left rail tab move independently, in both directions ===");
{
  const s0 = await state();
  check("initial: Site/Sites both selected", s0.centreSite === "true" && s0.railSites === "true", JSON.stringify(s0));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/initial.png` });

  await centreBtn("Comp").click();
  await pacedWait(page, 250);
  const s1 = await state();
  check("clicking centre 'Comp' flips the centre toggle", s1.centreComp === "true", JSON.stringify(s1));
  check("...but the left rail STAYS on Sites (the reported bug)", s1.railSites === "true" && s1.railComps === "false", JSON.stringify(s1));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/after-centre-comp.png` });

  await centreBtn("Site").click();
  await pacedWait(page, 250);
  const s2 = await state();
  check("clicking centre 'Site' flips it back, rail untouched", s2.centreSite === "true" && s2.railSites === "true", JSON.stringify(s2));

  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 250);
  const s3 = await state();
  check("clicking the rail 'Comps' tab flips the rail", s3.railComps === "true", JSON.stringify(s3));
  check("...but the centre toggle STAYS on Site (the reverse direction of the same bug)", s3.centreSite === "true" && s3.centreComp === "false", JSON.stringify(s3));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/after-rail-comps.png` });

  await page.getByRole("tab", { name: /^Sites/ }).first().click();
  await pacedWait(page, 250);
  const s4 = await state();
  check("clicking the rail 'Sites' tab flips it back, centre untouched", s4.railSites === "true" && s4.centreSite === "true", JSON.stringify(s4));
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
