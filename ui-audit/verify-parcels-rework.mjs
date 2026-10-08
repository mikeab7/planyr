/* verify-parcels-rework — the Parcels panel rework (list · parcel page · setback sections · style), driven live.
 *
 * Throwaway site with: two adjacent COUNTY lots (account numbers), one DRAWN lot, and one heavily CURVED lot
 * (a 60-segment arc frontage + three straight sides). Asserts the owner's acceptance (NEW-6):
 *   list   — header is just "Parcels" (no subtitle, no detach icon) · one summary line "N of M parcels active" ·
 *            no Locked stat / Lock all · filter hidden on a short list · eye centred under "Active" · checkbox, name,
 *            acres and eye share a centre line · second line "Drawn" / "<CAD> · <account>" · Add parcels ▾ + Edit parcels
 *   combine— 1 checked shows nothing extra, 2 checked shows the Combine bar · result row says "Combined from 2 lots"
 *   page   — row click opens the page, ← All parcels returns · a combined parcel shows "Made from" and NEVER "Drawn"
 *   setbacks— the curved lot yields a handful of sections (<= 8), not dozens · editing ONE section moves only its edges
 *   style  — Outline|Fill grid, Line options include Dash-dot / Long dash and are not clipped · no wrapped labels
 *   NEW-5  — a drag on a parcel outside Edit parcels does not move it · reload persists
 * KNOWN-GOOD ARM: the run is VOID unless the untouched list reports the seeded 4 parcels.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 → ui-audit/lib/signedInSession.mjs against BASE_URL.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sq = (x, y, id, extra = {}) => ({ id, points: [{ x, y }, { x: x + 400, y }, { x: x + 400, y: y + 400 }, { x, y: y + 400 }], ...extra });
// A lot whose north frontage is a 60-segment arc (a curving road) — the shape that used to explode into dozens of edges.
const curved = (x0, y0, id) => {
  const pts = [{ x: x0, y: y0 + 600 }, { x: x0 + 800, y: y0 + 600 }, { x: x0 + 800, y: y0 + 200 }];
  for (let i = 0; i <= 60; i++) { const a = (i / 60) * Math.PI; pts.push({ x: x0 + 800 - 800 * (i / 60), y: y0 + 200 - 200 * Math.sin(a) }); }
  return { id, points: pts, label: "Curved Lot", source: "drawn" };
};
const mkSite = (id) => ({
  id, groupId: id, site: "ZZ Parcels Rework", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [sq(0, 0, "p1", { acct: "1001", addr: "1 County Rd", attrs: { OWNER: "Smith" }, gisKey: "k1", label: "Smith Tract" }), sq(400, 0, "p2", { acct: "1002", addr: "2 County Rd", attrs: { OWNER: "Jones" }, gisKey: "k2", label: "Jones Tract" }), sq(1000, 0, "p3", { label: "Drawn Lot", source: "drawn" }), curved(2000, 0, "p4")],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const SIGNED = !!process.env.SIGNED_IN;
const SITE_ID = "zz-rework-" + Math.random().toString(36).slice(2, 7);
const site = mkSite(SITE_ID);
let browser, ctx, page, UID = null;
const errors = [];
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
page.on("pageerror", (e) => errors.push(String(e)));
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };
const parcelsLS = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem(uid ? "planarfit:sites:cloud:" + uid : "planarfit:sites:v1") || "{}"); return (m[id] && m[id].parcels) || []; }, [SITE_ID, UID]);
const box = async (loc) => { const b = await loc.boundingBox(); return b ? { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, x: b.x, y: b.y } : null; };
// A press point on the FIRST parcel's right edge, proven (not assumed) to land on a parcel — the left edge sits under the panel.
async function parcelEdgePoint() {
  const o = await box(page.locator('[data-testid="parcel-outline"]').first());
  const x = o.x + o.w - 4, y = o.y + o.h / 2;
  const hit = await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).some((e) => e.closest && e.closest('[data-feature^="parcel:"]')), [x, y]);
  if (!hit) throw new Error(`VOID: the drag start (${x | 0},${y | 0}) does not land on a parcel — the instrument cannot see the effect`);
  return { x, y };
}
async function openPanel() {
  if (await T("parcels-panel").isVisible().catch(() => false)) return;
  if (await T("parcel-page").isVisible().catch(() => false)) return;
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
}

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Parcels Rework", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcels-rework");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  await openPanel();

  // ---- known-good arm
  const rowCount = await page.locator('[data-testid^="parcel-table-row-"]').count();
  if (rowCount !== 4) throw new Error(`VOID: expected the seeded 4 parcels, saw ${rowCount}`);
  ok("known-good arm: the untouched list shows the 4 seeded parcels", true);

  // ---- header + summary
  const chrome = page.locator('[data-testid="panel-chrome-parcel"]');
  ok("header is just 'Parcels'", (await chrome.locator('[data-panel-title]').innerText()).trim().toLowerCase() === "parcels");
  ok("no project/phase subtitle in the Parcels header", (await chrome.locator('[data-panel-subtitle]').count()) === 0);
  ok("no pop-out/detach icon beside the ✕", (await T("panel-chrome-parcel-detach").count()) === 0);
  const sum = (await T("parcels-active-count").innerText()).trim();
  ok("summary says '4 of 4 parcels active'", /^4 of 4 parcels active$/.test(sum), sum);
  ok("no Locked stat and no Lock all", (await page.getByText(/^locked$/i).count()) === 0 && (await page.getByText(/lock all/i).count()) === 0);
  ok("filter box hidden on a short list", (await T("parcels-filter").count()) === 0);
  ok("the old 'Draw, split, combine… Parcel tools' line is gone", (await T("land-to-parcel-tools").count()) === 0);
  ok("Add parcels ▾ and Edit parcels buttons", (await T("land-add-btn").count()) === 1 && (await T("parcels-edit-btn").count()) === 1);

  // ---- alignment
  const head = await box(T("parcels-active-head"));
  const eye = await box(T("parcel-row-eye-p1"));
  ok("the eye is centred directly under 'Active'", head && eye && Math.abs(head.cx - eye.cx) <= 2, `head ${head && head.cx.toFixed(1)} eye ${eye && eye.cx.toFixed(1)}`);
  const chk = await box(T("parcel-row-check-p1")), nm = await box(T("parcel-row-p1")), ac = await box(T("parcel-row-acres-p1"));
  ok("checkbox, name, acres and eye share one centre line", chk && nm && ac && eye && [chk, nm, ac].every((b) => Math.abs(b.cy - eye.cy) <= 3), `${[chk, nm, ac, eye].map((b) => b && b.cy.toFixed(1))}`);
  const l1 = await T("parcel-row-p1").innerText(), l3 = await T("parcel-row-p3").innerText();
  ok("county row's second line reads '<CAD> · <account>'", /Harris CAD · 1001/.test(l1), JSON.stringify(l1));
  ok("drawn row's second line reads 'Drawn'", /Drawn/.test(l3), JSON.stringify(l3));
  await shot("list");

  // ---- eye → inactive row greyed, acres struck
  await T("parcel-row-eye-p3").click();
  const struck = await T("parcel-row-acres-p3").evaluate((e) => getComputedStyle(e).textDecorationLine);
  ok("an inactive parcel stays listed with acres struck through", /line-through/.test(struck), struck);
  ok("summary follows: 3 of 4", /3 of 4 parcels active/.test(await T("parcels-active-count").innerText()));
  await T("parcel-row-eye-p3").click();

  // ---- combine bar
  await T("parcel-row-check-p1").check();
  ok("one row checked shows nothing extra", (await T("parcels-action-bar").count()) === 0);
  await T("parcel-row-check-p2").check();
  ok("two rows checked shows the 'N selected' + Combine bar", (await T("parcels-action-bar").count()) === 1 && /2 selected/.test(await T("parcels-action-bar").innerText()));
  ok("the bar has no Lock / Split / Leave out", (await T("parcels-bar-lock").count()) === 0 && !/split|leave out|reshape/i.test(await T("parcels-action-bar").innerText()));
  await T("parcels-bar-combine").click();
  await sleep(700);
  const combinedRow = page.locator('[data-testid^="parcel-table-row-"]').filter({ hasText: /Combined from 2 lots/ });
  ok("the combined parcel's second line reads 'Combined from 2 lots'", (await combinedRow.count()) === 1);
  await combinedRow.locator('[data-testid^="parcel-row-"]:not([data-testid*="check"]):not([data-testid*="eye"]):not([data-testid*="acres"])').first().click();
  await T("parcel-page").waitFor({ timeout: 8000 });
  ok("row click opens the parcel page", true);
  ok("combined chip says 'Combined', never 'Drawn'", /Combined/.test(await T("parcel-provenance").innerText()) && !/drawn/i.test(await T("parcel-source").innerText()));
  ok("'Made from' lists the 2 source lots with 'Split back'", (await T("parcel-made-from").innerText()).includes("Smith Tract") && /Split back into the 2 lots/.test(await T("parcel-restore-combined").innerText()));
  ok("combined page has no owner/account/address fields", (await T("parcel-field-owner").count()) === 0);
  await shot("page-combined");
  await T("parcel-page-back").click();
  await T("parcels-panel").waitFor({ timeout: 8000 });
  ok("← All parcels returns to the list", true);

  // ---- curved lot: handful of sections
  await page.locator('[data-testid="parcel-row-p4"]').click();
  await T("parcel-page").waitFor({ timeout: 8000 });
  ok("a drawn parcel says 'You drew this one'", /You drew this one/.test(await T("parcel-source").innerText()));
  // Compact layout (B2191xxx): the sketch carries the sections; a section's own row/editor opens when it is clicked.
  const sketchSecs = page.locator('[data-testid^="setback-sketch-section-"]');
  await sketchSecs.first().waitFor({ timeout: 8000 });
  const nSec = await sketchSecs.count();
  ok(`the heavily curved lot (${(await parcelsLS()).find((p) => p.id === "p4").points.length} corners) yields a handful of sections, not dozens`, nSec >= 2 && nSec <= 6, `${nSec} sections`);
  await sketchSecs.first().click();
  const secRows = page.locator('[data-testid="setback-section-row"]');
  await secRows.first().waitFor({ timeout: 8000 });
  await secRows.nth(0).locator("input").first().fill("55");
  await secRows.nth(0).locator("input").first().press("Enter");
  await sleep(600);
  const after = (await parcelsLS()).find((p) => p.id === "p4").setbacks;
  const n55 = after.filter((v) => v === 55).length;
  ok("editing one section's setback writes only that part of the boundary", n55 >= 1 && n55 < after.length, `${n55}/${after.length} edges at 55`);
  ok("the sections list never uses Front / Side / Rear / Street-side words", !/\b(front|rear|street side)\b/i.test(await T("setback-sections").innerText()));
  await shot("page-setbacks");

  // ---- style grid
  const st = T("parcel-style");
  ok("Style shows Outline | Fill columns with Colour / Opacity / Width / Line rows", /Outline/i.test(await st.innerText()) && /Fill/i.test(await st.innerText()) && /Colour/.test(await st.innerText()) && /Opacity/.test(await st.innerText()) && /Width/.test(await st.innerText()) && /Line/.test(await st.innerText()));
  const sel = st.locator("select").first();
  const opts = await sel.locator("option").allInnerTexts();
  ok("Line has Solid, Dashed, Dotted, Dash-dot, Long dash", ["Solid", "Dashed", "Dotted", "Dash-dot", "Long dash"].every((o) => opts.includes(o)), opts.join("|"));
  const clip = await sel.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  ok("the Line dropdown is wide enough (nothing cut off)", clip.sw <= clip.cw + 1 && clip.cw >= 70, JSON.stringify(clip));
  const wraps = await st.evaluate((root) => [...root.querySelectorAll("span,div")].filter((n) => n.children.length === 0 && n.textContent.trim() && n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent.trim()));
  ok("no style label wraps or truncates", wraps.length === 0, wraps.join("|"));
  ok("no 'Fill at 0%' note and no Fill checkbox", !/fill at 0/i.test(await st.innerText()) && (await st.locator('input[type="checkbox"]').count()) === 0);
  ok("one 'Reset style' link", (await T("parcel-reset-style").count()) === 1);
  await shot("page-style");

  // ---- NEW-5: a drag outside Edit parcels never moves a parcel
  await T("parcel-page-back").click();
  await T("parcels-panel").waitFor();
  const ptsBefore = JSON.stringify((await parcelsLS()).map((p) => p.points));
  const { x: sx, y: sy } = await parcelEdgePoint();
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 60, sy + 40, { steps: 8 }); await page.mouse.up();
  await sleep(600);
  ok("dragging a parcel outside Edit parcels does not move it", JSON.stringify((await parcelsLS()).map((p) => p.points)) === ptsBefore);

  // ---- inside Edit parcels a boundary DOES move — unless the parcel is locked
  await T("parcels-edit-btn").click(); await T("boundary-edit-banner").waitFor({ timeout: 8000 });
  const editId = await page.evaluate(() => (document.querySelector('[data-testid="boundary-edit-banner"]') ? true : false));
  const dragFirst = async () => { const { x, y } = await parcelEdgePoint(); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 30, { steps: 8 }); await page.mouse.up(); await sleep(600); };
  const firstPts = async () => JSON.stringify((await parcelsLS())[0].points);
  const e0 = await firstPts(); await dragFirst();
  ok("inside Edit parcels the same drag moves the parcel", editId && (await firstPts()) !== e0);
  await page.getByRole("button", { name: "Done" }).click();
  const firstId = (await parcelsLS())[0].id;
  await T(`parcel-row-${firstId}`).click(); await T("parcel-page").waitFor({ timeout: 8000 });
  await T("parcel-page-lock").click(); await sleep(300);
  await T("parcel-page-back").click(); await T("parcels-panel").waitFor();
  await T("parcels-edit-btn").click(); await T("boundary-edit-banner").waitFor({ timeout: 8000 });
  const e1 = await firstPts(); await dragFirst();
  ok("a LOCKED parcel can't be moved even inside Edit parcels", (await firstPts()) === e1);
  await page.getByRole("button", { name: "Done" }).click();

  // ---- reload persists
  await page.reload({ waitUntil: "load" }); await sleep(2500);
  if (!(await T("planner-canvas").isVisible().catch(() => false))) { await page.getByText("ZZ Parcels Rework", { exact: false }).first().click(); await T("planner-canvas").waitFor({ timeout: 25000 }); }
  const persisted = (await parcelsLS()).find((p) => p.id === "p4");
  ok("reload persists the section edit", persisted && persisted.setbacks && persisted.setbacks.some((v) => v === 55));
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
