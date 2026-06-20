/* Verify the multi-tab warning (B298), logged-out, on the built app. Two PAGES in ONE browser
 * context share the same-origin BroadcastChannel (= two tabs of one browser). Opening the SAME
 * project in both must raise the "open in another tab" banner in BOTH; closing one clears it. */
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

// Tab A alone → no conflict banner.
const a = await ctx.newPage();
await boot(a);
check("Tab A alone: no multi-tab banner", (await bannerCount(a)) === 0);

// Open Tab B on the same project → both tabs should warn.
const b = await ctx.newPage();
await boot(b);
await a.waitForTimeout(1200); // let presence 'hello'/'here' settle
check("Tab B opened same project → B shows the banner", (await bannerCount(b)) >= 1);
check("Tab A now also shows the banner (saw B arrive)", (await bannerCount(a)) >= 1);
await a.screenshot({ path: OUT + "multitab-a-warned.png" });

// Close Tab B → A's banner clears (its 'bye' on pagehide, or the TTL prune).
await b.close();
await a.waitForTimeout(2500);
check("Tab B closed → Tab A's banner clears", (await bannerCount(a)) === 0);

await ctx.close();
await browser.close();
console.log(fail === 0 ? "\n✓ ALL MULTI-TAB CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
