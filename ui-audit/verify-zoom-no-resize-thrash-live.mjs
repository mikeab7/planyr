#!/usr/bin/env node
/* verify-zoom-no-resize-thrash-live — the same guard as verify-zoom-no-resize-thrash.mjs, but against a REAL DEPLOY, signed in
 * as the throwaway test account (NEW-1 / B2096832; owner decision 2026-10-04: a session's own signed-in check counts).
 *
 *   node ui-audit/verify-zoom-no-resize-thrash-live.mjs [https://planyr.io]
 *
 * What the sandbox harness cannot give: a signed-in session (elementSync live, real Supabase rows), real GIS tile hosts if the egress
 * allows them, and the build the OWNER is actually running. The deployed build id is read from /version.json IN THE SAME CALL as
 * the counts (AGENT-RULES: a live measurement is only valid if the build is read beside the assertion). Plan = the test account's own
 * dense test-fit plan, not Silvestri — the defect is plan-independent (it fires on the first commit's size verdict), which is the point.
 *
 * Counts `map.invalidateSize` / `map.setView` across 96 wheel events (one per frame). Known-good arm: a real viewport resize must
 * produce ≥ 1 invalidateSize call, else the run is VOID. Exits 0 pass · 1 defect present · 2 void.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";

/* The test account's own first plan that HAS AN ORIGIN (no origin → no basemap → no Leaflet map to probe). Resolved at run time, never
 * hard-coded: the test account's plans come and go. */
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const s = await openSignedIn({ base: BASE, viewport: { width: 904, height: 416 } });
const { page } = s;
try {
  await page.evaluate(() => { window.__PLANYR_E2E = true; }); // arms ONLY the read-only __geoMap hook; set before the planner mounts
  const group = await page.evaluate(async () => { const r = await window.pfSupabase.from("sites").select("group_id,id,data").limit(60); const hit = (r.data || []).find((x) => x.data && x.data.origin); return hit ? (hit.group_id || hit.id) : null; });
  if (!group) { console.error("✗ VOID — the test account has no plan with an origin"); process.exit(2); }
  await page.evaluate((id) => { location.hash = `#/project/${id}/site`; }, group);
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  await assertMeasurable(page, "verify-zoom-no-resize-thrash-live");
  await pacedWait(page, 4000);
  const hasMap = await page.evaluate(() => !!window.__geoMap);
  if (!hasMap) { console.error("✗ VOID — window.__geoMap missing (flag set too late, or no basemap on this plan)"); process.exit(2); }
  await page.evaluate(() => {
    const m = window.__geoMap; window.__lp = { inval: 0, setView: 0 };
    for (const [n, k] of [["invalidateSize", "inval"], ["setView", "setView"]]) { const o = m[n].bind(m); m[n] = (...a) => { window.__lp[k]++; return o(...a); }; }
  });
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const ppf = () => page.evaluate(() => +document.querySelector('[data-testid="planner-canvas"]').getAttribute("data-view-ppf"));
  const run = (dy, n) => page.evaluate(([delta, count, x, y]) => new Promise((done) => {
    const el = document.querySelector('[data-testid="planner-canvas"]'); let i = 0;
    const tick = () => { el.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, clientX: x, clientY: y, bubbles: true, cancelable: true })); if (++i < count) requestAnimationFrame(tick); else requestAnimationFrame(() => done()); };
    requestAnimationFrame(tick);
  }), [dy, n, cx, cy]);
  const p0 = await ppf();
  for (let r = 0; r < 2; r++) { await run(-45, 24); await pacedWait(page, 600); await run(45, 24); await pacedWait(page, 600); }
  const p1 = await ppf();
  const counts = await page.evaluate(() => ({ ...window.__lp }));
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null));
  await page.evaluate(() => { window.__lp.inval = 0; });
  await page.setViewportSize({ width: 784, height: 416 }); await pacedWait(page, 1200);
  const resize = await page.evaluate(() => window.__lp.inval);
  console.log(`${BASE} build ${build && build.build} (signed in as ${s.proof.email}) — 96 wheel events, view ppf ${p0.toFixed(3)} → ${p1.toFixed(3)} (moved: ${Math.abs(p1 - p0) > 0 || "net-zero round trip"})`);
  console.log(`  invalidateSize ${counts.inval} · setView ${counts.setView} · resize control ${resize}`);
  if (resize < 1) { console.error("✗ VOID — the known-good arm (a real resize) read 0 invalidateSize calls"); process.exit(2); }
  const bad = counts.inval > 3 || counts.setView > 24;
  console.log(bad ? "✗ DEFECT PRESENT — the gesture re-syncs Leaflet's size per wheel event" : "✓ no per-wheel-event resize re-sync");
  process.exitCode = bad ? 1 : 0;
} finally { await s.close(); }
