/* Food: with Drop a pin armed, the map (and anything on it) reads crosshair. Signed in on planyr.io. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io";
const s = await openSignedIn({ base });
const { page } = s;
try {
  await page.goto(base + "/#/food", { waitUntil: "load" });
  await page.waitForSelector('[data-testid="food-map"].leaflet-container', { timeout: 30000 });
  await assertMeasurable(page, "verify-cursors-food-pin");
  const read = () => page.evaluate(() => {
    const box = document.querySelector('[data-testid="food-map"]'); const r = box.getBoundingClientRect();
    const out = [];
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.6], [0.7, 0.4]]) {
      const el = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      out.push(el ? getComputedStyle(el).cursor : "NOHIT");
    }
    return { armed: box.classList.contains("food-pin-mode"), cursors: out };
  });
  const before = await read();
  const btn = page.getByRole("button", { name: /drop a pin/i }).first();
  await btn.click();
  await page.waitForTimeout(500);
  const after = await read();
  console.log("before", JSON.stringify(before), "\nafter ", JSON.stringify(after), "\nbuild", JSON.stringify(s.build));
  const ok = !before.armed && after.armed && after.cursors.every((c) => c === "crosshair") && before.cursors.some((c) => c !== "crosshair");
  console.log(ok ? "PASS" : "FAIL");
  await s.close(); process.exit(ok ? 0 : 1);
} catch (e) { console.error("ERROR", e.message); await s.close(); process.exit(1); }
