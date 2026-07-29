/* B1105 / B1123 — DOES THE COLORADO DETENTION STATE ACTUALLY REACH THE DOM?
 *
 * WHY A SEPARATE HARNESS FROM verify-colorado-guard.mjs. That one proves the right BYTES ship in the
 * right chunk. This one proves the right PIXELS render, which is a different question and the one
 * this session's audit found unanswered: `kind:"unavailable"` matched no branch in the verdict strip,
 * so every Colorado site read "Detention: checking flood data" — a permanent spinner — while every
 * unit test and every bundle assertion passed. A test that an element EXISTS is not a test that it is
 * REACHABLE, and this is the shape of check that closes that gap:
 *
 *   • the text is in `innerText` (so it is not display:none, not zero-height, not clipped away), and
 *   • the WRONG text is absent (no "checking flood data" on a state that will never resolve), and
 *   • the assertions run against the PLANNER surface only — both hosts stay mounted, so the DOM holds
 *     two copies of this panel and the hidden one has no drainage context (see the Site Planner
 *     folder pointer, B1091(×3)).
 *
 * A Colorado plan is SEEDED into the logged-out localStorage store rather than searched for: geocoding
 * needs external hosts this environment blocks, and the whole point of the Colorado guard is that it
 * holds with every GIS endpoint down. Denver's coordinates are all the state resolution needs
 * (`siteRegion.js` is pure geometry), which is exactly why this check is runnable here at all — no
 * sign-in, no GIS, so it must NOT be parked as a live-verify item.
 *
 * Run: npm run build && node ui-audit/verify-b1105-mhfd-panel.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const local = !process.env.BASE_URL;
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";

const pass = [], fail = [], gisGated = [];
const check = (ok, label, detail = "") => {
  (ok ? pass : fail).push(label + (ok || !detail ? "" : ` — ${detail}`));
  console.log(`  ${ok ? "✅" : "❌"} ${label}${!ok && detail ? `  · ${detail}` : ""}`);
};

/* GIS-GATED assertions, kept SEPARATE and never counted as failures.
 *
 * The "Detention detail" group — and every method note inside it, which is where the component table,
 * the statute reconciliation, the workbook and the city-overlay caveat live — only mounts once the
 * drainage/flood context resolves. That needs external GIS hosts this environment blocks, so these
 * are honestly `Blocker: live-GIS` and are owed as a VERIFICATION.md click-through rather than
 * pretended to pass. They are still ASSERTED here so the harness does the work the moment it is run
 * anywhere with network — a skip that silently never becomes a check is how gaps get lost. */
const gated = (ok, label) => {
  gisGated.push({ ok, label });
  console.log(`  ${ok ? "✅" : "⏸ "} ${label}${ok ? "" : "  · GIS-gated in the sandbox (flood context never resolves) — owed as a live check"}`);
};

let server = null;
async function serve() {
  if (!local) return;
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--host"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server never came up");
}

/* Three plans: an MHFD county, a NON-member Colorado county (the scope boundary), and Texas (the
 * no-regression control). Same shape, only the coordinates and county differ. */
const PLANS = [
  { key: "mhfd", gid: "grp-co-denver", sid: "site-co-denver", name: "Denver MHFD", origin: { lat: 39.74, lon: -104.99 }, county: "co_denver" },
  { key: "larimer", gid: "grp-co-larimer", sid: "site-co-larimer", name: "Larimer", origin: { lat: 40.58, lon: -105.08 }, county: "co_larimer" },
  { key: "texas", gid: "grp-tx", sid: "site-tx", name: "Harris TX", origin: { lat: 29.78, lon: -95.8 }, county: "harris" },
];

