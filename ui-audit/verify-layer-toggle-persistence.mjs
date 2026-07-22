/* NEW-1 — per-site GIS Layers-panel toggle memory. Logged-out, on the built app.
 *
 * Verifies end-to-end (real React wiring, not just the pure helpers unit-tested in
 * test/layerPrefs.test.js):
 *   1. A fresh site opens with FEMA OFF (defaults).
 *   2. Toggling FEMA on writes a sparse `layerOverrides:{fema:true}` into the saved site record.
 *   3. Reloading the SAME site restores FEMA ON (the motivating bug — layers no longer reset).
 *   4. Ctrl+Z after a toggle reverts it (the toggle is a real undo frame) and Ctrl+Y redoes it.
 *   5. Opening a DIFFERENT site with no overrides shows FEMA OFF (per-site scope — no leak / no
 *      global pref).
 *
 * GIS tiles are egress-blocked in the sandbox, but the Layers-panel checkbox + save/restore path
 * is independent of whether the layer actually PAINTS, so this runs fully offline.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const H = 535.5;
const parcel = { id: "pc1", locked: true, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] };
const mkSite = (id) => ({
  id, groupId: id, site: `Site ${id}`, name: "Concept A",
  origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {},
  underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now(),
});
const store = { S1: mkSite("S1"), S3: mkSite("S3") };
// SEED ONCE: addInitScript re-runs on every navigation, so guard on an existing store — otherwise a
// reload would re-seed the pristine sites and clobber exactly the toggle we're trying to verify persists.
const seed = `(()=>{try{if(!localStorage.getItem('planarfit:sites:v1')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(store)}));localStorage.setItem('planarfit:currentSite:v1','S1');}}catch(e){}})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
let fail = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
page.on("dialog", async (d) => { console.log("  [DIALOG — should never appear]", d.message().slice(0, 80)); fail++; await d.accept().catch(() => {}); });

// Open the planner's top-right "Layers" collapsible and return the FEMA row checkbox handle (null if
// not found). Everything is scoped to :visible so the hidden MapFinder (also mounted, its own
// LayerPanel + FEMA row) can never be matched instead of the planner's.
async function femaCheckbox() {
  const visibleFema = () => page.locator('label:visible', { hasText: "FEMA flood zones" }).first();
  if (!(await visibleFema().count())) {
    const btn = page.locator('button:visible', { hasText: "Layers" }).first();
    try { await btn.click({ timeout: 4000 }); } catch (_) {}
    await page.waitForTimeout(400);
  }
  const label = visibleFema();
  try { await label.waitFor({ state: "visible", timeout: 4000 }); } catch (_) { return null; }
  return label.locator('input[type="checkbox"]').first();
}
const femaSavedOn = () => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1")); return !!(s && s.S1 && s.S1.layerOverrides && s.S1.layerOverrides.fema === true); } catch (_) { return null; }
});

// ---- 1) fresh site → FEMA off (defaults) ----
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);
let cb = await femaCheckbox();
check("FEMA row is present in the Layers panel", !!cb);
if (cb) check("fresh site opens with FEMA OFF (defaults)", (await cb.isChecked()) === false);

// ---- 2) toggle FEMA on → persisted as a sparse override ----
if (cb) {
  await cb.click();
  await page.waitForTimeout(900); // autosave debounce (~400ms) + margin
  check("toggling FEMA on checks the box", (await cb.isChecked()) === true);
  check("saved record now has layerOverrides.fema === true", (await femaSavedOn()) === true);
}

// ---- 4) undo/redo integration (a toggle is a real history frame) ----
if (cb) {
  // Move focus off the checkbox <input> first — the planner ignores Ctrl+Z while a form field is
  // focused (it must not hijack a text field's own undo), so a chord fired with the box focused no-ops.
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.waitForTimeout(150);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(400);
  check("Ctrl+Z reverts the toggle (FEMA back off)", (await cb.isChecked()) === false);
  await page.keyboard.press("Control+y");
  await page.waitForTimeout(400);
  check("Ctrl+Y redoes it (FEMA on)", (await cb.isChecked()) === true);
  await page.waitForTimeout(700); // let the redo re-persist
  check("after redo the saved record still has FEMA on", (await femaSavedOn()) === true);
}

// ---- 3) reload the SAME site → FEMA restored ON ----
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);
cb = await femaCheckbox();
check("after reload the FEMA row is present", !!cb);
if (cb) check("reloading the SAME site restores FEMA ON (the fix)", (await cb.isChecked()) === true);

// ---- 5) a different site with no overrides → FEMA off (per-site scope, no leak) ----
await page.goto(BASE + "#/project/S3/site", { waitUntil: "load" });
await page.waitForTimeout(1800);
cb = await femaCheckbox();
check("a different site's FEMA row is present", !!cb);
if (cb) check("opening a different (never-toggled) site shows FEMA OFF — no leak", (await cb.isChecked()) === false);

// ---- 6) back to S1 → still ON (per-site memory holds across an in-session site switch) ----
await page.goto(BASE + "#/project/S1/site", { waitUntil: "load" });
await page.waitForTimeout(1800);
cb = await femaCheckbox();
if (cb) check("switching back to the first site shows FEMA still ON", (await cb.isChecked()) === true);

await browser.close();
console.log(fail ? `\nFAIL — ${fail} check(s) failed` : "\nPASS — all checks passed");
process.exit(fail ? 1 : 0);
