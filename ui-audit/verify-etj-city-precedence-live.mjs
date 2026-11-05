#!/usr/bin/env node
/* verify-etj-city-precedence-live — B2472944 / V1919872. The site header names ONE jurisdiction: a city that holds the site never prints
 * another city's ETJ beside it. LIVE, signed in as the test account, on THROWAWAY plans it deletes (and verifies gone).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-etj-city-precedence-live.mjs https://planyr.io [--expect-sha <merge-sha>] [--pre-fix]
 *
 * Each case inserts a located plan on the test account, opens it, waits for the header pill to SETTLE, and reads the rendered pill text
 * (`data-jurisdiction-full`) and its tooltip off the DOM. Ground truth for every expected string was measured on the live layers
 * 2026-10-28 (see B2472944): the Concept A tract is the owner's real geometry copied onto a throwaway plan — his own plan is never opened
 * or touched. `--pre-fix` inverts the two overlap cases (it must read the OWNER'S BUG on a pre-fix build) so the instrument is proved able
 * to see the defect before it is trusted to report its absence. /version.json is read IN THE SAME CALL as the assertions. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const preFix = args.includes("--pre-fix");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

/* The owner's Concept A tract, in feet from its origin (55 vertices, 316.6 ac). */
const CONCEPT_A = { lat: 29.6122132390976, lon: -95.6693177247584, pts: [[1557.07,-1991.86],[1558.69,-1705.51],[1559.47,-1586.65],[1572.14,334.85],[1535.73,1633.17],[1537.06,1746.53],[1328.43,1833.54],[861.06,2030.80],[716.32,2091.32],[592.78,2144.44],[365.41,2241.07],[165.96,2323.26],[5.69,2390.41],[-200.09,2477.71],[-359.50,2544.19],[-444.09,2579.28],[-576.41,2635.28],[-701.61,2687.01],[-891.36,2766.77],[-929.92,2674.24],[-976.02,2693.62],[-1022.11,2712.99],[-1068.20,2732.39],[-1114.11,2752.01],[-1160.21,2771.38],[-1121.73,2863.85],[-1223.13,2906.26],[-1387.66,2976.05],[-1444.32,2999.65],[-1446.98,2698.39],[-1448.08,2572.94],[-1448.99,2469.81],[-1454.09,2211.38],[-1485.72,608.53],[-1486.89,548.93],[-1487.34,526.32],[-1498.11,-16.25],[-1504.00,-233.11],[-1508.15,-386.14],[-1523.21,-941.13],[-1531.32,-1562.74],[-1572.14,-2846.33],[-1357.85,-2942.37],[-1133.67,-2999.89],[-898.45,-2977.13],[-685.64,-2835.56],[-460.89,-2610.20],[-383.40,-2423.64],[-290.45,-2266.11],[-235.52,-2122.45],[-106.34,-1850.16],[131.50,-1653.70],[564.46,-1564.62],[905.31,-1566.09],[1236.22,-1671.52]] };

/* A box given in lon/lat → a located plan: origin at the centre, ring in feet (y grows SOUTH in the planner's frame). */
const boxPlan = ([x0, y0, x1, y1]) => {
  const lat = (y0 + y1) / 2, lon = (x0 + x1) / 2, FT = 3.28084;
  const fx = (lng) => (lng - lon) * 111320 * Math.cos((lat * Math.PI) / 180) * FT, fy = (la) => -(la - lat) * 110574 * FT;
  return { lat, lon, pts: [[fx(x0), fy(y1)], [fx(x1), fy(y1)], [fx(x1), fy(y0)], [fx(x0), fy(y0)]] };
};
const squareAt = (lon, lat, half = 300) => ({ lat, lon, pts: [[-half, -half], [half, -half], [half, half], [-half, half]] });
const ID_PREFIX = "zz-etj-city-";

