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

test.describe("NEW-4 — renaming the project you are looking at, from the crumb", () => {
  /* In the PLANNER the crumb names one project, so the rename belongs on the crumb itself rather
   * than behind a hover-revealed kebab on a list row (invisible, and dead on touch). It reuses the
   * same inline editor and the same single write path as the row menu — one implementation. */
  test("the dropdown carries a plain 'Rename' row for the open project, and it sticks", async ({ page }) => {
    await seedProject(page, SILVESTRI);
    await boot(page);
    // Open the project from the switcher — that lands us in the planner, where a current project exists.
    await openProjectCrumb(page);
    await page.getByTestId("project-row-grp").getByRole("button").first().click();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });

    await openProjectCrumb(page);
    const renameRow = page.getByTestId("project-rename-current");
    await expect(renameRow).toBeVisible({ timeout: 10_000 });
    await renameRow.click();
    const input = page.getByTestId("project-rename-current-input");
    await input.fill("Silvestri");
    await input.press("Enter");

    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]), { timeout: 15_000 })
      .toEqual(["Silvestri"]);
    await page.reload();
    await expect.poll(() => readStore(page).then((r) => [...new Set(r.map((s) => s.site))]), { timeout: 20_000 })
      .toEqual(["Silvestri"]);
  });
});
