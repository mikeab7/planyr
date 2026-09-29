/* NEW-1 / NEW-2 / NEW-3 / NEW-4 — renaming a project, through the REAL render path.
 *
 * The owner's report: "I just tried renaming a project from the map viewer via the drop down, and
 * it didn't remember it." Two independent defects produced that, and both are asserted here:
 *   • the header dropdown's rename was UNWIRED in map mode, so it fell through to a LOCAL-ONLY
 *     write that never reached the cloud (NEW-4 / NEW-2), and
 *   • a project's name was copied onto every plan with nothing keeping the copies in agreement, so
 *     a plan that wasn't loaded at rename time re-published the old name (NEW-1 / NEW-3).
 *
 * Runs LOGGED OUT against the on-device store, so the whole thing is Claude-verifiable here (the
 * ATTEMPT-BEFORE-YOU-PARK rule). What logged-out CAN prove, and does below: the rename affordance
 * exists where the owner looks for it, it writes every plan in the group, the stamp lands, a split
 * group converges to one entry, and the whole thing survives a reload. What it CANNOT prove — that
 * the single group-wide cloud write reaches a plan this browser has never hydrated — needs a real
 * account and a second browser, and is the live V### in VERIFICATION.md (`Blocker: auth`).
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const STORE = "planarfit:sites:v1";

/* Seed the logged-out store directly with a multi-plan project, so we are testing the rename
 * rather than the drawing tools. `site` is the PROJECT name (shared); `name` is the plan label. */
async function seedProject(page, plans) {
  // ONCE only — this runs on every navigation, and a reload that re-seeds would overwrite exactly
  // the persistence these tests exist to prove.
  await page.addInitScript(([key, rows]) => {
    if (localStorage.getItem(key)) return;
    const map = {};
    for (const p of rows) map[p.id] = { schemaVersion: 12, updatedAt: Date.now(), els: [], parcels: [], measures: [], callouts: [], markups: [], settings: {}, ...p };
    localStorage.setItem(key, JSON.stringify(map));
  }, [STORE, plans]);
}

// The stored truth — on-disk, so it doubles as the reload assertion.
const readStore = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  return Object.values(map).map((s) => ({ id: s.id, groupId: s.groupId, site: s.site, name: s.name, siteRenamedAt: s.siteRenamedAt ?? null }));
}, STORE);

const SILVESTRI = [
  { id: "p-a", groupId: "grp", site: "Sylvestri", name: "Concept A" },
  { id: "p-b", groupId: "grp", site: "Sylvestri", name: "Concept B" },
  { id: "p-c", groupId: "grp", site: "Sylvestri", name: "Concept C" },
];

async function boot(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
}

// Open the header project dropdown (the crumb right of the logo, in the VISIBLE mode).
async function openProjectCrumb(page) {
  await page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first().click();
}

test.describe("NEW-3 — a project split across two names shows as ONE project", () => {
  test("the store converges a split group onto its authoritative name, idempotently", async ({ page }) => {
    // The owner's real shape: the rename reached two plans, the third kept the old spelling.
    await seedProject(page, [
      { id: "p-a", groupId: "grp", site: "Silvestri", name: "Concept A" },
      { id: "p-b", groupId: "grp", site: "Silvestri", name: "Concept B" },
      { id: "p-c", groupId: "grp", site: "Sylvestri", name: "Concept D" }, // the straggler
    ]);
    await boot(page);
    // The reconciliation is a load-time pass, so the store converges without any interaction…
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]))
      .toEqual(["Silvestri"]);
    // …and a SECOND load changes nothing (idempotent).
    const before = (await readStore(page)).map((s) => s.site);
    await page.reload();
    await expect.poll(() => readStore(page).then((r) => r.map((s) => s.site))).toEqual(before);
  });

  test("the project reads under its authoritative name even when the STALE plan is the newest", async ({ page }) => {
    /* The user-visible symptom. One row is rendered per GROUP, and its label came from whichever
     * plan in the group was most recently saved — so a project whose straggler was touched last
     * displayed, searched and exported under the OLD spelling. That is what made the owner's
     * project look like it had reverted / like there were two of it. Seeding the straggler NEWEST
     * is what makes this case fail on the pre-fix build (verified by mutation). */
    await seedProject(page, [
      { id: "p-a", groupId: "grp", site: "Silvestri", name: "Concept A", updatedAt: 1_700_000_000_000 },
      { id: "p-b", groupId: "grp", site: "Silvestri", name: "Concept B", updatedAt: 1_700_000_001_000 },
      { id: "p-c", groupId: "grp", site: "Sylvestri", name: "Concept D", updatedAt: 1_900_000_000_000 }, // newest, stale name
    ]);
    await boot(page);
    await openProjectCrumb(page);
    await expect(page.getByTestId("project-row-grp")).toHaveCount(1);
    await expect(page.getByTestId("project-row-grp")).toContainText("Silvestri");
    await expect(page.getByTestId("project-row-grp")).not.toContainText("Sylvestri");
  });

  test("an ambiguous legacy split is left ALONE rather than half-renamed", async ({ page }) => {
    await seedProject(page, [
      { id: "x1", groupId: "amb", site: "Alpha", name: "Concept A" },
      { id: "x2", groupId: "amb", site: "Beta", name: "Concept B" },
    ]);
    await boot(page);
    await page.waitForTimeout(1500);
    expect((await readStore(page)).map((s) => s.site).sort()).toEqual(["Alpha", "Beta"]);
  });
});

