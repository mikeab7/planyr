/* verify-setback-sections-academy — NEW-1 (owner 2026-11-06): "Fix the setback tool for odd shapes. On the north and south I
 * can't cleanly add a setback."  Drives the REAL parcel page on the owner's actual Academy › Concept A outline
 * ("Parcel 1 · A", test/fixtures/academySplitParcel.json — copied read-only from production), seeded as a THROWAWAY site
 * (never the owner's plan), and asserts:
 *   1. the sketch shows 3-6 sections, the top-right piece is part of the NORTH (no section starts at vertex 51) and the
 *      south-west end is part of the SOUTH (no section starts at vertex 18), the east side starts at the NE corner;
 *   2. "Split or join sections" sits directly under the sketch (visible with no scrolling) and draws far fewer dots than
 *      the 52 vertices, with every break drawn as a filled break dot;
 *   3. setting a value on the section that holds the north piece (edge 51) moves ONLY north edges in the stored plan,
 *      and the south value is untouched.
 *   4. (NEW-1, owner 2026-11-09) the OTHER half of that split, "Parcel 1 · B" (test/fixtures/academyNwStubParcel.json, the live
 *      36-vertex lot e1455728kcnnhx): the short northwest corner piece (edges 24-25) is NOT part of the west section — the
 *      sketch has sections starting at vertex 15 (west), 24 (the corner piece) and 26 (the curve); setting the WEST value
 *      moves only edges 15-23 in the stored plan and leaves edges 24-25 alone. RED on a build of main.
 * KNOWN-GOOD ARM: the run is VOID unless the seeded parcel is listed and the page opens with its sketch.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 → ui-audit/lib/signedInSession.mjs (the test account; the throwaway
 * site is removed again at the end — constraint #15).
 */
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { cleanupLive } from "./lib/liveFixtures.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const J = JSON.parse(readFileSync(new URL("../test/fixtures/academySplitParcel.json", import.meta.url)));
const NWJ = JSON.parse(readFileSync(new URL("../test/fixtures/academyNwStubParcel.json", import.meta.url)));
const P = (a) => a.map(([x, y]) => ({ x, y }));
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SITE_ID = "zz-academy-" + Math.random().toString(36).slice(2, 7);
const SITE_B_ID = "zz-nwstub-" + Math.random().toString(36).slice(2, 7);
const mkSite = (id, name, parcel) => ({
  id, groupId: id, site: name, name: "Concept A", origin: { lat: 29.6122, lon: -95.6693 }, county: "fortbend",
  parcels: [parcel],
  els: [], measures: [], callouts: [], markups: [], settings: { setback: 25 }, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});
// two SEPARATE throwaway sites: the two halves of the split overlap each other, and in one site each would read the other as a neighbour
const site = mkSite(SITE_ID, "ZZ Academy Setbacks", { id: "acad", label: "Parcel 1 · A", points: P(J.points), setbacks: J.points.map(() => 25), source: "drawn" });
const siteB = mkSite(SITE_B_ID, "ZZ Nwstub Setbacks", { id: "acadb", label: "Parcel 1 · B", points: P(NWJ.points), setbacks: NWJ.points.map(() => 25), source: "drawn" });

const SIGNED = !!process.env.SIGNED_IN;
let browser, ctx, page, UID = null;
const errors = [];
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, a, b]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [a.id]: a, [b.id]: b })); localStorage.setItem("planarfit:currentSite:v1", a.id); }, [UID, site, siteB]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript(([a, b]) => { try { if (!localStorage.getItem("zz-seeded-" + a.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [a.id]: a, [b.id]: b })); localStorage.setItem("planarfit:currentSite:v1", a.id); localStorage.setItem("zz-seeded-" + a.id, "1"); } } catch (_) {} }, [site, siteB]);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);

