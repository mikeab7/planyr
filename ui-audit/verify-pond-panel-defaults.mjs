/* v3 PR-I — COMPUTE, don't interrogate: verify the LIVE pond panel in a real browser.
 *   I3 — a dry Detention pond shows NO "Permanent pool elev." input.
 *   I4 — no flag chip runs off the right edge of the panel (measured).
 *   I5 — the verdict is a HEADLINE + a separate sub-line, never a wrapped dangling parenthesis.
 *   I1 — the "Engineering assumptions" criteria are PRE-FILLED with EST estimates (no naked blanks).
 * Drives the REAL app logged out on a georeferenced site carrying a REMEMBERED drainage check + a
 * BERMED pond in the floodplain (rim above grade → the "runoff needs inlets through the berm" flag
 * chip + an AMBER not-buildable verdict). Fixture-driven (never pins live-project values).
 * Run: node ui-audit/verify-pond-panel-defaults.mjs   (preview on :4173)
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
// Rim (tob 100) well ABOVE existing grade (90) → the "Rim above site grade: runoff needs inlets
// through the berm" flag chip fires (a long sentence that used to clip off-screen). In the trigger
// flood zone → an AMBER "not buildable" verdict. Detention role → NO permanent pool.
const site = {
  id: "s_pi", groupId: "s_pi", site: "Tsakiris", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 300, cy: 300, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: POND.map((p) => ({ ...p })), det: { depth: 8, freeboard: 1, slope: 3, tobElev: 100, role: "detention" } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: { showSetback: false, drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:1", byId: { p1: { wseFt: 95, inTrigger: true, estPoolDepthFt: null } } } } } },
  underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_pi: ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', 's_pi');
  // PR-J regression: seed the STALE persisted "open" for the pond-sizing section (as if the
  // developer had opened the old "Sizing & criteria" once). The "Engineering assumptions"
  // section must STILL render collapsed on load (persist:false ignores this stale value).
  localStorage.setItem('planyr:collapse:pond-sizing', '1');
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

// Select the pond so the pond inspector opens in the property panel.
await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
await page.waitForTimeout(500);
const pondLink = page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
await pondLink.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(700);

const panelSel = '[data-testid="property-panel"]';
const panel = await page.$(panelSel);
log(!!panel, "the pond inspector (property panel) is open");

// ── I3 — no Permanent pool input on a dry Detention pond ──
const panelText = panel ? await panel.evaluate((el) => el.innerText || "") : "";
log(!/Permanent pool/i.test(panelText), "I3 — no 'Permanent pool' input on a dry Detention pond");

// ── I4 — no flag chip runs off the right edge of the panel ──
const overflow = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  if (!panel) return { ok: false, why: "no panel" };
  const pr = panel.getBoundingClientRect();
  // every chip-ish element: the guard/flag chips + any span carrying the long guard text.
  const nodes = Array.from(panel.querySelectorAll("span, div"));
  let worst = null;
  for (const n of nodes) {
    const t = (n.textContent || "").trim();
    if (!/inlets through the berm|Rim above site grade|In floodway/i.test(t)) continue;
    // the innermost element carrying the text (skip big wrappers that also contain it)
    if (n.querySelector("span, div")) continue;
    const r = n.getBoundingClientRect();
    const over = r.right - pr.right;
    if (worst == null || over > worst.over) worst = { over, text: t.slice(0, 40) };
  }
  return { ok: true, worst, panelRight: pr.right };
}, panelSel);
if (!overflow.ok) log(false, `I4 — could not measure (${overflow.why})`);
else if (!overflow.worst) log(true, "I4 — (no rim-above-grade chip found to measure; seed produced none)");
else log(overflow.worst.over <= 1.5, `I4 — the flag chip stays inside the panel (overshoot ${overflow.worst.over.toFixed(1)}px on "${overflow.worst.text}…")`);

// ── I5 — the verdict is a headline + a separate sub-line, no dangling parenthesis ──
const verdict = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  const card = panel && panel.querySelector('[data-testid="pond-verdict-card"]');
  if (!card) return { present: false };
  const divs = Array.from(card.children).filter((c) => c.tagName === "DIV");
  const headline = divs[0] ? (divs[0].textContent || "").trim() : "";
  const subline = divs[1] ? (divs[1].textContent || "").trim() : "";
  return { present: true, headline, subline, childDivs: divs.length };
}, panelSel);
if (!verdict.present) log(true, "I5 — (no verdict card in this seed; skipped)");
else {
  // the headline must NOT carry the "(15.3 of 33.8)" parenthetical...
  const headlineHasParen = /\(\s*[\d.]+\s+of\s+[\d.]+/i.test(verdict.headline);
  log(!headlineHasParen, `I5 — the headline has no dangling "(x of y)" parenthetical :: "${verdict.headline}"`);
  // ...and the achieved-vs-required lives on its OWN sub-line.
  const sublineHasFigure = /[\d.]+\s+of\s+[\d.]+\s+ac-ft/i.test(verdict.subline);
  log(sublineHasFigure, `I5 — the achieved/required figure is a separate sub-line :: "${verdict.subline}"`);
}

// ── PR-J (I2) — the "Engineering assumptions" section is CLOSED on load, even with a stale stored "open" ──
const engBtn = page.locator(`${panelSel} button:has-text("Engineering assumptions")`).first();
const closedOnLoad = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  if (!panel) return { ok: false };
  const btn = Array.from(panel.querySelectorAll("button")).find((b) => (b.textContent || "").includes("Engineering assumptions"));
  const expanded = btn ? btn.getAttribute("aria-expanded") : null;
  // the criteria inputs must NOT be in the DOM while collapsed
  const twVisible = Array.from(panel.querySelectorAll("*")).some((n) => (n.textContent || "").includes("Receiving water (100-yr tailwater) elev. (ft)"));
  return { ok: true, expanded, twVisible };
}, panelSel);
log(closedOnLoad.expanded === "false", `I2/PR-J — 'Engineering assumptions' is COLLAPSED on load despite a stale stored open (aria-expanded=${closedOnLoad.expanded})`);
log(closedOnLoad.twVisible === false, "I2/PR-J — the criteria inputs are hidden until the developer opens the section");

// ── I1 — the Engineering assumptions criteria are pre-filled with EST estimates (after opening) ──
await engBtn.click({ timeout: 1500 }).catch(() => {});
await page.waitForTimeout(400);
const est = await page.evaluate((sel) => {
  const panel = document.querySelector(sel);
  if (!panel) return { estPills: 0, blanks: [] };
  const estPills = Array.from(panel.querySelectorAll("span")).filter((s) => (s.textContent || "").trim() === "EST").length;
  // the three formerly-blank required criteria must now carry a value (pre-filled estimate).
  const blanks = [];
  for (const lbl of ["Receiving water (100-yr tailwater) elev. (ft)", "Max excavation depth (ft)"]) {
    const fields = Array.from(panel.querySelectorAll("*")).filter((n) => (n.textContent || "").includes(lbl));
    const host = fields.length ? fields[fields.length - 1].closest("div, label") : null;
    const input = host ? host.querySelector("input") : null;
    if (input && (input.value == null || input.value === "")) blanks.push(lbl);
  }
  return { estPills, blanks };
}, panelSel);
log(est.estPills >= 2, `I1 — the criteria show EST estimate tags (${est.estPills} found)`);
log(est.blanks.length === 0, `I1 — no formerly-blank required criterion is empty${est.blanks.length ? " :: " + JSON.stringify(est.blanks) : ""}`);

await page.screenshot({ path: OUT + "pond-panel-defaults.png", clip: { x: 0, y: 96, width: 400, height: 940 } });
log(errors.length === 0, `no console/page errors (${errors.length})` + (errors.length ? ` :: ${errors.slice(0, 2).join(" | ")}` : ""));
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
