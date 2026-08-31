/* NEW-1 — A KEYSTROKE TYPED INTO AN INSPECTOR FIELD MAY NEVER DELETE THE PLAN.
 *
 * The owner, on FM 359 / "Concept A": *"I think I had pressed backspace or something in the text
 * box and ended up deleting my building. That was really weird."* Reproduced on his real rows
 * (ui-audit/diagnose-key-scope-paths.mjs, fixture ui-audit/fixtures/fm359-concept-a.json): SEVEN of
 * eight ordinary ways out of the Depth field armed the next Backspace to delete Building 1 and the
 * eight elements bonded to it. The old guard covered exactly one state — the field literally
 * holding focus — and every ordinary exit from it (Enter, Escape, Tab, the ▲ stepper) left focus on
 * `<body>` or on a `<button>`, neither of which it looked at.
 *
 * test/keyContract.test.js proves the RULE. This proves the WIRING, in a real browser, logged out
 * on a seeded-blank site — because the defect lives in the gap between what `document.activeElement`
 * says and what the user is doing, and no source reading can see that gap.
 *
 * ⛔ THE CONTROLS ARE HALF THE SPEC AND MUST NOT BE DROPPED. A guard of this shape fails in TWO
 * directions, and the second one is the expensive one: the first cut of this fix made Delete dead
 * on the canvas (a stale focused toolbar button read as "the panel owns the keyboard"), and a
 * second cut broke deleting after any panel click at all. So every refusal case here is paired
 * with a case that must still delete.
 *
 * Proven RED on the pre-fix build: the four refusal cases each lost the building.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

const readModel = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  const els = site.els || [];
  return { total: els.length, buildings: els.filter((e) => e.type === "building" && !e.attachedTo).length };
});
const buildings = (page) => readModel(page).then((m) => m.buildings);

async function boot(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  await expect(canvas(page)).toBeVisible({ timeout: 15_000 });
}

/** Draw a building, leave it selected, and open its Properties inspector. */
async function buildingWithProps(page) {
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const box = await canvas(page).boundingBox();
  const x0 = box.x + box.width * 0.28, y0 = box.y + box.height * 0.32;
  const x1 = box.x + box.width * 0.62, y1 = box.y + box.height * 0.56;
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => buildings(page)).toBe(1);
  const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  await page.mouse.click(centre.x, centre.y);
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /^Properties$/ }).first().click();
  await page.waitForTimeout(350);
  return centre;
}

/** The inspector's Depth (ft) number input — the field the owner was editing. */
async function depthField(page) {
  const h = await page.evaluateHandle(() => {
    for (const row of document.querySelectorAll("div")) {
      const label = row.firstElementChild;
      if (label && label.tagName === "SPAN" && (label.textContent || "").trim() === "Depth (ft)") {
        const input = row.querySelector("input");
        if (input) return input;
      }
    }
    return null;
  });
  const el = h.asElement();
  expect(el, "the ELEMENT · BUILDING inspector has no Depth (ft) input").not.toBeNull();
  return el;
}

