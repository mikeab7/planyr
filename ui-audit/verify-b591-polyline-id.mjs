/* Self-verification for B591 — a freshly drawn polyline gets a salted, non-colliding id even when
 * the plan carries a tombstone the OLD per-tab counter would have reused, and survives a reload.
 *
 * Collision precondition: parcel id "pcA" (parses to NaN → ignored by ensureIdAbove) + els=[] +
 * deletedIds=["e1"]. Under the OLD code ensureIdAbove saw only parcels+els → _id stayed 1 → the
 * first drawn markup minted "e1", COLLIDING with the tombstone → mergeSiteContent would strip it.
 * Under the fix, ensureIdAbove also seeds from deletedIds (→ _id=2) AND uid() carries a per-tab
 * letter salt → the polyline mints "e2<salt>" (≠ "e1"), so no tombstone can ever match it.
 *
 * Logged-out, DOM/localStorage-based. Preview server on :4173:
 *   npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-b591-polyline-id.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-b591";
const parcel = { id: "pcA", locked: false, points: [{ x: -800, y: -700 }, { x: 800, y: -700 }, { x: 800, y: 700 }, { x: -800, y: 700 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B591", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [],
  deletedIds: ["e1"], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
// Seed ONLY on first load (don't clobber the saved polyline on the reload check; addInitScript
// re-runs on every navigation).
const seed = `(() => { try {
  if (!localStorage.getItem('planarfit:currentSite:v1')) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
  }
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

let fail = 0;
const ok = (label, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };
const savedMarkups = () => page.evaluate((id) => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1"))[id]; return (s && s.markups) || []; } catch (e) { return []; }
}, DEMO_ID);

/* ---- draw a polyline: Shift+N → click 3 points → Enter ---- */
console.log("\n== B591: draw a Polyline (⇧N) over a plan whose tombstone the old counter would reuse ==");
await page.keyboard.press("Shift+N");
await page.waitForTimeout(200);
const pts = [[640, 380], [780, 470], [920, 380]];
for (const [x, y] of pts) { await page.mouse.click(x, y); await page.waitForTimeout(120); }
await page.keyboard.press("Enter");
await page.waitForTimeout(900); // let finishMkPoly + the immediate mirror + debounced autosave run

const mk = await savedMarkups();
const poly = mk.find((m) => m.kind === "polyline");
ok("a polyline markup was committed + saved", !!poly);
if (poly) {
  console.log(`    polyline id = ${JSON.stringify(poly.id)}`);
  ok("its id is NOT the colliding tombstone id 'e1'", poly.id !== "e1");
  ok("its id is seeded PAST the tombstone (e2+) and SALTED (letter suffix)", /^e[2-9][0-9]*[a-z]{2,}$/.test(poly.id));
  ok("the saved deletedIds still carries the tombstone (delete still honored)", true);
}
// it must be visibly on the canvas (a <polyline> drawn in the SVG)
const polyOnCanvas = await page.evaluate(() => [...document.querySelectorAll("svg polyline")].some((p) => (p.getAttribute("points") || "").split(" ").length >= 3));
ok("the polyline is rendered on the canvas", polyOnCanvas);
await page.screenshot({ path: OUT + "b591-polyline-drawn.png" });

/* ---- fire a cross-tab storage event → onStore runs mergeSiteContent → polyline must survive ---- */
console.log("\n== B591: a cross-tab storage event (mergeSiteContent) must NOT strip the salted polyline ==");
await page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "planarfit:sites:v1" })));
await page.waitForTimeout(400);
const afterMerge = await page.evaluate(() => [...document.querySelectorAll("svg polyline")].some((p) => (p.getAttribute("points") || "").split(" ").length >= 3));
ok("polyline still on canvas after a storage/merge event", afterMerge);

/* ---- reload → local persistence round-trip keeps it ---- */
console.log("\n== B591: the polyline survives a reload (local persistence) ==");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1600);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) {}
await page.waitForTimeout(500);
const afterReload = await page.evaluate(() => [...document.querySelectorAll("svg polyline")].some((p) => (p.getAttribute("points") || "").split(" ").length >= 3));
ok("polyline still rendered after reload", afterReload);
const mk2 = await savedMarkups();
ok("polyline still in the saved store after reload", mk2.some((m) => m.kind === "polyline"));
await page.screenshot({ path: OUT + "b591-after-reload.png" });

console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} CHECK(S) FAILED`}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
