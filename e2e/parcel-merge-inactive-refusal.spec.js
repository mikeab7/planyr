/* B966626 — MERGING A PARCEL THAT IS EXCLUDED FROM YIELD TOTALS (`active:false`) USED TO BE A
 * SILENT NO-OP. Read `/CLAUDE.md` LOUD-FAILURE before touching this.
 *
 * Owner report (Bain, 2026-08-31): "it's also not letting me merge the smaller interior parcel on
 * bain to the larger parcel." The strongest lead going in — locked parcels never merge — is
 * REFUTED by reading `mergeParcels`/`mergeRings`: neither checks `locked` at all. Read against the
 * source, the real cause is `toggleMerge`'s inactive-parcel guard (`if (pc && pc.active === false)
 * return s;`), which is a BARE no-op: clicking an inactive parcel while merge-picking did nothing
 * at all — no highlight, no message. Verified against the real production geometry (site
 * `smthnjl2cxyg`, parcels `e1455089gmiinz`/`e1455090gmiinz`): `mergeRings` reunites them into
 * exactly 94.47 ac when both are active, so the geometry was never the obstacle.
 *
 * This drives the real merge-pick flow, logged out, on a seeded two-parcel plan (no account, no
 * external GIS) with the SECOND parcel pre-set `active:false` — the exact shape of his report —
 * and asserts: picking the inactive parcel is REFUSED LOUDLY (a red "⚠ …" toast naming why, never
 * silence), it never joins the pick set, and once it's turned back on the same click lets the
 * merge complete and conserves area.
 */
import { test, expect } from "@playwright/test";

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');
const warnToast = (page) => page.locator("text=/excluded from yield totals/i");

const RECT_A = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const RECT_B = [{ x: 200, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 100 }, { x: 200, y: 100 }];

function twoParcelSite(id) {
  return {
    id, groupId: id, site: "Merge Test", name: "Concept A",
    origin: null, county: null,
    parcels: [
      { id: "pA", points: RECT_A, active: true, locked: true },
      { id: "pB", points: RECT_B, active: false, locked: true }, // the "smaller interior" parcel, excluded
    ],
    els: [], measures: [], callouts: [], markups: [],
    settings: {}, updatedAt: Date.now(),
  };
}

async function open(page, id, rec) {
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  await page.addInitScript(([sid, r]) => {
    if (localStorage.getItem("e2e:seeded:" + sid)) return;
    localStorage.setItem("e2e:seeded:" + sid, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: r }));
    localStorage.setItem("planarfit:currentSite:v1", sid);
  }, [id, rec]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await page.locator('[data-rail-tab="parcel"]').click();
  await expect(page.getByTestId("parcel-row-pA")).toBeVisible({ timeout: 20_000 });
}

const readParcels = (page, id) => page.evaluate((sid) => {
  const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  return all[sid]?.parcels || [];
}, id);

test.describe("Merge-picking an inactive parcel refuses loudly, never silently (B966626)", () => {
  test("clicking the excluded parcel warns and never joins the pick; re-activating it lets the merge go through", async ({ page }) => {
    const ID = "e2eMergeInactive";
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await open(page, ID, twoParcelSite(ID));

    await expect(page.getByTestId("parcel-row-pB")).toContainText("· inactive");

    // Enter merge-pick mode.
    await page.getByRole("button", { name: /⧉ Merge/ }).click();

    // Click the EXCLUDED parcel — must warn, never silently do nothing.
    await page.getByTestId("parcel-row-pB").click();
    await expect(warnToast(page)).toBeVisible();
    await expect(warnToast(page)).toContainText(/can't be picked to merge/i);
    // The warning renders as a REFUSAL (red), not a success pill — the app's own convention for
    // telling the two apart is a leading/embedded "⚠".
    await expect(warnToast(page)).toContainText("⚠");
    // It must not have joined the pick set: no "✓" suffix, no blue highlight border.
    await expect(page.getByTestId("parcel-row-pB")).not.toContainText("✓");

    // Pick the ACTIVE parcel — this must work normally.
    await page.getByTestId("parcel-row-pA").click();
    await expect(page.getByTestId("parcel-row-pA")).toContainText("✓");

    // With only one real pick, the Merge confirm stays disabled — no silent partial merge.
    const mergeBtn = page.getByRole("button", { name: /Merge parcels ⏎/i });
    await expect(mergeBtn).toBeDisabled();

    // Turn the excluded parcel back on (the fix's actionable path: the message told him where).
    await page.getByTestId("parcel-row-active-pB").check();
    await expect(page.getByTestId("parcel-row-pB")).not.toContainText("· inactive");

    // Now picking it succeeds and joins the set.
    await page.getByTestId("parcel-row-pB").click();
    await expect(page.getByTestId("parcel-row-pB")).toContainText("✓");
    await expect(mergeBtn).toBeEnabled();

    await mergeBtn.click();

    // One merged parcel, area conserved (200×100 + 200×100 = 40,000 sf), no error toast left over.
    await expect.poll(async () => (await readParcels(page, ID)).length).toBe(1);
    const merged = (await readParcels(page, ID))[0];
    const area = Math.abs(merged.points.reduce((s, p, i, arr) => {
      const q = arr[(i + 1) % arr.length];
      return s + (p.x * q.y - q.x * p.y);
    }, 0) / 2);
    expect(area).toBeCloseTo(40000, 0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
