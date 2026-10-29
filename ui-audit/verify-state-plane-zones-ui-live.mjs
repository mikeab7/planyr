/* NEW-1 — LIVE, THROUGH THE SCREEN: does the app TURN a plotted deed by the right state-plane zone at each point, signed in on planyr.io?
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-state-plane-zones-ui-live.mjs [https://planyr.io] [expectedBuildSha] [onlyKeyRegex]
 *
 * The one place the zone becomes something a person SEES is the deed "Rotate to grid north" action: a plan with a plotted deed and no county
 * parcel (raw land not in county records yet) is rotated by the grid convergence of the SITE'S OWN zone, announced in a toast
 * ("rotated 2.50° clockwise for the State Plane grid convergence here"). Convergence γ = n·(λ − λ₀) is a function of the zone's cone
 * constant and central meridian, so the angle the drawing really turns is a fingerprint of the zone the app resolved: Conroe on
 * Texas South Central would turn 1.73°, on Texas Central 2.50°.
 *
 * Per case this: seeds a THROWAWAY local plan (ids prefixed `zl-`, never a real plan) with an asymmetric deed and the state/county a real plan
 * of that place carries; opens it signed in as the test account; right-clicks the deed → "Rotate to grid north" (a real CDP right-click, a
 * real menu click); and measures the angle the vertices ACTUALLY turned (recovered from geometry, not from anything the app says about
 * itself) plus the toast. Expected angle = the convergence of the EXPECTED zone, computed Node-side from the repo's engine with the zone
 * handed in explicitly (so it does not depend on the resolver under test); the wrong zone's angle is computed too and the measured angle
 * must be nearer the right one (a case where they differ by < 0.05° is reported as WEAK, never silently passed).
 * CLEANUP (owner rule 15): the `zl-` plans are removed from this browser's storage AND from the test account's cloud rows, then verified gone.
 *
 * Known-good arms: Katy / Denver / Boulder (zones unchanged by the fixes) and the Chicago-style "outside every modelled zone" refusal is
 * covered by verify-colorado-deed-north.mjs. The build id is read in the same call as the results.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { SP_ZONES, gridConvergenceDegIn } from "../src/shared/coordinates/statePlaneCore.js";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const wantSha = process.argv[3] || null;
const only = process.argv[4] ? new RegExp(process.argv[4], "i") : null;

/* county = the routing key a plan of that place persists (null where the state's only parcel source is statewide: no per-county entry). */
const CASES = [
  { key: "katy",      n: "Katy TX",            lat: 29.7858, lon: -95.8245,  county: "fortbend",      exp: "tx_sc" },
  { key: "houston",   n: "Houston TX",         lat: 29.7604, lon: -95.3698,  county: "harris",        exp: "tx_sc" },
  { key: "conroe",    n: "Conroe TX",          lat: 30.3119, lon: -95.4561,  county: "montgomery",    exp: "tx_central",       wrong: "tx_sc" },
  { key: "liberty",   n: "Liberty TX",         lat: 30.0580, lon: -94.7955,  county: "liberty",       exp: "tx_central",       wrong: "tx_sc" },
  { key: "dallas",    n: "Dallas TX",          lat: 32.7767, lon: -96.7970,  county: "dallas",        exp: "tx_north_central" },
  { key: "austin",    n: "Austin TX",          lat: 30.2672, lon: -97.7431,  county: "travis",        exp: "tx_central" },
  { key: "nashville", n: "Nashville TN",       lat: 36.1627, lon: -86.7816,  county: "tn_davidson",   exp: "tn" },
  { key: "lakeland",  n: "Lakeland GA",        lat: 31.0410, lon: -83.0751,  county: "ga_lanier",     exp: "ga_west",          wrong: "ga_east" },
  { key: "valdosta",  n: "Valdosta GA",        lat: 30.8327, lon: -83.2785,  county: "ga_lowndes",    exp: "ga_west" },
  { key: "waycross",  n: "Waycross GA",        lat: 31.2135, lon: -82.3540,  county: "ga_ware",       exp: "ga_east" },
  { key: "littlerock",n: "Little Rock AR",     lat: 34.7465, lon: -92.2896,  county: "ar_pulaski",    exp: "ar_north",         wrong: "ar_south" },
  { key: "benton",    n: "Benton AR",          lat: 34.5645, lon: -92.5868,  county: "ar_saline",     exp: "ar_south" },
  { key: "avalon",    n: "Avalon (Catalina) CA", lat: 33.3428, lon: -118.3278, county: null,          exp: "ca_6",             wrong: "ca_5" },
  { key: "longbeach", n: "Long Beach CA",      lat: 33.7701, lon: -118.1937, county: null,            exp: "ca_5" },
  { key: "belfield",  n: "Belfield ND",        lat: 46.8853, lon: -103.1996, county: null,            exp: "nd_south" },
  { key: "medora",    n: "Medora ND (Billings)", lat: 46.9142, lon: -103.5252, county: null,          exp: "nd_south" },
  { key: "carson",    n: "Carson City NV",     lat: 39.1638, lon: -119.7674, county: null,            exp: "nv_west" },
  { key: "juneau",    n: "Juneau AK",          lat: 58.3019, lon: -134.4197, county: null,            exp: "ak_1" },
  { key: "boulder",   n: "Boulder CO",         lat: 40.0150, lon: -105.2705, county: "co_boulder",    exp: "co_north" },
  { key: "denver",    n: "Denver CO",          lat: 39.7392, lon: -104.9903, county: "co_denver",     exp: "co_central" },
].filter((c) => !only || only.test(c.key));

