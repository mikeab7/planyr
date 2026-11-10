/* verify-road-taper-live — NEW-1 (2026-11-10): ROADS OF DIFFERENT WIDTHS JOIN WITH A SMOOTH TAPER, on a REAL deploy, signed in as the throwaway test
 * account (lib/roadTaper.js; root constraint #55).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-road-taper-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway plan with a 50 ft road meeting a 24 ft drive end to end (straight), the same pair meeting at a bend, and an EQUAL-width control.
 * In the SAME page call as each reading it reads /version.json (a stale cached bundle makes a reading meaningless), then reads:
 *   · the canvas's own dissolved network (`__plannerRoadNet`): ONE outline per pair, narrowing monotonically with no step at the joint
 *   · the PRINTED SHEET (`__plannerExportSvg`, the clone the PDF and print are built from): the same outline, no step (PDF-PARITY)
 *   · the editable-PDF annotations: the roads are still annotations
 *   · the road's Properties: a "Taper" length field exists on the wide road, not on the control
 *   · a reload keeps all of it
 * Known-good arm: the equal-width control must report NO taper (a probe that cannot tell a taper from a plain strip is not evidence), and the
 * pre-fix shape — a single step of the whole width difference — is what the "no step" bound is measured against.
 * Deletes the throwaway at the end and VERIFIES it is gone (owner constraint 15). The standing fixtures are never touched.
 * FOREGROUND-OR-VOID: asserted before anything is measured. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-road-taper-" + Math.random().toString(36).slice(2, 8);
const road = (id, pts, travelW) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { id, type: "road", z: 1024 + pts.length, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "local", cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + travelW + 1, rot: 0 };
};
const A = (50 * Math.PI) / 180;
const SITE = {
  id: ID, groupId: ID, site: "zz Road taper", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -520, y: -420 }, { x: 620, y: -420 }, { x: 620, y: 620 }, { x: -520, y: 620 }] }],
  els: [
    road("W", [{ x: 0, y: -300 }, { x: 200, y: -300 }], 50), road("N", [{ x: 200, y: -300 }, { x: 400, y: -300 }], 24),      // straight pair
    road("BW", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 50), road("BN", [{ x: 200, y: 0 }, { x: 200 + 200 * Math.cos(A), y: 200 * Math.sin(A) }], 24),   // angled pair
    road("EA", [{ x: 0, y: 450 }, { x: 200, y: 450 }], 30), road("EB", [{ x: 200, y: 450 }, { x: 400, y: 450 }], 30),       // control: equal widths
  ],
  measures: [], markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let served = null;

/* ONE evaluate: build + canvas network + printed sheet, so the build read shares the call with every assertion. */
const readState = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
  const net = window.__plannerRoadNet ? window.__plannerRoadNet() : null;
  const sheet = new DOMParser().parseFromString(await window.__plannerExportSvg(), "image/svg+xml");
  // the dissolved surface of each cluster in the printed sheet, as points in the sheet's own (uniformly scaled) space
  const sheetRings = [...sheet.querySelectorAll("[data-road-cluster]")].filter((n) => n.getAttribute("d")).map((n) => ({
    ids: n.getAttribute("data-road-cluster"),
    pts: (n.getAttribute("d").match(/-?\d+(\.\d+)?(e-?\d+)?,-?\d+(\.\d+)?(e-?\d+)?/gi) || []).map((t) => t.split(",").map(Number)).map(([x, y]) => ({ x, y })),
  }));
  const composed = await window.__plannerExportComposed();
  return { build, regions: net ? net.regions.map((r) => ({ ids: r.ids, outer: r.outer })) : null, sheetRings, annots: composed.annots.map((a) => a.nm) };
});

const halfWidthAt = (ring, X) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if ((a.x - X) * (b.x - X) > 0 || a.x === b.x) continue;
    const y = a.y + ((b.y - a.y) * (X - a.x)) / (b.x - a.x);
    lo = Math.min(lo, y); hi = Math.max(hi, y);
  }
  return Number.isFinite(lo) ? (hi - lo) / 2 : null;
};
/* the profile of a left-to-right strip: width at `n` evenly spaced stations; returns { first, last, maxStep, mono } as a fraction of the first. */
function profile(ring, n = 400) {
  const xs = ring.map((p) => p.x), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const hs = [];
  for (let i = 1; i < n; i++) { const h = halfWidthAt(ring, x0 + ((x1 - x0) * i) / n); if (h != null) hs.push(h); }
  let maxStep = 0, mono = true;
  for (let i = 1; i < hs.length; i++) { maxStep = Math.max(maxStep, Math.abs(hs[i] - hs[i - 1])); if (hs[i] > hs[i - 1] + hs[0] * 0.003) mono = false; }
  return { first: hs[0], last: hs[hs.length - 1], maxStep: maxStep / hs[0], mono, n: hs.length };
}
const regionOf = (list, id) => (list || []).find((r) => String(r.ids.join ? r.ids.join(" ") : r.ids).split(/\s+/).includes(id));

