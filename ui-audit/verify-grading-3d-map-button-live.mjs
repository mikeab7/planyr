/* verify-grading-3d-map-button-live — B2671226 / B2671227 (NEW-1 + NEW-2, 2026-11-11; amends B2671220): the map's "3D" button and the viewer's compass, on the
 * DEPLOYED app, signed in as the TEST account, on throwaway plans (deleted at the end and verified gone — constraint #15).
 *
 * Grading is owner-only (constraint #25). Like diagnose-grading-frames-live, the OWNER arm answers the `is_admin` RPC with `true` INSIDE ITS OWN HEADLESS
 * BROWSER ONLY (a Playwright route) — nothing in the product, the database or `admin_users` changes. The NON-OWNER arm runs first, with no intercept.
 *
 *   A. non-owner (the real answer: false), a plan with grading ON  → no "3D" button, no card, the viewer chunk is never requested (known-good: View + Layers are there)
 *   B. owner (faked answer), the plan with grading ON, Grading panel CLOSED → a "3D" button in the top-right row, LEFT of View, same card height; enabled once graded
 *   C. the Grading panel, opened → has NO "View in 3D" row (it moved to the map)
 *   D. press 3D → the viewer opens (chunk requested only now); the compass reads the camera's heading and turns when the view is orbited; the ground "N" is on screen
 *   E. Esc → the viewer is gone and the map is exactly as it was (zoom + pan unchanged); the 3D button is still there
 *   F. owner (faked), a plan with grading OFF → no 3D button
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grading-3d-map-button-live.mjs [https://planyr.io] [expectedBuildPrefix] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CHEHAW_CROSS_DOCK_ROWS } from "./lib/chehawCrossDock.mjs";
import { northHeadingDeg } from "../src/workspaces/site-planner/lib/grading3d/compass.js";
import { readFileSync } from "node:fs";

const BASE = process.argv[2] || "https://planyr.io", WANT = process.argv[3] || "";
const RUN = Math.random().toString(36).slice(2, 6);
const fails = [], notes = [];
const check = (n, ok, x = "") => (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`);

const src = readFileSync(new URL("./diagnose-grading-freeze-live.mjs", import.meta.url), "utf8");
const PARCEL = JSON.parse(src.match(/const PARCEL = (\[\[.*?\]\])\.map/s)[1]).map(([x, y]) => ({ x, y }));
const mkSite = (id, gradingOn) => ({
  id, groupId: id, site: `zz 3d button ${RUN}`, name: gradingOn ? "Concept A (grading on)" : "Concept A (grading off)", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
  parcels: [{ id: "pc1", active: true, locked: false, points: PARCEL, setbacks: PARCEL.map(() => 25) }],
  els: CHEHAW_CROSS_DOCK_ROWS.map((e, i) => ({ ...e, z: i * 1024 })), measures: [], callouts: [], markups: [],
  settings: { setback: 25, truckCourtD: 135, trailerParkD: 50, grading: { enabled: gradingOn, layers: { buildable: false, cutfill: true, contours: true, paper: true, spots: true } } },
  underlay: null, updatedAt: Date.now(), status: "active",
});
const ON = mkSite(`zz-3dbtn-on-${RUN}`, true), OFF = mkSite(`zz-3dbtn-off-${RUN}`, false);

const s = await openSignedIn({ base: BASE, viewport: { width: 1400, height: 900 } });
const { page, context } = s;
const requested = [];
page.on("request", (r) => { const u = r.url(); if (/Grading3DViewer|\/three[-.]/i.test(u)) requested.push(u); });
const insert = (site) => page.evaluate(async (st) => {
  const { data: u } = await window.pfSupabase.auth.getUser();
  const r = await window.pfSupabase.from("sites").insert({ id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id });
  return r.error ? String(r.error.message) : null;
}, site);
/* The database refuses to permanently delete a LIVE plan (guard `sites_block_delete_live_group`: "not in the trash"), so a bare delete leaves the row behind — the first
 * live run left both throwaway plans standing. Trash first (deleted_at), then delete for good, then ask again: the count returned is what is still there. */
