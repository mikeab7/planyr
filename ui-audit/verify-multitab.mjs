/* Verify the multi-tab warning (B313) is gated to SIGNED-IN accounts only. Two PAGES in ONE
 * browser context share the same-origin BroadcastChannel (= two tabs of one browser). A
 * logged-out, device-only session starts fresh: even with the SAME project open in both tabs,
 * NO "open in another tab" banner appears (it protects saved cloud work, not anonymous local
 * browsing — the false mobile nag this fix removed). The signed-in banner path can't be
 * exercised headlessly (the sandbox blocks sign-in); the pure protocol stays covered by
 * test/multiTab.test.js. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4174/";

const H = 535.5;
const site = { id: "J", groupId: "J", site: "Jacinto", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{if(!localStorage.getItem('planarfit:sites:v1'))localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ J: site })}));localStorage.setItem('planarfit:currentSite:v1','J');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
let fail = 0;
const check = (name, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${name}`); if (!ok) fail++; };
const bannerCount = (page) => page.getByText(/open in.*another tab|another tab/i).count();
const boot = async (page) => { await page.goto(BASE, { waitUntil: "load" }); await page.waitForTimeout(1800); };

// Tab A alone (logged out) → no conflict banner.
const a = await ctx.newPage();
await boot(a);
check("Logged-out Tab A alone: no multi-tab banner", (await bannerCount(a)) === 0);

// Open Tab B on the SAME project. Logged out, neither tab should warn.
const b = await ctx.newPage();
await boot(b);
await a.waitForTimeout(1200); // let presence 'hello'/'here' settle
check("Logged-out Tab B (same project) → still no banner", (await bannerCount(b)) === 0);
check("Logged-out Tab A (saw B arrive) → still no banner", (await bannerCount(a)) === 0);
await a.screenshot({ path: OUT + "multitab-loggedout-quiet.png" });

await b.close();
await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL MULTI-TAB CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
