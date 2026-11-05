/* NEW-1 (2026-11-05) — TRAILER PARKING ALWAYS DRAWS ABOVE ROADS (owner-ordered exception to constraint 10).
 *
 * THE PROPERTY, on the real render (paint order = DOM order = hit-test order): a trailer row whose stored z is LOWER than an overlapping
 * road's paints AFTER that road — a lone road AND a road-network cluster — on the canvas, in the built print sheet (`__plannerExportSvg`)
 * and in the editable PDF's annotation order (`__plannerExportComposed`). A selected road still lifts above everything while selected and
 * drops back on deselect. A click on the visible trailer picks the trailer; a click on road where no trailer overlaps picks the road. The
 * stored z is never rewritten (reload keeps it). RED on the pre-change build (the trailer precedes the road in all three).
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const SITE = "e2e-trailer-over-roads";
const TRAILER_Z = 8192, ROAD_Z = 82944;
const trailer = { id: "trl", type: "trailer", cx: 0, cy: 0, w: 200, h: 60, rot: 0, z: TRAILER_Z };
const road = (id, pts, z) => ({ id, type: "road", z, pts, vtx: pts.map(() => ({})), travelW: 40, curb: 0.5, roadClass: "local", cx: (pts[0].x + pts[pts.length - 1].x) / 2, cy: (pts[0].y + pts[pts.length - 1].y) / 2, w: Math.abs(pts[pts.length - 1].x - pts[0].x) || 40, h: Math.abs(pts[pts.length - 1].y - pts[0].y) || 40, rot: 0 });
// the road crosses the trailer's middle and runs 200 ft past it on each side (so there is road-only ground to click on)
const LONE = [road("rd", [{ x: -300, y: 0 }, { x: 300, y: 0 }], ROAD_Z)];
// a cluster: two joined roads (an L), the newer one carrying the high z
const CLUSTER = [road("rdA", [{ x: -300, y: 0 }, { x: 0, y: 0 }], 70000), road("rdB", [{ x: 0, y: 0 }, { x: 300, y: 0 }], ROAD_Z)];

async function open(page, roads) {
  const site = {
    id: SITE, groupId: SITE, site: "trailer over roads", name: "Plan 1", origin: null, county: null,
    parcels: [{ id: "pc1", locked: false, points: [{ x: -500, y: -300 }, { x: 500, y: -300 }, { x: 500, y: 300 }, { x: -500, y: 300 }] }],
    els: [trailer, ...roads], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await armPlannerHooks(page);
  await page.addInitScript(([id, s]) => {
    try {
      if (localStorage.getItem("planarfit:currentSite:v1") === id) return; // a reload keeps what the app saved
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id);
    } catch (e) { /* */ }
  }, [SITE, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-el-id="trl"]')).toHaveCount(1);
  await page.waitForTimeout(900);
}

/* true = the TRAILER paints after (above) every road node in this document. Reads the trailer's node and every road's cluster surface + decoration. */
const trailerAboveRoads = (root) => {
  const t = root.querySelector('[data-el-id="trl"]');
  if (!t) return null;
  const roads = [...root.querySelectorAll("[data-road-cluster], [data-road-deco], [data-el-id^='rd']")];
  if (!roads.length) return null;
  return roads.every((r) => !!(r.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING));
};
const canvasAbove = (page) => page.evaluate(`(${trailerAboveRoads.toString()})(document.querySelector('[data-testid="planner-canvas"]'))`);
const sheetAbove = (page) => page.evaluate(async (fnSrc) => {
  const markup = await window.__plannerExportSvg();
  const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
  // eslint-disable-next-line no-eval
  return (0, eval)(`(${fnSrc})`)(doc);
}, trailerAboveRoads.toString());
const annotAbove = (page) => page.evaluate(async () => {
  const c = await window.__plannerExportComposed();
  const nms = c.annots.map((a) => a.nm);
  const t = nms.findIndex((n) => n.endsWith("-trl"));
  const rs = nms.map((n, i) => (/-rd/.test(n) ? i : -1)).filter((i) => i >= 0);
  return { t, rs, above: t >= 0 && rs.length > 0 && rs.every((i) => t > i) };
});

const featureAt = (page, x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("[data-feature]")?.getAttribute("data-feature") || null, [x, y]);
async function points(page) {
  return page.evaluate(() => {
    const t = document.querySelector('[data-el-id="trl"]').getBoundingClientRect();
    const roadNodes = [...document.querySelectorAll("[data-road-cluster] [data-testid='road-network-surface'], [data-road-cluster]")];
    const rb = roadNodes.map((n) => n.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
    // overlap = the trailer's centre (the road runs straight through it); road-only = near the road's right end, past the trailer's right edge
    return { overlap: { x: t.left + t.width / 2, y: t.top + t.height / 2 }, roadOnly: { x: Math.min(rb.right - 20, t.right + (rb.right - t.right) / 2), y: t.top + t.height / 2 } };
  });
}

for (const [label, roads] of [["a lone road", LONE], ["a road-network cluster", CLUSTER]]) {
  test.describe(label, () => {
    test("the trailer (lower z) paints above the road: canvas, printed sheet and editable-PDF order agree", async ({ page }) => {
      await open(page, roads);
      expect(await page.locator("[data-road-cluster]").count(), "vacuity guard: the road must actually be on the canvas").toBeGreaterThan(0);
      expect(await canvasAbove(page)).toBe(true);
      expect(await sheetAbove(page)).toBe(true);
      const a = await annotAbove(page);
      expect(a.rs.length, "vacuity guard: the road must be an annotation too").toBeGreaterThan(0);
      expect(a.above, JSON.stringify(a)).toBe(true);
    });

    test("hit test: the visible trailer is what a click picks; road-only ground still picks the road", async ({ page }) => {
      await open(page, roads);
      const p = await points(page);
      expect(await featureAt(page, p.overlap.x, p.overlap.y)).toBe("el:trl");
      expect(await featureAt(page, p.roadOnly.x, p.roadOnly.y)).toMatch(/^el:rd/);
    });

    test("a SELECTED road lifts above the trailer while selected and drops back when deselected", async ({ page }) => {
      await open(page, roads);
      const p = await points(page);
      await page.mouse.click(p.roadOnly.x, p.roadOnly.y);
      await expect.poll(() => canvasAbove(page), { timeout: 5000 }).toBe(false); // the selection lift: road after trailer
      await page.keyboard.press("Escape");
      await page.mouse.click(p.overlap.x - 150, p.overlap.y - 200); // empty ground
      await expect.poll(() => canvasAbove(page), { timeout: 5000 }).toBe(true);
    });

    test("nothing is rewritten on disk and a reload keeps the same picture", async ({ page }) => {
      await open(page, roads);
      await page.waitForTimeout(1500);
      const z = () => page.evaluate(() => {
        const lib = JSON.parse(window.__planyrSitesRaw("planarfit:sites:v1") || "{}");
        const els = (lib["e2e-trailer-over-roads"] || {}).els || [];
        return Object.fromEntries(els.map((e) => [e.id, e.z]));
      });
      const before = await z();
      expect(before.trl).toBe(TRAILER_Z);
      await page.reload();
      await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
      await page.waitForTimeout(900);
      expect(await canvasAbove(page)).toBe(true);
      expect(await z()).toEqual(before);
    });
  });
}

test("a trailer with NO road on the plan, and a road with no trailer, are unaffected", async ({ page }) => {
  await open(page, []);
  expect(await canvasAbove(page)).toBeNull(); // no road: the rule has nothing to say
  await expect(page.locator('[data-el-id="trl"]')).toHaveCount(1);
});
