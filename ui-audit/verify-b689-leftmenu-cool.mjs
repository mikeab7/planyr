/* Self-verification for B689 — the open left-menu panel is COOL, not the retired cream.
 *
 * Owner report (2026-07-07): the open left menu rendered a warm cream while the 54px icon
 * rail + chrome were cool. Fix: the light-mode --planner-* tokens now use the cool app
 * surfaces (panel = --chrome-bg #EAEEF3, cards = #FFFFFF). Dark keeps B686's slate.
 *
 * Verifies in BOTH themes (colorScheme emulation, same technique B686 used):
 *   - light: the flyout panel bg === rgb(234,238,243) (#EAEEF3, matches the rail) and is
 *            NOT the old cream rgb(239,233,221).
 *   - dark:  the flyout panel bg === rgb(21,23,29) (#15171D, B686's slate — unchanged).
 *   - the flyout bg matches the 54px rail's bg in light (the exact "match the rail" ask).
 *
 * Run: node ui-audit/verify-b689-leftmenu-cool.mjs   (preview server up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b689";

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
const building = { id: "e1", type: "building", cx: 0, cy: 0, w: 460, h: 300, rot: 0 };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B689", name: "Plan 1", status: "active", origin: null, county: null,
  parcels: [parcel], els: [building], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

async function panelAndRailBg(scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch { /* noop */ }
  await page.waitForTimeout(300);
  // open a left panel (Yield) so the flyout column mounts
  try { await page.locator('button', { hasText: "Yield" }).first().click({ timeout: 5000 }); } catch { /* noop */ }
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="left-menu-panel"]');
    const panelBg = panel ? getComputedStyle(panel).backgroundColor : null;
    // the 54px rail is the flex child immediately before the flyout in the same row
    let railBg = null;
    if (panel && panel.parentElement) {
      for (const d of panel.parentElement.children) {
        const b = d.getBoundingClientRect();
        if (b.width > 40 && b.width < 80 && b.height > 200) { railBg = getComputedStyle(d).backgroundColor; break; }
      }
    }
    return { panelBg, railBg, present: !!panel };
  });
  await page.screenshot({ path: OUT + `b689-leftmenu-${scheme}.png` });
  await ctx.close();
  return res;
}

const light = await panelAndRailBg("light");
log(light.present, `light: flyout panel mounted (data-testid present)`);
log(light.panelBg === "rgb(234, 238, 243)", `light: panel bg is cool #EAEEF3 (got ${light.panelBg})`);
log(light.panelBg !== "rgb(239, 233, 221)", `light: panel bg is NOT the retired cream #efe9dd`);
log(light.railBg === light.panelBg, `light: panel bg MATCHES the 54px rail bg (${light.railBg})`);

const dark = await panelAndRailBg("dark");
log(dark.present, `dark: flyout panel mounted`);
log(dark.panelBg === "rgb(21, 23, 29)", `dark: panel bg is B686 slate #15171D, unchanged (got ${dark.panelBg})`);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
