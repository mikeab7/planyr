/* B1218496 — the Dashboard's cards used to reveal their real content the moment EACH card's own
 * data source resolved, independently. A card whose source answers fast (here, the sites read
 * behind "Pursuits by activity") showed its final rows first; a slower source (here, the
 * schedules read behind "Schedule health") kept showing its short "No schedules yet." line until
 * it resolved — then swapped to several real rows, growing that card and shoving every card in a
 * LATER grid row down the page. `event:click-swallowed` (src/shared/ui/clickDiag.js) recorded
 * exactly this on the real dashboard: a press on a project row, then a click 900ms later landing
 * somewhere else because the row had slid down from under the finger.
 *
 * The fix (Dashboard.jsx / DashboardCards.jsx): every card renders the SAME stable-height
 * skeleton until ALL FOUR sources have settled, then swaps every card to its real content in one
 * synchronized paint. Nothing can grow later out from under an already-rendered, already-pressed
 * row.
 *
 * This spec drives the REAL built app, offline: every Supabase request is answered by
 * page.route() (no real network — the sandbox's proxy CORS-blocks real Supabase entirely, and
 * this needs none of it). Requires the build to carry a Supabase-shaped config — see
 * e2e/new1-team-plan-count.spec.js's own header for why (Vite inlines VITE_SUPABASE_URL/
 * VITE_SUPABASE_ANON_KEY as string literals):
 *
 *   VITE_SUPABASE_URL="https://clickswallowedfix1.supabase.co" \
 *     VITE_SUPABASE_ANON_KEY="clickswallowedfix1-dummy-key" \
 *     npx playwright test e2e/dashboard-card-growth.spec.js
 *
 * (Same dummy host as e2e/schedule-toolbar-settle.spec.js and e2e/header-account-resolve.spec.js
 * — the three B1218496 specs share one host so one local build/preview serves all three.)
 *
 * Red-proofed against the pre-fix source (git stash the Dashboard.jsx/DashboardCards.jsx change
 * and rerun): the pressed "Richfield harris" row's box moves down once "Schedule health"'s slow
 * read resolves and grows above it.
 */
import { test, expect } from "@playwright/test";

const SUPABASE_HOST = "clickswallowedfix1.supabase.co";
const SUPABASE_URL = `https://${SUPABASE_HOST}`;

// How long the "Schedule health" read is held back. The whole press→release gesture below must
// stay under clickDiag's own 900ms grace window (a hold LONGER than that is itself an artificial
// missed click, independent of any reflow — not the thing this spec is testing), so this is
// picked with real margin either side: comfortably past load so the slow card has genuinely
// resolved before release, comfortably under 900 so a real click still lands.
const SLOW_MS = 350;

// Three site rows sharing one group_id (so pursuitsByActivity reads them as one project with
// planCount 3) — the exact "Richfield harris - 3 plans" shape the real telemetry captured.
function siteRows() {
  const now = new Date().toISOString();
  return [1, 2, 3].map((n) => ({
    id: `site-richfield-${n}`, group_id: "group-richfield", site: "Richfield harris",
    name: "Richfield harris", county: "Harris", updated_at: now, status: "active", role: "pursuit",
  }));
}

// Several schedule "projects" with overdue tasks, so summarizeScheduleHealth returns multiple
// rows once this resolves — a real, multi-row height, not a one-line placeholder.
function scheduleProjects() {
  const past = "2020-01-01";
  const projects = {};
  for (let i = 1; i <= 4; i++) {
    projects[i] = {
      id: i, name: `Schedule ${i}`, linkedSiteId: null,
      tasks: [{ id: i * 10, name: "Task", health: "red", end: past, parentId: null }],
    };
  }
  return projects;
}

async function mockSupabase(page, { clickSwallowedReports }) {
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort();

    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.startsWith("/auth/v1/")) return json({}); // signed-out throughout — irrelevant to this bug
    if (path === "/rest/v1/sites" && req.method() === "GET") return json(siteRows());
    if (path === "/rest/v1/comps" && req.method() === "GET") return json([]);
    if (path === "/rest/v1/doc_reviews" && req.method() === "GET") return json(null);
    if (path === "/rest/v1/planar_data" && req.method() === "GET") {
      await new Promise((r) => setTimeout(r, SLOW_MS));
      return json({ value: { projects: scheduleProjects() } });
    }
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

test.describe("B1218496 — Dashboard cards don't reflow under an in-flight press", () => {
  test("a pressed project row's box is unchanged across the slow card's resolution", async ({ page }) => {
    test.setTimeout(60_000);
    const clickSwallowedReports = [];
    await page.addInitScript(() => { window.__PLANYR_TELEMETRY_NETWORK = true; }); // observe the report path rather than the automated-run suppression
    await mockSupabase(page, { clickSwallowedReports });
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/", { waitUntil: "load" });

    // Scoped to the "N plan" shape only PursuitsByActivityCard's row carries — JumpBackInCard's
    // "Last project" row shows the same project name with no plan count, so a bare name match is
    // ambiguous (both cards resolve to the one project in this fixture).
    const row = page.getByRole("button", { name: /Richfield harris.*\d+ plans?/ });
    await expect(row).toBeVisible({ timeout: 20_000 });

    const boxAtPress = await row.boundingBox();
    expect(boxAtPress, "row must have a real box before pressing it").toBeTruthy();

    await page.mouse.move(boxAtPress.x + boxAtPress.width / 2, boxAtPress.y + boxAtPress.height / 2);
    await page.mouse.down();
    // Past the slow "Schedule health" read (SLOW_MS) but still comfortably under clickDiag's
    // 900ms grace window, so the release below completes as an ordinary, unswallowed click.
    await page.waitForTimeout(SLOW_MS + 200);
    const boxAtRelease = await row.boundingBox();
    await page.mouse.up();

    expect(boxAtRelease, "the same row must still exist when the click resolves").toBeTruthy();
    // Sub-pixel layout rounding (<1px) is real-browser noise, not a reflow; anything wider is the
    // bug this spec is guarding.
    expect(Math.abs(boxAtRelease.y - boxAtPress.y), "the pressed row must not have moved vertically while the press was in flight")
      .toBeLessThan(1);
    expect(Math.abs(boxAtRelease.x - boxAtPress.x), "the pressed row must not have moved horizontally while the press was in flight")
      .toBeLessThan(1);

    // Give clickDiag's own timer (900ms from the press) a moment to fire if it was going to.
    await page.waitForTimeout(200);
    expect(clickSwallowedReports, "no event:click-swallowed report should fire for a stable row").toEqual([]);
  });
});
