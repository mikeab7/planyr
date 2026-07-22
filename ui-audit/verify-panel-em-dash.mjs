/* v3 B1 (C3 extension) — with EVERY group + disclosure open in BOTH panels, there must be no
 * em-dash (U+2014) in the panel's visible text OR in any of its title-attribute tooltips. Drives
 * the REAL app logged out on a georeferenced site carrying a REMEMBERED drainage check + a pond
 * with an outlet, opens the Yield panel and the pond inspector fully, then scans
 * [data-testid="yield-panel"] and [data-testid="property-panel"] for U+2014 in innerText and in
 * every [title]. Fixture-driven (never pins live-project values).
 * Run: node ui-audit/verify-panel-em-dash.mjs   (preview on :4173)
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
  id: "s_emdash", groupId: "s_emdash", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 94, daAcres: 20, daImpPct: 55, releaseRateCfs: 12, designStorm: 100, outlet: { stages: [{ kind: "orifice", invertElevFt: 86, diameterIn: 12, count: 1 }] } } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_emdash: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_emdash');
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

// Open every collapsible + disclosure + "Set unit prices" reveal inside a panel root, repeatedly
// until nothing new opens.
async function expandAll(rootSel) {
  for (let pass = 0; pass < 10; pass++) {
    let clicked = 0;
    const collapsed = await page.$$(`${rootSel} button[aria-expanded="false"]`);
    for (const t of collapsed) { try { await t.click({ timeout: 400 }); clicked++; await page.waitForTimeout(20); } catch (_) {} }
    for (const sel of ['button:has-text("Set unit prices")', 'button:has-text("Assumptions & method")']) {
      const links = await page.$$(`${rootSel} ${sel}`);
      for (const l of links) { try { const exp = await l.getAttribute("aria-expanded"); if (exp === "true") continue; await l.click({ timeout: 400 }); clicked++; await page.waitForTimeout(20); } catch (_) {} }
    }
    if (!clicked) break;
    await page.waitForTimeout(120);
  }
}

async function scan(rootSel, label) {
  const root = await page.$(rootSel);
  if (!root) { log(false, `${label}: root ${rootSel} not found`); return; }
  const res = await page.$eval(rootSel, (el) => {
    const EM = "—";
    const titleHits = [];
    for (const n of el.querySelectorAll("[title]")) {
      const t = n.getAttribute("title") || "";
      if (t.includes(EM)) titleHits.push(t.slice(0, 90));
    }
    const lines = (el.innerText || "").split("\n").filter((l) => l.includes(EM));
    return { textLines: lines, titleHits };
  });
  log(res.textLines.length === 0, `${label}: no em-dash in visible text${res.textLines.length ? " :: " + JSON.stringify(res.textLines.slice(0, 4)) : ""}`);
  log(res.titleHits.length === 0, `${label}: no em-dash in title tooltips${res.titleHits.length ? " :: " + JSON.stringify(res.titleHits.slice(0, 4)) : ""}`);
}

// ── Yield panel ──
await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(700);
await expandAll('[data-testid="yield-panel"]');
await page.waitForTimeout(200);
await scan('[data-testid="yield-panel"]', "Yield panel (all open)");

// ── Pond inspector ── select the pond via the DETENTION DETAIL per-pond link, then expand all.
const pondLink = page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
await pondLink.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(700);
await expandAll('[data-testid="property-panel"]');
await page.waitForTimeout(200);
await scan('[data-testid="property-panel"]', "Pond inspector (all open)");

await page.screenshot({ path: OUT + "panel-em-dash.png", clip: { x: 0, y: 96, width: 400, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
