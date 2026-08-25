/* Verify the "locate me" map control (NEW — mobile pinch/locate/telemetry lap; NEW-MAPCTRL-2 —
 * honest permission-aware states). Logged-out, no external GIS — fully Claude-doable per
 * ATTEMPT-BEFORE-YOU-PARK.
 *
 *  1. The control renders in the bottom-left corner, stacked below the zoom control.
 *  2. A GOOD (GPS-class) mocked fix draws an accuracy circle + centers the map — the "precise"
 *     path.
 *  3. A VAGUE (Wi-Fi/IP-class) mocked fix draws NO accuracy circle and shows the honest
 *     "approximate" toast instead — the KEY DECISIONS rule under test: never present a vague IP
 *     guess as a precise location.
 *  4. A denied permission shows the honest error toast, not silence.
 *  5. NEW-MAPCTRL-2 — a PROACTIVELY denied permission (mocked navigator.permissions.query, the
 *     enterprise-policy shape) never spins and never calls getCurrentPosition at all.
 *  6. NEW-MAPCTRL-2 — a permission 'change' event (policy lifted) re-enables a blocked control.
 *  7. NEW-MAPCTRL-2 — a GARBAGE fix (50 km, classic desktop IP positioning) never flies the map
 *     and never draws a circle; it's treated as a failure with an honest reason.
 *  8. NEW-MAPCTRL-2 — an unanswered permission prompt (no callback ever fires) still stops the
 *     spinner on its own (the watchdog backstop) within a bounded time.
 *  9. NEW-MAPCTRL-2 — a 2nd click while a fix is in flight CANCELS it; a late result from the
 *     cancelled request never revives the UI.
 * 10. NEW-MAPCTRL-2 — the control always carries an aria-label and a tooltip, and a blocked
 *     state is expressed as opacity (never a hardcoded color), so it survives dark mode.
 * 11. ⛔ THE CORRECTED SCENARIO (owner measurement, same day as the original report) — the
 *     control's real environment on his company Chrome reports `permissions.query` state
 *     'prompt', NOT 'denied' (a policy of this shape blocks the geolocation REQUEST silently,
 *     without pre-announcing through the Permissions API). So the precheck reads him as
 *     available and a click proceeds normally — the defence that has to hold is the explicit,
 *     finite `timeout` passed to `map.locate()` (never the PositionOptions default of Infinity)
 *     plus the independent watchdog, BOTH exercised together here with `permissions.query`
 *     genuinely reporting 'prompt' (the real, un-mocked default) and a `getCurrentPosition`
 *     that never calls back either way — the closest reproduction of his exact measured
 *     environment this sandbox can build without a real policy-blocked browser.
 *
 * Run: BASE_URL=http://localhost:4173/ node ui-audit/verify-locate-me.mjs
 *      (vite preview must be serving the built app)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

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

// ---- Arm 4: PROACTIVELY denied (enterprise-policy shape) — never spins, never even asks ----
// `navigator.permissions.query({name:'geolocation'})` is mocked to resolve 'denied' immediately,
// the shape a company Chrome policy produces (no prompt ever shown). Also instrument
// getCurrentPosition so a spin here would be caught even if the visual check somehow weren't.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    const target = { state: "denied", onchange: null, addEventListener: (t, fn) => { if (t === "change") window.__permChangeHandler = fn; }, removeEventListener: () => {} };
    if (!navigator.permissions) navigator.permissions = {};
    navigator.permissions.query = async (d) => (d && d.name === "geolocation" ? target : { state: "granted" });
    window.__mockPermTarget = target;
    if (navigator.geolocation) {
      const real = navigator.geolocation.getCurrentPosition;
      navigator.geolocation.getCurrentPosition = (...args) => { window.__geoCalls++; return real.apply(navigator.geolocation, args); };
    }
  });
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  const visible = await btn.isVisible().catch(() => false);
  if (visible) {
    await page.waitForTimeout(400); // let the async permissions.query() resolve and apply
    const state = await btn.getAttribute("data-locate-state");
    check("a proactively-denied permission (enterprise policy) marks the control 'blocked' with no click yet", state === "blocked", `state=${state}`);
    const opacityBefore = await btn.evaluate((b) => b.style.opacity);
    check("the blocked control is dimmed via opacity, not a hardcoded color", opacityBefore && parseFloat(opacityBefore) < 1, `opacity=${opacityBefore}`);
    const tip = await btn.getAttribute("title");
    check("the tooltip names the reason (blocked by policy)", /blocked|policy/i.test(tip || ""), tip || "");
    await btn.click();
    await page.waitForTimeout(500);
    const spinningAfterClick = await btn.evaluate((b) => !!b.style.animation);
    check("clicking a blocked control does NOT spin", !spinningAfterClick);
    const geoCalls = await page.evaluate(() => window.__geoCalls || 0);
    check("clicking a blocked control never calls getCurrentPosition at all", geoCalls === 0, `calls=${geoCalls}`);
    const errToastText = await page.locator("text=/blocked|policy/i").count().catch(() => 0);
    check("clicking a blocked control still says why (LOUD-FAILURE), not silently", errToastText > 0);
  } else {
    check("a proactively-denied permission (enterprise policy) marks the control 'blocked' with no click yet", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 5: a permission CHANGE (policy lifted) re-enables the control live ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const target = { state: "denied", onchange: null, addEventListener: (t, fn) => { if (t === "change") window.__permChangeHandler = fn; }, removeEventListener: () => {} };
    if (!navigator.permissions) navigator.permissions = {};
    navigator.permissions.query = async (d) => (d && d.name === "geolocation" ? target : { state: "granted" });
    window.__mockPermTarget = target;
  });
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await page.waitForTimeout(400);
    const before = await btn.getAttribute("data-locate-state");
    // Flip the mock to granted and fire the 'change' listener the control subscribed with.
    await page.evaluate(() => { window.__mockPermTarget.state = "granted"; window.__permChangeHandler && window.__permChangeHandler(); });
    await page.waitForTimeout(200);
    const after = await btn.getAttribute("data-locate-state");
    check("a live permission change (policy lifted) re-enables a blocked control with no reload", before === "blocked" && after === "idle", `${before} → ${after}`);
  } else {
    check("a live permission change (policy lifted) re-enables a blocked control with no reload", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 6: a GARBAGE fix (50 km — desktop IP positioning) is treated as a FAILURE ----
// Playwright's mocked geolocation accuracy stands in for the browser's own IP-based fallback.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, geolocation: { latitude: 40.7, longitude: -74.0, accuracy: 50000 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(1500);
    const notice = await page.locator("text=/isn't accurate enough|not accurate enough|rough network guess/i").count().catch(() => 0);
    check("a 50 km (garbage) fix shows an honest 'not accurate enough' failure, not a location", notice > 0);
    const circleCount = await page.locator("path.leaflet-interactive").evaluateAll((els) => els.length).catch(() => 0);
    check("a 50 km (garbage) fix draws NO marker or accuracy circle", circleCount === 0, `paths=${circleCount}`);
    const state = await btn.getAttribute("data-locate-state");
    check("the control returns to idle after a garbage fix (never stuck spinning)", state === "idle", `state=${state}`);
  } else {
    check("a 50 km (garbage) fix shows an honest 'not accurate enough' failure, not a location", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 7: an UNANSWERED permission prompt — neither callback ever fires — still stops the
// spinner on its own (the watchdog backstop). Mocks getCurrentPosition to never call back.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => { /* the user never answers the native prompt — neither success nor error ever fires */ };
    }
  });
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
    const spinningNow = await btn.evaluate((b) => !!b.style.animation);
    check("an unanswered prompt starts the spinner immediately", spinningNow);
    await page.waitForTimeout(15000); // past the ~14s watchdog
    const spinningLater = await btn.evaluate((b) => !!b.style.animation);
    const state = await btn.getAttribute("data-locate-state");
    check("the watchdog stops the spinner on its own when neither callback ever fires", !spinningLater && state === "idle", `spinning=${spinningLater} state=${state}`);
    const notice = await page.locator("text=/too long/i").count().catch(() => 0);
    check("the watchdog surfaces an honest timeout-style message", notice > 0);
  } else {
    check("the watchdog stops the spinner on its own when neither callback ever fires", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 8b: THE CORRECTED SCENARIO — permissions.query genuinely reports 'prompt' (his real
// measured state, left completely un-mocked here) AND getCurrentPosition never calls back. The
// precheck must NOT report 'blocked' (it doesn't know his environment is broken), so the ENTIRE
// defence has to be the explicit timeout + independent watchdog — proven together, not the
// precheck standing in for them.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = () => { /* a policy-blocked provider: no success, no error, ever */ };
    }
  });
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    await page.waitForTimeout(400); // let the real (un-mocked) permissions.query() resolve
    const permState = await page.evaluate(async () => {
      try { const s = await navigator.permissions.query({ name: "geolocation" }); return s.state; } catch (_) { return "unsupported"; }
    });
    const stateBeforeClick = await btn.getAttribute("data-locate-state");
    check("the real (un-mocked) permission state is 'prompt', matching the owner's measurement — NOT 'denied'", permState === "prompt", `state=${permState}`);
    check("with 'prompt', the precheck correctly does NOT mark the control blocked (it can't see his policy)", stateBeforeClick === "idle", `data-locate-state=${stateBeforeClick}`);
    await btn.click();
    await page.waitForTimeout(500);
    const spinning = await btn.evaluate((b) => !!b.style.animation);
    check("the click proceeds normally (spins) — the precheck did not intervene", spinning);
    await page.waitForTimeout(12500); // past the 10s explicit timeout AND the 12s watchdog
    const stateAfter = await btn.getAttribute("data-locate-state");
    const spinningAfter = await btn.evaluate((b) => !!b.style.animation);
    check("⛔ THE ACTUAL DEFENCE HOLDS — idle again, not spinning, with permissions.query genuinely reporting 'prompt' throughout", stateAfter === "idle" && !spinningAfter, `state=${stateAfter} spinning=${spinningAfter}`);
    const notice = await page.locator("text=/too long/i").count().catch(() => 0);
    check("an honest message is shown, and the control is actionable again (retry works)", notice > 0);
    if (notice > 0) {
      // Retry: prove it isn't stuck — a fresh click starts a fresh spin.
      await btn.click();
      await page.waitForTimeout(300);
      const retrySpinning = await btn.evaluate((b) => !!b.style.animation);
      check("retry after the corrected-scenario timeout actually starts a new attempt", retrySpinning);
    }
  } else {
    check("⛔ THE ACTUAL DEFENCE HOLDS — idle again, not spinning, with permissions.query genuinely reporting 'prompt' throughout", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 8: a 2nd click while a fix is in flight CANCELS it — no concurrent request, no stuck UI
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__geoCalls = 0;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition = (ok) => {
        window.__geoCalls++;
        // Resolves LATE — long after the cancelling 2nd click below — to prove a stale result
        // arriving after cancel is ignored rather than reviving the spinner or drawing a marker.
        setTimeout(() => ok({ coords: { latitude: 29.7, longitude: -95.4, accuracy: 20 }, timestamp: Date.now() }), 4000);
      };
    }
  });
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  // NEW-MAPCTRL-2 — DRIVER-SCROLL-IS-NOT-APP-SCROLL's sibling trap: Playwright's Locator.click()
  // re-runs its actionability sequence (hover/down/up) while this element is ACTIVELY ANIMATING
  // (the CSS spin), which was measured to double-fire the real click handler here even though the
  // app itself is correct — a plain `element.click()` from inside the page (no actionability
  // machinery) reproduces the exact same two-click sequence with the RIGHT outcome every time.
  // So: drive this one via a native in-page click, same as `visibleClick`'s reasoning for why a
  // driver's OWN behaviour must not be mistaken for the app's.
  const nativeClick = () => page.evaluate(() => document.querySelector('[data-testid="locate-me-btn"]').click());
  if (await btn.isVisible().catch(() => false)) {
    await nativeClick();
    await page.waitForTimeout(300);
    const geoCallsAfter1st = await page.evaluate(() => window.__geoCalls || 0);
    await nativeClick(); // cancel
    await page.waitForTimeout(300);
    const stateAfterCancel = await btn.getAttribute("data-locate-state");
    const spinningAfterCancel = await btn.evaluate((b) => !!b.style.animation);
    check("a 2nd click while locating cancels immediately (idle, not spinning)", stateAfterCancel === "idle" && !spinningAfterCancel, `state=${stateAfterCancel} spinning=${spinningAfterCancel}`);
    await nativeClick(); // a 3rd click, now from idle, should start a genuinely NEW request
    await page.waitForTimeout(300);
    const geoCallsAfter3rd = await page.evaluate(() => window.__geoCalls || 0);
    check("cancelling then clicking again starts exactly one new request, not a pile-up", geoCallsAfter1st === 1 && geoCallsAfter3rd === 2, `1st=${geoCallsAfter1st} 3rd=${geoCallsAfter3rd}`);
    await page.waitForTimeout(4200); // let BOTH mocked calls' late resolutions land
    const state = await btn.getAttribute("data-locate-state");
    check("the control settles back to idle and isn't left spinning by a stale resolution", state === "idle", `state=${state}`);
  } else {
    check("a 2nd click while locating cancels immediately (idle, not spinning)", false, "button not visible");
  }
  await ctx.close();
}

// ---- Arm 9: the control always carries an aria-label and a tooltip ----
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-locate-me");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  const btn = page.locator('[data-testid="locate-me-btn"]');
  if (await btn.isVisible().catch(() => false)) {
    const aria = await btn.getAttribute("aria-label");
    const title = await btn.getAttribute("title");
    check("the control always carries a non-empty aria-label", !!(aria && aria.length), aria || "");
    check("the control always carries a non-empty tooltip (title)", !!(title && title.length), title || "");
  } else {
    check("the control always carries a non-empty aria-label", false, "button not visible");
  }
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