/* The stored per-edge setbacks of the seeded parcel, read from the device copy the planner autosaves to. */
const storedSetbacks = (parcelId = "acad", siteId = SITE_ID) => page.evaluate(async ({ id, key, pid }) => {
  const raw = window.__planyrSitesRaw ? window.__planyrSitesRaw(key) : localStorage.getItem(key);
  let all = null;
  try { all = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (_) { all = null; }
  const list = all ? (Array.isArray(all) ? all : Object.values(all)) : [];
  const s = list.find((x) => x && x.id === id) || (all && all[id]);
  const pc = s && (s.parcels || []).find((p) => p.id === pid);
  return pc ? pc.setbacks : null;
}, { id: siteId, key: SIGNED ? "planarfit:sites:cloud:" + UID : "planarfit:sites:v1", pid: parcelId });

let failed = true;
try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await page.getByText("ZZ Academy Setbacks", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-setback-sections-academy");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
  await T("parcel-row-acad").click();
  await T("parcel-page").waitFor({ timeout: 8000 });
  await T("setback-sections").waitFor({ timeout: 8000 });
  await sleep(500);
  const keys = async () => (await page.locator('[data-testid^="setback-sketch-section-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid").replace("setback-sketch-section-", ""))));
  let ks = await keys();
  if (ks.length < 3) throw new Error(`VOID: the seeded 52-vertex parcel should show 3-6 sections, the page showed ${ks.length}`);
  ok("known-good arm: the seeded parcel opens with its sketch", true, ks.join(" "));

  // 1. grouping
  ok(`${ks.length} sections (3-6)`, ks.length >= 3 && ks.length <= 6);
  ok("the top-right piece is part of the north: no section starts at vertex 51", !ks.includes("s51"), ks.join(" "));
  ok("the south-west end is part of the south: no section starts at vertex 18", !ks.includes("s18"), ks.join(" "));
  ok("the east side starts at the north-east corner (vertex 0) and the south at vertex 4", ks.includes("s0") && ks.includes("s4"), ks.join(" "));

  // 2. Split / join: reachable under the sketch, few dots
  const btn = T("setback-split-join");
  const geo = await page.evaluate(() => {
    const sk = document.querySelector('[data-testid="setback-sketch"]').getBoundingClientRect();
    const b = document.querySelector('[data-testid="setback-split-join"]').getBoundingClientRect();
    return { skBottom: sk.bottom, bTop: b.top, bBottom: b.bottom, vh: innerHeight };
  });
  ok("'Split or join sections' sits directly under the sketch, inside the window with no scrolling", geo.bTop >= geo.skBottom - 1 && geo.bTop - geo.skBottom < 40 && geo.bBottom <= geo.vh, JSON.stringify(geo));
  await btn.click();
  await sleep(250);
  const dots = await page.locator('[data-testid^="setback-vertex-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-testid").replace("setback-vertex-", ""), brk: e.getAttribute("data-break") === "1" })));
  ok(`${dots.length} dots offered (not all 52 vertices)`, dots.length >= ks.length && dots.length < 26, dots.map((d) => d.id + (d.brk ? "*" : "")).join(" "));
  ok("every section start is a filled break dot", ks.every((k) => dots.some((d) => d.id === k.slice(1) && d.brk)));
  await btn.click();

  // 3. set the section that holds the top-right piece; only north edges change
  await page.locator(`[data-testid="setback-sketch-section-${ks.find((k) => k === "s46") || "s46"}"]`).click();
  await sleep(300);
  const row = page.locator('[data-testid="setback-section-row"]').first();
  await row.waitFor({ timeout: 5000 });
  const input = row.locator("input").first();
  await input.fill("40"); await input.press("Enter");
  await sleep(1500);
  const sb = await storedSetbacks();
  if (!Array.isArray(sb)) { ok("stored per-edge setbacks could be read back (device copy)", false, "null"); }
  else {
    const changed = sb.map((v, i) => (v === 40 ? i : -1)).filter((i) => i >= 0);
    ok("the value landed on the north: edge 51 (top-right) and edge 48 (curve) are 40", sb[51] === 40 && sb[48] === 40, `40 on ${changed.length} edges`);
    ok("and ONLY north edges: no edge below 46 (west/south/east side) changed", sb.slice(0, 46).every((v) => v === 25), sb.slice(0, 46).filter((v) => v !== 25).length + " other edges differ");
  }

  // 4. the other half of the split: the northwest corner piece is not part of the west section
  await page.evaluate((id) => { localStorage.setItem("planarfit:currentSite:v1", id); }, SITE_B_ID);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await sleep(SIGNED ? 3000 : 1000);
  await page.getByText("ZZ Nwstub Setbacks", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 });
  await T("parcel-row-acadb").click();
  await T("parcel-page").waitFor({ timeout: 8000 });
  await T("setback-sections").waitFor({ timeout: 8000 });
  await sleep(500);
  const ksB = await keys();
  if (ksB.length < 3) throw new Error(`VOID: the seeded 36-vertex parcel should show 3-7 sections, the page showed ${ksB.length}`);
  ok("known-good arm: the second parcel opens with its sketch", true, ksB.join(" "));
  ok("the west side starts at the south-west corner (vertex 15) and the curve at vertex 26", ksB.includes("s15") && ksB.includes("s26"), ksB.join(" "));
  ok("the northwest corner piece is its OWN section (starts at vertex 24), not part of the west", ksB.includes("s24"), ksB.join(" "));
  ok(`${ksB.length} sections (3-7)`, ksB.length >= 3 && ksB.length <= 7);
  await page.locator('[data-testid="setback-sketch-section-s15"]').click();
  await sleep(300);
  const rowB = page.locator('[data-testid="setback-section-row"][data-selected="1"]').first();
  await rowB.waitFor({ timeout: 5000 });
  const inputB = rowB.locator("input").first();
  await inputB.fill("40"); await inputB.press("Enter");
  await sleep(1500);
  const sbB = await storedSetbacks("acadb", SITE_B_ID);
  if (!Array.isArray(sbB)) { ok("stored per-edge setbacks of the second parcel could be read back (device copy)", false, "null"); }
  else {
    const west = sbB.map((v, i) => (v === 40 ? i : -1)).filter((i) => i >= 0);
    ok("the value landed on the WEST side only: edges 15-23 are 40", [15, 16, 17, 18, 19, 20, 21, 22, 23].every((e) => sbB[e] === 40), `40 on edges ${west.join(",")}`);
    ok("and NOT on the northwest corner piece: edges 24 and 25 are still 25", sbB[24] === 25 && sbB[25] === 25, `edge 24 = ${sbB[24]}, edge 25 = ${sbB[25]}`);
    ok("and nothing else moved: every edge outside 15-23 is still 25", sbB.every((v, i) => (i >= 15 && i <= 23) || v === 25), sbB.filter((v, i) => !(i >= 15 && i <= 23) && v !== 25).length + " other edges differ");
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
  failed = results.some((r) => !r.pass);
} finally {
  // constraint #15 + delete-must-verify: the throwaway is removed through the shared helper (trash first — the table refuses a
  // permanent delete of a live row), which re-reads and reports what is left. Anything left, or any error, FAILS the run.
  if (SIGNED && UID) {
    await page.evaluate(([uid, ids]) => { try { const k = "planarfit:sites:cloud:" + uid; const o = JSON.parse(localStorage.getItem(k) || "{}"); for (const id of ids) delete o[id]; localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }, [UID, [SITE_ID, SITE_B_ID]]).catch(() => {});
    for (const planId of [SITE_ID, SITE_B_ID]) {
      const c = await cleanupLive(page, { planId }).catch((e) => ({ errors: [String(e)], left: { site: "?" } }));
      console.log("cleanup", planId, JSON.stringify(c));
      ok(`the throwaway site ${planId} is gone (re-read shows 0 left, no errors)`, c.left && c.left.site === 0 && c.errors.length === 0);
    }
    failed = results.some((r) => !r.pass);
  }
  await browser.close();
}
console.log(`${results.filter((r) => r.pass).length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
