/* Self-verification for B820 — Site Planner element/markup z-order "Arrange"
 * (Bring to Front / Forward / Send Backward / to Back via right-click + ⌘/Ctrl+]/[ chords,
 * plus "Send behind buildings" for markups). Seeds a plan with three separated buildings
 * (distinct sizes so DOM order = z order is readable), a parking field (band-isolation check),
 * and a markup rect. Boots the planner logged-out and drives the real SVG canvas + menus.
 * Building fill #f3ece1 · parking #cdd7dd · markup stroke #7c3aed. Run on preview :4173. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE_ID = "verify-arrange";

// z: buildings 0/1024/2048; parking parked far away (100000) so a building arrange never collides
// with it; markup at 0. Buildings are separated + distinct sizes (small/mid/large) so each is
// clickable and identifiable by width in the DOM.
const els = [
  { id: "b1", type: "building", cx: -260, cy: 0, w: 100, h: 100, rot: 0, dock: "none", z: 0 },
  { id: "b2", type: "building", cx: 20,   cy: 0, w: 180, h: 180, rot: 0, dock: "none", z: 1024 },
  { id: "b3", type: "building", cx: 320,  cy: 0, w: 260, h: 260, rot: 0, dock: "none", z: 2048 },
  { id: "pk", type: "parking",  cx: 20,   cy: -340, w: 200, h: 120, rot: 0, z: 100000 },
];
const markups = [
  // In the gap between b1 (ends x≈-210) and b2 (starts x≈-70), same row → on-screen + clickable, no overlap.
  { id: "m1", kind: "rect", cx: -140, cy: 0, w: 90, h: 70, rot: 0, stroke: "#7c3aed", weight: 2, dash: "solid", fillOpacity: 0, z: 0 },
];
const site = { id: SITE_ID, groupId: SITE_ID, site: "Verify Arrange", name: "Plan 1", origin: null, county: null,
  parcels: [], els, measures: [], callouts: [], markups, settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };

// Idempotent seed: only writes on the FIRST load. addInitScript re-runs on every navigation
// (incl. reload), so a non-conditional seed would clobber what the app persisted — making the
// reload persistence check meaningless. Guarding on absence lets the reload read the app's own save.
const seed = `(() => { try {
  if (!localStorage.getItem('planarfit:sites:v1')) {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
  }
} catch (e) {} })();`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
// Offline aerial/tile fetches fail in the sandbox — that's expected, not a regression. Only real
// JS pageerrors and non-network console errors count.
const benign = (s) => /ERR_CONNECTION_RESET|Failed to load resource|net::|ERR_NETWORK|ERR_NAME_NOT_RESOLVED/i.test(s);
page.on("pageerror", (e) => { if (!benign(String(e))) errors.push(String(e)); });
page.on("console", (m) => { if (m.type() === "error" && !benign(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);
const fit = async () => { try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {} await page.waitForTimeout(400); };
await fit();

// Building rects (fill #f3ece1) in DOM (=paint =z) order, with center + width.
const buildingsDom = () => page.evaluate(() => [...document.querySelectorAll('svg rect')]
  .filter((r) => (r.getAttribute('fill') || '').toLowerCase() === '#f3ece1')
  .map((r) => { const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: Math.round(b.width) }; })
  .filter((r) => r.w > 4));
// Rank a width list → 1=smallest(b1) 2=mid(b2) 3=large(b3), preserving DOM order.
const ranksOf = (arr) => { const sorted = [...arr].map((r) => r.w).sort((a, b) => a - b); return arr.map((r) => sorted.indexOf(r.w) + 1); };
const centerByRank = async (rank) => { const bs = await buildingsDom(); const sorted = [...bs].sort((a, b) => a.w - b.w); return sorted[rank - 1] || null; };
const clickBuilding = async (rank) => { const c = await centerByRank(rank); if (!c) return false; await page.keyboard.press("Escape"); await page.waitForTimeout(120); await page.mouse.click(c.x, c.y); await page.waitForTimeout(220); return true; };
const rightClickBuilding = async (rank) => { const c = await centerByRank(rank); if (!c) return false; await page.mouse.click(c.x, c.y, { button: "right" }); await page.waitForTimeout(260); return true; };
const clickMenuItem = async (label) => page.evaluate((lbl) => { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && (x.textContent || "").trim().startsWith(lbl)); if (b) { b.click(); return true; } return false; }, label);
const menuHas = async (label) => page.evaluate((lbl) => [...document.querySelectorAll("button")].some((x) => x.offsetParent !== null && (x.textContent || "").trim().startsWith(lbl)), label);

// --- 0: initial paint order is z order (small,mid,large = b1,b2,b3 bottom→top) ---
let bs = await buildingsDom();
log(bs.length === 3, `three buildings render (${bs.length})`);
log(JSON.stringify(ranksOf(bs)) === JSON.stringify([1, 2, 3]), `initial paint order is z order b1<b2<b3 (ranks ${JSON.stringify(ranksOf(bs))})`);

// --- 1: keyboard Bring to Front — select b1 (smallest), ⌘/Ctrl+Shift+] → b1 paints last ---
await clickBuilding(1);
const mod = process.platform === "darwin" ? "Meta" : "Control";
await page.keyboard.down(mod); await page.keyboard.down("Shift"); await page.keyboard.press("BracketRight"); await page.keyboard.up("Shift"); await page.keyboard.up(mod);
await page.waitForTimeout(300);
bs = await buildingsDom();
log(ranksOf(bs).at(-1) === 1, `Ctrl/⌘+⇧+] brought b1 to FRONT — it now paints last (ranks ${JSON.stringify(ranksOf(bs))})`);

// --- 2: keyboard Send to Back — select b3 (largest), ⌘/Ctrl+Shift+[ → b3 paints first ---
await clickBuilding(3);
await page.keyboard.down(mod); await page.keyboard.down("Shift"); await page.keyboard.press("BracketLeft"); await page.keyboard.up("Shift"); await page.keyboard.up(mod);
await page.waitForTimeout(300);
bs = await buildingsDom();
log(ranksOf(bs)[0] === 3, `Ctrl/⌘+⇧+[ sent b3 to BACK — it now paints first (ranks ${JSON.stringify(ranksOf(bs))})`);

// --- 3: right-click element menu has Arrange; "Send to Back" on b2 works ---
await rightClickBuilding(2);
const hasArrange = await menuHas("Bring to Front");
log(hasArrange, `right-click element menu shows the Arrange section`);
const clickedBack = await clickMenuItem("Send to Back");
await page.waitForTimeout(300);
bs = await buildingsDom();
log(clickedBack && ranksOf(bs)[0] === 2, `menu "Send to Back" sent b2 to the bottom (ranks ${JSON.stringify(ranksOf(bs))})`);

// --- 4: band isolation — parking never re-ordered relative to buildings (its band always paints first) ---
const parkBeforeBuildings = await page.evaluate(() => {
  const rects = [...document.querySelectorAll('svg rect')];
  const park = rects.findIndex((r) => (r.getAttribute('fill') || '').toLowerCase() === '#cdd7dd');
  const firstB = rects.findIndex((r) => (r.getAttribute('fill') || '').toLowerCase() === '#f3ece1');
  return park >= 0 && firstB >= 0 && park < firstB;
});
log(parkBeforeBuildings, `band isolation — parking still paints beneath every building after the arranges`);

// --- 5: markup "Send behind buildings" — moves the markup before the building rects in the DOM ---
const markupIdx = () => page.evaluate(() => {
  const rects = [...document.querySelectorAll('svg rect')];
  const mk = rects.findIndex((r) => (r.getAttribute('stroke') || '').toLowerCase() === '#7c3aed');
  const firstB = rects.findIndex((r) => (r.getAttribute('fill') || '').toLowerCase() === '#f3ece1');
  return { mk, firstB };
});
const before = await markupIdx();
log(before.mk > before.firstB, `markup initially paints ON TOP of the buildings (mk idx ${before.mk} > first building ${before.firstB})`);
// right-click the markup rect
const mkCenter = await page.evaluate(() => { const r = [...document.querySelectorAll('svg rect')].find((x) => (x.getAttribute('stroke') || '').toLowerCase() === '#7c3aed'); if (!r) return null; const b = r.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
if (mkCenter) { await page.mouse.click(mkCenter.x, mkCenter.y, { button: "right" }); await page.waitForTimeout(260); }
const hasBehind = await menuHas("Send behind buildings");
log(hasBehind, `markup menu offers "Send behind buildings"`);
await clickMenuItem("Send behind buildings");
await page.waitForTimeout(350);
const after = await markupIdx();
log(after.mk >= 0 && after.mk < after.firstB, `"Send behind buildings" moved the markup BELOW the buildings (mk idx ${after.mk} < first building ${after.firstB})`);

// --- 5b: the app WROTE behindEls to storage (isolates save from load) ---
await page.waitForTimeout(1200);
const savedBehind = await page.evaluate((sid) => { try { const s = JSON.parse(localStorage.getItem('planarfit:sites:v1') || '{}'); const st = s[sid]; const m = st && (st.markups || []).find((x) => x.id === 'm1'); return m ? !!m.behindEls : 'no-markup'; } catch (e) { return 'ERR:' + e.message; } }, SITE_ID);
log(savedBehind === true, `behindEls persisted to localStorage (saved flag = ${savedBehind})`);

// --- 6: persistence — reload; the behind-buildings flag survives ---
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1600);
await fit();
const afterReload = await markupIdx();
log(afterReload.mk >= 0 && afterReload.mk < afterReload.firstB, `after reload the markup still paints behind the buildings (persisted; mk idx ${afterReload.mk} < ${afterReload.firstB})`);

console.log(errors.length ? `page errors:\n${errors.slice(0, 8).join("\n")}` : "(no page errors)");
if (errors.length) fail++;
await browser.close();
console.log(fail === 0 ? "\n✓ ALL B820 ARRANGE CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