test.describe("NEW-4 / NEW-2 — renaming from the map viewer's project dropdown", () => {
  /* The owner's exact repro. On the map the dropdown lists projects, so the rename is the row's own
   * menu; in the planner the crumb names ONE project, so NEW-4's "Rename “…”" row appears there.
   * Both go through the same single write path — this drives the map one, which is where the
   * report came from and which was previously UNWIRED (falling through to a local-only write). */
  async function renameViaRowMenu(page, groupId, next) {
    await openProjectCrumb(page);
    await page.getByTestId(`project-row-${groupId}`).hover();
    await page.getByTestId(`project-kebab-${groupId}`).click();
    await page.getByTestId("project-rename").click();
    const input = page.getByRole("textbox", { name: /^Rename / });
    await expect(input).toBeVisible();
    await input.fill(next);
    await input.press("Enter");
  }

  test("renaming writes EVERY plan in the project, stamps them together, and survives a reload", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    await renameViaRowMenu(page, "grp", "Silvestri");

    // Every plan in the group carries the new name — not just the one that happened to be open.
    await expect.poll(() => readStore(page).then((r) => r.map((s) => s.site).sort()))
      .toEqual(["Silvestri", "Silvestri", "Silvestri"]);
    // …each with the SAME rename stamp, so the group has one unambiguous "when".
    const stamps = new Set((await readStore(page)).map((s) => s.siteRenamedAt));
    expect(stamps.size).toBe(1);
    expect([...stamps][0]).toBeGreaterThan(0);

    // The owner's actual complaint: "it didn't remember it."
    await page.reload();
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]))
      .toEqual(["Silvestri"]);
  });

  test("a plan that shows up AFTER the rename adopts the new name — it cannot re-publish the old one", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    await renameViaRowMenu(page, "grp", "Silvestri");
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))])).toEqual(["Silvestri"]);

    // Simulate the straggler landing from the cloud / another device, still carrying "Sylvestri" —
    // exactly what sms4zs8unbkg did seventeen minutes after the owner's rename.
    await page.evaluate((key) => {
      const map = JSON.parse(localStorage.getItem(key) || "{}");
      map["p-late"] = { schemaVersion: 12, id: "p-late", groupId: "grp", site: "Sylvestri", name: "Concept D", updatedAt: Date.now() + 60000, els: [], parcels: [] };
      localStorage.setItem(key, JSON.stringify(map));
    }, STORE);
    await page.reload();

    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]))
      .toEqual(["Silvestri"]); // the stale copy READ the name; it did not overwrite it
  });

  test("an empty name is refused — the project keeps the name it had", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    await renameViaRowMenu(page, "grp", "   ");
    await page.waitForTimeout(600);
    expect([...new Set((await readStore(page)).map((s) => s.site))]).toEqual(["Sylvestri"]);
  });
});

/* ⛔ REPLACES the old "NEW-4 — renaming from the crumb" describe, which asserted a control the owner
 * asked to REMOVE (2026-08-11: "I don't need a rename Clay & Porter right there… there already is the
 * option for the three dots, so I don't need a second option there"). It is rewritten rather than
 * deleted, because the CONCERN behind NEW-4 is still live and is now the thing under test.
 *
 * NEW-4's rename row existed because the per-row kebab was hover-revealed — "invisible, and dead on
 * touch". That was true, so removing the crumb row is only safe because the kebab stopped being
 * hover-gated. This suite therefore asserts BOTH halves: the duplicate is gone, AND the surviving
 * entry point is reachable with no hover at all and still writes every plan in the group. Removing
 * one of two entry points must never leave zero. */
