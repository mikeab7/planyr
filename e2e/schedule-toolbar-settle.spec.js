/* B1218496 — the Scheduler's lifted Row-2 toolbar (ScheduleToolbar.jsx, rendered inside the
 * shared AppHeader while the embedded Gantt iframe reports its state over postMessage) used to
 * MOUNT pieces of itself conditionally as fields resolved at different times during the load
 * window, moving already-pressable, already-rendered controls sideways:
 *
 *   - The "Review" button's unread-count badge only mounted once `reviewCount > 0` — the iframe
 *     re-posts its WHOLE toolbar-state payload whenever anything it tracks changes, including its
 *     own review-suggestions count arriving a beat after the report that first revealed the
 *     Grid/Split/Gantt toggle. Since that whole group is `justifyContent:"center"`, the badge
 *     mounting widened it and re-centered everything in it — sliding "Grid" sideways.
 *   - The zoom-control block only mounted once `toolbar.zoomable` was known — a bare
 *     `markToolbarReadyFallback()` (fired ~2.5s after the iframe loads, so the toolbar doesn't
 *     lag behind the rest of the app revealing itself) flips `ready` with `zoomable` still
 *     unknown/false; the REAL report that lands moments later can then confirm `zoomable:true`,
 *     inserting that block right before the "Version history" icon button and pushing it
 *     sideways.
 *
 * Real telemetry (event:click-swallowed, src/shared/ui/clickDiag.js) recorded exactly this: a
 * press on "Grid" and a press near "Version history", each followed 900ms later by a missed click
 * because the same still-mounted button had moved.
 *
 * The fix (ScheduleToolbar.jsx / Scheduler.jsx) reserves both pieces' boxes (visibility, never
 * mount/unmount) — the badge permanently (it can grow at any time in a live session, not just at
 * load), the zoom block only until `toolbar.settled` (the first REAL report, as opposed to the
 * bare fallback) — so neither can insert itself into an already-rendered row.
 *
 * B1547280 (AMENDMENT to B1511712, 2026-09) — the review button (with its badge) later moved OUT
 * of the centered Grid/Split/Gantt group and into the right-hand action zone (ScheduleActions),
 * so AppHeader's Row-2 centering measures the view toggle alone rather than a wider combined
 * bundle. The RESERVATION discipline this spec guards — mount once, toggle visibility, never
 * insert — moved with it unchanged, so the first test below (badge 0→5) still proves the same
 * property in the button's new home: "Grid" has no sibling in its own group any more, and the
 * badge's own zone (ScheduleActions) never changes width when the count changes because the
 * badge span itself is always mounted at a fixed size.
 *
 * This spec drives the REAL Scheduler workspace's outer shell (AppHeader + Scheduler.jsx) but
 * replaces the embedded Gantt app (`/sequence/`) with an inert blank document, then plays the
 * postMessage bridge itself (`window.postMessage({source:"planar-seq", ...}, origin)` — the
 * listener only checks e.origin, never e.source, so this is indistinguishable from the real
 * iframe as far as Scheduler.jsx is concerned). That sidesteps needing the embedded app's own
 * ~13,900-line boot sequence and its own Supabase reads to behave any particular way — this bug
 * lives entirely in the shell's OWN toolbar-state handling.
 *
 *   VITE_SUPABASE_URL="https://clickswallowedfix1.supabase.co" \
 *     VITE_SUPABASE_ANON_KEY="clickswallowedfix1-dummy-key" \
 *     npx playwright test e2e/schedule-toolbar-settle.spec.js
 *
 * Red-proofed against the pre-fix source: "Grid"'s box moves once the review-count badge mounts;
 * "Version history"'s box moves once the zoom block mounts on the real (post-fallback) report.
 */
import { test, expect } from "@playwright/test";

const SUPABASE_HOST = "clickswallowedfix1.supabase.co";

async function mockShell(page, { clickSwallowedReports }) {
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
      // The embedded Gantt app is a huge, separately-booting React app with its own Supabase
      // reads — irrelevant to this bug (it lives entirely in the shell's toolbar-state handling,
      // as the file header explains) and a real load would race this test's own synthetic
      // postMessage calls with the embed's real ones. Replace it with an inert blank document;
      // everything else same-origin (the built app itself) passes through untouched.
      if (u.pathname === "/sequence/" || u.pathname.startsWith("/sequence/")) {
        return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body></body></html>" });
      }
      return route.continue();
    }
    if (u.hostname !== SUPABASE_HOST) return route.abort();

    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path.startsWith("/auth/v1/")) return json({});
    if (path === "/rest/v1/client_errors" && req.method() === "POST") {
      try {
        const body = JSON.parse(req.postData() || "{}");
        if (body && body.source === "event:click-swallowed") clickSwallowedReports.push(body);
      } catch (_) {}
      return json({});
    }
    if (path.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

// Post a `planar:toolbar-state` message as if the embedded scheduler sent it — see the file
// header for why this is a faithful stand-in for the real iframe's own postMessage.
async function postToolbarState(page, fields) {
  await page.evaluate((f) => {
    window.postMessage({ source: "planar-seq", type: "planar:toolbar-state", ...f }, window.location.origin);
  }, fields);
}

// Scheduler.jsx's own message listener attaches in a useEffect, which can run a beat after
// page.goto's "load" event (the Scheduler workspace is itself a lazy-loaded chunk). Retry the
// post until the expected locator shows up, rather than assuming the very first post landed.
async function postUntilVisible(page, fields, locator, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await postToolbarState(page, fields);
    try { await locator.waitFor({ state: "visible", timeout: 200 }); return; } catch (_) {}
    if (Date.now() > deadline) { await expect(locator).toBeVisible({ timeout: 1 }); return; }
  }
}

