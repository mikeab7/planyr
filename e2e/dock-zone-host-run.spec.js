/* NEW-1 — a child carrying a DIFFERENT (longer) host's along-wall run, through the REAL render path.
 *
 * Seeded with the OWNER'S ACTUAL elements (Weld County, CO — site `sms7v3ua7ksy` / "Concept A", all
 * three buildings and every one of their children, copied verbatim out of `site_elements`), and
 * deliberately NOT a clean synthetic building: a freshly drawn building lays out correctly today and
 * would pass while the bug is still in the code. Every number below is read back off the LIVE canvas
 * DOM (each element group carries `data-el-id`) and converted to feet with the planner's own view
 * scale, so this measures what the owner actually sees.
 *
 * What it proves, before AND after a host resize:
 *   • EVERY child of building 3 (260 × 514) measures against 514 along the wall — its truck court
 *     and its west parking row arrive saved at 708.58, which is a DIFFERENT building's length, and
 *     overhang their host by 194.58 ft ("obviously my building is super messed up");
 *   • no child of any building overhangs the wall it hugs;
 *   • building 2's spurious `sideParkFit` — a stored "the owner set this length" intent whose value
 *     is, again, the other building's length — cannot spring the field back out.
 *
 * Logged out + no external GIS, so it runs here (VERIFICATION.md rule 4 — attempt before you park).
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/dock-zone-host-run.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/weld-concept-a.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-dock-zone-host-run";

const B3 = "e7389vqgilf";                             // 260 × 514, dock on its RIGHT (long) wall
const COURT = "e7390vqgilf";                          // saved 135 × 708.58 — the overhang
const PK_LEFT = "e7394vqgilf";                        // saved 708.58 × 60 — the other one
const SW_LEFT = "e7393vqgilf";                        // saved 5 × 514 — already right (heal, not resize)
const B3_KIDS = ["e7390vqgilf", "e7391vqgilf", "e7392vqgilf", "e7393vqgilf", "e7394vqgilf", "e7395vqgilf", "e7396vqgilf"];
const FOREIGN_LEN = 708.58;                           // building 1's length — the number that leaked
const B3_LEN = 514;

/* The children that run ALONG the long walls (the axis the defect is on). The end-wall children
 * (top / bottom) run the building's 260 ft DEPTH and are asserted separately. */
const LONG_WALL_KIDS = [COURT, SW_LEFT, PK_LEFT];

const canvas = (p) => p.getByTestId("planner-canvas");
const fieldInput = (p, label) => p.getByText(label, { exact: true }).locator("xpath=..").locator("input").first();

async function loadPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Weld", name: "Concept A", origin: null, county: "co_weld",
    parcels: [], els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1785400000000,
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.locator(`[data-el-id="${B3}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
}

/* Read building 3 and its children back out of the live SVG, in FEET, expressed in the BUILDING's
 * own frame — the frame the overhang is stated in. Same technique as e2e/wall-kid-drift.spec.js:
 * each element renders inside `rotate(el.rot, centre)`, so undo the group transform via
 * getScreenCTM and divide by the planner's own pixels-per-foot. */
const readPlan = (page, ids, hostId) => page.evaluate(({ ids, hostId }) => {
  const ppf = window.__plannerView.get().ppf;
  const boxOf = (id) => {
    const g = document.querySelector(`[data-el-id="${id}"]`);
    const r = g && g.querySelector("rect");
    if (!r) return null;
    const m = r.getScreenCTM();
    const pt = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y }; };
    const x = +r.getAttribute("x"), y = +r.getAttribute("y");
    const w = +r.getAttribute("width"), h = +r.getAttribute("height");
    const c = pt(x + w / 2, y + h / 2);
    const a = pt(x, y + h / 2), b = pt(x + w, y + h / 2);
    return { cxPx: c.x, cyPx: c.y, w: w / ppf, h: h / ppf, rot: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI };
  };
  const host = boxOf(hostId);
  if (!host) return null;
  // The dock rides the LONG walls, which on this plan are left/right — so the host's local X is the
  // across-wall axis and its local Y is the along-wall axis for every long-wall child.
  const out = { host: { w: host.w, h: host.h, rot: host.rot }, kids: {} };
  const rad = (-host.rot * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad);
  for (const id of ids) {
    const k = boxOf(id);
    if (!k) { out.kids[id] = null; continue; }
    const dx = (k.cxPx - host.cxPx) / ppf, dy = (k.cyPx - host.cyPx) / ppf;
    const rel = (((k.rot - host.rot) % 360) + 360) % 360;
    const cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
    out.kids[id] = {
      across: dx * co - dy * si,                      // signed distance out from the host centre
      along: dx * si + dy * co,                       // position ALONG the long wall
      depth: cross ? k.h : k.w,                       // extent across the long wall
      run: cross ? k.w : k.h,                         // extent ALONG the long wall
    };
  }
  return out;
}, { ids, hostId });

/* The invariant, in one place: no child claims more of the long wall than the host has, and none of
 * them hangs off its end. */
async function assertNoOverhang(page, label, wantLen) {
  const p = await readPlan(page, B3_KIDS, B3);
  expect(p, `${label}: building 3 did not render`).not.toBeNull();
  expect(p.host.h, `${label}: host length`).toBeCloseTo(wantLen, 0);
  for (const id of LONG_WALL_KIDS) {
    const k = p.kids[id];
    expect(k, `${label}: ${id} missing`).toBeTruthy();
    expect(k.run, `${label}: ${id} run`).toBeCloseTo(wantLen, 0);
    expect(k.run, `${label}: ${id} still carries the OTHER building's length`).not.toBeCloseTo(FOREIGN_LEN, 0);
    // Both ends inside the wall: |centre| + half the run may not pass half the wall.
    expect(Math.abs(k.along) + k.run / 2, `${label}: ${id} hangs off the end of the wall`)
      .toBeLessThanOrEqual(wantLen / 2 + 1);
  }
  return p;
}

