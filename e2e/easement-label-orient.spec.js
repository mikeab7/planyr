/* NEW-1 (easement labels inline + oriented with the strip) — MEASURED IN A REAL BROWSER.
 * Owner repro: a long narrow vertical "100' Storm/Drainage Esmt" strip wore a HORIZONTAL label that
 * spilled across the neighbouring parcel and building. This spec seeds a vertical, a 30° and a 120°
 * strip (the 120° one must flip upright), selects each, and asserts from the live DOM that
 *   · the label's group carries the upright angle the pure rule computes,
 *   · EVERY corner of the label's painted text box lies inside its own strip polygon
 *     (isPointInFill in the polygon's own space — correct for rotated shapes),
 *   · the selected-state area line is inside it too.
 * Logged out, seeded, no network. FOREGROUND-OR-VOID: assertMeasurable before any geometry read. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";
import { assertMeasurable, pacedWait } from "../ui-audit/lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-easement-label-orient";

function ease(id, a, b, width, extra = {}) {
  const m = { id, kind: "easement", mode: "centerline", width, easeType: "storm", status: "existing", exclusive: false,
    restrictsBuildings: true, restrictsPaving: false, centerline: [a, b], z: 100, ...extra };
  m.pts = deriveEasementRing(m);
  return m;
}
const rad = (d) => (d * Math.PI) / 180;
const VERT = ease("ev", { x: 600, y: 300 }, { x: 600, y: 1900 }, 100);
const DIAG30 = ease("e30", { x: 1500, y: 300 }, { x: 1500 + 1500 * Math.cos(rad(30)), y: 300 + 1500 * Math.sin(rad(30)) }, 90);
const DIAG120 = ease("e120", { x: 3200, y: 300 }, { x: 3200 + 1500 * Math.cos(rad(120)), y: 300 + 1500 * Math.sin(rad(120)) }, 90);
const PARCEL = { id: "p-o", active: true, pts: [{ x: 0, y: 0 }, { x: 4200, y: 0 }, { x: 4200, y: 2400 }, { x: 0, y: 2400 }] };

async function boot(page) {
  await armPlannerHooks(page);
  const site = { id: SITE_ID, groupId: SITE_ID, site: "Orient", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
    parcels: [PARCEL], els: [], measures: [], callouts: [], markups: [VERT, DIAG30, DIAG120],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ [id]: [] }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  if (!(await canvas(page).count())) await openModule(page, "site-planner");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.locator(`[data-markup="${VERT.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await pacedWait(page, 1200);
  await assertMeasurable(page, "easement-label-orient");
}

/* For every rendered copy of the markup: the label group's angle and whether each of the four corners
 * of every <text> in it sits inside the strip polygon. */
function read(page, id) {
  return page.evaluate((mid) => [...document.querySelectorAll(`[data-markup="${mid}"]`)].map((g) => {
    const poly = g.querySelector("polygon");
    const lab = g.querySelector("[data-easement-label]");
    if (!poly || !lab) return { present: false };
    const inv = poly.getScreenCTM().inverse();
    const texts = [...lab.querySelectorAll("text")].map((t) => {
      const b = t.getBBox(), m = t.getScreenCTM();
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => {
        const p = new DOMPoint(x, y).matrixTransform(m).matrixTransform(inv);
        return poly.isPointInFill(new DOMPoint(p.x, p.y));
      });
      return { text: t.textContent, inside: corners.every(Boolean), n: corners.filter(Boolean).length };
    });
    return { present: true, angle: parseFloat(lab.getAttribute("data-label-angle")), texts };
  }), id);
}

async function select(page, id) {
  const box = await page.locator(`[data-markup="${id}"] polygon`).first().boundingBox();
  expect(box, `easement ${id} did not render`).not.toBeNull();
  // press on the centreline-ish middle of the polygon's own geometry (its bbox centre is on the strip for all three)
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
  await pacedWait(page, 400);
}

for (const [mk, want] of [[VERT, -90], [DIAG30, 30], [DIAG120, -60]]) {
  test(`easement ${mk.id}: label sits inside the strip and reads along it (${want}°)`, async ({ page }) => {
    test.setTimeout(120_000);
    await boot(page);
    // bring the strip to a legible working zoom: zoom in over it with real wheel gestures
    await select(page, mk.id);
    const c = await canvas(page).boundingBox();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      await assertMeasurable(page, "easement-label-orient:sweep");
      for (const r of await read(page, mk.id)) if (r.present) seen.push(r);
      if (process.env.SHOT_DIR && i === 1) await page.screenshot({ path: `${process.env.SHOT_DIR}/${mk.id}.png` });
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.wheel(0, -200);
      await pacedWait(page, 300);
    }
    expect(seen.length, "label never rendered — the spec proved nothing").toBeGreaterThan(0);
    for (const r of seen) {
      expect(r.angle).toBeCloseTo(want, 0);
      expect(r.angle).toBeGreaterThanOrEqual(-90);
      expect(r.angle).toBeLessThanOrEqual(90);
      for (const t of r.texts) expect(t.inside, `"${t.text}" spills outside its strip (${t.n}/4 corners inside) at angle ${r.angle}`).toBe(true);
    }
  });
}
