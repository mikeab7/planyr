/* verify-county-etj-live — NEW-1 / NEW-2 (2026-11-12): county-published ETJ sources. Fort Bend County's own ETJ table + Land Ordinances releases
 * (first inside the county, H-GAC the backup) and Harris County's HC_Cities_ETJ (the fallback when H-GAC answers 0).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-county-etj-live.mjs [https://planyr.io] [--expect-sha <sha>] [--pre-fix]
 *
 * Signs in as the test account, seeds ONE tiny THROWAWAY located plan per case (a 600-ft square centred on a point read from the counties' own layers)
 * and reads the header jurisdiction pill (`data-jurisdiction-full`) from the DEPLOYED build — `/version.json` is read in the same call.
 *   KNOWN-GOOD ARM (the instrument is on trial): from the page's OWN origin (so the CORS answer is the real browser's) the run asks the county layers and
 *   H-GAC at each case point and prints what they say. A case whose ground truth cannot be read, or does not match its stated expectation, is VOID — never scored.
 *   CASES: the 4,663.8-ac Fulshear petition release (filed 2023-09-28) · Rosenberg Ordinance 2026-16 · the Fulshear cluster (still ETJ) · La Porte's ETJ
 *   and Katy's (H-GAC answers nothing; Harris's table does) · downtown Houston (H-GAC answers; unchanged).
 * `--pre-fix` asserts the OLD answers (H-GAC alone) — the red proof against a build from before this change.
 * Throwaway plans are deleted and the deletion re-read (owner rule 15). FOREGROUND-OR-VOID first. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = flag("--expect-sha");
const preFix = args.includes("--pre-fix");
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidCase = (why) => { console.log(`⚠ VOID — ${why}`); voided++; };

const FB = "https://gisportal.fortbendcountytx.gov/arcgis/rest/services/InteractiveMap/Boundaries_Public/MapServer";
const HARRIS = "https://www.gis.hctx.net/arcgishcpid/rest/services/Boundaries/HC_Cities_ETJ/MapServer/0";
const HGAC = "https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/HGAC_City_ETJ_Boundaries/FeatureServer/0";
const squareAt = (lon, lat, half = 300) => ({ lat, lon, pts: [[-half, -half], [half, -half], [half, half], [-half, half]] });
const ID_PREFIX = "zz-county-etj-";

/* `truth` = what the services must say at the point (ground truth, read from the page): fb5 = Fort Bend /5 cities, fb16 = release cities, harris, hgac.
 * `want` = the exact pill text now; `preFix` = the pill text a build from before this change shows. */
const CASES = [
  { key: "fulshear-release", why: "inside Fulshear's 4,663.8-ac petition release (filed 2023-09-28)", at: [-95.85373, 29.6276],
    truth: { fb5: [], fb16: ["Fulshear ETJ"], hgac: ["FULSHEAR"] },
    want: "Fulshear ETJ release area (SB 2038) · Fort Bend County", preFix: "City of Fulshear ETJ · Fort Bend County" },
  { key: "rosenberg-2026-16", why: "inside the Rosenberg Ordinance No 2026-16 removal (filed 2026-04-20)", at: [-95.93562, 29.44609],
    truth: { fb5: [], fb16: ["Rosenberg ETJ"], hgac: ["ROSENBERG"] },
    want: "Rosenberg ETJ release area (SB 2038) · Fort Bend County", preFix: "City of Rosenberg ETJ · Fort Bend County" },
  { key: "fulshear-cluster", why: "the Fulshear cluster — still Fulshear's ETJ, in no release", at: [-95.9235, 29.7488],
    truth: { fb5: ["FULSHEAR"], fb16: [], hgac: ["FULSHEAR"] },
    want: "City of Fulshear ETJ · Fort Bend County", preFix: "City of Fulshear ETJ · Fort Bend County" },
  { key: "la-porte-etj", why: "La Porte's ETJ — H-GAC answers nothing, Harris's table does", at: [-95.05901, 29.71901],
    truth: { harris: ["LA PORTE"], hgac: [] },
    want: "City of La Porte ETJ · Harris County", preFix: "Unincorporated · Harris County" },
  { key: "katy-etj", why: "Katy's ETJ — H-GAC answers nothing, Harris's table does", at: [-95.90246, 29.77651],
    truth: { harris: ["KATY"], hgac: [] },
    wantRe: /^City of Katy ETJ · (Harris|Fort Bend|Waller) County$/, preFix: null },
  { key: "houston-downtown", why: "downtown Houston — H-GAC and the city answer; unchanged", at: [-95.3698, 29.7604],
    truth: { hgac: [] }, want: "City of Houston · Harris County", preFix: "City of Houston · Harris County" },
];

