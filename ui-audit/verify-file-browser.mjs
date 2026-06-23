/* Verify Work Item B — the file browser is the Document Review landing surface.
 *
 * The file list is cloud-backed, and the sandbox CORS-blocks Supabase — so we seed a
 * well-formed local session (signed-in UI without a network handshake, per B297) + a
 * project, then assert the STRUCTURE of the new IA renders as the landing:
 *   • the category tree column ("All files"), the facet row (All · On the map · Reference
 *     · Needs filing), and the persistent drop strip — NOT the old empty "Open or drop"
 *     canvas;
 *   • the breadcrumb shows the project + Private lock;
 *   • light AND dark both render cleanly (no crash);
 *   • no-project (#/markup) → the "pick a project" empty state.
 * (Real files populating the tree is auth+network — a signed-in manual check; the tree
 *  derivation itself is unit-tested in test/fileFacts.test.js.)
 *
 * Build with a baked Supabase config so supabaseConfigured() is true:
 *   VITE_SUPABASE_URL=https://demoref.supabase.co VITE_SUPABASE_ANON_KEY=demo-anon-key npm run build
 *   npx vite preview --host   (serves :4173)
 *   node ui-audit/verify-file-browser.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const UID = "demo-uid-b";
const SID = "s-mesa-b";
const session = {
  access_token: "fake.header.payload", refresh_token: "fake-refresh", token_type: "bearer",
  expires_in: 315360000, expires_at: Math.floor(Date.now() / 1000) + 315360000,
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "mike@demo.co",
    user_metadata: { first_name: "Mike" }, app_metadata: { provider: "email" }, created_at: "2026-01-01T00:00:00Z" },
};
const site = {
  id: SID, groupId: SID, site: "Mesa", name: "Concept A", updatedAt: Date.now(), status: "active",
  origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }], locked: true }],
  els: [], markups: [], measures: [], settings: {},
};
const seed = `try {
  localStorage.setItem("sb-demoref-auth-token", ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ [SID]: site }))});
  localStorage.setItem("planarfit:sites:cloud:${UID}", ${JSON.stringify(JSON.stringify({ [SID]: site }))});
  localStorage.setItem("planarfit:currentSite:v1", ${JSON.stringify(SID)});
} catch (e) {}`;

const bodyText = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
const setTheme = (page, t) => page.evaluate((th) => { try { localStorage.setItem("planyr.theme", th); document.documentElement.dataset.theme = th; } catch (e) {} window.dispatchEvent(new Event("storage")); }, t);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
page.on("pageerror", (e) => log(false, "pageerror: " + e.message));

await page.addInitScript(seed);

// 1. Deep-link straight into Mesa's Markup — must land on the file browser.
await page.goto(BASE + "#/project/" + SID + "/markup", { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
let t = await bodyText(page);
log(/All files/.test(t), "1. category tree renders ('All files' root)");
log(/Needs filing/.test(t), "1. facet row shows the loud 'Needs filing' to-do");
log(/On the map/.test(t) && /Reference/.test(t), "1. usage facets (On the map / Reference) render");
log(/Drop, paste, or click/.test(t), "1. persistent drop strip renders");
log(!/Open or drop a construction PDF to review/.test(t), "1. the OLD empty 'Open or drop' canvas is gone (browser is the landing)");
log(/Mesa/.test(t), "1. the project context (Mesa) is shown");
await page.screenshot({ path: OUT + "fb-1-landing-light.png" });

// 2. Dark theme renders cleanly (no crash, structure intact).
await setTheme(page, "dark");
await page.waitForTimeout(600);
t = await bodyText(page);
log(/All files/.test(t) && /Needs filing/.test(t), "2. dark theme renders the browser cleanly");
const themeAttr = await page.evaluate(() => document.documentElement.dataset.theme);
log(themeAttr === "dark", `2. theme flipped to dark (data-theme=${themeAttr})`);
await page.screenshot({ path: OUT + "fb-2-landing-dark.png" });
await setTheme(page, "light");
await page.waitForTimeout(400);

// 3. Opening the review canvas + returning via 🗂 Files.
//    (No file to open without network, so just verify the 🗂 Files button is present and
//     toggles browsing — it's the path back from the canvas.)
const hasFilesBtn = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /🗂\s*Files/.test(b.textContent || "")));
log(hasFilesBtn, "3. the 🗂 Files button (return-to-browser) is present");

// 4. No-project Markup → pick-a-project empty state.
await page.evaluate(() => { window.location.hash = "#/markup"; });
await page.waitForTimeout(900);
t = await bodyText(page);
log(/Pick a project/i.test(t), "4. #/markup (no project) → 'Pick a project' empty state");
await page.screenshot({ path: OUT + "fb-4-noproject.png" });

await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
