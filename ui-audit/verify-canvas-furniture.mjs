#!/usr/bin/env node
/* NEW-MAPCTRL-3 — CANVAS FURNITURE STACKING, the general case of the Comps/Layers corner
 * collision (`verify-map-comps-overlap.mjs`), on two different screens:
 *
 *  PART A — the Site Planner canvas (SitePlanner.jsx). Below ~760 CSS px the side rails used to
 *  collapse into "✎ Properties" / "✎ Tools" FABs squatting in the two bottom corners, which
 *  forced every piece of passive bottom furniture (the scale bar, the "● Scaled · county GIS"
 *  calibration badge, the north arrow) to reserve extra clearance (`FAB_RESERVE_PX`) so it never
 *  rendered underneath one.
 *
 *  ⛔ SUPERSEDED (NEW-1..NEW-5, the phone-chrome-parity pass, 2026-09-12) — read this before
 *  trusting any comment below this line that still mentions a FAB. THE FINDING that drove that
 *  pass: phone and desktop placed every OTHER control in the same corner with the same offset,
 *  except the two buttons that summon the left rail and the right tool rail — on desktop those
 *  rails ARE the screen edges; on the phone their FABs squatted in the two BOTTOM corners
 *  instead, which is what forced `FAB_RESERVE_PX` to exist at all. The fix: both summoning
 *  controls became EDGE TABS at the side of the screen (`[data-testid="mobile-panels-tab"]` /
 *  `[data-testid="mobile-tools-tab"]`, `Show Land / Analysis / Yield / Properties / Overlays /
 *  Standards` — "Sections" renamed "Panels" — described nothing), the standalone "✎ Properties"
 *  quick-access pill was removed outright (Properties is reached inside the Panels drawer, same
 *  as it's a tab inside the rail on desktop), the bottom corners are free again, and
 *  `FAB_RESERVE_PX` is gone from `sheetFurniture.js` — `FURNITURE_ROW` is a small fixed offset
 *  plus the real numeric safe-area inset (`narrowSafeBottom`) instead. The scale bar's own
 *  screen-pixel target/ceiling now fold in the real pane width (NEW-3, `screenFurniturePlates`'s
 *  `paneW`), and the zoom column + the docked help/report control share ONE pointer-driven size
 *  (NEW-4, 35×35 coarse / 30×30 fine) instead of two different ones in the same corner. PART A
 *  below is the harness NEW-5 extended to cover the whole set — see its own header comment just
 *  above the width sweep for what's new.
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
 *  rather than float free, at every width, narrow width included.
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

  // ─────────────────────────────────────────── PART A — Site Planner canvas furniture
  console.log("\nPART A — Site Planner canvas furniture (north arrow · scale bar · calibration badge · coordinate chip · Panels/Tools edge tabs · View/Layers cards · zoom stack · docked help control · the bottom-centre canvas toast · road-draft status strip)");
  const PARCEL = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
  // NOTE (B1239328): the `parcel-select-hint` toast this section used to raise (by seeding a
  // LOCKED parcel with the old plan-wide "Select parcels" toggle OFF, so a boundary press was a
  // provable click-through) was removed along with that whole mechanism — locking is now a
  // per-parcel attribute with no toast of its own. The parcel below stays LOCKED (still exercises
  // real click-through geometry for other purposes in this file) but no longer produces a toast to
  // check against this furniture; the road-draft-status strip check further down still exercises a
  // bottom-centre surface against the same furniture set.
  const site = { s_furn: { id: "s_furn", groupId: "s_furn", site: "Furniture Verify", name: "Plan 1", status: "active", origin: { lat: 29.80, lon: -95.83 }, county: "harris", parcels: [{ id: "pA", points: PARCEL, locked: true }], els: [], measures: [], callouts: [], markups: [], deletedIds: [], settings: {}, underlay: null, updatedAt: 1755000000000 } };
  const seedSite = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)})); localStorage.setItem('planarfit:currentSite:v1', 's_furn'); } catch (e) {} })();`;

  /* NEW-5 (phone-chrome-parity pass) — the width sweep now runs the SAME assertion pass at every
   * scene, narrow and desktop alike, plus two scenes the old sweep never covered:
   *   - a genuine SHORT-height LANDSCAPE phone (568×320 — the exact B1338272 iPhone-SE-landscape
   *     repro), because a purely width-driven sweep can never see a canvas short enough that the
   *     bottom stack's own top edge climbs into the top row.
   *   - a FORCED SAFE-AREA scene: headless Chromium renders no physical notch, so
   *     `env(safe-area-inset-bottom)` reads 0 in every other scene here — this one overrides the
   *     safeAreaInsets.js probe element's computed padding directly (the same SIMULATED technique
   *     verify-help-report-control.mjs's PART F already uses) so the numeric safe-area wiring
   *     (`narrowSafeBottom`, SitePlanner.jsx) is actually exercised end to end rather than trusted
   *     from reading the source. */
  const SCENES = [
    ...[1440, 1024, 900, 750, 600, 430, 390].map((width) => ({ width, height: 900, label: `${width}px` })),
    { width: 568, height: 320, label: "568x320 landscape" },
    { width: 390, height: 900, label: "390px · forced safe-area", forceSafeArea: 34 },
  ];

  for (const scene of SCENES) {
    const ctx = await browser.newContext({ viewport: { width: scene.width, height: scene.height } });
    await ctx.addInitScript(seedSite);
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-canvas-furniture");
    // ⛔ B1231282 — a bare hash no longer resumes into a seeded site: the route is authoritative
    // for which project is open (`bootResume.js`), and a project-less route shows the Dashboard
    // (or, for `#/site`, the Sites picker) regardless of `planarfit:currentSite:v1`. This harness
    // predates that change and silently timed out on every run since — same fix
    // verify-help-report-control.mjs already applies: name the seeded groupId explicitly.
    await page.goto(URL + "#/project/s_furn/site", { waitUntil: "load" });
    await page.waitForSelector('svg[aria-label="Site plan canvas"]', { timeout: 15000 });
    await pacedWait(page, 2200);
    if (scene.forceSafeArea) {
      await page.addStyleTag({ content: `[data-safe-area-probe] { padding-bottom: ${scene.forceSafeArea}px !important; }` });
      // The probe override alone doesn't re-run SitePlanner's own resize-triggered re-measure —
      // dispatch a real resize event so its effect reads the now-overridden inset.
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await pacedWait(page, 400);
    }
    const svgBox = await page.locator('svg[aria-label="Site plan canvas"]').boundingBox().catch(() => null);
    if (svgBox) { await page.mouse.move(svgBox.x + svgBox.width / 2, svgBox.y + svgBox.height / 2, { steps: 3 }); await pacedWait(page, 500); }

    const data = await page.evaluate(() => {
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const panelsTab = document.querySelector('[data-testid="mobile-panels-tab"]');
      const toolsTab = document.querySelector('[data-testid="mobile-tools-tab"]');
      const viewCard = document.querySelector('[data-testid="view-menu-btn"]');
      const layersCard = document.querySelector('[data-testid="layer-panel"]');
      const badge = [...document.querySelectorAll("div")].find((d) => /^[●▲]/.test((d.textContent || "").trim()) && (d.textContent || "").length < 60);
      const cursorInner = document.querySelector("[data-ground-el]");
      let cursorChip = cursorInner;
      while (cursorChip && !(cursorChip.style && cursorChip.style.position === "absolute")) cursorChip = cursorChip.parentElement;
      const furnContainer = [...document.querySelectorAll('div[data-export="skip"]')].find((d) => d.children.length === 2 && d.style.zIndex === "400");
      const plates = furnContainer ? [...furnContainer.children] : [];
      const scaleBarWrap = plates.find((p) => p.style.right);
      const northWrap = plates.find((p) => p.style.left);
      // B914500 — the bottom-right zoom control column (+/−/fit, "gbtn" buttons; the report-slow
      // 4th button was folded into the global help/report control by B1231281) joins the
      // furniture-collision set.
      const zoomStack = document.querySelector('[data-canvas-corner="zoom-stack"]');
      const helpFab = document.querySelector('[data-testid="help-report-fab"]');
      return {
        narrow: window.matchMedia("(max-width: 760px)").matches,
        panelsTab: rectOf(panelsTab), toolsTab: rectOf(toolsTab),
        viewCard: rectOf(viewCard), layersCard: rectOf(layersCard),
        badge: rectOf(badge), cursorChip: rectOf(cursorChip),
        scaleBar: rectOf(scaleBarWrap), north: rectOf(northWrap),
        zoomStack: rectOf(zoomStack), helpFab: rectOf(helpFab),
        helpDocked: helpFab ? helpFab.getAttribute("data-docked") === "1" : false,
      };
    });
    const w = scene.label;

    check(`${w} · narrow=${data.narrow} · north arrow renders`, !!data.north);
    check(`${w} · scale bar renders`, !!data.scaleBar);
    check(`${w} · calibration badge renders`, !!data.badge);

    if (data.narrow) {
      check(`${w} · coordinate chip is DROPPED (lowest priority, no room)`, data.cursorChip === null, data.cursorChip ? "still rendered" : "");
      check(`${w} · Panels edge tab renders`, !!data.panelsTab);
      check(`${w} · Tools edge tab renders`, !!data.toolsTab);
    } else {
      check(`${w} · coordinate chip still renders on desktop`, !!data.cursorChip);
      check(`${w} · no Panels/Tools edge tab on desktop (the rails render inline instead)`, !data.panelsTab && !data.toolsTab);
    }

    // NEW-5 — the full pairwise sweep over every named furniture/chrome item that exists at this
    // width: no two of them may overlap. A pair that doesn't apply here (e.g. the edge tabs on
    // desktop, where the rails render inline instead) simply drops out of `names` — comparing
    // against a missing rect scores 0 overlap by construction, so a width can never silently skip
    // a real pair, it just has fewer of them to check.
    const items = {
      "Panels edge tab": data.panelsTab, "Tools edge tab": data.toolsTab,
      "View card": data.viewCard, "Layers card": data.layersCard,
      "north arrow": data.north, "calibration badge": data.badge,
      "scale bar": data.scaleBar, "zoom stack": data.zoomStack,
      "help control": data.helpFab,
    };
    const names = Object.keys(items).filter((k) => items[k]);
    /* ⛔ NAMED, ACCEPTED EDGE CASE (found via this exact landscape scene) — on the smallest current
     * iPhone in landscape (263px canvas), there is not enough vertical room to fit the View/Layers
     * row, the Tools edge tab (84px), the zoom stack (90px) AND the scale bar's own plate without
     * ANY pair touching: their combined minimum footprint exceeds the pane. `test/mapChromeStack
     * .test.js` already names this same shape ("once the floor itself binds... clearing the top
     * row is no longer possible at any offset") for the View row; this is the same trade-off one
     * level down. The floor above is fixed to clear the SCALE BAR first (B914500's original
     * defect — a covered plate makes its numbers unreadable, the more severe failure), which can
     * leave the zoom stack's own top edge lightly touching the Tools tab's bottom — two adjoining
     * interactive controls, never unreadable content. Bounded to a small tolerance and to exactly
     * this one pair, so it can never silently swallow an unrelated regression. */
    const KNOWN_EDGE_CASE = scene.width === 568 && scene.height === 320;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j];
        const ov = overlapArea(items[a], items[b]);
        const isNamedPair = (a === "Tools edge tab" && b === "zoom stack") || (a === "zoom stack" && b === "Tools edge tab");
        const allowed = KNOWN_EDGE_CASE && isNamedPair ? 250 : 0;
        check(`${w} · ${a} does not overlap ${b}`, ov <= allowed, ov > 0 ? `${Math.round(ov)}px² overlap${allowed ? ` (<=${allowed}px² accepted — see the named edge case above)` : ""}` : "");
      }
    }

    // NEW-5 — the calibration badge is NOT raised at 390px. With FAB_RESERVE_PX gone (NEW-2), the
    // badge fits beside the north arrow on the SAME row once more (the reported defect this
    // closes was that the badge/coordinate row lifted to clear a FAB that no longer exists).
    // "Not raised" reads geometrically: the badge's own bottom edge sits on the same row as the
    // north arrow's, not measurably higher up the screen.
    if (scene.width === 390 && data.badge && data.north) {
      const raisedPx = data.north.b - data.badge.b; // positive = badge sits higher on screen
      check(`${w} · calibration badge is NOT raised (fits beside the north arrow)`, raisedPx <= 4, `north.bottom=${data.north.b.toFixed(1)} badge.bottom=${data.badge.b.toFixed(1)}`);
    }

    // NEW-5 — the scale bar plate is never more than ~35% of the pane's width, at every width
    // (NEW-3's fix — the reported defect was "more than half" the pane at 390px).
    if (data.scaleBar && svgBox && svgBox.width > 0) {
      const frac = data.scaleBar.w / svgBox.width;
      check(`${w} · scale bar plate is <=35% of pane width`, frac <= 0.35 + 1e-6, `${(frac * 100).toFixed(1)}% of ${Math.round(svgBox.width)}px`);
    }

    // NEW-5 — every bottom-anchored item clears the safe-area inset. A no-op assertion (inset 0)
    // everywhere but the forced-safe-area scene, which is the honest baseline for every headless
    // engine here (no physical notch, so env() reads 0 without the override above).
    if (scene.forceSafeArea) {
      const inset = scene.forceSafeArea;
      for (const [name, r] of [["north arrow", data.north], ["scale bar", data.scaleBar], ["calibration badge", data.badge], ["zoom stack", data.zoomStack]]) {
        if (!r) continue;
        const clearance = scene.height - r.b;
        check(`${w} · ${name} clears the forced safe-area inset (${inset}px)`, clearance >= inset - 1, `clearance=${clearance.toFixed(1)}px`);
      }
    }

    // NEW-5 — desktop geometry is pinned to the values this pass must not move: FURNITURE_ROW
    // (40px from the pane's own bottom edge — unchanged on desktop, see FURNITURE_ROW's own
    // header in SitePlanner.jsx), the zoom stack's un-clamped offset (100px, this scene's 900px
    // pane height never triggers B1338272's clamp), and the zoom buttons' fine-pointer size
    // (30×30 = CONTROL_H.lg — Playwright's default context has no `hasTouch`, so this is always
    // the fine-pointer branch of NEW-4's size split).
    if (!data.narrow && svgBox && data.north && data.scaleBar && data.zoomStack) {
      const paneBottom = svgBox.y + svgBox.height;
      const northRow = paneBottom - data.north.b;
      const sbRow = paneBottom - data.scaleBar.b;
      const zoomRow = paneBottom - data.zoomStack.b; // the stack's own `bottom` CSS offset
      check(`${w} · desktop FURNITURE_ROW is still 40px`, Math.abs(northRow - 40) <= 2, `row=${northRow.toFixed(1)}px`);
      check(`${w} · desktop scale-bar row matches the north-arrow row`, Math.abs(sbRow - northRow) <= 2, `sb row=${sbRow.toFixed(1)}px`);
      check(`${w} · desktop zoom stack's un-clamped offset is still 100px`, Math.abs(zoomRow - 100) <= 2, `zoom row=${zoomRow.toFixed(1)}px`);
      const zoomBtnH = data.zoomStack.h / 3;
      check(`${w} · desktop zoom buttons are still 30×30 (CONTROL_H.lg, fine pointer)`, Math.abs(zoomBtnH - 30) <= 1, `btnH=${zoomBtnH.toFixed(1)}px`);
    }

    // NEW-5 — the docked help control matches the zoom column's own pointer-driven width (NEW-4):
    // the reported mismatch was two controls in one corner at two different sizes.
    if (data.helpFab && data.zoomStack && data.helpDocked) {
      check(`${w} · docked help control matches the zoom column's width (NEW-4)`, Math.abs(data.helpFab.w - data.zoomStack.w) <= 1, `help=${data.helpFab.w.toFixed(1)} zoom=${data.zoomStack.w.toFixed(1)}`);
    }

    // B750096 — the road-draft "finish" status strip (bottom-center, replaces the old in-canvas
    // click-swallowing chip) must join this SAME collision-aware furniture set: assert it never
    // overlaps the north arrow / scale bar / calibration badge / Tools edge tab, at every width,
    // and that its Done button is actually hit-testable (not painted-over by anything).
    if (data.narrow && data.toolsTab) {
      await page.locator('[data-testid="mobile-tools-tab"]').click().catch(() => {});
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
      check(`${w} · road-draft status strip renders while drawing a road`, stripVisible);
      if (stripVisible) {
        const stripBox = await strip.boundingBox().catch(() => null);
        const sr = stripBox ? { l: stripBox.x, t: stripBox.y, r: stripBox.x + stripBox.width, b: stripBox.y + stripBox.height } : null;
        check(`${w} · status strip does not overlap the north arrow`, overlapArea(sr, data.north) === 0, `overlap=${overlapArea(sr, data.north).toFixed(0)}px²`);
        check(`${w} · status strip does not overlap the scale bar`, overlapArea(sr, data.scaleBar) === 0, `overlap=${overlapArea(sr, data.scaleBar).toFixed(0)}px²`);
        check(`${w} · status strip does not overlap the calibration badge`, overlapArea(sr, data.badge) === 0, `overlap=${overlapArea(sr, data.badge).toFixed(0)}px²`);
        if (data.narrow && data.toolsTab) {
          check(`${w} · status strip does not overlap the Tools edge tab`, overlapArea(sr, data.toolsTab) === 0, `overlap=${overlapArea(sr, data.toolsTab).toFixed(0)}px²`);
        }
        // real hit test — the Done button must actually be reachable, not covered by anything
        // (the SAME class of check the FOREGROUND-OR-VOID / chrome-swallows-press family use —
        // a layout rect proves nothing about what actually paints/hit-tests at that point).
        const doneBox = await page.locator('[data-testid="road-draft-finish"]').boundingBox().catch(() => null);
        if (doneBox) {
          const dcx = doneBox.x + doneBox.width / 2, dcy = doneBox.y + doneBox.height / 2;
          const reaches = await hitReaches(page, dcx, dcy, '[data-testid="road-draft-finish"]');
          check(`${w} · the Done button is actually clickable (not covered)`, reaches);
        }
      }
      await page.keyboard.press("Escape").catch(() => {});
    } else {
      check(`${w} · Road tool reachable to verify the draft status strip`, false, "Road tool button not found");
    }

    if (SHOTS) await page.screenshot({ path: `${OUT}/planner-w${scene.width}x${scene.height}.png` });
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART B — Map view coach-tip vs search bar
  console.log("\nPART B — Map view: the \"+ Select parcels\" coach tip never renders under the search bar");
  // A short HEIGHT is the reproduction — the reported collision needs a genuinely short pane
  // (a landscape phone/tablet), not just a narrow width. Test the width matrix at a normal
  // height, AND the exact narrow width at a short height (the measured reproduction).
  for (const [width, height] of [...[1440, 1024, 900, 750, 600, 420].map((w) => [w, 900]), [729, 350], [729, 300]]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-canvas-furniture");
    // ⛔ B1231282 — a bare hash lands on the Dashboard, not the Map screen this part drives (see
    // PART A's own header note on the same fix). `#/site` is the project-less Map/Sites screen.
    await page.goto(URL + "#/site", { waitUntil: "load" });
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
    // ⛔ B1231282 — same fix as PART A/B: a bare hash lands on the Dashboard, not the Map screen.
    await page.goto(URL + "#/site", { waitUntil: "load" });
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
