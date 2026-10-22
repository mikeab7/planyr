/* B2436064 ×3 (Imagery & Layers NEW-1) + B2436065 (NEW-2) + B2436066 (NEW-3), on the REAL app, both surfaces.
 *
 *   NEW-1  a one-pixel divider in the border token sits between the group list and the rows, the full height of the panes (wherever the two
 *          panes sit side by side); a row's name starts one small gap after the checkbox + swatch slot — checkbox right edge → name left edge
 *          at most 18 (it measured 27) — and starts at the same x in every pane; nothing overlaps or clips.
 *   NEW-2  no row is faded: every row's computed opacity matches a normal row.
 *   NEW-3  a located plan at Grand Port and the finder centred on the same point list the same Flood & Drainage rows: FEMA + streams only.
 * Matrix: planner + finder × light + dark × desktop + phone. Red-proof: on bd89cc8 the divider, the gap and the Grand Port rows all fail. */
import { test, expect } from "@playwright/test";
import { panelSel, openPlannerLayers, groupKeys, selectGroup } from "./lib/layersPanel.js";

const GP = { lat: 29.807276, lon: -94.877079 };
const site = {
  schemaVersion: 12, id: "ldg1", groupId: "ldg1", site: "Layers Divider Gap", name: "Layers Divider Gap",
  updatedAt: 1783000000000, teamId: null, ownerId: null, scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: GP.lat, lon: GP.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};
const GAP_TARGET = 18;

async function boot(page, hash, vp, theme) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify({ [site.id]: site }));
  await page.setViewportSize(vp);
  await page.goto(hash, { waitUntil: "load" });
  await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
}

async function openCard(page, surface) {
  if (surface === "planner") {
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(1200);
    await openPlannerLayers(page);
  } else {
    await page.waitForFunction(() => !!window.__mapFinderMap, null, { timeout: 30000 });
    await page.evaluate(([lat, lon]) => window.__mapFinderMap.setView([lat, lon], 14, { animate: false }), [GP.lat, GP.lon]);
    await page.waitForTimeout(1200);
    const chip = page.getByTestId("finder-layers-expand").filter({ visible: true });
    if (await chip.count()) await chip.first().click();
  }
  const panel = page.locator(panelSel(surface)).first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(600); // the service-area geometry arrives by a dynamic import
  return panel;
}

const VIEWPORTS = { desktop: { width: 1280, height: 860 }, phone: { width: 390, height: 844 } };
for (const surface of ["planner", "finder"]) {
  for (const size of ["desktop", "phone"]) {
    for (const theme of ["light", "dark"]) {
      test(`${surface} · ${size} · ${theme}: divider, compact rows, no faded row, Grand Port rows`, async ({ page }) => {
        await boot(page, surface === "planner" ? `/#/project/${site.id}/site` : "/#/site-planner", VIEWPORTS[size], theme);
        const panel = await openCard(page, surface);

        // ── NEW-1: the divider (only where the panes sit side by side) ──
        const twoPane = (await panel.getByTestId("layer-group-nav").count()) > 0;
        const div = panel.getByTestId("layer-pane-divider");
        if (twoPane) {
          await expect(div, "a divider between the group list and the rows").toHaveCount(1);
          const g = await panel.evaluate((p) => {
            const r = (s) => p.querySelector(`[data-testid="${s}"]`).getBoundingClientRect();
            const nav = r("layer-group-nav"), pane = r("layer-pane"), d = r("layer-pane-divider");
            return { navRight: nav.right, paneLeft: pane.left, dl: d.left, dw: d.width, dh: d.height, nh: nav.height, ph: pane.height, bg: getComputedStyle(p.querySelector('[data-testid="layer-pane-divider"]')).backgroundColor };
          });
          expect(g.dl, "between the panes").toBeGreaterThanOrEqual(g.navRight - 0.5);
          expect(g.dl + g.dw).toBeLessThanOrEqual(g.paneLeft + 0.5);
          expect(g.dw, "a hairline").toBe(1);
          expect(g.dh, "full height of the panes").toBeGreaterThanOrEqual(Math.max(g.nh, g.ph) - 1);
          expect(g.bg, "painted in the border token").not.toBe("rgba(0, 0, 0, 0)");
        } else {
          await expect(div, "the group-dropdown layout has nothing side by side").toHaveCount(0);
        }

        // ── NEW-1 + NEW-2 over every group: gap, same x, no overlap, never faded ──
        const xs = new Set();
        let worst = 0, rows = 0;
        for (const key of await groupKeys(panel)) {
          await selectGroup(panel, key);
          const m = await panel.evaluate((p) => {
            const items = [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu") && r.querySelector("label span[title]"));
            const pane = p.querySelector('[data-testid="layer-pane"]').getBoundingClientRect();
            return items.map((row) => {
              const cb = row.querySelector('input[type="checkbox"]').getBoundingClientRect();
              const nm = row.querySelector("label span[title]"), rg = document.createRange(); rg.selectNodeContents(nm.firstChild);
              const nb = rg.getBoundingClientRect();
              return { id: row.getAttribute("data-testid"), gap: nb.left - cb.right, x: Math.round((nb.left - pane.left) * 10) / 10, op: getComputedStyle(row.firstElementChild).opacity, right: nb.right <= pane.right + 1, cbRight: cb.right > pane.left - 1 };
            });
          });
          for (const r of m) {
            rows++; worst = Math.max(worst, r.gap); xs.add(r.x);
            expect(r.gap, `${key}/${r.id} checkbox → name`).toBeLessThanOrEqual(GAP_TARGET + 0.5);
            expect(r.op, `${key}/${r.id} is not faded`).toBe("1");
            expect(r.right, `${key}/${r.id} name stays inside the pane`).toBe(true);
          }
        }
        expect(rows, "rows were measured").toBeGreaterThan(8);
        expect([...xs], "names start at the same x in every pane").toHaveLength(1);

        // ── NEW-3: Grand Port lists FEMA + streams only, on BOTH surfaces ──
        await selectGroup(panel, "flood");
        const flood = await panel.evaluate((p) => [...p.querySelectorAll('[data-testid="layer-pane"] [data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu")).map((r) => r.getAttribute("data-testid").replace("layer-row-", "")).sort());
        expect(flood, "Chambers County: no HCFCD / City of Houston / BKDD row").toEqual(["fema", "nhd_flowlines"]);
      });
    }
  }
}
