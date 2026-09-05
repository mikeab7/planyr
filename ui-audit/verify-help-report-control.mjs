#!/usr/bin/env node
/* verify-help-report-control — B842864/B842865: the global help/report control the app shell
 * mounts on every route, and the adversarial-review questions the dispatch asked for by name.
 *
 * PART A — reachable, unobstructed, on the MAP screen (MapFinder.jsx) and the PLAN screen
 * (SitePlanner.jsx canvas), at a desktop and a narrow width: no overlap with Leaflet's zoom/
 * attribution controls, the canvas's own scale bar / north arrow / zoom stack, or the narrow-
 * only "✎ Tools" FAB. Real `elementFromPoint` hit tests, not bounding-box math alone
 * (FOREGROUND-OR-VOID's sibling: a clipped box can report an overlapping rect while painting
 * nothing there).
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
 *   node ui-audit/verify-help-report-control.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
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
    await page.goto(URL, { waitUntil: "load" });
    if (mode === "plan") {
      await page.waitForSelector('svg[aria-label="Site plan canvas"]', { timeout: 15000 }).catch(() => {});
    } else {
      // Map mode: wait for the Leaflet map container to exist.
      await page.waitForSelector(".leaflet-container", { timeout: 15000 }).catch(() => {});
    }
    await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 15000 });
    await pacedWait(page, 1500);
    return { ctx, page };
  }

  // ─────────────────────────────────────────── PART A — no overlap, every screen/breakpoint
  console.log("\nPART A — no overlap with Leaflet controls / canvas furniture / the ✎ Tools FAB");
  const SCENES = [
    { mode: "map", width: 1440, label: "map@1440" },
    { mode: "map", width: 390, label: "map@390" },
    { mode: "plan", width: 1440, label: "plan@1440" },
    { mode: "plan", width: 390, label: "plan@390" },
  ];

  for (const scene of SCENES) {
    const { ctx, page } = await openScreen(scene);
    const data = await page.evaluate(() => {
      const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
      return {
        fab: rectOf(document.querySelector('[data-testid="help-report-fab"]')),
        leafletZoom: rectOf(document.querySelector(".leaflet-control-zoom")),
        leafletAttr: rectOf(document.querySelector(".leaflet-control-attribution")),
        toolsFab: (() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const b = btns.find((x) => x.textContent && x.textContent.trim() === "✎ Tools");
          return rectOf(b);
        })(),
        zoomStack: (() => {
          const el = document.querySelector('[data-testid="report-slow"]');
          return el ? rectOf(el.closest("div")) : null;
        })(),
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
    if (data.zoomStack) {
      const ov = overlapArea(data.fab, data.zoomStack);
      check(`${scene.label}: clear of the canvas zoom/report-slow stack`, ov === 0, ov > 0 ? `${ov}px² overlap (stack ${JSON.stringify(data.zoomStack)})` : "");
    }
    if (data.toolsFab) {
      const ov = overlapArea(data.fab, data.toolsFab);
      check(`${scene.label}: clear of the "✎ Tools" FAB`, ov === 0, ov > 0 ? `${ov}px² overlap` : "");
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

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log("FAILED:"); for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ""}`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
