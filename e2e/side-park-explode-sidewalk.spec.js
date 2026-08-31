/* B1375 … B1379 — "the Goose Creek plans are missing sidewalks", driven in a real browser.
 *
 * WHY THIS SPEC EXISTS, AND WHY IT CANNOT BE A UNIT TEST. The defect lived in the SEQUENCE of two
 * real gestures, not in any one function: Explode a side-parking field, then click "−" once. The
 * Explode dropped `sideParkSide` off every piece, so the "−" ladder — which walks
 * rows → remove parking → remove sidewalk — asked "is there parking on this wall?", got told no
 * with a full 60 ft module sitting on it, and fell straight through to the last rung. Reading
 * either function on its own shows nothing wrong. Only the pair, driven for real, does.
 *
 * And B1379 is the half NO unit test caught and only a browser did: the repair rendered correctly
 * while the STORED record kept its wreckage, because the load seam measured a repair's severity by
 * how far it MOVED something and this one moves nothing. So test 2 deliberately asserts against the
 * plan ON DISK after a reload, not against the canvas — measuring the canvas is exactly what would
 * have called that bug fixed.
 *
 * Logged out, no external GIS, local storage only: Claude-doable here, per ATTEMPT-BEFORE-YOU-PARK.
 * The signed-in half — the same repair against the real cloud rows, committing back through
 * `site_elements` — remains the live-verify entry V671.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openModule } from "./helpers.js";

const SITE_KEY = "planarfit:sites:v1";
const FIX = JSON.parse(readFileSync(new URL("../test/fixtures/orphanWallPads.json", import.meta.url), "utf8"));
const GOOSE = FIX.gooseCreekPlanII.els;
const HOSTS = ["e1454629danlgq", "e1454729ykduhm"];

/* The persisted plan, straight off the device. On-disk truth, not pixels — see the header. */
const readEls = (page) => page.evaluate((key) => {
  const map = JSON.parse(localStorage.getItem(key) || "{}");
  const id = Object.keys(map)[0];
  return (map[id] || {}).els || [];
}, SITE_KEY);

const isStrip = (e) => (e.type === "sidewalk" || e.type === "landscape") && !e.noFit && !e.truckCourt && !e.forCourt && !e.prevZone;
const isPad = (e) => (e.type === "parking" || e.type === "paving") && !e.noFit && !e.truckCourt && !e.forCourt && !e.forTrailer && !e.prevZone && !e.dogEar;
const countOn = (els, host, pred) => els.filter((e) => e.attachedTo === host && pred(e)).length;

/* A blank plan with ONE building on it. The building matters: a plan with nothing drawn is not
 * resumed on boot, so there would be no stored record for the init script below to plant over. */
async function planWithBuilding(page) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  const svg = page.getByTestId("planner-canvas");
  await expect(svg).toBeVisible({ timeout: 45000 });
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const b = await svg.boundingBox();
  const x0 = b.x + b.width * 0.32, y0 = b.y + b.height * 0.36;
  const x1 = b.x + b.width * 0.64, y1 = b.y + b.height * 0.58;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  return svg;
}

/* ⛔ Plant as an INIT SCRIPT, never a plain evaluate. Writing to localStorage while the planner is
 * still mounted plants nothing: the page's own unload flush re-saves the live (coherent) canvas
 * over it on the way out, and the next boot reads a clean record. An init script runs after the old
 * page has gone and before any of the new page's scripts — the only window where the bytes are
 * ours. (Measured on the B1340 spec next door, and again here.) Note the same trap has a unit-test
 * twin: seeding through `saveSite` renormalizes on WRITE, so that proves nothing either — B1379. */
async function plantAndReload(page, els) {
  await page.addInitScript(({ key, rows }) => {
    try {
      /* ⚠ An init script re-runs on EVERY navigation, so an unguarded plant re-damages the record
         on each reload and "does re-opening change anything?" can never be asked. Plant ONCE, and
         leave the marker in the STORE (not on `window`, which a reload wipes). */
      if (localStorage.getItem(key + ":planted")) { window.__planted = true; return; }
      const map = JSON.parse(localStorage.getItem(key) || "{}");
      const id = Object.keys(map)[0];
      if (!map[id]) return;
      map[id] = { ...map[id], els: rows };
      localStorage.setItem(key, JSON.stringify(map));
      localStorage.setItem(key + ":planted", "1");
      window.__planted = true;
    } catch (_) { /* the assertions below fail loudly if this did not take */ }
  }, { key: SITE_KEY, rows: els });
  await page.reload();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 45000 });
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => !!window.__planted), "the rows were planted before boot").toBe(true);
}

/* Each case draws a real plan and then boots the app twice or three times, which does not fit the
 * project-wide 30 s default (case 1 measured 29.2 s and case 2 timed out mid-navigation, both on a
 * correct build). Raised deliberately, not because anything here is slow to settle. */
test.describe.configure({ timeout: 120_000 });

test("the owner's damaged Goose Creek hosts come back to two sidewalks — ON DISK, parking unmoved", async ({ page }) => {
  await planWithBuilding(page);
  await plantAndReload(page, GOOSE);

  const healed = await readEls(page);
  for (const host of HOSTS) {
    expect(countOn(GOOSE, host, isStrip), `${host} starts with one sidewalk`).toBe(1);
    expect(countOn(healed, host, isStrip), `${host} is back to two sidewalks, in the SAVED plan`).toBe(2);
  }
  // …and every band the owner trimmed by hand is exactly where he left it.
  for (const id of ["e1454691dshobp", "e1454692dshobp", "e1454693dshobp",
    "e1454736ykduhm", "e1454737ykduhm", "e1454738ykduhm"]) {
    const was = GOOSE.find((e) => e.id === id), now = healed.find((e) => e.id === id);
    expect(now, `${id} survived the repair`).toBeTruthy();
    expect(Math.hypot(now.cx - was.cx, now.cy - was.cy), `${id} did not move`).toBeLessThan(0.01);
    expect(Math.abs(now.w - was.w) + Math.abs(now.h - was.h), `${id} kept its size`).toBeLessThan(0.01);
    expect(now.sideParkSide, `${id} got its wall role back`).toBe("left");
  }
});

test("re-opening the repaired plan changes nothing — no second sidewalk, no re-minted id", async ({ page }) => {
  await planWithBuilding(page);
  await plantAndReload(page, GOOSE);
  const first = (await readEls(page)).map((e) => e.id).sort();
  await page.reload();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 45000 });
  await page.waitForTimeout(1200);
  expect((await readEls(page)).map((e) => e.id).sort()).toEqual(first);
});
