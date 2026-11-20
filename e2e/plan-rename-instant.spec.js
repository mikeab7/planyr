/* NEW-1 (B2671215, owner 2026-11-10) — renaming a plan (a "concept") shows the new name on the SAME FRAME Enter is pressed.
 *
 * "I renamed it and it took a second for it to go into effect. When I hit enter, it should immediately change the name."
 *
 * HOW THE OLD BUG HID. `names-matrix` asserts every display shows the new name — but through Playwright's auto-retrying `expect`, which
 * waits up to ten seconds, so a name that arrives a second or two late (or a render later) passes. THIS SPEC DOES NOT WAIT: a capture-phase
 * listener notes the Enter keydown, and the next animation frame (the first paint after it) snapshots the crumb, the plan menu's current
 * row and the list row. The name has to be there by then. The cause, measured: `saveSite` announced a project-name / status / role change
 * on the app's "list moved" channel but not a plan's own `name`, so the names store kept serving its cached old name (the crumb and the
 * current row) until its 2 s cache expired AND something else re-rendered the planner — 9 s and counting on the owner's Quiddity plan.
 *
 * Logged out, throwaway seeded data only. The cloud half does not exist signed out, which is the point: the display may not depend on it.
 * The signed-in case (cloud write held, failure told in words) is the live check, ui-audit/verify-rename-instant-live.mjs.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/plan-rename-instant.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function seed(page) {
  await armPlannerHooks(page);
  await page.addInitScript(() => {
    if (localStorage.getItem("__seeded")) return;
    localStorage.setItem("__seeded", "1");
    const mk = (id, name) => ({ id, groupId: "g1", site: "Rename Test Site", name, origin: null, county: "harris",
      parcels: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: 1785500000000,
      els: [{ id: "b" + id, type: "building", cx: 0, cy: 0, w: 900, h: 300, rot: 0, dock: "cross", dockSide: "bottom", dockAxis: "x" }] });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ g1: mk("g1", "Concept A - Quiddity"), p2: mk("p2", "Concept B - Quiddity DIA") }));
    localStorage.setItem("planarfit:currentSite:v1", "g1");
  });
  await page.goto("/#/project/g1/site", { waitUntil: "domcontentloaded" });
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
}
const openMenu = async (page) => {
  if (!(await page.getByTestId("plan-footer").isVisible().catch(() => false))) await page.getByTestId("plan-crumb").click();
  await expect(page.getByTestId("plan-footer")).toBeVisible();
};
const stored = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return Object.fromEntries(Object.values(map).map((s) => [s.id, s.name]));
});

/* Arm the first-paint snapshot: on the NEXT Enter keydown or blur-commit trigger (`arm(kind)`), the next animation frame reads what is on screen. */
async function armFrameProbe(page) {
  await page.evaluate(() => {
    window.__frame = null;
    const snap = () => requestAnimationFrame(() => {
      const t = (id) => (document.querySelector(`[data-testid="${id}"]`) || {}).textContent || null;
      window.__frame = { crumb: t("plan-crumb"), current: t("plan-current-row"), p2: t("plan-open-p2"), input: !!document.querySelector('[data-testid="plan-rename-input"]') };
    });
    window.__armFrame = () => { window.__frame = null; snap(); };
    window.addEventListener("keydown", (e) => { if (e.key === "Enter" && !window.__frame) window.__armFrame(); }, true);
    // a click-away commits through the editor's blur — the same first-paint question
    document.addEventListener("focusout", (e) => { if (e.target && e.target.getAttribute && e.target.getAttribute("data-testid") === "plan-rename-input" && !window.__frame) window.__armFrame(); }, true);
  });
}
const frame = (page) => page.waitForFunction(() => window.__frame, null, { timeout: 5_000 }).then(() => page.evaluate(() => window.__frame));

