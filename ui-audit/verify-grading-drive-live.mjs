/* verify-grading-drive-live — NEW-1 (2026-11-12, V2115881 re-opened after the owner's FAILED live check on build 7890542): a PLAIN ROAD (the Road tool's `type: "road"`,
 * `pts`, 26 ft) drawn from just outside the property line to a trailer row must tie into the road's grade at the line — nothing graded past the line, or the
 * "Drive too steep" flag. This drives the REAL deployed planner (not the harness): a THROWAWAY plan written to the test account (deleted and verified gone, constraint
 * #15), grading is owner-only so is_admin is answered `true` inside THIS headless browser only (Playwright route — nothing in the product or database changes).
 *
 * CASES (each a separate throwaway plan, judged on the real Grading panel + the painted map):
 *   outside   — the owner's repro: starts 25 ft OUTSIDE the west line, ends on the west trailer row
 *   online    — starts exactly ON the west line
 *   inside    — ends inside the parcel SHORT of the line (not a drive: must change nothing, no tie-in label)
 *   east      — crosses the EAST line (lower ground) to the east trailer row
 *   gap41     — ROUND 3 (V2115881, owner 2026-11-12): ends ~41 ft SHORT of the trailer row (nothing within the old 15-ft reach); must still be a drive served by the row's edge
 *   gap200    — ROUND 3: ends ~200 ft short of every graded element (past the 120-ft reach): a drive that runs to the existing ground, never "not a plane"
 *   node      — the same `outside` road through the Node engine, for the number to compare
 * VOID RULES: the known-bad arm is `--base <a build without the fix>`; a run whose `outside` case shows no road on the map is VOID.
 *   node ui-audit/verify-grading-drive-live.mjs [--base https://planyr.io] [--case outside|online|inside|east|all] [--out dir] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CHEHAW_CONCEPT_A_ROWS, rowRing } from "./lib/chehawCrossDock.mjs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";
import { mkdirSync, readFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--base", "https://planyr.io");
const which = arg("--case", "all");
const OUT = arg("--out", new URL("./screenshots/grading/live/", import.meta.url).pathname);
mkdirSync(OUT, { recursive: true });
const srcSelf = readFileSync(new URL("./diagnose-grading-boundary-live.mjs", import.meta.url), "utf8");
const PARCEL = JSON.parse(srcSelf.split("\n").find((l) => l.startsWith("const PARCEL = ")).replace(/^const PARCEL = /, "").replace(/;\s*$/, "").replace(/\.map\(.*$/, ""));
const ring = PARCEL.map(([x, y]) => ({ x, y }));
const RUN = Math.random().toString(36).slice(2, 6);

/* geometry: a straight road from `startOutFt` beyond the property line (on the side facing `from`) to a point `inFt` inside the target ring */
const ptIn = (p, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c; return c; };
const nearestOn = (p, r) => { let b = null, bd = 1e12; for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; const dx = c.x - a.x, dy = c.y - a.y, L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0; const q = { x: a.x + dx * t, y: a.y + dy * t }; const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; b = q; } } return b; };
function roadFrom(probe, targetId, outsideFt, inFt) {
  const row = CHEHAW_CONCEPT_A_ROWS.find((e) => e.id === targetId), tr = rowRing(row);
  const q = nearestOn(probe, tr), cx = tr.reduce((a, p) => a + p.x, 0) / tr.length, cy = tr.reduce((a, p) => a + p.y, 0) / tr.length;
  const k = Math.hypot(cx - q.x, cy - q.y) || 1, far = { x: q.x + ((cx - q.x) / k) * inFt, y: q.y + ((cy - q.y) / k) * inFt };   // `inFt` inside the trailer row
  // walk from the far end toward the probe (outside the parcel) and find where the line is crossed
  const dx = probe.x - far.x, dy = probe.y - far.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  let cross = null;
  for (let s = 0; s <= L + 400; s += 0.5) { const p = { x: far.x + ux * s, y: far.y + uy * s }; if (!ptIn(p, ring)) { cross = s; break; } }
  if (cross == null) throw new Error("no crossing");
  const start = { x: far.x + ux * (cross + outsideFt), y: far.y + uy * (cross + outsideFt) };
  return { start, far, crossing: { x: far.x + ux * cross, y: far.y + uy * cross }, len: cross + outsideFt };
}
/* ROUND 3 gap cases: the road's far end is pulled back toward the road until it sits `gapFt` from the NEAREST graded paved row (any of them — court, trailer rows, lots), so the
 * case really is "ends N ft short of everything", not "short of one row" (the first cut of gap41 / gap200 ended 5 / 24 ft from another row and proved nothing). */
