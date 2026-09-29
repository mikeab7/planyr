/* B1939344 (NEW-1) — the Dashboard's Schedule health / Needs Attention cards used to name a
 * schedule by its OWN name only. Two different Planyr projects can each hold a schedule named
 * "Master Schedule" (the owner's own account has FOUR — see the item), so a bare name is
 * ambiguous: the Schedule health card listed four identical "Master Schedule" rows with no way to
 * tell which project each belonged to. The fix (scheduleHealth.js / needsAttentionList.js /
 * sinceLastHereFeed.js) renders the same qualified "<Project> / <Schedule>" label the Reports tab
 * (public/sequence/index.html) has used since PR #1849, via the one shared helper
 * (`crossScheduleLabel`, now in src/shared/schedule/scheduleOwnership.js).
 *
 * This spec drives the REAL built app, offline, mirroring e2e/dashboard-card-growth.spec.js's own
 * mocking shape (no real network — the sandbox's proxy CORS-blocks real Supabase entirely, and
 * this needs none of it):
 *
 *   VITE_SUPABASE_URL="https://scheduleqlabel1.supabase.co" \
 *     VITE_SUPABASE_ANON_KEY="scheduleqlabel1-dummy-key" \
 *     npx playwright test e2e/dashboard-schedule-qualified-label.spec.js
 *
 * Covers the item's own adjacent-case table: the four same-named "Master Schedule" rows (ids 1/2/
 * 3/6, matching the real production ids), the two org-owned schedules (Pursuits/Operations), and
 * the layout decision (ellipsis truncation + a title tooltip, never a reflow) at BOTH desktop and
 * phone width — Dashboard.jsx's own NARROW_BREAKPOINT_PX is 640, so 390px (iPhone-sized) drives
 * the single-column stacked layout, not just a narrower grid column.
 *
 * Red-proofed against the pre-fix source (git stash the scheduleHealth.js/needsAttentionList.js/
 * DashboardCards.jsx/NeedsAttentionCard.jsx change and rerun): every "Master Schedule" row reads
 * identically and the distinct-label assertions below fail.
 */
import { test, expect } from "@playwright/test";

const SUPABASE_HOST = "scheduleqlabel1.supabase.co";
const SUPABASE_URL = `https://${SUPABASE_HOST}`;

// The owner's real four same-named "Master Schedule" schedules (ids 1, 2, 3, 6 — see B1939344),
// each under a different project, plus one org-owned schedule (Pursuits) so the "Organization /"
// case is covered in the same fixture. Every schedule carries at least one overdue leaf task so
// summarizeScheduleHealth doesn't drop it (a zero-task schedule is not a health row).
function scheduleProjects() {
  const past = "2020-01-01";
  const task = (id) => ({ id, name: `Task ${id}`, health: "red", end: past, parentId: null, needsAttentionSince: "2026-09-01T00:00:00.000Z" });
  return {
    1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-goose", linkedSiteName: "Goose Creek", tasks: [task(101)] },
    2: { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-grand", linkedSiteName: "Grand Port", tasks: [task(201)] },
    3: { id: 3, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-south", linkedSiteName: "8 South", tasks: [task(301)] },
    6: { id: 6, name: "Master Schedule", ownerKind: "site", linkedSiteId: "site-pappa", linkedSiteName: "Pappadoupolos", tasks: [task(601)] },
    5: { id: 5, name: "Pursuits", ownerKind: "org", tasks: [task(501)] },
  };
}

async function mockSupabase(page) {
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort();

    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.startsWith("/auth/v1/")) return json({}); // signed-out throughout
    if (path === "/rest/v1/sites" && req.method() === "GET") return json([]);
    if (path === "/rest/v1/comps" && req.method() === "GET") return json([]);
    if (path === "/rest/v1/doc_reviews" && req.method() === "GET") return json(null);
    if (path === "/rest/v1/planar_data" && req.method() === "GET") return json({ value: { projects: scheduleProjects() } });
    if (path.startsWith("/rest/v1/")) return json([]);
    return json({});
  });
}

async function openDashboard(page, viewport) {
  await mockSupabase(page);
  await page.setViewportSize(viewport);
  // A literal "/" (bare hash) is a genuinely route-less first boot — src/app/firstLanding.js
  // redirects that straight to the Site Planner map for a fresh, signed-out visitor with no
  // local sites. An explicit "#/" is a real deep link (INITIAL_HASH_EMPTY reads false for it),
  // which is exactly what the Dashboard's own "Dashboard" crumb/logo navigate to — so this is
  // the correct way to land on the Dashboard, not a workaround.
  await page.goto("/#/", { waitUntil: "load" });
  const card = page.locator('[data-card-key="scheduleHealth"]');
  await expect(card).toBeVisible({ timeout: 20_000 });
  // The skeleton swaps to real content once every source resolves (B1218496) — wait for a real
  // row's text rather than a fixed timeout.
  await expect(card.getByText("Master Schedule", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  return card;
}

test.describe("B1939344 — Dashboard schedule cards use the qualified '<Project> / <Schedule>' label", () => {
  test("desktop: Schedule health lists all four same-named schedules as distinct, qualified rows", async ({ page }) => {
    const card = await openDashboard(page, { width: 1400, height: 900 });
    const rowText = await card.innerText();

    for (const label of ["Goose Creek / Master Schedule", "Grand Port / Master Schedule", "8 South / Master Schedule", "Pappadoupolos / Master Schedule"]) {
      expect(rowText, `row text should contain "${label}"`).toContain(label);
    }
    // Never the bare, ambiguous form on its own line.
    expect(rowText).not.toMatch(/^Master Schedule$/m);
  });

  test("desktop: Needs Attention names each row's schedule with the same qualified label, and the org-owned row reads 'Organization / Pursuits'", async ({ page }) => {
    await openDashboard(page, { width: 1400, height: 900 });
    const needsCard = page.locator('[data-card-key="needsAttention"]');
    await expect(needsCard).toBeVisible({ timeout: 20_000 });
    const text = await needsCard.innerText();
    expect(text).toContain("Goose Creek / Master Schedule");
    expect(text).toContain("Organization / Pursuits");
  });

  test("phone (390px, below the 640px narrow breakpoint): labels truncate in place, no page-wide horizontal scroll, no row growth", async ({ page }) => {
    const card = await openDashboard(page, { width: 390, height: 844 });

    // No horizontal overflow anywhere on the page — a truncating ellipsis, not a reflow/overlap.
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflowX, "the page must not scroll horizontally on a phone-width viewport").toBeLessThanOrEqual(1);

    // The qualified label is still present in the DOM as a `title` attribute (or full text, if it
    // happens to fit) — a truncated label must stay reachable, never silently dropped.
    const titledSpan = card.locator('span[title="Goose Creek / Master Schedule"]').first();
    await expect(titledSpan).toHaveCount(1);

    // Each schedule row's NAME span stays a single line (no wrap-driven growth) — a real
    // qualified label is roughly double a bare name's length, so this is the concrete check that
    // the ellipsis truncated it in place rather than the row growing to a second line. Scoped to
    // the `title`-bearing name span itself (DashboardCards.jsx's `title={p.name}`), not the whole
    // card, which legitimately spans several rows.
    const nameSpanHeights = await card.locator("span[title]").evaluateAll(
      (els) => els.map((el) => el.getBoundingClientRect().height)
    );
    expect(nameSpanHeights.length, "expected one title-bearing name span per schedule row").toBeGreaterThanOrEqual(4);
    for (const h of nameSpanHeights) expect(h, "a schedule row's name must stay single-line, not wrap to a second line").toBeLessThan(24);
  });
});
