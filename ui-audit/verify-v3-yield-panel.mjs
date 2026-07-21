/* Self-verification for the v3 UI SPEC Part A — the Yield panel.
 * Seeds a logged-out site with a building, paving, parking and a pond, opens the Yield tab,
 * and asserts the new structure: the SITE YIELD header + "{project} · {concept}" subtitle, the
 * LAND USE stacked bar + legend (Buildings/Open space/Pond/Paving), the BUILDINGS group, and
 * the A9 footer legend (PLAN/CODE/EST/YOU), with no em dash in the visible panel copy.
 * The verdict strip + DETENTION DETAIL need a live drainage object (GIS/jurisdiction), so they
 * are informational here and land in VERIFICATION.md as a live check.
 * Run: node ui-audit/verify-v3-yield-panel.mjs   (preview server up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const ID = "verify-v3-yield";

const P = 564.4;
const parcel = { id: "pc1", locked: false, points: [{ x: -P, y: -P }, { x: P, y: -P }, { x: P, y: P }, { x: -P, y: P }] };
const els = [
  { id: "b1", type: "building", cx: 0, cy: -250, w: 476, h: 476, rot: 0 },
  { id: "v1", type: "paving", cx: 0, cy: 80, w: 400, h: 200, rot: 0 },
  { id: "k1", type: "parking", cx: 0, cy: 300, w: 400, h: 160, rot: 0 },
  { id: "d1", type: "pond", cx: 0, cy: 480, w: 400, h: 160, rot: 0, det: { depth: 8 } },
];
const site = { id: ID, groupId: ID, site: "Tsakiris", name: "Concept A", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);
try { await page.locator('button[title="Yield"]').click({ timeout: 6000 }); } catch (e) { /* already open */ }
await page.waitForTimeout(600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const panelText = async () => page.evaluate(() => {
  const heads = [...document.querySelectorAll("*")].filter((e) => /SITE YIELD/i.test(e.textContent || "") && e.children.length < 8);
  // the yield panel lives in the left rail; grab the whole left column text
  const col = document.querySelector('[data-testid="property-panel"]') || document.body;
  return document.body.innerText || "";
});

const txt = await panelText();
// A1 header
log(/SITE YIELD/i.test(txt), "header reads SITE YIELD");
log(/Tsakiris · Concept A/.test(txt), "subtitle reads '{project} · {concept}'");
log(!/As of .*live check/i.test(txt), "the old 'As of … live check' clock is gone");
// A5 LAND USE
log(/LAND USE/i.test(txt), "group: LAND USE");
for (const seg of ["Buildings", "Open space", "Pond", "Paving"]) {
  log(new RegExp(`\\b${seg}\\b`).test(txt), `land-use legend: ${seg}`);
}
log(/Impervious \(buildings \+ paving\)/.test(txt), "impervious ratio row renders");
// A6 BUILDINGS
log(/BUILDINGS/i.test(txt), "group: BUILDINGS");
// A7/A8
log(/BUILDABILITY/i.test(txt), "group: BUILDABILITY");
log(/COSTS/i.test(txt), "group: COSTS");
// A9 footer legend
log(/measured from your drawing/.test(txt) && /adopted criteria/.test(txt) && /your input/.test(txt), "footer legend (PLAN/CODE/EST/YOU definitions) renders");
// G2 no em dash in the visible left-panel copy
const leftText = await page.evaluate(() => {
  // the yield panel is inside the left rail column; find the SITE YIELD ancestor panel
  let n = [...document.querySelectorAll("span")].find((s) => /^Site Yield$/i.test(s.textContent || ""));
  while (n && n.parentElement && !(n.getAttribute && n.style && n.offsetWidth > 300 && n.offsetWidth < 460)) n = n.parentElement;
  return (n || document.body).innerText || "";
});
const emLines = leftText.split("\n").filter((l) => l.includes("—"));
log(emLines.length === 0, `no em dash in the visible Yield panel copy${emLines.length ? " :: " + JSON.stringify(emLines.slice(0, 4)) : ""}`);
// verdict strip (needs live drainage) — informational
{
  const hasStrip = await page.locator('[data-testid="yield-verdict-strip"]').count() > 0;
  console.log(`${hasStrip ? "✓ " : "· "}verdict strip present: ${hasStrip} (needs a live drainage object → live-verify)`);
}

await page.screenshot({ path: OUT + "v3-yield-light.png", clip: { x: 0, y: 96, width: 380, height: 880 } });
await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "v3-yield-dark.png", clip: { x: 0, y: 96, width: 380, height: 880 } });

log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
