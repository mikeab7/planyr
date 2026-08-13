/* NEW-1 / NEW-2 — a zoom-gated layer that is ON but not drawing must not look like a broken one.
 *
 * The owner's report (Tsakiris, Waller County, 2026-08-09): he checked "Contour lines (1 ft)" while
 * zoomed out below the z16 terrain gate. The checkbox rendered fully ON, the map drew nothing, and
 * he sat for a full minute believing the feature had failed. The panel DID already carry
 * "Zoom in to ≥ 16 to load (1-ft detail needs close zoom)" — and that is the defect, not the fix:
 * static helper text that renders identically whether the layer is drawing or not.
 *
 * ⛔ WHY AN E2E SPEC AND NOT ONLY A UNIT TEST. test/layerZoomGate.test.js pins the MODEL, and it
 * cannot see the thing the owner actually experienced: that the row's rendered state is
 * indistinguishable from a working one. The observable is the real panel's DOM — which state the
 * row reports, whether the status dot is filled or hollow, and whether clicking the line actually
 * moves the map. All three are properties of the rendered app, not of a pure function.
 *
 * Hermetic: logged out, and every assertion here is client-side (the gate is answered from the
 * live zoom, not from a service), so nothing depends on external GIS.
 *
 * ⛔ ONE STATE IS DELIBERATELY NOT ASSERTED HERE, AND IS NOT SILENTLY DROPPED. The fourth state —
 * checked, past the gate, but the source's data does not reach this area — needs the coverage
 * engine's published-extent probes, and every GIS host is egress-blocked from Chromium in this
 * sandbox, so it resolves to "unknown" rather than "out". It is pinned in the unit suite and
 * carries a live check in VERIFICATION.md. A harness that could not have seen an effect must never
 * report its absence as a pass.
 */
import { test, expect } from "@playwright/test";

/* A tract whose whole-site fit lands BELOW the z16 terrain gate — the owner's situation restated
 * as geometry ("he was zoomed out"). Waller County, as on his real plan. */
const W = 12000, H = 9000;
const site = {
  schemaVersion: 12, id: "zg1", groupId: "zg1", site: "Zoom Gate", name: "Concept A",
  updatedAt: 1786000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: 29.9038, lon: -95.9769 }, county: "waller", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }], active: true, z: 0 }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [], parcelDrawings: [],
  underlay: null, settings: {},
  // Contours ON from the moment the plan opens — the row the owner reported.
  layerOverrides: { contours: true },
};

const PANEL = '[data-testid="layer-panel"][data-surface="planner"]';
const CONTOURS = `${PANEL} [data-testid="layer-row-contours"]`;

async function openPlanner(page) {
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
  await page.addInitScript((s) => {
    try {
      localStorage.setItem("planarfit:sites:v1", s);
      localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "all", radius: 2.5 }));
    } catch (_) {}
  }, JSON.stringify({ [site.id]: site }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Zoom Gate", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
  await page.waitForTimeout(1500);
  // BOTH hosts stay mounted (the finder's copy is hidden), so click the VISIBLE control and assert
  // against the planner SURFACE, never against page text.
  await page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first().click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(400);
}

