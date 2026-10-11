/* verify-setback-collapse — NEW-1 loud failure: setbacks wider than the lot say so, on the page AND the plan.
 *
 * Two throwaway lots: "Fine Lot" (400 ft square, 25 ft setbacks) and "Narrow Lot" (100 ft wide, 60 ft setbacks
 * each side -> nothing left to build). KNOWN-GOOD ARM: the Fine lot must show NO warning; the run is VOID if it does,
 * or if the Narrow lot's setback ring is not drawn at all (then the badge could not be the thing under test).
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs.
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push(!!cond); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const SITE_ID = "zz-sbcollapse-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Setback Collapse", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [
    { id: "fine", points: rect(0, 0, 400, 400), setbacks: [25, 25, 25, 25], label: "Fine Lot", source: "drawn" },
    { id: "narrow", points: rect(500, 0, 100, 400), setbacks: [60, 60, 60, 60], label: "Narrow Lot", source: "drawn" },
  ],
  els: [], measures: [], callouts: [], markups: [], settings: { showSetback: true }, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};
let browser, ctx, page, UID = null;
if (process.env.SIGNED_IN) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch {} }, site);
}
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (process.env.SIGNED_IN) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Setback Collapse", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-setback-collapse");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  const rings = await T("setback-ring").count();
  if (rings < 1) throw new Error(`VOID: no setback ring drawn (${rings}) — the instrument cannot see the effect`);
  const badges = await T("setback-collapsed-badge").count();
  ok("canvas: exactly ONE lot (the narrow one) carries the 'no buildable area' badge", badges === 1, `badges=${badges}`);
  ok("canvas: the badge says the setbacks exceed the parcel", /Setbacks exceed parcel — no buildable area/.test((await T("setback-collapsed-badge").first().innerText().catch(() => "")) || await T("setback-collapsed-badge").first().textContent()));
  // page: open each lot's page
  const open = async (id) => { if (!(await T("parcels-panel").isVisible().catch(() => false))) await page.locator('[data-rail-tab="parcel"]').first().click(); await T("parcels-panel").waitFor({ timeout: 15000 }); await T(`parcel-row-${id}`).click(); await T("parcel-page").waitFor({ timeout: 8000 }); await sleep(300); };
  await open("fine");
  ok("KNOWN-GOOD: the Fine lot's page shows NO collapse warning", (await T("setback-sections").count()) === 1 && (await T("setback-collapsed").count()) === 0);
  await T("parcel-page-back").click(); await sleep(200);
  await open("narrow");
  ok("the Narrow lot's Setbacks section shows the alert", (await T("setback-collapsed").count()) === 1);
  await T("setback-all").locator("input").first().fill("10").catch(() => {}); await page.keyboard.press("Enter"); await sleep(400);
  ok("fixing the setback (10 ft) clears the alert", (await T("setback-collapsed").count()) === 0);
} catch (e) { console.log("ERROR —", e.message); results.push(false); }
await browser.close();
const pass = results.every(Boolean);
console.log(pass ? "ALL PASS" : "FAILURES"); process.exit(pass ? 0 : 1);
