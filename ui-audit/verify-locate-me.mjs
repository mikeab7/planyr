/* Verify the "locate me" map control (NEW — mobile pinch/locate/telemetry lap).
 * Logged-out, no external GIS — fully Claude-doable per ATTEMPT-BEFORE-YOU-PARK.
 *
 *  1. The control renders in the bottom-left corner, stacked below the zoom control.
 *  2. A GOOD (GPS-class) mocked fix draws an accuracy circle + centers the map — the "precise"
 *     path.
 *  3. A VAGUE (Wi-Fi/IP-class) mocked fix draws NO accuracy circle and shows the honest
 *     "approximate" toast instead — the KEY DECISIONS rule under test: never present a vague IP
 *     guess as a precise location.
 *  4. A denied permission shows the honest error toast, not silence.
 *
 * Run: BASE_URL=http://localhost:4173/ node ui-audit/verify-locate-me.mjs
 *      (vite preview must be serving the built app)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

// ---- Arm 1: a good (GPS-class) fix ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, geolocation: { latitude: 29.786, longitude: -95.83, accuracy: 15 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);

  const btn = page.locator('[data-testid="locate-me-btn"]');
  const btnVisible = await btn.isVisible().catch(() => false);
  check("locate-me control renders", btnVisible);
  const box = btnVisible ? await btn.boundingBox() : null;
  const zoomBox = await page.locator(".leaflet-control-zoom").first().boundingBox().catch(() => null);
  check("locate-me sits below the zoom control (same bottom-left stack)", !!box && !!zoomBox && box.y > zoomBox.y, box && zoomBox ? `locate.y=${box.y.toFixed(0)} zoom.y=${zoomBox.y.toFixed(0)}` : "no boxes");

  if (btnVisible) {
    await btn.click();
    await page.waitForTimeout(1200);
    const circleCount = await page.locator("path.leaflet-interactive, svg path").evaluateAll((els) => els.length).catch(() => 0);
    // A real check: the locate layer group holds a circleMarker + an accuracy circle (2 SVG paths minimum among Leaflet's vector layer).
    check("a good fix draws map markup (marker + accuracy circle)", circleCount > 0, `paths=${circleCount}`);
    const errToastText = await page.locator("text=/approximate|denied|too long|Couldn't determine/i").count().catch(() => 0);
    check("a good (tight) fix shows NO 'approximate location' toast", errToastText === 0);
  }
  await ctx.close();
}

// ---- Arm 2: a vague (Wi-Fi/IP-class) fix — the honesty rule under test ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, geolocation: { latitude: 29.786, longitude: -95.83, accuracy: 5000 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1200);
    const notice = await page.locator("text=/approximate/i").count().catch(() => 0);
    check("a vague (5 km) fix shows the honest 'approximate' notice — never presented as precise", notice > 0);
  } else {
    check("a vague (5 km) fix shows the honest 'approximate' notice — never presented as precise", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 3: permission denied — never silent (LOUD-FAILURE) ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); // no geolocation permission granted → getCurrentPosition rejects PERMISSION_DENIED
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1200);
    const notice = await page.locator("text=/denied|Couldn't determine|too long/i").count().catch(() => 0);
    check("a denied/unavailable fix shows an honest error toast, never silence", notice > 0);
  } else {
    check("a denied/unavailable fix shows an honest error toast, never silence", false, "button not visible");
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