/* `want` is the exact pill text. `no` is a regex the pill must NOT match. `tip` a regex the tooltip must match. `preFix` the text a pre-fix build shows. */
const CASES = [
  { key: "concept-a", why: "Concept A's real tract — 99.998% Sugar Land limits, Houston's ETJ polygon grazes 0.73%", plan: CONCEPT_A,
    want: "City of Sugar Land · Fort Bend County", no: /Houston ETJ/, tip: /Houston's ETJ layer also covers part of this ground[\s\S]*limits govern/,
    preFix: "City of Sugar Land · Houston ETJ · Fort Bend County" },
  { key: "overlap-band", why: "a tract wholly inside the band both layers claim", plan: boxPlan([-95.6700, 29.6235, -95.6640, 29.6275]),
    want: "City of Sugar Land · Fort Bend County", no: /Houston ETJ/, preFix: "City of Sugar Land · Houston ETJ · Fort Bend County" },
  { key: "straddle", why: "a tract that genuinely straddles the Sugar Land limits", plan: boxPlan([-95.6760, 29.6160, -95.6690, 29.6205]),
    re: /^Part in City of Sugar Land limits \(full purpose, (7\d)% by area\) · rest in Houston ETJ · Fort Bend County$/ },
  { key: "houston-etj-only", why: "a tract in Houston's ETJ only", plan: boxPlan([-95.6900, 29.6200, -95.6830, 29.6240]), want: "City of Houston ETJ · Fort Bend County" },
  { key: "houston", why: "wholly inside Houston's limits (downtown)", plan: squareAt(-95.3698, 29.7604), want: "City of Houston · Harris County" },
  { key: "missouri-city", why: "Missouri City core", plan: squareAt(-95.5377, 29.6186), want: "City of Missouri City · Fort Bend County" },
  { key: "stafford", why: "Stafford core", plan: squareAt(-95.5577, 29.6161), want: "City of Stafford · Fort Bend County" },
  { key: "richmond", why: "Richmond core", plan: squareAt(-95.7608, 29.5822), want: "City of Richmond · Fort Bend County" },
  { key: "rosenberg", why: "Rosenberg core", plan: squareAt(-95.8086, 29.5572), want: "City of Rosenberg · Fort Bend County" },
  { key: "sugar-land-etj", why: "a point in Sugar Land's own ETJ", plan: squareAt(-95.680, 29.6025, 120), want: "City of Sugar Land ETJ · Fort Bend County" },
  { key: "fort-bend-unincorporated", why: "plain unincorporated Fort Bend, in no ETJ", plan: squareAt(-95.700, 29.6190, 120), want: "Unincorporated · Fort Bend County" },
  { key: "humble", why: "the same overlap pattern elsewhere: Humble's limits under Houston's ETJ polygon", plan: squareAt(-95.2622, 29.9988), want: "City of Humble · Harris County", preFix: "City of Humble · Houston ETJ · Harris County" },
];

const mkSite = (id, c) => ({
  schemaVersion: 12, id, groupId: id, site: "zz ETJ/city check " + c.key, name: "Plan 1", origin: { lat: c.plan.lat, lon: c.plan.lon }, county: null, status: "active",
  parcels: [{ id: "p1", points: c.plan.pts.map(([x, y]) => ({ x, y })), active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
  updatedAt: Date.now(), data: { status: "active" },
});

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
console.log("signed in as", s.proof.email);
const made = [];
try {
  await assertMeasurable(page, "verify-etj-city-precedence-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  for (const c of CASES) {
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
    await page.reload({ waitUntil: "load" }); // a hash-only change leaves the previous workspace active
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    const pill = page.getByTestId("jurisdiction-badge").first();
    await pill.waitFor({ state: "attached", timeout: 60000 });
    // The pill is "settled" once its text stops changing and is not the loading / failure state.
    let text = "", stable = 0;
    for (let i = 0; i < 90 && stable < 4; i++) {
      const t = (await pill.getAttribute("data-jurisdiction-full")) || "";
      stable = t && t === text && !/^Couldn't check jurisdiction/.test(t) ? stable + 1 : 0;
      text = t;
      await page.waitForTimeout(500);
    }
    const tip = (await pill.getAttribute("title")) || "";
    const wantNow = preFix && c.preFix ? c.preFix : c.want;
    const ok = c.re ? c.re.test(text) : text === wantNow;
    check(`${c.key}${preFix && c.preFix ? " [PRE-FIX build must show the bug]" : ""}: ${c.why}`, ok, `"${text}"${ok ? "" : ` (expected ${c.re || `"${wantNow}"`})`}`);
    if (!preFix && c.no) check(`${c.key}: no "Houston ETJ" slot beside the city`, !c.no.test(text), text);
    if (!preFix && c.tip) check(`${c.key}: the tooltip discloses the overlap and says the limits govern`, c.tip.test(tip), tip.split("\n").filter((l) => /ETJ layer/.test(l)).join(" | ").slice(0, 200));
  }
} finally {
  // Cleanup is unconditional (constraint #15) and VERIFIED: every throwaway row must be gone from the cloud afterwards.
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
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
