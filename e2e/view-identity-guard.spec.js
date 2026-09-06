/* NEW-1 (site-route render-loop crash, React error #185 on project arrival) — `setView` must
 * treat a dispatch whose VALUES already match the live view as a no-op, the same way `setSize`/
 * `setRegShift` already do (B1189).
 *
 * THE CONCRETE CASE THIS CLOSES: a blank (or just-opened) plan's boot-time auto-fit — the 120 ms
 * "reframe when this view becomes active" timer in SitePlanner.jsx — calls `fit()`, whose
 * empty-content branch is `setView({ ppf: 0.35, offX: 60, offY: 60 })`. That is BYTE-FOR-BYTE the
 * component's own initial `useState({ ppf: 0.35, offX: 60, offY: 60 })` value. Before this fix,
 * `setView` handed that plain object straight to `setViewRaw`, so the dispatch allocated a FRESH
 * object holding the SAME numbers — an allocation-only change that still re-renders (React only
 * bails out on reference equality) and re-runs every effect keyed on `view`'s WHOLE-OBJECT
 * identity, chief among them the basemap registration commit — the exact effect B1189 already
 * named as the source of its OWN runaway ("this effect is exactly the one that produced that
 * runaway"), just via a different writer than the one B1189 fixed.
 *
 * `viewIdentityEpoch` is the read-only instrument this spec drives: an E2E-gated counter that
 * increments exactly when `view`'s object identity changes (the same shape as `layerIdentityEpoch`,
 * B385040) — the one thing `get()`'s field values alone can't distinguish, since two
 * identical-valued view objects read the same either way.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const getView = (page) => page.evaluate(() => (window.__plannerView ? window.__plannerView.get() : null));
const centerOn = (page, fx, fy, ppf) => page.evaluate(([fx, fy, ppf]) => window.__plannerView.centerOn(fx, fy, ppf), [fx, fy, ppf]);

async function startBlank(page) {
  await page.goto("/");
  // The app now lands on a Dashboard route first (B1213312/B1213313) — open the Site module
  // before reaching the map's "Start blank" affordance.
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
}

test.describe("setView dispatch guard — a same-valued view must not get a new identity", () => {
  test("a settled blank plan holds a stable view identity (no ambient churn from the boot-fit sequence)", async ({ page }) => {
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(String(e.message || e)));
    page.on("console", (m) => { if (m.type() === "error" && /update depth|React error #185/i.test(m.text())) crashes.push(m.text()); });

    await armPlannerHooks(page);
    await startBlank(page);

    // Well past the 120 ms boot-time reframe timer (a blank plan's fit() lands on exactly the
    // initial {ppf:0.35, offX:60, offY:60} state, so that dispatch carries no new VALUE — see
    // the `centerOn` test below for the mechanism this proves red/green on directly), read the
    // identity twice more, bracketing a window nothing legitimate should touch.
    await page.waitForTimeout(500);
    const a = await getView(page);
    await page.waitForTimeout(500);
    const b = await getView(page);

    expect(a, "window.__plannerView must be armed").toBeTruthy();
    expect(b.identityEpoch, "view kept getting a new identity on a plan nothing is touching").toBe(a.identityEpoch);
    expect(b.ppf).toBe(a.ppf);
    expect(b.offX).toBe(a.offX);
    expect(b.offY).toBe(a.offY);

    expect(crashes, crashes.join("\n")).toEqual([]);
    await expect(canvas(page)).toBeVisible();
  });

  test("centerOn to the SAME point/scale is a no-op; a genuinely different one still applies", async ({ page }) => {
    await armPlannerHooks(page);
    await startBlank(page);
    await page.waitForTimeout(400); // let the boot-time auto-fit settle first

    // Fixed, arbitrary feet point + scale — applied TWICE with byte-identical arguments, so
    // `size.w/2 - fx*ppf` computes to the exact same float both times (no inversion round-trip
    // to introduce noise of its own). The first call is a genuine change; the second must be
    // recognised as a no-op even though it is a freshly-called function producing a fresh object.
    const FX = 137.5, FY = -42.25, PPF = 0.7;
    await centerOn(page, FX, FY, PPF);
    const v1 = await getView(page);
    await centerOn(page, FX, FY, PPF);
    const v2 = await getView(page);
    expect(v2.identityEpoch, "re-centering on the identical point/scale must not re-identity view").toBe(v1.identityEpoch);
    expect(v2.ppf).toBe(v1.ppf);
    expect(v2.offX).toBe(v1.offX);
    expect(v2.offY).toBe(v1.offY);

    // The guard must not swallow a REAL change — a different scale still takes effect and still
    // bumps the identity (proving this isn't a guard that just always refuses to dispatch).
    await centerOn(page, FX, FY, PPF * 2);
    const v3 = await getView(page);
    expect(v3.identityEpoch).toBeGreaterThan(v2.identityEpoch);
    expect(v3.ppf).toBeCloseTo(PPF * 2, 6);
  });
});