const remove = (id) => page.evaluate(async (i) => {
  await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", i);
  await window.pfSupabase.from("sites").delete().eq("id", i);
  const r = await window.pfSupabase.from("sites").select("id").eq("id", i);
  return (r.data || []).length;
}, id);
const openPlan = async (id, diag = false) => {
  await page.goto(`${BASE}/?cb=${Date.now()}${diag ? "&planyrDiag=1" : ""}#/project/${id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 90000 });
  await page.waitForSelector('[data-testid="view-menu-btn"]', { timeout: 60000 });
  await page.waitForTimeout(2500);
};
const rects = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; };
  return { btn: r('[data-testid="grading-3d-open"]'), card: r('[data-testid="grading-3d-card"]'), view: r('[data-testid="view-menu-btn"]'), disabled: (document.querySelector('[data-testid="grading-3d-open"]') || {}).disabled };
});
let built = null;
try {
  await assertMeasurable(page, "verify-grading-3d-map-button-live");
  built = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  check("signed in as the test account", !!s.proof && s.proof.email === "e2e@planyr.test");
  check(`served build is ${WANT || "(any)"}`, !WANT || String(built).startsWith(WANT), String(built));
  for (const site of [ON, OFF]) { const e = await insert(site); if (e) throw new Error("insert failed: " + e); }

  // ---- A. non-owner ----
  await openPlan(ON.id);
  const a = await rects();
  check("A. KNOWN-GOOD: the View button is on the map (the row exists and can be read)", !!a.view);
  check("A. a NON-owner sees no 3D button on a plan with grading ON (button and card both absent)", !a.btn && !a.card, JSON.stringify(a));
  check("A. …and the viewer's chunk / three.js was never requested", requested.length === 0, requested.join(", "));

  // ---- owner (faked in THIS browser only) ----
  await context.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "true" }));

  // ---- B. owner, grading ON, panel closed ----
  await openPlan(ON.id, true);
  let b = null;
  for (let i = 0; i < 90; i++) { b = await rects(); if (b.btn && b.disabled === false) break; await page.waitForTimeout(1000); }
  check("B. the 3D button is on the map for the owner, with grading on and the Grading panel closed", !!(b && b.btn), JSON.stringify(b));
  check("B. …and it is enabled once the grading has calculated", !!(b && b.btn && b.disabled === false));
  check("B. …it sits in the top-right row to the LEFT of View, on the same line, as tall as the View card", !!(b && b.btn && b.view) && b.card.r <= b.view.l + 1 && Math.abs(b.card.t - b.view.t) <= 3 && Math.abs(b.card.h - b.view.h) <= 3, JSON.stringify(b && { card: b.card, view: b.view }));
  check("B. …and no viewer chunk has been requested yet", requested.length === 0, requested.join(", "));
  const panelBefore = await page.evaluate(() => !!document.querySelector('[data-testid="grading-panel"]'));
  check("B. the Grading panel was closed during B (the button does not need it)", !panelBefore);

  // ---- C. the Grading panel has no 3D row ----
  const gbtn = page.locator('button[title="Grading"], button[aria-label="Grading"], [data-panel-id="grading"]').first();
  const opened = await gbtn.click({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(2500);
  const c = await page.evaluate(() => ({ panel: !!document.querySelector('[data-testid="grading-panel"]'), viewIn3d: /View in 3D/.test(document.body.innerText), row: !!document.querySelector('[data-section="view3d"], [data-testid="grading-view-3d"]') }));
  check("C. KNOWN-GOOD: the Grading panel opened", opened && c.panel, JSON.stringify(c));
  check("C. the Grading panel has NO 'View in 3D' row or button", !c.viewIn3d && !c.row);
  if (opened) await gbtn.click({ timeout: 5000 }).catch(() => {});      // put the panel away again

  // ---- D. open the viewer ----
  const view0 = await page.evaluate(() => { const e = document.querySelector('[data-testid="planner-canvas"]'); return { ppf: e.getAttribute("data-view-ppf"), ox: e.getAttribute("data-view-offx"), oy: e.getAttribute("data-view-offy") }; });
  await page.click('[data-testid="grading-3d-open"]');
  await page.waitForSelector('[data-testid="grading-3d"][data-phase="ready"]', { timeout: 120000 });
  check("D. pressing 3D opens the viewer and the viewer's chunk is requested only now", requested.some((u) => /Grading3DViewer/.test(u)), requested.map((u) => u.split("/").pop()).join(", "));
  await page.waitForTimeout(1500);
  const st = () => page.evaluate(() => window.__grading3d && window.__grading3d.state());
  const hd = () => page.evaluate(() => { const r = document.querySelector('[data-testid="grading-3d-compass"]'); return r ? { h: +r.getAttribute("data-heading"), az: +r.getAttribute("data-az") } : null; });
  const s0 = await st(), h0 = await hd();
  check("D. the compass is in the viewer and reads the camera's heading", !!h0 && !!s0 && Math.abs(h0.h - northHeadingDeg(s0.az)) < 0.02, JSON.stringify(h0));
  const cvb = await (await page.$('[data-grading-3d-canvas]')).boundingBox();
  await page.mouse.move(cvb.x + cvb.width / 2, cvb.y + cvb.height / 2); await page.mouse.down(); await page.mouse.move(cvb.x + cvb.width / 2 + 260, cvb.y + cvb.height / 2 + 10, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(600);
  const s1 = await st(), h1 = await hd();
  check("D. orbiting the view TURNS the compass, and it still equals the heading math for the new azimuth", !!h1 && Math.abs(h1.h - h0.h) > 20 && Math.abs(h1.h - northHeadingDeg(s1.az)) < 0.02, `${h0 && h0.h.toFixed(1)}° → ${h1 && h1.h.toFixed(1)}° (az ${s1 && s1.az.toFixed(2)})`);
  check("D. the ground 'N' sign is inside the window", !!(s1 && s1.north && s1.north.sign.inView), JSON.stringify(s1 && s1.north && s1.north.sign));
  await page.screenshot({ path: new URL("./screenshots/grading3d/live-3d-compass.png", import.meta.url).pathname });
  await page.click('[data-testid="grading-3d-reset"]'); await page.waitForTimeout(600);
  const h2 = await hd();
  check("D. Reset view returns the compass to the opening heading", !!h2 && Math.abs(h2.h - h0.h) < 0.02, `${h2 && h2.h.toFixed(2)}° vs ${h0 && h0.h.toFixed(2)}°`);

  // ---- E. Esc returns to the map as it was ----
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="grading-3d"]', { state: "detached", timeout: 8000 }).catch(() => {});
  const view1 = await page.evaluate(() => { const e = document.querySelector('[data-testid="planner-canvas"]'); return { ppf: e.getAttribute("data-view-ppf"), ox: e.getAttribute("data-view-offx"), oy: e.getAttribute("data-view-offy"), viewer: !!document.querySelector('[data-testid="grading-3d"]'), btn: !!document.querySelector('[data-testid="grading-3d-open"]') }; });
  check("E. Esc closes the viewer; the map's zoom and pan are exactly as they were; the 3D button is still there", !view1.viewer && view1.btn && view1.ppf === view0.ppf && view1.ox === view0.ox && view1.oy === view0.oy, JSON.stringify({ before: view0, after: view1 }));

  // ---- F. owner, grading OFF ----
  await openPlan(OFF.id);
  const f = await rects();
  check("F. KNOWN-GOOD: the View button is on the map of the grading-off plan", !!f.view);
  check("F. the owner sees NO 3D button on a plan that never turned grading on", !f.btn && !f.card, JSON.stringify(f));
} finally {
  const left = [];
  try { await page.goto(`${BASE}/?cb=${Date.now()}#/library`, { waitUntil: "load" }); await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 }); } catch (_) { /* cleanup still tries below */ }   // away from the planner, so it cannot re-save a row mid-delete
  for (const id of [ON.id, OFF.id]) { try { left.push(await remove(id)); } catch (e) { left.push("err " + e.message); } }
  check("the throwaway plans are deleted and verified gone (constraint #15)", left.every((n) => n === 0), JSON.stringify(left));
  console.log(`served build ${built} · run ${RUN}`);
  console.log(notes.join("\n")); if (fails.length) { console.log("\nFAILURES:\n" + fails.join("\n")); process.exitCode = 1; } else console.log(`\nverify-grading-3d-map-button-live: all ${notes.length} checks passed`);
  await s.close();
}
