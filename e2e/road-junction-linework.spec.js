/* NEW-1 (B1783376 ×3, owner report 2026-10-15, Concept A (BN LOI)) — the LINEWORK at a drive entering a parking pad is still messy after PR #2317.
 *
 * What he saw, at a plain (no cross-section) drive-into-pad junction: (a) the line along each curb-return arc does not meet the line along the straight drive
 * edge — a small jog where arc meets straight; (b) a short tick at the top of each arc where it meets the pad face; (c) a faint line straight across the drive mouth where
 * the drive meets the pad, though the two should read as one paved surface; and the right arc heavier than the straight edge.
 *
 * The causes, measured: the face-of-curb stripe was a straight stripe PLUS a separately offset arc stripe lengthened 3 ft along the arc's last CHORD (3° off the edge's
 * heading — the jog); the arc's pad-face end was never trimmed, so a curb-width of it ran INTO the pad (the tick); the pad's first stall row's outline rect starts
 * exactly on the pad face, so it drew its top edge across the mouth (the line); and the cluster's outline is stroked in the WIDEST road's style while each road's stripes
 * use its own (the weight / colour mismatch).
 *
 * THE PROPERTIES (junctionLineworkProbe), asked of the app's own geometry through `window.__plannerRoadNet()` and of the rendered pixels:
 *   1. a drive's face-of-curb is ONE polyline per side — straight run + arc, joined;
 *   2. its heading is continuous at the tangent (< 1°) and nowhere kinks;
 *   3. the arc's pad end lies on the pad face (≤ 0.1 ft) and no stripe point is inside the pad;
 *   4. the drive's outline path and its stripes share stroke colour / width / opacity — even when the drive is narrower than, or styled differently from, the road it joins;
 *   5. in a real screenshot, no run darker than both fills lies along the pad face between the tangents (parking pad AND paving pad, light AND dark, rotated, oblique, polygon).
 * Seeded (not drawn), WRONG-CASE: oblique, rotated, polygon-pad, designed-cross-section and mixed-style drives are the cases a tidy perpendicular fixture cannot see. */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { decodePng } from "../ui-audit/lib/pngDiff.mjs";
import { stripesPerRoad, joinTurns, maxTurn, padFaceCheck, mouthDarkness, stripeLinesOf } from "../ui-audit/lib/junctionLineworkProbe.mjs";

const CG = { type: "curbGutter", w: 2 };
const BANDS = [CG, { type: "travel", w: 10 }, { type: "median", w: 10 }, { type: "travel", w: 10 }, CG, { type: "sidewalk", w: 5 }];
const road = (id, pts, o = {}) => ({
  id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: 34, curb: 0.5, roadClass: "local",
  cx: pts[0].x, cy: pts[0].y, w: 10, h: 10, rot: 0, ...o,
});
const P = (x, y) => ({ x, y });
const PAD = (o = {}) => ({ id: "PAD", type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0, ...o });
const rad = (d) => (d * Math.PI) / 180;
// a pad rotated about its centre, and a road that meets the middle of its top face along the face's outward normal
const rotatedScene = (deg) => {
  const c = { x: 0, y: 100 }, up = { x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) };
  const face = { x: c.x + up.x * 100, y: c.y + up.y * 100 };
  return [PAD({ rot: deg }), road("S", [P(face.x + up.x * 300, face.y + up.y * 300), P(face.x - up.x * 10, face.y - up.y * 10)])];
};

const DRIVE_SCENES = [
  { name: "perpendicular drive into a parking pad", els: () => [PAD(), road("S", [P(0, -300), P(0, 10)])] },
  { name: "oblique drive (35°) into a parking pad", els: () => [PAD(), road("S", [P(-172, -235), P(0, 10)])] },
  { name: "drive into a pad rotated 20°", els: () => rotatedScene(20) },
  { name: "drive into a PAVING pad", els: () => [PAD({ type: "paving" }), road("S", [P(0, -300), P(0, 10)])] },
  // the owner's "pad and drive should read as ONE paved surface": a pad that shares the drive's fill leaves nothing but ink to show where they meet — and a paving pad's
  // derived curb band was drawing exactly that (a 0.6 px stroke along the face, measured ≈ −10 luminance against both fills on the untouched build)
  { name: "drive into a paving pad that shares the drive's fill", els: () => [PAD({ type: "paving", fill: "#9eabb7" }), road("S", [P(0, -300), P(0, 10)])] },
  { name: "drive into a POLYGON pad", els: () => [{ id: "PAD", type: "paving", z: 0, points: [P(-200, 0), P(200, 0), P(200, 200), P(-200, 200)] }, road("S", [P(0, -300), P(0, 10)])] },
  { name: "designed cross-section drive into a parking pad", els: () => [PAD(), road("S", [P(0, -300), P(0, 10)], { travelW: 34, xsection: { bands: BANDS } })] },
  { name: "narrow drive (24 ft) into a parking pad", els: () => [PAD(), road("S", [P(0, -300), P(0, 10)], { travelW: 24 })] },
];