const mkSite = (id, c) => {
  const p = squareAt(c.at[0], c.at[1]);
  return { schemaVersion: 12, id, groupId: id, site: "zz county ETJ check " + c.key, name: "Plan 1", origin: { lat: p.lat, lon: p.lon }, county: null, status: "active",
    parcels: [{ id: "p1", points: p.pts.map(([x, y]) => ({ x, y })), active: true, z: 0 }],
    underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [], updatedAt: Date.now(), data: { status: "active" } };
};

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
console.log("signed in as", s.proof.email);
const made = [];
try {
  await assertMeasurable(page, "verify-county-etj-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  /* The page asks the services itself: this is both the CORS proof (a real planyr.io-origin fetch) and the ground truth for each case. */
  const ask = (url, field, [x, y], where) => page.evaluate(async ([u, f, pt, w]) => {
    const q = new URLSearchParams({ geometry: JSON.stringify({ x: pt[0], y: pt[1], spatialReference: { wkid: 4326 } }), geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: f, returnGeometry: "false", f: "json" });
    if (w) q.set("where", w);
    try { const r = await fetch(`${u}/query?${q}`); const j = await r.json(); return j.error ? { err: j.error.message } : { names: (j.features || []).map((x) => x.attributes[f]) }; }
    catch (e) { return { err: String(e && e.message || e) }; }
  }, [url, field, [x, y], where]);
  const RELEASE_WHERE = "Type = 'De-annexation' AND City LIKE '% ETJ' AND Filing_Date >= DATE '2020-01-01'";

  const cors = await ask(`${FB}/5`, "City", [-95.9235, 29.7488]);
  check("CORS · Fort Bend County's gisportal answers a planyr.io-origin browser fetch directly (no relay)", !!cors.names, JSON.stringify(cors));
  const corsH = await ask(HARRIS, "Name", [-95.75, 30.05]);
  check("CORS · Harris County's HC_Cities_ETJ answers a planyr.io-origin browser fetch directly", !!corsH.names, JSON.stringify(corsH));
  check("CORS · Harris at the weekly sweep's point (-95.75, 30.05) says HOUSTON", (corsH.names || []).includes("HOUSTON"), JSON.stringify(corsH.names));

  for (const c of CASES) {
    const SVC = { fb5: [`${FB}/5`, "City"], fb16: [`${FB}/16`, "City", RELEASE_WHERE], harris: [HARRIS, "Name"], hgac: [HGAC, "CITY"] };
    const truth = {}, mismatch = [];
    for (const [k, want] of Object.entries(c.truth)) {
      const r = await ask(...SVC[k].slice(0, 2), c.at, SVC[k][2]);
      truth[k] = r.names || null;
      if (!r.names || JSON.stringify([...r.names].sort()) !== JSON.stringify([...want].sort())) mismatch.push(k);
    }
    if (mismatch.length) { voidCase(`${c.key}: ground truth drifted from the stated expectation (${JSON.stringify(truth)} vs ${JSON.stringify(c.truth)}) — the case is not scored`); continue; }
    console.log(`   ground truth ${c.key}: ${JSON.stringify(truth)}`);

    const id = ID_PREFIX + c.key + "-" + Math.random().toString(36).slice(2, 7);
    const site = mkSite(id, c);
    const ins = await page.evaluate(async (st) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, site);
    if (ins) { check(`${c.key}: throwaway plan written`, false, ins); continue; }
    made.push(id);
    await page.goto(`${base}/#/project/${id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    const pill = page.getByTestId("jurisdiction-badge").first();
    await pill.waitFor({ state: "attached", timeout: 60000 });
    let text = "", stable = 0;
    for (let i = 0; i < 90 && stable < 4; i++) {
      const t = (await pill.getAttribute("data-jurisdiction-full")) || "";
      stable = t && t === text && !/^Couldn't check jurisdiction/.test(t) ? stable + 1 : 0;
      text = t;
      await page.waitForTimeout(500);
    }
    const wantNow = preFix ? c.preFix : c.want;
    const ok = c.wantRe && !preFix ? c.wantRe.test(text) : text === wantNow;
    check(`${c.key}${preFix ? " [PRE-FIX build must show the old answer]" : ""}: ${c.why}`, ok, `"${text}"${ok ? "" : ` (expected ${c.wantRe && !preFix ? c.wantRe : `"${wantNow}"`})`}`);
  }
} finally {
  const gone = await page.evaluate(async (ids) => {
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
  await s.close();
}
console.log(voided ? `\n${voided} case(s) VOID` : "");
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed || voided ? 1 : 0);
