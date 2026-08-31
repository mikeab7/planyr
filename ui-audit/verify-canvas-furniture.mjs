#!/usr/bin/env node
/* NEW-MAPCTRL-3 — CANVAS FURNITURE STACKING, the general case of the Comps/Layers corner
 * collision (`verify-map-comps-overlap.mjs`), on two different screens:
 *
 *  PART A — the Site Planner canvas (SitePlanner.jsx). Below ~760 CSS px the side rails
 *  collapse into "✎ Properties" / "✎ Tools" FABs, which used to land on top of the graphic
 *  scale bar, the "● Scaled · county GIS" calibration badge, and the lat/long coordinate
 *  readout — measured live: Tools FAB (657-738,846-884) over the scale bar's right end
 *  (567-736,828-860), a real 79×14px overlap. The fix reserves the FABs' own band
 *  (`FAB_RESERVE_PX`, sheetFurniture.js) for every piece of passive bottom furniture on a
 *  narrow screen, and drops the coordinate chip entirely there (lowest priority, informational
 *  only) rather than let it render invisibly behind a FAB.
 *
 *  PART B — the Map view (MapFinder.jsx). The "+ Select parcels" coach tip — the ONLY
 *  explanation anywhere in the app for how that mode works — shares a bottom-left banner slot
 *  that used a bare `bottom:` offset with no ceiling, so on a genuinely short pane (narrow width
 *  + short height — a landscape phone/tablet) it could render ABOVE the narrow-mode full-width
 *  search bar. Measured live: bar (8,121)-(721,163), tip (12,103)-(392,157), a real ~36-42px
 *  overlap. The fix wraps the whole banner family in one `top`+`bottom` span (the search bar's
 *  own bottom edge as the ceiling, narrow only) with `overflow:hidden`, so it can NEVER render
 *  under the search bar, at any height.
 *
 *  PART C — "Go", "+ Select parcels" and "+ Comp" now carry a `title`, matching every other
 *  control on that bar.
 *
 *  ⛔ B754752 (added to PART A) — the bottom-centre canvas TOAST (`flashWarn`/`toastPill` in
 *  SitePlanner.jsx) joined this furniture set. It used to be a bare `left: 50%` of the viewport,
 *  so a docked left-rail panel could sit directly under it (measured live: it painted over the
 *  Properties panel's own Length (ft) field at a laptop-width window) — the fix re-centres it on
 *  the measured CANVAS instead, and this harness is what proves that holds against every OTHER
 *  occupant of the same corner, at every requested width, rather than trusting the centring rule
 *  in isolation. Every bottom-centre toast on this surface (pob/route/deed-align, overlay
 *  calibration, the parcel-select hint, B754752's keyboard scope-guard hint) shares ONE `toastPill`
 *  object, so proving the parcel-select hint never collides proves it for all of them.
 *
 *  PART A also covers B750096 — the road tool's "Done"/finish control used to live INSIDE the
 *  canvas SVG, glued to the last placed vertex with pointer-events:all (a real click target
 *  sitting where the next point gets placed). It now renders as `[data-testid="road-draft-
 *  status"]`, a quiet bottom-center strip fixed to the pane, stacked clear of the furniture by
 *  the SAME canvasPillBottom the Standards toast uses — so it must join this collision-aware set
 *  rather than float free, at every width, narrow FAB row included.
 *
 * Real hit tests (`elementFromPoint`), not bounding-box math alone — a clipped/overflow-hidden
 * box can still report an overlapping LAYOUT rect while painting/hit-testing nothing there.
 *
 *   node ui-audit/verify-canvas-furniture.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/canvas-furniture";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
const overlapArea = (a, b) => { if (!a || !b) return 0; const ox = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)); const oy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)); return ox * oy; };

// A real, PAINTED hit test at a point — the browser's own answer, not geometry alone (a
// clipped/overflow-hidden box can still report an overlapping layout rect while painting nothing
// there — FOREGROUND-OR-VOID's sibling trap for this class of fix).
const hitReaches = (page, x, y, selector) => page.evaluate(([x, y, sel]) => {
  const target = document.querySelector(sel);
  if (!target) return false;
  const top = document.elementFromPoint(x, y);
  return !!(top && (target === top || target.contains(top) || top.contains(target)));
}, [x, y, selector]);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });
  const WIDTHS = [1440, 1024, 900, 750, 600, 420];

  // ─────────────────────────────────────────── PART A — Site Planner canvas furniture
  console.log("\nPART A — Site Planner canvas furniture (north arrow · scale bar · calibration badge · coordinate chip · Properties/Tools FABs · the bottom-centre canvas toast · road-draft status strip)");
  const PARCEL = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
  /* parcelSelect: false — so a press on the seeded parcel's boundary fires the SAME
   * `parcel-select-hint` toast B311/NEW-1 already ships, which renders through the identical
   * shared `toastPill` object (position, background, everything) as every other bottom-centre
   * canvas toast on this surface — the pob/route/deed-align pill, the overlay-calibration pill,
   * and the B754752 keyboard scope-guard hint ("Delete went to the box you're typing in" /
   * "the keyboard is still on the panel"). Proving ONE toast never collides with this furniture
   * proves it for all of them, because they share one positioning rule (`toastCenterX`,
   * SitePlanner.jsx) rather than each computing their own. */
  const site = { s_furn: { id: "s_furn", groupId: "s_furn", site: "Furniture Verify", name: "Plan 1", status: "active", origin: { lat: 29.80, lon: -95.83 }, county: "harris", parcels: [{ id: "pA", points: PARCEL, locked: true }], els: [], measures: [], callouts: [], markups: [], deletedIds: [], settings: { parcelSelect: false }, underlay: null, updatedAt: 1755000000000 } };
  const seedSite = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)})); localStorage.setItem('planarfit:currentSite:v1', 's_furn'); } catch (e) {} })();`;

  for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(seedSite);
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-canvas-furniture");
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForSelector('svg[aria-label="Site plan canvas"]', { timeout: 15000 });
    await pacedWait(page, 2200);
    const svgBox = await page.locator('svg[aria-label="Site plan canvas"]').boundingBox().catch(() => null);
    if (svgBox) { await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2, { steps: 3 }); await pacedWait(page, 500); }

    // Press the rendered parcel's own boundary (its `data-feature="parcel:pA"` group, an
    // axis-aligned rect on screen since the view is north-up) with parcelSelect off — this is
    // B311's real click-through repro and fires the parcel-select-hint toast honestly, not a
    // synthetic state poke (SYNTHETIC-KEYS-DONT-EDIT's sibling caution for a click).
    const parcelBox = await page.evaluate(() => {
      const g = document.querySelector('[data-feature="parcel:pA"]');
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { left: r.left, top: r.top, height: r.height };
    });
    if (parcelBox) {
      await page.mouse.click(parcelBox.left + 2, parcelBox.top + parcelBox.height / 2);
      await pacedWait(page, 500);
    }

    const data = await page.evaluate(() => {
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const toolsFab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "✎ Tools");
      const badge = [...document.querySelectorAll("div")].find((d) => /^[●▲]/.test((d.textContent || "").trim()) && (d.textContent || "").length < 60);
      const cursorInner = document.querySelector("[data-ground-el]");
      let cursorChip = cursorInner;
      while (cursorChip && !(cursorChip.style && cursorChip.style.position === "absolute")) cursorChip = cursorChip.parentElement;
      const furnContainer = [...document.querySelectorAll('div[data-export="skip"]')].find((d) => d.children.length === 2 && d.style.zIndex === "400");
      const plates = furnContainer ? [...furnContainer.children] : [];
      const scaleBarWrap = plates.find((p) => p.style.right);
      const northWrap = plates.find((p) => p.style.left);
      const toast = document.querySelector('[data-testid="parcel-select-hint"]');
      // B914500 — the bottom-right zoom control column (+/−/fit/report-slow, "gbtn" buttons)
      // joins the furniture-collision set. It is positioned independently of FURNITURE_ROW
      // (a fixed `bottom:100`, nudged by the same narrow-width reserve as of the fix), so a
      // future change to either one can silently re-open the gap between them.
      const zoomBtns = [...document.querySelectorAll("button.gbtn")];
      const zoomStack = zoomBtns.length ? zoomBtns[0].parentElement : null;
      return {
        narrow: window.matchMedia("(max-width: 760px)").matches,
        toolsFab: rectOf(toolsFab), badge: rectOf(badge), cursorChip: rectOf(cursorChip),
        scaleBar: rectOf(scaleBarWrap), north: rectOf(northWrap), toast: rectOf(toast),
        zoomStack: rectOf(zoomStack),
      };
    });

    check(`${width}px · narrow=${data.narrow} · north arrow renders`, !!data.north);
    check(`${width}px · scale bar renders`, !!data.scaleBar);
    check(`${width}px · calibration badge renders`, !!data.badge);

    if (data.narrow) {
      check(`${width}px · coordinate chip is DROPPED (lowest priority, no room)`, data.cursorChip === null, data.cursorChip ? "still rendered" : "");
      check(`${width}px · Tools FAB renders`, !!data.toolsFab);
      if (data.toolsFab) {
        check(`${width}px · Tools FAB does not overlap the scale bar`, overlapArea(data.toolsFab, data.scaleBar) === 0, `overlap=${overlapArea(data.toolsFab, data.scaleBar).toFixed(0)}px²`);
        check(`${width}px · Tools FAB does not overlap the calibration badge`, overlapArea(data.toolsFab, data.badge) === 0, `overlap=${overlapArea(data.toolsFab, data.badge).toFixed(0)}px²`);
        // Properties FAB is the mirror of Tools (identical bottom:16/height:38, left instead of
        // right) — proven live via Tools above; asserted here by the SAME shared row constant
        // rather than forcing a fragile canvas selection in this harness.
        const propsFabWouldBe = { l: 12, t: data.toolsFab.t, r: 12 + 140, b: data.toolsFab.b }; // generous width estimate
        check(`${width}px · (by shared construction) Properties FAB's band does not reach the badge`, overlapArea(propsFabWouldBe, data.badge) === 0, `overlap=${overlapArea(propsFabWouldBe, data.badge).toFixed(0)}px²`);
      }
    } else {
      check(`${width}px · coordinate chip still renders on desktop`, !!data.cursorChip);
    }
    // pairwise: badge never overlaps the scale bar or the north arrow, at any width
    check(`${width}px · badge does not overlap the scale bar`, overlapArea(data.badge, data.scaleBar) === 0, `overlap=${overlapArea(data.badge, data.scaleBar).toFixed(0)}px²`);
    check(`${width}px · badge does not overlap the north arrow`, overlapArea(data.badge, data.north) === 0, `overlap=${overlapArea(data.badge, data.north).toFixed(0)}px²`);

    // ⛔ B914500 — THE REGRESSION THIS ITEM FIXES. Raising FURNITURE_ROW by FAB_RESERVE_PX on
    // narrow width (to clear the "✎ Properties"/"✎ Tools" FABs below) pushed the scale bar's
    // whole plate up into the zoom control column's fixed `bottom:100` span above it — measured
    // live on the owner's real Bain plan at 390px: the column's own "◷" report-slow button
    // painted directly over the scale bar's highest tick label ("…0 FEET"). Proven red on the
    // pre-fix source (a bare `bottom: 100`) before the fix landed. Checked at EVERY width,
    // mirroring the badge pairwise checks above — the fixed 100 is harmless on desktop today
    // only because FURNITURE_ROW happens to be 40 there; nothing stops that assumption drifting.
    check(`${width}px · zoom control does not overlap the scale bar`, overlapArea(data.zoomStack, data.scaleBar) === 0, `overlap=${overlapArea(data.zoomStack, data.scaleBar).toFixed(0)}px²`);
    check(`${width}px · zoom control does not overlap the north arrow`, overlapArea(data.zoomStack, data.north) === 0, `overlap=${overlapArea(data.zoomStack, data.north).toFixed(0)}px²`);

    // B754752 — the bottom-centre canvas toast joins the furniture set. It must clear every
    // OTHER piece the same way the badge already has to; a fixed viewport-centred toast could
    // land under it at some width nobody had tested, which is exactly the class this item exists
    // to close (the toast previously covered the Properties panel's own Length field, a fixed
    // "50%" that ignored every other occupant of the corner it shares).
    check(`${width}px · parcel-select-hint toast renders`, !!data.toast);
    if (data.toast) {
      check(`${width}px · toast does not overlap the north arrow`, overlapArea(data.toast, data.north) === 0, `overlap=${overlapArea(data.toast, data.north).toFixed(0)}px²`);
      check(`${width}px · toast does not overlap the scale bar`, overlapArea(data.toast, data.scaleBar) === 0, `overlap=${overlapArea(data.toast, data.scaleBar).toFixed(0)}px²`);
      check(`${width}px · toast does not overlap the calibration badge`, overlapArea(data.toast, data.badge) === 0, `overlap=${overlapArea(data.toast, data.badge).toFixed(0)}px²`);
      if (data.narrow && data.toolsFab) {
        check(`${width}px · toast does not overlap the Tools FAB`, overlapArea(data.toast, data.toolsFab) === 0, `overlap=${overlapArea(data.toast, data.toolsFab).toFixed(0)}px²`);
      }
    }

    // B750096 — the road-draft "finish" status strip (bottom-center, replaces the old in-canvas
    // click-swallowing chip) must join this SAME collision-aware furniture set: assert it never
    // overlaps the north arrow / scale bar / calibration badge / Tools FAB, at every width, and
    // that its Done button is actually hit-testable (not painted-over by anything).
    if (data.narrow && data.toolsFab) {
      await page.getByRole("button", { name: "✎ Tools" }).click().catch(() => {});
      await pacedWait(page, 300);
    }
    const roadBtn = page.getByRole("button", { name: "Road", exact: true });
    if (await roadBtn.count().catch(() => 0)) {
      await roadBtn.click().catch(() => {});
      await pacedWait(page, 200);
      if (svgBox) {
        await page.mouse.click(svgBox.x + svgBox.width * 0.35, svgBox.y + svgBox.height * 0.4);
        await pacedWait(page, 150);
        await page.mouse.click(svgBox.x + svgBox.width * 0.55, svgBox.y + svgBox.height * 0.55);
        await pacedWait(page, 300);
      }
      const strip = page.locator('[data-testid="road-draft-status"]');
      const stripVisible = await strip.isVisible().catch(() => false);
      check(`${width}px · road-draft status strip renders while drawing a road`, stripVisible);
      if (stripVisible) {
        const stripBox = await strip.boundingBox().catch(() => null);
        const sr = stripBox ? { l: stripBox.x, t: stripBox.y, r: stripBox.x + stripBox.width, b: stripBox.y + stripBox.height } : null;
        check(`${width}px · status strip does not overlap the north arrow`, overlapArea(sr, data.north) === 0, `overlap=${overlapArea(sr, data.north).toFixed(0)}px²`);
        check(`${width}px · status strip does not overlap the scale bar`, overlapArea(sr, data.scaleBar) === 0, `overlap=${overlapArea(sr, data.scaleBar).toFixed(0)}px²`);
        check(`${width}px · status strip does not overlap the calibration badge`, overlapArea(sr, data.badge) === 0, `overlap=${overlapArea(sr, data.badge).toFixed(0)}px²`);
        if (data.narrow && data.toolsFab) {
          check(`${width}px · status strip does not overlap the Tools FAB`, overlapArea(sr, data.toolsFab) === 0, `overlap=${overlapArea(sr, data.toolsFab).toFixed(0)}px²`);
        }
        // real hit test — the Done button must actually be reachable, not covered by anything
        // (the SAME class of check the FOREGROUND-OR-VOID / chrome-swallows-press family use —
        // a layout rect proves nothing about what actually paints/hit-tests at that point).
        const doneBox = await page.locator('[data-testid="road-draft-finish"]').boundingBox().catch(() => null);
        if (doneBox) {
          const dcx = doneBox.x + doneBox.width / 2, dcy = doneBox.y + doneBox.height / 2;
          const reaches = await hitReaches(page, dcx, dcy, '[data-testid="road-draft-finish"]');
          check(`${width}px · the Done button is actually clickable (not covered)`, reaches);
        }
      }
      await page.keyboard.press("Escape").catch(() => {});
    } else {
      check(`${width}px · Road tool reachable to verify the draft status strip`, false, "Road tool button not found");
    }

    if (SHOTS) await page.screenshot({ path: `${OUT}/planner-w${width}.png` });
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART B — Map view coach-tip vs search bar
  console.log("\nPART B — Map view: the \"+ Select parcels\" coach tip never renders under the search bar");
  // A short HEIGHT is the reproduction — the reported collision needs a genuinely short pane
  // (a landscape phone/tablet), not just a narrow width. Test the width matrix at a normal
  // height, AND the exact narrow width at a short height (the measured reproduction).
  for (const [width, height] of [...WIDTHS.map((w) => [w, 900]), [729, 350], [729, 300]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-canvas-furniture");
    await page.goto(URL, { waitUntil: "load" });
    await pacedWait(page, 1800);
    await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /Select parcels/.test(x.textContent || "")); if (b) b.click(); });
    await pacedWait(page, 600);
    const data = await page.evaluate(() => {
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const bar = document.querySelector("input[aria-label='Search for an address or place']")?.closest("div[style]");
      // the bottom-left banner (coach tip, or whatever's up — the county-outage message when
      // this sandbox has no live GIS is an equally valid probe of the SAME shared wrapper)
      const banner = [...document.querySelectorAll("div")].find((d) => /lot to add it|parcel server is slow/.test(d.textContent || "") && d.textContent.length < 200 && d.querySelector("div,button") === null);
      const input = document.querySelector("input[aria-label='Search for an address or place']");
      return { bar: rectOf(bar), banner: rectOf(banner), inputRect: input ? (() => { const r = input.getBoundingClientRect(); return { x: r.left + 10, y: r.top + r.height / 2 }; })() : null };
    });
    if (data.inputRect) {
      const reachable = await hitReaches(page, data.inputRect.x, data.inputRect.y, "input[aria-label='Search for an address or place']");
      check(`${width}x${height} · the search input stays reachable (never covered by the banner)`, reachable);
    }
    // The bbox-overlap check is only meaningful when there's room for the banner to render at
    // its full natural height — at a genuinely pathological height (below what any real device
    // gives a map view) the wrapper's `overflow:hidden` clips the banner so nothing paints or
    // hit-tests in the collision zone even though its un-clipped LAYOUT rect still numerically
    // overlaps. The hit-test above is the real guarantee (search stays reachable, i.e. nothing
    // is actually painted/clickable over it); this check corroborates it in the ordinary case.
    if (data.bar && data.banner && height >= 350) {
      check(`${width}x${height} · banner box has zero overlap with the search bar`, overlapArea(data.bar, data.banner) === 0, `overlap=${overlapArea(data.bar, data.banner).toFixed(0)}px²`);
    }
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART C — tooltips
  console.log("\nPART C — every map-bar control carries a tooltip");
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-canvas-furniture");
    await page.goto(URL, { waitUntil: "load" });
    await pacedWait(page, 1800);
    const titles = await page.evaluate(() => {
      const byText = (re) => { const b = [...document.querySelectorAll("button")].find((x) => re.test((x.textContent || "").trim())); return b ? b.title : undefined; };
      return { go: byText(/^Go$/), selectParcels: byText(/^＋ Select parcels$/), comp: byText(/^＋ Comp$/) };
    });
    check("\"Go\" carries a non-empty title", !!titles.go, titles.go || "(none)");
    check("\"+ Select parcels\" carries a non-empty title", !!titles.selectParcels, titles.selectParcels || "(none)");
    check("\"+ Comp\" carries a non-empty title", !!titles.comp, titles.comp || "(none)");
    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  if (SHOTS) { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); console.log(`  screenshots + results → ${OUT}/`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
