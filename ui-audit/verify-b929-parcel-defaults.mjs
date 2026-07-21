/* Verification for B929 — parcel property DEFAULTS in Standards → Parcels.
 *
 * The Standards "Defaults for new elements" → Parcels section used to expose only "Default
 * setback". B929 adds the rest of a parcel's own properties as defaults for NEW parcels:
 * outline color, line weight, line style, and an optional fill (color + translucence). A
 * freshly drawn / added parcel is stamped with these at creation (parcelDefaultStyle).
 *
 * Logged-out against the built app (vite preview). A site is seeded via localStorage so the
 * planner mounts with a coordinate frame; no network needed. We then set weight + dash + fill
 * defaults in the panel, DRAW a new parcel on the canvas, and read the persisted site back to
 * confirm the new parcel carries the stamped style.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const site = {
  id: "uiaudit-b929", groupId: "uiaudit-b929", site: "Parcel Defaults Tract", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [
    { id: "pcA", locked: true, active: true, points: [{ x: -400, y: -200 }, { x: 0, y: -200 }, { x: 0, y: 200 }, { x: -400, y: 200 }] },
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [],
  updatedAt: Date.now(), data: { status: "active" },
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  ⚠ pageerror:", e.message));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
try { await page.getByRole("button", { name: /site planner/i }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(1500);

const menuPanel = page.locator('[data-testid="left-menu-panel"]');

// ---------- open Standards → Parcels ----------
await page.locator('button[title="Standards"]').first().click();
await page.waitForTimeout(400);
try { await menuPanel.getByText("Parcels", { exact: true }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(400);
const stdTxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Default setback/.test(stdTxt), "Parcels section still shows 'Default setback'");
ok(/Outline color/.test(stdTxt), "B929 'Outline color' default control present");
ok(/Line weight/.test(stdTxt), "B929 'Line weight' default control present");
ok(/Line style/.test(stdTxt), "B929 'Line style' default control present");
ok(/Fill new parcels/.test(stdTxt), "B929 'Fill new parcels' default toggle present");

// ---------- set the defaults: weight=5, dash=dashed, fill on ----------
// Line weight NumInput — find the input adjacent to the "Line weight" field label.
const setFieldNum = async (label, val) => {
  const row = menuPanel.locator("div", { hasText: new RegExp(`^${label}$`) }).locator("..");
  // fall back to a broader locator: the Field renders label + an <input>
  const input = menuPanel.locator(`xpath=.//*[normalize-space(text())="${label}"]/following::input[1]`).first();
  await input.click();
  await input.fill(String(val));
  await input.press("Enter");
};
await setFieldNum("Line weight", 5);
await page.waitForTimeout(200);

// Line style <select> → dashed
const dashSel = menuPanel.locator(`xpath=.//*[normalize-space(text())="Line style"]/following::select[1]`).first();
await dashSel.selectOption("dashed");
await page.waitForTimeout(200);

// Fill new parcels checkbox → on, then confirm the fill sub-controls reveal
const fillCb = menuPanel.locator(`xpath=.//*[contains(normalize-space(.),"Fill new parcels")]/input[@type="checkbox"]`).first();
await fillCb.check();
await page.waitForTimeout(300);
const stdTxt2 = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Translucence/.test(stdTxt2), "B929 turning fill ON reveals the Translucence control");
ok(/Fill color/.test(stdTxt2), "B929 turning fill ON reveals the Fill color control");

// ---------- draw a new parcel on the canvas ----------
await page.locator('button[title="Parcel"]').first().click();
await page.waitForTimeout(400);
// ＋ Add ▾ → Draw a new boundary
try { await menuPanel.getByRole("button", { name: /^＋ Add/ }).click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(250);
try { await page.getByText("Draw a new boundary", { exact: false }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(300);

const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();
// three well-separated points inside the canvas → a valid triangle, then Enter to close
const pts = [
  { x: box.x + box.width * 0.60, y: box.y + box.height * 0.35 },
  { x: box.x + box.width * 0.80, y: box.y + box.height * 0.45 },
  { x: box.x + box.width * 0.70, y: box.y + box.height * 0.65 },
];
for (const p of pts) { await page.mouse.click(p.x, p.y); await page.waitForTimeout(180); }
await page.keyboard.press("Enter");
await page.waitForTimeout(2600); // let the autosave debounce flush to localStorage

// ---------- read the persisted site; find the drawn parcel ----------
const drawn = await page.evaluate(() => {
  try {
    const sites = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = sites["uiaudit-b929"];
    if (!s || !Array.isArray(s.parcels)) return null;
    const fresh = s.parcels.filter((p) => p.id !== "pcA");
    return fresh.length ? fresh[fresh.length - 1] : null;
  } catch (e) { return null; }
});
ok(!!drawn, `a new parcel was drawn and persisted (${drawn ? drawn.id : "none"})`);
if (drawn) {
  ok(drawn.weight === 5, `B929 drawn parcel stamped with default weight 5 (got ${drawn.weight})`);
  ok(drawn.dash === "dashed", `B929 drawn parcel stamped with default dash "dashed" (got ${JSON.stringify(drawn.dash)})`);
  ok(!!drawn.fill, `B929 drawn parcel stamped with a default fill (got ${JSON.stringify(drawn.fill)})`);
}

console.log(`\nB929 parcel defaults: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
