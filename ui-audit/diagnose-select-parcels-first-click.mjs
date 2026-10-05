/* NEW-1 — diagnose "the FIRST click on Select parcels after the Map loads does nothing".
 * Signs in as the test account, does a FRESH load of /#/site, waits, then clicks once with a REAL
 * mouse (down/up) and reports: did the mode engage, did the button node survive the press, any
 * page errors, and what the in-app first-click trace recorded. Known-good arm: a SECOND click must
 * engage (proves the instrument can see the mode at all). Usage: node ... [base] [waitMs]. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "https://planyr.io", waitMs = Number(process.argv[3] || 6000);
const s = await openSignedIn({ base });
const { page } = s;
await page.goto(base + "/#/site", { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await assertMeasurable(page, "diagnose-select-parcels-first-click");
const btn = page.getByTestId("map-toolbar-select-parcels");
await btn.waitFor({ timeout: 40000 });
await page.evaluate(() => {
  const el = document.querySelector('[data-testid="map-toolbar-select-parcels"]');
  window.__fc = { removed: false };
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.removedNodes) if (n === el || (n.contains && n.contains(el))) window.__fc.removed = true; })
    .observe(document.body, { childList: true, subtree: true });
});
await page.waitForTimeout(waitMs);
// Engaged = the at-rest button is replaced by the "Selecting…" bar (the tip is NOT a reliable signal:
// it shares a render slot with the GIS-probe error state).
const engaged = async () => (await btn.count()) === 0;
const box = await btn.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(1200);
const first = await engaged();
const trace = await page.evaluate(() => ({ fc: window.__fc, trace: window.__selectParcelsTrace || null }));
let second = null;
if (!first) { const b2 = await btn.boundingBox(); await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2); await page.waitForTimeout(800); second = await engaged(); }
console.log(JSON.stringify({ build: s.build, waitMs, firstClickEngaged: first, secondClickEngaged: second, ...trace, pageErrors: s.errors }, null, 1));
await s.close();