test.use({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
/* How far the pad face between the tangents may read OUTSIDE the luminance range of the two fills beside it. Measured at this zoom: the fixed build reads 0.0 on every
 * scene here (a clean antialiased blend of the two fills, slanted edges included); the untouched build reads 9.3 – 10.5 wherever the field strokes something on its face (a stall row's
 * 0.75 px outline, or a paving pad's derived curb band when the pad shares the drive's fill). 4 leaves room for antialiasing and sits well under the line. */
const MAX_EXCESS = 4;

async function open(page, els, kind = "drives") {
  const ID = "junction-linework";
  // the parcel (and its acreage chip) is parked far from the junction: the chip is not part of what is measured
  const site = {
    id: ID, groupId: ID, site: "junction linework", name: "Plan 1", origin: null, county: null,
    parcels: [{ id: "pc1", locked: false, points: [P(-600, 700), P(600, 700), P(600, 1100), P(-600, 1100)] }],
    els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await armPlannerHooks(page);
  await page.addInitScript(([id, s]) => {
    try { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: s })); localStorage.setItem("planarfit:currentSite:v1", id); } catch (e) { /* */ }
  }, [ID, site]);
  await page.goto("/");
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click({ timeout: 8000 }).catch(() => {});
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await expect.poll(async () => page.evaluate((k) => { const n = window.__plannerRoadNet && window.__plannerRoadNet(); return !!n && n[k].length === 1; }, kind), { timeout: 15000 }).toBeTruthy();
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__plannerRoadNet());
}
/* centre on the junction and wait until the view is really there (the boot framing may still be settling) */
async function zoomTo(page, at, ppf) {
  await expect.poll(async () => {
    await page.evaluate(([x, y, z]) => window.__plannerView.centerOn(x, y, z), [at.x, at.y, ppf]);
    await page.waitForTimeout(350);
    return page.evaluate(() => window.__plannerView.get().ppf);
  }, { timeout: 15000 }).toBeCloseTo(ppf, 3);
  await page.waitForTimeout(500);
  return page.evaluate(() => window.__plannerView.get());
}
const mouthCentre = (d) => ({ x: (d.throughTangents[0].x + d.throughTangents[1].x) / 2, y: (d.throughTangents[0].y + d.throughTangents[1].y) / 2 });
const shot = async (page) => decodePng(await page.getByTestId("planner-canvas").screenshot());

