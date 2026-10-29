#!/usr/bin/env node
/* verify-etj-map-layer-live — B2472945 / V1929184. The DRAWN ETJ layer is net of city limits: it paints no ETJ over ground a city's
 * limits hold (the map half of B2472944's header rule). LIVE, signed in as the test account, on THROWAWAY plans it deletes and verifies gone.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-etj-map-layer-live.mjs https://planyr.io [--expect-sha <merge-sha>] [--pre-fix]
 *   node ui-audit/verify-etj-map-layer-live.mjs http://localhost:5199 [--pre-fix]      local dev server, plans seeded in-browser (the instrument proof)
 *
 * Each case inserts a located plan whose saved layer memory has the City limits & ETJ pair ON, opens it, and asks the planner's OWN
 * hit-test (`window.__plannerLayers().identify`, E2E-gated, read-only — the same `identifyAt` the canvas click uses, over the same
 * GeoJSON the map paints) what the ETJ layer has painted at a measured point. Ground truth for every point was measured on the live
 * layers 2026-10-29. KNOWN-GOOD ARM: every case first waits for the layer to PAINT a point of plain ETJ ground and fails (VOID) if it
 * never does, so "nothing painted over the city" can never be the answer of a layer that painted nothing at all. `--pre-fix` inverts
 * the overlap cases (a pre-fix build MUST paint ETJ in the band), proving the instrument sees the defect before it vouches for its absence. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const live = !/localhost|127\.0\.0\.1/.test(base);   // local mode seeds the plans in the browser's own storage (no sign-in, no cloud rows)
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const preFix = args.includes("--pre-fix");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const boxPlan = ([x0, y0, x1, y1]) => {
  const lat = (y0 + y1) / 2, lon = (x0 + x1) / 2, FT = 3.28084;
  const fx = (lng) => (lng - lon) * 111320 * Math.cos((lat * Math.PI) / 180) * FT, fy = (la) => -(la - lat) * 110574 * FT;
  return { lat, lon, pts: [[fx(x0), fy(y1)], [fx(x1), fy(y1)], [fx(x1), fy(y0)], [fx(x0), fy(y0)]] };
};
const squareAt = (lon, lat, half = 300) => ({ lat, lon, pts: [[-half, -half], [half, -half], [half, half], [-half, half]] });

/* [lng, lat] points, each with the ETJ-layer answer expected ("etj" = painted, "none" = nothing painted) and optionally the city
 * layer's (the city line layer paints the limits, so a point inside them must answer on `jur_city`). */
const READY = [-95.6865, 29.622];                  // plain Houston ETJ ground in the Sugar Land cell (known-good arm)
const READY_HUMBLE = [-95.262, 29.950];            // plain Houston ETJ ground in the Humble cell
const CASES = [
  { key: "overlap-band", why: "ground inside Sugar Land's limits that Houston's published ETJ also claims", plan: boxPlan([-95.6700, 29.6235, -95.6640, 29.6275]), ready: READY,
    points: [{ at: [-95.667, 29.6255], etj: "none", city: "Sugar Land", preFix: "etj", label: "in the overlap band" }] },
  { key: "concept-a", why: "Concept A's origin: inside the limits (its real tract's footprint)", plan: boxPlan([-95.6740, 29.6090, -95.6650, 29.6150]), ready: READY,
    points: [{ at: [-95.6693, 29.6122], etj: "none", city: "Sugar Land", label: "Concept A's origin" }] },
  { key: "straddle", why: "a genuine straddle: ETJ stays outside the limits, none inside", plan: boxPlan([-95.6760, 29.6160, -95.6690, 29.6205]), ready: READY,
    points: [{ at: [-95.6755, 29.6165], etj: "etj", label: "ETJ-only corner" }, { at: [-95.6695, 29.6200], etj: "none", city: "Sugar Land", preFix: "etj", label: "limits corner (also in the published ETJ)" }] },
  { key: "houston-etj-only", why: "plain ETJ ground still paints", plan: boxPlan([-95.6900, 29.6200, -95.6830, 29.6240]), ready: READY,
    points: [{ at: READY, etj: "etj", label: "plain Houston ETJ" }] },
  { key: "richmond-etj", why: "another city's own ETJ (Richmond) still paints", plan: squareAt(-95.7200, 29.6000, 120), ready: READY,
    points: [{ at: [-95.7200, 29.6000], etj: "etj", label: "Richmond's own ETJ" }] },
  { key: "unincorporated", why: "plain unincorporated Fort Bend: no ETJ, no city", plan: squareAt(-95.700, 29.6190, 120), ready: READY,
    points: [{ at: [-95.700, 29.6190], etj: "none", city: null, label: "unincorporated" }] },
  { key: "humble", why: "the same overlap elsewhere: Humble's limits under Houston's published ETJ", plan: squareAt(-95.2622, 29.9988), ready: READY_HUMBLE,
    points: [{ at: [-95.2622, 29.9988], etj: "none", city: "Humble", preFix: "etj", label: "Humble centre" }, { at: READY_HUMBLE, etj: "etj", label: "plain Houston ETJ near Humble" }], cityReady: [-95.2622, 29.9988] },
];

