/* verify-layer-click-only-live — B2507060 / B2507061 / B2507062 (owner constraints #42, #43, #45), LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layer-click-only-live.mjs [https://planyr.io | a branch preview] [--expect-sha <sha>] [--shots <dir>] [--view 34.9615,-89.8299,15]
 *
 * On the MAP view (the Leaflet surface), over Olive Branch with Zoning + Counties & Cities on:
 *   1. every layer starts at 100% opacity (the Zoning row's ▾ reads 100%);
 *   2. HOVER does nothing at all — the pointer is swept across the map in a grid; after every stop there is no tooltip, no popup, and the set of drawn stroke colours is
 *      identical to the set before the first hover (no red outline, ever; the owner's report: "each hovered polygon gets a red outline that never clears");
 *   3. a CLICK on a zoning polygon opens a card with plain labels (no ZONE / CASE_NO / OBJECTID / Shape.* / CONVERSION_STATUS, no empty row, no raw URL) and EXACTLY ONE
 *      outlined feature; a click on a different polygon moves the outline (still one); closing the card leaves zero; a click on empty map leaves zero.
 * KNOWN-GOOD arm: the click highlight colour IS found after a click (so "zero outlined" after a hover is a reading of a working instrument, not a blind one).
 * FOREGROUND-OR-VOID first. Nothing is written to the account. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha"), SHOTS = flag("--shots");
const [VLAT, VLNG, VZ] = flag("--view", "34.9615,-89.8299,15").split(",").map(Number);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const HILITE = "#f97316"; // boundaryStyle.CLICK_HIGHLIGHT_COLOR
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-layer-click-only-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
await sleep(1500);
await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [VLAT, VLNG, VZ]);
await sleep(1500);

const panel = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
async function openGroupWith(id) {
  for (const g of ["jur", "util", "env", "flood", "access", "topo", "base"]) {
    const btn = panel.getByTestId(`layer-group-${g}`);
    if (await btn.count()) { await btn.click().catch(() => {}); await sleep(250); }
    else { const sel = panel.getByTestId("layer-group-select"); if (await sel.count()) { await sel.selectOption(g).catch(() => {}); await sleep(250); } }
    if (await panel.locator(`[data-testid="layer-row-${id}"]`).count()) return true;
  }
  return false;
}
async function turnOn(id) {
  // the service-area geometry that scopes a row to its place arrives by a dynamic import — give it time before saying the row is not offered
  let there = false;
  for (let i = 0; i < 10 && !there; i++) { there = await openGroupWith(id); if (!there) await sleep(1500); }
  if (!there) { check(`row "${id}" is offered at Olive Branch`, false); return false; }
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (!(await cb.isChecked())) await cb.check();
  return true;
}
await turnOn("counties_cities");
const zoningOn = await turnOn("ms_desoto_zoning");
await sleep(9000);

/* 1. opacity reads 100% on a row that was never touched */
if (zoningOn) {
  await openGroupWith("ms_desoto_zoning");
  await panel.getByTestId("layer-caret-ms_desoto_zoning").click().catch(() => {});
  await sleep(400);
  const pct = await panel.locator('[data-testid="layer-row-ms_desoto_zoning-menu"] input[type="text"]').first().inputValue().catch(() => null);
  check("1 · Zoning starts at 100% opacity", pct === "100", `reads ${pct}`);
  await panel.getByTestId("layer-caret-ms_desoto_zoning").click().catch(() => {});
}

/* helpers that read the Leaflet map's own DOM */
const mapBox = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const strokes = () => page.evaluate(() => {
  const set = {};
  window.__mapFinderMap.getContainer().querySelectorAll("path.leaflet-interactive, svg path[stroke]").forEach((p) => { const c = (p.getAttribute("stroke") || "").toLowerCase(); if (c) set[c] = (set[c] || 0) + 1; });
  return set;
});
const overlayState = () => page.evaluate(() => {
  const c = window.__mapFinderMap.getContainer();
  // permanent LABELS (pipe sizes, zone codes, county names) are tooltips too and stay — only a tooltip whose text was not there before the first hover counts
  return { tips: [...c.querySelectorAll(".leaflet-tooltip")].map((t) => t.textContent.trim()), popups: c.querySelectorAll(".leaflet-popup").length };
});
const hiliteCount = async () => (await strokes())[HILITE] || 0;