test.describe("a key typed in an inspector field never reaches the plan (logged out)", () => {
  /* ── THE FOUR REFUSALS. Each was measured deleting the owner's building. ────────────────────── */
  const REFUSALS = [
    ["Enter commits the field", async (p, d) => { await d.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("400"); await p.keyboard.press("Enter"); }],
    ["Escape abandons the field", async (p, d) => { await d.click(); await p.keyboard.press("Control+A"); await p.keyboard.type("400"); await p.keyboard.press("Escape"); }],
    ["Tab moves onto the stepper", async (p, d) => { await d.click(); await p.keyboard.press("Tab"); }],
    ["the ▲ stepper is clicked", async (p) => { await p.locator('button[aria-label="Increase"]').first().click(); }],
  ];

  for (const [name, leave] of REFUSALS) {
    test(`Backspace after ${name} does NOT delete the building`, async ({ page }) => {
      const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
      await boot(page);
      const d = await depthField(page, await buildingWithProps(page));
      await leave(page, d);
      await page.waitForTimeout(250);

      await page.keyboard.press("Backspace");
      await page.waitForTimeout(500);
      expect(await buildings(page), "the building was deleted by a keystroke meant for the field").toBe(1);

      // Delete is the same key by another name, and a MacBook's "delete" IS Backspace.
      await page.keyboard.press("Delete");
      await page.waitForTimeout(500);
      expect(await buildings(page)).toBe(1);
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("the arrow nudge is refused too — it silently resized the building from <body>", async ({ page }) => {
    await boot(page);
    const d = await depthField(page, await buildingWithProps(page));
    await d.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("400");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      const b = (s.els || []).find((e) => e.type === "building" && !e.attachedTo);
      return { cx: b.cx, cy: b.cy };
    });
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      const b = (s.els || []).find((e) => e.type === "building" && !e.attachedTo);
      return { cx: b.cx, cy: b.cy };
    });
    expect(after, "an arrow key meant for the number nudged the building").toEqual(before);
  });

  /* ── AND ENTER LEAVES YOU WHERE YOU WERE. The `blur()` it used to do is the ROOT of the data
   * loss (focus → <body>, building still selected, next Backspace fatal) and is half of "it's not
   * letting me input the depth" on its own. ─────────────────────────────────────────────────── */
  test("Enter commits the value IN PLACE and keeps the caret in the field", async ({ page }) => {
    await boot(page);
    const d = await depthField(page, await buildingWithProps(page));
    await d.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("400");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);

    expect(await page.evaluate(() => document.activeElement.tagName), "Enter threw the user out of the field").toBe("INPUT");
    expect(await d.inputValue()).toBe("400");
    // The value is selected, so the next digits retype it rather than appending to it.
    await page.keyboard.type("350");
    expect(await d.inputValue()).toBe("350");
  });

  /* ── THE CONTROLS. Every one of these must still delete. ───────────────────────────────────── */
  test("CONTROL: Delete still works after clicking the drawing", async ({ page }) => {
    await boot(page);
    const centre = await buildingWithProps(page);
    await page.mouse.click(centre.x, centre.y);   // back to the drawing
    await page.waitForTimeout(250);
    await page.keyboard.press("Delete");
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("CONTROL: Delete still works after ordinary panel chrome that is not a value row", async ({ page }) => {
    await boot(page);
    await buildingWithProps(page);
    /* The Dock zones ＋ — an ordinary panel control that is not a value row. This is the exact flow
     * the second, over-broad cut of the fix broke, and it is a flow this repo already tests
     * (e2e/delete-unconditional.spec.js "a building takes its whole bonded assembly with it"). */
    await page.getByText("Dock zones", { exact: true }).first().locator("xpath=..").getByRole("button").last().click();
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");   // close the inspector; the building stays selected
    await page.keyboard.press("Delete");
    await expect.poll(() => buildings(page)).toBe(0);
  });

  test("CONTROL: a tool letter still arms after a toolbar click — the guard is about mutation", async ({ page }) => {
    await boot(page);
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    await page.keyboard.press("Shift+P");   // markup-polygon tool, from chrome scope
    const box = await canvas(page).boundingBox();
    for (const [fx, fy] of [[0.3, 0.3], [0.5, 0.3], [0.45, 0.5]]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(120);
    }
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => {
      const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = map[Object.keys(map)[0]] || {};
      return (s.markups || []).filter((m) => m.kind === "polygon").length;
    })).toBe(1);
  });

  /* ── AND WHEN IT IS REFUSED, IT SAYS SO. A silent refusal is the old silence by another name. ─ */
  test("a refused Delete explains where the keystroke went", async ({ page }) => {
    await boot(page);
    const d = await depthField(page, await buildingWithProps(page));
    await d.click();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Delete");
    await expect(page.getByText(/keyboard is still on the panel|Delete went to the box/i).first())
      .toBeVisible({ timeout: 6000 });
  });
});