const BASE_TOOLBAR = {
  view: "grid", section: "projects", isMobile: false, zoomPct: 100, zoomable: false,
  reviewCount: 0, reviewOpen: false, saveStatus: "saved", savePulse: false, fileLinked: false,
  offlineFallback: false, authRequired: false, activePanel: null,
};

test.describe("B1218496 — Scheduler's lifted toolbar doesn't reflow under an in-flight press", () => {
  test('the "Grid" tab does not move when the review-count badge later mounts', async ({ page }) => {
    test.setTimeout(60_000);
    const clickSwallowedReports = [];
    await page.addInitScript(() => { window.__PLANYR_TELEMETRY_NETWORK = true; });
    await mockShell(page, { clickSwallowedReports });
    await page.goto("/#/schedule", { waitUntil: "load" });

    // The FIRST real report already confirms section:"projects" — Grid/Split/Gantt mount now,
    // with a genuinely-zero review count (the badge is reserved-but-hidden, not yet an issue).
    const grid = page.getByRole("group", { name: "View" }).getByRole("button", { name: "Grid" });
    await postUntilVisible(page, { ...BASE_TOOLBAR, reviewCount: 0 }, grid);
    const boxAtPress = await grid.boundingBox();
    expect(boxAtPress).toBeTruthy();

    await page.mouse.move(boxAtPress.x + boxAtPress.width / 2, boxAtPress.y + boxAtPress.height / 2);
    await page.mouse.down();
    // The iframe re-posts its whole toolbar-state payload once its own review-suggestions fetch
    // resolves a beat later — same shape as the fast-vs-slow dashboard sources, just via the bridge.
    await postToolbarState(page, { ...BASE_TOOLBAR, reviewCount: 5 });
    await page.waitForTimeout(700); // past clickDiag's 900ms grace from the press
    const boxAtRelease = await grid.boundingBox();
    await page.mouse.up();

    expect(boxAtRelease).toBeTruthy();
    expect(Math.abs(boxAtRelease.x - boxAtPress.x), '"Grid" must not move when the review badge mounts beside it').toBeLessThan(1);
    expect(Math.abs(boxAtRelease.y - boxAtPress.y)).toBeLessThan(1);

    await page.waitForTimeout(200);
    expect(clickSwallowedReports).toEqual([]);
  });

  test('"Version history" does not move when the zoom block later mounts on the real report', async ({ page }) => {
    test.setTimeout(60_000);
    const clickSwallowedReports = [];
    await page.addInitScript(() => { window.__PLANYR_TELEMETRY_NETWORK = true; });
    await mockShell(page, { clickSwallowedReports });
    await page.goto("/#/schedule", { waitUntil: "load" });

    // Nothing posted yet — let the real ~2.5s fallback timer (markToolbarReadyFallback) fire,
    // exactly the "iframe hasn't answered yet" case that produced the incomplete first render.
    const versionHistory = page.getByRole("button", { name: /Version history/i });
    await expect(versionHistory).toBeVisible({ timeout: 20_000 });
    const boxAtPress = await versionHistory.boundingBox();
    expect(boxAtPress).toBeTruthy();

    await page.mouse.move(boxAtPress.x + boxAtPress.width / 2, boxAtPress.y + boxAtPress.height / 2);
    await page.mouse.down();
    // The real report finally lands, confirming a split/gantt-shaped view (zoomable:true) — the
    // exact transition that used to insert the zoom block in front of this button.
    await postToolbarState(page, { ...BASE_TOOLBAR, view: "split", zoomable: true, reviewCount: 0 });
    await page.waitForTimeout(700);
    const boxAtRelease = await versionHistory.boundingBox();
    await page.mouse.up();

    expect(boxAtRelease).toBeTruthy();
    expect(Math.abs(boxAtRelease.x - boxAtPress.x), '"Version history" must not move when the zoom block appears').toBeLessThan(1);
    expect(Math.abs(boxAtRelease.y - boxAtPress.y)).toBeLessThan(1);

    await page.waitForTimeout(200);
    expect(clickSwallowedReports).toEqual([]);
  });
});

