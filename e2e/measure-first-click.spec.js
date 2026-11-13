/* NEW-1 (B2671280) — THE FIRST CLICK AFTER CHOOSING A MEASURE TOOL ALWAYS PLACES A POINT. (owner constraint #56)
 *
 * Owner report (Bain plan, 2026-11-13): "start an Area measurement, then switch to Length — the FIRST click on
 * the map does not register, no first vertex is placed." The cause, found by reading the press path: a finished
 * measurement's invisible grab layer was LIVE while a Measure tool was armed and no draft was open
 * (`canGrab = tool === "select" || (tool === "measure" && !measDraft.length)`), and `startMoveMeasure` answered
 * that press by SELECTING the measurement and silently dropping the tool to Select. For an AREA the grab layer is
 * a filled polygon over the whole shape, so a click anywhere INSIDE a finished area — not only on its edge — was
 * eaten; a Length / Polylength grab band is 14 px wide and a Count marker's is 12 px. The press placed nothing.
 *
 * What this asserts, for EVERY existing-measurement mode × EVERY next mode × each place a press can land
 * (open ground · a vertex · an edge · inside an area):
 *   • the press places the first point (the live draft says `data-points="1"`),
 *   • the tool is still Measure (the draft only renders while it is), and nothing got selected,
 *   • plus: an UNFINISHED draft left open when the mode is switched, and a press right after a measurement finishes.
 * The draft element is `data-testid="measure-draft"` (read-only hook; renders only while tool === "measure").
 *
 * Runs LOGGED OUT against a seeded-blank site on the real SVG canvas. Real mouse input (never synthetic events). */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const pill = (p) => p.getByRole("button", { name: /^Measure mode:/ });
const draft = (p) => p.getByTestId("measure-draft");
const selected = (p) => p.getByTestId("measure-selected");
const MODES = ["Length", "Polylength", "Area", "Count"];

function measureCount(page) {
  return page.evaluate(() => {
    const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.measures || []).length;
  });
}
async function start(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
}
/* Choose a mode from the Measure ▾ menu (arms the Measure tool; discards any open draft, as ever). */
async function pick(page, label) {
  await pill(page).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
/* Draw one FINISHED measurement of `mode` through the real tool and wait until it is saved. */
async function drawFinished(page, mode, pts) {
  const before = await measureCount(page);
  await pick(page, mode);
  for (const p of pts) await page.mouse.click(p.x, p.y);
  if (mode === "Area") await page.mouse.click(pts[0].x, pts[0].y); // click the first dot to close
  else if (mode !== "Length") await page.keyboard.press("Enter");
  await expect.poll(() => measureCount(page)).toBe(before + 1);
  await expect(draft(page)).toHaveCount(0);
}
const mid = (a, b) => ({ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) });

/* The one assertion: press at `at`, and a first point exists, still in Measure, nothing selected. */
async function expectFirstPoint(page, at, what) {
  await page.mouse.click(at.x, at.y);
  // SOFT, so one run lists EVERY target that drops the click (the owner asked which of open ground / edge / vertex it is).
  await expect.soft(draft(page), `${what}: the first click placed no point`).toHaveAttribute("data-points", "1", { timeout: 2_000 });
  await expect.soft(selected(page), `${what}: the click selected a measurement instead of placing a point`).toHaveCount(0, { timeout: 2_000 });
}

/* The finished shape each EXISTING mode is drawn as, in canvas-relative terms. */
function shapes(box) {
  const o = { x: box.x + 520, y: box.y + 330 };
  return {
    Length: { pts: [{ x: o.x - 120, y: o.y }, { x: o.x + 120, y: o.y }] },
    Polylength: { pts: [{ x: o.x - 120, y: o.y + 40 }, { x: o.x, y: o.y - 40 }, { x: o.x + 120, y: o.y + 40 }] },
    Area: { pts: [{ x: o.x - 120, y: o.y - 80 }, { x: o.x + 120, y: o.y - 80 }, { x: o.x + 120, y: o.y + 80 }, { x: o.x - 120, y: o.y + 80 }] },
    Count: { pts: [{ x: o.x - 80, y: o.y }, { x: o.x + 80, y: o.y }] },
  };
}

test.describe("NEW-1 (B2671280) — the first click after choosing a measure tool places a point", () => {
  for (const existing of MODES) {
    test(`after a finished ${existing}: every next mode places its first point on open ground, a vertex, an edge${existing === "Area" ? " and inside the area" : ""}`, async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await start(page);
      const box = await canvas(page).boundingBox();
      const sh = shapes(box)[existing];
      await drawFinished(page, existing, sh.pts);

      const targets = [
        ["open ground", { x: box.x + 160, y: box.y + 160 }],
        ["a vertex", sh.pts[0]],
        ["an edge", existing === "Count" ? { x: sh.pts[0].x + 7, y: sh.pts[0].y + 5 } : mid(sh.pts[0], sh.pts[1])],
      ];
      if (existing === "Area") targets.push(["inside the area", { x: sh.pts[0].x + 120, y: sh.pts[0].y + 80 }]);

      for (const next of MODES) {
        for (const [name, at] of targets) {
          await pick(page, next); // arms Measure in `next`, clearing any draft — the "switch"
          await expect(draft(page)).toHaveCount(0);
          await expectFirstPoint(page, at, `${existing} → ${next}, press on ${name}`);
        }
      }
      expect(errors, errors.join("\n")).toEqual([]);
    });
  }

  test("fresh from no active tool: each mode's first click places a point", async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    for (const m of MODES) {
      await pick(page, m);
      await expectFirstPoint(page, { x: box.x + 400, y: box.y + 300 }, `fresh ${m}`);
    }
  });

  test("an UNFINISHED area is open when the mode is switched to Length (and back): the next click still places a point", async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    const o = { x: box.x + 520, y: box.y + 330 };
    await pick(page, "Area");
    await page.mouse.click(o.x - 100, o.y - 60);
    await page.mouse.click(o.x + 100, o.y - 60);
    await expect(draft(page)).toHaveAttribute("data-points", "2");
    await pick(page, "Length");
    await expectFirstPoint(page, { x: o.x, y: o.y - 60 }, "open Area → Length, press ON the abandoned area's edge");
    await pick(page, "Area");
    await expectFirstPoint(page, { x: o.x, y: o.y + 100 }, "open Length → Area, open ground");
  });

  test("a measurement the moment it finishes: the very next click (with the same tool, no switch) places a point, even on its own edge", async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    const a = { x: box.x + 400, y: box.y + 300 }, b = { x: box.x + 640, y: box.y + 300 };
    await drawFinished(page, "Length", [a, b]);
    await expectFirstPoint(page, mid(a, b), "Length just finished, press on its own edge");
  });

  test("right-click still reaches a finished measurement from Measure (its menu selects it) — selecting is not lost, only no longer a LEFT click", async ({ page }) => {
    await start(page);
    const box = await canvas(page).boundingBox();
    const a = { x: box.x + 400, y: box.y + 300 }, b = { x: box.x + 640, y: box.y + 300 };
    await drawFinished(page, "Length", [a, b]);
    const m = mid(a, b);
    await page.mouse.click(m.x, m.y, { button: "right" });
    await expect(selected(page)).toBeVisible();
  });
});