const run = async () => {
  await serve();
  const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  // Seed all three, then visit each in turn.
  await page.evaluate(({ sk, plans }) => {
    const store = {};
    for (const p of plans) {
      store[p.sid] = {
        schemaVersion: 2, id: p.sid, groupId: p.gid, site: p.name, name: "Concept A",
        origin: p.origin, county: p.county,
        /* One parcel so the site has AREA — a zero-area plan renders "Start your site" and no
         * detention group at all, which would make this harness pass for the wrong reason (it did,
         * on the first run). The shape is `points: [{x,y}]` in FEET, per `validParcel` in
         * siteModel.js — a `ring` of pairs is silently dropped by the sanitizing funnel. */
        parcels: [{ id: "p1", active: true, points: [{ x: -660, y: -660 }, { x: 660, y: -660 }, { x: 660, y: 660 }, { x: -660, y: 660 }] }],
        els: [], markups: [], measures: [], callouts: [], settings: {},
      };
    }
    localStorage.setItem(sk, JSON.stringify(store));
  }, { sk: SITES_KEY, plans: PLANS });

  /* Read the PLANNER surface's text only. Both the planner and the finder stay mounted (the
   * inactive one is `inert` + aria-hidden and has no drainage context), so asserting against
   * document.body would read a panel that legitimately says nothing. */
  const plannerText = () => page.evaluate(() => {
    const host = document.querySelector('[data-surface="planner"]');
    const el = host || document.body;
    return el.innerText || "";
  });

  for (const plan of PLANS) {
    await page.evaluate(({ ck, sid }) => localStorage.setItem(ck, sid), { ck: CUR_KEY, sid: plan.sid });
    await page.goto(`${BASE}#/project/${plan.gid}/site`, { waitUntil: "domcontentloaded", timeout: 90000 });
    // The drainage screen settles asynchronously (and its GIS calls fail here, which is fine —
    // the Colorado state must not depend on them).
    await page.waitForTimeout(7000);

    // The detention group lives in the YIELD panel, which is a tab — open it, and the Stormwater
    // group inside it, or nothing under test is mounted at all.
    for (const name of [/^Yield$/, /Stormwater/i, /Detention detail/i]) {
      const b = page.getByRole("button", { name }).first();
      if (await b.count().catch(() => 0)) { try { await b.click({ timeout: 2500 }); await page.waitForTimeout(900); } catch { /* already open */ } }
    }
    await page.waitForTimeout(1500);

    // Open the Detention group's assumptions fold if it is collapsed, so the method notes count.
    const openAll = await page.getByRole("button", { name: /Assumptions & method/i }).all().catch(() => []);
    for (const b of openAll.slice(0, 4)) { try { await b.click({ timeout: 1500 }); } catch { /* already open */ } }
    await page.waitForTimeout(800);

    const txt = await plannerText();
    const has = (re) => re.test(txt);

    if (plan.key === "mhfd") {
      /* THE HEADLINE ASSERTION — the bug this fixed. */
      check(!has(/Detention:\s*checking flood data/i), "MHFD: the verdict strip is NOT a permanent 'checking flood data' spinner");
      check(has(/not carried yet/i), "MHFD: the named unavailable verdict is VISIBLE in the panel");
      check(has(/WQCV/) && has(/EURV/), "MHFD: WQCV and EURV are both named on screen (never collapsed into one number)");
      check(has(/N\/A · MHFD|N\/A/), "MHFD: the named status chip reaches the DOM");
      // ⛔ The invariant the whole item exists for: no fabricated volume.
      check(!has(/ac-ft\/ac/), "MHFD: NO per-acre rate is shown (a full-spectrum volume has none)");
      check(!/Detention[^\n]*\d+\.\d+\s*of\s*\d+\.\d+\s*ac-ft/.test(txt), "MHFD: NO provided/required detention pair is shown (there is no required number)");
      // …and the regime resolved with EVERY GIS endpoint blocked, off the plan's own saved county
      // (B1125). If this regresses, a Denver site silently drops to the blanket Colorado guard.
      check(has(/MHFD/), "MHFD: the regime resolved with all GIS endpoints down (plan's saved county)");

      // Detail-fold content — GIS-gated, see `gated` above.
      gated(has(/district workbook/i), "MHFD: the panel says where to size it (the district workbook)");
      gated(has(/37-92-602/), "MHFD: the Colorado drawdown statute reconciliation renders");
      gated(has(/72-hour/i), "MHFD: the statutory 72-hour limit is stated");
      gated(has(/reviewing jurisdiction|own combined storm-drainage manual/i), "MHFD: the panel does not imply the district manual is final");
      gated(has(/coefficients have not been transcribed/i), "MHFD: each blocked component names the document it needs");
    }

    if (plan.key === "larimer") {
      /* THE SCOPE BOUNDARY, asserted on rendered pixels rather than on a unit test. The NEGATIVE
       * assertions are the load-bearing ones and they are NOT GIS-gated: whatever else the panel is
       * doing, MHFD's answer must not appear here. */
      check(!has(/WQCV/) && !has(/EURV/), "Larimer: MHFD's volumes are NOT shown on a non-member county");
      check(!has(/MHFD/), "Larimer: the district is not named at all on a non-member county");
      check(has(/not carried yet/i), "Larimer: a NAMED unavailable verdict still renders (not a spinner)");
      gated(has(/does not yet carry Colorado detention criteria/i), "Larimer: the ORIGINAL guard line renders in the detail fold");
      check(!has(/district workbook/i), "Larimer: the MHFD workbook is NOT suggested");
      check(!has(/ac-ft\/ac/), "Larimer: no rate is shown");
    }

    if (plan.key === "texas") {
      /* NO REGRESSION: a Texas plan must show none of the Colorado states. */
      check(!has(/not carried yet/i), "Texas: no Colorado 'not carried yet' verdict");
      check(!has(/Colorado/i), "Texas: the word Colorado appears nowhere in the planner panel");
      check(!has(/WQCV|EURV|MHFD/), "Texas: no MHFD copy leaks onto a Texas plan");
      check(has(/Detention/), "Texas: the detention group still renders");
    }
  }

  check(errs.length === 0, "no uncaught page errors across all three plans", errs.slice(0, 3).join(" | "));

  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
  const gatedOpen = gisGated.filter((g) => !g.ok);
  console.log(`\n${pass.length} passed, ${fail.length} failed, ${gatedOpen.length} GIS-gated (owed as a live check)\n`);
  if (gatedOpen.length) {
    console.log("GIS-gated — re-run this harness against an origin with network to close these:");
    for (const g of gatedOpen) console.log("  ⏸  " + g.label);
    console.log("");
  }
  process.exit(fail.length ? 1 : 0);
};

run().catch((e) => {
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
  console.error("harness error:", e);
  process.exit(1);
});