function gapCase(gapFt) {
  const g0 = roadFrom({ x: -700, y: -300 }, "e340olvzwe", 25, 10);
  const paved = CHEHAW_CONCEPT_A_ROWS.filter((e) => e.type !== "building").map(rowRing);
  const dist = (p) => Math.min(...paved.map((r) => (ptIn(p, r) ? 0 : Math.hypot(p.x - nearestOn(p, r).x, p.y - nearestOn(p, r).y))));
  const dx = g0.start.x - g0.far.x, dy = g0.start.y - g0.far.y, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
  let far = null;
  for (let t = 0; t <= L; t += 0.5) { const p = { x: g0.far.x + ux * t, y: g0.far.y + uy * t }; if (!ptIn(p, ring)) break; if (dist(p) >= gapFt) { far = p; break; } }
  if (!far) throw new Error(`gap case ${gapFt}: no point on the road is ${gapFt} ft clear of every paved row inside the parcel`);
  const g = { ...g0, far, len: Math.hypot(g0.start.x - far.x, g0.start.y - far.y), gapActual: Math.round(dist(far)) };
  return { pts: [g0.start, far], g };
}
const CASES = {
  outside: () => { const g = roadFrom({ x: -700, y: -300 }, "e340olvzwe", 25, 10); return { pts: [g.start, g.far], g }; },
  online: () => { const g = roadFrom({ x: -700, y: -300 }, "e340olvzwe", 0, 10); return { pts: [g.crossing, g.far], g }; },
  inside: () => { const g = roadFrom({ x: -700, y: -300 }, "e340olvzwe", 0, 10); const s = { x: g.crossing.x + (g.far.x - g.crossing.x) * 0.2, y: g.crossing.y + (g.far.y - g.crossing.y) * 0.2 }; return { pts: [s, g.far], g }; },
  short: () => { const g = roadFrom({ x: -600, y: 480 }, "e340olvzwe", 25, 10); return { pts: [g.start, g.far], g }; },
  short2: () => { const g = roadFrom({ x: -640, y: 100 }, "e340olvzwe", 25, 10); return { pts: [g.start, g.far], g }; },
  east: () => { const g = roadFrom({ x: 1000, y: -400 }, "e338olvzwe", 25, 10); return { pts: [g.start, g.far], g }; },
  gap41: () => gapCase(41),
  gap200: () => gapCase(200),
};
const siteWith = (id, pts) => {
  const travelW = 26, curb = 0.5, vtx = pts.map(() => ({}));
  const road = { id: "zzroad", type: "road", pts, vtx, travelW, curb, roadClass: "local", ...roadStripBBox(pts, vtx, travelW, curb, { defaultRadius: 0 }), z: 99999 };
  return {
    id, groupId: id, site: `zz drive ${RUN}`, name: "Concept A copy", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
    parcels: [{ id: "pc1", active: true, locked: false, points: ring }],
    els: [...CHEHAW_CONCEPT_A_ROWS.map((e, i) => ({ ...e, z: i * 1024 })), road], measures: [], callouts: [], markups: [],
    settings: { setback: 25, showSetback: true, truckCourtD: 135, trailerParkD: 50, grading: { enabled: true, layers: { buildable: false, cutfill: true, contours: false, paper: true } } },
    underlay: null, updatedAt: Date.now(), status: "active",
  };
};