test.describe("NEW-1 — the four states a Layers row can be in", () => {
  test("checked BELOW the gate reads as DORMANT, with a live line and a hollow dot", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openPlanner(page);

    /* ⛔ THE BEHAVIOURAL RED FIRST, on a selector that exists on BOTH builds. Everything below
       keys on `data-layer-state`, which pre-fix does not exist — so those assertions go red for the
       right reason but prove only that a marker is new. THIS one fails on the pre-fix build because
       the static sentence is really there, under a checkbox that really says ON, which is the
       owner's report itself. */
    await expect(page.locator(PANEL)).not.toContainText("Zoom in to ≥");

    const row = page.locator(CONTOURS);
    await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom");

    // The checkbox still says ON — that is the honest state, and it is the reason the row itself
    // has to carry the difference.
    // ⛔ `.first()` is load-bearing: an ON row renders a SECOND checkbox — the "Show above plan"
    // lift — so a bare locator is a strict-mode violation, not a missing control.
    await expect(row.locator('input[type="checkbox"]').first()).toBeChecked();

    // The dot is HOLLOW. Every live state is a filled dot, so an outline reads as "nothing is
    // coming out of this one" with no legend anywhere.
    await expect(row.locator("[data-layer-dot]")).toHaveAttribute("data-layer-dot", "dormant");

    // The line is LIVE and specific — computed from the actual current zoom, not a static rule.
    const fix = row.getByTestId("layer-zoom-fix");
    await expect(fix).toBeVisible();
    await expect(fix).toHaveText(/^Not showing at this zoom — zoom in \d+ levels?$/);

    // …and the static sentence it replaced is GONE from the row (PANEL-BREVITY: replace, never
    // accumulate). The full rule still lives behind the row's ⓘ, which is exempt.
    await expect(row).not.toContainText("Zoom in to ≥");
  });

  test("THE LINE IS THE FIX — clicking it zooms the map and the row starts drawing", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openPlanner(page);

    const row = page.locator(CONTOURS);
    await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom");
    const before = await page.getByTestId("planner-canvas").getAttribute("data-view-ppf");

    await row.getByTestId("layer-zoom-fix").click();
    await page.waitForTimeout(900);

    // The map really moved — the affordance FIXES the condition rather than describing it.
    const after = await page.getByTestId("planner-canvas").getAttribute("data-view-ppf");
    expect(+after).toBeGreaterThan(+before);

    // …and the row now reports itself as drawing, with the live line gone.
    await expect(row).toHaveAttribute("data-layer-state", "drawing");
    await expect(row.getByTestId("layer-zoom-fix")).toHaveCount(0);
    await expect(row.locator('[data-layer-dot="dormant"]')).toHaveCount(0);
  });

  test("unchecked reads as OFF — no dot, no line, and distinct from dormant", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await openPlanner(page);

    const row = page.locator(CONTOURS);
    await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom");
    await row.locator('input[type="checkbox"]').first().uncheck();  // .first() — see the note above
    await page.waitForTimeout(400);

    await expect(row).toHaveAttribute("data-layer-state", "off");
    await expect(row.getByTestId("layer-zoom-fix")).toHaveCount(0);
    await expect(row.locator("[data-layer-dot]")).toHaveCount(0);
  });

  test("GENERALIZED — a different layer KIND with a different gate gets the same treatment", async ({ page }) => {
    /* The whole point of (d) in the brief: this is not a contour patch. `jur_road_authority` is an
     * `esriFeature` layer whose gate (14) comes from its registry row rather than from a pipeline
     * constant, and it reaches the panel through a different group and a different code path. Below
     * its gate it must read dormant exactly as the contour row does — and it is the WORSE case
     * before this work, because Leaflet suppresses such a layer silently: the row showed a
     * confident green "loaded" dot over an empty map, with no sentence to decode at all. */
    await page.setViewportSize({ width: 1280, height: 860 });
    await openPlanner(page);

    const road = page.locator(`${PANEL} [data-testid="layer-row-jur_road_authority"]`);
    await expect(road).toBeVisible();
    await expect(road).toHaveAttribute("data-layer-state", "off");
    await road.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(600);
    // The plan opens above 14, so it is genuinely drawing here.
    await expect(road).toHaveAttribute("data-layer-state", "drawing");

    /* Zoom out past its gate. The open Layers card sits over the zoom controls at this viewport,
       so collapse it first — clicking through an overlay is not a thing a user can do either. */
    const layersToggle = page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first();
    await layersToggle.click();
    for (let i = 0; i < 6; i++) {
      await page.getByRole("button", { name: "Zoom out" }).click();
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(500);
    await layersToggle.click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(400);

    await expect(road).toHaveAttribute("data-layer-state", "dormant-zoom");
    await expect(road.locator("[data-layer-dot]")).toHaveAttribute("data-layer-dot", "dormant");
    await expect(road.getByTestId("layer-zoom-fix")).toHaveText(/^Not showing at this zoom — zoom in \d+ levels?$/);
  });
});

