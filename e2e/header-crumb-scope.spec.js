/* NEW-1 / NEW-2 (2026-10-29) — the header breadcrumb: the plan crumb is Site-only, and the crumb
 * spacing does not depend on how long a name is.
 *
 * NEW-1 (owner decision): only the Site tab is plan-scoped. Spreadsheet / Review / Library / Notes
 *   read "Dashboard / <Project> ▾" — no plan crumb and no dangling "/". The selected plan is only
 *   HIDDEN, never forgotten: Spreadsheet → Site shows the same plan again.
 * NEW-2: a short name used to be padded out to a 92 px floor, so its "/" sat farther away than a
 *   normal name's. The gap between every crumb's text edge and its neighbouring "/" must be the
 *   same for every project-name × plan-name length.
 *
 * Runs logged out against a seeded on-device store (throwaway ids, nothing real touched).
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const STORE = "planarfit:sites:v1";
const LONG = "Northwest Distribution Park Phase Three Expansion Parcel";
const NAMES = { short1: "A", short2: "GC", mid: "Academy", long: LONG };

async function seed(page, rows) {
  await page.addInitScript(([key, list]) => {
    if (localStorage.getItem(key)) return;
    const map = {};
    for (const p of list) map[p.id] = { schemaVersion: 12, updatedAt: Date.now(), els: [], parcels: [], measures: [], callouts: [], markups: [], settings: {}, ...p };
    localStorage.setItem(key, JSON.stringify(map));
  }, [STORE, rows]);
}

const visible = (page, id) => page.getByTestId(id).filter({ visible: true });

test.describe("NEW-1 — the plan crumb shows on the Site tab only", () => {
  const ROWS = [
    { id: "hc-a", groupId: "hc-grp", site: "Academy", name: "Concept A" },
    { id: "hc-b", groupId: "hc-grp", site: "Academy", name: "Concept B", updatedAt: Date.now() + 1000 },
  ];

  test("project-level tabs read Dashboard / Project with no plan crumb and no trailing slash; Site restores the same plan", async ({ page }) => {
    await seed(page, ROWS);
    await page.goto("/#/project/hc-grp/site");
    await expect(visible(page, "plan-crumb")).toBeVisible();
    const planBefore = (await visible(page, "plan-crumb").innerText()).replace("▾", "").trim();
    expect(planBefore).toBeTruthy();
    await expect(visible(page, "crumb-sep")).toHaveCount(2); // Dashboard / Project / Plan

    for (const mod of ["model", "doc-review", "library", "notes"]) {
      await openModule(page, mod);
      await expect(visible(page, "project-crumb"), `${mod}: project crumb`).toBeVisible();
      await expect(visible(page, "plan-crumb"), `${mod}: no plan crumb`).toHaveCount(0);
      await expect(visible(page, "model-concept-crumb"), `${mod}: no concept crumb`).toHaveCount(0);
      await expect(visible(page, "crumb-sep"), `${mod}: exactly one separator (no dangling "/")`).toHaveCount(1);
    }

    await openModule(page, "site-planner");
    await expect(visible(page, "plan-crumb")).toBeVisible();
    expect((await visible(page, "plan-crumb").innerText()).replace("▾", "").trim()).toBe(planBefore);
    await expect(visible(page, "crumb-sep")).toHaveCount(2);
  });

  test("deep links: #/project/<id>/spreadsheet has no plan crumb and no errors; #/project/<id>/site restores the plan", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await seed(page, ROWS);
    await page.goto("/#/project/hc-grp/spreadsheet");
    // NEW-2: the Spreadsheet is the Univer grid (a lazy canvas) for every account — assert the crumbs AND the page-error list with the grid mounted
    await expect(page.locator('canvas[id^="univer-sheet-main-canvas"]')).toBeVisible({ timeout: 60_000 });
    await expect(visible(page, "project-crumb")).toBeVisible();
    await expect(visible(page, "plan-crumb")).toHaveCount(0);
    await expect(visible(page, "model-concept-crumb")).toHaveCount(0);
    await expect(visible(page, "crumb-sep")).toHaveCount(1);
    await page.goto("/#/project/hc-grp/site");
    await expect(visible(page, "plan-crumb")).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe("NEW-2 — crumb spacing is the same for short, mid and long names", () => {
  const combos = [];
  for (const [pk, pn] of Object.entries(NAMES)) for (const [qk, qn] of Object.entries(NAMES)) combos.push({ key: `${pk}-${qk}`, project: pn, plan: qn });
  const ROWS = combos.map((c) => ({ id: `sp-${c.key}`, groupId: `sp-${c.key}`, site: c.project, name: c.plan }));

  const measure = (page) => page.evaluate(() => {
    const vis = (id) => [...document.querySelectorAll(`[data-testid="${id}"]`)].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden");
    const r = (e) => e.getBoundingClientRect();
    const dash = vis("dashboard-crumb")[0], seps = vis("crumb-sep"), name = vis("project-crumb-name")[0], caret = vis("project-caret")[0];
    const plan = vis("plan-crumb")[0], planCaret = vis("plan-caret")[0], planName = plan && plan.querySelector("span");
    const range = document.createRange(); range.selectNodeContents(dash);
    const textNodes = [...dash.childNodes].filter((n) => n.nodeType === 3);
    range.selectNodeContents(textNodes[textNodes.length - 1]);
    const dashTextRight = range.getBoundingClientRect().right;
    return {
      dashToSep1: r(seps[0]).left - dashTextRight,
      sep1ToProject: r(name).left - r(seps[0]).right,
      projectCaretToSep2: r(seps[1]).left - r(caret).right,
      sep2ToPlan: r(planName).left - r(seps[1]).right,
      projectDead: r(vis("project-crumb")[0]).right - r(caret).right,
      planDead: r(plan).right - r(planCaret).right,
      planCaretRight: r(planCaret).right, vw: window.innerWidth,
      projectTitle: name.getAttribute("title"), planTitle: planName.getAttribute("title"),
    };
  });

  for (const width of [1280, 900]) {
    test(`gaps around every "/" are equal across all ${combos.length} name combinations at ${width} px wide`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await seed(page, ROWS);
      const got = {};
      for (const c of combos) {
        await page.goto(`/#/project/sp-${c.key}/site`);
        await page.reload();
        await expect(visible(page, "plan-crumb")).toBeVisible();
        await expect(visible(page, "project-crumb-name")).toHaveText(c.project);
        got[c.key] = await measure(page);
        // Long names truncate and still show the full name on hover; nothing pushes past the viewport.
        expect(got[c.key].projectTitle).toBe(c.project);
        expect(got[c.key].planTitle).toBe(c.plan);
        expect(got[c.key].planCaretRight).toBeLessThanOrEqual(got[c.key].vw);
      }
      for (const metric of ["dashToSep1", "sep1ToProject", "projectCaretToSep2", "sep2ToPlan"]) {
        const vals = Object.values(got).map((g) => g[metric]);
        expect(Math.max(...vals) - Math.min(...vals), `${metric} spread ${JSON.stringify(vals.map((v) => +v.toFixed(1)))}`).toBeLessThanOrEqual(1);
      }
      // No dead space inside either crumb: the caret sits one padding (12 px) from the button's edge.
      for (const [k, g] of Object.entries(got)) {
        expect(Math.abs(g.projectDead - 12), `${k} project crumb dead space`).toBeLessThanOrEqual(1);
        expect(Math.abs(g.planDead - 12), `${k} plan crumb dead space`).toBeLessThanOrEqual(1);
      }
    });
  }
});
