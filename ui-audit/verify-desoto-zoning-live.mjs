/* verify-desoto-zoning-live — V2014176 (B2563408 / B2563409 / B2563410 / B2507064 ×2): the DeSoto zoning legend grouped by jurisdiction with one code per row, the zone codes printed on the
 * polygons and in the exported PDF, and no false "too detailed to draw" over drawn polygons — LIVE on planyr.io, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-desoto-zoning-live.mjs [https://planyr.io] [--shots <dir>] [--expect-sha <sha>] [--part legend|labels|budget|pdf|all]
 *
 * Judge by the SCREENSHOTS it writes (the legend panel, the map with labels, the exported sheet) — the assertions are a net, not the verdict. FOREGROUND-OR-VOID first; throwaway LOCATED plans are
 * deleted and verified gone (owner rule 15). A run whose known-good arm fails is VOID, never a pass. */
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const SHOTS = flag("--shots", "/tmp/zoning-shots"), PART = flag("--part", "all"), EXPECT_SHA = flag("--expect-sha");
mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidRun = (why) => { console.log(`VOID: ${why}`); voided++; };
const SUFFIX = /\((Olive Branch|Unincorporated|Hernando|Southaven|Horn Lake|Walls)/;   // a jurisdiction suffix — NOT a parenthesis inside an ordinance's own district name ("Residential Single-Family (Low Density)")
const want = (p) => PART === "all" || PART === p;

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-desoto-zoning-live");
await page.setViewportSize({ width: 1500, height: 950 });
const sleep = (ms) => page.waitForTimeout(ms);
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the expected one", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
// the served chunk must carry this change's own string (a deploy marker AND half the acceptance test)
const chunkHasMarker = await page.evaluate(async () => { const m = await fetch("/", { cache: "no-store" }).then((r) => r.text()); return /legend-heading|Zoom in to see zoning here/.test(m); });
console.log(`  index marker present: ${chunkHasMarker} (chunks are lazy, the legend text is read from the page below)`);

const planIds = [];
const insert = async (plan) => {
  const err = await page.evaluate(async ([pl]) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl });
    return error ? String(error.message) : null;
  }, [plan]);
  planIds.push(plan.id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const mk = (tag, lat, lng) => ({ ...throwawayPlan(`${LIVE_PREFIX}zn-${tag}-${Date.now().toString(36)}`), origin: { lat, lon: lng }, site: `ZZ Live Check — zoning ${tag}` });
const openPlan = async (plan) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${plan.id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(3000);
};
const plannerPanel = async () => {
  const chip = page.getByTestId("layers-expand").filter({ visible: true }); if (await chip.count()) await chip.first().click();
  const pp = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await pp.waitFor({ state: "visible", timeout: 20000 }); await sleep(1000);
  return pp;
};
async function zoningOn(pp) {
  for (let i = 0; i < 8; i++) {
    await pp.getByTestId("layer-group-jur").click().catch(() => {}); await sleep(400);
    if (await pp.locator('[data-testid="layer-row-ms_desoto_zoning"]').count()) break;
    await sleep(1500);
  }
  const cb = pp.locator('[data-testid="layer-row-ms_desoto_zoning"] input[type="checkbox"]').first();
  if (!(await cb.count())) return false;
  if (!(await cb.isChecked())) await cb.check();
  await sleep(1500);
  await pp.locator('[data-testid="layer-row-ms_desoto_zoning-menu"], [data-testid="layer-row-ms_desoto_zoning"] button[aria-expanded]').first().click().catch(() => {});
  return true;
}
const readLegend = (pp) => pp.evaluate((root) => {
  const lg = root.querySelector('[data-part="legend"][data-legend="stacked"]');
  if (!lg) return null;
  const heads = [...lg.querySelectorAll('[data-part="legend-heading"]')].map((e) => e.textContent.trim());
  const rows = [...lg.querySelectorAll('[data-part="legend-row"]')].map((e) => { const r = e.getBoundingClientRect(); return { text: e.textContent.trim(), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) }; });
  return { heads, rows };
}, null).catch(() => null);
async function legendCase(tag, lat, lng, { wantHeads, shot, narrow = false }) {
  const plan = mk(tag, lat, lng); await insert(plan);
  if (narrow) await page.setViewportSize({ width: 430, height: 900 });
  await openPlan(plan);
  const pp = await plannerPanel();
  const on = await zoningOn(pp);
  check(`${tag} · the Zoning row is offered and turned on`, on);
  let lg = null;
  for (let i = 0; i < 14 && !(lg && lg.rows.length); i++) { await sleep(1500); lg = await readLegend(pp.locator("xpath=.")); }
  console.log(`  ${tag}: headings ${JSON.stringify(lg && lg.heads)}; rows ${lg ? lg.rows.length : "none"}`);
  if (!lg || !lg.rows.length) { voidRun(`${tag}: the legend never filled — nothing to judge`); return null; }
  check(`${tag} · headings are exactly ${JSON.stringify(wantHeads)}`, JSON.stringify(lg.heads) === JSON.stringify(wantHeads), JSON.stringify(lg.heads));
  check(`${tag} · no row carries a parenthetical jurisdiction suffix`, lg.rows.every((r) => !SUFFIX.test(r.text)), lg.rows.filter((r) => SUFFIX.test(r.text)).map((r) => r.text).join(" | "));
  const tops = lg.rows.map((r) => r.top);
  check(`${tag} · every entry is on its own row (no two rows share a line)`, new Set(tops).size === tops.length && lg.rows.every((r, i) => i === 0 || r.top > lg.rows[i - 1].top), tops.join(","));
  check(`${tag} · every row reads "CODE" or "CODE · Name" and none holds two entries`, lg.rows.every((r) => /^[A-Z0-9][A-Za-z0-9 \-]*( · [^·]+)?$/.test(r.text)), lg.rows.map((r) => r.text).join(" | "));
  await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  return lg;
}

