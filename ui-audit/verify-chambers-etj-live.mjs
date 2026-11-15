#!/usr/bin/env node
/* verify-chambers-etj-live — B2671239. Chambers County's city ETJs are visible: the site header names Mont Belvieu / Beach City / Cove / Old River-Winfree ETJ (and still Baytown's), a site inside Mont
 * Belvieu's LIMITS never prints its own ETJ beside the city, and an unincorporated site stays unincorporated. LIVE, on THROWAWAY plans it deletes (and verifies gone).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-chambers-etj-live.mjs https://planyr.io [--expect-sha <merge-sha>]     signed in as the test account (cloud plans, deleted at the end)
 *   node ui-audit/verify-chambers-etj-live.mjs https://<branch>.planyr.pages.dev --local                         a SIGNED-OUT run for a PR preview (no key there): plans are seeded into the
 *                                                                                                                 browser's own store, nothing touches the cloud
 *
 * Each case opens a located plan, waits for the header pill to SETTLE, and reads the rendered pill text (`data-jurisdiction-full`) off the DOM. Ground truth for every point was measured on the
 * City of Mont Belvieu's own server 2026-11-12 (each ETJ point lies inside its polygon with a margin on all four sides; the Targa plant lies inside BOTH the limits and the published ETJ polygon).
 * /version.json is read IN THE SAME CALL as the assertions. Includes a known-good CONTROL (downtown Houston, unchanged by this item). */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const LOCAL = args.includes("--local");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const squareAt = (lon, lat, half = 150) => ({ lat, lon, pts: [[-half, -half], [half, -half], [half, half], [-half, half]] });
const CASES = [
  { key: "targa", why: "the Targa plant — inside Mont Belvieu's limits AND its published ETJ polygon: the city governs, no ETJ beside it", plan: squareAt(-94.9019, 29.8405), want: "City of Mont Belvieu · Chambers County", no: /ETJ/ },
  { key: "mb-etj", why: "(−94.86, 29.89) — Mont Belvieu's ETJ, the site the sweep reported as 'Unincorporated'", plan: squareAt(-94.86, 29.89), want: "City of Mont Belvieu ETJ · Chambers County" },
  { key: "mb-etj-west", why: "Mont Belvieu's ETJ, far west edge", plan: squareAt(-94.96078, 29.89792), want: "City of Mont Belvieu ETJ · Chambers County" },
  { key: "beach-city", why: "Beach City's ETJ (Mont Belvieu's copy of the neighbours' lines)", plan: squareAt(-94.90825, 29.66029), want: "City of Beach City ETJ · Chambers County" },
  { key: "cove", why: "Cove's ETJ", plan: squareAt(-94.82899, 29.80138), want: "City of Cove ETJ · Chambers County" },
  { key: "old-river", why: "Old River-Winfree's ETJ, named by its legal name", plan: squareAt(-94.83045, 29.89004), want: "City of Old River-Winfree ETJ · Chambers County" },
  { key: "baytown-ameriport", why: "Ameriport — Baytown's ETJ, from Baytown's own publisher, unchanged", plan: squareAt(-94.867, 29.793), want: "City of Baytown ETJ · Chambers County" },
  { key: "nrg-cove", why: "NRG Cove — in no city and no ETJ: unincorporated", plan: squareAt(-94.829, 29.764), want: "Unincorporated · Chambers County" },
  { key: "houston", why: "CONTROL — downtown Houston, untouched by this item", plan: squareAt(-95.3698, 29.7604), want: "City of Houston · Harris County" },
];
const TAG = Math.random().toString(36).slice(2, 7);
const mkSite = (c) => {
  const id = `zz-chambers-etj-${c.key}-${TAG}`;
  return {
    schemaVersion: 12, id, groupId: id, site: "zz Chambers ETJ check " + c.key, name: "Plan 1", origin: { lat: c.plan.lat, lon: c.plan.lon }, county: null, status: "active",
    parcels: [{ id: "p1", points: c.plan.pts.map(([x, y]) => ({ x, y })), active: true, z: 0 }],
    underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [], measures: [], markups: [], callouts: [],
    updatedAt: Date.now(), data: { status: "active" },
  };
};
const sites = CASES.map(mkSite);

let s = null, browser = null, page;
if (LOCAL) {
  const { chromium } = await import("@playwright/test");
  browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  page = await ctx.newPage();
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(Object.fromEntries(sites.map((st) => [st.id, st]))));
  s = { proof: { email: "(signed out — local plans)" }, close: () => browser.close() };
} else {
  s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page;
}
console.log("signed in as", s.proof.email);
const made = [];
try {
  if (LOCAL) await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-chambers-etj-live");
  const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
  console.log("served build:", v.build);
  if (expectSha) check("served build matches the merge commit", String(v.build).startsWith(expectSha.slice(0, 7)), `${v.build} vs ${expectSha}`);

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i], site = sites[i];
    if (!LOCAL) {
      const ins = await page.evaluate(async (st) => {
        const { data: u } = await window.pfSupabase.auth.getUser();
        const row = { id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date().toISOString(), data: st, user_id: u.user.id };
        let r = await window.pfSupabase.from("sites").insert(row);
        if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
        return r.error ? String(r.error.message) : null;
      }, site);
      if (ins) { check(`${c.key}: throwaway plan written`, false, ins); continue; }
      made.push(site.id);
    }
    await page.goto(`${base}/#/project/${site.id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" }); // a hash-only change leaves the previous workspace active
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
    const pill = page.getByTestId("jurisdiction-badge").first();
    await pill.waitFor({ state: "attached", timeout: 60000 });
    let text = "", stable = 0;
    for (let n = 0; n < 90 && stable < 4; n++) {
      const t = (await pill.getAttribute("data-jurisdiction-full")) || "";
      stable = t && t === text && !/^Couldn't check jurisdiction/.test(t) ? stable + 1 : 0;
      text = t;
      await page.waitForTimeout(500);
    }
    const ok = text === c.want;
    check(`${c.key}: ${c.why}`, ok, `"${text}"${ok ? "" : ` (expected "${c.want}")`}`);
    if (c.no) check(`${c.key}: no ETJ slot beside the city`, !c.no.test(text), text);
  }
} finally {
  // Cleanup is unconditional (constraint #15) and VERIFIED: every throwaway row must be gone afterwards.
  if (LOCAL) check("(local run) nothing was written to the cloud — plans lived only in this browser", true, "");
  else {
    const gone = await page.evaluate(async (ids) => {
      for (const k of Object.keys(localStorage)) {
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); let ch = false; for (const id of ids) if (m && m[id]) { delete m[id]; ch = true; } if (ch) localStorage.setItem(k, JSON.stringify(m)); } catch (_) { /* not a plan store */ }
      }
      let left = 0;
      for (const id of ids) {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
        left += (q.data || []).length;
      }
      return { left };
    }, made).catch((e) => ({ left: -1, err: String(e) }));
    check("every throwaway plan deleted and verified gone from the cloud", gone.left === 0, JSON.stringify(gone));
  }
  await s.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
