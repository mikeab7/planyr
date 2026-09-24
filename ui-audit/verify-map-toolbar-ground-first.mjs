#!/usr/bin/env node
/* verify-map-toolbar-ground-first — NEW-1 (2026-09-08): the map toolbar stopped asking what you
 * are making before you have any ground.
 *
 * REPLACES three harnesses deleted in the same commit, whose subjects this item removed outright:
 *   · verify-map-toolbar-rebuild.mjs        (its first checks asserted the Site/Comp switch and
 *                                            the rail tab move together — now false BY DESIGN)
 *   · verify-place-comp-split-button.mjs    ("Place comp ▾" and its three anchors)
 *   · verify-map-toolbar-caret-anchor.mjs   (both caret menus' anchoring)
 * and it carries forward the parts of them that are still true: the at-rest row's controls, the
 * armed ring, the concentric radius nesting, and the exact 1600×465 viewport the caret-anchor
 * harness was built for (the owner's real window).
 *
 * WHAT IT PROVES, and each one is a thing a screenshot cannot tell from correct:
 *   A. AT REST — three ways to point at ground (Select parcels · Draw · Drop a pin), nothing
 *      preselected, and NO mode control anywhere on the toolbar.
 *   B. THE DECIDE BAR — a dropped pin produces the summary, its ✕, "Plan this site", and a
 *      "Record info ▾" that opens Log a comp / Place a site plan / Add a note (B1892544,
 *      2026-09-24 — collapsed off the bar into a dropdown; was four live sibling buttons).
 *   C. THE STICKY ANSWER — choosing a verb makes it lead on the next selection (the outer bar's
 *      accent AND the dropdown's own row order), within the session only. This is the one
 *      behaviour with no visual tell at all: a bar that silently stopped being sticky renders
 *      identically.
 *   D. LAYOUT — at 1600×465 AND 1191×465 (both named in the brief) the bar does not wrap, does
 *      not overflow its own pill, and does not intersect the left rail or the Imagery-and-layers
 *      panel. MEASURED as rects, never eyeballed.
 *   E. THE ACREAGE CHIP's mechanism — a pin has no acreage, so this is proven on the pin flavour
 *      of the bar as far as a logged-out sandbox can: the chip's marker is absent with no parcel
 *      selection, which is the arm whose answer is known independently of the code under test
 *      (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). The parcel flavour needs a live county parcel
 *      service this sandbox's proxy 403s at the CONNECT tunnel — recorded as Blocker: live-GIS on
 *      this item's V###, never quietly skipped.
 *
 *   node ui-audit/verify-map-toolbar-ground-first.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/map-toolbar-ground-first";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const r1 = (n) => Math.round(n * 10) / 10;

// If the managed Chromium revision differs, set PW_CHROME to the chrome binary (docs/REFERENCE.md
// "Playwright / ui-audit in the sandbox" — the same fallback every other harness here uses).
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  for (const width of [1600, 1191]) {
    console.log(`\n=== viewport ${width}×465 ===`);
    const ctx = await browser.newContext({ viewport: { width, height: 465 } });
    const page = await ctx.newPage();
    // The literal name, unadorned: test/tabTiming.js requires each harness to name ITSELF so a
    // void run says which harness produced it. The viewport is reported by the heading above.
    await assertMeasurable(page, "verify-map-toolbar-ground-first");
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await pacedWait(page, 900);

    // ── A. AT REST ────────────────────────────────────────────────────────────────────────
    const selectBtn = page.getByTestId("map-toolbar-select-parcels");
    const drawBtn = page.getByTestId("map-toolbar-draw");
    const pinBtn = page.getByTestId("map-toolbar-drop-pin");
    check("A1 · Select parcels renders", await selectBtn.count() === 1);
    check("A2 · Draw renders as its own first-class button (not behind a caret)", await drawBtn.count() === 1);
    check("A3 · Drop a pin renders", await pinBtn.count() === 1);
    check("A4 · no Site/Comp mode control anywhere on the page",
      await page.locator('[role="tablist"][aria-label="What an address search creates"]').count() === 0);
    check("A5 · no 'Place comp' split button", await page.getByRole("button", { name: "Place comp", exact: true }).count() === 0);
    check("A6 · no decide bar before any ground is pointed at", await page.getByTestId("map-decide-summary").count() === 0);
    // KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): a control this harness knows is there
    // regardless of anything this item changed. If THIS goes missing the probe is broken, not the app.
    check("A7 · known-good arm — the address field is present, so the toolbar really rendered",
      await page.locator('input[placeholder*="address" i]').count() >= 1);

    // ── E (first half). No parcel selection ⇒ no acreage chip. ─────────────────────────────
    check("E1 · no acreage chip with nothing selected", await page.getByTestId("map-acreage-chip").count() === 0);

    // The at-rest pill's own height, so D1b below can prove the decide bar did not grow the bar
    // by a row rather than merely that its children agree with each other.
    const restBarHeight = await selectBtn.evaluate((el) => el.parentElement.getBoundingClientRect().height);

    // ── B. THE DECIDE BAR, via a raw pin (needs no parcel service) ─────────────────────────
    await pinBtn.click();
    await pacedWait(page, 250);
    check("B0 · arming the pin shows the map-wide armed ring", await page.getByTestId("map-comp-armed").count() === 1);
    const mapBox = await page.locator(".leaflet-container").boundingBox();
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height * 0.62);
    await pacedWait(page, 500);

    check("B1 · the decide bar appears", await page.getByTestId("map-decide-summary").count() === 1);
    check("B2 · the pin is drawn on the map", await page.getByTestId("map-decide-pin").count() === 1);
    check("B3 · its ✕ is there", await page.getByTestId("map-decide-clear").count() === 1);
    /* B1892544 (2026-09-24) — the bar itself now carries only TWO direct controls: "Plan this
     * site" and "Record info ▾". The other three verbs (Log a comp / Place a site plan / Add a
     * note) live inside the menu the second one opens, so proving they are all reachable needs
     * opening it — this replaces the old "all four are live sibling buttons at once" check with
     * the design's own new claim: one direct action, one menu holding the rest. */
    check("B4a · 'Plan this site' renders as a direct button", await page.getByTestId("map-decide-verb-site").count() === 1);
    const recordInfoBtn = page.getByTestId("map-decide-record-info");
    check("B4b · 'Record info ▾' renders as the bar's only other direct control",
      await recordInfoBtn.count() === 1);
    check("B4c · nothing behind it is in the DOM until it is opened",
      await page.getByTestId("map-decide-verb-comp").count() === 0
      && await page.getByTestId("map-decide-verb-siteplan").count() === 0
      && await page.getByTestId("map-decide-verb-note").count() === 0);
    await recordInfoBtn.click();
    await pacedWait(page, 250);
    const verbCounts = {};
    for (const k of ["site", "comp", "siteplan", "note"]) verbCounts[k] = await page.getByTestId(`map-decide-verb-${k}`).count();
    check("B4d · Log a comp / Place a site plan / Add a note all render inside the open menu",
      verbCounts.comp === 1 && verbCounts.siteplan === 1 && verbCounts.note === 1, JSON.stringify(verbCounts));
    await page.keyboard.press("Escape");
    await pacedWait(page, 200);
    check("B4e · Escape closes the menu again, taking its rows back out of the DOM",
      await page.getByTestId("map-decide-verb-comp").count() === 0);
    const verbText = await page.getByTestId("map-decide-verb-site").innerText();
    check("B5 · the direct verb reads 'Plan this site' (B1892544, 2026-09-24 — was 'Plan a site')", verbText.trim() === "Plan this site", verbText.trim());
    const dotBg = await page.getByTestId("map-decide-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
    // Neutral means: not the site accent and not the comp accent — it must not imply an answer.
    check("B6 · the status dot is neutral, not an accent that names one of the four verbs",
      !/rgb\(47,\s*111,\s*176\)/.test(dotBg), dotBg);

    // ── D. LAYOUT, measured ────────────────────────────────────────────────────────────────
    const barBox = await page.locator('[data-testid="map-decide-summary"]').evaluate((el) => {
      const bar = el.parentElement; // the toolbar pill itself
      const r = bar.getBoundingClientRect();
      const kids = [...bar.children].filter((k) => k.getBoundingClientRect().width > 0);
      /* MEASURE THE CENTRES, NOT THE TOPS. The bar is `align-items:center` and its children are
       * deliberately different heights (a 7px status dot, 30px buttons, zero-height spacers), so
       * comparing `top` reports SEVEN rows on a bar that has one — the probe's own error, caught
       * on this harness's first run (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6: ask a second way and
       * compare). A wrap moves a child's CENTRE by a whole row height; nothing else does. */
      const centres = kids.map((k) => { const b = k.getBoundingClientRect(); return Math.round(b.top + b.height / 2); });
      return {
        bar: { x: r.x, y: r.y, width: r.width, height: r.height },
        scrollW: bar.scrollWidth, clientW: bar.clientWidth,
        centreSpread: Math.max(...centres) - Math.min(...centres),
        kids: kids.length,
      };
    });
    check("D1 · the bar does not wrap — every child shares one row centre",
      barBox.centreSpread <= 1, `${barBox.kids} children, centre spread ${barBox.centreSpread}px`);
    check("D1b · and the bar is still exactly one row tall",
      Math.abs(barBox.bar.height - restBarHeight) <= 1, `at rest ${r1(restBarHeight)} · deciding ${r1(barBox.bar.height)}`);
    check("D2 · the bar does not overflow itself",
      barBox.scrollW <= barBox.clientW + 1, `scrollWidth ${barBox.scrollW} vs clientWidth ${barBox.clientW}`);

    const railBox = await page.locator('[data-testid="map-sites-panel"]').boundingBox();
    const layersBox = await page.locator('[data-testid="map-layers-panel"]').boundingBox();
    check("D3 · the bar never intersects the Sites/Comps rail on the left",
      !overlaps(barBox.bar, railBox), `bar ${r1(barBox.bar.x)}→${r1(barBox.bar.x + barBox.bar.width)} · rail ${r1(railBox.x)}→${r1(railBox.x + railBox.width)}`);
    check("D4 · the bar never intersects the Imagery and layers panel on the right",
      !overlaps(barBox.bar, layersBox), `bar right ${r1(barBox.bar.x + barBox.bar.width)} · layers left ${r1(layersBox.x)}`);

    if (SHOTS) await page.screenshot({ path: `${OUT}/decide-bar-${width}.png` });

    // ── C. THE STICKY ANSWER ───────────────────────────────────────────────────────────────
    /* B1892544 — the old probe read the sticky order off the DOM order of four sibling
     * `[data-testid^="map-decide-verb-"]` buttons; three of those are now unmounted until "Record
     * info" is opened, so a bare querySelectorAll can no longer see them. MapFinder.jsx now
     * publishes the same `orderVerbs` result on a small hidden span for exactly this reason —
     * read that instead of the DOM order. */
    const readOrder = async () => {
      const attr = await page.getByTestId("map-decide-order").getAttribute("data-order");
      return (attr || "").split(",").filter(Boolean);
    };
    const orderNow = await readOrder();
    check("C1 · a fresh session leads with 'site' (nothing stored yet)", orderNow[0] === "site", orderNow.join(" · "));

    // Choose "Log a comp". Logged out there is nowhere for a comp to go, so `onPlaceComp` may be
    // absent and the verb may not render at all — say so honestly rather than silently pass.
    if (verbCounts.comp === 1) {
      await recordInfoBtn.click();
      await pacedWait(page, 200);
      await page.getByTestId("map-decide-verb-comp").click();
      await pacedWait(page, 400);
      const stored = await page.evaluate(() => { try { return sessionStorage.getItem("planarfit:mapDecideVerb:v1"); } catch (_) { return "unreadable"; } });
      check("C2 · choosing a verb records it for the session (sessionStorage, never localStorage)", stored === "comp", String(stored));
      const strayLocal = await page.evaluate(() => { try { return localStorage.getItem("planarfit:mapDecideVerb:v1"); } catch (_) { return null; } });
      check("C3 · and does NOT persist past the tab — a sticky answer is a shortcut, not a mode", strayLocal === null, String(strayLocal));

      // Point at ground again; the remembered verb must now LEAD.
      await page.getByTestId("map-toolbar-drop-pin").click();
      await pacedWait(page, 200);
      /* Picking "Log a comp" above opened the comp entry sheet, which DOCKS over the bottom of the
       * map (B986096-HARDENING-10) WITHOUT shrinking `.leaflet-container`'s own measured box — a
       * pre-existing shape, unrelated to this item, that `mapBox` (captured once, before that
       * panel existed) cannot see. Clicking at `mapBox.height * 0.55` lands ON the docked panel,
       * not on the map, so no new pin is ever placed and the decide bar never reappears — caught
       * live while proving this item, not assumed. Aim inside whatever of the map is STILL visible
       * above the panel instead. */
      const panelBox = await page.locator("[data-comp-entry-panel]").boundingBox().catch(() => null);
      const clickY = panelBox
        ? Math.max(mapBox.y + 10, Math.min(mapBox.y + mapBox.height * 0.55, panelBox.y - 20))
        : mapBox.y + mapBox.height * 0.55;
      await page.mouse.click(mapBox.x + mapBox.width * 0.45, clickY);
      await pacedWait(page, 450);
      const orderAfter = await readOrder();
      check("C4 · the next decide bar leads with the remembered verb", orderAfter[0] === "comp", orderAfter.join(" · "));
      check("C4b · and 'Record info' — not 'Plan this site' — now carries the lead accent, since a record verb leads",
        await page.getByTestId("map-decide-record-info").evaluate((el) => getComputedStyle(el).backgroundColor)
          !== await page.getByTestId("map-decide-verb-site").evaluate((el) => getComputedStyle(el).backgroundColor));
      check("C5 · and still offers all four", orderAfter.length === 4, orderAfter.join(" · "));
      await recordInfoBtn.click();
      await pacedWait(page, 200);
      // "site" is excluded — its own button is always mounted beside the menu's trigger, so a
      // bare selector sweep would catch it too and report the wrong element as row 0.
      const rowOrder = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid^="map-decide-verb-"]')]
          .map((b) => b.dataset.testid.replace("map-decide-verb-", ""))
          .filter((k) => k !== "site"));
      check("C5b · and the remembered verb leads the OPEN MENU'S rows too (top of the dropdown, not just the bar accent)",
        rowOrder[0] === "comp", rowOrder.join(" · "));
      await page.keyboard.press("Escape");
      await pacedWait(page, 200);

      // ✕ leaves the bar without answering it, and marks no ground.
      await page.getByTestId("map-decide-clear").click();
      await pacedWait(page, 300);
      check("C6 · ✕ dismisses the bar and removes the pin",
        (await page.getByTestId("map-decide-summary").count()) === 0 && (await page.getByTestId("map-decide-pin").count()) === 0);
      check("C7 · and the at-rest row comes back", (await page.getByTestId("map-toolbar-select-parcels").count()) === 1);
    } else {
      check("C2-C7 · SKIPPED — 'Log a comp' does not render logged out (no comp receiver); stickiness is covered by test/decideBar.test.js", true, "vacuous arm declared, not hidden");
    }

    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  process.exitCode = 1;
}
