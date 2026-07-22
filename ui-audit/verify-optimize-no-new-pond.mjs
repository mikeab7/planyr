/* v3 E1 (HARD RULE) — ⚡ Optimize pond must NEVER create, delete, or duplicate a pond when a pond
 * already exists. It only adjusts the EXISTING pond's elevations. This drives the REAL app logged
 * out on a georeferenced site carrying ONE drawn pond sitting below the flood water surface
 * (detention SHORT), clicks every Optimize entry point it can reach, and asserts the pond COUNT
 * stays exactly 1 throughout (the old bug spawned a second square basin whenever mitigation was
 * needed but no flood-affected pond existed). Fixture-driven; never pins live-project values.
 * Run: node ui-audit/verify-optimize-no-new-pond.mjs   (preview on :4173)
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
  id: "s_e1", groupId: "s_e1", site: "Tsakiris", name: "Concept A", status: "active",
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
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_e1: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_e1');
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

const pondCount = () => page.evaluate(() => {
  try {
    const sites = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const s = sites.s_e1; return (s.els || []).filter((e) => e.type === "pond").length;
  } catch (_) { return -1; }
});

await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

const before = await pondCount();
log(before === 1, `before: exactly one pond on the site (${before})`);

// The pond panel shows exactly ONE ⚡ Optimize pond button (E2c) — click it.
const optBtns = page.getByRole("button", { name: /Optimize pond/ });
const nBtns = await optBtns.count();
log(nBtns === 1, `exactly ONE ⚡ Optimize pond button renders (found ${nBtns})`);
await optBtns.first().click({ timeout: 2000 }).catch((e) => log(false, "clicking Optimize threw: " + e.message));
await page.waitForTimeout(1000);

const after = await pondCount();
log(after === 1, `after Optimize: still exactly one pond — NO second basin was created (${after})`);

// Click it a SECOND time (idempotence): still one pond.
const optBtns2 = page.getByRole("button", { name: /Optimize pond/ });
if (await optBtns2.count() > 0) { await optBtns2.first().click({ timeout: 2000 }).catch(() => {}); await page.waitForTimeout(800); }
const after2 = await pondCount();
log(after2 === 1, `after a second Optimize click: still exactly one pond (${after2})`);

await page.screenshot({ path: OUT + "optimize-no-new-pond.png", clip: { x: 0, y: 96, width: 420, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
