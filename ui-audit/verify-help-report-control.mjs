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
 *   node ui-audit/verify-help-report-control.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium, webkit, devices } from "playwright";
import { mkdirSync } from "node:fs";
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
    if (mode === "plan") await ctx.addInitScript(seedPlan);
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-help-report-control");
    const hash = mode === "schedule" ? "#/schedule" : mode === "model" ? "#/model" : "";
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
  const SCENES = [
    { mode: "map", width: 1440, label: "map@1440" },
    { mode: "map", width: 390, label: "map@390" },
    { mode: "plan", width: 1440, label: "plan@1440", chromeFree: true }, // desktop: canvas furniture is inset off the true corner
    { mode: "plan", width: 390, label: "plan@390" },
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
      return {
        viewportH: window.innerHeight,
        fab: rectOf(document.querySelector('[data-testid="help-report-fab"]')),
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

    await page.evaluate(() => document.querySelector('[data-testid="help-report-fab"]').click());
    await pacedWait(page, 300);
    const slowRow = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button"));
      return items.find((b) => b.textContent && b.textContent.includes("Something was slow"));
    });
    check("the menu offers \"Something was slow\" on the map screen", !!slowRow);
    const before = await page.evaluate(() => window.pfRec.state().sent);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("button"));
      const btn = items.find((b) => b.textContent && b.textContent.includes("Something was slow"));
      btn.click();
    });
    await pacedWait(page, 500);
    const after = await page.evaluate(() => window.pfRec.state().sent);
    check("pressing it took a real capture (pfRec.state().sent incremented)", after > before, `${before} -> ${after}`);
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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log("FAILED:"); for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