test.describe("a plan rename is on screen by the first frame after Enter", () => {
  test("the CURRENT plan (double-click its row): the crumb and the current row both read the new name at the next paint", async ({ page }) => {
    await seed(page); await openMenu(page); await armFrameProbe(page);
    await page.getByTestId("plan-current-name").dblclick();
    const input = page.getByTestId("plan-rename-input");
    await input.fill("Renamed One");
    await input.press("Enter");
    const f = await frame(page);
    expect(f.input, "the editor closed").toBe(false);
    expect(f.crumb, "the breadcrumb").toContain("Renamed One");     // red on the pre-fix source: still "Concept A - Quiddity"
    expect(f.current, "the menu's current row").toContain("Renamed One");
    expect(await stored(page)).toMatchObject({ g1: "Renamed One", p2: "Concept B - Quiddity DIA" });
  });

  test("ANOTHER plan (its ⋯ ▸ Rename): its list row reads the new name at the next paint and the current plan is untouched", async ({ page }) => {
    await seed(page); await openMenu(page); await armFrameProbe(page);
    await page.getByTestId("plan-more-p2").click();
    await page.getByTestId("plan-ctx-rename").click();
    const input = page.getByTestId("plan-rename-input");
    await input.fill("Alt layout");
    await input.press("Enter");
    const f = await frame(page);
    expect(f.p2).toContain("Alt layout");
    expect(f.crumb).toContain("Concept A - Quiddity");
    expect(await stored(page)).toMatchObject({ g1: "Concept A - Quiddity", p2: "Alt layout" });
  });

  test("clicking away (blur) commits just as fast; Escape cancels and nothing changes", async ({ page }) => {
    await seed(page); await openMenu(page);
    await armFrameProbe(page);
    await page.getByTestId("plan-current-name").dblclick();
    await page.getByTestId("plan-rename-input").fill("Renamed by blur");
    await page.getByTestId("plan-footer").click({ position: { x: 4, y: 4 } });
    const f = await frame(page);
    expect(f.crumb).toContain("Renamed by blur");
    expect(f.current).toContain("Renamed by blur");

    // Escape: the old (now "Renamed by blur") name stays everywhere and storage is untouched
    await page.getByTestId("plan-current-name").dblclick();
    await page.getByTestId("plan-rename-input").fill("Should not stick");
    await page.getByTestId("plan-rename-input").press("Escape");
    await expect(page.getByTestId("plan-rename-input")).toHaveCount(0);
    await expect(page.getByTestId("plan-crumb")).toContainText("Renamed by blur");
    await expect(page.getByTestId("plan-crumb")).not.toContainText("Should not stick");
    expect(await stored(page)).toMatchObject({ g1: "Renamed by blur" });
  });

  test("it really saved: after a reload the new name is on the crumb and in storage", async ({ page }) => {
    await seed(page); await openMenu(page);
    await page.getByTestId("plan-current-name").dblclick();
    const input = page.getByTestId("plan-rename-input");
    await input.fill("Survives reload");
    await input.press("Enter");
    await expect(page.getByTestId("plan-crumb")).toContainText("Survives reload");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("plan-crumb")).toContainText("Survives reload");
    expect(await stored(page)).toMatchObject({ g1: "Survives reload" });
  });

  test("an autosave that lands just after the rename does not bring the OLD name back (storage AND screen, after the 50 ms / 400 ms save windows)", async ({ page }) => {
    // Rename as fast as a person can after the plan opens, so the planner's own autosave is still in flight. Before the fix the planner's
    // autosave wrote its render-time copy of the plan name back over the new one in 3 of 8 runs (the crumb then honestly showed "Concept A" again).
    await seed(page);
    await page.getByTestId("plan-crumb").click();
    await page.getByTestId("plan-current-name").dblclick();
    const input = page.getByTestId("plan-rename-input");
    await input.fill("Scheme Z");
    await input.press("Enter");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    expect(await stored(page)).toMatchObject({ g1: "Scheme Z", p2: "Concept B - Quiddity DIA" });
    await expect(page.getByTestId("plan-crumb")).toContainText("Scheme Z");
  });

  test("a device that REFUSES the write leaves the old name on screen and says so in words — never a new name that was not saved", async ({ page }) => {
    await seed(page); await openMenu(page);
    // from here on the device refuses every plan write (a full / blocked store); reads still work
    await page.evaluate(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith("planarfit:sites")) throw new DOMException("quota", "QuotaExceededError"); return real.call(this, k, v); };
    });
    await page.getByTestId("plan-current-name").dblclick();
    const input = page.getByTestId("plan-rename-input");
    await input.fill("Not saved");
    await input.press("Enter");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("plan-crumb")).toContainText("Concept A - Quiddity");
    await expect(page.getByTestId("plan-crumb")).not.toContainText("Not saved");
    await expect(page.getByText(/Couldn.t save the plan rename.*nothing was changed/i).first()).toBeVisible({ timeout: 10_000 });
  });
});
