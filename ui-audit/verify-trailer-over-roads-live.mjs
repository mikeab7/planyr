/* verify-trailer-over-roads-live — NEW-1 (2026-11-05): TRAILER PARKING ALWAYS DRAWS ABOVE ROADS, on a REAL deploy, signed in as the throwaway test
 * account (owner-ordered exception to root constraint 10; lib/trailerOverRoads.js).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-trailer-over-roads-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway plan with TWO trailer rows — one not rotated, one rotated 30° — each with a road DRAWN AFTER IT (higher z) running through it,
 * plus controls. Reads, in the SAME page call as each reading, /version.json (a stale cached bundle makes a reading meaningless):
 *   · canvas DOM order (paint order): the trailer after its road; deselected, then a SELECTED road lifts above and drops back
 *   · hit test: elementFromPoint at the overlap = the trailer; at road-only ground = the road
 *   · the printed sheet (__plannerExportSvg) and the editable-PDF annotation order (__plannerExportComposed)
 *   · the stored z never changed (read back from the cloud row)
 * Known-good arms (a probe that could not see the effect is not evidence): a PAVING piece with a lower z than a road must STILL paint under it
 * (the exception is trailer-only — plain creation order everywhere else), and a building with a HIGHER z than the road stays above it.
 * Deletes the throwaway at the end and VERIFIES it is gone (owner constraint 15). The standing fixtures are never touched.
 * FOREGROUND-OR-VOID: asserted before anything is measured. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-trailer-over-roads-" + Math.random().toString(36).slice(2, 8);
const TZ = 8192, RZ = 82944;
const rd = (id, y, z) => ({ id, type: "road", z, pts: [{ x: -300, y }, { x: 300, y }], vtx: [{}, {}], travelW: 40, curb: 0.5, roadClass: "local", cx: 0, cy: y, w: 600, h: 40, rot: 0 });
const SITE = {
  id: ID, groupId: ID, site: "zz Trailer over roads", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -520, y: -420 }, { x: 520, y: -420 }, { x: 520, y: 520 }, { x: -520, y: 520 }] }],
  els: [
    { id: "trA", type: "trailer", cx: 0, cy: 0, w: 200, h: 60, rot: 0, z: TZ },            // not rotated
    rd("rdA", 0, RZ),                                                                       // drawn after it, through it
    { id: "trB", type: "trailer", cx: 0, cy: 300, w: 200, h: 60, rot: 30, z: TZ + 1024 },   // rotated
    rd("rdB", 300, RZ + 1024),
    { id: "pavC", type: "paving", cx: 0, cy: -300, w: 200, h: 60, rot: 0, z: 2048 },        // control: NOT a trailer, lower z than its road → stays under
    rd("rdC", -300, RZ + 2048),
    { id: "bldD", type: "building", cx: 0, cy: 450, w: 160, h: 50, rot: 0, z: RZ + 4096 },  // control: higher z than the road → stays above
    rd("rdD", 450, RZ + 3072),
  ],
  measures: [], markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let served = null;

/* Everything below runs in ONE evaluate so the build read shares the call with the assertion. */
const readState = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
  const canvas = document.querySelector('[data-testid="planner-canvas"]');
  const after = (root, aSel, bSel) => { // true = the (first) bSel node paints AFTER every aSel node
    const a = [...root.querySelectorAll(aSel)], b = root.querySelector(bSel);
    if (!a.length || !b) return null;
    return a.every((n) => !!(n.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
  };
  // a road's paint nodes: its cluster fill (data-road-cluster lists the member ids) and its decoration group
  const roadNodes = (root, id) => `[data-road-cluster~="${id}"], [data-road-cluster*="${id}"], [data-road-deco="${id}"], [data-el-id="${id}"]`;
  const trailerOver = (root, tr, rdId) => after(root, roadNodes(root, rdId), `[data-el-id="${tr}"]`);
  const pavingOver = (root) => after(root, `[data-el-id="pavC"]`, roadNodes(root, "rdC")); // true = road after paving (paving under the road)
  const buildingOver = (root) => after(root, roadNodes(root, "rdD"), `[data-el-id="bldD"]`);
  const dom = (root) => ({ trA: trailerOver(root, "trA", "rdA"), trB: trailerOver(root, "trB", "rdB"), pavUnderRoad: pavingOver(root), bldAboveRoad: buildingOver(root) });
  const sheetDoc = new DOMParser().parseFromString(await window.__plannerExportSvg(), "image/svg+xml");
  const c = await window.__plannerExportComposed();
  const nms = c.annots.map((a) => a.nm);
  const idx = (id) => nms.findIndex((n) => n.endsWith("-" + id));
  const rect = (id) => { const r = document.querySelector(`[data-el-id="${id}"]`)?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, right: r.right } : null; };
  return {
    build, canvas: dom(canvas), sheet: dom(sheetDoc),
    annot: { A: idx("trA") > idx("rdA") && idx("rdA") >= 0, B: idx("trB") > idx("rdB") && idx("rdB") >= 0, found: [idx("trA"), idx("rdA"), idx("trB"), idx("rdB")] },
    centres: { trA: rect("trA"), trB: rect("trB") },
  };
});
const featureAt = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest("[data-feature]")?.getAttribute("data-feature") || null, [x, y]);

