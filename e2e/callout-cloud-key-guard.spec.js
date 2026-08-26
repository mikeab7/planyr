/* NEW-1 — THE CLOUD TOOL ("c") LEAKED THROUGH A FOCUSED TEXT FIELD.
 *
 * Michael's report, reproduced live on the deployed production build: with a callout in edit
 * mode (a real <textarea>, aria-label "Type…", holding focus), typing "abc" left the field
 * holding "ab" — the "c" never arrived, and it armed the Cloud tool in the Draw rail instead.
 *
 * His own discriminating test, run first: with the same textarea focused, typing
 * l r e t q v m h n p x y z landed as plain text and none of them changed the active tool. Only
 * "c" leaked. That ruled out a general "typing guard is broken" theory and a "wrong position in
 * the branch chain" theory (see test/keyContract.test.js's header for both retractions) — nine
 * siblings share the identical `!ctrlKey && !metaKey && !shiftKey` branch shape and all worked.
 *
 * ROOT CAUSE (src/workspaces/site-planner/lib/keyContract.js): every other bare-letter tool
 * shortcut has a KEY_CONTRACT entry, which the shared field-scope guard (`keyScopeVerdict`, fed by
 * `resolveKeyEntry`) checks before any shortcut branch runs — the same arbitration Delete/Backspace
 * and every other canvas shortcut already goes through. "c" (Cloud, B770896) had NO entry, so
 * `resolveKeyEntry` returned null, and `keyScopeVerdict`'s "an undeclared key always falls through"
 * rule — correct for a genuinely unbound key, wrong here — let it bypass the guard even while a
 * text field owned the keyboard. The fix is a one-line declaration (`tool-mcloud`, mod: none,
 * scope: canvas), not a bespoke "is this an input" check bolted beside the Cloud branch, so this
 * class of gap cannot reopen for whichever letter ships next.
 *
 * Unit coverage of the RULE lives in test/keyContract.test.js (proven red pre-fix). This proves
 * the WIRING in a real browser, on the owner's exact repro plus every sibling tool letter.
 */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

/** Place a callout (tip click, then box click) and return the focused text editor. */
async function openCallout(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: /^Callout\s/ }).click();
  await page.mouse.click(box.x + 300, box.y + 460); // tip point
  await page.mouse.click(box.x + 460, box.y + 410); // box point
  const ta = page.getByPlaceholder("Type…");
  await ta.waitFor({ state: "visible", timeout: 8000 });
  await expect(ta).toBeFocused();
  return ta;
}

// Every bare-letter tool shortcut the planner declares (v/h/m/s/q/t/l/r/e/c) — the exact set from
// the owner's discriminating test, plus "c" (the one that leaked).
const TOOL_LETTERS = ["v", "h", "m", "s", "q", "t", "l", "r", "e", "c"];

test.describe("NEW-1 — a bare tool-shortcut letter typed into a focused field is just text", () => {
  test('the owner\'s exact repro: typing "abc" into a real callout leaves the field holding "abc"', async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    const ta = await openCallout(page);
    await page.keyboard.type("abc");
    await expect(ta, 'the "c" was eaten and the Cloud tool armed mid-keystroke').toHaveValue("abc");

    // The Cloud tool must not have armed, and the editor must still be open and focused —
    // arming a tool commits/leaves the callout, which would fail either assertion below.
    const cloudPressed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith("Cloud"));
      return btn ? btn.getAttribute("aria-pressed") : null;
    });
    expect(cloudPressed, "the Cloud tool armed").not.toBe("true");
    await expect(ta).toBeVisible();
    await expect(ta).toBeFocused();

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("every single-letter tool shortcut reaches a focused field untouched and arms nothing", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    const ta = await openCallout(page);
    const pressedBefore = await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent || "").trim()));

    for (const letter of TOOL_LETTERS) await page.keyboard.type(letter);
    await expect(ta, "one of the tool letters was consumed instead of typed").toHaveValue(TOOL_LETTERS.join(""));

    // Still the same open editor, still focused — no tool shortcut fired and stole the gesture.
    await expect(ta).toBeVisible();
    await expect(ta).toBeFocused();

    // The set of armed tool-rail buttons is UNCHANGED by typing every shortcut letter — whatever
    // baseline tool was active (e.g. Select, left armed once the callout was placed) still is.
    const pressedAfter = await page.evaluate(() =>
      [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) => (b.textContent || "").trim()));
    expect(pressedAfter, "a tool-rail button's armed state changed while typing in the field").toEqual(pressedBefore);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Ctrl/Cmd+C still copies the selection, not the bare 'c' path — modified and bare forms don't collide", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);

    // Draw a building, select it, then Ctrl+C from the canvas (not a field) — this must still be
    // Copy, proving the fix (a declared bare-"c" entry) didn't clobber the existing ⌘/Ctrl+C path.
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const box = await canvas(page).boundingBox();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
    await page.mouse.up();
    await page.mouse.click(box.x + 300, box.y + 275);
    await page.waitForTimeout(200);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    await expect.poll(() => page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      return (s.els || []).filter((e) => e.type === "building" && !e.attachedTo).length;
    }), { timeout: 6000 }).toBe(2);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
