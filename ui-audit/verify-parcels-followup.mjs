/* verify-parcels-followup — B2191xxx (the Parcels page follow-up) on the owner's REAL Silvestri outlines.
 *
 * Seeds a throwaway site with the three real parcels (test/fixtures/silvestriParcels.json — SCHIEL with its real
 * county record, "Parcel 2", "TRS 1B-10") and the real roads, then drives the parcel page and asserts:
 *   NEW-1  each parcel shows <= 6 sections · no two sketch labels overlap · the WHOLE Setbacks section fits inside the
 *          panel's visible height (no scrolling to reach it) · clicking a sketch section opens its inline editor ·
 *          the panel is not a render loop (idle mutation count + long tasks while the page is open)
 *   NEW-2  SCHIEL's record: Owner BAUER HOCKLEY 550 LP · Account 0421030000123 · Address SCHIEL RD · Deed acres 63.85 ·
 *          the list row reads "<CAD> · 0421030000123" · no Geometry check / Appraisal data / Taxes blocks
 *   NEW-3  a parcel with no evidence of origin shows NO source chip and no "Drawn"; a parcel stamped drawn says Drawn
 * KNOWN-GOOD ARM: the run is VOID unless the untouched list reports the 3 seeded parcels.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 → ui-audit/lib/signedInSession.mjs.
 */
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const J = JSON.parse(readFileSync(new URL("../test/fixtures/silvestriParcels.json", import.meta.url)));
const P = (a) => a.map(([x, y]) => ({ x, y }));
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE_ID = "zz-followup-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Parcels Followup", name: "Plan 1", origin: { lat: 29.95, lon: -95.7 }, county: "harris",
  parcels: [
    { id: "schiel", label: "SCHIEL", points: P(J.schiel), acct: "634440", addr: "SCHIEL", attrs: J.schielAttrs, gisKey: "oid:634440" },
    { id: "p2", label: "Parcel 2", points: P(J.parcel2) },
    { id: "trs", label: "TRS 1B-10", points: P(J.trs), source: "drawn" },
    // B2194744 — a Harris lot with NO stored acct (36 of 136 real ones): the tax table must still resolve its account from the record.
    { id: "h129", points: P(J.parcel2).map((q) => ({ x: q.x + 6000, y: q.y })), gisKey: "oid:504281", attrs: { OBJECTID: 504281, HCAD_NUM: "0421030000129", acct_num: "0421030000129", owner_name_1: "BAUER HOCKLEY 550 LP", Acreage: "157.9468 AC", tax_year: "2025" } },
  ],
  els: J.roads.map((r, i) => ({ id: "rd" + i, type: "road", pts: P(r.pts), inlineLabel: r.name, width: 40 })),
  measures: [], callouts: [], markups: [], settings: { setback: 25 }, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const SIGNED = !!process.env.SIGNED_IN;
