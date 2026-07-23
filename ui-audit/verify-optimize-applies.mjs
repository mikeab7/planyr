/* v3 PR-H (was C1) — Optimize must RESPECT THE BUILDABLE ENVELOPE on the REAL button path.
 *
 * ⚠ This harness used to seed an in-floodplain pond and ASSERT that Optimize bermed it up
 * (94 → 99.4). That expectation was itself the bug the owner reported: a pond flagged
 * "In floodway: no fill" must NOT be bermed, yet PR-G's gate keyed off a distinct floodway
 * polygon (ringInFloodway) instead of the split.inTrigger signal the chip actually uses, so on
 * the live path Optimize still bermed +9.3 and showed a false green "OK". PR-H rewires the gate
 * to that signal and this harness now drives the REAL ⚡ Optimize button and asserts the FIX:
 *   • the pond's rim is NOT raised (zero berm — no fill in the floodplain), and
 *   • the detention verdict is AMBER "not buildable", never a green "OK".
 * It reproduces the +9.3/green bug on pre-PR-H main (rim rises, green) and passes only once the
 * gate reads the live signal. Fixture-driven (never pins live-project values).
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
// A pond fully BELOW the flood water surface (tob 94, WSE 95) AND in the trigger flood zone
// (inTrigger:true → the "In floodway: no fill" chip). Detention is SHORT (usable 0). The ONLY
// lever that would add usable detention is berming the rim above the WSE — which is exactly what
// the floodplain no-fill rule prohibits, so Optimize must add ZERO berm and read AMBER.
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
// THE PR-H repro/fix assertion: no fill in the floodplain → the rim must NOT rise.
log(tobAfter != null && Math.abs(tobAfter - tobBefore) < 0.05,
  `after: the rim was NOT bermed (${tobBefore} → ${tobAfter}) — no fill in the floodplain (pre-PR-H this rose to ~99.4)`);

// The result must be AMBER "not buildable", never a green detention "OK".
const bodyText = await page.evaluate(() => document.body.innerText || "");
const mentionsUnbuildable = /not buildable|no fill|floodplain|floodway/i.test(bodyText);
log(mentionsUnbuildable, "the result explains it's not buildable (floodplain / no-fill reason shown)");
const greenOk = /\bOK:\s*[\d.]+ of [\d.]+ ac-ft required/.test(bodyText);
log(!greenOk, `no green detention "OK: X of Y" verdict for the unbuildable pond${greenOk ? " :: a false green rendered" : ""}`);

await page.screenshot({ path: OUT + "optimize-applies.png", clip: { x: 0, y: 96, width: 400, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