test.describe("NEW-1 / NEW-2 — one rename entry point, reachable without a mouse", () => {
  test("the crumb-level 'Rename “…”' row and the duplicate 'All projects' row are BOTH gone", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    await openProjectCrumb(page);
    await page.getByTestId("project-row-grp").getByRole("button").first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });

    await openProjectCrumb(page);
    // The dropdown is a project LIST plus a New-project action — no second rename, no second
    // route to the dashboard (the Dashboard crumb sits immediately to the left of this control).
    await expect(page.getByTestId("project-rename-current")).toHaveCount(0);
    await expect(page.locator('button:has-text("All projects (")')).toHaveCount(0);
    await expect(page.locator('button:has-text("New project")')).toBeVisible();
  });

  test("⛔ the kebab is reachable with NO hover, and rename through it still writes every plan", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    await openProjectCrumb(page);

    /* The load-bearing assertion. Pre-fix the kebab rendered only while `hoverRow === p.id`, so on a
     * touch device there was no rename at all and a keyboard user had nothing in the DOM to tab to.
     * Click it WITHOUT hovering first — that is the case that used to be impossible. */
    const kebab = page.getByTestId("project-kebab-grp");
    await expect(kebab).toBeVisible();
    await kebab.click();

    await page.getByTestId("project-rename").click();
    const input = page.getByRole("textbox", { name: /^Rename / });
    await expect(input).toBeVisible();
    await input.fill("Silvestri");
    await input.press("Enter");

    // Still ONE write path over the whole group, and it still survives a reload.
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]), { timeout: 15_000 })
      .toEqual(["Silvestri"]);
    await page.reload();
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]), { timeout: 20_000 })
      .toEqual(["Silvestri"]);
  });
});

/* NEW-2 — the owner's live repro: rename a project inline (the kebab → Rename path, NOT the
 * multi-plan-single-group SILVESTRI fixture above — this needs several DISTINCT projects so one
 * can slide past another), press Enter. The name saves correctly and then the app OPENS A
 * DIFFERENT PROJECT — his case, Ta Chen, the row that was sitting at the top of the list.
 *
 * ROOT CAUSE, confirmed live (not just theorized) before this fix: `groupProjects` sorts
 * most-recently-edited first, a rename bumps `updatedAt`, and `ProjectBreadcrumb.jsx` re-sorted
 * on every `refresh()` — so the renamed row visibly jumped to #1 and every row above it slid
 * down ONE, immediately, while the dropdown was still open and the just-closed rename editor's
 * focus had nowhere correct to land (`document.activeElement` measured as `<body>`). Fix:
 * `applyFrozenOrder` (projectModel.js) holds the row order steady for as long as the dropdown
 * stays open once an edit starts, and commit/cancel re-anchor focus to the EDITED row's own
 * activate button (by id), never to wherever the resort would otherwise have left it.
 *
 * Every case below is exercised: Enter vs click-away vs Escape; the row being renamed at the
 * top of the list vs further down; the project you're renaming being the one you're currently
 * standing in vs a different one. */
