/* v3 follow-up (punch list) — verifies the Yield panel's DETENTION DETAIL + verdict strip on a
 * georeferenced site carrying a REMEMBERED drainage check (settings.drainage.lastCheck), so the
 * drainage object + detReq render LOGGED OUT, no GIS. Confirms the live-only fixes the reviewer
 * flagged: the verdict sentence never ellipsizes; the ⚡ button is not in the strip; the old
 * "As of … live check" clock is gone; DETENTION DETAIL shows the per-pond row + Requirement basis
 * and NOT the "Detention required" row (it folded into Assumptions & method); no em dash in the
 * default panel; BUILDINGS "{n} · {sf} sf"; COSTS "not priced yet".
 * Run: node ui-audit/verify-punch-yield-detail.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const H = 660;
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const POND = [{ x: -500, y: -500 }, { x: 100, y: -500 }, { x: 100, y: 100 }, { x: -500, y: 100 }];
const slim = {
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [{ zone: "AE", subtype: "", staticBfeFt: 95, vdatum: "NAVD88" }], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
};
const site = {
  id: "s_punch", groupId: "s_punch", site: "Tsakiris", name: "Concept A", status: "active",
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
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_punch: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_punch');
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
await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const txt = await page.evaluate(() => document.body.innerText || "");
// verdict strip present + sentence full (item 2)
const stripCount = await page.locator('[data-testid="yield-verdict-strip"]').count();
log(stripCount > 0, `verdict strip renders on the remembered check (${stripCount})`);
const sentences = await page.locator('[data-testid^="yield-verdict-sentence-"]').all();
log(sentences.length > 0, `verdict sentence rows present (${sentences.length})`);
for (const s of sentences) {
  const m = await s.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, text: el.innerText }));
  log(m.scroll <= m.client + 1, `sentence not ellipsized: "${m.text}" (scroll ${m.scroll} ≤ client ${m.client})`);
}
// no ⚡ button inside the strip (item 2)
const btnInStrip = await page.locator('[data-testid="yield-verdict-strip"] button:has-text("Optimize pond")').count();
log(btnInStrip === 0, `no ⚡ Optimize pond button inside the verdict strip (${btnInStrip})`);
// item 1 — the old clock is gone
log(!/As of .*live check/i.test(txt) && !/remembered from your last check/i.test(txt), "the old 'As of … live check / remembered' clock is gone");
// DETENTION DETAIL — open by default; per-pond row + Requirement basis; NO "Detention required"
log(/Requirement basis/.test(txt), "DETENTION DETAIL shows the Requirement basis row");
log(/holds/.test(txt) && /counts|usable/.test(txt), "DETENTION DETAIL shows the per-pond row (counts · holds)");
log(!/Detention required/.test(txt), "'Detention required' is NOT in the default DOM (folded into Assumptions & method)");
log(/Detention detail/i.test(txt), "the group reads 'Detention detail'");
// item 7 / 8 summaries
log(/\d+ · [\d,]+ sf/.test(txt), "BUILDINGS summary is '{n} · {sf} sf'");
log(/not priced yet/.test(txt), "COSTS summary reads 'not priced yet'");
// G2/C3 — no em dash in the default rendered panel text (left column)
const leftText = await page.evaluate(() => {
  let n = [...document.querySelectorAll("span")].find((s) => /^Site Yield$/i.test(s.textContent || ""));
  for (let i = 0; i < 6 && n && n.parentElement; i++) n = n.parentElement;
  return (n || document.body).innerText || "";
});
const emLines = leftText.split("\n").filter((l) => l.includes("—"));
log(emLines.length === 0, `no em dash in the default Yield panel copy${emLines.length ? " :: " + JSON.stringify(emLines.slice(0, 5)) : ""}`);

await page.screenshot({ path: OUT + "punch-yield-detail.png", clip: { x: 0, y: 96, width: 390, height: 900 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
