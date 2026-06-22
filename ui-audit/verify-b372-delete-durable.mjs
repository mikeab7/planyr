/* B372 verification: a deleted site STAYS deleted — it does not reappear mid-session
 * (no reload) nor after a reload. Reproduces the exact root cause: the site being deleted
 * is the one whose planner is still MOUNTED (you opened it, then went back to the map), so
 * deleting it unmounts the planner whose persist-on-leave flush used to re-write the row.
 *
 * Logged-out repro (the sandbox can't sign in): the resurrection wrote back to the legacy
 * localStorage store, so we assert on that store directly + on the rendered list + a reload.
 * Run: vite preview on :4173, then  node ui-audit/verify-b366-delete-durable.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";

// Two seeded sites WITH origins so they appear as cards. currentSite = s1 (HOLLISTER) so the
// app BOOTS into the planner for s1 — that's what leaves s1's planner mounted when we later
// delete it from the map (the precondition for the resurrection bug).
const sites = {
  s1: { id: "s1", groupId: "s1", site: "HOLLISTER", name: "Plan 1", status: "pursuit",
        origin: { lat: 29.78, lon: -95.55 }, county: "harris",
        parcels: [{ id: "p1", points: [{ x: -600, y: -400 }, { x: 600, y: -400 }, { x: 600, y: 400 }, { x: -600, y: 400 }] }],
        els: [], updatedAt: Date.now() },
  s2: { id: "s2", groupId: "s2", site: "Schiel Rd", name: "Plan 1", status: "active",
        origin: { lat: 29.74, lon: -95.50 }, county: "harris",
        parcels: [{ id: "p2", points: [{ x: -300, y: -300 }, { x: 300, y: -300 }, { x: 300, y: 300 }, { x: -300, y: 300 }] }],
        els: [], updatedAt: Date.now() },
};
// One-shot: addInitScript re-runs on every load (incl. reload). Guard it so the RELOAD reflects
// the app's real post-delete state instead of silently re-injecting the deleted site (path A).
const seed = `(() => { try {
  if (localStorage.getItem("__b366_seeded__")) return;
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, ${JSON.stringify(JSON.stringify(sites))});
  localStorage.setItem("planarfit:currentSite:v1", "s1");
  localStorage.setItem("__b366_seeded__", "1");
} catch (e) {} })();`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? "  · " + detail : ""}`); };
const idsInStore = async (page) => page.evaluate((k) => { try { return Object.keys(JSON.parse(localStorage.getItem(k)) || {}); } catch (_) { return ["<parse-error>"]; } }, SITES_KEY);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

// The "Map" home crumb exists in BOTH headers (the hidden map header + the visible active one),
// so always target the VISIBLE one — in plan mode that's the planner's crumb (→ back to map).
const mapCrumb = () => page.locator('button[title*="All projects"]:visible').first();

// 1) Booted INTO the planner for HOLLISTER (so its planner is mounted), guaranteed by currentSite=s1.
await mapCrumb().waitFor({ timeout: 8000 }).catch(() => {});
check("booted into the planner for the open site (HOLLISTER)", (await mapCrumb().count()) > 0);

// 2) Back to the map — the planner stays MOUNTED (activeSiteId is still s1), which is the bug's precondition.
await mapCrumb().click();
await page.waitForTimeout(900);
check("returned to the map (Your sites panel visible)", (await page.locator("text=Your sites").count()) > 0);

// 3) Delete HOLLISTER from its map card: right-click → "Delete project…" → confirm "Delete".
const hollisterRow = page.locator('div[title*="right-click for status"]').filter({ hasText: "HOLLISTER" }).first();
const box = await hollisterRow.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
await page.waitForTimeout(400);
await page.locator("text=/Delete project/i").first().click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Delete", exact: true }).click();
await page.waitForTimeout(900); // let the planner unmount + any late flush settle

// 4) CORE: the store no longer has HOLLISTER (it wasn't resurrected by the unmount flush).
let ids = await idsInStore(page);
check("HOLLISTER removed from the store and NOT resurrected (path-B root cause)", !ids.includes("s1") && ids.includes("s2"), `store ids = [${ids}]`);
await page.screenshot({ path: OUT + "b366-1-after-delete.png" });

// 5) Path B (no reload): force another list refresh by opening Schiel then returning to the map.
//    Without the fix, the resurrected row would now re-surface in the list.
await page.locator('div[title*="right-click for status"]').filter({ hasText: "Schiel" }).first().click();
await page.waitForTimeout(700);
await mapCrumb().click();
await page.waitForTimeout(900);
ids = await idsInStore(page);
const listHasHollister = (await page.locator('div[title*="right-click for status"]').filter({ hasText: "HOLLISTER" }).count()) > 0;
check("HOLLISTER does not reappear mid-session after a list refresh (path B)", !ids.includes("s1") && !listHasHollister, `store ids = [${ids}], card present = ${listHasHollister}`);

// 6) Path A (reload): hard reload and confirm it's still gone in the store AND the rendered list.
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
ids = await idsInStore(page);
const listHasHollisterReload = (await page.locator('div[title*="right-click for status"]').filter({ hasText: "HOLLISTER" }).count()) > 0;
const listHasSchielReload = (await page.locator('div[title*="right-click for status"]').filter({ hasText: "Schiel" }).count()) > 0;
check("HOLLISTER still gone after reload; Schiel preserved (path A)", !ids.includes("s1") && ids.includes("s2") && !listHasHollisterReload && listHasSchielReload, `store ids = [${ids}]`);
await page.screenshot({ path: OUT + "b366-2-after-reload.png" });

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\nB372 delete-durability: ${passed}/${results.length} checks passed. Screens in ui-audit/screens/`);
process.exit(passed === results.length ? 0 : 1);