test.describe("NEW-1 — the owner's real Weld County plan", () => {
  test("as loaded: every child of the 514 ft building measures against 514, not 708.58", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);

    // The state the assertion has teeth against: this is what is SAVED on his plan.
    expect(FIXTURE.els.find((e) => e.id === COURT).h).toBeCloseTo(FOREIGN_LEN, 2);
    expect(FIXTURE.els.find((e) => e.id === PK_LEFT).w).toBeCloseTo(FOREIGN_LEN, 2);

    const p = await assertNoOverhang(page, "as loaded", B3_LEN);
    // The truck court sits flush on the dock wall (half the building depth + half its own depth).
    expect(Math.abs(p.kids[COURT].across)).toBeCloseTo(p.host.w / 2 + p.kids[COURT].depth / 2, 0);
    // The west parking row is still flush beyond its sidewalk — the heal fixed the run, not the fit.
    expect(Math.abs(p.kids[PK_LEFT].across) - p.kids[PK_LEFT].depth / 2)
      .toBeCloseTo(Math.abs(p.kids[SW_LEFT].across) + p.kids[SW_LEFT].depth / 2, 0);
    // The end-wall children run the building's DEPTH and are untouched by any of this.
    expect(p.kids["e7391vqgilf"].depth).toBeCloseTo(260, 0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("no building on the plan has a child overhanging its long wall", async ({ page }) => {
    await loadPlan(page);
    /* The host↔child↔side map comes from the SAVED record (which never changes); every NUMBER comes
       off the live DOM. All three buildings on this plan dock on their left/right walls. */
    const pairs = FIXTURE.els
      .filter((e) => e.type === "building" && !e.dogEar)
      .flatMap((host) => FIXTURE.els
        .filter((k) => k.attachedTo === host.id && !k.points && (k.truckCourt || k.sideParkSide || k.sidewalkSide))
        .map((k) => ({ host: host.id, kid: k.id, side: k.truckCourt ? k.truckCourt.side : (k.sideParkSide || k.sidewalkSide) }))
        .filter((r) => r.side === "left" || r.side === "right"));
    expect(pairs.length, "the probe found no long-wall children to measure").toBeGreaterThan(5);

    const worst = { over: -Infinity };
    for (const { host, kid } of pairs) {
      const p = await readPlan(page, [kid], host);
      expect(p, `${host} did not render`).not.toBeNull();
      const k = p.kids[kid];
      expect(k, `${kid} did not render`).toBeTruthy();
      const over = Math.abs(k.along) + k.run / 2 - p.host.h / 2;
      if (over > worst.over) Object.assign(worst, { over, kid, host });
    }
    expect(worst.over, `${worst.kid} overhangs ${worst.host} by ${worst.over.toFixed(1)} ft`).toBeLessThanOrEqual(1);
  });

  test("the rules still hold AFTER a host resize", async ({ page }) => {
    await loadPlan(page);
    await assertNoOverhang(page, "before resize", B3_LEN);

    // Resize through the real UI: select the building, open Properties, retype its Length.
    // Click the CENTRE of the building group — its corners are overlapped by the end-wall parking
    // rows, which intercept the pointer.
    await page.locator(`[data-el-id="${B3}"] rect`).first().click();
    await page.getByRole("button", { name: /^Properties$/ }).click();
    const len = fieldInput(page, "Length (ft)");
    await expect(len).toBeVisible({ timeout: 8000 });
    await len.fill("400");
    await len.press("Enter");
    await expect.poll(async () => Math.round((await readPlan(page, B3_KIDS, B3)).host.h), { timeout: 8000 }).toBe(400);

    await assertNoOverhang(page, "after shortening to 400", 400);

    // …and growing it back takes the children with it, rather than springing a stale run back out.
    await len.fill("620");
    await len.press("Enter");
    await expect.poll(async () => Math.round((await readPlan(page, B3_KIDS, B3)).host.h), { timeout: 8000 }).toBe(620);
    const grown = await readPlan(page, B3_KIDS, B3);
    for (const id of LONG_WALL_KIDS) {
      expect(grown.kids[id].run, `after growing: ${id} sprang out past the wall`).toBeLessThanOrEqual(620 + 1);
      expect(grown.kids[id].run, `after growing: ${id} took the OTHER building's length`).not.toBeCloseTo(FOREIGN_LEN, 0);
    }
  });
});
