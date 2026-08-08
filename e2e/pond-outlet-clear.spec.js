/* B901 — two related pond/detention defects found live while cleaning up after the B900 crash
 * hotfix, both in the "Required detention (screening)" / "RATE CONTROL · POST ≤ PRE" flow:
 *
 * (1) The "Allowable release (cfs)" field could never be CLEARED once set. Typing a value
 *     committed fine, but selecting-all + Delete/Backspace and blurring silently reverted to the
 *     last committed value instead of clearing — root cause: NumInput's commit() treated an
 *     empty draft the same as unparseable garbage (both → revert, never calling onCommit at
 *     all), so a field could never be COMMITTED to null via the keyboard. Fixed with an opt-in
 *     `allowClear` prop: an intentionally-emptied field now commits null (every field that opts
 *     in already null-coalesces its own onCommit — this was purely a missing commit call, not a
 *     missing handler).
 *
 * (2) Removing a proposed outlet appeared to work (the live view updated correctly) but a
 *     SIGNED-IN, cloud-synced session could see the outlet resurrect after a real browser reload
 *     — traced to the element-sync engine's keepalive unload-flush being wired ONLY through the
 *     app's internal forced-reload registry (`registerFlush`/`flushAll()`, which fires only for
 *     chunk-recovery / the ErrorBoundary's own "Reload" button), never a genuine browser
 *     `beforeunload`/tab-close, so a still-debounced per-element update (e.g. the outlet removal)
 *     could miss its last-ditch keepalive commit. Fixed by wiring the same flush directly to
 *     `beforeunload`/`visibilitychange` too, mirroring the whole-doc save's existing pattern.
 *     That half needs a real signed-in account to fully confirm (parked live per B901/V376) —
 *     this spec covers what's reproducible logged out: the LOCAL (non-cloud) persistence path,
 *     which this session confirmed was already correct, as a standing regression guard.
 *
 * Both specs drive the real SVG canvas LOGGED OUT (no account) on a seeded-blank site. */
import { test, expect } from "@playwright/test";
import { drawAnchoredPond, openPondGroup, pondReleaseInput, POND_GROUP } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

let pondCenter = null;

/* Anchor the pond (its "Rim" row — `det.tobElev`) so the RATE CONTROL section, which echoes
 * "Allowable release ≈ N cfs", actually renders; unanchored ponds show only a placeholder. */
async function drawAnchorAndOpenPond(page, opts = {}) {
  pondCenter = await drawAnchoredPond(page, opts);
}

/* Re-open the pond's inspector after a reload, back on the group under test. */
async function reselectPond(page) {
  await canvas(page).waitFor({ state: "visible", timeout: 10000 });
  await page.mouse.dblclick(pondCenter.cx, pondCenter.cy);
  await page.waitForTimeout(300);
  await openPondGroup(page, POND_GROUP.outlet);
}

test.describe("Pond outlet fields — clear + persistence (B901)", () => {
  test("Allowable release (cfs) can be set, then fully CLEARED via select-all + delete", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchorAndOpenPond(page);

    const relInput = pondReleaseInput(page);
    await relInput.scrollIntoViewIfNeeded();
    await relInput.fill("15");
    await relInput.press("Tab");
    await expect(relInput).toHaveValue("15");
    await expect(page.getByText("Allowable release ≈", { exact: false })).toBeVisible();

    // Triple-click selects all in the input; Delete removes it; Tab commits.
    await relInput.click({ clickCount: 3 });
    await page.keyboard.press("Delete");
    await relInput.press("Tab");

    await expect(relInput).toHaveValue("");
    await expect(page.getByText("Allowable release ≈", { exact: false })).toHaveCount(0);

    // A cleared field must accept fresh input cleanly (no leftover-value concatenation).
    await relInput.fill("7");
    await relInput.press("Tab");
    await expect(relInput).toHaveValue("7");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("proposing then removing an outlet, then reloading, shows NO outlet (local persistence)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    await drawAnchorAndOpenPond(page, { drainageAcres: 10 });

    const relInput = pondReleaseInput(page);
    await relInput.fill("15");
    await relInput.press("Tab");

    const proposeBtn = page.getByRole("button", { name: /Propose outlet/i });
    await proposeBtn.scrollIntoViewIfNeeded();
    await proposeBtn.click();
    await expect(page.getByText("Orifice ⌀", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /Clear outlet/i }).click();
    await expect(page.getByText("Orifice ⌀", { exact: false })).toHaveCount(0);
    await expect(proposeBtn).toBeVisible();

    await page.reload({ waitUntil: "load" });
    await reselectPond(page);

    await expect(page.getByText("Orifice ⌀", { exact: false })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Propose outlet/i })).toBeVisible();

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