/* An ASYMMETRIC deed ring (feet, planner frame) — a square is its own 90° alias. NO parcel is seeded: that is the grid-north branch. */
const DEED = [{ x: -700, y: -400 }, { x: 700, y: -430 }, { x: 690, y: 380 }, { x: -60, y: 420 }, { x: -710, y: 300 }];
const recoverRotation = (before, after) => {
  const cen = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
  const c0 = cen(before), c1 = cen(after); let sx = 0, sy = 0;
  for (let i = 0; i < before.length; i++) {
    const a = { x: before[i].x - c0.x, y: before[i].y - c0.y }, b = { x: after[i].x - c1.x, y: after[i].y - c1.y };
    sx += a.x * b.x + a.y * b.y; sy += a.x * b.y - a.y * b.x;
  }
  return (Math.atan2(sy, sx) * 180) / Math.PI;
};
const convIn = (id, lat, lon) => gridConvergenceDegIn(lat, lon, SP_ZONES[id]);

const fail = (m) => { console.error("FAIL", m); process.exit(1); };
async function open() {
  let last;
  for (let i = 0; i < 5; i++) { try { return await openSignedIn({ base, viewport: { width: 1500, height: 1000 } }); } catch (e) { last = e; console.error(`openSignedIn attempt ${i + 1}: ${e.message.split("\n")[0]}`); await new Promise((r) => setTimeout(r, 8000)); } }
  throw last;
}