try {
  await assertMeasurable(page, "verify-trailer-over-roads-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");

  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  // el-tier: the throwaway plan seeds exactly these pieces, so the element tier IS the readiness gate
  await page.waitForFunction(() => ["trA", "trB", "pavC", "bldD"].every((id) => document.querySelector(`[data-el-id="${id}"]`)), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.mouse.click(5, 5); await page.keyboard.press("Escape");

  // ── deselected ──────────────────────────────────────────────────────────────────────────────────
  const st = await readState();
  served = st.build;
  check("known-good arm: PAVING with a lower z than its road still paints UNDER it (plain creation order outside trailers)", st.canvas.pavUnderRoad === true, JSON.stringify(st.canvas));
  check("known-good arm: a building with a HIGHER z than its road stays above it", st.canvas.bldAboveRoad === true);
  check("canvas — the not-rotated trailer paints above the road drawn after it", st.canvas.trA === true);
  check("canvas — the ROTATED trailer paints above the road drawn after it", st.canvas.trB === true);
  check("printed sheet — both trailers above their roads, controls unchanged", st.sheet.trA === true && st.sheet.trB === true && st.sheet.pavUnderRoad === true && st.sheet.bldAboveRoad === true, JSON.stringify(st.sheet));
  check("editable PDF — both trailers are written AFTER their roads", st.annot.A && st.annot.B, JSON.stringify(st.annot.found));

  // ── hit test: the visible trailer is what a click picks; road-only ground still picks the road ──────
  for (const [tr, rdId] of [["trA", "rdA"], ["trB", "rdB"]]) {
    const c = st.centres[tr];
    const roadOnly = await page.evaluate((id) => {
      const r = [...document.querySelectorAll(`[data-road-cluster*="${id}"]`)].map((n) => n.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
      const t = document.querySelector(`[data-el-id="${id === "rdA" ? "trA" : "trB"}"]`).getBoundingClientRect();
      return r ? { x: Math.min(r.right - 25, t.right + (r.right - t.right) / 2), y: t.top + t.height / 2 } : null;
    }, rdId);
    check(`hit test (${tr}): a click on the visible trailer picks the trailer`, (await featureAt(c.x, c.y)) === `el:${tr}`);
    check(`hit test (${tr}): a click on road where no trailer overlaps picks the road`, !!roadOnly && new RegExp("^el:" + rdId).test((await featureAt(roadOnly.x, roadOnly.y)) || ""));
  }

  // ── selection lift: a SELECTED road lifts above the trailer, then drops back ───────────────────────
  const pick = await page.evaluate(() => {
    const r = [...document.querySelectorAll('[data-road-cluster*="rdA"]')].map((n) => n.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0];
    const t = document.querySelector('[data-el-id="trA"]').getBoundingClientRect();
    return { x: Math.min(r.right - 25, t.right + (r.right - t.right) / 2), y: t.top + t.height / 2 };
  });
  await page.mouse.click(pick.x, pick.y); await page.waitForTimeout(600);
  const lifted = await readState();
  check("selected road lifts above the trailer while selected", lifted.canvas.trA === false, JSON.stringify(lifted.canvas));
  await page.keyboard.press("Escape"); await page.mouse.click(5, 5); await page.waitForTimeout(600);
  const dropped = await readState();
  check("…and drops back under it when deselected", dropped.canvas.trA === true && dropped.canvas.trB === true);

  // ── nothing rewritten on disk: stored z unchanged, read back from the cloud row ───────────────────────
  await page.waitForTimeout(2500);
  const stored = await page.evaluate(async (id) => {
    const q = await window.pfSupabase.from("sites").select("data").eq("id", id).single();
    const els = (q.data && q.data.data && q.data.data.els) || [];
    return Object.fromEntries(els.map((e) => [e.id, e.z]));
  }, ID);
  const want = Object.fromEntries(SITE.els.map((e) => [e.id, e.z]));
  check("stored z of every element is unchanged (render-order rule only)", JSON.stringify(stored) === JSON.stringify(want), JSON.stringify(stored));

  // ── reload keeps the picture ────────────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('[data-el-id="trA"]'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const rel = await readState();
  served = rel.build;
  check("after a reload both trailers are still above their roads", rel.canvas.trA === true && rel.canvas.trB === true);
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
