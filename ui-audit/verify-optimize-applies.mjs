/* v3 C1 — Optimize pond must APPLY the rim/berm it reports, not just compute it. Drives the REAL
 * app logged out on a georeferenced site carrying a REMEMBERED drainage check + a pond sitting
 * fully BELOW the flood water surface (tob 94, WSE 95 → usable 0, detention SHORT). Clicking
 * ⚡ Optimize pond must: raise the pond's rim (its top-of-bank elevation goes UP from 94), make its
 * usable detention > 0, and persist a "what changed" card — never a toast that reports a berm the
 * pond never received. Fixture-driven (never pins live-project values).
 * Run: node ui-audit/verify-optimize-applies.mjs   (preview on :4173)
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
  flood: { zones: [{ zone: "AE", subtype: "", staticBfeFt: 95, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
};
const site = {
  id: "s_opt", groupId: "s_opt", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94 } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_opt: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_opt');
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

// Read the pond's stored top-of-bank elevation straight from localStorage (the source of truth
// the apply writes to) — robust to how the inspector formats it.
const readTob = () => page.evaluate(() => {
  try {
    const sites = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = sites.s_opt; const p = (s.els || []).find((e) => e.id === "p1");
    return p && p.det ? (p.det.tobElev ?? null) : null;
  } catch (_) { return null; }
});

await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

const tobBefore = await readTob();
log(tobBefore === 94, `before: the pond's rim is at its drawn elevation (${tobBefore})`);

// The ⚡ Optimize pond button appears on the SHORT detention card.
const optBtn = page.getByRole("button", { name: /Optimize pond/ }).first();
log((await optBtn.count()) > 0, "the ⚡ Optimize pond button renders (detention is SHORT)");
await optBtn.click({ timeout: 2000 }).catch((e) => log(false, "clicking Optimize threw: " + e.message));
await page.waitForTimeout(900);

const tobAfter = await readTob();
log(tobAfter != null && tobBefore != null && tobAfter > tobBefore + 0.05, `after: the rim was RAISED (${tobBefore} → ${tobAfter}) — the berm was actually applied`);

// The persistent "what changed" card must be on the page (Optimize applied something).
const cardText = await page.evaluate(() => document.body.innerText || "");
log(/Optimize pond: what changed/i.test(cardText) || /Optimize pond: couldn't/i.test(cardText), "a persistent 'what changed' card is shown");

// Usable detention now exists: the rim was raised ABOVE the flood water surface (95), so storage
// between the WSE and the new rim counts. (After Optimize the pond inspector replaces the Yield
// panel, so this geometric fact is the robust proof rather than scraping the hidden per-pond row.)
log(tobAfter != null && tobAfter > 95, `after: the rim (${tobAfter}) sits above the flood water surface (95) → usable detention exists`);

await page.screenshot({ path: OUT + "optimize-applies.png", clip: { x: 0, y: 96, width: 400, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
