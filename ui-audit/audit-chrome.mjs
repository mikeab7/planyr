/* B928 (NEW-1) — rail / menu / tool chrome audit screenshot harness.
 *
 * Walks every rail / toolbar / menu surface — Site Planner (both rails + an open tool menu),
 * Library, Doc Review, and Schedule — at desktop AND narrow width, in LIGHT and DARK theme, and
 * saves a screenshot per surface/theme to ui-audit/screenshots/chrome/. This is the evidence pass
 * for the audit-and-fix items B928 + B924–B927: the token sweep (no raw-hex chrome), the opacity→token
 * hierarchy fix (B925), the shared ContextMenu (B924), and the shared interaction states (B927).
 *
 * Logged out — no Supabase / network tiles needed. Theme is seeded via localStorage["planyr.theme"]
 * (the pre-paint script in index.html reads it before first paint). Run with the preview server up:
 *   node ui-audit/audit-chrome.mjs        (BASE_URL overrides the default :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screenshots/chrome/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// A representative seeded site so the planner boots straight into the plan with both rails live.
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e2", type: "paving", cx: 0, cy: 132, w: 420, h: 120, rot: 0 },
  { id: "e3", type: "parking", cx: -330, cy: -40, w: 150, h: 180, rot: 0 },
  { id: "e4", type: "pond", cx: 330, cy: 165, w: 190, h: 120, rot: 0 },
];
const demoSite = {
  id: "uiaudit-demo", groupId: "uiaudit-demo", site: "UI Audit Demo", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, updatedAt: Date.now(),
};

const seed = (theme) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [demoSite.id]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
  localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
} catch (e) {} })();`;

const fit = async (p) => { await p.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }).catch(() => {}); };

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 760, height: 900 };

// The two Doc Review notice banners (B926) — inject the REAL markup into the themed live page so
// the --warn-bg / --danger-bg / --*-text tokens resolve exactly as the app defines them, then shoot
// just the banners. Proves both banners theme correctly (esp. in dark mode), which the conditional
// React state (redrop / openErr) makes hard to trigger in a headless flow.
const injectBanners = async (p) => {
  await p.evaluate(() => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;top:12px;left:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:10px;";
    host.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--warn-bg);color:var(--warn-text);font-size:12px;font-family:system-ui,sans-serif;border-radius:6px;">
        <span>⚠ That file moved or isn't reachable anymore — re-open it to keep marking up.</span>
        <button style="margin-left:auto;padding:4px 9px;font-size:11.5px;font-weight:600;cursor:pointer;border-radius:6px;border:1px solid var(--warn-border);background:var(--surface-raised);color:var(--warn-text);">Re-open file…</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:6px 12px;background:var(--danger-bg);color:var(--danger-text);font-size:12px;font-family:system-ui,sans-serif;border-radius:6px;">
        <span>⚠ Couldn't open that drawing. It may have been deleted from the Library.</span>
        <button style="margin-left:auto;padding:4px 9px;font-size:11.5px;font-weight:600;cursor:pointer;border-radius:6px;border:1px solid var(--danger-border);background:var(--surface-raised);color:var(--danger-text);">Open Library…</button>
        <button style="cursor:pointer;background:transparent;color:var(--danger-text);border:1px solid var(--danger-border);border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">✕</button>
      </div>`;
    document.body.appendChild(host);
  });
  await p.waitForTimeout(200);
};

const SHOTS = [
  { name: "site-planner", hash: "#/site", viewport: DESKTOP, prep: fit },
  { name: "site-planner-narrow", hash: "#/site", viewport: NARROW, prep: async (p) => { await fit(p); await p.locator('button:has-text("Tools")').first().click({ timeout: 4000 }).catch(() => {}); } },
  { name: "site-planner-tool-menu", hash: "#/site", viewport: DESKTOP, prep: async (p) => { await fit(p); await p.locator('[aria-label="Parking presets"]').click({ timeout: 5000 }).catch(() => {}); } },
  { name: "site-planner-left-panel", hash: "#/site", viewport: DESKTOP, prep: async (p) => { await fit(p); await p.locator('button[title="Yield"]').click({ timeout: 5000 }).catch(() => {}); } },
  { name: "library", hash: "#/library", viewport: DESKTOP },
  { name: "doc-review", hash: "#/markup", viewport: DESKTOP },
  { name: "doc-review-banners", hash: "#/markup", viewport: DESKTOP, prep: injectBanners },
  { name: "schedule", hash: "#/schedule", viewport: DESKTOP },
];

async function shot(browser, theme, s) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 1.25 });
  await ctx.addInitScript(seed(theme));
  const page = await ctx.newPage();
  await page.goto(BASE + (s.hash || ""), { waitUntil: "load" });
  await page.waitForTimeout(1600);
  if (s.prep) { try { await s.prep(page); } catch (e) { console.warn(`  prep(${s.name}/${theme}) warn:`, e.message); } }
  await page.waitForTimeout(600);
  const file = `${s.name}-${theme}.png`;
  await page.screenshot({ path: OUT + file });
  console.log("  saved", file);
  await ctx.close();
}

// Let Playwright resolve its bundled Chromium (PLAYWRIGHT_BROWSERS_PATH is set); PW_CHROME overrides.
const EXEC = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox", "--ignore-certificate-errors"] });
console.log("Capturing chrome audit →", OUT);
for (const theme of ["light", "dark"]) for (const s of SHOTS) await shot(browser, theme, s);
await browser.close();
console.log("done.");
