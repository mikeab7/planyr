/* Self-verification for NEW-2 (B1818257) — a cross-dock building's two truck courts (one per dock
 * side) are independently editable, and each is labeled with a compass direction derived from the
 * building's own rotation, so the two are distinguishable in the selection header / Properties
 * title instead of reading as two anonymous "Paving / Drive" shapes.
 *
 * Seeds a cross-dock building rotated 40° (deliberately off a round multiple of 90°, so this
 * exercises the real rotation math end to end, not just the four cardinal cases already covered by
 * the dockZones.js unit tests) with a truck court already built on each dock side. Drives the real
 * UI: click each court, read its label + depth, edit ONE side's depth, and confirm the OTHER side's
 * element is untouched in the persisted model — the exact defect NEW-2 reports (both sides used to
 * be forced to the same depth by setZoneDepthAll).
 *
 * Logged out + no external GIS, so it runs here (VERIFICATION.md rule 4 — attempt before you park).
 * Run: node ui-audit/verify-dock-side-independent-truck-courts.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { layoutZoneByKind, dockSideCompassLabel } from "../src/workspaces/site-planner/lib/dockZones.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "verify-dock-side-independent";
const ROT = 40; // off-cardinal, so the compass math is genuinely exercised (expect NE / SW)
const B = { cx: 0, cy: 0, w: 600, h: 300, rot: ROT };
const courtNGeom = layoutZoneByKind(B, "top", 0, [135], ["strip"]);
const courtSGeom = layoutZoneByKind(B, "bottom", 0, [135], ["strip"]);
const expectN = dockSideCompassLabel("top", ROT);
const expectS = dockSideCompassLabel("bottom", ROT);
console.log(`Expected compass labels (from the real pure function): N-side dock face → ${expectN}, S-side dock face → ${expectS}`);

const els = [
  { id: "b1", type: "building", ...B, dock: "cross" },
  { id: "courtN", type: "paving", attachedTo: "b1", truckCourt: { side: "top" }, zd: 135, ...courtNGeom },
  { id: "courtS", type: "paving", attachedTo: "b1", truckCourt: { side: "bottom" }, zd: 135, ...courtSGeom },
];
const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -700 }, { x: 900, y: -700 }, { x: 900, y: 700 }, { x: -900, y: 700 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Dock Side Independence", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-dock-side-independent-truck-courts");
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.evaluate((g) => { window.location.hash = `#/project/${g}/site`; }, DEMO_ID);
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

const clickElementById = async (id) => {
  const box = await page.evaluate((elId) => {
    const node = document.querySelector(`[data-feature="el:${elId}"]`) || document.querySelector(`[data-el-id="${elId}"]`);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(300);
  try { await page.getByText("Properties", { exact: true }).click({ timeout: 3000 }); } catch (e) { /* already open */ }
  await page.waitForTimeout(300);
  return true;
};

const panelText = async () => page.evaluate(() => (document.querySelector('[data-testid="property-panel"]')?.innerText || "").toLowerCase());

// Field renders `data-field-group="1"` divs, label as the first child, the input(s) in the second
// (the same shape ui-audit/verify-paving-depth-editable.mjs reads) — never a real <label> element.
const depthGroup = () => page.locator('[data-field-group="1"]').filter({ hasText: "Depth (ft)" }).first();

const readDepth = async () => {
  const input = depthGroup().locator("input");
  return (await input.count()) ? input.inputValue() : null;
};

const commitDepth = async (n) => {
  const input = depthGroup().locator("input");
  if (!(await input.count())) return false;
  await input.click({ clickCount: 3 });
  await input.fill(String(n));
  await input.press("Enter");
  await page.waitForTimeout(300);
  return true;
};

const readModel = async () => page.evaluate((g) => {
  const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const els = raw[g]?.els || [];
  const byId = Object.fromEntries(els.map((e) => [e.id, e]));
  return { courtN: byId.courtN, courtS: byId.courtS };
}, DEMO_ID);

let pass = true;

// ---- 1) compass labeling: select each court, confirm its OWN side's compass label appears ----
await clickElementById("courtN");
let txt = await panelText();
const nHasLabel = txt.includes(`truck court · ${expectN}`.toLowerCase());
console.log(`courtN selected — panel shows "Truck court · ${expectN}": ${nHasLabel ? "✓" : "✗"}`);
if (!nHasLabel) { console.error("panel text:", txt); pass = false; }
const nDepthShown = await readDepth();
console.log(`courtN Depth field shows: ${nDepthShown} (expect 135)`);
if (nDepthShown !== "135") pass = false;

await clickElementById("courtS");
txt = await panelText();
const sHasLabel = txt.includes(`truck court · ${expectS}`.toLowerCase());
console.log(`courtS selected — panel shows "Truck court · ${expectS}": ${sHasLabel ? "✓" : "✗"}`);
if (!sHasLabel) { console.error("panel text:", txt); pass = false; }

// ---- 2) independence: editing S's depth must NOT touch N's ----
await commitDepth(90);
let m = await readModel();
console.log(`after setting S's depth to 90: S.zd=${m.courtS?.zd}, N.zd=${m.courtN?.zd} (expect S=90, N still 135)`);
if (m.courtS?.zd !== 90) pass = false;
if (m.courtN?.zd !== 135) { console.error("✗ REGRESSION: editing S's depth changed N's — the two sides are still mirrored"); pass = false; }

// ---- 3) and the reverse: editing N's depth must NOT touch S's (which is now 90, not the default) ----
await clickElementById("courtN");
await commitDepth(160);
m = await readModel();
console.log(`after setting N's depth to 160: N.zd=${m.courtN?.zd}, S.zd=${m.courtS?.zd} (expect N=160, S still 90)`);
if (m.courtN?.zd !== 160) pass = false;
if (m.courtS?.zd !== 90) { console.error("✗ REGRESSION: editing N's depth changed S's — the two sides are still mirrored"); pass = false; }

if (errors.length) { console.error("Console/page errors:", errors); pass = false; }

await browser.close();
if (!pass) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
