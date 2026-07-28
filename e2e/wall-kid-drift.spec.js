/* NEW-2 / NEW-3 — wall-strip + side-parking drift, through the REAL render path.
 *
 * Seeded with the OWNER'S ACTUAL elements (Tsakiris / Concept A, Building 3 `e47duuwgj` with its two
 * corner bump-outs, both end sidewalks and both end side-parking fields) — deliberately NOT a clean
 * synthetic building, because a freshly drawn building lays out correctly today and would pass while
 * the bug is still in the code. Every number below is read back off the LIVE canvas DOM (each
 * element group carries `data-el-id`) and converted to feet with the planner's own view scale, so
 * this measures what the owner actually sees, not what a pure helper returns.
 *
 * What it proves, before AND after a host resize:
 *   • both end sidewalk runs = building depth + the bump projection (the span rule, NEW-2);
 *   • the parking-to-sidewalk gap is 0 on BOTH ends — the west field's bare-ground strip is gone
 *     and the east field has no overlap (NEW-3);
 *   • the east field (the one the owner slid himself for the fire-lane curb return) has not moved
 *     ALONG the wall and has not been re-lengthened — the owner's amendment, asserted explicitly.
 *
 * Logged out + no external GIS, so it runs here (VERIFICATION.md rule 4 — attempt before you park).
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/wall-kid-drift.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/tsakiris-concept-a.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-wall-kid-drift";

const B3 = "e47duuwgj";                              // Building 3, 445 × 150, rot 180
const SW_EAST = "e48duuwgj", SW_WEST = "e50duuwgj";  // its two end sidewalks, 5 ft thick
const PK_EAST = "e52duuwgj", PK_WEST = "e59hzrjsn";  // its two end side-parking fields, 42 ft deep
const BUMP_PROJ = 60;                                // both bump-outs project 60 ft past the dock face

const canvas = (p) => p.getByTestId("planner-canvas");
/* A Properties-panel row: the panel renders `<span>label</span><input>`, not a <label for>, so
 * reach the input through the label text rather than getByLabel. */
const fieldInput = (p, label) => p.getByText(label, { exact: true }).locator("xpath=..").locator("input").first();

/* Select Building 3 and open its Properties tab; returns once the building's own fields are up
 * (which is also the proof that the click actually selected it). */
async function selectBuilding(page) {
  await page.locator(`[data-el-id="${B3}"]`).click({ position: { x: 5, y: 5 } });
  await page.getByRole("button", { name: /^Properties$/ }).click();
  await expect(fieldInput(page, "Depth (ft)")).toBeVisible({ timeout: 8000 });
}

async function loadPlan(page, els = FIXTURE.els) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1753000000000,
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

/* Read the drawn geometry of Building 3 and its four wall kids back out of the live SVG, in FEET.
 *
 * Each element renders inside `rotate(el.rot, centre)`, so its own <rect> is axis-aligned in the
 * group's frame; we undo the group transform via getScreenCTM and convert with the planner's own
 * pixels-per-foot. Then everything is expressed in the BUILDING's local frame (host centre at the
 * origin, host angle removed) — the frame the span rule and the flushness rule are stated in. */
const readPlan = (page, ids) => page.evaluate(({ ids, hostId }) => {
  const ppf = window.__plannerView.get().ppf;
  const boxOf = (id) => {
    const g = document.querySelector(`[data-el-id="${id}"]`);
    if (!g) return null;
    const r = g.querySelector("rect");
    if (!r) return null;
    const m = r.getScreenCTM();                       // group transform included
    const pt = (x, y) => { const p = new DOMPoint(x, y).matrixTransform(m); return { x: p.x, y: p.y }; };
    const x = +r.getAttribute("x"), y = +r.getAttribute("y");
    const w = +r.getAttribute("width"), h = +r.getAttribute("height");
    const c = pt(x + w / 2, y + h / 2);
    // The group's rotation is baked into the CTM, so the drawn centre comes back in screen px;
    // undo the canvas pan/zoom by working in px and dividing by ppf at the end.
    return { cxPx: c.x, cyPx: c.y, w: w / ppf, h: h / ppf, rot: (() => {
      const a = pt(x, y + h / 2), b = pt(x + w, y + h / 2);
      return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    })() };
  };
  const host = boxOf(hostId);
  if (!host) return null;
  const out = { host: { w: host.w, h: host.h, rot: host.rot }, kids: {} };
  const rad = (-host.rot * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad);
  for (const id of ids) {
    const k = boxOf(id);
    if (!k) { out.kids[id] = null; continue; }
    const dx = (k.cxPx - host.cxPx) / ppf, dy = (k.cyPx - host.cyPx) / ppf;
    const rel = (((k.rot - host.rot) % 360) + 360) % 360;
    const cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
    // Every kid asserted here hugs an END wall, so the host's local X is the perpendicular axis.
    out.kids[id] = {
      perp: dx * co - dy * si,                        // signed distance out from the host centre
      alongShift: dx * si + dy * co,                  // position ALONG the wall
      depth: cross ? k.h : k.w,
      run: cross ? k.w : k.h,
    };
  }
  return out;
}, { ids, hostId: B3 });