const s = await open();
const page = s.page;
const results = [], made = []; let cleanup = null;
try {
  await assertMeasurable(page, "verify-state-plane-zones-ui-live");
  const errors = []; page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const sid = (c) => `zl-${c.key}`, gid = (c) => `zl-g-${c.key}`;
  console.log("build:", JSON.stringify(s.build), "| signed in as", s.proof.email, "| fixture visible:", s.proof.fixtureVisible);
  if (wantSha && !String(s.build.build || "").startsWith(wantSha.slice(0, 7))) fail(`served build ${JSON.stringify(s.build)} is not ${wantSha}`);

  for (const c of CASES) {
    const exp = convIn(c.exp, c.lat, c.lon), wrong = c.wrong ? convIn(c.wrong, c.lat, c.lon) : null;
    const weak = wrong != null && Math.abs(exp - wrong) < 0.05;
    const row = { case: c.n, zone: c.exp, expectedDeg: +exp.toFixed(4), wrongDeg: wrong == null ? null : +wrong.toFixed(4), weak, result: "FAIL", why: [] };
    results.push(row);
    try {
      // insert the throwaway plan as a real cloud row (the test account owns it), then open it by route + a full reload (a hash change alone leaves the previous workspace active)
      const site = { schemaVersion: 12, id: sid(c), groupId: sid(c), site: "zl zone check " + c.key, name: "Deed", origin: { lat: c.lat, lon: c.lon }, county: c.county, status: "active",
        parcels: [], underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], callouts: [],
        markups: [{ id: "deed1", kind: "encumbrance", label: "Tract 1", pts: DEED, closed: true }], updatedAt: Date.now(), data: { status: "active" } };
      made.push(site.id);
      const ins = await page.evaluate(async (st) => {
        const { data: u } = await window.pfSupabase.auth.getUser();
        const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
        let r = await window.pfSupabase.from("sites").insert(row);
        if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
        return r.error ? String(r.error.message) : null;
      }, site);
      if (ins) { row.why.push("could not write the throwaway plan: " + ins); continue; }
      await page.goto(`${base}/#/project/${sid(c)}/site`, { waitUntil: "load" });
      await page.reload({ waitUntil: "load" });
      await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
      await page.waitForTimeout(4000);
      /* the deed's vertices wherever the app mirrors the open plan (device cache) — found by plan id, not by a guessed key */
      const deedPts = () => page.evaluate((id) => {
        for (const k of Object.keys(localStorage)) {
          try { const m = JSON.parse(localStorage.getItem(k) || "null"); const st = m && (m[id] || (m.sites && m.sites[id]) || (m.id === id ? m : null)); const d = st && (st.markups || []).find((x) => x.id === "deed1"); if (d) return d.pts; } catch (_) { /* not a plan store */ }
        }
        return null;
      }, sid(c));
      const before = await deedPts();
      if (!before) { row.why.push("the throwaway plan did not load (deed absent from the store)"); continue; }
      await page.evaluate(() => { const btns = [...document.querySelectorAll("button, div")].filter((e) => e.textContent.trim() === "⤢" && e.getBoundingClientRect().width > 0); if (btns.length) btns[btns.length - 1].click(); });
      await page.waitForTimeout(1200);
      /* a plan with NO parcel never zoom-fits the deed, so part of it sits under the app chrome: press at a point that is VISIBLE on the canvas and that the
       * browser's own hit test resolves to the deed (elementFromPoint), found by sampling a grid across its box — never an assumed centre */
      const box = await page.evaluate(() => {
        const g = document.querySelector('[data-feature^="markup:"]'); if (!g) return null;
        const cv = (document.querySelector('[data-testid="planner-canvas"]') || document.body).getBoundingClientRect(), r = g.getBoundingClientRect();
        const x0 = Math.max(r.left, cv.left + 12), x1 = Math.min(r.right, cv.right - 12), y0 = Math.max(r.top, cv.top + 12), y1 = Math.min(r.bottom, cv.bottom - 12);
        for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
          const x = x0 + ((x1 - x0) * i) / 12, y = y0 + ((y1 - y0) * j) / 12;
          const hit = document.elementFromPoint(x, y);
          if (hit && hit.closest && hit.closest('[data-feature^="markup:"]')) return { x, y };
        }
        return null;
      });
      if (!box) { row.why.push("the deed did not render on the canvas"); continue; }
      await page.mouse.click(box.x, box.y, { button: "right" });
      await page.waitForTimeout(1200);
      const clicked = await page.evaluate(() => { const r = [...document.querySelectorAll("div, button")].find((e) => /^(Rotate to grid north|Align to county parcel)$/.test((e.textContent || "").trim()) && e.getBoundingClientRect().width > 0 && !e.querySelector("div, button")); if (!r) return null; const l = r.textContent.trim(); r.click(); return l; });
      if (!clicked) { row.why.push("the deed's right-click menu had no 'Rotate to grid north' row"); continue; }
      await page.waitForTimeout(2000);
      const toast = await page.evaluate(() => { const t = [...document.querySelectorAll("div")].map((e) => e.textContent || "").filter((x) => /grid convergence|State Plane|Rotated the deed|no grid rotation|doesn't carry a State Plane zone/i.test(x)).sort((a, b) => a.length - b.length)[0]; return t ? t.slice(0, 260) : null; });
      const after = await deedPts();
      const turned = after ? recoverRotation(before, after) : null;
      row.turnedDeg = turned == null ? null : +turned.toFixed(4); row.toast = toast && toast.replace(/\s+/g, " ");
      if (clicked !== "Rotate to grid north") row.why.push(`menu offered "${clicked}" (a county parcel was in play), not the grid-north fallback`);
      if (turned == null) row.why.push("deed geometry unreadable after the action");
      else {
        if (Math.abs(turned - exp) > 0.02) row.why.push(`turned ${turned.toFixed(4)}° but zone ${c.exp} (EPSG ${SP_ZONES[c.exp].epsg}) turns ${exp.toFixed(4)}°`);
        if (wrong != null && Math.abs(turned - wrong) <= Math.abs(turned - exp)) row.why.push(`closer to the WRONG zone ${c.wrong} (${wrong.toFixed(4)}°)`);
      }
      if (!toast || !/grid convergence/i.test(toast)) row.why.push(`no grid-convergence toast (${toast || "none"})`);
      if (!row.why.length) row.result = weak ? "PASS (weak discrimination)" : "PASS";
    } catch (e) { row.why.push("harness error: " + String(e.message).split("\n")[0]); }
  }

  // ---- CLEANUP (owner rule 15): throwaway plans out of this browser AND out of the test account's cloud rows; verify gone ----
  cleanup = await page.evaluate(async (ids) => {
    for (const k of Object.keys(localStorage)) {
      try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const id of ids) if (m && m[id]) { delete m[id]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) { /* not a plan store */ }
    }
    let left = 0, errs = [];
    for (const id of ids) {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      const d = await window.pfSupabase.from("sites").delete().eq("id", id); if (d.error) errs.push(d.error.message);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      left += (q.data || []).length;
    }
    const sweep = await window.pfSupabase.from("sites").select("id").like("id", "zl-%");   // any stray from an earlier aborted run
    return { created: ids.length, cloudLeft: left, strayZl: (sweep.data || []).length, errs };
  }, made);
  console.log("cleanup:", JSON.stringify(cleanup));
  if (errors.length) console.log("page errors:", errors.slice(0, 3));

  let bad = 0;
  for (const r of results) {
    if (!r.result.startsWith("PASS")) bad++;
    console.log(`${r.result.padEnd(6)} ${r.case.padEnd(24)} zone ${r.zone.padEnd(16)} expect ${String(r.expectedDeg).padStart(8)}°  wrong-zone ${r.wrongDeg == null ? "   n/a" : String(r.wrongDeg).padStart(8) + "°"}  TURNED ${r.turnedDeg == null ? "n/a" : String(r.turnedDeg).padStart(8) + "°"}${r.why.length ? "\n      ↳ " + r.why.join("\n      ↳ ") : ""}${r.toast ? "\n      toast: " + r.toast : ""}`);
  }
  const cleanOk = cleanup.cloudLeft === 0 && cleanup.strayZl === 0;
  if (!cleanOk) { bad++; console.log("CLEANUP INCOMPLETE:", JSON.stringify(cleanup)); }
  console.log("RESULT " + JSON.stringify({ build: s.build.build, signedInAs: s.proof.email, total: results.length, passed: results.filter((r) => r.result.startsWith("PASS")).length, failed: bad, cleanup }));
  await s.close();
  process.exit(bad ? 1 : 0);
} catch (e) { await s.close().catch(() => {}); fail(e.message); }
