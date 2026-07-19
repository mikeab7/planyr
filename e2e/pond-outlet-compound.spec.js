/* B903 — MULTI-STAGE OUTLET + ALL-STORMS-AT-ONCE Post ≤ Pre. Today's one-click auto-size
 * (B902/#710) sized a SINGLE floor orifice to one governing storm and left it there — a real
 * detention pond needs a COMPOUND (stacked) outlet, and Post ≤ Pre must hold at EVERY required
 * return period simultaneously, not just the one the orifice happened to be sized against. A
 * single small orifice can pass a small, frequent storm while silently OVERTOPPING a larger,
 * rarer one — confirmed as a real (now-fixed) bug in lib/pondRouting.js's routing math: the
 * clamped routed peak could compare ≤ the allowable even while the basin was actively
 * overtopping, reading PASS when it should read FAIL.
 *
 * This spec drives the real app LOGGED OUT (no account) on a seeded-blank site — the compound-
 * outlet solve needs zero auth or live GIS data, just a drawn pond + a drainage area:
 *   (a) "⚡ Auto-size detention" produces a genuine multi-stage outlet (an editable stage LIST,
 *       not the old fixed "primary + one weir" pair) with an emergency spillway always present.
 *   (b) The per-storm table shows an ALLOWABLE/ROUTED/PEAK WSE/STORAGE/PASS-FAIL row for EVERY
 *       required storm, plus a prominent Overall — Post ≤ Pre PASS/FAIL banner that can never
 *       read PASS while any individual storm's row does not.
 *   (c) A genuinely infeasible pond (tiny footprint, enormous drainage area) reports an honest
 *       overall FAIL with a specific reason — never a silently fabricated pass.
 *   (d) Stages can be added and removed by hand (the compound structure is a real editable
 *       list, not a fixed two-slot UI). */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

async function drawAndOpenPond(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Detention Pond", exact: true }).click();
  const x1 = box.x + 320, y1 = box.y + 250, x2 = box.x + 560, y2 = box.y + 420;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
  const cx = Math.round((x1 + x2) / 2), cy = Math.round((y1 + y2) / 2);
  await page.mouse.dblclick(cx, cy);
}

const fieldInput = (page, labelText) =>
  page.getByText(labelText, { exact: true }).first().locator("xpath=ancestor::div[1]").locator("input").first();

async function fillField(page, labelText, value) {
  const input = fieldInput(page, labelText);
  await input.scrollIntoViewIfNeeded();
  await input.fill(String(value));
  await input.press("Tab");
}

async function anchorAndSize(page, drainageAcres, impervPct = null) {
  await drawAndOpenPond(page);
  await fillField(page, "Top-of-bank elev. (ft)", 100);
  await fillField(page, "Drainage area (ac)", drainageAcres);
  if (impervPct != null) await fillField(page, "Impervious %", impervPct);
}

test.describe("Compound outlet + all-storms-at-once Post ≤ Pre (B903)", () => {
  test("(a) Auto-size produces a genuine multi-stage outlet with an emergency spillway", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await anchorAndSize(page, 12);

    const autosizeBtn = page.getByRole("button", { name: /Auto-size detention/i });
    await autosizeBtn.scrollIntoViewIfNeeded();
    await autosizeBtn.click();

    // At least the low-flow orifice + the always-present emergency spillway.
    await expect(page.getByText("Low-flow orifice", { exact: false })).toBeVisible();
    await expect(page.getByText("Emergency spillway", { exact: false })).toBeVisible();
    await expect(page.getByText(/outlet stage/i)).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(b) the per-storm table has ALLOWABLE/ROUTED/WSE/STORAGE columns and an overall verdict that can't hide a bad storm", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await anchorAndSize(page, 12);
    await page.getByRole("button", { name: /Auto-size detention/i }).click();

    await expect(page.getByText("ALLOWABLE", { exact: true })).toBeVisible();
    await expect(page.getByText("ROUTED", { exact: true })).toBeVisible();
    await expect(page.getByText("PEAK WSE", { exact: true })).toBeVisible();
    await expect(page.getByText("STORAGE", { exact: true })).toBeVisible();

    const overallBadge = page.getByText(/PASS — every storm|FAIL/).first();
    await expect(overallBadge).toBeVisible();
    const overallText = await overallBadge.textContent();

    const rowChips = await page.getByText(/^(PASS|SHORT|OVERTOPS)$/).allTextContents();
    expect(rowChips.length).toBeGreaterThan(0);
    if (overallText.includes("PASS — every storm")) {
      // Every individual storm must also read PASS — no partial hiding.
      expect(rowChips.every((t) => t === "PASS")).toBe(true);
    } else {
      // FAIL means at least one storm did NOT pass.
      expect(rowChips.some((t) => t !== "PASS")).toBe(true);
      // ...and the honest per-storm explanation names it.
      await expect(page.getByText(/is short by|overtops the basin/).first()).toBeVisible();
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(c) a genuinely infeasible pond reports an honest overall FAIL, never a fabricated pass", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    // A real drainage area (not a blank/undeveloped one — with 0% impervious, Post ≤ Pre is
    // trivially satisfied regardless of watershed size, since there's no added runoff to
    // detain) against a pond this small — no outlet sizing can make this pass.
    await anchorAndSize(page, 400, 90);
    await page.getByRole("button", { name: /Auto-size detention/i }).click();

    await expect(page.getByText("FAIL", { exact: true })).toBeVisible();
    await expect(page.getByText(/is short by|overtops the basin/).first()).toBeVisible();
    await expect(page.getByText(/Auto-size above, or deepen/i).first()).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("(d) outlet stages can be added and removed by hand", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await anchorAndSize(page, 12);
    await page.getByRole("button", { name: /Auto-size detention/i }).click();

    const stageCountText = async () => {
      const t = await page.getByText(/outlet stage/i).textContent();
      return parseInt(t, 10);
    };
    const before = await stageCountText();

    await page.getByRole("button", { name: "+ Add orifice", exact: true }).click();
    await expect.poll(stageCountText).toBe(before + 1);

    await page.getByRole("button", { name: "× Remove", exact: true }).first().click();
    await expect.poll(stageCountText).toBe(before);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
