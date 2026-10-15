/* NEW-1 / NEW-2 (2026-10-15) — THE CROP DIALOG ON A *FRESHLY PLACED* OVERLAY, driven end to end in a real browser.
 *
 * The owner's report: on a NEW overlay, crop opened right after placement and before any reload — "it was buggy to the
 * point where I couldn't click anything once it was open." The earlier null (build 6697033) was taken on an OLDER,
 * already-placed overlay with a saved polygon — a different configuration. THIS harness is the reported one:
 *   · upload a MULTI-PAGE PDF through the real file input, and open Crop the first instant the row's Crop control is
 *     enabled — no reload, no settle wait;
 *   · repeat, including under a 6x CPU throttle (the picture is still decoding / the page still hydrating when it opens);
 *   · on every open prove LIVENESS, not just presence: every header/toolbar control answers a press, a polygon can be
 *     drawn, Done saves, Escape cancels, the planner is clickable again afterwards;
 *   · read the dialog's own self-capture rows (cropDiag.js): crop-dialog-open must carry no `bad`, and there must be no
 *     crop-pointer-dead / -blocked / crop-stall / crop-render-storm.
 *   · the redesign (NEW-1): no Trim by feet, Cancel/Done in the header, Reset/Undo/Pan/zoom/Fit in the floating pill,
 *     no zoom slider, no footer; a KNOWN-GOOD ARM (a ratio of controls that must exist) voids the run if it can't see them.
 * Output is a table; exit 1 on any ✗. BASE_URL points at a build (local preview by default; planyr.io post-deploy). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PDF = process.env.PDF_FILE || new URL("../test/fixtures/site-plan-crop/multipage-3p.pdf", import.meta.url).pathname;
const ROUNDS = +(process.env.ROUNDS || 4);

let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };

const parcel = { id: "pc1", locked: false, points: [{ x: -600, y: -500 }, { x: 600, y: -500 }, { x: 600, y: 500 }, { x: -600, y: 500 }] };
const site = { id: "C1", groupId: "C1", site: "CropT", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  sheetOverlays: [], parcelDrawings: [], status: "active", updatedAt: Date.now() };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ C1: site }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
page.on("dialog", async (d) => { console.log("  [DIALOG — never allowed]", d.message().slice(0, 100)); fail++; await d.accept().catch(() => {}); });
await assertMeasurable(page, "verify-crop-fresh-overlay");

await page.addInitScript(() => { window.__longTasks = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch {} });
await page.goto(`${BASE}#/project/C1/site`, { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); });
await page.waitForTimeout(800);

const telemetry = () => page.evaluate(() => (window.pfTelemetry && window.pfTelemetry.recent ? window.pfTelemetry.recent() : []).map((r) => ({ source: r.source, message: r.message })).filter((r) => /crop-/.test(r.source || "")));
const dlg = () => page.locator('[data-testid="overlay-crop-dialog"]');
const hitInside = (sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel); if (!el) return "missing";
  const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top && (top === el || el.contains(top)) ? "ok" : `covered by ${top ? top.tagName + "#" + (top.getAttribute("data-testid") || "") : "nothing"}`;
}, sel);
const pct = async () => parseInt(await page.locator('[data-testid="crop-zoom-100"]').textContent(), 10);
const knownIds = new Set();

let armOk = null;
for (let round = 1; round <= ROUNDS; round++) {
  const throttled = round >= 3;
  console.log(`\n— round ${round}${throttled ? " (6x CPU throttle)" : ""} —`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttled ? 6 : 1 });
  await page.locator('[data-testid="left-menu-panel"] input[type="file"][accept="application/pdf,image/*,.dxf,.dwg"]').setInputFiles(PDF);
  // The FIRST instant a new row exists: open it, then press Crop the instant it's enabled. No settle, no reload.
  const handle = await page.waitForFunction((known) => {
    const rows = [...document.querySelectorAll('[data-testid^="reference-open-"]')];
    const fresh = rows.find((r) => !known.includes(r.getAttribute("data-testid")));
    return fresh ? fresh.getAttribute("data-testid") : null;
  }, [...knownIds], { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  check(`[precondition] round ${round}: the multi-page PDF row appeared`, !!handle, String(handle));
  if (!handle) continue;
  knownIds.add(handle);
  const id = handle.replace("reference-open-", "");
  // a freshly placed row may already be expanded — a second click would COLLAPSE it
  if (!(await page.locator('[data-testid="overlay-crop-open"]').count())) await page.locator(`[data-testid="${handle}"]`).click();
  const t0 = Date.now();
  await page.locator('[data-testid="overlay-crop-open"]').click({ timeout: 30000 });
  await dlg().waitFor({ state: "visible", timeout: 15000 });
  const openMs = Date.now() - t0;
  console.log(`  opened ${openMs} ms after the row appeared; long tasks so far (ms): ${JSON.stringify(await page.evaluate(() => window.__longTasks))}`);
  await page.evaluate(() => { window.__longTasks = []; });

  // ---- the redesign, on a real open ----
  const sees = await page.evaluate(() => {
    const q = (s) => !!document.querySelector(`[data-testid="overlay-crop-dialog"] ${s}`);
    return {
      noTrim: !q('[data-testid="overlay-crop-trim"]') && !/trim by feet/i.test(document.querySelector('[data-testid="overlay-crop-dialog"]').textContent),
      header: q('[data-testid="crop-header"]'), cancelInHeader: q('[data-testid="crop-header"] [data-testid="crop-cancel"]'), doneInHeader: q('[data-testid="crop-header"] [data-testid="crop-done"]'),
      switch: q('[data-testid="crop-mode-rect"]') && q('[data-testid="crop-mode-poly"]'),
      pill: ["crop-undo", "crop-redo", "crop-reset", "crop-pan-tool", "crop-zoom-out", "crop-zoom-100", "crop-zoom-in", "crop-zoom-fit"].every((t) => q(`[data-testid="crop-toolbar"] [data-testid="${t}"]`)),
      noSlider: !q('[data-testid="crop-zoom-slider"]'), noFooter: !q('[data-testid="crop-footer"]'),
      fileName: (document.querySelector('[data-testid="crop-file-name"]') || {}).textContent || "",
    };
  });
  if (round === 1) {
    armOk = sees.header && sees.switch && sees.pill;
    check("[known-good arm] the new header, the shape switch and the floating toolbar are all present", armOk, JSON.stringify(sees));
    if (!armOk) { console.log("  ⛔ VOID — the probe cannot see the controls it is meant to drive; no score reported."); await browser.close(); process.exit(2); }
    check("no Trim by feet anywhere in the dialog", sees.noTrim);
    check("Cancel and Done are in the header row", sees.cancelInHeader && sees.doneInHeader);
    check("no zoom slider and no footer", sees.noSlider && sees.noFooter);
    check("the file name rides in the header", sees.fileName.length > 0 && /\.pdf$/i.test(sees.fileName), sees.fileName);
    await page.screenshot({ path: OUT + "crop-fresh-rect.png" });
  }

  // ---- LIVENESS: nothing covers the controls, and every one answers a press ----
  const covered = [];
  for (const sel of ['[data-testid="crop-mode-poly"]', '[data-testid="crop-cancel"]', '[data-testid="crop-done"]', '[data-testid="crop-pan-tool"]', '[data-testid="crop-zoom-in"]', '[data-testid="crop-zoom-fit"]']) {
    const h = await hitInside(sel); if (h !== "ok") covered.push(`${sel}: ${h}`);
  }
  check(`round ${round}: no control is covered by anything else`, covered.length === 0, covered.join(" | "));
  const p0 = await pct();
  check(`round ${round}: the zoom readout is a real number`, Number.isFinite(p0) && p0 > 0, String(p0));
  await page.locator('[data-testid="crop-zoom-in"]').click(); await page.waitForTimeout(150);
  const p1 = await pct();
  check(`round ${round}: Zoom in answers`, p1 > p0, `${p0}% → ${p1}%`);
  await page.locator('[data-testid="crop-zoom-fit"]').click(); await page.waitForTimeout(150);
  check(`round ${round}: Fit answers`, (await pct()) === p0, `${await pct()}%`);
  await page.locator('[data-testid="crop-pan-tool"]').click();
  check(`round ${round}: Pan toggles on`, (await page.locator('[data-testid="crop-pan-tool"]').getAttribute("aria-pressed")) === "true");
  await page.locator('[data-testid="crop-pan-tool"]').click();
  await page.locator('[data-testid="crop-mode-poly"]').click();
  check(`round ${round}: Polygon answers`, (await page.locator('[data-testid="crop-mode-poly"]').getAttribute("aria-pressed")) === "true");
  const cv = await page.locator('[data-testid="crop-canvas"]').boundingBox();
  const at = (fx, fy) => [cv.x + cv.width * fx, cv.y + cv.height * fy];
  for (const [fx, fy] of [[0.4, 0.3], [0.6, 0.3], [0.6, 0.6]]) { const [x, y] = at(fx, fy); await page.mouse.click(x, y); await page.waitForTimeout(60); }
  await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  check(`round ${round}: three clicks + Enter close a polygon (three vertices)`, (await page.locator('[data-testid^="crop-poly-vertex-"]').count()) === 3);
  if (round === 1) await page.screenshot({ path: OUT + "crop-fresh-poly.png" });
  await page.locator('[data-testid="crop-undo"]').click(); await page.waitForTimeout(120);
  check(`round ${round}: Undo answers (the ring re-opens)`, (await page.locator('[data-testid^="crop-poly-vertex-"]').count()) === 0);
  await page.locator('[data-testid="crop-redo"]').click(); await page.waitForTimeout(120);
  check(`round ${round}: Redo answers`, (await page.locator('[data-testid^="crop-poly-vertex-"]').count()) === 3);
  check(`round ${round}: Reset is enabled once something is drawn`, await page.locator('[data-testid="crop-reset"]').isEnabled());

  if (round % 2 === 1) {
    await page.locator('[data-testid="crop-done"]').click();
    await dlg().waitFor({ state: "detached", timeout: 8000 });
    const saved = await page.evaluate((id) => { const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const o = raw.C1.sheetOverlays.find((x) => x.id === id); return o && o.crop ? o.crop.kind : null; }, id);
    check(`round ${round}: Done saves the polygon and closes`, saved === "poly", String(saved));
  } else {
    await page.keyboard.press("Escape"); await page.waitForTimeout(200); // deselects / closes the menu first
    if (await dlg().count()) { await page.keyboard.press("Escape"); }
    await dlg().waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
    check(`round ${round}: Escape cancels and closes`, (await dlg().count()) === 0);
  }
  const lt = await page.evaluate(() => window.__longTasks);
  console.log(`  long tasks while the dialog was in use (ms): ${JSON.stringify(lt)}`);
  check(`round ${round}: no main-thread block over 2 s while the dialog was in use`, Math.max(0, ...lt) < 2000, `max ${Math.max(0, ...lt)} ms`);
  const free = await page.evaluate(() => { const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2); return !!el && !el.closest("[data-crop-modal]"); });
  check(`round ${round}: the planner is clickable again after close`, free);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.waitForTimeout(600);
}

// ---- the dialog's own self-capture rows ----
const rows = await telemetry();
const opens = rows.filter((r) => /crop-dialog-open/.test(r.source));
const bad = rows.filter((r) => /crop-(pointer-dead|pointer-blocked|stall|render-storm)/.test(r.source) || (/crop-dialog-open/.test(r.source) && /"bad":\["/.test(r.message)));
// identical rows inside 10 s are de-duplicated by the sink on purpose, so >= 1 (a BAD open reads differently and always lands)
check(`self-capture: crop-dialog-open rows were recorded`, opens.length >= 1, `${opens.length} rows`);
check("self-capture: no bad open, no dead/blocked pointer, no stall, no render storm", bad.length === 0, bad.map((r) => r.source + " " + r.message.slice(0, 160)).join(" | "));
check("no uncaught page errors", jsErrors.length === 0, jsErrors.join(" | ").slice(0, 300));

await browser.close();
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
process.exit(fail ? 1 : 0);
