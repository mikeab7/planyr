/* Headless live verifier for the blank-tile self-heal (B844704).
 *
 * WHAT THIS PROVES. The owner reported a lingering light-grey square over the dashboard map's
 * aerial (planyr.io/#/, Sites list, zoomed out over Houston), still there unchanged 45+ seconds
 * later. Root cause, traced through Leaflet's own source: a tile that errors is marked `loaded`
 * (so Leaflet's own grid update never asks for it again) but never gains `leaflet-tile-loaded` —
 * the one class that takes a tile out of `visibility:hidden` (leaflet.css) — so it stays invisible
 * forever, revealing the map's own flat, hardcoded light-grey container background through the
 * gap. `withTileRetry` (layers.js) gives up after two quick retries. `armBlankTileHeal`
 * (tileLifecycle.js) is the backstop: a periodic sweep that finds a retained tile still unpainted
 * past a grace period and forces a fresh, cache-busted reload, regardless of why it never painted.
 *
 * This harness drives the REAL running app (not a unit-test fake) and forces every aerial tile
 * request to fail — the worst case, a permanently dead host — via Playwright's own request
 * interception (no live GIS access needed, so this runs cleanly in an egress-blocked sandbox).
 * Three things must all be true:
 *   A. The self-heal sweep actually reloads a stuck tile (a fresh request carrying `_heal=`).
 *   B. `reportClientEvent("map-tile-blank-self-heal", ...)` actually fires, carrying the layer,
 *      the tile's on-screen rect, the live zoom, and how long it sat blank (window.pfTelemetry's
 *      own recorded event, per clientErrors.js).
 *   C. Nothing crashes and no console error is thrown — even under a permanently-dead host, the
 *      loop stays quiet and bounded (never a spam of reload attempts every animation frame).
 *
 * Run:  npm run dev -- --port 5183   (in the background)
 *       node ui-audit/verify-blank-tile-heal.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
// Split from the line above deliberately: test/tabTiming.test.js matches the precondition's import
// EXACTLY, so that one stays a single-specifier line (the house convention — see verify-flood-tiles.mjs).
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5183";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };

async function main() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-blank-tile-heal");

    const consoleErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push("pageerror: " + err.message));

    // Force EVERY aerial tile request to fail, permanently — the worst case, a genuinely dead
    // host. `withTileRetry`'s own two retries will exhaust; anything that recovers past that has
    // to be armBlankTileHeal's sweep, not Leaflet's own machinery or the app's normal retry.
    const healedReloads = [];
    await page.route("**://server.arcgisonline.com/**", async (route) => {
      const url = route.request().url();
      if (url.includes("_heal=")) healedReloads.push(url);
      return route.abort("failed");
    });

    await page.goto(`${BASE}/#/`, { waitUntil: "domcontentloaded" });

    // Land on the MAP FINDER dashboard — the exact surface the owner screenshotted. Poll rather
    // than a fixed sleep: a cold dev-server compile or a slow CI runner can push first paint past
    // any fixed budget, and a flaky false negative here is a harness defect, not a real one.
    const mapNav = page.getByText("Map", { exact: true }).first();
    try { await mapNav.waitFor({ state: "visible", timeout: 15000 }); await mapNav.click({ timeout: 2000 }); } catch (_) { /* already there, or nav never renders — the next wait catches that */ }

    let hasLeaflet = false;
    try { await page.waitForSelector(".leaflet-container", { timeout: 15000 }); hasLeaflet = true; } catch (_) { hasLeaflet = false; }
    ok("map finder dashboard mounted (.leaflet-container present)", hasLeaflet);

    // Poll for tiles to actually appear (not a fixed sleep) — a slow first paint should never
    // read as "no tiles were requested".
    let beforeHeal = { total: 0, unpainted: 0 };
    for (let i = 0; i < 10; i++) {
      beforeHeal = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"));
        return { total: imgs.length, unpainted: imgs.filter((el) => !el.classList.contains("leaflet-tile-loaded")).length };
      });
      if (beforeHeal.total > 0) break;
      await pacedWait(page, 500);
    }
    await pacedWait(page, 3000); // let withTileRetry's own 2 retries exhaust (~1.5s) and fail for good
    beforeHeal = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll(".leaflet-tile-pane img.leaflet-tile"));
      return { total: imgs.length, unpainted: imgs.filter((el) => !el.classList.contains("leaflet-tile-loaded")).length };
    });
    ok("tiles were attempted and are (correctly) stuck blank before the grace period", beforeHeal.total > 0 && beforeHeal.unpainted === beforeHeal.total, JSON.stringify(beforeHeal));

    // Past STUCK_TILE_GRACE_MS (5000ms) + a sweep tick (2500ms) — armBlankTileHeal's real window.
    await pacedWait(page, 9000);

    ok("A — the self-heal sweep force-reloaded at least one stuck tile", healedReloads.length > 0, `${healedReloads.length} reload(s), e.g. ${healedReloads[0] || "(none)"}`);

    const telemetry = await page.evaluate(() => {
      const recent = (window.pfTelemetry && window.pfTelemetry.recent && window.pfTelemetry.recent()) || [];
      const heals = recent.filter((r) => r && r.source === "event:map-tile-blank-self-heal");
      return { count: heals.length, sample: heals[0] || null };
    });
    const sampleMsg = telemetry.sample && telemetry.sample.message;
    let payload = null;
    try { payload = sampleMsg ? JSON.parse(sampleMsg.slice(sampleMsg.indexOf("{"))) : null; } catch (_) { payload = null; }
    ok("B — telemetry fired (event:map-tile-blank-self-heal, via window.pfTelemetry)", telemetry.count > 0, `${telemetry.count} event(s)`);
    ok("B — telemetry payload names the layer, the rect, the zoom, and how long it was blank", !!(payload && payload.layerId && payload.rect && "zoom" in payload && Number.isFinite(payload.blankMs)), JSON.stringify(payload));

    const realErrors = consoleErrors.filter((e) => !/ERR_FAILED|net::/.test(e));
    ok("C — no console/page errors while the host stays permanently dead", realErrors.length === 0, realErrors.slice(0, 5).join(" | "));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
