/* Self-verification for B1795456 — the calibration/accuracy badge (bottom-left of the site-plan
 * canvas) matches the map chrome (the scale-bar card / compass / help / zoom cluster) instead of
 * painting its own solid state colour, and carries exactly one status dot instead of two.
 *
 * Owner's four-mockup review picked "option B": the container reuses the scale-bar card's own
 * background/border/radius, the label reads "Scaled" in the chrome ink + a hairline divider +
 * "county GIS" a step lighter — never the old green fill + a decorative "●"/"▲" glyph doubling
 * the real status dot.
 *
 * Driven in the real app on the Vite preview (:4173), logged-out / this-device mode. Two of the
 * badge's four `calibrationState` values are reachable WITHOUT auth or a live GIS call:
 *   (a) DRAWN  — no origin, no pinned map reference (the default "Draw" flow).
 *   (b) GEOREF — `origin` set (isGeoref), no pinned map reference — the reported "Scaled · county
 *                GIS" case. Reaching this needs no live GIS round-trip: the badge reads the SITE
 *                MODEL's own `origin` field, which this harness seeds directly.
 *
 * ⛔ AUDIT-FIRST finding, out of this item's scope (presentation-only; "do not touch the logic
 * that decides scaled vs unscaled") but worth recording rather than silently working around: the
 * `calibrated`/`uncalibrated` cfg branches this file's `calibrationState` still defines are
 * UNREACHABLE under the app's current gate. `mapRef = sheetOverlays.find(isPinnedMapReference)`
 * and `isPinnedMapReference` requires `fromMap === true`; the ternary then reads
 * `mapRef.fromMap ? "georef" : mapRef.calibrated ? "calibrated" : "uncalibrated"` — so ANY truthy
 * `mapRef` has `fromMap === true` by construction and always takes the first branch. A hand-dropped
 * (non-`fromMap`) reference never becomes `mapRef` at all (B848736 made it an ordinary sheetOverlay
 * with its own trace-length flow instead). Confirmed empirically here, not just by reading: seeding
 * a non-`fromMap`, `calibrated:false` overlay still renders "True scale · drawn in feet" (the
 * `drawn` state), never "Not calibrated". This is pre-existing behaviour, unchanged by B1795456 —
 * `cfg`'s `calibrated`/`uncalibrated` entries are proven structurally correct by the SOURCE-level
 * test in test/sheetFurniture.test.js instead, since no data shape can drive them live today.
 *
 * Run:
 *   npm run build && npx vite preview --host --port 4173 &   # then:
 *   node ui-audit/verify-b1795456-scale-badge-chrome.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };
const baseSite = { groupId: "g", county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, sheetOverlays: [], parcelDrawings: [], updatedAt: 1 };

const sites = {
  "b1795456-drawn": { ...baseSite, id: "b1795456-drawn", groupId: "b1795456-drawn", site: "B1795456 Drawn", name: "Plan 1", origin: null },
  "b1795456-georef": { ...baseSite, id: "b1795456-georef", groupId: "b1795456-georef", site: "B1795456 Georef", name: "Plan 1", origin: { lat: 29.7858, lon: -95.8244 } },
};

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::|CORS policy/i;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function openScenario(id) {
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [id]: sites[id] })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(id)});
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true, colorScheme: "dark" });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${id}] ${e}`));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(`[${id}] ${m.text()}`); });
  await page.goto(BASE, { waitUntil: "load" });
  await assertMeasurable(page, "verify-b1795456-scale-badge-chrome");
  await page.waitForTimeout(1200);
  // Lands on the Dashboard by default — the Site workspace is its own tab.
  try { await page.locator('button:has-text("Site"), a:has-text("Site")').first().click({ timeout: 8000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(1500);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(400);
  return page;
}

async function checkBadge(id, { expectLabel, expectDetail, expectDot, expectSub }) {
  const page = await openScenario(id);
  const badge = page.locator('[data-testid="calibration-badge"]');
  log(await badge.count() === 1, `(${id}) the badge renders`);

  const badgeText = await badge.innerText().catch(() => "");
  log(badgeText.includes(expectLabel), `(${id}) label reads "${expectLabel}" (saw "${badgeText}")`);
  if (expectDetail) log(badgeText.includes(expectDetail), `(${id}) detail reads "${expectDetail}" (saw "${badgeText}")`);
  if (expectSub) log(badgeText.includes(expectSub), `(${id}) sub reads "${expectSub}" (saw "${badgeText}")`);
  log(!badgeText.includes("●") && !badgeText.includes("▲"), `(${id}) no decorative "●"/"▲" glyph in the rendered text`);

  // Exactly one dot: a small (~7×7) fully-rounded coloured element inside the badge.
  const dotCount = await badge.evaluate((el) =>
    [...el.querySelectorAll("span")].filter((s) => {
      const cs = getComputedStyle(s);
      return parseFloat(cs.width) <= 10 && parseFloat(cs.height) <= 10 && parseFloat(cs.borderTopLeftRadius) >= 3;
    }).length
  );
  log(dotCount === 1, `(${id}) exactly one dot element (saw ${dotCount})`);
  const dotBg = await badge.evaluate((el) => {
    const s = [...el.querySelectorAll("span")].find((s) => {
      const cs = getComputedStyle(s);
      return parseFloat(cs.width) <= 10 && parseFloat(cs.height) <= 10 && parseFloat(cs.borderTopLeftRadius) >= 3;
    });
    return s && getComputedStyle(s).backgroundColor;
  });
  log(!!dotBg && dotBg !== "rgba(0, 0, 0, 0)", `(${id}) the dot carries the state colour (${dotBg})`);

  // Container chrome literally equals the scale-bar plate's own rect fill/stroke/radius, read
  // straight off the SVG the scale bar draws (its inline fill/stroke/rx ARE its rendered style —
  // there is no separate CSS cascade for an inline SVG presentation attribute to resolve).
  const chrome = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="calibration-badge"]');
    const rect = document.querySelector('[data-testid="scale-bar-plate"] svg rect');
    if (!b || !rect) return null;
    const cs = getComputedStyle(b);
    return {
      badgeBg: cs.backgroundColor, badgeBorderColor: cs.borderTopColor, badgeBorderWidth: cs.borderTopWidth, badgeRadius: cs.borderTopLeftRadius,
      rectFill: rect.getAttribute("fill"), rectStroke: rect.getAttribute("stroke"), rectRx: rect.getAttribute("rx"),
    };
  });
  log(!!chrome, `(${id}) both the badge and the scale-bar plate are on screen to compare`);
  if (chrome) {
    // Parse the badge's computed rgb() against the plate's fill/stroke attribute — which may be
    // `rgb(...)` OR `#rrggbb` (scaleBarPlate reads whichever form the theme token supplies) — to
    // the SAME [r,g,b] shape before comparing, rather than diffing two different string formats.
    const num = (s) => {
      const hex = /^#([0-9a-f]{6})$/i.exec(s.trim());
      if (hex) { const n = parseInt(hex[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
      return (s.match(/[\d.]+/g) || []).map(Number).slice(0, 3);
    };
    const badgeRgb = num(chrome.badgeBg).join(",");
    const rectRgb = num(chrome.rectFill).join(",");
    log(badgeRgb === rectRgb, `(${id}) badge background === scale-bar plate fill (${chrome.badgeBg} vs ${chrome.rectFill})`);
    const badgeBorderRgb = num(chrome.badgeBorderColor).join(",");
    const rectStrokeRgb = num(chrome.rectStroke).join(",");
    log(badgeBorderRgb === rectStrokeRgb, `(${id}) badge border colour === scale-bar plate stroke (${chrome.badgeBorderColor} vs ${chrome.rectStroke})`);
    const radiusPx = parseFloat(chrome.badgeRadius), rxPx = parseFloat(chrome.rectRx);
    log(Math.abs(radiusPx - rxPx) < 0.05, `(${id}) badge border-radius === scale-bar plate rx (${radiusPx}px vs ${rxPx}px)`);
    log(radiusPx < 12, `(${id}) radius is a tight rounded-rectangle, not the old fully-rounded pill (${radiusPx}px)`);
  }

  await page.screenshot({ path: OUT + `${id}.png` });
  await page.context().close();
}

console.log("Scenario (a) DRAWN — no origin, no reference:");
await checkBadge("b1795456-drawn", { expectLabel: "True scale", expectDetail: "drawn in feet" });

console.log("\nScenario (b) GEOREF — origin set (the reported case):");
await checkBadge("b1795456-georef", { expectLabel: "Scaled", expectDetail: "county GIS" });

const appErrors = errors.filter((e) => !NOISE.test(e));
log(appErrors.length === 0, `no app console/page errors across all scenarios (saw ${appErrors.length}; ${errors.length - appErrors.length} env-noise lines ignored)`);
if (appErrors.length) console.log("  app errors:", appErrors.slice(0, 8));

await browser.close();
console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
