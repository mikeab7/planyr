/* verify-tarrant-criteria — B2452176 / B2452177 / B2452178 (V1895680): a Tarrant County plan shows detention + easement criteria with
 * NO "Request criteria" dead-end; Fort Worth city / ETJ get the City's record; a Dallas County plan still gets the request link; a Harris
 * plan is unchanged.
 *
 *   node ui-audit/verify-tarrant-criteria.mjs [http://localhost:4173]                local preview, logged out, seeded plans
 *   E2E_LOGIN_KEY=… node ui-audit/verify-tarrant-criteria.mjs https://<deploy>       LIVE, signed in as the test account; the plans are
 *                                                                                    THROWAWAY rows it deletes (and verifies gone)
 *
 * The drainage identify is NOT run live here: each plan carries a remembered drainage check (settings.drainage.lastCheck) holding the raw
 * county / city / ETJ facts, which the app re-derives into a reviewer through the real authorityForJurisdiction (hydrateDrainageContext) —
 * the same path a reloaded real plan takes. So this proves the render + cascade wiring in the real app; it does NOT prove the county/city/ETJ
 * GIS lookups themselves (live-GIS) — those are covered by the DFW ETJ harnesses.
 * Known-good arm: the Harris plan must report a priced Detention row (an instrument that cannot see a number could not vouch for "no number").
 * FOREGROUND-OR-VOID asserted first. Live mode also reads /version.json in the same call. */
import { writeFileSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = (args.find((a) => /^https?:/.test(a)) || "http://localhost:4173").replace(/\/$/, "");
const live = !/localhost|127\.0\.0\.1/.test(base);
const OUT = new URL("./screenshots/tarrant-criteria/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const RUN = Math.random().toString(36).slice(2, 7);
const H = 660; // (2*660)^2 sqft ≈ 40 ac
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const mkSite = (key, { origin, county, jur }) => {
  const id = `zz-tarrant-${key}-${RUN}`;
  return {
    schemaVersion: 12, id, groupId: id, site: `zz Tarrant check ${key}`, name: "Plan 1", origin, county, status: "active",
    parcels: [{ id: "p1", points: PARCEL, active: true, z: 0 }],
    els: [{ id: "b1", type: "building", cx: 300, cy: 300, w: 400, h: 300, rot: 0 }],
    underlay: null, sheetOverlays: [], parcelDrawings: [], measures: [], markups: [], callouts: [], deletedIds: [],
    settings: {
      showSetback: false,
      drainage: {
        autoFacts: false, // no live GIS: the remembered check below is the only drainage fact
        lastCheck: {
          checkedAt: Date.now() - 5 * 60000,
          authority: { primaryReviewerId: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: jur },
          flood: { zones: [], panels: [], state: "loaded" },
        },
      },
    },
    updatedAt: Date.now(), data: { status: "active" },
  };
};
const CASES = [
  { key: "unincorp", label: "unincorporated Tarrant", site: mkSite("unincorp", { origin: { lat: 32.95, lon: -97.45 }, county: "tarrant", jur: { city: [], county: ["Tarrant"], etj: [] } }),
    det: /Tarrant County: no volume rate on file \(source unverified\)/, easeSel: "Tarrant County (unincorporated)", request: false },
  { key: "fwcity", label: "Fort Worth city limits", site: mkSite("fwcity", { origin: { lat: 32.7555, lon: -97.3308 }, county: "tarrant", jur: { city: ["Fort Worth"], county: ["Tarrant"], etj: [], cityCentroid: ["Fort Worth"] } }),
    det: /City of Fort Worth: no volume rate on file \(source unverified\)/, easeSel: "City of Fort Worth", request: false },
  { key: "fwetj", label: "Fort Worth ETJ", site: mkSite("fwetj", { origin: { lat: 32.98, lon: -97.5 }, county: "tarrant", jur: { city: [], county: ["Tarrant"], etj: ["Fort Worth"] } }),
    det: /City of Fort Worth: no volume rate on file \(source unverified\)/, easeSel: "City of Fort Worth", request: false },
  { key: "dallas", label: "CONTROL Dallas County (unmodeled)", site: mkSite("dallas", { origin: { lat: 32.78, lon: -96.8 }, county: "dallas", jur: { city: [], county: ["Dallas"], etj: [] } }),
    det: /no detention criteria on file for Dallas County/, easeSel: null, request: true },
  { key: "harris", label: "CONTROL Harris County (Houston area)", site: mkSite("harris", { origin: { lat: 29.7604, lon: -95.3698 }, county: "harris", jur: { city: [], county: ["Harris"], etj: [] } }),
    det: null, easeSel: "City of Houston", request: false, priced: true },
];

let page, close;
if (live) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  page = s.page; close = () => s.close();
  console.log("signed in as", s.proof.email);
} else {
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  page = await ctx.newPage();
  const all = Object.fromEntries(CASES.map((c) => [c.site.id, c.site]));
  await page.addInitScript((j) => { try { localStorage.setItem("planarfit:sites:v1", j); window.__PLANYR_E2E = true; } catch (_) {} }, JSON.stringify(all));
  await page.route(/\.(jpg|jpeg|png|webp)(\?|$)/, (r) => r.abort());
  close = () => browser.close();
}

const readDet = () => page.locator('[data-testid="yield-verdict-sentence-det"]').first().innerText({ timeout: 20000 }).catch(() => "");
try {
  await assertMeasurable(page, "verify-tarrant-criteria");
  if (live) {
    const v = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" })).json());
    console.log("served build:", v.build);
    for (const c of CASES) {
      const ins = await page.evaluate(async (site) => {
        const { data: u } = await window.pfSupabase.auth.getUser();
        const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
        let r = await window.pfSupabase.from("sites").insert(row);
        if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
        return r.error ? String(r.error.message) : null;
      }, c.site);
      check(`throwaway plan written (${c.label})`, !ins, ins || "");
    }
  }

  for (const c of CASES) {
    await page.goto(`${base}/#/project/${c.site.id}/site`, { waitUntil: "load" });
    if (live) await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(2200);
    await page.getByRole("button", { name: /^Drainage/ }).first().click().catch(() => {}); // the verdict strip lives in the Drainage panel
    await page.waitForTimeout(900);

    // ── Detention ──
    const det = ((await readDet()) || "").replace(/\s+/g, " ").trim();
    if (c.priced) {
      check(`${c.label}: Detention row is a PRICED verdict (known-good arm)`, det.length > 0 && !/no volume rate|no detention criteria|checking flood data/i.test(det), `"${det}"`);
    } else {
      check(`${c.label}: Detention row reads the expected named state`, c.det.test(det), `"${det}"`);
    }
    check(`${c.label}: Detention NEVER reads "checking flood data"`, !/checking flood data/i.test(det));
    const reqLink = await page.getByText(/Request criteria for/i).filter({ visible: true }).count();
    check(`${c.label}: detention "Request criteria" link ${c.request ? "present (control)" : "ABSENT — no dead-end"}`, c.request ? reqLink > 0 : reqLink === 0, `links=${reqLink}`);

    // ── Easement rules ──
    await page.getByRole("button", { name: "Easement options" }).click().catch(() => {});
    const toggle = page.getByTestId("easement-rules-toggle");
    await toggle.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    if (await toggle.count()) { const open = await page.getByTestId("easement-rules").count(); if (!open) await toggle.click(); }
    await page.getByTestId("easement-rules").waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const panel = (await page.getByTestId("easement-rules").innerText().catch(() => "")).replace(/\s+/g, " ");
    const selected = await page.getByTestId("easement-rules").locator("select").first().evaluate((s) => s.options[s.selectedIndex]?.textContent || "").catch(() => "");
    if (c.easeSel) check(`${c.label}: Easement jurisdiction resolves to "${c.easeSel}"`, selected.trim() === c.easeSel, `"${selected.trim()}"`);
    else check(`${c.label}: Easement shows NO criteria on file + a request (control)`, /No easement criteria on file/i.test(panel) && /Request criteria for this county/i.test(panel), panel.slice(0, 120));
    if (c.key === "unincorp" || c.key === "fwcity" || c.key === "fwetj") {
      check(`${c.label}: NO "Request criteria" in Easement rules`, !/Request criteria/i.test(panel));
      const wBox = await page.getByTestId("easement-rules").locator("input").first().inputValue().catch(() => "?");
      check(`${c.label}: water-easement box is EMPTY (no invented width)`, wBox === "", `value="${wBox}"`);
      check(`${c.label}: note names what is still unread`, /To confirm/i.test(panel), panel.slice(0, 160));
    }
    if (c.key === "harris") {
      const wBox = await page.getByTestId("easement-rules").locator("input").first().inputValue().catch(() => "?");
      check(`harris: easement width unchanged at 20 ft (control)`, wBox === "20", `value="${wBox}"`);
    }
    await page.screenshot({ path: `${OUT}${c.key}.png` });
    await page.keyboard.press("Escape");
  }
} finally {
  if (live) {
    for (const c of CASES) {
      const gone = await page.evaluate(async (id) => {
        try {
          for (const k of Object.keys(localStorage)) {
            if (!/^planarfit:sites:/.test(k)) continue;
            try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
          }
          if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
          const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
          return { cloud: !(q.data && q.data.length) };
        } catch (e) { return { error: String(e) }; }
      }, c.site.id).catch((e) => ({ error: String(e) }));
      check(`throwaway plan deleted and verified gone (${c.key})`, !!gone.cloud, JSON.stringify(gone));
    }
  }
  await close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