/* B1581952 — the owner's OWN LIVE RECORDER (AppHeader.jsx's row2 centering `useLayoutEffect`,
 * shipped in the prior round for exactly this disagreement) caught the real defect: on his real
 * page, the FIRST synchronous `measure()` call ran while `ScheduleCenter`/`ScheduleActions` were
 * still empty (`toolbar.ready` not yet true) and correctly recorded `reason:"unmeasurable"` — but
 * it never ran again once the real report populated both zones a beat later, and the row was
 * still off-centre. A plain 3s-delayed report does NOT reproduce this in this sandbox — checked
 * directly, ResizeObserver alone already recovers it here, same as every earlier attempt — so
 * whatever silences the FIRST watch on his page is something this sandbox's simplified page never
 * triggers (candidates include the browser's "ResizeObserver loop" notification-drop behaviour
 * under real page load's much heavier concurrent observer activity, which a small standalone
 * reproduction cannot manufacture). Rather than claim a mechanism this session cannot prove, the
 * fix adds a SECOND, structurally-INDEPENDENT watch — a MutationObserver on the row's own
 * subtree, which fires on the DOM-node-level event of `<></>` being replaced by `<ViewToggle/>`'s
 * real markup, a fundamentally different trigger than a ResizeObserver box-size notification and
 * not subject to whatever silenced that one. The two tests below are honest about what each
 * proves: the first is the owner's own delayed-report scenario (a real regression check, but not
 * teeth-proven against this specific fix, since it already passed before this fix in this
 * sandbox); the second is a genuine mutation-proof — it disables ResizeObserver's callback
 * entirely (a fair stand-in for "whatever is happening on his page, the RO watch isn't firing")
 * and shows centering can ONLY resolve via the new MutationObserver path. */
test.describe("B1581952 — the centering recorder must not go silent on a slow report", () => {
  test("a report delayed 3s past the unmeasurable boot state still resolves to centered, with a full log", async ({ page }) => {
    test.setTimeout(60_000);
    await mockShell(page, { clickSwallowedReports: [] });
    await page.setViewportSize({ width: 1191, height: 900 });
    await page.goto("/#/schedule", { waitUntil: "load" });

    // Give the boot ("unmeasurable") state time to sit — long enough that a one-shot-only watch
    // would have already given up, matching the slow-network shape of the owner's real report.
    await page.waitForTimeout(3000);
    const preLog = await page.evaluate(() => window.__scheduleCenterDebugLog || []);
    expect(preLog.length).toBeGreaterThan(0);
    expect(preLog[preLog.length - 1].reason).toBe("unmeasurable");

    const grid = page.getByRole("group", { name: "View" }).getByRole("button", { name: "Grid" });
    await postUntilVisible(page, { ...BASE_TOOLBAR }, grid);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const modeEl = document.querySelector("[data-schedule-center-mode]");
      const row2 = modeEl ? modeEl.parentElement : null;
      const box = (el) => (el ? el.getBoundingClientRect() : null);
      return { mode: modeEl?.getAttribute("data-schedule-center-mode"), rowBox: box(row2), log: window.__scheduleCenterDebugLog || [] };
    });

    // The exact assertion the owner asked for: more than one entry, a measurable final rightW,
    // and a final mode matching what the fit test says for the settled layout.
    expect(result.log.length).toBeGreaterThan(1);
    const last = result.log[result.log.length - 1];
    expect(last.rightW).toBeGreaterThan(100);
    expect(last.min).toBeGreaterThan(0);
    expect(result.mode).toBe("centered");

    const grid2 = page.getByRole("group", { name: "View" });
    const chipBox = await grid2.boundingBox();
    const rowCenter = result.rowBox.x + result.rowBox.width / 2;
    const chipCenter = chipBox.x + chipBox.width / 2;
    expect(Math.abs(chipCenter - rowCenter)).toBeLessThan(2);
  });

  test("MUTATION-PROOF: with ResizeObserver's callback disabled entirely, centering still recovers via the MutationObserver watch", async ({ page }) => {
    test.setTimeout(60_000);
    // Installed before any app code runs: ResizeObserver still exists (so the code's own
    // `typeof ResizeObserver !== "function"` fallback is NOT what's under test) but its callback
    // is never invoked — a fair stand-in for "the RO watch isn't firing," whatever the real cause
    // on the owner's page turns out to be.
    await page.addInitScript(() => {
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    });
    await mockShell(page, { clickSwallowedReports: [] });
    await page.setViewportSize({ width: 1191, height: 900 });
    await page.goto("/#/schedule", { waitUntil: "load" });
    await page.waitForTimeout(500);

    const preLog = await page.evaluate(() => window.__scheduleCenterDebugLog || []);
    expect(preLog[preLog.length - 1].reason).toBe("unmeasurable");

    const grid = page.getByRole("group", { name: "View" }).getByRole("button", { name: "Grid" });
    await postUntilVisible(page, { ...BASE_TOOLBAR }, grid);
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const modeEl = document.querySelector("[data-schedule-center-mode]");
      return { mode: modeEl?.getAttribute("data-schedule-center-mode"), log: window.__scheduleCenterDebugLog || [] };
    });
    expect(result.log.length).toBeGreaterThan(1);
    expect(result.log.some((e) => e.trigger === "mutation")).toBe(true);
    expect(result.log.every((e) => e.trigger !== "resize")).toBe(true); // proves RO genuinely never fired
    expect(result.mode).toBe("centered");
  });
});
