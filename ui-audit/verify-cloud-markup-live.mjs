/* verify-cloud-markup-live — NEW-1 (2026-11-06, B2671193): A FINISHED CLOUD MARKUP READS AS A CLOUD, AND ITS DOTS BELONG TO ITS SELECTION,
 * on a REAL deploy, signed in as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-cloud-markup-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway plan (a parcel + two buildings standing in for "two ramps"), draws a cloud round them with the REAL Cloud tool, and reads —
 * each reading in the SAME page call as /version.json (a stale cached bundle makes a reading meaningless):
 *   · the scallop radius on screen (the thing that was wrong: ~a fifth of a pixel at whole-site zoom → now a readable size)
 *   · dots: shown while the cloud is selected (just drawn), GONE after Esc and after a click on empty ground
 *   · a plain press on a vertex dot never edits the shape
 *   · the printed sheet (__plannerExportSvg) carries the scallops and NO dots, even with the cloud selected
 *   · a reload keeps the cloud, scalloped, with no dots; the stored arc size is read back from the cloud row
 * Known-good arm (a probe that could not see the effect is not evidence): the dots ARE present while selected, so "0 dots" is a reading and not
 * an instrument that cannot see them.
 * Deletes the throwaway at the end and VERIFIES it is gone (owner constraint 15). The standing fixtures are never touched.
 * FOREGROUND-OR-VOID: asserted before anything is measured. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-cloud-reads-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Cloud reads", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -520, y: -420 }, { x: 520, y: -420 }, { x: 520, y: 520 }, { x: -520, y: 520 }] }],
  els: [
    { id: "rampA", type: "building", cx: -120, cy: 0, w: 140, h: 60, rot: 0, z: 1024 },
    { id: "rampB", type: "building", cx: 140, cy: 60, w: 140, h: 60, rot: 0, z: 2048 },
  ],
  measures: [], markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
let served = null;

/* ONE evaluate: the build read shares the call with the assertion. */
const readState = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
  const g = document.querySelector('[data-mk-kind="cloud"]');
  const d = g?.querySelector("path:not([stroke='rgba(0,0,0,0.001)'])")?.getAttribute("d") || "";
  const radii = [...d.matchAll(/A\s+([\d.]+)\s+([\d.]+)/g)].map((m) => +m[1]);
  const poly = g?.querySelector("polygon")?.getAttribute("points")?.split(" ").map((q) => q.split(",").map(Number)) || [];
  const handles = document.querySelectorAll('[data-testid="vtx-handle"]');
  return {
    build, clouds: document.querySelectorAll('[data-mk-kind="cloud"]').length,
    handles: handles.length, selected: !!document.querySelector('[data-testid="markup-selected"]'),
    arcs: radii.length, minRadiusPx: radii.length ? Math.min(...radii) : 0,
    shape: poly.map(([x, y]) => `${(x - poly[0][0]).toFixed(2)},${(y - poly[0][1]).toFixed(2)}`).join(" "),
    handlesNotPrinted: [...handles].every((h) => h.getAttribute("data-export") === "skip"),
  };
});
const readSheet = () => page.evaluate(async () => {
  const doc = new DOMParser().parseFromString(await window.__plannerExportSvg(), "image/svg+xml");
  const d = doc.querySelector('[data-mk-kind="cloud"] path:not([stroke="rgba(0,0,0,0.001)"])')?.getAttribute("d") || "";
  return { cloudInSheet: !!doc.querySelector('[data-mk-kind="cloud"]'), arcs: (d.match(/\sA\s/g) || []).length, dots: doc.querySelectorAll('[data-testid="vtx-handle"]').length };
});

