/* PR-L — the redesigned pond SECTION renders in the LIVE pond inspector, is legible, and NO two
 * text labels overlap at the real rendered width. Drives the real app logged out on a Tsakiris-shaped
 * pond (grade 153.1, rim 157.1 = +4.0 berm, floor 145.1, depth 12.0, flood 153.1, outlet 145.1 below
 * receiving 153.1 — the gravity problem the section must tell at a glance). Fixture-driven.
 * Run: node ui-audit/verify-pond-section.mjs   (preview on :4173)
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
// rim 157.1 (+4.0 berm above grade 153.1), depth 12 -> floor 145.1; receiving water 153.1; the
// outlet defaults to the floor (145.1), which sits BELOW the receiving water -> the gravity problem.
const site = {
  id: "s_ps", groupId: "s_ps", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 12, freeboard: 1, slope: 3, tobElev: 157.1, role: "detention", receivingFlowlineElev: 153.1 } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 153.1, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_ps: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_ps');
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

// open the pond inspector
await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(500);
const pondLink = page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
await pondLink.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(700);

const panelSel = '[data-testid="property-panel"]';
// The "Section" group is open by default; ensure it's expanded.
const secBtn = page.locator(`${panelSel} button:has-text("Section")`).first();
await secBtn.scrollIntoViewIfNeeded().catch(() => {});
const expanded = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  const btn = Array.from(panel?.querySelectorAll("button") || []).find((b) => (b.textContent || "").trim().startsWith("Section"));
  return btn ? btn.getAttribute("aria-expanded") : null;
}, panelSel);
if (expanded === "false") { await secBtn.click().catch(() => {}); await page.waitForTimeout(300); }

const svg = await page.$(`${panelSel} svg[aria-label="Schematic pond cross-section, not to scale"]`);
log(!!svg, "the pond SECTION renders in the inspector");

// pull every <text> label + its client rect
const texts = await page.evaluate((sel) => {
  const s = document.querySelector(`${sel} svg[aria-label="Schematic pond cross-section, not to scale"]`);
  if (!s) return [];
  return Array.from(s.querySelectorAll("text")).map((t) => {
    const r = t.getBoundingClientRect();
    return { s: (t.textContent || "").trim(), x: r.x, y: r.y, w: r.width, h: r.height };
  }).filter((t) => t.s);
}, panelSel);

log(texts.length >= 8, `the section is richly labeled (${texts.length} labels)`);

// L2 — no two text labels overlap at the REAL rendered width.
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
let worst = null;
for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
  if (overlap(texts[i], texts[j])) { worst = `"${texts[i].s}" ∩ "${texts[j].s}"`; }
}
log(!worst, worst ? `LABELS OVERLAP: ${worst}` : "no two labels overlap (real rendered width)");

// content the developer needs (elevations 1dp; the gravity story)
const hasLabel = (re) => texts.some((t) => re.test(t.s));
log(hasLabel(/grade 153\.1'/), "shows existing grade 153.1'");
log(hasLabel(/floor 145\.1'/), "shows the floor 145.1'");
log(hasLabel(/rim 157\.1'.*\+4\.0/), "shows the rim 157.1' (+4.0 ft berm)");
log(hasLabel(/\+4\.0 ft berm/), "M2 — the dimension's above-grade segment reads +4.0 ft berm");
log(hasLabel(/8\.0 ft cut/), "M2 — the dimension's below-grade segment reads 8.0 ft cut");
log(hasLabel(/flood 153\.1'/), "shows the flood level 153.1'");
log(hasLabel(/outlet 145\.1'/), "shows the outlet 145.1'");
log(hasLabel(/receiving 153\.1'/), "shows the receiving water 153.1'");
log(!texts.some((t) => /CY/.test(t.s)), "M3 — NO earthwork CY numbers on the drawing");
log(!texts.some((t) => t.s.includes("—")), "no em dash in any section label");

// the gravity problem is VISIBLE: the receiving line sits ABOVE the outlet marker
const geo = await page.evaluate((sel) => {
  const s = document.querySelector(`${sel} svg[aria-label="Schematic pond cross-section, not to scale"]`);
  if (!s) return null;
  const circ = s.querySelector("circle"); // outlet marker
  const recvLabel = Array.from(s.querySelectorAll("text")).find((t) => /receiving/.test(t.textContent || ""));
  if (!circ || !recvLabel) return null;
  return { outletY: circ.getBoundingClientRect().y, recvY: recvLabel.getBoundingClientRect().y };
}, panelSel);
log(geo && geo.recvY < geo.outletY, "the receiving-water level is drawn ABOVE the outlet (the gravity problem reads at a glance)");

if (svg) {
  const box = await svg.boundingBox();
  if (box) await page.screenshot({ path: OUT + "pond-section.png", clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 } });
}
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
