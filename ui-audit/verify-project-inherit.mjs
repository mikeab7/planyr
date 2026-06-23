/* Verify Work Item A — the active project is URL-path state, inherited across modules.
 *
 * Logged-out (the sandbox blocks sign-in): seed the legacy site store with one project
 * ("Mesa") + a current-site pointer, then drive the real app:
 *   1. boot resumes Mesa → URL becomes #/project/<id>/site, breadcrumb shows "Mesa"
 *   2. switch to Markup  → URL #/project/<id>/markup, breadcrumb STILL "Mesa" (+ lock)
 *   3. Site → Schedule → Markup round-trip keeps <id> in the URL
 *   4. back to Site      → still Mesa
 *   5. #/markup (no project) → breadcrumb reads "Select a project" (pick-a-project)
 *
 * Build (Supabase configured so the chrome is the real signed-out app) + preview:
 *   VITE_SUPABASE_URL=https://demoref.supabase.co VITE_SUPABASE_ANON_KEY=demo-anon-key npm run build
 *   npx vite preview --host    (serves :4173)
 *   node ui-audit/verify-project-inherit.mjs
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

const SID = "s-mesa-001";
// A realistic, NON-blank project: a located site with a parcel. (A blank, un-located
// site is intentionally dropped on leave — isBlankSite, SitePlanner.jsx — so it must
// carry real content for the resume/inherit flow to be exercised.)
const site = {
  id: SID, groupId: SID, site: "Mesa", name: "Concept A",
  updatedAt: Date.now(), status: "active",
  origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }], locked: true }],
  els: [], markups: [], measures: [], settings: {},
};
const seedStore = `try {
  localStorage.setItem("planarfit:sites:v1", ${JSON.stringify(JSON.stringify({ [SID]: site }))});
  localStorage.setItem("planarfit:currentSite:v1", ${JSON.stringify(SID)});
} catch (e) {}`;

const hash = (page) => page.evaluate(() => window.location.hash);
// The project crumb lives in the breadcrumb. NOTE: the Site Planner keeps BOTH a hidden
// map-mode header and the visible plan-mode header in the DOM, so query VISIBLE buttons
// across all headers (not just the first). Returns { text, lock } — the normalized label
// (chevron stripped) and whether the Private lock svg is present.
const crumbInfo = (page) => page.evaluate(() => {
  const btns = [...document.querySelectorAll("header button")].filter((b) => b.offsetParent !== null);
  const b = btns.find((x) => /^\s*(Mesa|Select a project|All projects|Project)\s*▾/.test(x.textContent || ""))
    || btns.find((x) => /Mesa|Select a project|All projects/.test(x.textContent || ""));
  return {
    text: b ? (b.textContent || "").replace(/[▾\s]+/g, " ").trim() : "(no project crumb)",
    lock: !!(b && b.querySelector("svg path")),
  };
});
const clickTab = async (page, label) => {
  await page.evaluate((lbl) => {
    const b = [...document.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === lbl);
    if (b) b.click();
  }, label);
  await page.waitForTimeout(700);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => log(false, "pageerror: " + e.message));

// Seed BEFORE the app boots.
await page.addInitScript(seedStore);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// 1. Boot resumes Mesa and reflects it in the URL.
let h = await hash(page), c = await crumbInfo(page);
log(/#\/project\/.+\/site/.test(h), `1. boot resumes Mesa into the URL — hash="${h}"`);
log(c.text === "Mesa", `1. Site breadcrumb shows "Mesa" — got "${c.text}"`);
await page.screenshot({ path: OUT + "pi-1-site.png" });

// 2. Switch to Markup — project must carry over.
await clickTab(page, "Library");
h = await hash(page); c = await crumbInfo(page);
log(/#\/project\/.+\/markup/.test(h), `2. Markup keeps the project in the URL — hash="${h}"`);
log(c.text === "Mesa", `2. Markup breadcrumb STILL shows "Mesa" (not "Select a project") — got "${c.text}"`);
log(c.lock, "2. Markup breadcrumb shows the Private lock");
await page.screenshot({ path: OUT + "pi-2-markup.png" });

// 3. Site → Schedule → Markup keeps the project across the in-between module.
await clickTab(page, "Site");
await clickTab(page, "Schedule");
h = await hash(page);
log(/#\/project\/.+\/schedule/.test(h), `3. Schedule preserves the project segment — hash="${h}"`);
await clickTab(page, "Library");
h = await hash(page); c = await crumbInfo(page);
log(/#\/project\/.+\/markup/.test(h), `3. Markup after Schedule still carries the project — hash="${h}"`);
log(c.text === "Mesa", `3. still "Mesa" after the round-trip — got "${c.text}"`);

// 4. Back to Site — still Mesa.
await clickTab(page, "Site");
h = await hash(page); c = await crumbInfo(page);
log(/#\/project\/.+\/site/.test(h), `4. back on Site, project intact — hash="${h}"`);
log(c.text === "Mesa", `4. Site breadcrumb still "Mesa" — got "${c.text}"`);

// 5. No-project Markup → "Select a project" empty state (pick-a-project).
await page.evaluate(() => { window.location.hash = "#/markup"; });
await page.waitForTimeout(800);
c = await crumbInfo(page);
log(c.text === "Select a project", `5. #/markup with no project → "Select a project" — got "${c.text}"`);
await page.screenshot({ path: OUT + "pi-5-noproject.png" });

// 6. Deep link / refresh-in-place: open the app directly AT a project+module URL.
const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page2.on("pageerror", (e) => log(false, "deeplink pageerror: " + e.message));
await page2.addInitScript(seedStore);
await page2.goto(BASE + "#/project/" + SID + "/markup", { waitUntil: "networkidle" });
await page2.waitForTimeout(1200);
const dh = await hash(page2), dc = await crumbInfo(page2);
log(/#\/project\/s-mesa-001\/markup/.test(dh), `6. deep link lands on the same URL — hash="${dh}"`);
log(dc.text === "Mesa", `6. deep-linked Markup shows "Mesa" (refresh-in-place) — got "${dc.text}"`);
await page2.screenshot({ path: OUT + "pi-6-deeplink.png" });

await browser.close();
console.log(fail ? `\n${fail} check(s) FAILED` : "\nALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
