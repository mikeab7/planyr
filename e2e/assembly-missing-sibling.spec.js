/* ⛔ NEW-3 — the heal must REFUSE to lay out an assembly whose sibling has been deleted, through the
 * real load path, on the owner's real building.
 *
 * WHY THIS EXISTS AS AN E2E SPEC AND NOT ONLY AS A UNIT TEST. The seam that produced the reported
 * damage is the LOAD-TIME heal (`storage.js` → `normalizeBondedChildren`, run before the planner
 * even mounts), and it PERSISTS what it decides. A unit test proves the function; only this proves
 * the plan on disk. The two are asserted separately and in that order: what the canvas shows, and
 * then what was written back.
 *
 * The fixture is building `e1454939cgzlnc` from plan `smsdrvzr9gzx` (Richfield / Concept A) copied
 * verbatim out of `site_elements`, with the right-hand truck court `e1454940cgzlnc` REMOVED — which
 * is the exact state a stale delete (B377888) left it in. Its trailer row still names the court in
 * `forCourt` / `prevZone`, because that reference is now deliberately kept.
 *
 * THE NUMBERS, in the building's own across-wall frame (host 620 × 1198 at rot 270, so the right
 * wall's outward normal is −y and half the host across that wall is 310):
 *   • correct, with the court present:   310 + 135 + 25 = 470  →  cy −1232.81
 *   • what the old heal produced:        310 + 25       = 335  →  cy −1097.81
 * The 135 ft difference IS the deleted truck court. A trailer row flush against a dock wall is not
 * a layout; it is a layout with a piece missing, and nothing on the drawing says which piece.
 *
 * Logged out, no external GIS: Claude-doable here (ATTEMPT-BEFORE-YOU-PARK). The signed-in
 * cloud round trip is V173458.
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/assembly-missing-sibling.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const FIX = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/richfield-concept-a-b3.json", import.meta.url), "utf8"));
const SITE_KEY = "planarfit:sites:v1";
const SITE_ID = "e2e-assembly-missing-sibling";

const HOST = FIX.host, COURT = FIX.rightCourt, TRAILER = FIX.rightTrailer;
const RIGHT_ACROSS = 470;          // with the court present
const FLUSH_ACROSS = 335;          // what the pre-fix heal produced
const canvas = (p) => p.getByTestId("planner-canvas");

async function open(page, els) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Richfield", name: "Concept A", origin: null, county: "harris",
    parcels: [], els, measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1786500000000,
  };
  await page.addInitScript(([key, id, rec]) => {
    localStorage.setItem(key, JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_KEY, SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.locator(`[data-el-id="${HOST}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
}

// The trailer's offset from its host along the RIGHT wall's outward normal, in feet, read off the
// live SVG rather than off state — this is what the owner is looking at.
const acrossOnCanvas = (page, hostId, childId) => page.evaluate(({ hostId, childId }) => {
  const ppf = window.__plannerView.get().ppf;
  const mid = (id) => {
    const r = document.querySelector(`[data-el-id="${id}"] rect`);
    if (!r) return null;
    const b = r.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const h = mid(hostId), c = mid(childId);
  if (!h || !c) return null;
  // rot 270 → the right wall's outward normal is (0, −1) in world feet, which is (0, +1) on screen
  // (screen y grows downward while feet y grows upward), so the magnitude is what matters here.
  return Math.abs(c.y - h.y) / ppf;
}, { hostId, childId });

const storedEl = (page, id) => page.evaluate(({ key, site, id }) => {
  const rec = (JSON.parse(localStorage.getItem(key) || "{}") || {})[site] || {};
  return (rec.els || []).find((e) => e && e.id === id) || null;
}, { key: SITE_KEY, site: SITE_ID, id });

const telemetry = (page) => page.evaluate(() => {
  try { return (window.pfTelemetry && window.pfTelemetry.recent() || []).map((r) => `${r.source} ${r.message}`); } catch { return []; }
});

test.describe("NEW-3 — an assembly with a deleted sibling is reported, never re-laid", () => {
  test("the trailer row does NOT jump 135 ft onto the dock wall when its truck court is gone", async ({ page }) => {
    await open(page, FIX.els.filter((e) => e.id !== COURT));

    const across = await acrossOnCanvas(page, HOST, TRAILER);
    expect(across).not.toBeNull();
    expect(across).toBeGreaterThan(RIGHT_ACROSS - 5);   // still where the user left it…
    expect(Math.abs(across - FLUSH_ACROSS)).toBeGreaterThan(100); // …and nowhere near the dock wall

    // …and the heal did not "tidy" the one record of what is missing.
    const stored = await storedEl(page, TRAILER);
    expect(stored.forCourt).toBe(COURT);
    expect(stored.prevZone).toBe(COURT);
    expect(Math.round(stored.cy)).toBe(-1233);
  });

  test("it is LOUD — the refusal is reported, and never as a successful heal", async ({ page }) => {
    await open(page, FIX.els.filter((e) => e.id !== COURT));
    await expect.poll(() => telemetry(page).then((t) => t.filter((l) => /assembly-tear-unhealable/.test(l)).length),
      { timeout: 15_000 }).toBeGreaterThan(0);
    const lines = await telemetry(page);
    expect(lines.some((l) => /assembly-tear-healed/.test(l) && /sibling/.test(l))).toBe(false);
  });

  test("THE CONTROL — with the truck court present, nothing is reported and nothing moves", async ({ page }) => {
    await open(page, FIX.els);
    const across = await acrossOnCanvas(page, HOST, TRAILER);
    expect(Math.abs(across - RIGHT_ACROSS)).toBeLessThan(5);
    const lines = await telemetry(page);
    expect(lines.some((l) => /assembly-tear-unhealable/.test(l))).toBe(false);
    // …and the court is where a truck court belongs: between the building and the trailer row.
    const courtAcross = await acrossOnCanvas(page, HOST, COURT);
    expect(courtAcross).toBeGreaterThan(310);
    expect(courtAcross).toBeLessThan(RIGHT_ACROSS);
  });
});
