/* B2081248 / V1502416 — Georgia site screening, SIGNED IN on the real deploy, as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-georgia-layers-signed-in.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>] [--only state|paint|analysis|houston|print]
 *
 * One signed-in browser. Every plan is a throwaway on the test account (zz-ga-*) written to its own cloud rows, and
 * DELETED again in `finally` with the deletion verified (owner rule 15: test artifacts are always cleared). Michael's
 * real projects are never opened. /version.json is read IN THE SAME CALL as each phase's assertions.
 *   STATE     a Braselton (I-85) and a Rincon (Effingham Co.) plan list the eight Georgia rows and no Texas row; toggling
 *             every Georgia row on and off leaves the map's zoom/offset numerically identical (the no-move rule).
 *   PAINT     each Georgia layer, over a plan placed ON its registry fixture, requests its host, gets 200, raises no
 *             failure toast, and DRAWS.
 *   ANALYSIS  the Georgia Analysis panel: Texas-only checks read "not screened", never clear; Georgia cards present.
 *   HOUSTON   a Katy plan: Texas rows listed, no Georgia row in the main list, Texas Analysis unchanged.
 *   PRINT     File → Export PDF with stream buffers + hazardous sites + slope on produces a PDF. */
import { openSignedIn, signInViaRoute } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const ROWS = args.includes("--rows") ? args[args.indexOf("--rows") + 1].split(",") : null;
const want = (p) => !ONLY || ONLY === p;
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const TAG = Math.random().toString(36).slice(2, 6);
const mk = (key, lat, lon, county) => {
  const id = `zz-ga-${key}-${TAG}`;
  return { id, groupId: id, site: `zz Georgia check ${key}`, name: "Plan 1", origin: { lat, lon }, county,
    parcels: [{ id: "pc1", active: true, locked: true, points: [{ x: -535, y: -535 }, { x: 535, y: -535 }, { x: 535, y: 535 }, { x: -535, y: 535 }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active" };
};
const created = [];
const s = await openSignedIn({ base, contextOptions: { acceptDownloads: true } });
const { page } = s;
const TEXAS_ROW = /Oil & gas|Pipelines? (?!\(approx)|HCFCD|BKDD|TxDOT|ETJ|MUD\b|CCN|Leaking|growth fault|Harris|Fort Bend|Brookshire|City of Houston/i;
const GA_ROWS = ["Hazardous sites (Georgia EPD)", "Historic places (National Register)", "Cemeteries (incomplete)", "Critical habitat (USFWS)", "Gopher tortoise soils (DNR)", "Trout streams (Georgia DNR)", "Stream buffers (Georgia)", "Slope classes"];

async function ready() { // pfSupabase can be missing after a failed step: go back to the base page and sign in again if needed
  const ok = () => page.evaluate(async () => { try { if (!window.pfSupabase) return false; const { data } = await window.pfSupabase.auth.getUser(); return !!(data && data.user); } catch (_) { return false; } }).catch(() => false);
  if (await ok()) return;
  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 }).catch(() => {});
  if (!(await ok())) await signInViaRoute(page, process.env.E2E_LOGIN_KEY);
}
async function openLayers() {
  for (let i = 0; i < 3; i++) {
    if (await page.locator("label:visible", { hasText: /FEMA flood/ }).count()) return true;
    try { await page.locator("button:visible", { hasText: "Layers" }).first().click({ timeout: 6000 }); } catch (_) {}
    await page.locator("label:visible", { hasText: /FEMA flood/ }).first().waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  }
  return !!(await page.locator("label:visible", { hasText: /FEMA flood/ }).count());
}
async function plan(site) {
  await ready();
  const ins = await page.evaluate(async (st) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, site);
  if (ins) throw new Error("could not write throwaway plan: " + ins);
  created.push(site.id);
  await page.goto(`${base}/#/project/${site.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(5000);
  await openLayers();
  await page.waitForTimeout(1200);
}
async function drop(id) {
  await ready();
  // Leave the plan FIRST: while it is open the app autosaves it, and that write re-creates the row we just deleted
  // (measured 2026-10-08: a delete issued with the plan open read "gone" and the row was back seconds later).
  await page.goto(`${base}/#/`, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(2500);
  const del = () => page.evaluate(async (i) => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[i]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      await window.pfSupabase.from("site_elements").delete().eq("site_id", i);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", i);
      await window.pfSupabase.from("sites").delete().eq("id", i);
    } catch (e) { return String(e); }
    return null;
  }, id);
  await del();
  await page.waitForTimeout(4000); // let any in-flight autosave land, then verify — and delete again if it did
  const probe = () => page.evaluate(async (i) => {
    const q = await window.pfSupabase.from("sites").select("id").eq("id", i);
    return { local: !JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[i], cloud: !(q.data && q.data.length) };
  }, id).catch((e) => ({ error: String(e) }));
  let r = await probe();
  if (!r.cloud || !r.local) { await del(); await page.waitForTimeout(4000); r = await probe(); }
  return r;
}
const served = () => page.evaluate(async () => ({ build: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null), chunks: [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 2) }));
const labels = () => page.evaluate(() => [...document.querySelectorAll("label")].filter((l) => l.offsetParent !== null).map((l) => l.innerText.trim()).filter(Boolean));
const bodyText = () => page.evaluate(() => document.body.innerText);
const viewOf = () => page.evaluate(() => { const e = document.querySelector("[data-view-ppf]"); return e ? [e.dataset.viewPpf, e.dataset.viewOffx, e.dataset.viewOffy].join("|") : null; });
const geom = () => page.evaluate(() => document.querySelectorAll(".leaflet-pane svg path").length + document.querySelectorAll(".leaflet-pane canvas").length + document.querySelectorAll(".leaflet-overlay-pane img, .leaflet-pane img.leaflet-image-layer").length);

try {
  await assertMeasurable(page, "verify-georgia-layers-signed-in");
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  if (expectSha) check("the deploy serves the build under test", String(s.build?.build || "").startsWith(expectSha.slice(0, 7)), `served ${s.build?.build}, expected ${expectSha.slice(0, 7)}`);

  if (want("state")) for (const [key, lat, lon, county, name] of [["pied", 34.1099, -83.7632, "ga_gwinnett", "Piedmont (Braselton, I-85)"], ["coast", 32.2965, -81.2354, "ga_effingham", "Coastal (Rincon, Effingham Co.)"]]) {
    console.log(`\n— STATE: ${name} —`);
    const st = mk(key, lat, lon, county); await plan(st);
    const L = await labels(); const b = await served();
    console.log("   build at assertion:", b.build, b.chunks.join(" "));
    for (const g of GA_ROWS) check(`lists "${g}"`, L.some((l) => l.includes(g)));
    check("no Texas row in the main list", !L.some((l) => TEXAS_ROW.test(l)), L.filter((l) => TEXAS_ROW.test(l)).join(" | "));
    check("Texas rows named behind a collapsed 'not available in Georgia' line", /not available in Georgia/i.test(await bodyText()));
    check("national rows remain (FEMA flood, Wetlands)", L.some((l) => /FEMA flood/i.test(l)) && L.some((l) => /Wetlands/i.test(l)));
    const before = await viewOf();
    for (const g of GA_ROWS) { try { await page.locator("label:visible", { hasText: g }).first().locator('input[type="checkbox"]').check({ timeout: 3000 }); } catch (_) {} }
    await page.waitForTimeout(8000);
    const mid = await viewOf();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/state-${key}-all-on.png` });
    const errTxt = await bodyText();
    check("no failure toast with all eight on", !/layer failed|no vector source|couldn.t load/i.test(errTxt), (errTxt.match(/[^\n]*(?:layer failed|no vector source|couldn.t load)[^\n]*/i) || [""])[0]);
    for (const g of GA_ROWS) { try { await page.locator("label:visible", { hasText: g }).first().locator('input[type="checkbox"]').uncheck({ timeout: 3000 }); } catch (_) {} }
    await page.waitForTimeout(1500);
    const after = await viewOf();
    check("NO-MOVE: all eight on, then off — map zoom/offset identical", before != null && before === mid && mid === after, `${before} → ${mid} → ${after}`);
  }

  if (want("paint")) for (const [row, id, lon, lat, needle, county] of [
    ["Hazardous sites (Georgia EPD)", "hsi", -84.4011, 33.7453, "2025_HSI", "ga_fulton"], ["Historic places (National Register)", "nrhp", -84.3894, 33.7503, "nrhp_points_v1", "ga_fulton"],
    ["Cemeteries (incomplete)", "cem", -84.3734, 33.755, "structures/MapServer/37", "ga_fulton"], ["Critical habitat (USFWS)", "ch", -84.4966, 33.4124, "USFWS_Critical_Habitat", "ga_upson"],
    ["Gopher tortoise soils (DNR)", "gt", -84.15, 31.55, "GopherTortoiseSoils", "ga_dougherty"], ["Trout streams (Georgia DNR)", "tr", -83.8921, 34.6906, "Georgia_Trout_Streams", "ga_white"],
    ["Stream buffers (Georgia)", "sb", -83.8921, 34.6906, "nhd/MapServer/6", "ga_white"], ["Slope classes", "sl", -84.0, 34.05, "3DEPElevation/ImageServer", "ga_gwinnett"]]) {
    if (ROWS && !ROWS.includes(id)) continue;
    console.log(`\n— PAINT: ${row} —`);
    const seen = []; const onResp = (r) => { if (r.url().includes(needle)) seen.push(r.status()); }; page.on("response", onResp);
    const st = mk(id, lat, lon, county); await plan(st);
    const lab = page.locator("label:visible", { hasText: row }).first();
    let present = true; try { await lab.waitFor({ state: "visible", timeout: 25000 }); } catch (_) { present = false; }
    if (!present) { console.log("   row not seen — reloading once and reopening the Layers panel"); await page.reload({ waitUntil: "load" }); await page.waitForTimeout(6000); await openLayers(); try { await lab.waitFor({ state: "visible", timeout: 20000 }); present = true; } catch (_) {} }
    check("row present in the main list", present);
    if (!present) {
      const t = await bodyText();
      console.log("   DIAG folds on screen:", (t.match(/[^\n]*(?:not available in|don.t cover this site|no local data here)[^\n]*/gi) || []).join(" | "));
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/missing-${id}.png` });
    }
    if (present) {
      const g0 = await geom();
      await lab.locator('input[type="checkbox"]').first().check();
      await page.waitForTimeout(11000);
      const g1 = await geom(); const t = await bodyText(); const b = await served();
      if (!seen.length) { console.log("   VOID (live-GIS) — the browser never reached this layer's host"); voided++; }
      else {
        check("requested its own service, got 200", seen.some((x) => x === 200), JSON.stringify(seen.slice(0, 5)));
        check("no failure toast", !/layer failed|no vector source|couldn.t load/i.test(t));
        check("it DRAWS over its known feature", g1 > g0, `${g0} → ${g1} map shapes`);
      }
      console.log("   build at assertion:", b.build);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/paint-${id}.png` });
    }
    page.off("response", onResp);
    const gone = await drop(st.id); created.splice(created.indexOf(st.id), 1);
    check("throwaway plan cleared", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  }

  const openAnalysis = async () => {
    if (!(await page.locator('[data-site-analysis="1"]').count())) await page.locator('button[title="Analysis"]').click();
    await page.waitForSelector('[data-site-analysis="1"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking the maps"), null, { timeout: 120000 });
    await page.waitForTimeout(800);
    return page.evaluate(() => ({ text: document.querySelector('[data-site-analysis="1"]').innerText.replace(/\s+/g, " "), rows: [...document.querySelectorAll("[data-check-row]")].map((r) => ({ id: r.dataset.checkRow, sev: r.dataset.severity, text: r.innerText.replace(/\s+/g, " ").trim() })) }));
  };

  if (want("analysis")) {
    console.log("\n— ANALYSIS: Braselton (Georgia) —");
    const st = mk("an", 34.1099, -83.7632, "ga_gwinnett"); await plan(st);
    const a = await openAnalysis(); const b = await served();
    console.log("   build at assertion:", b.build);
    for (const r of a.rows) console.log(`   • ${r.id}: ${r.sev} · ${r.text.slice(0, 140)}`);
    console.log("   panel:", a.text.slice(0, 700));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/analysis-georgia.png` });
    check("the Georgia panel names Georgia, never a Texas institution as the source", /Georgia/.test(a.text) && !/\bRRC\b|Railroad Commission|TCEQ|TxDOT|Texas/.test(a.text), (a.text.match(/RRC|Railroad Commission|TCEQ|TxDOT|Texas/g) || []).join(","));
    check("a Texas-only check reads 'Not screened in Georgia' (never a clean None)", /Not screened in Georgia/i.test(a.text) || a.rows.every((r) => !["pipelines", "wells"].includes(r.id)));
    check("no Texas verdict row (wells / pipelines) shows a green 'None' on Georgia ground", a.rows.filter((r) => ["pipelines", "wells"].includes(r.id)).every((r) => r.sev !== "green"));
    check("ETJ / school-district never claim a Texas answer", !/Texas|ETJ: None found|ISD/.test(a.text) || /None in Georgia|Not screened in Georgia/i.test(a.text));
    check("it names the Georgia city and county (Braselton, GA · Jackson County) from the Georgia county layer", /Braselton, GA/.test(a.text) && /Jackson County/.test(a.text));
    const gone = await drop(st.id); created.splice(created.indexOf(st.id), 1);
    check("throwaway plan cleared", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  }

  if (want("houston")) {
    console.log("\n— HOUSTON known-good: Katy (Texas) —");
    const st = mk("hou", 29.7858, -95.8244, "harris"); await plan(st);
    const L = await labels(); const b = await served();
    console.log("   build at assertion:", b.build);
    check("Texas rows are listed", L.some((l) => /Oil & gas|HCFCD|Pipelines/i.test(l)), L.filter((l) => TEXAS_ROW.test(l)).slice(0, 4).join(" | "));
    check("no Georgia row in the main list", !GA_ROWS.some((g) => L.some((l) => l.includes(g))), GA_ROWS.filter((g) => L.some((l) => l.includes(g))).join(" | "));
    const a = await openAnalysis();
    for (const r of a.rows) console.log(`   • ${r.id}: ${r.sev} · ${r.text.slice(0, 100)}`);
    check("Texas Analysis unchanged: the five verdict rows are there", ["flood100", "flood500", "wetlands", "pipelines", "wells"].every((k) => a.rows.some((r) => r.id === k)), a.rows.map((r) => r.id).join(","));
    check("Texas panel never says 'Not screened in Georgia'", !/Not screened in Georgia/i.test(a.text));
    const gone = await drop(st.id); created.splice(created.indexOf(st.id), 1);
    check("throwaway plan cleared", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  }

  if (want("print")) {
    console.log("\n— PRINT: PDF with buffers + hazardous sites + slope on —");
    const st = mk("pr", 33.7453, -84.4011, "ga_fulton"); await plan(st);
    for (const g of ["Hazardous sites (Georgia EPD)", "Stream buffers (Georgia)", "Slope classes"]) { try { await page.locator("label:visible", { hasText: g }).first().locator('input[type="checkbox"]').check({ timeout: 5000 }); } catch (_) { console.log("   could not tick", g); } }
    await page.waitForTimeout(10000);
    await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 });
    await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 });
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Continue ➜$/ }).first().click({ timeout: 8000 });
    await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
    const dl = page.waitForEvent("download", { timeout: 90000 });
    await page.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 });
    let ok = false, detail = "";
    try { const d = await dl; const path = await d.path(); const buf = fs.readFileSync(path); ok = buf.slice(0, 5).toString() === "%PDF-" && buf.length > 20000; detail = `${d.suggestedFilename()} ${buf.length} bytes`; if (SHOTS) fs.copyFileSync(path, `${SHOTS}/print-georgia.pdf`); } catch (e) { detail = String(e); }
    const b = await served(); console.log("   build at assertion:", b.build);
    check("a real PDF downloads with the three Georgia layers on", ok, detail);
    const gone = await drop(st.id); created.splice(created.indexOf(st.id), 1);
    check("throwaway plan cleared", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  }
} finally {
  for (const id of created) { const gone = await drop(id); check(`cleanup ${id}`, !!gone.local && !!gone.cloud, JSON.stringify(gone)); }
  try { // final prefix sweep: anything of ours that an autosave re-created is removed, and re-checked after a longer settle
    await ready(); await page.goto(`${base}/#/`, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(6000);
    const sweep = () => page.evaluate(async (tag) => {
      const q = await window.pfSupabase.from("sites").select("id").like("id", `zz-ga-%-${tag}`);
      const ids = (q.data || []).map((r) => r.id);
      for (const i of ids) { await window.pfSupabase.from("site_elements").delete().eq("site_id", i); await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", i); await window.pfSupabase.from("sites").delete().eq("id", i); }
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); for (const k of Object.keys(all)) if (k.startsWith("zz-ga-") && k.endsWith("-" + tag)) delete all[k]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      const q2 = await window.pfSupabase.from("sites").select("id,deleted_at").like("id", `zz-ga-%-${tag}`);
      const rest = q2.data || []; // a trashed row is invisible to the app; the hard delete can lag (its guard trigger scans the whole table)
      return { found: ids, left: rest.filter((r) => !r.deleted_at).map((r) => r.id), trashedLeft: rest.filter((r) => r.deleted_at).length };
    }, TAG);
    let r = await sweep(); await page.waitForTimeout(8000); r = await sweep();
    check("final sweep: no zz-ga-* plan of this run is still LIVE in the cloud (trashed leftovers are reported)", r.left.length === 0, JSON.stringify(r));
  } catch (e) { check("final sweep ran", false, String(e)); }
  await s.close();
}
console.log(voided ? `\n⚠ ${voided} arm(s) void (host unreachable)` : "");
console.log(failed ? `\n❌ ${failed} check(s) FAILED` : "\n✅ all checks passed");
process.exit(failed ? 1 : 0);
