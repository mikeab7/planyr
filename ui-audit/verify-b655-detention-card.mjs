/* Self-verification for B655 — the per-pond required-detention screening card.
 * Seeds a site with a pond carrying release-rate + pumped-outfall inputs so the card's
 * compute path renders on load, selects the pond, and asserts: the screening card header,
 * a Surplus/Shortfall delta, the pumped credit line, and the Regime-B suppression note.
 * Run: node ui-audit/verify-b655-detention-card.mjs   (preview server up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b655";

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
// a big box pond with screening inputs pre-seeded so the card computes on load
const pond = { id: "p1", type: "pond", cx: 0, cy: 0, w: 600, h: 380, rot: 0, det: { depth: 8, freeboard: 1, slope: 3, daAcres: 10, daImpPct: 75, designStorm: 100, releaseRateCfs: 10, outfallMode: "pumped", pumpRateCfs: 15, pumpRateUnit: "cfs" } };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Verify B655", name: "Plan 1", status: "active", origin: null, county: null, parcels: [parcel], els: [pond], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// select the pond: click off-centre (the centred element label eats a dead-centre click)
const B = await page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].sort((a, b) => { const ba = a.getBoundingClientRect(), bb = b.getBoundingClientRect(); return bb.width * bb.height - ba.width * ba.height; })[0];
  const sb = svg.getBoundingClientRect(); const cx = sb.x + sb.width / 2, cy = sb.y + sb.height / 2;
  let best = null, bd = Infinity;
  for (const r of svg.querySelectorAll("rect,polygon")) {
    if (getComputedStyle(r).pointerEvents !== "auto") continue;
    const f = (r.getAttribute("fill") || "").toLowerCase(); if (!f || f === "none") continue;
    const b = r.getBoundingClientRect(); if (b.width < 60 || b.height < 60) continue;
    const mx = b.x + b.width / 2, my = b.y + b.height / 2; const d = (mx - cx) ** 2 + (my - cy) ** 2;
    if (d < bd) { bd = d; best = { x: Math.round(mx), y: Math.round(my) }; }
  }
  return best;
});
if (!B) { console.log("✗ could not locate the pond rect"); await browser.close(); process.exit(1); }
await page.mouse.click(B.x - 80, B.y - 55);
await page.waitForTimeout(400);

const bodyText = () => page.evaluate(() => document.body.innerText || "");
const txt = await bodyText();
log(await page.locator('[data-testid="property-panel"]').count() > 0, "pond selected → Element companion open");
log(/Required detention \(screening\)/i.test(txt), "the screening card header renders");
log(/Provided \(this pond\)/i.test(txt), "provided (this pond) row renders");
log(/rate-based/i.test(txt), "rate-based required row renders (release rate was provided)");
log(/Surplus|Shortfall/i.test(txt), "a pass/fail delta (Surplus/Shortfall) renders");
log(/pumped credit/i.test(txt), "the pumped credit line renders");
log(/not applied|gravity-drowned/i.test(txt), "the Regime-B suppression assumption note renders");
log(/Modified Rational/i.test(txt), "the Modified Rational basis/badge renders");

await page.screenshot({ path: OUT + "b655-card-light.png" });
// dark theme
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "b655-card-dark.png" });

log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
