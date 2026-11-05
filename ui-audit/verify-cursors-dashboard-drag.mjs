/* Dashboard Customize: pressing a card header and dragging keeps the cursor `grabbing` for the whole drag, even off the header. Signed in. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io";
const s = await openSignedIn({ base });
const { page } = s;
try {
  await page.goto(base + "/#/dashboard", { waitUntil: "load" });
  await page.getByRole("button", { name: /^customize$/i }).click({ timeout: 30000 });
  await page.waitForSelector(".dashboard-card-drag-handle", { timeout: 15000 });
  await assertMeasurable(page, "verify-cursors-dashboard-drag");
  const h = await page.locator(".dashboard-card-drag-handle").first().boundingBox();
  const rest = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [h.x + 20, h.y + h.height / 2]);
  await page.mouse.move(h.x + 20, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + 60, h.y + 80, { steps: 6 });
  await page.mouse.move(h.x + 200, h.y + 300, { steps: 6 }); // well off the header
  const mid = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [h.x + 200, h.y + 300]);
  await page.mouse.up();
  const after = await page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x, y)).cursor, [h.x + 200, h.y + 300]);
  console.log({ rest, mid, after, build: s.build });
  const ok = rest === "grab" && mid === "grabbing" && after !== "grabbing";
  console.log(ok ? "PASS" : "FAIL"); await s.close(); process.exit(ok ? 0 : 1);
} catch (e) { console.error("ERROR", e.message); await s.close(); process.exit(1); }