const names = which === "all" ? ["outside", "online", "inside", "east", "gap41", "gap200"] : which.split(",");
const s = await openSignedIn({ base, viewport: { width: 1600, height: 1000 } });
const { page, context } = s;
const results = {};
try {
  await assertMeasurable(page, "verify-grading-drive-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| run", RUN);
  await context.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "true" }));
  for (const name of names) {
    const { pts, g } = CASES[name]();
    const id = `zz-drive-${name}-${RUN}`, site = siteWith(id, pts);
    const err = await page.evaluate(async (st) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const r = await window.pfSupabase.from("sites").insert({ id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id });
      return r.error ? String(r.error.message) : null;
    }, site);
    if (err) throw new Error("insert failed: " + err);
    await page.goto(`${base}/#/project/${id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    await page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 240000 }).catch(() => {});
    await page.waitForTimeout(6000);
    // open the Grading panel if it is not showing
    if (!(await page.locator("[data-grading-earthwork]").count())) { await page.locator('button[title="Grading"]').click({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(3000); }
    const info = await page.evaluate(() => ({
      road: !!document.querySelector('[data-el-id="zzroad"]'),
      driveLabels: [...document.querySelectorAll("[data-drive-set] [data-grade-pill] text, [data-spot-label^='drive'] text")].map((t) => t.textContent),
      driveSets: document.querySelectorAll("[data-drive-set]").length,
      pastPill: [...document.querySelectorAll("[data-spot-label='flag'] text, [data-flag-dot] ~ g text")].map((t) => t.textContent),
      panel: [...document.querySelectorAll("[data-grading-flag], [data-testid^='grading-flag']")].map((e) => e.textContent.trim()),
      text: (document.body.innerText.match(/(Cut|Fill)[^\n]*(past the (property )?line|into the)[^\n]*/g) || []).concat(document.body.innerText.match(/Drive too steep[^\n]*/g) || []),
    }));
    // the read-only diagnostic (`?planyrDiag=1` / the session latch): WHY each road is or is not a drive, and who owns any grading past the line
    const diag = await page.evaluate(() => { try { sessionStorage.setItem("planyr:diag", "1"); } catch (_) {} return typeof window.__plannerGradeDrive === "function" ? window.__plannerGradeDrive() : "no hook (build predates it)"; });
    results[name] = { tie: g.crossing, lenFt: Math.round(g.len), ...(g.gapActual != null ? { gapFt: g.gapActual } : {}), ...info, diag };
    console.log(name.padEnd(8), JSON.stringify(results[name]));
    await page.screenshot({ path: `${OUT}drive-live-${name}.png` });
    await page.goto(`${base}/#/`, { waitUntil: "load" }); await page.waitForTimeout(1500);
    const left = await page.evaluate(async (i) => {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", i);
      await window.pfSupabase.from("sites").delete().eq("id", i);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", i);
      for (const k of Object.keys(localStorage)) { if ((localStorage.getItem(k) || "").includes(i)) localStorage.removeItem(k); }
      return q.error ? "err:" + q.error.message : (q.data || []).length;
    }, id);
    console.log("  cleanup: throwaway rows left =", left);
  }
  for (const [n, r] of Object.entries(results)) if (!r.road) console.log(`VOID — case ${n}: the road never reached the map`);
  // THE VERDICT (ROUND 3): for every case that ran — the road reached the map, it is a PLANE (a drive) or says exactly why not, and nothing is graded past the property line
  // (no pastLine cells, no "past the line" sentence on the panel).
  let bad = 0;
  for (const [name, r] of Object.entries(results)) {
    const d = r.diag && typeof r.diag === "object" ? r.diag : null;
    const road = d && d.roads && d.roads[0];
    const checks = {
      road: !!r.road,
      diagnostic: !!d,
      isPlane: !!(road && road.plane),
      pastLine: !d || !d.pastLine || (d.pastLine.cells === 0),
      noPastSentence: !(r.text || []).some((t) => /past the (property )?line/.test(t)),
    };
    const ok = Object.values(checks).every(Boolean);
    if (!ok) bad++;
    console.log(`VERDICT ${name.padEnd(8)} ${ok ? "PASS" : "FAIL"} ${JSON.stringify(checks)}${road && road.plane ? ` served=${road.plane.servedBy} nearest=${road.plane.nearestElementFt}` : road ? ` why=${road.notAPlaneBecause}` : ""}`);
  }
  if (bad) process.exitCode = 1;
} finally { await s.close().catch(() => {}); }
