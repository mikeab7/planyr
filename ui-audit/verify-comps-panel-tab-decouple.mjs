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
 * ⛔ B1133760 (owner report 2026-09-04, measured live on deployed build `index-Dh4XXz5X.js`) — NOT
 * an independent regression. The click-handler split above (this same PR #1402/`cde60ea5`) left ONE
 * call site unmigrated: the panel's own WIDTH style, still `width: mode === "comp" ?
 * "clamp(232px, 23vw, 440px)" : 232`. Because that rewrite moved every CLICK HANDLER onto
 * `panelTab` and this is a plain STYLE READ, it never came up in that pass — so the centre toggle
 * alone still resized the panel (272×32 vs 230×32 measured collapsed), the same coupling this file's
 * own NEW-11 checks were written to kill, surviving in the one place they don't look. Fixed by
 * keying that width on `panelTab` instead of `mode`, finishing what NEW-11 started.
 *
 * ⛔ THE REUSABLE LESSON — read this before adding a "does X still move Y" check anywhere else.
 * The NEW-11 checks above PASSED, unbroken, for the whole time this width coupling survived on
 * `main`: they read `aria-selected` (WHICH tab/content is showing), and this coupling is expressed
 * as CSS GEOMETRY (HOW BIG the panel is), a different axis entirely. A harness that only proves the
 * right tab lit up will never catch "but the box also grew" — the two have to be asserted
 * separately, and both live in THIS file (not split out) so a future reader sees them side by side
 * rather than assuming the NEW-11 section alone means the decoupling is fully covered.
 *
 * The GEOMETRY section below is the regression test for the width coupling specifically: it asserts
 * the panel's bounding box is BYTE-IDENTICAL across a centre-toggle click, collapsed and expanded,
 * and that the panel DOES still resize when the rail tab itself changes (that coupling is correct
 * and must keep working). Red-proofed by temporarily restoring the `mode === "comp"` width
 * expression: the "no resize" assertions failed, confirming this harness would have caught it.
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
// The centre toggle mounts slightly after the paced wait above on a cold run (observed flake,
// unrelated to any of this file's own state) — wait for it explicitly rather than racing it once.
await page.waitForSelector('[role="tablist"][aria-label="What an address search creates"]', { timeout: 10000 });

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

const panelBox = () => page.locator('[data-testid="map-sites-panel"]').boundingBox();
const collapseBtn = page.locator('[data-testid="map-sites-panel"] button[title*="the sites panel"]').first();
const sameBox = (a, b) => a && b && Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height)
  && Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y);

console.log("\n=== NEW-1 (owner report 2026-09-04) — the centre toggle must never resize the sites panel ===");
{
  // EXPANDED state (the default at this viewport).
  const openBefore = await panelBox();
  await centreBtn("Comp").click();
  await pacedWait(page, 250);
  const openAfterComp = await panelBox();
  check("expanded: clicking centre 'Comp' leaves the panel's box unchanged",
    sameBox(openBefore, openAfterComp), `before=${JSON.stringify(openBefore)} after=${JSON.stringify(openAfterComp)}`);
  await centreBtn("Site").click();
  await pacedWait(page, 250);
  const openAfterSite = await panelBox();
  check("expanded: clicking centre 'Site' back leaves the panel's box unchanged",
    sameBox(openBefore, openAfterSite), `before=${JSON.stringify(openBefore)} after=${JSON.stringify(openAfterSite)}`);

  // COLLAPSED state — the exact geometry the owner's report measured (272×32 vs 230×32).
  await collapseBtn.click();
  await pacedWait(page, 250);
  const closedBefore = await panelBox();
  await centreBtn("Comp").click();
  await pacedWait(page, 250);
  const closedAfterComp = await panelBox();
  check("collapsed: clicking centre 'Comp' leaves the panel's box unchanged",
    sameBox(closedBefore, closedAfterComp), `before=${JSON.stringify(closedBefore)} after=${JSON.stringify(closedAfterComp)}`);
  await centreBtn("Site").click();
  await pacedWait(page, 250);
  const closedAfterSite = await panelBox();
  check("collapsed: clicking centre 'Site' back leaves the panel's box unchanged",
    sameBox(closedBefore, closedAfterSite), `before=${JSON.stringify(closedBefore)} after=${JSON.stringify(closedAfterSite)}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/collapsed-unchanged.png` });

  // Restore to expanded/Sites so the next section starts from a known state.
  await collapseBtn.click();
  await pacedWait(page, 250);
}

console.log("\n=== the RAIL TAB (panelTab), not the centre toggle, legitimately still resizes the panel ===");
{
  const sitesBox = await panelBox();
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 250);
  const compsBox = await panelBox();
  check("clicking the rail 'Comps' tab DOES widen the panel (B1123424, unchanged)",
    compsBox.width > sitesBox.width + 10, `sites=${sitesBox.width} comps=${compsBox.width}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/comps-tab-widened.png` });
  await page.getByRole("tab", { name: /^Sites/ }).first().click();
  await pacedWait(page, 250);
  const backBox = await panelBox();
  check("clicking the rail 'Sites' tab back returns the panel to its original width",
    Math.round(backBox.width) === Math.round(sitesBox.width), `sites=${sitesBox.width} back=${backBox.width}`);
}

console.log("\n=== narrow/phone width — the OTHER branch of the panel's width ternary, untouched by mode or panelTab ===");
{
  await page.setViewportSize({ width: 375, height: 700 });
  await pacedWait(page, 400);
  // Narrow defaults to collapsed; open it so the panel is actually on screen to measure.
  const chevron = page.locator('[data-testid="map-sites-panel"] button[title*="the sites panel"]').first();
  await chevron.click();
  await pacedWait(page, 250);
  const narrowBefore = await panelBox();
  await centreBtn("Comp").click();
  await pacedWait(page, 250);
  const narrowAfterComp = await panelBox();
  check("narrow: clicking centre 'Comp' leaves the panel's box unchanged",
    sameBox(narrowBefore, narrowAfterComp), `before=${JSON.stringify(narrowBefore)} after=${JSON.stringify(narrowAfterComp)}`);
  await centreBtn("Site").click();
  await pacedWait(page, 250);
  const narrowAfterSite = await panelBox();
  check("narrow: clicking centre 'Site' back leaves the panel's box unchanged",
    sameBox(narrowBefore, narrowAfterSite), `before=${JSON.stringify(narrowBefore)} after=${JSON.stringify(narrowAfterSite)}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/narrow-unchanged.png` });
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
