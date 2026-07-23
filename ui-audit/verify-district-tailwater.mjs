/* PR-N / O5 — the "Drainage district" pond-inspector group renders, and the outfall tailwater NEVER
 * defaults to site grade. Seeds a Zone A pond with NO receiving-water override, opens the group, and
 * asserts it shows the receiving-water SOURCE row reading "needs channel data" (an honest UNKNOWN),
 * never a grade placeholder value. Drives the real app logged out. Fixture-driven.
 * Run: node ui-audit/verify-district-tailwater.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -520, y: -520 }, { x: 120, y: -520 }, { x: 120, y: 120 }, { x: -520, y: 120 }];
const slim = {
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [{ zone: "A", subtype: "", staticBfeFt: null, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 153.1, groundDatum: "NAVD88",
};
// NO receivingFlowlineElev override → the outfall tailwater must resolve to UNKNOWN (never grade 153.1).
const site = {
  id: "s_dt", groupId: "s_dt", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 12, freeboard: 1, slope: 3, tobElev: 157.1, role: "detention" } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 153.1, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_dt: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_dt');
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
await page.waitForTimeout(2600);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(500);
const pondLink = page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
await pondLink.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(700);

const panelSel = '[data-testid="property-panel"]';
const distBtn = page.locator(`${panelSel} button:has-text("Drainage district")`).first();
log((await distBtn.count()) > 0, "the 'Drainage district' group renders in the pond inspector");
await distBtn.scrollIntoViewIfNeeded().catch(() => {});
await distBtn.click().catch(() => {});
await page.waitForTimeout(300);

const groupText = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  if (!panel) return "";
  // find the district section body: the button + its following content
  const btn = Array.from(panel.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Drainage district"));
  if (!btn) return "";
  // walk up to the Collapse wrapper and grab its text
  let node = btn.parentElement;
  for (let i = 0; i < 4 && node; i++) node = node.parentElement;
  return (node || btn.parentElement).innerText || "";
}, panelSel);

log(/Receiving water \(outfall\)/i.test(groupText), "the group shows a 'Receiving water (outfall)' source row");
log(/needs channel data/i.test(groupText), "the outfall tailwater reads 'needs channel data' (honest UNKNOWN, no override/source)");
log(/never site grade/i.test(groupText), "the group states the receiving-water level is never site grade");

// O5 — the tailwater must NOT show the grade value (153.1) as the receiving water anywhere in the group.
const showsGradeAsTailwater = /Receiving water \(outfall\)[\s\S]{0,40}153\.1/i.test(groupText);
log(!showsGradeAsTailwater, "the outfall tailwater is NOT the site-grade placeholder (153.1)");

log(!groupText.includes("—"), "no em dash in the district group copy");

await page.screenshot({ path: OUT + "district-tailwater.png", clip: { x: 0, y: 96, width: 420, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