test.describe("NEW-2 — the zoom gate resolves BEFORE first paint", () => {
  test("no layer is asked its gate at a zoom the plan never opens at", async ({ page }) => {
    /* The owner's second report: contours painted immediately on open and vanished about two
     * seconds later. Diagnosed on the real app (ui-audit/diagnose-layer-gate-flash.mjs): the
     * backdrop map claimed ~17.25 between its creation and the plan's whole-site framing, so a
     * layer admitted in that window answered its gate against a zoom the plan was never going to
     * be at, fetched, painted — and was then correctly cleared. A withdrawn paint reads as a crash.
     *
     * The hermetic observable is the REQUEST: a DEM grid pull is issued if and only if the terrain
     * layer believed it was past the gate. A blocked request is still an OBSERVED request, so this
     * holds in this sandbox exactly as it would with 3DEP reachable.
     *
     * ⛔ THE RELOAD IS NOT INCIDENTAL — it is what makes this reproduce. Opening the plan cold from
     * the site list happens to mount the backdrop map AFTER the framing has already landed, so the
     * gate is answered correctly by accident and a spec written that way passes on the broken build.
     * Re-entering the app on a plan it already remembers — which is how the owner arrives at a site
     * he has been working on — mounts the map first and the framing second, which is the window.
     * Measured on the pre-fix build: four grid pulls at map zoom 17.25 against a settled 15.08. */
    await page.setViewportSize({ width: 1280, height: 860 });
    await openPlanner(page);

    const demPulls = [];
    page.on("request", (r) => {
      if (/elevation\.nationalmap\.gov/.test(r.url()) && /exportImage/i.test(r.url())) demPulls.push(r.url());
    });

    await page.reload({ waitUntil: "load" });
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 25000 });
    await page.waitForTimeout(4000);

    expect(demPulls, `terrain grid pulls issued below the gate:\n${demPulls.join("\n")}`).toHaveLength(0);
  });
});

test.describe("NEW-1 — the map finder gets the same treatment (one mechanism, both surfaces)", () => {
  test("a layer gated above the finder's zoom reads dormant, and the line zooms the map", async ({ page }) => {
    /* The finder mounts the SAME panel with its own map, so a fix that only reached the planner
     * would leave half the product behind. It also reaches a case the planner cannot: the planner's
     * zoom-out is floored around 13.3, so a gate BELOW that can never be dormant there — here the
     * map opens on the continental US, well under every gate in the registry. */
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (route) => route.abort());
    await page.addInitScript(() => {
      try { localStorage.setItem("planarfit:relevance:v1", JSON.stringify({ mode: "all", radius: 2.5 })); } catch (_) {}
    });
    await page.goto("/#/site-planner", { waitUntil: "load" });
    await page.waitForTimeout(2500);

    const finder = '[data-testid="layer-panel"][data-surface="finder"]';
    // The finder's Layers card may start collapsed; open whichever visible control reveals it.
    const toggle = page.getByRole("button", { name: /^\s*❖?\s*Layers/ }).filter({ visible: true }).first();
    if (await toggle.count()) await toggle.click().catch(() => {});
    await expect(page.locator(finder)).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(500);

    const row = page.locator(`${finder} [data-testid="layer-row-contours"]`);
    await expect(row).toBeVisible();
    await row.locator('input[type="checkbox"]').first().check();
    await page.waitForTimeout(500);

    // With no site opened the finder is on the continental view — far below the z16 terrain gate.
    await expect(row).toHaveAttribute("data-layer-state", "dormant-zoom");
    await expect(row.locator("[data-layer-dot]")).toHaveAttribute("data-layer-dot", "dormant");

    const fix = row.getByTestId("layer-zoom-fix");
    await expect(fix).toHaveText(/^Not showing at this zoom — zoom in \d+ levels?$/);
    await fix.click();
    await page.waitForTimeout(1200);

    // The finder's own Leaflet map really moved, and the row is drawing.
    await expect(row).toHaveAttribute("data-layer-state", "drawing");
    await expect(row.getByTestId("layer-zoom-fix")).toHaveCount(0);
  });
});