// a SITE PIN keeps its name tooltip by design (owner constraint #43: not an overlay layer): "<site> · <place/no boundary> · <status>"
const SITE_PIN_TIP = /·\s*(Pursuit|Active|On hold|Complete|Dead)\s*$/;
const baseTips = new Set((await overlayState()).tips);
const before = await strokes();
console.log("stroke colours before any hover:", JSON.stringify(before));
if (!Object.keys(before).length) { console.log("VOID: no vector strokes are in the map DOM — the instrument cannot see outlines (zoning not drawn, or drawn on canvas)"); voided++; }

/* 2. sweep the pointer: a 9 x 7 grid, with a pause at each stop */
let maxTip = 0, maxPop = 0, maxHi = 0;
for (let gy = 1; gy <= 7; gy++) for (let gx = 1; gx <= 9; gx++) {
  await page.mouse.move(mapBox.x + (mapBox.w * gx) / 10, mapBox.y + (mapBox.h * gy) / 8, { steps: 3 });
  await sleep(120);
  const o = await overlayState(); const fresh = o.tips.filter((t) => !baseTips.has(t) && !SITE_PIN_TIP.test(t)); if (fresh.length && process.env.DEBUG_CLICK) console.log("new tooltip text:", JSON.stringify(fresh)); maxTip = Math.max(maxTip, fresh.length); maxPop = Math.max(maxPop, o.popups); maxHi = Math.max(maxHi, await hiliteCount());
}
await sleep(1200);
const after = await strokes();
check("2 · hovering 63 points shows no tooltip", maxTip === 0, `${maxTip}`);
check("2 · hovering shows no popup/card", maxPop === 0, `${maxPop}`);
check("2 · hovering outlines nothing (no highlight colour ever drawn)", maxHi === 0, `${maxHi}`);
check("2 · after the sweep every stroke colour is exactly what it was before the first hover", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/hover-nothing.png` });

/* 3. click: find points that open a zoning card (a point can land in a road gap — try a spread) */
/* Points that are certainly INSIDE a zoning polygon: the layer's own children's bounds centres that are on screen and clear of the two floating panels and the site pin. */
async function zoningPoints() {
  return page.evaluate(() => {
    const m = window.__mapFinderMap; let fl = null;
    Object.values(m._layers).forEach((l) => { if (l.options && l.options.url && /Zoning/.test(l.options.url) && l._layers) fl = l; });
    if (!fl) return [];
    const r = m.getContainer().getBoundingClientRect();
    const out = [];
    for (const c of Object.values(fl._layers)) {
      if (!c.getBounds) continue;
      const p = m.latLngToContainerPoint(c.getBounds().getCenter());
      const x = r.left + p.x, y = r.top + p.y;
      if (x > 280 && x < 980 && y > 360 && y < r.bottom - 80 && Math.abs(x - 700) + Math.abs(y - 571) > 60) out.push({ x, y, key: Math.round(x / 40) + ":" + Math.round(y / 40) });
    }
    return out;
  });
}
async function clickUntilCard(points, skipText = null) {
  for (const { x, y } of points) {
    await page.mouse.click(x, y);
    await sleep(2200);
    const txt = await page.evaluate(() => (document.querySelector(".leaflet-popup-content") || {}).innerText || "");
    if (process.env.DEBUG_CLICK) console.log(`click ${Math.round(x)},${Math.round(y)} → popup: ${JSON.stringify(txt.slice(0, 120))}`);
    if (/Zoning/i.test(txt) && /Zone:/.test(txt) && txt !== skipText) return { txt, x, y };
  }
  return null;
}
const spread = await zoningPoints();
if (!spread.length) { console.log("VOID: the Zoning layer has no polygon on screen to click"); voided++; }
const first = spread.length ? await clickUntilCard(spread) : null;
if (!first) { console.log("VOID: no click opened a zoning card — nothing to judge"); voided++; }
else {
  console.log("card 1:\n" + first.txt.split("\n").map((l) => "   " + l).join("\n"));
  const bad = [/\bZONE\b/, /CASE_NO/, /OBJECTID/, /Shape[._]/i, /CONVERSION_STATUS/, /\bnull\b/i, /https?:\/\//];
  check("3 · the card shows no raw field name, no null row and no raw URL", !bad.some((re) => re.test(first.txt)), bad.filter((re) => re.test(first.txt)).map(String).join(" "));
  check("3 · the card is titled and has labelled rows (Zone / Jurisdiction)", /Zoning/.test(first.txt) && /Zone:/.test(first.txt) && /Jurisdiction:/.test(first.txt), "");
  const h1 = await hiliteCount();
  check("3 · KNOWN-GOOD: the click outlines exactly ONE feature", h1 === 1, `${h1}`);
  if (h1 === 0) { console.log("VOID: the instrument cannot see the click highlight — the zero readings above prove nothing"); voided++; }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/click-one-outline.png` });

  const second = await clickUntilCard(spread.filter((p) => Math.hypot(p.x - first.x, p.y - first.y) > 150), first.txt);
  if (second) {
    const h2 = await hiliteCount();
    check("3 · a click on a different polygon moves the outline — still exactly one", h2 === 1, `${h2}`);
  } else console.log("(no second distinct zoning card found — move check skipped)");

  await page.locator(".leaflet-popup-close-button").first().click().catch(() => {});
  await sleep(600);
  check("3 · closing the card leaves zero outlined", (await hiliteCount()) === 0, `${await hiliteCount()}`);

  await clickUntilCard([{ x: first.x, y: first.y }]);
  await sleep(300);
  // empty map: a point inside the view where NOTHING interactive sits under the pointer (no polygon, no marker, no control) — found with elementsFromPoint, never assumed
  const emptyPt = await page.evaluate(() => {
    const r = window.__mapFinderMap.getContainer().getBoundingClientRect();
    for (let y = r.top + 120; y < r.bottom - 60; y += 23) for (let x = r.left + 300; x < r.right - 120; x += 29) {
      const els = document.elementsFromPoint(x, y);
      const hot = els.some((e) => e.matches && e.matches("path.leaflet-interactive, .leaflet-marker-icon, .leaflet-popup, button, input, select, a, [data-testid]") );
      const inMap = els.some((e) => e.classList && e.classList.contains("leaflet-container"));
      if (inMap && !hot) return { x, y };
    }
    return null;
  });
  if (!emptyPt) { console.log("VOID: no empty map point in view to click"); voided++; }
  else {
    await page.mouse.click(first.x, first.y); await sleep(2200);
    const open1 = await hiliteCount();
    await page.mouse.click(emptyPt.x, emptyPt.y); await sleep(1200);
    const o = await overlayState();
    check("3 · KNOWN-GOOD: before the empty click a card was open and one feature outlined", open1 === 1, `${open1}`);
    check("3 · clicking empty map leaves zero outlined and no card", (await hiliteCount()) === 0 && o.popups === 0, `${await hiliteCount()} outlined / ${o.popups} cards`);
  }
}

