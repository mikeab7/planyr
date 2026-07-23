/* v3 PR-K — Optimize RESPECTS the corrected floodplain rule ladder on the REAL button path.
 *
 * ⚠ HISTORY: PR-G/PR-H made this harness assert the pond was NOT bermed (a flat "no fill in the
 * floodplain"). The owner then checked FEMA and found NO mapped regulatory floodway under the
 * Tsakiris pond — it sits in an approximate/fringe SFHA where fill IS allowed (with compensating
 * storage; a real floodway would allow it too, with a no-rise certification). So the old block was
 * itself the bug. PR-K reverses it: on a pond that is NOT in a mapped floodway, Optimize MAY berm
 * the rim to create usable detention, and NO "no fill" / "fill prohibited" / floodway reason may
 * appear. This harness drives the REAL ⚡ Optimize button and asserts the FIX:
 *   • the pond's rim IS raised (a berm is applied — fill is allowed here), and
 *   • no floodway / "no fill" prohibition reason is shown for this non-floodway pond.
 * It reproduces the STUCK-rim regression on PR-H main (rim frozen at 94, blocked) and passes only
 * once the false gate is removed. Fixture-driven (never pins live-project values).
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
  // Approximate Zone A (no published BFE) — the fixture (1) class: in the 1% floodplain but NOT a
  // mapped regulatory floodway, so fill is allowed with compensating storage.
  flood: { zones: [{ zone: "A", subtype: "", staticBfeFt: null, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
};
// A pond fully BELOW the estimated flood water surface (tob 94, WSE 95) AND in the trigger flood
// zone (inTrigger:true). Detention is SHORT (usable 0). The lever that adds usable detention is
// berming the rim above the WSE — which PR-K now ALLOWS (this is not a mapped floodway), so Optimize
// must raise the rim, and the berm-fill below the WSE becomes compensating-storage (mitigation) debt.
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

// The ⚡ Optimize pond button appears on the SHORT / AMBER detention card.
const optBtn = page.getByRole("button", { name: /Optimize pond/ }).first();
log((await optBtn.count()) > 0, "the ⚡ Optimize pond button renders (detention is not covered)");
await optBtn.click({ timeout: 2000 }).catch((e) => log(false, "clicking Optimize threw: " + e.message));
await page.waitForTimeout(900);

const tobAfter = await readTob();
// THE PR-K reversal assertion: fill is allowed here → Optimize RAISES the rim (a berm is applied).
// On PR-H main the false floodway gate froze the rim at 94; PR-K removes it.
log(tobAfter != null && tobAfter > tobBefore + 0.05,
  `after: the rim WAS bermed (${tobBefore} → ${tobAfter}) — fill is allowed in this non-floodway SFHA (PR-H froze it at 94)`);

// No floodway / "no fill" prohibition reason may appear for a pond that is NOT in a mapped floodway.
const bodyText = await page.evaluate(() => document.body.innerText || "");
const badCopy = bodyText.match(/no fill is allowed|fill is prohibited|In floodway: no fill|can't be bermed to add detention in the floodway/i);
log(!badCopy, `no floodway "no-fill" prohibition copy for this non-floodway pond${badCopy ? ` :: found "${badCopy[0]}"` : ""}`);

// A false unconditional green must not appear on the raw seed either; but with the berm applied and
// no hard limit, a "Buildable" verdict is legitimate. The key is simply that no floodway block fired.
await page.screenshot({ path: OUT + "optimize-applies.png", clip: { x: 0, y: 96, width: 400, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
