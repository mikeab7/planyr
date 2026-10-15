/* verify-junction-linework-live — V1717056 (B1783376 ×3), driven LIVE as the test account, light AND dark, zoomed in close on the junction.
 *
 * Seeds a THROWAWAY site through the app's own local-cache path (same as verify-junction-deco-live) holding six scenes far apart:
 *   P  a plain drive straight into a parking pad                       (the owner's case: Concept A (BN LOI))
 *   O  an oblique drive (35°) into a parking pad
 *   R  a drive into a parking pad rotated 20°
 *   V  a drive into a PAVING pad
 *   M  a 24 ft drive that tees onto a 40 ft trunk with its own red 4 px outline, and drives into a pad — drive narrower than, and styled differently from, its trunk
 *   T  a plain tee
 * and asks the DEPLOYED app's own geometry (`window.__plannerRoadNet()`) and a REAL SCREENSHOT the questions e2e/road-junction-linework.spec.js asks locally — via the
 * shared ui-audit/lib/junctionLineworkProbe.mjs: one face-of-curb polyline per side · heading continuous at the tangent · arc ends ON the pad face, nothing inside the
 * pad · the outline and the stripes share weight/colour/opacity per road · no run darker than both fills along the pad face between the tangents · the exported sheet
 * carries the band-outline cuts. KNOWN-GOOD ARM (WRONG-CASE): the run is VOID unless the app built 5 drives + 2 tees and the scene-M trunk carries its red style.
 * The throwaway is ALWAYS deleted and confirmed gone (owner constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-junction-linework-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { stripesPerRoad, joinTurns, maxTurn, padFaceCheck, mouthDarkness, stripeLinesOf } from "./lib/junctionLineworkProbe.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const MAX_EXCESS = 4;   // see e2e/road-junction-linework.spec.js: the fixed build reads 0.0 (a clean blend of the two fills); a stroked line reads 9 – 10
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-jl-" + Math.random().toString(36).slice(2, 7);
const siteName = (scheme) => `ZZ JL ${RUN.slice(-5)} ${scheme}`;
const idOf = (scheme) => `${RUN}-${scheme}`;
const ALL_IDS = [];

const P = (x, y) => ({ x, y });
const road = (id, pts, o = {}) => ({ id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: 34, curb: 0.5, roadClass: "local", cx: pts[0].x, cy: pts[0].y, w: 10, h: 10, rot: 0, ...o });
const pad = (id, o = {}) => ({ id, type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0, ...o });
const at = (dx, dy, els) => els.map((e) => ({ ...e, pts: e.pts ? e.pts.map((p) => P(p.x + dx, p.y + dy)) : e.pts, ...(typeof e.cx === "number" ? { cx: e.cx + dx, cy: e.cy + dy } : {}) }));
const rad = (d) => (d * Math.PI) / 180;
const rotatedScene = (deg) => {
  const up = { x: Math.sin(rad(deg)), y: -Math.cos(rad(deg)) }, face = { x: up.x * 100, y: 100 + up.y * 100 };
  return [pad("R-PAD", { rot: deg }), road("R-S", [P(face.x + up.x * 300, face.y + up.y * 300), P(face.x - up.x * 10, face.y - up.y * 10)])];
};
const SCENES = [
  { key: "P", drive: "P-S", els: [pad("P-PAD"), road("P-S", [P(0, -300), P(0, 10)])], at: [0, 0] },
  { key: "O", drive: "O-S", els: [pad("O-PAD"), road("O-S", [P(-172, -235), P(0, 10)])], at: [1100, 0] },
  { key: "R", drive: "R-S", els: rotatedScene(20), at: [2200, 0] },
  { key: "V", drive: "V-S", els: [pad("V-PAD", { type: "paving" }), road("V-S", [P(0, -300), P(0, 10)])], at: [0, 900] },
  { key: "M", drive: "M-S", els: [pad("M-PAD"), road("M-T", [P(-300, -150), P(0, -150), P(300, -150)], { travelW: 40, stroke: "#b00020", strokeWidth: 4 }), road("M-S", [P(0, -150), P(0, 10)], { travelW: 24 })], at: [1100, 900] },
  { key: "T", tee: true, els: [road("T-G", [P(-300, 0), P(0, 0), P(300, 0)]), road("T-S", [P(0, -250), P(0, 0)])], at: [2200, 900] },
];
const mkSite = (id, name) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: [P(-2200, 2400), P(4600, 2400), P(4600, 3000), P(-2200, 3000)] }],   // parked clear of every scene: no acreage chip near a measured mouth
  els: SCENES.flatMap((s) => at(s.at[0], s.at[1], s.els)),   // the rotated pad's road was built relative to the pad centre; `at` shifts both, so the geometry stays consistent
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE, contextOptions: { deviceScaleFactor: 2 } });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const net = () => page.evaluate(() => window.__plannerRoadNet());

async function openScenario(scheme) {
  const id = idOf(scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.evaluate(() => { window.__PLANYR_E2E = true; });
  await page.getByText(siteName(scheme), { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(2500);
  await assertMeasurable(page, "verify-junction-linework-live");
  await page.waitForFunction(() => { const n = window.__plannerRoadNet && window.__plannerRoadNet(); return n && n.drives.length >= 5 && n.tees.length >= 2; }, null, { timeout: 25000 }).catch(() => {});
  return id;
}
async function zoomTo(at, ppf) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(([x, y, z]) => window.__plannerView.centerOn(x, y, z), [at.x, at.y, ppf]);
    await sleep(450);
    const v = await page.evaluate(() => window.__plannerView.get());
    if (Math.abs(v.ppf - ppf) < 1e-3) { await sleep(500); return page.evaluate(() => window.__plannerView.get()); }
  }
  throw new Error("could not settle the view at " + ppf);
}
const mouthCentre = (d) => ({ x: (d.throughTangents[0].x + d.throughTangents[1].x) / 2, y: (d.throughTangents[0].y + d.throughTangents[1].y) / 2 });

try {
  const seeded = {};
  for (const scheme of ["light", "dark"]) { const id = idOf(scheme); ALL_IDS.push(id); seeded[id] = mkSite(id, siteName(scheme)); }
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  for (const scheme of ["light", "dark"]) {
    console.log(`\n=== ${scheme.toUpperCase()} ===`);
    await openScenario(scheme);
    const n = await net();
    // known-good arm — VOID unless the instrument saw what the checks are about
    const trunk = n && (n.roads || []).find((r) => r.id === "M-T");
    if (!n || n.drives.length !== 5 || n.tees.length !== 2 || !trunk || !n.stripes || !n.pads) throw new Error(`VOID run — expected 5 drives + 2 tees and the M trunk; saw ${n ? `${n.drives.length} drives, ${n.tees.length} tees, trunk ${trunk ? "present" : "missing"}` : "no hook"}`);
    ok(`[${scheme}] known-good: 5 drives + 2 tees built`, true);

    for (const sc of SCENES.filter((x) => x.drive)) {
      const drive = n.drives.find((d) => d.sideId === sc.drive);
      if (!drive) { ok(`[${scheme}] ${sc.key}: the drive junction was built`, false); continue; }
      const tag = `[${scheme}] ${sc.key}`;
      ok(`${tag}: the drive's face-of-curb is ONE polyline per side`, stripesPerRoad(n, sc.drive) === 2, `lines=${stripesPerRoad(n, sc.drive)}`);
      const turns = joinTurns(n, drive);
      ok(`${tag}: heading continuous at the tangent (${turns.map((t) => (t.turn == null ? "—" : t.turn.toFixed(2) + "°")).join(" / ")})`, turns.every((t) => t.turn != null && t.turn < 1));
      ok(`${tag}: no kink anywhere on the stripe (max ${maxTurn(n, sc.drive).toFixed(2)}°)`, maxTurn(n, sc.drive) < 2);
      const pf = padFaceCheck(n, drive);
      ok(`${tag}: the arc ends ON the pad face and nothing is inside the pad (ends ${pf.ends.map((e) => e.toFixed(3)).join("/")}, deepest ${pf.deepest.toFixed(3)})`, pf.ends.length === 2 && pf.ends.every((e) => e < 0.1) && pf.deepest < 0.05);
      // the picture, close in on the junction
      const view = await zoomTo(mouthCentre(drive), 8);
      const img = decodePng(await page.getByTestId("planner-canvas").screenshot());
      const m = mouthDarkness(img, view, 2, drive);
      ok(`${tag}: no line across the drive mouth (face ${m.lMin.toFixed(1)}…${m.lMax.toFixed(1)} vs fills ${m.lRoad.toFixed(1)} / ${m.lPad.toFixed(1)}; excess ${m.excess.toFixed(1)})`, m.excess <= MAX_EXCESS);
      if (SHOTS) await page.getByTestId("planner-canvas").screenshot({ path: `${SHOTS}/${scheme}-${sc.key}.png` }).catch(() => {});
    }

    // outline vs stripes, per road — in the DOM, on the deployed build
    const styles = await page.evaluate(() => {
      const read = (n) => ({ stroke: n.getAttribute("stroke"), width: n.getAttribute("stroke-width"), opacity: n.getAttribute("stroke-opacity") });
      return ["P-S", "O-S", "R-S", "V-S", "M-S", "M-T", "T-S", "T-G"].map((id) => ({ id, edge: (() => { const e = document.querySelector(`[data-testid="road-network-edge"][data-edge-road="${id}"]`); return e ? read(e) : null; })(), stripes: [...document.querySelectorAll(`[data-road-deco="${id}"] polyline`)].map(read) }));
    });
    for (const r of styles) {
      const same = r.edge && r.stripes.length && r.stripes.every((x) => x.stroke === r.edge.stroke && x.width === r.edge.width && x.opacity === r.edge.opacity);
      ok(`[${scheme}] ${r.id}: its outline and its face-of-curb stripes are one weight / colour`, !!same, JSON.stringify(r));
    }
    const mS = styles.find((r) => r.id === "M-S"), mT = styles.find((r) => r.id === "M-T");
    ok(`[${scheme}] M: the narrow drive is not outlined in the trunk's red`, !!(mS.edge && mT.edge && mS.edge.stroke !== mT.edge.stroke));

    // a plain tee: one polyline per side, ending where the through road's stripe begins
    ok(`[${scheme}] T: the tee's side road has ONE polyline per side`, stripesPerRoad(n, "T-S") === 2);
    const through = stripeLinesOf(n, "T-G");
    ok(`[${scheme}] T: each side stripe ends exactly where the through road's begins`, stripeLinesOf(n, "T-S").every((l) => { const e = l[l.length - 1]; return through.some((t) => [t[0], t[t.length - 1]].some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 1e-3)); }));

    // PDF-PARITY — the clone carries the interrupted band outlines and the interrupted pad outlines
    const exp = await page.evaluate(async () => {
      const m = window.__plannerExportSvg ? String(await window.__plannerExportSvg()) : "";
      const doc = new DOMParser().parseFromString(m, "image/svg+xml");
      return { len: m.length, band: doc.querySelectorAll('[data-testid="band-outline-cut"]').length, rect: doc.querySelectorAll('[data-testid="rect-outline-cut"]').length };
    });
    const live = await page.evaluate(() => ({ band: document.querySelectorAll('[data-testid="band-outline-cut"]').length, rect: document.querySelectorAll('[data-testid="rect-outline-cut"]').length }));
    ok(`[${scheme}] the exported sheet carries the same interrupted pad / stall-row outlines as the screen (band ${exp.band} vs ${live.band}, outline ${exp.rect} vs ${live.rect})`, exp.len > 1000 && exp.band === live.band && exp.rect === live.rect && live.band > 0);
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  const gone = await page.evaluate(async ([ids, uid]) => {
    let all = true;
    for (const id of ids) {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      if (q.error || (q.data || []).length) all = false;
    }
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((id) => delete m[id]); localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return all;
  }, [ALL_IDS, UID]).catch(() => false);
  ok("throwaway sites deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