let browser, ctx, page, UID = null;
const errors = [];
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); } } catch (_) {} }, site);
}
// Leaflet's "infinite number of tiles" fires at map mount for this 5,000 ft fixture with tile requests aborted — before any panel opens (probed), so it is the fixture, not the page under test.
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Parcels Followup", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-parcels-followup");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
  const rows = await page.locator('[data-testid^="parcel-table-row-"]').count();
  if (rows !== 4) throw new Error(`VOID: expected the 4 seeded parcels, saw ${rows}`);
  ok("known-good arm: the untouched list shows the 4 seeded parcels", true);

  // ---- NEW-2 list row + NEW-3 origin lines
  const rowText = async (id) => (await T("parcel-table-row-" + id).innerText()).replace(/\s+/g, " ");
  ok("SCHIEL's list row reads 'Harris CAD · 0421030000123' (not the OBJECTID 634440)", /Harris CAD · 0421030000123/.test(await rowText("schiel")) && !/634440/.test(await rowText("schiel")), await rowText("schiel"));
  ok("a parcel with no evidence of origin has no 'Drawn' line", !/Drawn/.test(await rowText("p2")), await rowText("p2"));
  ok("a parcel stamped as drawn says 'Drawn'", /Drawn/.test(await rowText("trs")), await rowText("trs"));

  for (const [id, label] of [["schiel", "SCHIEL"], ["p2", "Parcel 2"], ["trs", "TRS 1B-10"]]) {
    await T("parcel-row-" + id).click();
    await T("parcel-page").waitFor({ timeout: 8000 });
    await T("setback-sections").waitFor({ timeout: 8000 });
    await sleep(500);
    // ---- NEW-1 sections
    const nSketch = await page.locator('[data-testid^="setback-sketch-section-"]').count();
    ok(`${label}: ${nSketch} sections (<= 6)`, nSketch >= 1 && nSketch <= 6);
    // no overlapping labels
    const boxes = await page.locator('[data-testid^="setback-sketch-num-"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    let overlaps = 0;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (!(a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5)) overlaps++; }
    ok(`${label}: ${boxes.length} sketch labels, ${overlaps} overlapping pairs`, boxes.length >= 1 && overlaps === 0);
    // whole Setbacks section visible without scrolling the panel
    await page.evaluate(() => { const s = document.querySelector('[data-testid="parcel-page"]'); let p = s; while (p && p.scrollHeight <= p.clientHeight + 1) p = p.parentElement; if (p) p.scrollTop = 0; });
    const fit = await T("setback-sections").evaluate((sec) => {
      let p = sec.parentElement; while (p && p !== document.body && !(p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
      const r = sec.getBoundingClientRect(), pr = (p && p !== document.body ? p : document.documentElement).getBoundingClientRect();
      return { secH: r.height, panelH: pr.height, secBottom: r.bottom, panelBottom: pr.bottom, hasScroller: !!(p && p !== document.body) };
    });
    ok(`${label}: Setbacks section is ${Math.round(fit.secH)}px tall in a ${Math.round(fit.panelH)}px panel — fits without scrolling`, fit.secH <= fit.panelH - 8, JSON.stringify(fit));
    // no per-section full list: rows only for sections that differ (uniform parcel -> none)
    ok(`${label}: no per-section list when every section shares the setback`, (await page.locator('[data-testid="setback-section-row"]').count()) === 0);
    ok(`${label}: one line 'Setback [25] ft · all sections'`, /Setback\s*25\s*ft · all sections/.test((await T("setback-all").innerText()).replace(/\s+/g, " ")) || (await T("setback-all").locator("input").first().inputValue()) === "25");
    // click a sketch section -> inline editor
    await page.locator('[data-testid^="setback-sketch-section-"]').first().click();
    await sleep(250);
    ok(`${label}: clicking a sketch section opens its inline editor`, (await page.locator('[data-testid="setback-section-row"]').count()) === 1);
    if (id === "schiel") await shot("followup-schiel");
    await page.locator('[data-testid^="setback-sketch-section-"]').first().click(); // toggle off
    await T("parcel-page-back").click();
    await T("parcels-panel").waitFor();
  }

  // ---- NEW-2 SCHIEL county record
  await T("parcel-row-schiel").click();
  await T("parcel-page").waitFor();
  const src = (await T("parcel-source").innerText()).replace(/\s+/g, " ");
  ok("SCHIEL record: Owner BAUER HOCKLEY 550 LP", /BAUER HOCKLEY 550 LP/.test(src), src);
  ok("SCHIEL record: Account 0421030000123", /Account\s*0421030000123/.test(src), src);
  ok("SCHIEL record: Address SCHIEL RD", /Address\s*SCHIEL RD/.test(src), src);
  ok("SCHIEL record: Deed acres 63.85 next to drawn acres", /Deed acres\s*63\.85/.test(src) && /drawn/.test(src), src);
  const pageText = (await T("parcel-page").innerText()).replace(/\s+/g, " ");
  ok("the old Geometry check / APPRAISAL DATA / TAXES blocks are gone", !/Geometry check|Appraisal data|Taxes|Rate source/i.test(pageText), pageText.slice(0, 200));
  ok("'More county fields' disclosure sits inside the record", (await T("parcel-more-fields").count()) === 1);
  await shot("followup-record");

  // ---- B2194744 tax table for a Harris lot with no stored acct (needs the live /api/taxunits — a real deploy, not the preview)
  if (/^https:/.test(BASE)) {
    await T("parcel-page-back").click(); await T("parcels-panel").waitFor();
    await T("parcel-row-h129").click(); await T("parcel-page").waitFor();
    const tt = await T("parcel-tax-table").waitFor({ timeout: 20000 }).then(() => true, () => false);
    ok("the 158.20-style Harris lot (no stored acct, HCAD_NUM 0421030000129) shows its tax table", tt);
  } else console.log("SKIP (preview has no /api/taxunits) — the tax-table arm runs only against a deployed https BASE_URL");

  // ---- stall check: the page open and idle must not be a render loop
  const idle = await page.evaluate(() => new Promise((res) => {
    let muts = 0, longs = 0;
    const mo = new MutationObserver((l) => { muts += l.length; }); mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    let po = null; try { po = new PerformanceObserver((l) => { longs += l.getEntries().length; }); po.observe({ entryTypes: ["longtask"] }); } catch (_) {}
    setTimeout(() => { mo.disconnect(); po && po.disconnect(); res({ muts, longs }); }, 3000);
  }));
  ok(`idle with the parcel page open: ${idle.muts} DOM mutations and ${idle.longs} long tasks in 3 s (no render loop)`, idle.muts <= 20 && idle.longs <= 1, JSON.stringify(idle));
  const t0 = Date.now();
  await page.screenshot({ type: "png", timeout: 8000 });
  ok(`a screenshot of the page completes (${Date.now() - t0} ms)`, true);
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