try {
  await assertMeasurable(page, "verify-road-taper-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");

  const open = async () => {
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForFunction(() => ["W", "N", "BW", "BN", "EA", "EB"].every((id) => document.querySelector(`[data-el-id="${id}"]`)), null, { timeout: 30000 });
    await page.waitForTimeout(2500);
  };
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await open();

  const verdicts = (st, tag) => {
    // the canvas network: the straight pair is ONE region narrowing 50 → 24; the control is one region that does NOT narrow
    const straight = regionOf(st.regions, "W"), ctl = regionOf(st.regions, "EA"), bent = regionOf(st.regions, "BW");
    check(`${tag} canvas — the straight pair is ONE continuous outline`, !!straight && straight.ids.includes("N"), JSON.stringify(straight && straight.ids));
    const p = straight && profile(straight.outer);
    check(`${tag} canvas — it narrows from ~50 to ~24 ft wide`, !!p && Math.abs(p.first - 25.5) < 1.2 && Math.abs(p.last - 12.5) < 1.2, JSON.stringify(p));
    check(`${tag} canvas — monotone, and NO step at the joint (the pre-fix notch was a 25%-of-width step)`, !!p && p.mono && p.maxStep < 0.03, JSON.stringify(p));
    const pc = ctl && profile(ctl.outer);
    check(`${tag} known-good arm — the equal-width control does NOT taper`, !!pc && Math.abs(pc.first - pc.last) < 0.6 && pc.maxStep < 0.02, JSON.stringify(pc));
    check(`${tag} canvas — the angled pair is one outline too`, !!bent && bent.ids.includes("BN"));
    // the printed sheet carries the same shape (PDF-PARITY): scale-free, so compare the narrowing RATIO and the step
    const sr = regionOf(st.sheetRings.map((r) => ({ ids: r.ids, outer: r.pts })), "W");
    const sp = sr && profile(sr.outer);
    check(`${tag} printed sheet — the same tapered outline, no step`, !!sp && sp.mono && sp.maxStep < 0.03 && Math.abs(sp.last / sp.first - 12.5 / 25.5) < 0.06, JSON.stringify(sp));
    check(`${tag} editable PDF — the roads are annotations`, ["W", "N", "BW", "BN"].every((id) => st.annots.some((n) => n.endsWith("-" + id))), JSON.stringify(st.annots));
  };
  const st = await readState();
  served = st.build;
  verdicts(st, "[open]");

  // the Properties of the wide road: a Taper length field; the control has none
  const place = (wx, wy) => page.evaluate(([x, y]) => { const b = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect(); const v = window.__plannerView.get(); return { x: b.x + v.offX + x * v.ppf, y: b.y + v.offY + y * v.ppf }; }, [wx, wy]);
  await page.evaluate(() => window.__plannerView.centerOn(200, -300, 1.0));
  await page.waitForTimeout(600);
  const pt = await place(30, -300);
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(450); await page.mouse.dblclick(pt.x, pt.y);
  await page.getByTestId("road-header").waitFor({ timeout: 10000 });
  const field = page.getByTestId("road-taper-e").first();
  check("the wide road's Properties carry a Taper length (automatic = 130)", (await field.count()) === 1 && (await field.getAttribute("placeholder")) === "130");
  await page.keyboard.press("Escape"); await page.mouse.click(5, 5);
  await page.evaluate(() => window.__plannerView.centerOn(200, 450, 1.0));
  await page.waitForTimeout(600);
  const pe = await place(30, 450);
  await page.mouse.click(pe.x, pe.y); await page.waitForTimeout(450); await page.mouse.dblclick(pe.x, pe.y);
  await page.getByTestId("road-header").waitFor({ timeout: 10000 });
  check("a road with no tapered joint has NO Taper section", (await page.locator('[data-testid^="road-taper-"]').count()) === 0);
  await page.keyboard.press("Escape"); await page.mouse.click(5, 5);

  // reload keeps the picture
  await page.reload({ waitUntil: "load" });
  await open();
  const rel = await readState();
  served = rel.build;
  verdicts(rel, "[reload]");
  if (expectSha) check("the deploy is serving the merge commit", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served}`);
  console.log("served build at the readings:", served);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        if (k.endsWith(":p:" + id)) { localStorage.removeItem(k); continue; }
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
