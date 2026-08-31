/* NEW-1 / NEW-2 — a bonded assembly survives a drag and an undo, INTACT.
 *
 * The reported bug: dragging a building shipped it ~2,000 ft off the parcel while its trailer
 * parking, a sidewalk+parking pair and all three dock bump-outs stayed at the original spot — an
 * empty drive loop with orphaned dock squares. The write half of that fix is cloud-only (the
 * commit batching), so this spec drives the half the sandbox CAN prove logged out: that a plain
 * drag moves EVERY member of the assembly by the same delta, and that Ctrl+Z brings every member
 * back — on the real canvas, read off the persisted model rather than off the pixels.
 *
 * The signed-in half (one commit per gesture, post-gesture coordinates, an undo that flushes
 * instead of riding the debounce) needs a real account + a live Supabase and is logged in
 * VERIFICATION.md; the pure engine behaviour is covered by test/assemblyTear.test.js. */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";

// Every drawn element in the logged-out site model, keyed by id (on-disk truth).
function readEls(page) {
  return page.evaluate(() => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    return (site.els || []).map((e) => ({ id: e.id, type: e.type, attachedTo: e.attachedTo || null, cx: e.cx, cy: e.cy }));
  });
}
const assemblyOf = (els, hostId) => els.filter((e) => e.id === hostId || e.attachedTo === hostId);
const near = (a, b, tol = 0.75) => Math.abs(a - b) <= tol;

test.describe("bonded assembly integrity on move + undo (logged out)", () => {
  test("a plain drag moves the building AND every bonded child by the same delta; Ctrl+Z restores them all", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");
    await openModule(page, "site-planner");
    await page.getByTestId("map-start-blank-menu-btn").first().click();
    await page.getByTestId("map-start-blank-menu-item").first().click();
    const svg = page.getByTestId("planner-canvas");
    await expect(svg).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: /^Building$/ }).first().click();

    // Draw a building — it arrives with its bonded dock stack (truck court, trailer parking, …).
    const box = await svg.boundingBox();
    const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.38;
    const x1 = box.x + box.width * 0.62, y1 = box.y + box.height * 0.56;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 6 });
    await page.mouse.up();

    // Give it the bonded children that stayed behind in the owner's plan — the dock stack (truck
    // court → trailer parking), the sidewalk+parking pair, and the corner dock bump-outs. Each
    // feature row is "label · [－] count [＋]"; the ＋ is its last button.
    await page.getByRole("button", { name: /^Properties$/ }).click();
    const plus = (label) => page.getByText(label, { exact: true }).first().locator("xpath=..").getByRole("button").last();
    for (const [label, times] of [["Dock zones", 2], ["Car parking", 1], ["Bump-outs", 1]]) {
      for (let i = 0; i < times; i++) { await plus(label).click(); await page.waitForTimeout(300); }
    }
    await page.waitForTimeout(900); // let the mirror write settle

    const before = await readEls(page);
    const host = before.find((e) => e.type === "building" && !e.attachedTo);
    expect(host, "the drawn building should be on disk").toBeTruthy();
    const members = assemblyOf(before, host.id);
    // Guard the guard: a trivial one-member "assembly" would prove nothing.
    expect(members.length, "the building should carry a real bonded assembly").toBeGreaterThanOrEqual(5);

    // Drag the building by its middle.
    const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
    await page.mouse.move(midX, midY);
    await page.mouse.down();
    await page.mouse.move(midX - 60, midY - 70, { steps: 8 });
    await page.mouse.move(midX - 120, midY - 140, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(900);

    const after = await readEls(page);
    const hostAfter = after.find((e) => e.id === host.id);
    const dx = hostAfter.cx - host.cx, dy = hostAfter.cy - host.cy;
    expect(Math.hypot(dx, dy), "the drag should actually have moved the building").toBeGreaterThan(20);
    // EVERY member translated by the SAME delta — no member left behind.
    for (const m of members) {
      const now = after.find((e) => e.id === m.id);
      expect(now, `assembly member ${m.id} (${m.type}) vanished`).toBeTruthy();
      expect(near(now.cx - m.cx, dx), `${m.type} ${m.id} drifted in x (${now.cx - m.cx} vs ${dx})`).toBe(true);
      expect(near(now.cy - m.cy, dy), `${m.type} ${m.id} drifted in y (${now.cy - m.cy} vs ${dy})`).toBe(true);
    }

    // Ctrl+Z — the undo is a gesture boundary; every member comes back together.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(900);
    const undone = await readEls(page);
    for (const m of members) {
      const now = undone.find((e) => e.id === m.id);
      expect(now, `assembly member ${m.id} (${m.type}) lost on undo`).toBeTruthy();
      expect(near(now.cx, m.cx), `${m.type} ${m.id} did not return in x`).toBe(true);
      expect(near(now.cy, m.cy), `${m.type} ${m.id} did not return in y`).toBe(true);
    }

    expect(errors, "no page errors during the drag/undo").toEqual([]);
  });
});
