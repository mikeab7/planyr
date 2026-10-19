/* diagnose-grading-freeze-live — NEW-1 of the grading-freeze report (problem report 6cea9895, capture atWall
 * 1792413374060): reproduce the owner's 6-second main-thread stall on the REAL deployed app, on a THROWAWAY copy
 * of his Georgia Test Site › Concept A geometry written to the test account, and name what ran.
 *
 *   node ui-audit/diagnose-grading-freeze-live.mjs [--base https://planyr.io] [--runs 2] [--drag]
 *
 * Grading is owner-only (constraint #25; lib/gradingGate.js reads is_admin()). This harness answers the is_admin
 * RPC with `true` INSIDE ITS OWN HEADLESS BROWSER ONLY (Playwright route) — nothing in the product, the database
 * or admin_users changes, and no other browser is affected. It is the only way a session can drive the gated path.
 *
 * Shape (the owner's machine, from the capture): viewport 1913×641, deviceScaleFactor 2.68, a COLD context (no
 * IndexedDB / localStorage), the plan opened, Site Analysis clicked a few seconds later while the grading sweep, the
 * auto-FFE solve and the screening are all in flight. Recorded: every long-animation-frame with its scripts
 * (invoker, source, function, duration) and a CPU profile across the whole window, reduced to self+total time per
 * function. Every throwaway site is deleted at the end and verified gone (constraint #15). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { CHEHAW_CROSS_DOCK_ROWS } from "./lib/chehawCrossDock.mjs";
import { writeFileSync } from "node:fs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("--base", "https://planyr.io");
const runs = +arg("--runs", "2");
const doDrag = process.argv.includes("--drag");
const out = arg("--out", null);
const RUN = Math.random().toString(36).slice(2, 6);
const PARCEL = [[687.46,-1170.96],[676.36,-745.72],[889.65,-744.71],[867,290.42],[867.07,907.41],[856.07,932.9],[652.84,1084.61],[537.47,1167.6],[492.56,1157.05],[466.6,1137.62],[435.11,1133.74],[411.91,1150.39],[399.2,1139.84],[397.55,1112.09],[406.39,1095.99],[412.47,1073.79],[404.73,1058.25],[331.81,1087.11],[327.94,1102.09],[355.01,1113.75],[363.85,1134.84],[325.73,1164.26],[301.42,1170.92],[252.81,1158.15],[228.5,1143.16],[179.34,1119.85],[174.92,1105.97],[163.32,1090.43],[140.11,1095.43],[145.64,1127.06],[137.35,1142.6],[126.3,1137.05],[119.67,1106.53],[60.57,1043.81],[79.9,1004.95],[44.55,992.74],[4.22,1039.92],[-7.94,1021.05],[-10.7,959.99],[-40.53,899.49],[-97.6,818.7],[-110.54,788.34],[-140.75,757.99],[-177.01,757.12],[-219.3,728.5],[-265.05,716.36],[-291.81,679.06],[-344.47,675.59],[-365.18,646.11],[-396.26,635.7],[-448.91,620.09],[-489.48,583.66],[-593.93,536.83],[-635.36,530.76],[-687.15,486.53],[-735.76,467.34],[-733.8,431.65],[-718.06,330.64],[-702.07,278.07],[-673.35,202.28],[-654.12,145.19],[-642.38,105.04],[-633.13,62.5],[-625.14,7.42],[-623.64,-44.4],[-625.14,-68.74],[-636.63,-137.88],[-714.56,-405.78],[-766.76,-615.95],[-780.75,-675.93],[-838.45,-956],[-872.17,-1107.96],[-889.65,-1168.31],[-177.77,-1167.55],[643.52,-1170.79]].map(([x, y]) => ({ x, y }));
const mkSite = (n) => {
  const id = `zz-grfreeze-${RUN}-${n}`;
  return {
    id, groupId: id, site: `zz grading freeze ${RUN}`, name: `Concept A ${n}`, origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
    parcels: [{ id: "pc1", active: true, locked: false, points: PARCEL, setbacks: PARCEL.map(() => 25) }],
    els: CHEHAW_CROSS_DOCK_ROWS.map((e, i) => ({ ...e, z: i * 1024 })), measures: [], callouts: [], markups: [],
    settings: { setback: 25, truckCourtD: 135, trailerParkD: 50, grading: { layers: { buildable: false } } },
    underlay: null, updatedAt: Date.now(), status: "active",
  };
};
const SITES = Array.from({ length: runs }, (_, i) => mkSite(i + 1));

const initLoaf = () => {
  window.__loaf = [];
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < 100) continue;
        window.__loaf.push({ t: Math.round(e.startTime), dur: Math.round(e.duration), blk: Math.round(e.blockingDuration || 0),
          scripts: (e.scripts || []).map((s) => ({ inv: s.invoker, type: s.invokerType, fn: s.sourceFunctionName, url: (s.sourceURL || "").split("/").pop(), pos: s.sourceCharPosition, dur: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) })) });
      }
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch (_) {}
};

const s = await openSignedIn({ base, viewport: { width: 1913, height: 641 }, contextOptions: { deviceScaleFactor: 2.68 }, initScripts: [[initLoaf, null]] });
const { page, context } = s;
const results = [];
try {
  await assertMeasurable(page, "diagnose-grading-freeze-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| run", RUN);
  const ins = await page.evaluate(async (sites) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const errs = [];
    for (const site of sites) {
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      const r = await window.pfSupabase.from("sites").insert(row);
      if (r.error) errs.push(site.id + ": " + String(r.error.message));
    }
    return errs;
  }, SITES);
  if (ins.length) throw new Error("insert failed: " + ins.join("; "));
  // The gate's one answer, inside THIS browser only.
  await context.route(/\/rest\/v1\/rpc\/is_admin/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: "true" }));

  for (const site of SITES) {
    // COLD: drop this origin's storage (IndexedDB caches, the device plan store) but keep the auth session.
    await page.goto(`${base}/#/`, { waitUntil: "load" });
    await page.evaluate(async () => {
      const keep = {}; for (const k of Object.keys(localStorage)) if (/^sb-|supabase/i.test(k)) keep[k] = localStorage.getItem(k);
      localStorage.clear(); for (const [k, v] of Object.entries(keep)) localStorage.setItem(k, v);
      try { for (const d of (await indexedDB.databases())) indexedDB.deleteDatabase(d.name); } catch (_) {}
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Profiler.enable"); await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
    await page.goto(`${base}/#/project/${site.id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => { performance.mark("h:loaded"); });
    await cdp.send("Profiler.start");
    const t0 = Date.now();
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    // the owner clicked into Site Analysis ~5 s after the plan switch
    await page.waitForTimeout(5000);
    const tClick = await page.evaluate(() => performance.now());
    await page.locator('button[title="Analysis"]').click({ timeout: 30000 });
    // wait for the grading card's FFE (the suggestion), then let the screening + paints settle
    let ffe = null;
    for (let i = 0; i < 90; i++) { ffe = await page.evaluate(() => { const a = document.querySelector("[data-ffe-value]"); return a ? a.textContent : null; }); if (ffe && /\d/.test(ffe)) break; await page.waitForTimeout(1000); }
    await page.waitForTimeout(8000);
    let dragFrames = null;
    if (doDrag) {
      const box = await page.locator('[data-el-id="e331olvzwe"]').first().boundingBox().catch(() => null);
      if (box) {
        await page.evaluate(() => { window.__loafDragFrom = performance.now(); });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let k = 1; k <= 20; k++) await page.mouse.move(box.x + box.width / 2 + k * 3, box.y + box.height / 2 + k * 2);
        await page.mouse.up();
        await page.waitForTimeout(6000);
        dragFrames = await page.evaluate(() => window.__loaf.filter((e) => e.t >= window.__loafDragFrom).map((e) => e.dur));
      }
    }
    const { profile } = await cdp.send("Profiler.stop");
    const loaf = await page.evaluate(() => window.__loaf);
    // reduce the profile: self time per function, and inclusive (total) time per function
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map(); for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const dt = profile.timeDeltas; const self = new Map(), total = new Map();
    const key = (n) => `${n.callFrame.functionName || "(anon)"} @${(n.callFrame.url || "").split("/").pop()}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`;
    profile.samples.forEach((id, i) => {
      const d = (dt[i + 1] || 0) / 1000; const n = byId.get(id); if (!n) return;
      self.set(key(n), (self.get(key(n)) || 0) + d);
      const seen = new Set(); let cur = id;
      while (cur != null) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); total.set(k, (total.get(k) || 0) + d); } cur = parent.get(cur); }
    });
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${Math.round(v)} ms  ${k}`);
    const r = { site: site.id, wallMs: Date.now() - t0, clickAt: Math.round(tClick), ffe, longest: Math.max(0, ...loaf.map((e) => e.dur)), loaf, dragFrames, selfTop: top(self, 25), totalTop: top(total, 40) };
    results.push(r);
    console.log(`\n=== ${site.id}: click at ${r.clickAt} ms · FFE "${ffe}" · longest frame ${r.longest} ms`);
    for (const e of loaf.filter((x) => x.dur >= 250)) console.log(`  frame @${e.t} ${e.dur} ms (blocking ${e.blk}) :: ` + e.scripts.filter((x) => x.dur >= 20).map((x) => `${x.inv}${x.fn ? "/" + x.fn : ""} ${x.url}:${x.pos} ${x.dur}ms`).join(" | "));
    if (dragFrames) console.log("  drag long frames:", dragFrames.join(", ") || "none ≥100 ms");
    console.log("  — self time —\n   " + r.selfTop.slice(0, 15).join("\n   "));
    console.log("  — total time —\n   " + r.totalTop.slice(0, 30).join("\n   "));
    await cdp.detach().catch(() => {});
  }
} finally {
  try {
    await page.goto(`${base}/#/`, { waitUntil: "load" }); await page.waitForTimeout(2000);
    const ids = SITES.map((x) => x.id);
    const gone = await page.evaluate(async (ids) => {
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids);
      await window.pfSupabase.from("sites").delete().in("id", ids);
      const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
      for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k) || ""; if (ids.some((id) => v.includes(id))) localStorage.removeItem(k); }
      return q.error ? "err:" + q.error.message : (q.data || []).length;
    }, ids);
    console.log(`\ncleanup: throwaway sites left in the cloud = ${gone}`);
  } catch (e) { console.log("cleanup FAILED", String(e).slice(0, 200)); }
  if (out) writeFileSync(out, JSON.stringify(results, null, 1));
  await s.close().catch(() => {});
}