try {
  await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" }); // a page with the Supabase client before inserting
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 60000 });

  if (want("legend")) {
    console.log("── LEGEND (planner, throwaway located plans)");
    const ob = await legendCase("olive-branch", 34.95, -89.83, { wantHeads: ["Olive Branch"], shot: "1-legend-olive-branch-only" });
    const un = await legendCase("unincorporated", 34.90, -89.78, { wantHeads: ["Unincorporated DeSoto County"], shot: "2-legend-unincorporated-only" });
    if (ob) check("known-good · Olive Branch's legend names a code from its own ordinance", ob.rows.some((r) => / · /.test(r.text)));
    if (un) check("known-good · unincorporated legend names a code from the county ordinance", un.rows.some((r) => / · /.test(r.text)));
    await legendCase("narrow", 34.95, -89.83, { wantHeads: ["Olive Branch"], shot: "4-legend-narrow-width", narrow: true });
    await page.setViewportSize({ width: 1500, height: 950 });
  }

  if (want("legend") || want("budget")) {
    console.log("── LEGEND over a view holding both (Map view) + the budget sweep");
    await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" }); await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
    const fp = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
    const setView = async (lat, lng, z) => { await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [lat, lng, z]); };
    await setView(34.93, -89.80, 14); await sleep(1200);
    check("Map view · Zoning is offered and turned on", await zoningOn(fp));
    const msgOf = () => page.evaluate(() => { const row = document.querySelector('[data-surface="finder"] [data-testid="layer-row-ms_desoto_zoning"]'); const t = row && row.parentElement ? row.parentElement.innerText : ""; const m = t.match(/too detailed[^\n]*|Zoom in to see[^\n]*/); return { msg: m ? m[0] : null, polys: document.querySelectorAll(".leaflet-pane path").length }; });
    if (want("legend")) {
      let lg = null;
      for (let i = 0; i < 14 && !(lg && lg.heads.length >= 2); i++) { await sleep(1500); lg = await readLegend(fp.locator("xpath=.")); }
      console.log("  both:", JSON.stringify(lg && lg.heads), lg ? lg.rows.length + " rows" : "");
      if (!lg) voidRun("Map view legend never filled");
      else {
        check("both · two headings, Olive Branch first", lg.heads.length >= 2 && lg.heads[0] === "Olive Branch" && lg.heads.includes("Unincorporated DeSoto County"), JSON.stringify(lg.heads));
        const dupTops = lg.rows.filter((r, i) => lg.rows.findIndex((q) => q.top === r.top) !== i).map((r) => `${r.text}@${r.top}`);
        check("both · no suffix on any row", lg.rows.every((r) => !SUFFIX.test(r.text)), lg.rows.filter((r) => SUFFIX.test(r.text)).map((r) => r.text).join(" | "));
        check("both · one entry per row (no two rows share a line)", dupTops.length === 0, dupTops.join(" | "));
        const codes = lg.rows.map((r) => r.text.split(" · ")[0]);
        console.log("  codes listed under more than one heading:", [...new Set(codes.filter((c, i) => codes.indexOf(c) !== i))].join(", ") || "none");
      }
      await page.screenshot({ path: `${SHOTS}/3-legend-both-jurisdictions.png` });
    }
    if (want("budget")) {
      const seq = [["z13", 34.95, -89.83, 13], ["z12", 34.95, -89.83, 12], ["z14", 34.95, -89.83, 14], ["z16 OB", 34.95, -89.83, 16], ["z17 OB", 34.9525, -89.835, 17], ["z16 east", 34.95, -89.80, 16], ["z16 unincorp", 34.90, -89.78, 16], ["z13 unincorp", 34.90, -89.78, 13], ["z15 OB", 34.95, -89.83, 15]];
      for (const [tag, lat, lng, z] of seq) {
        await setView(lat, lng, z); await sleep(8000);
        const r = await msgOf();
        console.log(`  ${tag.padEnd(14)} polygons ${r.polys}, message ${JSON.stringify(r.msg)}`);
        check(`budget · ${tag} · no count-bearing "too detailed" text`, !r.msg || !/too detailed|\d+k points/.test(r.msg), r.msg || "");
        check(`budget · ${tag} · no refusal message while polygons are drawn`, !(r.msg && r.polys > 0), r.msg || "");
      }
    }
  }

  if (want("labels") || want("pdf")) {
    console.log("── LABELS + PDF (planner, the owner's view)");
    const plan = mk("labels", 34.95, -89.83);
    plan.parcels[0].points = [{ x: -900, y: -900 }, { x: 900, y: -900 }, { x: 900, y: 900 }, { x: -900, y: 900 }]; plan.els[0] = { ...plan.els[0], w: 1600, h: 60 }; // a ~75-acre lot with a long thin building: the exported frame (fitted to the building) is ~1,600 ft wide, so it shows several zoning polygons above and below the strip
    await insert(plan);
    await page.addInitScript(() => { window.__svgBlobs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { try { if (b && /svg/.test(b.type || "")) window.__svgBlobs.push(b); } catch (_) { /* capture only */ } return o(b); }; });
    await openPlan(plan);
    const pp = await plannerPanel();
    check("labels · Zoning is offered and turned on", await zoningOn(pp));
    await pp.locator('[data-testid="layer-row-ms_desoto_zoning-menu"], [data-testid="layer-row-ms_desoto_zoning"] button[aria-expanded]').first().click().catch(() => {}); // close the dropdown for a clean map picture
    await sleep(9000);
    const lab = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip.pf-zone-label")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), x: r.left, y: r.top, w: r.width, h: r.height }; }));
    console.log(`  zone labels on screen: ${lab.length} (${[...new Set(lab.map((l) => l.t))].join(" | ")})`);
    if (lab.length < 2) voidRun("known-good arm: fewer than two zone-code labels on screen at the owner's view — nothing to judge");
    let overlaps = 0;
    for (let i = 0; i < lab.length; i++) for (let j = i + 1; j < lab.length; j++) { const a = lab[i], b = lab[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++; }
    check("labels · no two zone codes overlap", overlaps === 0, `${overlaps} overlapping pairs of ${lab.length}`);
    await page.screenshot({ path: `${SHOTS}/5-map-labels-owner-view.png` });
    if (want("pdf")) {
      await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
      await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }); await sleep(900);
      await page.locator('button:has-text("Continue ➜")').first().click({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 }); await sleep(4000);
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 })]);
      const pdfPath = `${SHOTS}/6-export.pdf`; await dl.saveAs(pdfPath);
      const drawn = await page.evaluate(async () => { const out = []; for (const b of window.__svgBlobs || []) { const t = await b.text(); const d = new DOMParser().parseFromString(t, "image/svg+xml"); d.querySelectorAll("text").forEach((e) => out.push(e.textContent.trim())); } return out; });
      const onScreen = new Set(lab.map((l) => l.t));
      const codes = drawn.filter((t) => /^[A-Z][A-Z0-9\-]{0,5}$/.test(t) && onScreen.has(t));
      console.log(`  the export drew ${drawn.length} text items; zone codes: ${[...new Set(codes)].join(" | ") || "none"}`);
      check("pdf · the export draws the zone codes that show on screen (PDF-PARITY)", codes.length >= 1, `${codes.length}`);
      try { execFileSync("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", pdfPath, `${SHOTS}/6-export-page`]); console.log(`  rendered the exported page to ${SHOTS}/6-export-page-1.png`); } catch (e) { console.log("  (pdftoppm unavailable — open", pdfPath, "to look at it)"); }
    }
  }
} finally {
  for (const id of planIds) { const r = await cleanupLive(page, { planId: id }); check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, !r.errors.length && r.left.site === 0, JSON.stringify(r)); }
  await s.browser?.close?.();
}
console.log(voided ? `\nVOID (${voided} void note(s)) — not a pass.` : failed ? `\n${failed} check(s) FAILED.` : "\nAll checks passed.");
process.exit(voided || failed ? 1 : 0);