const IDS = [SW_EAST, SW_WEST, PK_EAST, PK_WEST];
const innerFace = (k) => Math.abs(k.perp) - k.depth / 2;
const outerFace = (k) => Math.abs(k.perp) + k.depth / 2;
/* Bare ground (positive) or overlap (negative) between a parking field and its strip. */
const gap = (strip, park) => innerFace(park) - outerFace(strip);

async function assertRules(page, label) {
  const p = await readPlan(page, IDS);
  expect(p, `${label}: Building 3 did not render`).not.toBeNull();
  const wantRun = p.host.h + BUMP_PROJ;

  for (const [end, swId, pkId] of [["east", SW_EAST, PK_EAST], ["west", SW_WEST, PK_WEST]]) {
    const sw = p.kids[swId], pk = p.kids[pkId];
    expect(sw, `${label}: ${end} sidewalk missing`).toBeTruthy();
    expect(pk, `${label}: ${end} parking missing`).toBeTruthy();
    // NEW-2 — the strip spans exactly the extended side and sits flush on the wall.
    expect(sw.run, `${label}: ${end} sidewalk run`).toBeCloseTo(wantRun, 1);
    expect(innerFace(sw), `${label}: ${end} sidewalk not flush on the wall`).toBeCloseTo(p.host.w / 2, 1);
    // NEW-3 — no bare ground and no overlap between the parking and that strip.
    expect(gap(sw, pk), `${label}: ${end} parking-to-sidewalk gap`).toBeCloseTo(0, 1);
  }
  // Both end strips agree with each other (the drifted plan had 224 vs 221, one off centre).
  expect(p.kids[SW_EAST].run).toBeCloseTo(p.kids[SW_WEST].run, 1);
  expect(p.kids[SW_EAST].alongShift).toBeCloseTo(p.kids[SW_WEST].alongShift, 1);
  return p;
}

test.describe("NEW-2 / NEW-3 — wall strips + side parking on the owner's real plan", () => {
  test("the drifted plan renders on the rule: strips span the extended side, both ends flush", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadPlan(page);
    await assertRules(page, "as loaded");
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the east field the owner positioned himself does not move ALONG the wall", async ({ page }) => {
    await loadPlan(page);
    const p = await assertRules(page, "as loaded");
    // As saved on his plan: the east field's own run + along-wall centre (he slid it for the curb
    // return where the fire lane ties in). The span default would be a different number entirely.
    const stored = FIXTURE.els.find((e) => e.id === PK_EAST);
    const host = FIXTURE.els.find((e) => e.id === B3);
    expect(p.kids[PK_EAST].run, "east parking run was re-lengthened onto the span").toBeCloseTo(stored.w, 1);
    expect(p.kids[PK_EAST].run).not.toBeCloseTo(p.host.h + BUMP_PROJ, 1); // proves the assertion has teeth
    // Its along-wall centre, in the host's local frame, is exactly where it was stored.
    const dx = stored.cx - host.cx, dy = stored.cy - host.cy;
    const rad = (-host.rot * Math.PI) / 180;
    expect(p.kids[PK_EAST].alongShift, "east parking slid along the wall")
      .toBeCloseTo(dx * Math.sin(rad) + dy * Math.cos(rad), 1);
  });

  test("the rules still hold AFTER a host resize (the branch that was missing)", async ({ page }) => {
    await loadPlan(page);
    const before = await assertRules(page, "before resize");
    const eastBefore = before.kids[PK_EAST];

    // Resize the building through the real UI: select it, open Properties, retype its Depth.
    await selectBuilding(page);
    const depth = fieldInput(page, "Depth (ft)");
    await depth.fill("210");
    await depth.press("Enter");
    await expect.poll(async () => Math.round((await readPlan(page, IDS)).host.h), { timeout: 8000 }).toBe(210);

    const after = await assertRules(page, "after resize");
    expect(after.kids[SW_EAST].run).toBeCloseTo(210 + BUMP_PROJ, 1);   // re-derived, not rescaled
    // …and the owner's east field is STILL where he left it along the wall.
    expect(after.kids[PK_EAST].run, "east parking run changed on a host resize").toBeCloseTo(eastBefore.run, 1);
    expect(after.kids[PK_EAST].alongShift, "east parking slid on a host resize").toBeCloseTo(eastBefore.alongShift, 1);
  });

  test("NEW-1 — selecting a building draws no dashed attachment tethers", async ({ page }) => {
    await loadPlan(page);
    await selectBuilding(page);   // a building with five bonded children — the worst case for the starburst
    // The tethers were <line stroke-dasharray="3 3"> inside the selection chrome group, one per
    // bonded child — a starburst across the plan. Nothing on the canvas may draw them now.
    const tethers = await page.locator('[data-testid="planner-canvas"] line[stroke-dasharray="3 3"]').count();
    expect(tethers, "dashed attachment tethers are still being drawn").toBe(0);
  });
});
