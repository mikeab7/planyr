/* B920 / B921 / B922 — reaching markups you can click, and the honesty cues for locked ones.
 *
 * The owner's report: on a real plan a big INVISIBLE (fillOpacity:0) polygon sat over the roads and
 * swallowed every click across its whole interior, so the roads under it were unreachable; the shape
 * was also locked, so all he got was the four-arrow move cursor and nothing happened, and "Send to
 * Back" was powerless (it's a hit-AREA problem, not paint order). These logged-out specs drive the
 * REAL SVG canvas against a seeded-blank site and pin the three fixes:
 *   • B920 — an UNFILLED closed markup no longer grabs its interior; a click falls THROUGH to what's
 *            under it, and the markup is still reachable near its stroke.
 *   • B921 — repeat-clicking a spot where two markups overlap CYCLES the selection between them.
 *   • B922 — a LOCKED markup shows an honest "unlock to move/reshape" hint, a 🔒 cue, and a non-move
 *            cursor instead of the lying four-arrow move cursor.
 * The selected markup renders data-testid="markup-selected" (carrying data-mk-id / data-mk-kind /
 * data-mk-locked) only while a markup is selected in Select mode. */
import { test, expect } from "@playwright/test";

const canvas = (p) => p.getByTestId("planner-canvas");
const selectedMk = (p) => p.getByTestId("markup-selected");
const panel = (p) => p.getByTestId("property-panel");

function siteField(page, key) {
  return page.evaluate((k) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site[k] || []).length;
  }, key);
}
const markupCount = (p) => siteField(p, "markups");
const buildingElCount = (p) => p.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.type === "building").length;
});

async function startBlank(page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Start blank/i }).click();
  await expect(canvas(page)).toBeVisible();
}

// Drag a markup rectangle (unfilled by default — MK_DEFAULT fillOpacity 0). Snap defaults OFF, so the
// rect's edges land exactly at the drag coordinates. Returns handy client-px points.
async function drawMkRect(page, x1, y1, x2, y2) {
  const before = await markupCount(page);
  await page.getByRole("button", { name: /Rectangle/ }).first().click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 30, y1 + 20, { steps: 4 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => markupCount(page)).toBe(before + 1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2), topX: Math.round((x1 + x2) / 2), topY: Math.min(y1, y2) };
}

async function drawBuilding(page, x1, y1, x2, y2) {
  const before = await buildingElCount(page);
  await page.getByRole("button", { name: "Building", exact: true }).click();
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 60, y1 + 40, { steps: 5 });
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => buildingElCount(page)).toBe(before + 1);
  return { cx: Math.round((x1 + x2) / 2), cy: Math.round((y1 + y2) / 2) };
}

test.describe("markup reachability + locked honesty (logged out)", () => {
  test("B920 — an unfilled markup no longer swallows interior clicks; a covered element is reachable through it", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // A filled building — the thing that used to be unreachable under the invisible shape.
    const b = await drawBuilding(page, box.x + 330, box.y + 250, box.x + 520, box.y + 390);
    await page.keyboard.press("Escape");

    // A big UNFILLED markup rectangle laid OVER the building (exactly the reported repro).
    await drawMkRect(page, box.x + 280, box.y + 220, box.x + 560, box.y + 430);
    await page.mouse.click(box.x + 120, box.y + 120); // deselect the freshly-drawn markup
    await expect(selectedMk(page)).toHaveCount(0);

    // THE FIX: clicking the building's centre (inside the invisible markup) must NOT grab the markup…
    await page.mouse.click(b.cx, b.cy);
    await expect(selectedMk(page)).toHaveCount(0);

    // …and the click reached the BUILDING under it — a double-click there opens the ELEMENT properties.
    await page.waitForTimeout(450); // clear the tap history so the next two presses pair as a double-tap
    await page.mouse.move(b.cx, b.cy);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByRole("button", { name: /Delete element/i })).toBeVisible();

    // The markup itself is still reachable — by clicking near its (invisible) stroke.
    await page.locator('button[aria-label="Close properties"]').click().catch(() => {});
    await page.keyboard.press("Escape");
    await page.mouse.click(box.x + 420, box.y + 220); // on the markup's top edge
    await expect(selectedMk(page)).toBeVisible();
    await expect(selectedMk(page)).toHaveAttribute("data-mk-kind", "rect");

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("B921 — repeat-clicking overlapping markups cycles the selection between them", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    // Two rectangles whose TOP edges both run along y and overlap in x — a click on the shared stroke
    // lands on BOTH, so the stack has two members to cycle through.
    await drawMkRect(page, box.x + 250, box.y + 260, box.x + 450, box.y + 410); // A
    await drawMkRect(page, box.x + 380, box.y + 260, box.x + 580, box.y + 410); // B
    expect(await markupCount(page)).toBe(2);

    await page.mouse.click(box.x + 120, box.y + 120); // deselect
    await expect(selectedMk(page)).toHaveCount(0);

    const px = box.x + 415, py = box.y + 260; // on both top edges (x∈[380,450], y=260)
    await page.mouse.click(px, py);
    await expect(selectedMk(page)).toBeVisible();
    const first = await selectedMk(page).getAttribute("data-mk-id");

    // A repeat click at the SAME spot (spaced past the double-tap window so it's a fresh pick, not a
    // double-click-to-Properties) cycles to the OTHER markup underneath.
    await page.waitForTimeout(450);
    await page.mouse.click(px, py);
    await expect(selectedMk(page)).toBeVisible();
    await expect.poll(() => selectedMk(page).getAttribute("data-mk-id")).not.toBe(first);

    // Once more → wraps back to the first (a true cycle, never a dead end).
    await page.waitForTimeout(450);
    await page.mouse.click(px, py);
    await expect.poll(() => selectedMk(page).getAttribute("data-mk-id")).toBe(first);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("B922 — a locked markup shows an honest hint + 🔒 cue + a non-move cursor", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await startBlank(page);
    const box = await canvas(page).boundingBox();

    await drawMkRect(page, box.x + 300, box.y + 250, box.x + 520, box.y + 420); // auto-selected

    // Open the selected markup's inspector via the docked Properties tab (robust — no double-tap timing).
    await page.getByRole("button", { name: "Properties", exact: true }).click();
    await expect(panel(page)).toBeVisible();
    // Unlocked: the normal reshape instruction shows, the honest lock line does not.
    await expect(panel(page).getByText(/Locked —/)).toHaveCount(0);

    // Lock it. The reshape hint must switch to the honest "unlock to move/reshape" line…
    await panel(page).getByRole("button", { name: /Lock/ }).click();
    await expect(panel(page).getByText(/Locked —/)).toBeVisible();
    // …a 🔒 cue appears on the canvas…
    await expect(canvas(page).getByText("🔒")).toBeVisible();
    await expect(selectedMk(page)).toHaveAttribute("data-mk-locked", "1");
    // …and the shape's cursor is no longer the four-arrow "move".
    const lockedCursor = await page.evaluate(() => {
      const wrap = document.querySelector('[data-testid="markup-selected"]');
      const g = wrap && wrap.querySelector("g");
      return g ? getComputedStyle(g).cursor : null;
    });
    expect(lockedCursor).not.toBe("move");

    // Unlock → the honest hint goes away (reshape instructions return).
    await panel(page).getByRole("button", { name: /Unlock/ }).click();
    await expect(panel(page).getByText(/Locked —/)).toHaveCount(0);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