test.describe("NEW-1 — a drive entering a pad has ONE continuous curb line per side and nothing across the mouth", () => {
  for (const sc of DRIVE_SCENES) {
    test(sc.name, async ({ page }) => {
      const net = await open(page, sc.els());
      const drive = net.drives[0];
      // 1. one stripe polyline per side
      expect(stripesPerRoad(net, "S"), "a drive's face-of-curb is one polyline per side (straight run + arc), not a stripe plus a separate arc stripe").toBe(2);
      // 2. heading continuous at the tangent, and no kink anywhere on the stripe
      const turns = joinTurns(net, drive);
      for (const t of turns) {
        expect(t.turn, `return ${t.k}: the straight stripe and the arc are not joined at the tangent point`).not.toBeNull();
        expect(t.turn, `return ${t.k}: the stripe's heading jumps at the tangent`).toBeLessThan(1);
      }
      expect(maxTurn(net, "S"), "a stripe vertex turns more than one tessellation step").toBeLessThan(2);
      // 3. the arc ends ON the pad face and never enters the pad
      const pf = padFaceCheck(net, drive);
      expect(pf.noPad).toBeFalsy();
      expect(pf.ends.length, "each return's stripe has a pad-face end").toBe(2);
      for (const e of pf.ends) expect(e, "a stripe ends off the pad face").toBeLessThan(0.1);
      expect(pf.deepest, "a stripe runs on into the pad (the tick)").toBeLessThan(0.05);
      // 4. the drive's outline and its stripes are one style
      const styles = await page.evaluate(() => {
        const edge = document.querySelector('[data-testid="road-network-edge"][data-edge-road="S"]');
        const stripes = [...document.querySelectorAll('[data-road-deco="S"] polyline')];
        const read = (n) => ({ stroke: n.getAttribute("stroke"), width: n.getAttribute("stroke-width"), opacity: n.getAttribute("stroke-opacity") });
        return { edge: edge ? read(edge) : null, stripes: stripes.map(read) };
      });
      expect(styles.edge, "the drive's outline path carries its owner").toBeTruthy();
      expect(styles.stripes.length).toBeGreaterThan(0);
      for (const s of styles.stripes) expect(s, "the outline and the face-of-curb stripe differ in weight / colour").toEqual(styles.edge);
    });
    test(`${sc.name} — in pixels, nothing is stroked across the drive mouth`, async ({ page }) => {
      const net = await open(page, sc.els());
      const drive = net.drives[0];
      const view = await zoomTo(page, { x: mouthCentre(drive).x, y: mouthCentre(drive).y }, 8);
      const m = mouthDarkness(await shot(page), view, 2, drive);
      expect(m.excess, `a line is stroked across the drive mouth (face ${m.lMin.toFixed(1)}…${m.lMax.toFixed(1)} vs fills ${m.lRoad.toFixed(1)} / ${m.lPad.toFixed(1)})`).toBeLessThanOrEqual(sc.maxExcess ?? MAX_EXCESS);
    });
  }

  test("the same, in the dark theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    const net = await open(page, [PAD(), road("S", [P(0, -300), P(0, 10)])]);
    const view = await zoomTo(page, mouthCentre(net.drives[0]), 8);
    const m = mouthDarkness(await shot(page), view, 2, net.drives[0]);
    expect(m.excess, `a line is stroked across the drive mouth in the dark theme (face ${m.lMin.toFixed(1)}…${m.lMax.toFixed(1)} vs ${m.lRoad.toFixed(1)} / ${m.lPad.toFixed(1)})`).toBeLessThanOrEqual(MAX_EXCESS);
  });

  test("a drive narrower than — and styled differently from — the trunk it joins is outlined in ITS OWN weight and colour", async ({ page }) => {
    const els = [PAD(), road("T", [P(-300, -150), P(0, -150), P(300, -150)], { travelW: 40, stroke: "#b00020", strokeWidth: 4 }), road("S", [P(0, -150), P(0, 10)], { travelW: 24 })];
    const net = await open(page, els);
    expect(net.regions.length, "one cluster — the drive is welded to the trunk and to the pad").toBe(1);
    const res = await page.evaluate(() => {
      const read = (n) => ({ stroke: n.getAttribute("stroke"), width: n.getAttribute("stroke-width"), opacity: n.getAttribute("stroke-opacity") });
      const edgeOf = (id) => document.querySelector(`[data-testid="road-network-edge"][data-edge-road="${id}"]`);
      return ["S", "T"].map((id) => ({ id, edge: edgeOf(id) ? read(edgeOf(id)) : null, stripes: [...document.querySelectorAll(`[data-road-deco="${id}"] polyline`)].map(read) }));
    });
    for (const r of res) {
      expect(r.edge, `road ${r.id}: its own outline path exists`).toBeTruthy();
      expect(r.stripes.length).toBeGreaterThan(0);
      for (const s of r.stripes) expect(s, `road ${r.id}: outline vs face-of-curb stripe`).toEqual(r.edge);
    }
    expect(res[0].edge.stroke, "the drive is not outlined in the trunk's red").not.toBe(res[1].edge.stroke);
    // ... and in pixels: the drive's straight edge, mid-run, is not the trunk's red
    const view = await zoomTo(page, { x: 0, y: -110 }, 10);
    const img = await shot(page);
    const at = (fx, fy) => { const x = Math.round((fx * view.ppf + view.offX) * 2), y = Math.round((fy * view.ppf + view.offY) * 2), i = (y * img.width + x) * img.channels; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
    let redness = 0;
    for (const fx of [-12.6, -12.4, -12.2, -12, 12, 12.2, 12.4, 12.6]) { const [r, g, b] = at(fx, -110); redness = Math.max(redness, r - Math.max(g, b)); }
    expect(redness, "the drive's own edge is drawn in the trunk's red").toBeLessThan(40);
  });

  test("a plain tee: the side road's face-of-curb is one polyline per side, ending exactly where the through road's stripe begins", async ({ page }) => {
    const net = await open(page, [road("G", [P(-300, 0), P(0, 0), P(300, 0)]), road("S", [P(0, -250), P(0, 0)])], "tees");
    expect(stripesPerRoad(net, "S"), "one polyline per side").toBe(2);
    expect(maxTurn(net, "S")).toBeLessThan(2);
    const through = stripeLinesOf(net, "G");
    for (const l of stripeLinesOf(net, "S")) {
      const end = l[l.length - 1];
      expect(through.some((t) => [t[0], t[t.length - 1]].some((e) => Math.hypot(e.x - end.x, e.y - end.y) < 1e-3)), `the arc ends at (${end.x.toFixed(2)}, ${end.y.toFixed(2)}) with no through-road stripe beginning there`).toBe(true);
    }
  });

  test("PDF/PNG parity — the export clone carries the band-outline cuts counter-rotated with the pad", async ({ page }) => {
    await open(page, rotatedScene(20));
    const res = await page.evaluate(() => {
      const live = document.querySelector('[data-testid="planner-canvas"]');
      const clone = live.cloneNode(true);
      clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
      const g = [...clone.querySelectorAll('[data-testid="band-outline-cut"]')].filter((n) => n.getAttribute("data-el-id") === "PAD");
      return { n: g.length, transforms: g.map((n) => n.getAttribute("transform")), lines: g.reduce((a, n) => a + n.querySelectorAll("polyline").length, 0) };
    });
    expect(res.n, "the stall-row outlines are interrupted groups, not plain rects, on a pad a drive tees into").toBeGreaterThan(0);
    for (const t of res.transforms) expect(t).toMatch(/^rotate\(-20[ )]/);
    expect(res.lines).toBeGreaterThan(0);
  });
});
