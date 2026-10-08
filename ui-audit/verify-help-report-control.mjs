#!/usr/bin/env node
/* verify-help-report-control — B842864/B842865: the global help/report control the app shell
 * mounts on every route, and the adversarial-review questions the dispatch asked for by name.
 *
 * ⛔ B1167120 (owner report, 2026-09-05) — PART A now also proves the control's `bottom` offset
 * is MEASURED, never a constant. The shipped control fixed `bottom:292` at every breakpoint on
 * every route, sized to clear the tallest thing that could ever occupy this corner anywhere in
 * the app (the Site Planner canvas's own narrow-width zoom stack) — so on the map root, a
 * schedule route and a project-model route (none of which has that stack, or anything else, in
 * the corner) it rendered byte-identically at `bottom:292`, which on the owner's real viewport
 * put it 63% of the way up the screen. Fixed in `shared/ui/cornerClearance.js`: the control now
 * measures the real DOM and clears only what is genuinely there. Two things this file now
 * proves that it did not before: **(a)** on a route with no bottom-right chrome at all
 * (schedule, model, and the desktop-width plan canvas — where the docked tool rail insets the
 * canvas's own furniture away from the true viewport edge), the control's distance from the
 * bottom edge is SMALL — this assertion is what would have failed against the old 292px
 * constant. **(b)** on the map screen, the control clears BOTH of Leaflet's bottom-right
 * controls — attribution AND the graphic scale (`L.control.scale(...,{position:"bottomright"})`,
 * MapFinder.jsx) — not just attribution, which is all the original harness checked.
 *
 * PART A — reachable, unobstructed, on the MAP screen (MapFinder.jsx), the PLAN screen
 * (SitePlanner.jsx canvas), and two chrome-free routes (Scheduler, Model), at a desktop and a
 * narrow width: no overlap with Leaflet's zoom/attribution/scale controls, the canvas's own
 * scale bar / north arrow / zoom stack, or the narrow-only "✎ Tools" FAB. Real `elementFromPoint`
 * hit tests, not bounding-box math alone (FOREGROUND-OR-VOID's sibling: a clipped box can report
 * an overlapping rect while painting nothing there).
 * PART B — a drag starting just outside the control's own small box still pans the map/canvas
 * (the control is not a full-viewport pointer-events layer).
 * PART C — keyboard reachable: Tab focuses it, Enter opens the menu, Escape closes it.
 * PART D — the acceptance test that matters: pressing "Something was slow" on the MAP SCREEN
 * (where no other trigger for the always-on recorder exists at all) actually reaches the SAME
 * global recorder main.jsx installs, and a capture is taken.
 * PART E — ⛔ THE ACCEPTANCE TEST TAKEN LITERALLY (owner pushback, 2026-09-05): "a capture was
 * taken" is not "the payload names what was responsible." Induces a REAL ~350ms main-thread
 * stall on the map screen via a real, named function wired to a real `pointerdown` listener —
 * injected as an actual `<script>` element (a genuine script resource with its own source
 * position), never a `page.evaluate()` snippet, which a first attempt found reports EMPTY
 * attribution (no sourceFunctionName, no sourceURL — a real Chromium limitation on anonymous/
 * CDP-evaluated code, not a flaw in the recorder). Reads the FULL on-device capture back
 * directly from this origin's IndexedDB (`planyr`/`kv`, `perfcap:` keys) — the actual payload a
 * real send/local-store round trip carries — because `window.pfRec.captures()` is a small
 * live-console triage summary with no task table at all by design (`perfRecorder.js`'s
 * `_captures`), and asserting against that instead would silently prove nothing. Asserts the
 * worst (top-sorted) long-task row's name resolves to the real function, not merely that `lt`
 * is non-empty.
 *
 * ⛔ B1176480 (owner report, 2026-09-05) — PART F checks the control on iPhone-class screens:
 * safe-area clearance, the 44×44 tap target, popover fit with no horizontal overflow, and that
 * the new `visualViewport` resize/scroll listeners actually trigger a re-measure (not just that
 * dispatching them doesn't throw).
 *
 * ⛔ B1231280/B1231281 (owner chat block, 2026-09-06) — PART D was rewritten and PART G added.
 * "The capture is taken at open, not at send" is now asserted literally: `pfRec.state().sent`
 * must increment on the FAB press that opens the control (before any menu choice exists) and
 * must NOT increment again when "Something was slow" (PART D) or "Report a problem" (PART G) is
 * then chosen — both attach the one capture already taken, never a second one. PART G also checks
 * the "Report a problem" disclosure honestly names the attached performance snapshot before he
 * sends anything (it never used to attach one at all). The old PART D read `before`/`after`
 * bracketing only the row's own click, which is why it went from a pass to `1 -> 1` under the new
 * behaviour — that failure IS the acceptance test working, not a regression; see this file's git
 * history if a future session needs the old (pre-B1231280) shape for reference.
 *
 * ⛔ B1231282 (found this session, AUDIT-FIRST) — `openScreen`'s "map"/"plan" modes used to
 * navigate to a bare hash (""), which B1213312 repointed from the Site Planner to the Dashboard
 * (route.js: "bare '#/' used to be a plain alias for 'site-planner, no project'... EVERY
 * project-less module now gets its own named slug"). Every PART here still "passed" on the wrong
 * screen — no Leaflet, no canvas, nothing this file's own PART B/D/E claims to exercise was ever
 * actually reached — until the hash was corrected to the named slug (`#/site`). Filed as its own
 * item rather than silently fixed in passing, because it affects `verify-capture-pipe.mjs` too
 * and predates this session's own changes (reproduces byte-identically on an unmodified build).
 *
 * ⛔ B1162016 (owner report, 2026-09-07) — PART I proves the control sizes by POINTER
 * CAPABILITY, never viewport width: a fine pointer (mouse/trackpad) gets `CONTROL_H.lg` (30, the
 * app's standard desktop icon-button size) instead of the 44px touch floor, checked at BOTH a
 * wide (1440px) and a narrow (390px) viewport so width alone can never be what decided it either
 * direction; a coarse (touch) pointer keeps the 44px floor even at a desktop-wide 1440px
 * viewport, for the same reason. A fourth arm mocks `matchMedia("(pointer: coarse)")`'s own
 * `change` event (Playwright/CDP have no way to flip a REAL device's pointer type mid-session) to
 * prove two things end to end, live, no reload: the button itself resizes, AND — the easy part to
 * get wrong per the dispatch brief — `cornerClearanceFromBottom`'s occupant-overlap math re-runs
 * against the NEW size, not the one it mounted with. That second half is proven with a purpose-
 * built occupant positioned so it overlaps the button's own column ONLY at the wider (44px) size
 * and misses it at the narrower (30px) size (worked out from `cornerClearance.js`'s own
 * `colLeft = vw - right - width` math) — so a stale `width` fed into that function reads as
 * `fabBottom` staying near the true corner even after the button visually grows, while the fix
 * reads as `fabBottom` jumping to clear the now-overlapping occupant.
 *
 * ⛔ HONESTY, three tiers — read before trusting a line of this section's own output, and see
 * `VERIFICATION.md` → Self-verification for the standing, repo-wide version of the same note
 * (added 2026-09-05 by B1168128, the same day):
 *   EMULATED  — real Playwright device descriptors (`devices["iPhone 15"]` etc. — genuine
 *               isMobile/hasTouch/deviceScaleFactor/mobile UA, never a bare resized viewport),
 *               on WebKit when it launches, on Chromium (loudly labeled) when it doesn't. This
 *               sandbox's WebKit binary downloads (`npx playwright install webkit`) but cannot
 *               LAUNCH — the host is missing shared libraries (`libgtk-4.so.1` and others) that
 *               `--with-deps` would install via `apt`, which this sandbox has no path to do
 *               safely — so every run here falls back to Chromium and says so; this is a
 *               documented environment fact, not a guess, and the fallback path is real,
 *               exercised code, not a stub. A real WebKit install (a dev machine, or CI with
 *               `--with-deps webkit`) runs the SAME code on the real engine with no changes.
 *   SIMULATED — the safe-area assertions. Neither engine's headless mode renders a physical
 *               notch, so `env(safe-area-inset-*)` resolves to 0 in both — this section forces a
 *               non-zero reading by overriding `safeAreaInsets.js`'s own probe element's computed
 *               padding with an injected `!important` CSS rule (targeting its
 *               `[data-safe-area-probe]` marker), which proves the JS-read-into-pixel-math path
 *               works without pretending to have measured a real device.
 *   UNVERIFIED-ON-DEVICE — real iOS Safari's own `env()` resolution and its collapsing-toolbar
 *               `visualViewport` behavior. Nothing here should be read as "confirmed on an
 *               iPhone."
 *
 * ⛔ NEW-B# (owner, 2026-09-07/08) — PART H is a NEW, GENERIC per-route sweep: "does the control's
 * box intersect ANY interactive element's box" at every named route's idle state, narrow + wide —
 * not the hand-picked occupant list PART A already checks. It exists because B1239217 (the Model
 * workspace's "+ Add sheet" tab-strip button) was never on that list and went unnoticed for a
 * whole session; see PART H's own header comment for why it is scoped to each route's IDLE state
 * (a deliberately-opened panel like Comps' entry grid correctly outranks the control by z-index,
 * which a bbox-only sweep can't tell from a real collision). Same owner dispatch also moved the
 * control's placement on the MAP and SITE PLANNER routes off `position:fixed` entirely — it now
 * docks (via `shared/ui/chromeDock.js`) as real furniture inside each pane, portaled in when a
 * dock is registered; PART A's assertions about clearing specific occupants there still hold
 * (the docked button still never overlaps the zoom stack / Leaflet controls / the ✎ Tools FAB, by
 * construction of where the dock anchor sits), they just no longer describe `position:fixed` math.
 *
 * ⛔ B1336528 (owner chat block "NEW-1", 2026-09-08) — PART J: the Schedule route's grid lives inside a
 * same-origin `<iframe src="/sequence/">`, which `cornerClearanceFromBottom` used to never
 * query — a genuine occupant a screen down inside that iframe read as "nothing in this corner"
 * from the parent document alone. Fixed in `shared/ui/cornerClearance.js` (content-aware,
 * same-origin iframe descent via `elementsFromPoint`, capped so a degenerate hit can't
 * reproduce the old reserve-everything bug). PART J proves the exact shipped mechanism against a
 * self-contained, zero-network synthetic iframe fixture rather than the real Schedule route,
 * because THIS SANDBOX's headless Chromium cannot reach any external host at all —
 * `/sequence/index.html` loads `@supabase/supabase-js`/`@tabler/icons-webfont` synchronously
 * from `cdn.jsdelivr.net`, and that CONNECT tunnel measurably closes after ~6s through this
 * session's own egress proxy (curl through the identical proxy succeeds; Chromium does not — see
 * `cornerClearance.js`'s header for the full measurement). A live pass against the real Schedule
 * route with real project data is filed as its own `VERIFICATION.md` entry, closable by any
 * environment with ordinary internet access (a real browser, or CI).
 *
 *   node ui-audit/verify-help-report-control.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium, webkit, devices } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { swallowReportWrites } from "./lib/reportCleanup.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/help-report-control";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
const overlapArea = (a, b) => { if (!a || !b) return 0; const ox = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)); const oy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)); return ox * oy; };

const PARCEL = [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }];
const site = { s_help: { id: "s_help", groupId: "s_help", site: "Help Control Verify", name: "Plan 1", status: "active", origin: { lat: 29.80, lon: -95.83 }, county: "harris", parcels: [{ id: "pA", points: PARCEL, locked: true }], els: [], measures: [], callouts: [], markups: [], deletedIds: [], settings: {}, underlay: null, updatedAt: 1755000000000 } };
const seedPlan = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)})); localStorage.setItem('planarfit:currentSite:v1', 's_help'); } catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  async function openScreen({ width, height = 900, mode }) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
    if (mode === "plan") await ctx.addInitScript(seedPlan);
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-help-report-control");
    /* ⛔ B1231282 (found this session, AUDIT-FIRST) — a bare "#/" no longer reaches the Site
     * Planner at all. B1213312 gave "#/" to the Dashboard (route.js's own header: "bare '#/' used
     * to be a plain alias for 'site-planner, no project'... EVERY project-less module now gets its
     * own named slug"), so every mode here landing on the empty hash silently opened the Dashboard
     * instead — no Leaflet, no canvas, and every check downstream of that failed for a reason that
     * had nothing to do with what it claimed to test (measured: this reproduces byte-identically
     * on an UNMODIFIED build, so it predates and is unrelated to B1231280/B1231281).
     * ⛔ AND A SECOND, DISTINCT LAYER UNDER "plan" MODE, found while proving the first fix: `#/site`
     * (the named slug that replaced the bare default) is "site-planner, NO PROJECT" — the picker,
     * per route.js's own grammar table. It is not, and was never, "open whatever `currentSite`
     * points at": `bootResume.js`'s own header states the URL is authoritative for which project is
     * open ("the route is the source of truth for WHICH project is open"), so a project-less route
     * shows the picker regardless of what's in `planarfit:currentSite:v1`. Confirmed directly:
     * `#/site` with this file's seeded plan renders the Sites list with "Help Control Verify" as an
     * entry to click into, never the open canvas; `#/project/s_help/site` (the seeded groupId) opens
     * it immediately. So "plan" mode names the project explicitly; "map" mode deliberately keeps the
     * project-less `#/site` — the picker/Leaflet screen IS the map screen this file means. */
    const hash = mode === "schedule" ? "#/schedule" : mode === "model" ? "#/model"
      : mode === "plan" ? "#/project/s_help/site" : "#/site";
    await page.goto(URL + hash, { waitUntil: "load" });
    if (mode === "plan") {
      await page.waitForSelector('svg[aria-label="Site plan canvas"]', { timeout: 15000 }).catch(() => {});
    } else if (mode === "map") {
      // Map mode: wait for the Leaflet map container to exist.
      await page.waitForSelector(".leaflet-container", { timeout: 15000 }).catch(() => {});
    }
    // "schedule"/"model" — chrome-free routes, no canvas/Leaflet selector to wait for; the FAB
    // wait below is the only readiness signal they need.
    await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 });
    await pacedWait(page, 1500);
    return { ctx, page };
  }

  // ─────────────────────────────────────────── PART A — no overlap, every screen/breakpoint
  console.log("\nPART A — no overlap with Leaflet controls / canvas furniture / the ✎ Tools FAB, and no more than a small clearance where none of that exists");
  // "chromeFree" routes carry NOTHING that could occupy the bottom-right corner — no Leaflet map,
  // no Site Planner canvas — so a control measuring correctly must sit close to the true corner
  // there. This is the assertion that fails outright against the old 292px constant.
  // ⛔ NEW-B# (owner, 2026-09-07) — "docked" routes (map + plan) are DELIBERATELY no longer
  // chrome-free at all: the control now rides the map/canvas chrome stack (chromeDock.js) instead
  // of floating at the true viewport corner, so on desktop it sits beside the zoom stack / the
  // Leaflet corner — genuinely further from the true edge than before, which is the ARCHITECTURE
  // change, not a regression. `plan@1440` therefore drops its old `chromeFree` claim; `docked`
  // scenes get their own assertion below (same row as the reference furniture) instead.
  const SCENES = [
    { mode: "map", width: 1440, label: "map@1440", docked: true },
    { mode: "map", width: 390, label: "map@390", docked: true },
    { mode: "plan", width: 1440, label: "plan@1440", docked: true },
    { mode: "plan", width: 390, label: "plan@390", docked: true },
    { mode: "schedule", width: 1440, label: "schedule@1440", chromeFree: true },
    { mode: "model", width: 1440, label: "model@1440", chromeFree: true },
  ];
  // Michael's own production measurement: byte-identical bottom:292 puts the control 63% of the
  // way up a 465px-tall viewport. A genuinely adaptive control on a chrome-free route should sit
  // within a small multiple of its own right-inset of the corner — generous enough to allow for
  // a themed border/shadow, nowhere close to what a leftover reservation would produce.
  const SMALL_CLEARANCE_PX = 40;

  for (const scene of SCENES) {
    const { ctx, page } = await openScreen(scene);
    const data = await page.evaluate(() => {
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      const fabEl = document.querySelector('[data-testid="help-report-fab"]');
      return {
        viewportH: window.innerHeight,
        fab: rectOf(fabEl),
        docked: fabEl ? fabEl.getAttribute("data-docked") === "1" : false,
        leafletZoom: rectOf(document.querySelector(".leaflet-control-zoom")),
        leafletAttr: rectOf(document.querySelector(".leaflet-control-attribution")),
        leafletScale: rectOf(document.querySelector(".leaflet-control-scale")),
        toolsFab: rectOf(document.querySelector('[data-canvas-corner="tools-fab"]')),
        zoomStack: rectOf(document.querySelector('[data-canvas-corner="zoom-stack"]')),
      };
    });
    check(`${scene.label}: FAB present`, !!data.fab, data.fab ? `${Math.round(data.fab.w)}×${Math.round(data.fab.h)} at (${Math.round(data.fab.l)},${Math.round(data.fab.t)})` : "missing");
    if (data.leafletZoom) {
      const ov = overlapArea(data.fab, data.leafletZoom);
      check(`${scene.label}: clear of Leaflet zoom control`, ov === 0, ov > 0 ? `${ov}px² overlap` : "");
    }
    if (data.leafletAttr) {
      const ov = overlapArea(data.fab, data.leafletAttr);
      check(`${scene.label}: clear of Leaflet attribution control`, ov === 0, ov > 0 ? `${ov}px² overlap` : "");
    }
    if (data.leafletScale) {
      const ov = overlapArea(data.fab, data.leafletScale);
      check(`${scene.label}: clear of Leaflet graphic-scale control`, ov === 0, ov > 0 ? `${ov}px² overlap` : "");
    }
    if (data.zoomStack) {
      const ov = overlapArea(data.fab, data.zoomStack);
      check(`${scene.label}: clear of the canvas zoom/report-slow stack`, ov === 0, ov > 0 ? `${ov}px² overlap (stack ${JSON.stringify(data.zoomStack)})` : "");
    }
    if (data.toolsFab) {
      const ov = overlapArea(data.fab, data.toolsFab);
      check(`${scene.label}: clear of the "✎ Tools" FAB`, ov === 0, ov > 0 ? `${ov}px² overlap` : "");
    }
    if (scene.chromeFree && data.fab) {
      const distanceFromBottom = data.viewportH - data.fab.b;
      check(`${scene.label}: sits close to the true bottom-right corner (no chrome to clear here)`, distanceFromBottom <= SMALL_CLEARANCE_PX, `${Math.round(distanceFromBottom)}px from the bottom edge (would be 292 - fab height against the old constant)`);
    }
    // NEW-B# — on the map/plan routes the control is no longer `position:fixed` chrome at all;
    // it's portaled into the route's own chrome-stack dock (chromeDock.js) and rendered
    // `position:static`. `data-docked="1"` is the direct, load-bearing proof of that — a build
    // that regresses to the old always-fixed placement fails this outright (see the mutation
    // proof in this item's own PR body / session notes).
    if (scene.docked) {
      check(`${scene.label}: the control is DOCKED (portaled into the route's own chrome stack), not position:fixed`, data.docked === true, `data-docked=${data.docked}`);
    }
    if (SHOTS) await page.screenshot({ path: `${OUT}/${scene.label}.png` }).catch(() => {});
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART B — a nearby drag still reaches the map/canvas
  console.log("\nPART B — a drag starting just outside the control still pans the map, and the control has no oversized invisible hit area");
  {
    const { ctx, page } = await openScreen({ mode: "map", width: 1440 });
    const fabBox = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="help-report-fab"]');
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });

    // The control's own hit region must be exactly its visible box — probe just outside each
    // edge and confirm none of them resolve to the FAB (no invisible padding/hit-slop stealing
    // presses meant for the map beside it).
    const edgeProbes = [
      [fabBox.left - 6, fabBox.cy], [fabBox.right + 6, fabBox.cy],
      [fabBox.cx, fabBox.top - 6], [fabBox.cx, fabBox.top - 40],
    ];
    const edgeHits = await page.evaluate((pts) => pts.map(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      const fab = document.querySelector('[data-testid="help-report-fab"]');
      return !!(el && (el === fab || fab.contains(el)));
    }), edgeProbes);
    check("no point just outside the FAB's visible box resolves to it", edgeHits.every((h) => !h), JSON.stringify(edgeHits));

    // A real drag on blank map, well clear of the control, must reach Leaflet's own pane (proof
    // no full-viewport pointer-events layer sits above the map) and actually move the view.
    const mapCenter = { x: 500, y: 450 };
    const centerTarget = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? { insideLeaflet: !!el.closest(".leaflet-container"), tag: el.tagName, cls: String(el.className) } : null;
    }, [mapCenter.x, mapCenter.y]);
    check("blank map centre resolves inside the Leaflet container, not the control", !!(centerTarget && centerTarget.insideLeaflet), JSON.stringify(centerTarget));

    const beforeTransform = await page.evaluate(() => { const p = document.querySelector(".leaflet-map-pane"); return p ? p.style.transform : null; });
    await page.mouse.move(mapCenter.x, mapCenter.y);
    await page.mouse.down();
    await page.mouse.move(mapCenter.x - 120, mapCenter.y - 80, { steps: 10 });
    await page.mouse.up();
    await pacedWait(page, 400);
    const afterTransform = await page.evaluate(() => { const p = document.querySelector(".leaflet-map-pane"); return p ? p.style.transform : null; });
    check("a real drag on the map actually pans it (map pane transform changed)", !!beforeTransform && !!afterTransform && beforeTransform !== afterTransform, `${beforeTransform} -> ${afterTransform}`);
    const menuOpenedByAccident = await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').getAttribute("aria-expanded") === "true");
    check("that drag did not open the control's menu", !menuOpenedByAccident);
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART C — keyboard reachable
  console.log("\nPART C — keyboard: Tab reaches it, Enter opens the menu, Escape closes it");
  {
    const { ctx, page } = await openScreen({ mode: "map", width: 1440 });
    await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').focus());
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
    check("the control can receive real DOM focus", focused === "help-report-fab", `activeElement testid=${focused}`);
    await page.keyboard.press("Enter");
    await pacedWait(page, 300);
    const openedAria = await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').getAttribute("aria-expanded"));
    check("Enter opens the menu (aria-expanded)", openedAria === "true", `aria-expanded=${openedAria}`);
    const itemText = await page.evaluate(() => Array.from(document.querySelectorAll("button")).some((b) => b.textContent && b.textContent.includes("Report a problem")));
    check("the menu lists Report a problem", itemText);
    await page.keyboard.press("Escape");
    await pacedWait(page, 300);
    const closedAria = await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').getAttribute("aria-expanded"));
    check("Escape closes the menu", closedAria === "false", `aria-expanded=${closedAria}`);
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART D — the acceptance test: works on the MAP screen
  console.log("\nPART D — \"Something was slow\" reaches the global recorder from the MAP screen");
  {
    const { ctx, page } = await openScreen({ mode: "map", width: 1440 });
    // Prove the recorder is genuinely installed and armed on this screen (no plan, no canvas).
    const armed = await page.evaluate(() => !!(window.pfRec && typeof window.pfRec.capture === "function"));
    check("the always-on recorder is installed on the MAP screen (no plan open)", armed);

    // A little interaction so the ring buffer actually holds frames (the recorder gates its
    // frame loop on interaction, per its own design) before pressing the control.
    await page.mouse.move(400, 400);
    await page.mouse.move(700, 500, { steps: 20 });
    await pacedWait(page, 600);

    // ⛔ B1231280 — THE ACCEPTANCE TEST: the capture is taken at the press that OPENS the
    // control, not at the "Something was slow" row's own click. `before`/`beforeOpen` brackets
    // the OPEN click; a second bracket around the row's own click then proves it does NOT take a
    // second capture — it attaches the one already taken.
    const beforeOpen = await page.evaluate(() => window.pfRec.state().sent);
    await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').click());
    await pacedWait(page, 300);
    const afterOpen = await page.evaluate(() => window.pfRec.state().sent);
    check("opening the control took the capture immediately (\"the capture is taken at open, not at send\")", afterOpen > beforeOpen, `${beforeOpen} -> ${afterOpen}`);

    const slowRow = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button"));
      return items.find((b) => b.textContent && b.textContent.includes("Something was slow"));
    });
    check("the menu offers \"Something was slow\" on the map screen", !!slowRow);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button"));
      const btn = items.find((b) => b.textContent && b.textContent.includes("Something was slow"));
      btn.click();
    });
    await pacedWait(page, 500);
    const afterSubmit = await page.evaluate(() => window.pfRec.state().sent);
    check("clicking \"Something was slow\" does NOT take a second capture — it attaches the one already taken at open", afterSubmit === afterOpen, `${afterOpen} -> ${afterSubmit}`);
    const captures = await page.evaluate(() => window.pfRec.captures());
    const last = captures[captures.length - 1];
    check("the capture is recorded on this device", !!last, JSON.stringify(last || {}));
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART E — the payload actually names the culprit
  console.log("\nPART E — a genuine induced stall is correctly ATTRIBUTED, not just captured");
  {
    const { ctx, page } = await openScreen({ mode: "map", width: 1440 });

    // Real <script> injection, not page.evaluate() — a CDP-evaluated function carries no source
    // position or URL and would understate real attribution fidelity (measured: empty name AND
    // empty url on a page.evaluate()-injected function, vs. the real bundle's own long tasks
    // correctly naming themselves in the same run).
    await page.addScriptTag({ content: `
      function onFirstPress() {
        const end = performance.now() + 350;
        let x = 0;
        while (performance.now() < end) { x += Math.sqrt(x + 1); }
        window.__stallResult = x;
      }
      document.body.addEventListener("pointerdown", onFirstPress, { once: true });
    ` });

    await page.mouse.move(400, 400);
    await page.mouse.move(700, 500, { steps: 10 });
    await pacedWait(page, 300);
    await page.mouse.click(600, 400); // fires the real pointerdown -> the 350ms busy loop
    await pacedWait(page, 1200); // let the platform's own LoAF reporting queue flush

    const stallRan = await page.evaluate(() => typeof window.__stallResult === "number");
    check("the induced stall actually ran", stallRan);

    await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').click());
    await pacedWait(page, 300);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button"));
      const btn = items.find((b) => b.textContent && b.textContent.includes("Something was slow"));
      btn.click();
    });
    await pacedWait(page, 500);

    // Read the FULL on-device capture directly from IndexedDB — pfRec.captures() is a triage
    // summary with no task table by design (perfRecorder.js's `_captures`).
    const fullCapture = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open("planyr");
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) return resolve(null);
        const tx = db.transaction("kv", "readonly");
        const range = IDBKeyRange.bound("perfcap:", "perfcap:￿", false, true);
        const cur = tx.objectStore("kv").openCursor(range, "prev"); // newest first
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c) return resolve(null);
          try { resolve(JSON.parse(c.value)); } catch (_) { resolve(null); }
        };
        cur.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    }));

    const lt = (fullCapture && Array.isArray(fullCapture.lt)) ? fullCapture.lt : [];
    const ltNames = (fullCapture && Array.isArray(fullCapture.ltNames)) ? fullCapture.ltNames : [];
    check("the full capture carries a long-task table", lt.length > 0, JSON.stringify(lt));
    const worst = lt.slice().sort((a, b) => b[1] - a[1])[0]; // [startMs, durMs, blockingMs, nameIdx]
    const worstName = worst ? ltNames[worst[3]] : null;
    check("the WORST long-task row is attributed to the real culprit function", worstName === "onFirstPress", `worst=${JSON.stringify(worst)} name=${worstName}`);
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART F — iPhone-class devices
  console.log("\nPART F — iPhone-class devices (real Playwright device descriptors: UA/touch/dpr/isMobile, never a bare resized viewport)");
  {
    const DEVICE_NAMES = ["iPhone 15", "iPhone SE", "iPhone 14 Pro Max"];

    let webkitBrowser = null;
    try {
      webkitBrowser = await webkit.launch({ args: ["--ignore-certificate-errors"] });
    } catch (e) {
      console.log(`  ⚠ WebKit unavailable in this environment (${String(e && e.message || e).split("\n")[0]}) — PART F runs on Chromium with the identical iPhone device descriptors instead. Labeled per-check below; real WebKit/Safari engine behavior is UNVERIFIED-ON-DEVICE here, not silently assumed. See this file's header for the three-tier honesty note.`);
    }
    const engine = webkitBrowser || browser;
    const engineLabel = webkitBrowser ? "webkit" : "chromium-fallback";

    // A CSS override forcing safeAreaInsets.js's own probe element (`[data-safe-area-probe]`) to
    // report a non-zero inset — a SIMULATION, since neither engine renders a real notch/home
    // indicator. Injected before the app boots so it's in place when the probe is created.
    const insetOverrideScript = (top, right, bottom, left) => `(() => {
      const s = document.createElement("style");
      s.textContent = "[data-safe-area-probe]{padding-top:${top}px !important;padding-right:${right}px !important;padding-bottom:${bottom}px !important;padding-left:${left}px !important;}";
      document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(s));
      if (document.documentElement) document.documentElement.appendChild(s);
    })();`;

    async function openPhoneScreen({ device, insets, disablePollMs }) {
      const ctx = await engine.newContext({ ...device, ignoreHTTPSErrors: true });
      await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
      if (insets) await ctx.addInitScript(insetOverrideScript(...insets));
      if (disablePollMs) {
        // Defeats ONLY the CORNER_POLL_MS-cadence setInterval (never blanket — other app
        // timers must keep working) so a visualViewport-listener check can't be coincidentally
        // rescued by the poll's own next scheduled tick landing inside the check's short wait.
        await ctx.addInitScript(`(() => {
          const real = window.setInterval.bind(window);
          window.setInterval = (fn, ms, ...rest) => (ms === ${disablePollMs} ? 0 : real(fn, ms, ...rest));
        })();`);
      }
      const page = await ctx.newPage();
      // Chrome-free route (no Leaflet map, no canvas) — isolates the inset's own contribution
      // from any occupant-clearance the corner-measurement mechanism would otherwise add.
      await page.goto(URL + "#/schedule", { waitUntil: "load" });
      await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 }).catch(() => {});
      await pacedWait(page, 400);
      return { ctx, page };
    }

    async function fabRect(page) {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="help-report-fab"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight, hasVV: !!window.visualViewport };
      });
    }

    for (const name of DEVICE_NAMES) {
      const device = devices[name];
      const deviceLandscape = devices[`${name} landscape`];
      if (!device || !deviceLandscape) { check(`${name}: device + landscape descriptors exist in this Playwright version`, !!device && !!deviceLandscape); continue; }
      const label = `${name} (${engineLabel})`;

      // --- Baseline (portrait, no simulated inset): tap target, no clipping, popover fit, and
      // the visualViewport listener actually causing a re-measure. ---
      let baselinePortraitClearance;
      {
        const { ctx, page } = await openPhoneScreen({ device, insets: null, disablePollMs: 500 });
        const r = await fabRect(page);
        check(`${label}: FAB present at ≥44×44 (never shrink the tap target)`, !!r && r.w >= 43.5 && r.h >= 43.5, JSON.stringify(r));
        check(`${label}: FAB fully inside the viewport, no clipping at an edge`, !!r && r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));

        // Popover fit: open the widest inner view ("Report a problem") and check the portal
        // panel has no horizontal overflow / clipping at either viewport edge.
        await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').click());
        await pacedWait(page, 300);
        await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent && b.textContent.includes("Report a problem"));
          btn && btn.click();
        });
        await pacedWait(page, 250);
        const menuRect = await page.evaluate(() => {
          const heading = Array.from(document.querySelectorAll("div")).find((d) => d.textContent === "Report a problem");
          let node = heading;
          while (node && node.parentElement) {
            if (window.getComputedStyle(node).position === "fixed") break;
            node = node.parentElement;
          }
          if (!node) return null;
          const rr = node.getBoundingClientRect();
          return { l: rr.left, t: rr.top, r: rr.right, b: rr.bottom, w: rr.width, h: rr.height };
        });
        check(`${label}: popover has no horizontal overflow (clamped/flipped into the viewport, not clipped)`, !!menuRect && menuRect.l >= 0 && menuRect.r <= r.vw, JSON.stringify({ menuRect, vw: r.vw }));
        await page.keyboard.press("Escape").catch(() => {});
        await pacedWait(page, 150);

        // visualViewport re-measure: mount a new tall bottom-right occupant AFTER load, then
        // dispatch 'resize'/'scroll' on visualViewport (never on window) and confirm the control
        // moves to clear it — WITHIN the poll interval (500ms), so the poll can't be what moved it.
        check(`${label}: window.visualViewport is present in this engine`, !!r.hasVV);
        if (r.hasVV) {
          await page.evaluate(() => {
            const el = document.createElement("div");
            el.setAttribute("data-canvas-corner", "phone-harness-probe");
            // Wide/tall enough to genuinely overlap the FAB's own hit column (right:14px,
            // width:44px) — a narrow strip flush against the true edge does NOT (its own
            // measured [left,right] can sit entirely outside the FAB's [vw-58, vw-14] column).
            Object.assign(el.style, { position: "fixed", right: "0px", bottom: "0px", width: "60px", height: "260px", background: "transparent" });
            document.body.appendChild(el);
          });
          const before = await fabRect(page);
          await page.evaluate(() => window.visualViewport.dispatchEvent(new Event("resize")));
          await pacedWait(page, 180); // well under CORNER_POLL_MS (500) — only the listener could have caused this
          const afterResize = await fabRect(page);
          check(`${label}: a visualViewport 'resize' event alone (no window resize, inside one poll interval) moves the control to clear a new occupant`, !!afterResize && (afterResize.b - before.b) < -50, `before.b=${before?.b} afterResize.b=${afterResize?.b}`);

          // Remove the occupant, confirm 'scroll' also re-triggers (moves it back down).
          await page.evaluate(() => document.querySelector('[data-canvas-corner="phone-harness-probe"]')?.remove());
          await page.evaluate(() => window.visualViewport.dispatchEvent(new Event("scroll")));
          await pacedWait(page, 180);
          const afterScroll = await fabRect(page);
          check(`${label}: a visualViewport 'scroll' event alone likewise re-measures (control returns once the occupant is gone)`, !!afterScroll && (afterScroll.b - afterResize.b) > 50, `afterResize.b=${afterResize?.b} afterScroll.b=${afterScroll?.b}`);
        }
        await ctx.close();

        // Stash the no-inset baseline bottom clearance for the SIMULATED-inset delta check below.
        baselinePortraitClearance = r.vh - r.b;
      }

      // --- SIMULATED bottom/top inset (portrait) — proves the inset reaches the pixel math. ---
      {
        const SIM_TOP = 47, SIM_BOTTOM = 34; // typical Face-ID-class device values
        const { ctx, page } = await openPhoneScreen({ device, insets: [SIM_TOP, 0, SIM_BOTTOM, 0] });
        const r = await fabRect(page);
        check(`${label}: [SIMULATED inset] FAB still ≥44×44 and fully inside the viewport with a non-zero inset`, !!r && r.w >= 43.5 && r.h >= 43.5 && r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));
        const clearanceWithInset = r ? r.vh - r.b : -Infinity;
        const delta = clearanceWithInset - baselinePortraitClearance;
        check(`${label}: [SIMULATED inset] a ${SIM_BOTTOM}px bottom inset adds ~that much real clearance (mutation-sensitive: reads ~0 if the inset wiring is removed)`, delta >= SIM_BOTTOM - 1.5, `baseline=${baselinePortraitClearance} withInset=${clearanceWithInset} delta=${delta}`);
        await ctx.close();
      }

      // --- Landscape baseline vs. SIMULATED right inset — the case the header note calls out:
      // the notch/dynamic-island rotates to a side edge, so safe-area-inset-RIGHT (or LEFT)
      // becomes genuinely non-zero and the occupant-overlap column math must account for it. ---
      let landscapeBaselineOffset;
      {
        const { ctx, page } = await openPhoneScreen({ device: deviceLandscape, insets: null });
        const r = await fabRect(page);
        check(`${label} [landscape]: FAB present at ≥44×44, fully inside the viewport`, !!r && r.w >= 43.5 && r.h >= 43.5 && r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));
        landscapeBaselineOffset = r ? r.vw - r.r : -Infinity;
        await ctx.close();
      }
      {
        const SIM_RIGHT = 44, SIM_BOTTOM = 21;
        const { ctx, page } = await openPhoneScreen({ device: deviceLandscape, insets: [0, SIM_RIGHT, SIM_BOTTOM, 0] });
        const r = await fabRect(page);
        check(`${label} [landscape]: [SIMULATED inset] FAB still ≥44×44 and fully inside the viewport with a non-zero RIGHT inset`, !!r && r.w >= 43.5 && r.h >= 43.5 && r.l >= 0 && r.t >= 0 && r.r <= r.vw && r.b <= r.vh, JSON.stringify(r));
        const offsetWithInset = r ? r.vw - r.r : -Infinity;
        const delta = offsetWithInset - landscapeBaselineOffset;
        check(`${label} [landscape]: [SIMULATED inset] a ${SIM_RIGHT}px RIGHT inset adds ~that much real clearance from the true right edge (proves the overlap math reads the inset, not just the CSS position)`, delta >= SIM_RIGHT - 1.5, `baseline=${landscapeBaselineOffset} withInset=${offsetWithInset} delta=${delta}`);
        await ctx.close();
      }
    }
    if (webkitBrowser) await webkitBrowser.close();
  }

  // ─────────────────────────────────────────── PART G — B1231280: "Report a problem" carries
  // the SAME frozen capture "Something was slow" does, disclosed honestly before sending, and
  // never takes a second one of its own.
  console.log("\nPART G — \"Report a problem\" attaches the SAME frozen capture, disclosed honestly before sending");
  {
    const { ctx, page } = await openScreen({ mode: "map", width: 1440 });
    await page.mouse.move(400, 400);
    await page.mouse.move(700, 500, { steps: 20 });
    await pacedWait(page, 600);

    const beforeOpen = await page.evaluate(() => window.pfRec.state().sent);
    await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').click());
    await pacedWait(page, 300);
    const afterOpen = await page.evaluate(() => window.pfRec.state().sent);
    check("opening the control took the capture before any menu choice is made", afterOpen > beforeOpen, `${beforeOpen} -> ${afterOpen}`);

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent && b.textContent.includes("Report a problem"));
      btn && btn.click();
    });
    await pacedWait(page, 300);
    const disclosure = await page.evaluate(() => {
      const summary = Array.from(document.querySelectorAll("summary")).find((s) => s.textContent.includes("What will be sent"));
      return summary ? summary.parentElement.textContent : null;
    });
    check(
      "the disclosure honestly says a performance snapshot is included before he sends anything",
      !!disclosure && disclosure.includes("recent app performance"),
      disclosure || "(not found)",
    );

    await page.fill("textarea", "verify-help-report-control PART G probe — safe to ignore, never actually sent (no cloud config in this build)");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim().startsWith("Send"));
      btn && btn.click();
    });
    await pacedWait(page, 400);
    const afterSubmit = await page.evaluate(() => window.pfRec.state().sent);
    check("submitting \"Report a problem\" does NOT take a second capture either — same frozen one", afterSubmit === afterOpen, `${afterOpen} -> ${afterSubmit}`);
    await ctx.close();
  }

  // ─────────────────────────────────────────── PART H — GENERIC intersection sweep, every named
  // route, narrow + wide (owner dispatch, 2026-09-08: "audit EVERY route ... the control's box
  // does not intersect any interactive element's box"). Unlike PART A's hand-picked occupant list
  // (Leaflet controls, the canvas furniture, the ✎ Tools FAB), this sweep is GENERIC — every
  // visible button/link/input/select/[role=button] on the page, at each route's IDLE (default)
  // state — so it catches a class of collision no hand-picked list would. This is exactly how
  // B1239217 (the Model workspace's own "+ Add sheet" tab-strip button) went unnoticed for a full
  // session: it was never on any prior harness's occupant list. Deliberately scoped to the IDLE
  // state of each route — no deliberately-opened panel (Comps' entry grid, the phone Properties
  // bottom sheet) — those correctly OUTRANK the control by z-index once open (mapChromeStack.js's
  // own "a panel the user opened wins" rule; the map/plan dock's low `MAP_CHROME_Z.control`
  // z-index makes this automatic on those two routes now) and a bbox-only sweep taken while one is
  // open would false-positive on that intended coverage — verified separately by source/z-index
  // reading, recorded in this item's own PR body rather than reproduced live here.
  console.log("\nPART H — GENERIC: the control's box does not intersect ANY interactive element's box, every named route, narrow + wide");
  {
    const modelSiteId = "verify-hrc-model";
    const modelSite = {
      id: modelSiteId, groupId: modelSiteId, site: "ZZ Help/Report verify (throwaway)", name: "ZZ Help/Report verify (throwaway)",
      origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [],
      settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
    };
    const seedModelSite = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${JSON.stringify(modelSiteId)}: ${JSON.stringify(modelSite)} })); } catch (e) {} })();`;

    // Slugs from src/app/route.js's SLUG_BY_MODULE — do not guess these, they've drifted before
    // (B1231282, this same file's own header).
    const ROUTES = [
      { label: "map", hash: "#/site", wait: ".leaflet-container" },
      { label: "plan", hash: "#/project/s_help/site", wait: 'svg[aria-label="Site plan canvas"]', seedPlan: true },
      { label: "schedule", hash: "#/schedule", wait: null },
      { label: "model", hash: `#/project/${modelSiteId}/model`, wait: '[data-testid="model-sheet"]', seedModel: true },
      { label: "doc-review", hash: "#/markup", wait: null },
      { label: "library", hash: "#/library", wait: null },
      { label: "notes", hash: "#/notes", wait: null },
      { label: "dashboard", hash: "#/", wait: null },
    ];
    const WIDTHS = [1440, 390];

    for (const route of ROUTES) {
      for (const width of WIDTHS) {
        const ctx = await browser.newContext({ viewport: { width, height: 900 } });
        await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
        if (route.seedPlan) await ctx.addInitScript(seedPlan);
        if (route.seedModel) await ctx.addInitScript(seedModelSite);
        const page = await ctx.newPage();
        await assertMeasurable(page, "verify-help-report-control");
        await page.goto(URL + route.hash, { waitUntil: "load" });
        if (route.wait) await page.waitForSelector(route.wait, { timeout: 15000 }).catch(() => {});
        await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 }).catch(() => {});
        await pacedWait(page, 1000);

        const data = await page.evaluate(() => {
          const rectOf = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
          const fab = document.querySelector('[data-testid="help-report-fab"]');
          if (!fab) return { fab: null, hits: [] };
          const fabRect = fab.getBoundingClientRect();
          const isVisible = (el) => {
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return false;
            const cs = getComputedStyle(el);
            return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity || "1") > 0;
          };
          // Exclude generic full-surface containers — the Leaflet map container and the Model
          // workspace's own sheet grid (`model-sheet`, a single roving-tabindex host for keyboard
          // grid nav, not a discrete control) both span nearly their whole route/pane. A bbox
          // "overlap" with something that big is meaningless — the FAB is a small button floating
          // ON TOP of the map/canvas/sheet surface BY DESIGN everywhere in this app (confirmed
          // live on the Model route: it sits over two blank grid cells in the last visible column,
          // no data, no control — the same relationship it already has with the Leaflet map and
          // the Site Planner canvas on every other route).
          const interactive = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'))
            .filter((el) => el !== fab && !fab.contains(el) && isVisible(el)
              && !el.classList.contains("leaflet-container")
              && el.getAttribute("data-testid") !== "model-sheet");
          // getBoundingClientRect() ignores ancestor CLIPPING — a scrollable list's row scrolled
          // below its own visible scrollport (e.g. a Layers-panel legend row past the fold) still
          // reports its full, real layout rect even though nothing of it is actually painted on
          // screen there (measured live: exactly this shape on the map route's Layers panel,
          // which is open by default on desktop). Intersect the candidate's rect down through
          // every `overflow:auto/hidden/scroll` ancestor's own visible box; a candidate clipped to
          // nothing is not really on screen and is not a real collision.
          const visibleRect = (el) => {
            let rect = el.getBoundingClientRect();
            let node = el.parentElement;
            while (node && node !== document.body) {
              const cs = getComputedStyle(node);
              if (/(auto|hidden|scroll)/.test(cs.overflow + cs.overflowX + cs.overflowY)) {
                const nr = node.getBoundingClientRect();
                const l = Math.max(rect.left, nr.left), t = Math.max(rect.top, nr.top);
                const r2 = Math.min(rect.right, nr.right), b = Math.min(rect.bottom, nr.bottom);
                if (r2 <= l || b <= t) return null; // fully clipped away — not on screen
                rect = { left: l, top: t, right: r2, bottom: b };
              }
              node = node.parentElement;
            }
            return rect;
          };
          const hits = [];
          for (const el of interactive) {
            const r = visibleRect(el);
            if (!r) continue;
            const ox = Math.max(0, Math.min(fabRect.right, r.right) - Math.max(fabRect.left, r.left));
            const oy = Math.max(0, Math.min(fabRect.bottom, r.bottom) - Math.max(fabRect.top, r.top));
            if (ox <= 0 || oy <= 0) continue;
            // A bounding-box overlap alone can be a false positive: a scrollable panel's OWN
            // clipped-out-of-view content (e.g. a legend row scrolled below its list's visible
            // area) still reports a real getBoundingClientRect() even though nothing is painted
            // there. The real question is a HIT-TEST one: at the overlap's own center, does the
            // control (or a descendant of it) actually intercept the press meant for this other
            // element — the literal B1239217 mechanism? A genuinely higher-z panel legitimately
            // winning there (mapChromeStack.js's "an opened panel wins" rule) is not a defect
            // either, so only "the FAB wins where it should not" counts.
            const ovL = Math.max(fabRect.left, r.left), ovT = Math.max(fabRect.top, r.top);
            const ovR = Math.min(fabRect.right, r.right), ovB = Math.min(fabRect.bottom, r.bottom);
            const cx = (ovL + ovR) / 2, cy = (ovT + ovB) / 2;
            const hitEl = document.elementFromPoint(cx, cy);
            const fabWinsHere = !!(hitEl && (hitEl === fab || fab.contains(hitEl)));
            if (!fabWinsHere) continue;
            hits.push({ tag: el.tagName, testid: el.getAttribute("data-testid"), label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40), rect: { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } });
          }
          return { fab: rectOf(fab), hits };
        });
        check(`${route.label}@${width}: FAB present`, !!data.fab, data.fab ? "" : "missing — route wiring or seed problem");
        check(`${route.label}@${width}: no interactive element's box intersects the control's box`, data.hits.length === 0, data.hits.length ? JSON.stringify(data.hits) : "");
        await ctx.close();
      }
    }
  }

  // ─────────────────────────────────────────── PART I — B1162016: size by POINTER CAPABILITY,
  // never viewport width, and the corner-clearance math consumes the SAME size the button renders at.
  console.log("\nPART I — the control sizes by POINTER CAPABILITY (matchMedia \"(pointer: coarse)\"), never viewport width, and the corner-clearance math consumes the size the button actually rendered at");
  {
    async function fabBox(page) {
      return page.evaluate(() => {
        const el = document.querySelector('[data-testid="help-report-fab"]');
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height, b: r.bottom, vh: window.innerHeight, pointerCoarse: window.matchMedia("(pointer: coarse)").matches };
      });
    }
    async function openChromeFreeScreen(ctxOpts) {
      const ctx = await browser.newContext(ctxOpts);
      await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
      const page = await ctx.newPage();
      await assertMeasurable(page, "verify-help-report-control PART I");
      await page.goto(URL + "#/schedule", { waitUntil: "load" }); // chrome-free route — no Leaflet, no canvas, isolates the button's own sizing
      await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 });
      await pacedWait(page, 400);
      return { ctx, page };
    }

    // Fine pointer, WIDE viewport — the app's standard desktop icon-button size (CONTROL_H.lg,
    // 30), never the 44px touch floor.
    {
      const { ctx, page } = await openChromeFreeScreen({ viewport: { width: 1440, height: 900 } });
      const r = await fabBox(page);
      check("fine pointer + 1440px viewport: this context reads pointer:fine", r.pointerCoarse === false, JSON.stringify(r));
      check("fine pointer: FAB renders at the desktop icon-button size (30×30, CONTROL_H.lg) — not the 44px touch floor", Math.round(r.w) === 30 && Math.round(r.h) === 30, JSON.stringify(r));
      await ctx.close();
    }

    // Coarse pointer, the SAME wide viewport — the 44px floor persists even at a desktop-wide
    // viewport, proving width alone never decided this in either direction.
    {
      const { ctx, page } = await openChromeFreeScreen({ viewport: { width: 1440, height: 900 }, hasTouch: true });
      const r = await fabBox(page);
      check("a touch-capable 1440px-wide viewport reads pointer:coarse (Chromium ties this to hasTouch)", r.pointerCoarse === true, JSON.stringify(r));
      check("coarse pointer at a DESKTOP-WIDE viewport still gets the 44×44 touch floor — sizing is pointer-driven, not width-driven", Math.round(r.w) === 44 && Math.round(r.h) === 44, JSON.stringify(r));
      await ctx.close();
    }

    // Fine pointer, NARROW viewport — the reverse control: a small mouse-driven window must NOT
    // get the touch floor just because the viewport happens to be narrow.
    {
      const { ctx, page } = await openChromeFreeScreen({ viewport: { width: 390, height: 844 } });
      const r = await fabBox(page);
      check("fine pointer + 390px viewport: this context still reads pointer:fine", r.pointerCoarse === false, JSON.stringify(r));
      check("fine pointer at a NARROW viewport still gets the desktop icon-button size (30×30) — width alone never decides this either", Math.round(r.w) === 30 && Math.round(r.h) === 30, JSON.stringify(r));
      await ctx.close();
    }

    // A live pointer-type change, mid-session, no reload — Playwright/CDP have no way to flip a
    // real device's pointer type, so this mocks matchMedia("(pointer: coarse)")'s own change
    // event to prove the app's OWN reactive listener (not the mock) resizes the button, and that
    // the corner-clearance math consumes the NEW size, not the one it mounted with. The occupant
    // below is positioned (from cornerClearance.js's own `colLeft = vw - right - width` math,
    // FAB_RIGHT=14, vw=1440) so it overlaps the button's column ONLY at width=44
    // (colLeft=1382) and misses it at width=30 (colLeft=1396): occupant right edge at
    // vw-45=1395, 12px wide (left edge 1383) — 1395 is > 1382 but not > 1396.
    {
      const mockMatchMediaScript = `(() => {
        const real = window.matchMedia.bind(window);
        let mql = null;
        window.matchMedia = (q) => {
          if (q !== "(pointer: coarse)") return real(q);
          if (mql) return mql;
          const listeners = [];
          mql = {
            matches: false, media: q,
            addEventListener: (t, fn) => { if (t === "change") listeners.push(fn); },
            removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); },
            addListener: (fn) => listeners.push(fn),
            removeListener: (fn) => { const i = listeners.indexOf(fn); if (i > -1) listeners.splice(i, 1); },
          };
          window.__setCoarsePointer = (v) => { mql.matches = v; listeners.slice().forEach((fn) => fn({ matches: v })); };
          return mql;
        };
      })();`;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
      await ctx.addInitScript(mockMatchMediaScript);
      const page = await ctx.newPage();
      await assertMeasurable(page, "verify-help-report-control PART I (live switch)");
      await page.goto(URL + "#/schedule", { waitUntil: "load" });
      await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 });
      await pacedWait(page, 400);

      await page.evaluate(() => {
        const el = document.createElement("div");
        el.setAttribute("data-canvas-corner", "b1162016-width-sensitivity-probe");
        Object.assign(el.style, { position: "fixed", right: "45px", top: "700px", width: "12px", height: "250px", background: "transparent" });
        document.body.appendChild(el);
      });
      await page.evaluate(() => window.dispatchEvent(new Event("resize"))); // force an immediate re-measure rather than waiting on the poll
      await pacedWait(page, 300);
      const before = await fabBox(page);
      check("[live-switch] mock installed, fine-pointer baseline still renders at 30×30", Math.round(before.w) === 30 && Math.round(before.h) === 30, JSON.stringify(before));
      check("[live-switch] at 30px width the probe occupant does NOT overlap the button's column — clearance stays near the true corner", Math.abs((before.vh - before.b) - 14) <= 3, `clearance=${before.vh - before.b}`);

      await page.evaluate(() => window.__setCoarsePointer(true));
      await pacedWait(page, 400); // well under CORNER_POLL_MS (500) — only the matchMedia "change" listener could cause this
      const after = await fabBox(page);
      check("[live-switch] a live pointer-type change (matchMedia \"change\", no reload) resizes the button to the 44×44 touch floor", Math.round(after.w) === 44 && Math.round(after.h) === 44, JSON.stringify(after));
      check("[live-switch] the corner-clearance math consumed the NEW size — the same probe occupant now overlaps the wider column and the button jumps to clear it (mutation-sensitive: reads ~14 if a stale width is fed in instead)", (after.vh - after.b) >= 205 && (after.vh - after.b) <= 215, `before clearance=${before.vh - before.b} after clearance=${after.vh - after.b}`);
      await ctx.close();
    }
  }

  // ─────────────────────────────────────────── PART J — NEW-1: same-origin iframe content
  // clearance (the Schedule route). See this file's own header for why this drives a
  // self-contained SYNTHETIC iframe rather than the real `/sequence/` page: this sandbox's
  // headless Chromium cannot reach cdn.jsdelivr.net (or any external host) at all, which
  // `/sequence/index.html` needs synchronously just to finish parsing. This proves the exact
  // shipped mechanism — the real module source, read fresh off disk, dynamically imported into a
  // real page — against a zero-network fixture instead, so the check is genuine, not skipped.
  console.log("\nPART J — NEW-1: same-origin iframe content is measured, not invisible (synthetic fixture — see this file's header for why the real Schedule route can't load here)");
  {
    const modulePath = resolvePath(HERE, "../src/shared/ui/cornerClearance.js");
    const moduleSource = readFileSync(modulePath, "utf8");
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await swallowReportWrites(ctx); // B2159505: never file a real report from a harness
    const page = await ctx.newPage();
    await page.goto("about:blank");

    // Import the REAL shipped module (not a re-typed copy) via a blob: URL — zero network, so
    // this works identically regardless of what this session's egress policy allows.
    await page.evaluate(async (src) => {
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      window.__cc = await import(url);
    }, moduleSource);

    // Mount a synthetic same-origin iframe mimicking Scheduler.jsx's real layout: a header band,
    // then a full-bleed pane holding one "grid row" reaching the pane's own bottom-right corner —
    // no third-party resource, so it loads instantly anywhere.
    await page.evaluate(() => new Promise((resolve) => {
      document.body.style.margin = "0";
      const iframe = document.createElement("iframe");
      Object.assign(iframe.style, { position: "fixed", left: "0", top: "61px", right: "0", bottom: "0", width: "100vw", height: "calc(100vh - 61px)", border: "none" });
      iframe.srcdoc = '<!doctype html><html><body style="margin:0"><div class="drow" style="position:absolute; left:0; right:0; bottom:0; height:24px; background:#eee;"></div></body></html>';
      iframe.onload = () => resolve();
      document.body.appendChild(iframe);
    }));
    await pacedWait(page, 200);

    const result = await page.evaluate(() => {
      const { cornerClearanceFromBottom } = window.__cc;
      const fixedBehavior = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });

      // MUTATION-PROOF, against this SAME live DOM: temporarily suppress exactly what NEW-1
      // added (the `document.querySelectorAll("iframe")` call the new descent loop makes) to
      // reproduce the pre-fix code path, then restore it immediately. A build that reverts NEW-1
      // would make `fixedBehavior` collapse to this `oldBehavior` value.
      const realQSA = document.querySelectorAll.bind(document);
      document.querySelectorAll = (sel) => (sel === "iframe" ? [] : realQSA(sel));
      const oldBehavior = cornerClearanceFromBottom({ right: 14, width: 30, base: 14 });
      document.querySelectorAll = realQSA;

      return { fixedBehavior, oldBehavior };
    });
    check("PART J: replaying the pre-NEW-1 code path (no iframe descent) on this exact DOM reproduces the bare corner", result.oldBehavior === 14, JSON.stringify(result));
    check("PART J: the shipped function genuinely clears the same-origin iframe's own bottom-right content", result.fixedBehavior > 14 && result.fixedBehavior < 100, JSON.stringify(result));
    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log("FAILED:"); for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