try {
  await assertMeasurable(page, "verify-cloud-markup-live");
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
  const canvas = page.getByTestId("planner-canvas");
  await canvas.waitFor({ timeout: 45000 });
  // el-tier: the throwaway plan seeds exactly these pieces, so the element tier IS the readiness gate
  await page.waitForFunction(() => ["rampA", "rampB"].every((id) => document.querySelector(`[data-el-id="${id}"]`)), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const box = await canvas.boundingBox();
  // a ring round both buildings, in screen space around the buildings' own boxes
  const rects = await page.evaluate(() => ["rampA", "rampB"].map((id) => { const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
  const L = Math.min(...rects.map((r) => r.l)) - 20, T = Math.min(...rects.map((r) => r.t)) - 20, R = Math.max(...rects.map((r) => r.r)) + 20, B = Math.max(...rects.map((r) => r.b)) + 20;
  const mx = (L + R) / 2, my = (T + B) / 2;
  const RING = [[L, T], [mx, T - 10], [R, T], [R + 10, my], [R, B], [mx, B + 10], [L, B], [L - 10, my]];
  const away = { x: box.x + 60, y: box.y + 150 }; // empty ground, clear of the parcel and the buildings

  await page.mouse.click(away.x, away.y); await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  for (const [x, y] of RING) await page.mouse.click(x, y);
  await page.mouse.click(RING[0][0], RING[0][1]); // close on the first dot
  await page.waitForFunction(() => document.querySelectorAll('[data-mk-kind="cloud"]').length === 1, null, { timeout: 10000 });
  await page.waitForTimeout(500);

  let st = await readState(); served = st.build;
  check("known-good arm: the dots ARE there while the just-drawn cloud is selected (so '0 dots' below is a reading)", st.selected && st.handles >= RING.length, `selected=${st.selected} dots=${st.handles}`);
  check("the cloud reads as a cloud: a chain of arcs, not straight segments", st.arcs > RING.length, `arcs=${st.arcs}`);
  check("the scallops are a readable size on screen", st.minRadiusPx >= 5, `smallest arc radius ${st.minRadiusPx.toFixed(2)} (was ~0.2 before the fix)`);
  check("the dots never print (every dot is data-export=skip)", st.handlesNotPrinted);

  const sheetSel = await readSheet();
  check("printed sheet with the cloud STILL selected: the scallops are there and no dots", sheetSel.cloudInSheet && sheetSel.arcs > RING.length && sheetSel.dots === 0, JSON.stringify(sheetSel));

  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  st = await readState();
  check("Esc lets go: no dots, nothing selected", st.handles === 0 && !st.selected, `dots=${st.handles} selected=${st.selected}`);

  await page.mouse.click(RING[0][0], RING[0][1]); await page.waitForTimeout(400); // select again by its outline
  const sel2 = await readState();
  check("a click on the outline selects it again (dots back)", sel2.selected && sel2.handles > 0);
  const shapeBefore = sel2.shape;
  await page.mouse.click(RING[0][0], RING[0][1]); await page.waitForTimeout(400); // a plain press on a vertex dot
  check("a plain press on a vertex dot never edits the shape", (await readState()).shape === shapeBefore);
  await page.mouse.click(away.x, away.y); await page.waitForTimeout(400);
  st = await readState();
  check("a click on empty ground lets go: no dots, nothing selected", st.handles === 0 && !st.selected, `dots=${st.handles} selected=${st.selected}`);

  await page.waitForTimeout(3000); // let the cloud save land
  // a signed-in plan's markups live in the site_elements ROWS (kind 'markup'), not in the plan blob — read them there
  const stored = await page.evaluate(async (id) => {
    const q = await window.pfSupabase.from("site_elements").select("id,data,rev,deleted_at").eq("site_id", id).eq("kind", "markup").is("deleted_at", null);
    const mk = ((q.data) || []).filter((r) => r.data && r.data.kind === "cloud");
    return { n: mk.length, arcFt: mk[0] && mk[0].data.arcFt, pts: mk[0] && (mk[0].data.pts || []).length, rev: mk[0] && mk[0].rev, err: q.error ? String(q.error.message) : null };
  }, ID);
  check("the cloud row reached the cloud with a stored arc size", stored.n === 1 && stored.arcFt > 0, JSON.stringify(stored));
  check("no stray edit after drawing: the row is still at its first revision (select / deselect / a plain press on a dot wrote nothing)", stored.rev === 1, `rev ${stored.rev}`);

  await page.reload({ waitUntil: "load" });
  await canvas.waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('[data-mk-kind="cloud"]'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  const rel = await readState(); served = rel.build;
  check("after a reload: the cloud is there, scalloped, with no dots and nothing selected", rel.clouds === 1 && rel.arcs > RING.length && rel.minRadiusPx >= 5 && rel.handles === 0 && !rel.selected, JSON.stringify({ arcs: rel.arcs, r: rel.minRadiusPx, dots: rel.handles }));
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