const mkSite = (id, c) => ({
  schemaVersion: 12, id, groupId: id, site: "zz ETJ map check " + c.key, name: "Plan 1", origin: { lat: c.plan.lat, lon: c.plan.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: c.plan.pts.map(([x, y]) => ({ x, y })), active: true, z: 0 }],
  layerOverrides: { jur_city: true, jur_etj: true },
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
});

const made = [];
const planIds = Object.fromEntries(CASES.map((c) => [c.key, "zz-etj-map-" + c.key + "-" + Math.random().toString(36).slice(2, 7)]));
let page, closeAll, s = null;
if (live) {
  s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; closeAll = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  page = await ctx.newPage();
  const store = Object.fromEntries(CASES.map((c) => [planIds[c.key], mkSite(planIds[c.key], c)]));
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) { /* storage blocked */ } }, JSON.stringify(store));
  closeAll = () => browser.close();
  console.log("local mode — plans seeded in the browser, no cloud rows");
}
/* ATOMIC PROBE. A layer repaints while the plan re-frames (`lastFc` is swapped), so "nothing painted at P" is only believable when a
 * KNOWN-GOOD point of the SAME layer answered in the SAME synchronous call. `probe` returns the answer at P only when `ready` (a point
 * the layer must paint) answered in that call; otherwise it reports `unready` and the caller polls again. */
const probe = (layer, at, ready) => page.evaluate(([l, p, r]) => {
  const h = window.__plannerLayers; if (!h) return { err: "no hook" };
  const hook = h();
  if (typeof hook.identify !== "function") return { err: "the build has no identify hook" };
  const q = (pt) => { const x = hook.identify(l, { lng: pt[0], lat: pt[1], tolDeg: 0.000005 }); return x ? { title: x.title || "(untitled)" } : null; };
  const k = q(r);
  if (!k) return { unready: true };
  return { known: k, at: q(p) };
}, [layer, at, ready]);
const settle = async (layer, at, ready, tries = 90) => {
  let r = null;
  for (let i = 0; i < tries; i++) { r = await probe(layer, at, ready); if (r && (r.err || !r.unready)) return r; await page.waitForTimeout(700); }
  return r;
};
try {
  await assertMeasurable(page, "verify-etj-map-layer-live");
  const v = live ? await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json()) : { build: "local" };
  console.log("served build:", v.build);
  if (live && expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  for (const c of CASES) {
    const id = planIds[c.key];
    const site = mkSite(id, c);
    const ins = !live ? null : await page.evaluate(async (st) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, site);
    if (ins) { check(`${c.key}: throwaway plan written`, false, ins); continue; }
    made.push(id);
    await page.goto(`${base}/#/project/${id}/site`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    // KNOWN-GOOD ARM: every probe below carries a plain-ETJ-ground point answered in the same call (see `probe`).
    const first = await settle("jur_etj", c.points[0].at, c.ready);
    check(`${c.key}: the ETJ layer painted (known-good arm: plain ETJ ground answers)`, !!first && !first.err && !first.unready, first && first.known ? first.known.title : (first && first.err) || "VOID — the layer never painted; nothing below can be trusted");
    if (!first || first.err || first.unready) continue;
    for (const pt of c.points) {
      const r = await settle("jur_etj", pt.at, c.ready);
      const etj = r && r.at;
      const wantEtj = preFix && pt.preFix ? pt.preFix : pt.etj;
      const gotEtj = etj ? "etj" : "none";
      check(`${c.key}${preFix && pt.preFix ? " [PRE-FIX build must show the bug]" : ""}: ETJ at ${pt.label}`, gotEtj === wantEtj, `painted=${etj ? etj.title : "nothing"}, expected ${wantEtj === "etj" ? "ETJ painted" : "nothing painted"}`);
      if (pt.city !== undefined && !preFix) {
        const cr = await settle("jur_city", pt.at, c.cityReady || [-95.6693, 29.6122]);
        const city = cr && cr.at;
        const gotCity = city ? city.title : null;
        const ok = pt.city === null ? !city : !!city && new RegExp(pt.city, "i").test(gotCity);
        check(`${c.key}: the city layer still answers at ${pt.label} (control)`, ok, `city layer: ${gotCity || "nothing"}`);
      }
    }
  }
} finally {
  const gone = !live ? { left: 0, local: true } : await page.evaluate(async (ids) => {
    for (const k of Object.keys(localStorage)) {
      try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const id of ids) if (m && m[id]) { delete m[id]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) { /* not a plan store */ }
    }
    let left = 0;
    for (const id of ids) {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      left += (q.data || []).length;
    }
    return { left };
  }, made).catch((e) => ({ left: -1, err: String(e) }));
  check("every throwaway plan deleted and verified gone from the cloud", gone.left === 0, JSON.stringify(gone));
  await closeAll();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
