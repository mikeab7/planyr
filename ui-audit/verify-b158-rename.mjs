/* B158 verification: a site row in YOUR SITES is renamed via the RIGHT-CLICK menu (Rename),
 * with an inline-edit input — no inline ✕, no dialog. Also confirms the menu carries both
 * Rename and Delete, and that there is no single-click ✕ delete affordance on the row.
 *
 * Logged-out (the sandbox can't sign in): seed two sites into the legacy localStorage store,
 * drive the map's YOUR SITES panel, and assert on the rendered name + the persisted store.
 * Run: vite preview on :4173, then  node ui-audit/verify-b158-rename.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";

// Boot to the map (no currentSite) so YOUR SITES is the first thing visible.
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
const seed = `(() => { try {
  if (localStorage.getItem("__b158_seeded__")) return;
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, ${JSON.stringify(JSON.stringify(sites))});
  localStorage.setItem("__b158_seeded__", "1");
} catch (e) {} })();`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? "  · " + detail : ""}`); };
const nameInStore = async (page, id) => page.evaluate(([k, sid]) => { try { const o = JSON.parse(localStorage.getItem(k)) || {}; return (o[sid] || {}).site || ""; } catch (_) { return "<parse-error>"; } }, [SITES_KEY, id]);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const rowOf = (label) => page.locator('div[title*="right-click for status"]').filter({ hasText: label }).first();

// 1) The YOUR SITES panel renders the seeded rows.
check("Your sites panel shows the seeded rows", (await page.locator("text=Your sites").count()) > 0 && (await rowOf("HOLLISTER").count()) > 0);

// 2) No single-click ✕ delete affordance on the row (B168/B158 — delete lives in the menu only).
//    Hover the row, then assert no "Delete site"/✕ button is exposed inline.
await rowOf("HOLLISTER").hover();
await page.waitForTimeout(200);
const inlineDelete = await rowOf("HOLLISTER").locator('button[aria-label="Delete site"], button[title*="Delete"]').count();
check("no inline ✕ delete button on the row", inlineDelete === 0, `inline delete buttons = ${inlineDelete}`);

// 3) Right-click opens the menu carrying BOTH Rename and Delete.
const box = await rowOf("HOLLISTER").boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
await page.waitForTimeout(400);
const hasRename = (await page.locator("text=/Rename/i").count()) > 0;
const hasDelete = (await page.locator("text=/Delete project/i").count()) > 0;
check("right-click menu has Rename and Delete", hasRename && hasDelete, `rename=${hasRename} delete=${hasDelete}`);
await page.screenshot({ path: OUT + "b158-1-menu.png" });

// 4) Click Rename → an inline input appears pre-filled with the current name.
await page.locator("text=/Rename/i").first().click();
await page.waitForTimeout(300);
const renameInput = await page.evaluateHandle(() => document.activeElement);
const isInput = await page.evaluate((el) => el && el.tagName === "INPUT" && el.value === "HOLLISTER", renameInput);
check("Rename opens an inline input pre-filled with the name", isInput, `activeEl is HOLLISTER input = ${isInput}`);

// 5) Type a new name + Enter → the row + the store both update; no dialog was used.
await page.keyboard.press("Control+A");
await page.keyboard.type("Hollister Logistics Park");
await page.keyboard.press("Enter");
await page.waitForTimeout(800);
const stored = await nameInStore(page, "s1");
const rowShows = (await page.locator('div[title*="right-click for status"]').filter({ hasText: "Hollister Logistics Park" }).count()) > 0;
check("Enter commits: row + store show the new name", stored === "Hollister Logistics Park" && rowShows, `store="${stored}" rowShows=${rowShows}`);
await page.screenshot({ path: OUT + "b158-2-renamed.png" });

// 6) Esc cancels: open rename on Schiel, type, press Esc → name unchanged.
const sbox = await rowOf("Schiel").boundingBox();
await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { button: "right" });
await page.waitForTimeout(300);
await page.locator("text=/Rename/i").first().click();
await page.waitForTimeout(250);
await page.keyboard.press("Control+A");
await page.keyboard.type("SHOULD NOT STICK");
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
const schielStored = await nameInStore(page, "s2");
check("Esc cancels the rename (name unchanged)", schielStored === "Schiel Rd", `store="${schielStored}"`);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\nB158 right-click rename: ${passed}/${results.length} checks passed. Screens in ui-audit/screens/`);
process.exit(passed === results.length ? 0 : 1);
