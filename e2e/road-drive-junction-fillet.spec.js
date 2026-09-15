/* B<PENDING> — a road tee-ing into a paving pad / truck court at an OBLIQUE angle used to render a
 * raw, unfilleted junction: a knife-edge notch on the acute side (the curb-return wedge floats as
 * its own disconnected pavement island, never reaching the driveway's own strip) and a hard,
 * straight edge on the obtuse side (the driveway's own flat end cap, left exposed). Root cause and
 * fix: src/workspaces/site-planner/lib/roadGeometry.js (`teeGeometry`'s wedge builder) — see that
 * file's header comment and test/roadDriveJunctionFillet.test.js for the full diagnosis, proven
 * there with the pure geometry. This spec is the live-render + PDF-PARITY half: it drives the REAL
 * canvas and confirms the dissolved pavement is the SAME single, simple region on screen and in the
 * exported sheet — not just in the pure math.
 *
 * Existing e2e/road-drive-connect.spec.js only exercises a PERPENDICULAR connect (straight down
 * onto the target edge), which is exactly the symmetric case the defect never shows on — see
 * WRONG-CASE in CLAUDE.md. This spec is the oblique case that actually reproduces it.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, roadNetwork, netSurfaces } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-toolbar-draw").click();
  await expect(canvas(page)).toBeVisible();
  await canvas(page).click({ position: { x: 20, y: 20 } }); // Snap stays OFF
}

async function pickRoadPreset(page) {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).last().click(); // widest preset (matches the owner's 36 ft repro)
}

// A simple-polygon check over the world-feet ring the app's own e2e hook returns — no pixel/path
// parsing needed. Mirrors test/roadDriveJunctionFillet.test.js's isSimplePolygon exactly.
function isSimplePolygon(ring) {
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  const n = ring && ring.length;
  if (!n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      if (j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
}

async function drawPad(page, box, kind) {
  await page.getByRole("button", { name: kind, exact: true }).click();
  await page.mouse.move(box.x + 300, box.y + 450);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 520, { steps: 5 });
  await page.mouse.move(box.x + 820, box.y + 640, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function drawObliqueDriveInto(page, box, target) {
  await pickRoadPreset(page);
  // Diagonal approach onto the pad's top edge (y≈450), landing well inside its x-span — an oblique
  // angle from vertical, unlike the existing perpendicular-connect spec.
  await page.mouse.click(box.x + target.startX, box.y + 180);
  await page.mouse.click(box.x + target.endX, box.y + 449);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test.describe("road → paving-pad / truck-court junction, OBLIQUE approach — curb-return fillet renders as ONE clean region", () => {
  for (const { label, kind, target } of [
    { label: "truck court, ~45° approach", kind: "Paving", target: { startX: 260, endX: 620 } },
    { label: "parking field, shallower ~30° approach", kind: "Parking", target: { startX: 380, endX: 600 } },
  ]) {
    test(`${label}: the driveway + its curb returns dissolve into one connected, simple pavement region`, async ({ page }) => {
      await startBlank(page);
      const box = await canvas(page).boundingBox();
      await drawPad(page, box, kind);
      await drawObliqueDriveInto(page, box, target);

      await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);
      const net = await roadNetwork(page);
      expect(net.drives[0].wedges, "both curb-return wedges were computed").toBe(2);

      // The core regression check: ONE dissolved region (not a stranded wedge island), and it must
      // be a simple polygon — the exact properties the pre-fix code violated at an oblique angle.
      expect(net.regions.length, "the driveway's pavement is ONE region, not a disconnected wedge").toBe(1);
      for (const r of net.regions) {
        expect(isSimplePolygon(r.outer), "the dissolved outline is simple (no self-crossing / raw notch)").toBe(true);
      }
      // Exactly one rendered surface path on screen — a disconnected wedge would render as a second,
      // visibly separate `road-network-surface` patch floating near the pad.
      await expect(netSurfaces(page)).toHaveCount(1);
    });
  }

  test("PDF/print export parity — the exported sheet keeps the same single, filleted region", async ({ page }) => {
    await startBlank(page);
    const box = await canvas(page).boundingBox();
    await drawPad(page, box, "Paving");
    await drawObliqueDriveInto(page, box, { startX: 260, endX: 620 });
    await expect.poll(async () => (await roadNetwork(page))?.drives.length ?? 0).toBe(1);

    const live = await page.locator('[data-testid="road-network-surface"]').first().getAttribute("d");
    expect(live, "the live canvas draws a dissolved road surface").toBeTruthy();

    const exported = await page.evaluate(async () => {
      const markup = await window.__plannerExportSvg();
      if (!markup) return null;
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      const el = doc.querySelector('[data-testid="road-network-surface"]');
      return el ? el.getAttribute("d") : null;
    });
    expect(exported, "the exported sheet carries the same pavement path").toBeTruthy();
    expect(exported).toBe(live);
  });
});
