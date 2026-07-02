/* B556 — deleting a building (with its bonded children) must leave a delete-tombstone.
 *
 * THE BUG (owner-found on planyr.io): after "Take over editing", MOVING a building never re-showed
 * the "changed in another session / Take over editing" prompt, but DELETING one did — a phantom
 * conflict with no real second session. Root cause: `deleteSel` removed the building AND its bonded
 * children (dog-ears / sidewalks / parking) from `els` but recorded NO tombstone, so the B459
 * thin-clobber guard saw ≥2 items vanish "with no delete to explain them" and FALSELY blocked the
 * cloud save as a cross-session conflict. (A move keeps the item count, so it never tripped.)
 *
 * This harness proves the fix in the REAL app, LOGGED-OUT (the tombstone write is cloud-independent;
 * the thin-clobber guard itself only runs signed-in → that half is the V### Cowork check):
 *   1. Seed a site with a parcel + a building + one bonded child (attachedTo the building).
 *   2. Open the planner, click the building (canvas centre) → it selects.
 *   3. Delete it → BOTH the building and its bonded child leave `els`…
 *   4. …and BOTH ids are written to the persisted `deletedIds` tombstone list (the fix).
 *
 * Run: npm run build && npx vite preview --port 4173, then  node ui-audit/verify-delete-tombstone.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";

const site = {
  s1: {
    id: "s1", groupId: "s1", site: "Verify B556", name: "Delete tombstone", status: "active",
    origin: { lat: 29.78, lon: -95.79 }, county: "harris",
    parcels: [{ id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] }],
    // A building at the parcel centre + one BONDED child (attachedTo) — exactly the ≥2-items-at-once
    // delete that tripped the thin-clobber guard when no tombstone was recorded.
    els: [
      { id: "bld1", type: "building", cx: 0, cy: 0, w: 420, h: 220, rot: 0 },
      { id: "park1", type: "paving", attachedTo: "bld1", cx: 0, cy: 150, w: 420, h: 40, rot: 0 },
    ],
    markups: [], updatedAt: Date.now(),
  },
};
const seed = `(()=>{try{localStorage.setItem(${JSON.stringify(SITES_KEY)},${JSON.stringify(JSON.stringify(site))});localStorage.setItem("planarfit:currentSite:v1","s1");}catch(e){}})();`;

const results = [];
const check = (n, p, d = "") => { results.push({ n, p }); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, ignoreHTTPSErrors: true });
await context.addInitScript(seed);
const pageErrors = [];
const page = await context.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
const canvas = page.locator('svg[aria-label="Site plan canvas"]');
await canvas.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

const readSite = () => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)).s1; } catch (e) { return null; } }, SITES_KEY);
const before = await readSite();
check("seed loaded: building + bonded child present", !!before && (before.els || []).length === 2, `els=${before ? (before.els || []).length : "?"}`);

// Click the canvas centre to select the building (it sits at the parcel centre → canvas centre).
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cyy = box.y + box.height / 2;
let deleteBtn = page.locator('button:has-text("Delete element")');
for (const [dx, dy] of [[0, 0], [0, -30], [30, 0], [-30, 0], [0, 30]]) {
  await page.mouse.click(cx + dx, cyy + dy);
  await page.waitForTimeout(400);
  if (await deleteBtn.isVisible().catch(() => false)) break;
}
const selected = await deleteBtn.isVisible().catch(() => false);
check("clicking the building selects it (Delete element button appears)", selected);
await page.screenshot({ path: OUT + "b556-selected.png" });

if (selected) {
  await deleteBtn.click();
  await page.waitForTimeout(1500); // let the immediate mirror write + debounced autosave persist

  const after = await readSite();
  const elsLeft = (after && after.els || []).map((e) => e.id);
  const tombs = (after && after.deletedIds) || [];
  check("the building AND its bonded child are gone from els", elsLeft.length === 0, `els now=[${elsLeft.join(",")}]`);
  check("the building id is tombstoned in deletedIds (the fix)", tombs.includes("bld1"), `deletedIds=[${tombs.join(",")}]`);
  check("the bonded child id is tombstoned too (deleted as one assembly)", tombs.includes("park1"), `deletedIds=[${tombs.join(",")}]`);
} else {
  check("the building AND its bonded child are gone from els", false, "skipped — selection failed");
  check("the building id is tombstoned in deletedIds (the fix)", false, "skipped — selection failed");
  check("the bonded child id is tombstoned too (deleted as one assembly)", false, "skipped — selection failed");
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 200));

await browser.close();
const passed = results.filter((r) => r.p).length;
console.log(`\nB556 delete tombstone: ${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