test.describe("NEW-2 — renaming a project and pressing Enter must never navigate you anywhere else", () => {
  const THREE_PROJECTS = [
    { id: "p-tachen", groupId: "grp-tachen", site: "Ta Chen", name: "Concept A", updatedAt: 3_000 },
    { id: "p-third", groupId: "grp-third", site: "Third Project", name: "Concept A", updatedAt: 2_000 },
    { id: "p-aldine", groupId: "grp-aldine", site: "Aldine Bender 1", name: "Concept A", updatedAt: 1_000 },
  ];

  const rowOrder = (page) => page.locator('[data-testid^="project-row-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
  const focusedRow = (page) => page.evaluate(() =>
    document.activeElement?.closest?.('[data-testid^="project-row-"]')?.getAttribute("data-testid") || null);

  // Open the row's kebab → Rename and type the new name — stop short of committing, so the
  // caller can exercise whichever of Enter / click-away / Escape it's testing.
  async function startRowRename(page, groupId, next) {
    await page.getByTestId(`project-row-${groupId}`).hover();
    await page.getByTestId(`project-kebab-${groupId}`).click();
    await page.getByTestId("project-rename").click();
    const input = page.getByRole("textbox", { name: /^Rename / });
    await expect(input).toBeVisible();
    await input.fill(next);
    return input;
  }

  /* ⛔ `expect.poll` returns the INSTANT its predicate first matches — it does not keep watching
   * afterward. Checking row order with a bare poll right after Enter can pass on its very first
   * (immediate) read, before the async rename write — and the `refresh()` it triggers once it
   * settles — has had any chance to run, which would make the assertion pass "by being too
   * early" rather than by the order genuinely staying put. So every case below first waits for
   * the WRITE itself to land in storage (proof the async round trip, and therefore any `refresh()`
   * chained off it, has had its turn) before checking the row order with a plain, un-retried read. */
  async function waitForStoreName(page, groupId, name) {
    await expect.poll(() => readStore(page).then((r) => r.find((s) => s.groupId === groupId)?.site))
      .toBe(name);
    await page.waitForTimeout(150); // let the resulting re-render (if any) actually flush
  }

  test("⛔ THE REPORTED CASE: renaming a row below the top and pressing Enter never displaces or opens the row above it", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    // Ta Chen (freshest `updatedAt`) sits first, Aldine Bender 1 is NOT at the top — the exact
    // shape of the report.
    const before = await rowOrder(page);
    expect(before[0]).toBe("project-row-grp-tachen");
    expect(before).not.toEqual(["project-row-grp-aldine", "project-row-grp-tachen", "project-row-grp-third"]);

    const input = await startRowRename(page, "grp-aldine", "Aldine Bender 1 RENAMED");
    await input.press("Enter");
    // The name updates immediately — optimistic, no "re-read from the server" beat — checked
    // BEFORE waiting for the write round-trip below.
    await expect(page.getByTestId("project-row-grp-aldine")).toContainText("Aldine Bender 1 RENAMED");
    await waitForStoreName(page, "grp-aldine", "Aldine Bender 1 RENAMED");

    // The row order is FROZEN for as long as the dropdown stays open — Ta Chen never slides out
    // of #1, so there is no slot for a stray keystroke to fall through onto.
    expect(await rowOrder(page)).toEqual(before);
    // Focus is re-anchored to the RENAMED row's own button, by identity — never lost to <body>,
    // and never left on whatever slid into its old on-screen slot.
    expect(await focusedRow(page)).toBe("project-row-grp-aldine");
    // And the app never navigated: no project was open before the rename, so none is open after.
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText("Select a project");
    expect(await page.evaluate(() => location.hash)).toBe("#/site");
  });

  test("the same holds while a DIFFERENT project is the one currently open", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    await page.getByTestId("project-row-grp-third").getByRole("button").first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });
    const hashBefore = await page.evaluate(() => location.hash);

    await openProjectCrumb(page);
    const before = await rowOrder(page);
    const input = await startRowRename(page, "grp-aldine", "Aldine Bender 1 RENAMED");
    await input.press("Enter");
    await waitForStoreName(page, "grp-aldine", "Aldine Bender 1 RENAMED");

    expect(await rowOrder(page)).toEqual(before);
    // Still Third Project — never bounced into whichever row was on top.
    expect(await page.evaluate(() => location.hash)).toBe(hashBefore);
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText("Third Project");
  });

  test("renaming the TOP row itself behaves the same way — no crash, no stray navigation", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    const before = await rowOrder(page);

    const input = await startRowRename(page, "grp-tachen", "Ta Chen RENAMED");
    await input.press("Enter");
    await waitForStoreName(page, "grp-tachen", "Ta Chen RENAMED");

    expect(await rowOrder(page)).toEqual(before);
    await expect(page.getByTestId("project-row-grp-tachen")).toContainText("Ta Chen RENAMED");
    expect(await focusedRow(page)).toBe("project-row-grp-tachen");
    expect(await page.evaluate(() => location.hash)).toBe("#/site");
  });

  test("renaming the project you are CURRENTLY standing in never bounces you out of it", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    await page.getByTestId("project-row-grp-aldine").getByRole("button").first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });

    await openProjectCrumb(page);
    const input = await startRowRename(page, "grp-aldine", "Aldine Bender 1 RENAMED");
    await input.press("Enter");

    expect(await page.evaluate(() => location.hash)).toBe("#/project/grp-aldine/site");
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText("Aldine Bender 1 RENAMED");
  });

  test("click-away (blur) commits the same way Enter does — order frozen, no navigation", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    const before = await rowOrder(page);

    const input = await startRowRename(page, "grp-aldine", "Aldine Bender 1 RENAMED (blur)");
    // Click away onto a neutral control (the search field) — never onto another project's own
    // row, which would be a deliberate, correct navigation, not a click-away.
    await page.getByPlaceholder("Search projects").click();
    await waitForStoreName(page, "grp-aldine", "Aldine Bender 1 RENAMED (blur)");

    expect(await rowOrder(page)).toEqual(before);
    await expect(page.getByTestId("project-row-grp-aldine")).toContainText("Aldine Bender 1 RENAMED (blur)");
    expect(await page.evaluate(() => location.hash)).toBe("#/site");
  });

  test("Escape cancels without renaming, without reordering, and without navigating", async ({ page }) => {
    await seedProject(page, THREE_PROJECTS);
    await boot(page);
    await openProjectCrumb(page);
    const before = await rowOrder(page);

    const input = await startRowRename(page, "grp-aldine", "Aldine Bender 1 SHOULD NOT STICK");
    await input.press("Escape");

    await expect.poll(() => rowOrder(page)).toEqual(before);
    await expect(page.getByTestId("project-row-grp-aldine")).toContainText("Aldine Bender 1");
    await expect(page.getByTestId("project-row-grp-aldine")).not.toContainText("SHOULD NOT STICK");
    expect(await page.evaluate(() => location.hash)).toBe("#/site");
  });
});
