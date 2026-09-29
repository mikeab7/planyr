/* NAMES HAVE ONE SOURCE OF TRUTH — the rename × display matrix.
 *
 * For each entity (project, plan) and EACH rename entry point, rename, then assert EVERY display
 * shows the new name with NO reload — including with the plan mounted-but-hidden while the rename
 * is made from the Map view — and again after a reload. The exhibit composer and the PDF download
 * filename are displays like any other. Adjacent cases: empty rejected loudly, filename-hostile
 * characters sanitised in the FILE only, Ctrl+Z leaves every display agreeing with storage.
 * Logged out, throwaway seeded data only (never a real plan).
 */
import { test, expect } from "@playwright/test";

const GID = "g-namesmatrix";
const OLD = "Matrix Old Project";
const PLAN_OLD = "Concept A";

const seed = (page) => page.addInitScript(([gid, name, plan]) => {
  if (localStorage.getItem("__seeded")) return;
  localStorage.setItem("__seeded", "1");
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({
    p1: { id: "p1", groupId: gid, site: name, name: plan, origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {} },
  }));
}, [GID, OLD, PLAN_OLD]);

const stored = (page) => page.evaluate((gid) => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const r = Object.values(m).find((x) => x.groupId === gid);
  return r ? { site: r.site, name: r.name } : null;
}, GID);

async function openPlan(page) {
  await page.goto(`/#/project/${GID}/site`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
}
const goToMap = async (page) => {
  await page.locator('[data-testid="dashboard-crumb"]:visible').click();
  await expect(page.locator('[data-testid="map-toolbar-draw"]:visible')).toBeVisible({ timeout: 10_000 });
};
const backToPlan = async (page) => {
  await page.evaluate((gid) => { window.location.hash = `#/project/${gid}/site`; }, GID);
  await expect(page.locator('[data-testid="planner-canvas"]:visible')).toBeVisible({ timeout: 15_000 });
};
async function renameViaRowMenu(page, next) {
  await page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first().click();
  await page.getByTestId(`project-row-${GID}`).hover();
  await page.getByTestId(`project-kebab-${GID}`).click();
  await page.getByTestId("project-rename").click();
  const input = page.getByRole("textbox", { name: /^Rename / });
  await input.fill(next);
  await input.press("Enter");
}
async function renamePlan(page, next) {
  await page.locator('[data-testid="plan-crumb"]:visible').click();
  const input = page.getByTestId("plan-name-input");
  await input.fill(next);
  await input.press("Enter");
  await page.keyboard.press("Escape");
}
async function openCompose(page) {
  await page.locator('button:has-text("File")').first().click();
  await page.locator('button:has-text("Download PDF / pick frame")').click();
  await expect(page.locator('[data-testid="print-frame"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('button:has-text("Continue")').click();
  await expect(page.locator('[data-testid="print-compose"]')).toBeVisible({ timeout: 15_000 });
}
async function pdfFileName(page) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 45_000 }),
    page.locator('[data-testid="print-compose"] button:has-text("Download PDF")').click(),
  ]);
  return dl.suggestedFilename();
}
// EVERY display of the project name / plan name, on the plan surface.
async function assertDisplays(page, { project, plan, fileProject }) {
  await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText(project);
  await expect(page.locator('[data-testid="plan-crumb"]:visible')).toContainText(plan);
  await openCompose(page);
  const compose = page.locator('[data-testid="print-compose"]');
  await expect(compose).toContainText(project);
  await expect(compose).toContainText(plan);
  const fn = await pdfFileName(page);
  expect(fn).toContain(fileProject ?? project);
  expect(fn).toContain(plan);
}

const NEW = "Matrix Renamed Project";
async function renameViaMapRail(page, next) {
  const row = page.locator('[title^="Open site"]:visible', { hasText: OLD }).first();
  await row.click({ button: "right" });
  await page.getByText(/^Rename…?$/).first().click();
  const input = page.locator('input[value="' + OLD + '"]:visible').first();
  await input.fill(next);
  await input.press("Enter");
}
const entries = {
  "map rail row: right-click → Rename (plan mounted, hidden)": async (page) => {
    await openPlan(page); await goToMap(page); await renameViaMapRail(page, NEW); await backToPlan(page);
  },
  "plan-mode crumb row menu": async (page) => { await openPlan(page); await renameViaRowMenu(page, NEW); },
  "map-mode crumb row menu (plan mounted, hidden)": async (page) => {
    await openPlan(page); await goToMap(page); await renameViaRowMenu(page, NEW); await backToPlan(page);
  },
};

test.describe("project name — every entry point × every display", () => {
  for (const [label, run] of Object.entries(entries)) {
    test(`${label}`, async ({ page }) => {
      await seed(page);
      await run(page);
      await expect.poll(() => stored(page).then((s) => s && s.site)).toBe(NEW);
      await assertDisplays(page, { project: NEW, plan: PLAN_OLD });
      await page.reload();
      await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
      await assertDisplays(page, { project: NEW, plan: PLAN_OLD });
    });
  }
});

test.describe("plan name — entry point × every display", () => {
  test("plan-name field", async ({ page }) => {
    await seed(page);
    await openPlan(page);
    await renamePlan(page, "Scheme Z");
    await expect.poll(() => stored(page).then((s) => s && s.name)).toBe("Scheme Z");
    await assertDisplays(page, { project: OLD, plan: "Scheme Z" });
    await page.reload();
    await expect(page.locator('[data-testid="planner-canvas"]')).toBeVisible({ timeout: 30_000 });
    await assertDisplays(page, { project: OLD, plan: "Scheme Z" });
  });
});

test.describe("adjacent cases", () => {
  test("empty project name is rejected with a visible message; the old name stays", async ({ page }) => {
    await seed(page);
    await openPlan(page);
    await renameViaRowMenu(page, "   ");
    await expect(page.getByTestId("name-notice")).toBeVisible({ timeout: 5000 });
    expect((await stored(page)).site).toBe(OLD);
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText(OLD);
  });

  test("empty plan name is rejected with a visible message; the old name stays", async ({ page }) => {
    await seed(page);
    await openPlan(page);
    await renamePlan(page, "");
    await expect(page.getByTestId("name-notice")).toBeVisible({ timeout: 5000 });
    expect((await stored(page)).name).toBe(PLAN_OLD);
    await expect(page.locator('[data-testid="plan-crumb"]:visible')).toContainText(PLAN_OLD);
  });

  test("filename-hostile characters: file is sanitised, the displayed name is untouched", async ({ page }) => {
    await seed(page);
    await openPlan(page);
    await renameViaRowMenu(page, "A/B: C*D");
    await expect.poll(() => stored(page).then((s) => s && s.site)).toBe("A/B: C*D");
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText("A/B: C*D");
    await openCompose(page);
    await expect(page.locator('[data-testid="print-compose"]')).toContainText("A/B: C*D");
    const fn = await pdfFileName(page);
    expect(fn).not.toMatch(/[\\/:*?"<>|]/);
    expect(fn).toContain("A B C D");
  });

  test("Ctrl+Z after a rename leaves every display agreeing with storage", async ({ page }) => {
    await seed(page);
    await openPlan(page);
    await renameViaRowMenu(page, NEW);
    await expect.poll(() => stored(page).then((s) => s && s.site)).toBe(NEW);
    await page.locator('[data-testid="planner-canvas"]').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(600);
    const s = (await stored(page)).site;
    await expect(page.locator('[data-mode-active="true"]').getByTestId("project-crumb").first()).toContainText(s);
    await openCompose(page);
    await expect(page.locator('[data-testid="print-compose"]')).toContainText(s);
  });
});