/* ── PLANNER canvas arm: a throwaway LOCATED plan at Olive Branch (deleted at the end, verified gone) ─────────────────────────────────────────────── */
const planId = `${LIVE_PREFIX}clickonly-${Date.now().toString(36)}`;
try {
  const plan = { ...throwawayPlan(planId), origin: { lat: VLAT, lon: VLNG }, site: "ZZ Live Check — click-only" };
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  if (err) throw new Error("throwaway plan insert failed — " + err);
  await page.goto(`${BASE}/?planyrDiag=1#/project/${planId}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 });
  await sleep(900);
  for (const [g, id] of [["jur", "counties_cities"], ["jur", "ms_desoto_zoning"]]) {
    await pp.getByTestId(`layer-group-${g}`).click(); await sleep(250);
    const cb = pp.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
    if (await cb.count() && !(await cb.isChecked())) await cb.check();
  }
  await sleep(9000);
  const canvas = page.getByTestId("planner-canvas");
  const box = await canvas.boundingBox();
  const hiP = () => page.evaluate((c) => document.querySelectorAll(`path[stroke="${c}" i]`).length, HILITE);
  const cards = () => page.getByTestId("gis-identify").count();
  let pMaxCard = 0, pMaxHi = 0;
  for (let gy = 1; gy <= 5; gy++) for (let gx = 1; gx <= 7; gx++) {
    await page.mouse.move(box.x + (box.width * gx) / 8, box.y + (box.height * gy) / 6, { steps: 3 }); await sleep(150);
    pMaxCard = Math.max(pMaxCard, await cards()); pMaxHi = Math.max(pMaxHi, await hiP());
  }
  await sleep(2200); // longer than the old hover delay
  pMaxCard = Math.max(pMaxCard, await cards());
  check("P2 · planner: hovering 35 points opens no card (the old hover card is gone)", pMaxCard === 0, `${pMaxCard}`);
  check("P2 · planner: hovering outlines nothing", pMaxHi === 0, `${pMaxHi}`);
  // a tap on EMPTY canvas beside the throwaway parcel (a tap on a parcel selects it, it does not identify)
  let card = "", tapped = null;
  for (const [dx, dy] of [[260, 40], [-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230], [-120, -150]]) {
    const x = box.x + box.width / 2 + dx, y = box.y + box.height / 2 + dy;
    await page.mouse.click(x, y); await sleep(2500);
    card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    if (/Zoning/.test(card)) { tapped = { x, y }; break; }
  }
  if (!tapped) { console.log("VOID: no planner tap opened a zoning card"); voided++; }
  else {
    console.log("planner card:\n" + card.split("\n").map((l) => "   " + l).join("\n"));
    check("P3 · planner: the card is clean (no raw field names / null / raw URL)", !/\bZONE\b|CASE_NO|OBJECTID|Shape[._]|CONVERSION_STATUS|\bnull\b|https?:\/\//.test(card), "");
    check("P3 · planner: KNOWN-GOOD — the tap outlines exactly one feature", (await hiP()) === 1, `${await hiP()}`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/planner-click-one-outline.png` });
    await page.getByTestId("gis-identify").first().locator('button[aria-label="Close feature details"]').click();
    await sleep(500);
    check("P3 · planner: closing the card (✕) leaves zero outlined", (await hiP()) === 0 && (await cards()) === 0, `${await hiP()}`);
    await page.mouse.click(tapped.x, tapped.y); await sleep(2500);
    const reopened = await hiP();
    const other = [[-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230], [-120, -150], [260, 40]].map(([dx, dy]) => ({ x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy })).find((p) => Math.hypot(p.x - tapped.x, p.y - tapped.y) > 120);
    await page.mouse.click(other.x, other.y); await sleep(2500);
    check("P3 · planner: KNOWN-GOOD — re-tap re-opens with one outline", reopened === 1, `${reopened}`);
    check("P3 · planner: a tap on a different spot moves the card and the outline — still exactly one", (await hiP()) === 1 && (await cards()) === 1, `${await hiP()} / ${await cards()}`);
    await page.keyboard.press("Escape"); // (a press on empty canvas is a tap that identifies again — there is no ground here with no layer under it)
  }
} finally {
  const r = await cleanupLive(page, { planId });
  check("throwaway plan deleted and verified gone", !r.errors.length && r.left.site === 0, JSON.stringify(r));
}
await s.browser.close().catch(() => {});
console.log(voided ? `VOID (${voided})` : failed ? `FAIL (${failed})` : "PASS");
process.exit(voided ? 2 : failed ? 1 : 0);
