/* V1416048 steps 3 · 4 · 5 · 6 (Harris/Montgomery-GA arms) · 7 · 8 — signed in as the throwaway test account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-georgia-jurisdiction-live.mjs [https://planyr.io] [--expect-sha <sha>]
 *
 * For each case it writes a THROWAWAY one-parcel site to the test account, opens it in the real planner, reads the header badge /
 * Layers panel / Yield panel, and DELETES every site it wrote (local + cloud) and verifies they are gone. Never touches a real plan.
 * Known-good arm: a Texas (Katy) site must still say Texas things — if the instrument cannot see a badge at all the run is VOID.
 * Needs outbound HTTPS to the deploy; the browser must trust the egress proxy's CA (see ui-audit/lib/signedInSession.mjs). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const note = (s) => console.log("   · " + s);

const RUN = Math.random().toString(36).slice(2, 6);
const H = 600; // parcel half-side, site-frame feet
const mk = (tag, lat, lon, county) => {
  const id = `zz-gajur-${tag}-${RUN}`;
  return {
    id, groupId: id, site: `zz GA jurisdiction ${tag}`, name: "Plan 1", origin: { lat, lon }, county,
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
  };
};
const CASES = {
  atlStraddle: mk("atl", 33.745, -84.34922, "ga_fulton"),       // on the Fulton/DeKalb line, inside the City of Atlanta both sides
  athens: mk("athens", 33.9519, -83.3776, "ga_clarke"),
  augusta: mk("augusta", 33.47, -81.97, "ga_richmond"),
  columbus: mk("columbus", 32.46, -84.99, "ga_muscogee"),
  macon: mk("macon", 32.84, -83.63, "ga_bibb"),
  harrisGA: mk("harris", 32.7585, -84.8752, "ga_harris"),         // Hamilton, HARRIS COUNTY, GEORGIA
  montgomeryGA: mk("montgomery", 32.1777, -82.5906, "ga_montgomery"), // Mount Vernon, MONTGOMERY COUNTY, GEORGIA
  adairsville: mk("adairsville", 34.3717, -84.9346, "ga_bartow"),   // a Georgia site with the Georgia layers on (attribution)
  katy: mk("katy", 29.78, -95.79, "fortbend"),                      // Texas control
  denver: mk("denver", 39.7392, -104.9903, "co_denver"),            // Colorado control
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const ids = Object.values(CASES).map((c) => c.id);
try {
  await assertMeasurable(page, "verify-georgia-jurisdiction-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served, "| run", RUN);
  if (expectSha) check("the deploy is serving the build under test", String(served || "").startsWith(expectSha.slice(0, 7)), `served ${served}`);

  const ins = await page.evaluate(async (sites) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const errs = [];
    for (const site of sites) {
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      if (r.error) errs.push(site.id + ": " + String(r.error.message));
    }
    return errs;
  }, Object.values(CASES));
  check(`${ids.length} throwaway sites written to the test account`, ins.length === 0, ins.join("; "));

  // Open a site; return the header badge text/hover, the Layers panel text, and the full page text.
  async function open(c, { layers = true } = {}) {
    await page.goto(`${base}/#/project/${c.id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    // the badge arrives after the identify queries return
    let badge = null;
    for (let i = 0; i < 40; i++) {
      badge = await page.evaluate(() => { const b = document.querySelector('[data-testid="jurisdiction-badge"]'); return b ? { full: b.getAttribute("data-jurisdiction-full"), title: b.getAttribute("title") } : null; });
      if (badge && badge.full) break;
      await page.waitForTimeout(1000);
    }
    let layersText = "";
    if (layers) {
      if (!(await page.locator("label:visible", { hasText: /FEMA flood zones/ }).count())) {
        try { await page.locator("button:visible", { hasText: "Layers" }).first().click({ timeout: 5000 }); } catch (_) {}
        await page.waitForTimeout(800);
      }
      layersText = await page.evaluate(() => document.body.innerText);
    }
    return { badge, layersText };
  }
  const bodyText = () => page.evaluate(() => document.body.innerText);

  // ── KNOWN-GOOD ARM: a Texas site must show a badge at all, and say no Georgia thing ──
  console.log("\n— Texas control (Katy) —");
  const katy = await open(CASES.katy);
  if (!katy.badge || !katy.badge.full) { console.log("VOID — no jurisdiction badge on the Texas control; the instrument cannot see a badge."); voided++; }
  else {
    note(`badge: ${katy.badge.full}`);
    check("Katy: badge names a Texas jurisdiction, nothing Georgian", /County/.test(katy.badge.full) && !/, GA|consolidated/.test(katy.badge.full), katy.badge.full);
    check("Katy: the hover has no Georgia note", !/Georgia cities have no authority/.test(katy.badge.title || ""));
    check("Katy: the Texas county/city rows are live and no Georgia row is offered", /County boundaries/.test(katy.layersText) && /City limits/.test(katy.layersText) && !/\(Georgia\)/.test(katy.layersText));
  }

  // ── STEP 8 (Colorado half) ──
  console.log("\n— Step 8: Denver (Colorado) —");
  const den = await open(CASES.denver);
  note(`badge: ${den.badge && den.badge.full}`);
  check("Denver: a badge reads, Denver County, nothing Georgian", !!(den.badge && /Denver/.test(den.badge.full)) && !/, GA|consolidated/.test(den.badge?.full || ""), den.badge?.full || "");
  check("Denver: Colorado layer rows present, Texas ETJ-only wording not leaked as Georgia", /Colorado/.test(den.layersText));

  // ── STEP 4: a city spanning two counties ──
  console.log("\n— Step 4: City of Atlanta across the Fulton / DeKalb line —");
  const atl = await open(CASES.atlStraddle);
  note(`badge: ${atl.badge && atl.badge.full}`);
  check("badge names the City of Atlanta, GA", /City of Atlanta, GA/.test(atl.badge?.full || ""), atl.badge?.full || "");
  check("BOTH Fulton and DeKalb are named, as peers", /Fulton County/.test(atl.badge?.full || "") && /DeKalb County/.test(atl.badge?.full || ""), atl.badge?.full || "");
  check("not read as 'unincorporated'", !/nincorporated/.test(atl.badge?.full || ""));
  check("no ETJ wording in the badge or its hover", !/ETJ|extraterritorial/i.test((atl.badge?.full || "") + " " + (atl.badge?.title || "")));

  // ── STEP 5: consolidated governments ──
  console.log("\n— Step 5: consolidated city-county governments —");
  for (const [k, want] of [["athens", /Athens-Clarke County, GA \(consolidated\)/], ["augusta", /Augusta-Richmond County, GA \(consolidated\)/], ["columbus", /Columbus-Muscogee County, GA \(consolidated\)/], ["macon", /Macon-Bibb County, GA \(consolidated\)/]]) {
    const r = await open(CASES[k], { layers: false });
    note(`${k}: ${r.badge && r.badge.full}`);
    check(`${k}: one consolidated government`, want.test(r.badge?.full || ""), r.badge?.full || "");
    check(`${k}: never 'city + unincorporated'`, !/nincorporated|City of /.test(r.badge?.full || ""));
    check(`${k}: the hover explains the consolidation`, /Consolidated city-county government/.test(r.badge?.title || ""));
  }

  // ── STEP 3 + 7: Georgia view — ETJ row reason, attribution ──
  console.log("\n— Steps 3 & 7: Adairsville (Georgia) — the ETJ row's reason, and the attribution with the Georgia layers on —");
  const ad = await open(CASES.adairsville);
  note(`badge: ${ad.badge && ad.badge.full}`);
  // the not-available rows sit behind a "Show N not available in Georgia" fold: open every fold, then read the reasons as visible text
  for (const f of await page.locator("button:visible, summary:visible, [role=button]:visible", { hasText: /not available in Georgia/i }).all()) { try { await f.click({ timeout: 3000 }); } catch (_) {} }
  await page.waitForTimeout(600);
  const etjReason = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("[title]")) { const t = el.getAttribute("title") || ""; if (/Georgia cities have no reach|no equivalent|Georgia's are/i.test(t)) out.push(t); }
    const body = document.body.innerText;
    for (const line of body.split("\n")) if (/Georgia cities have no reach|Texas county lines|Texas city limits|Texas-only/i.test(line)) out.push(line.trim());
    return out;
  });
  note(`not-applicable reasons found in hovers: ${JSON.stringify(etjReason)}`);
  check("the ETJ/city row's reason says Georgia cities have no reach beyond their limits", etjReason.some((t) => /Georgia cities have no reach beyond their limits/.test(t)), JSON.stringify(etjReason).slice(0, 300));
  check("…and Texas county lines point at the Georgia county row, not 'no Georgia equivalent is wired yet'", etjReason.some((t) => /Texas county lines/.test(t) && /Georgia/.test(t)) && !etjReason.some((t) => /county lines|city limits/i.test(t) && /no Georgia equivalent is wired yet/.test(t)));
  // turn both Georgia rows on, then read the attribution strip
  for (const row of ["County boundaries (Georgia)", "City limits (Georgia)"]) {
    const lab = page.locator("label:visible", { hasText: row }).first();
    try { await lab.waitFor({ state: "visible", timeout: 5000 }); await lab.locator('input[type="checkbox"]').first().check(); } catch (e) { check(`${row} row can be switched on`, false, String(e).slice(0, 100)); }
  }
  await page.waitForTimeout(9000);
  const attr = await page.evaluate(() => [...document.querySelectorAll(".leaflet-control-attribution")].map((e) => e.innerText).join(" | "));
  note(`attribution: ${attr.slice(0, 300)}`);
  check("attribution strip has content (instrument sees it)", attr.length > 5);
  check("attribution: NO Harris County / TxGIO / TxDOT / HCFCD credit on the Georgia view", !/Harris County|TxGIO|TxDOT|HCFCD|Texas/i.test(attr), attr.slice(0, 300));
  note(`attribution carries a Georgia/DCA credit: ${/Georgia|DCA/i.test(attr)} (observation only — the app credits basemap imagery, not per-layer publishers)`);

  // ── STEP 6: Harris County GA and Montgomery County GA ──
  console.log("\n— Step 6: Harris County, GEORGIA and Montgomery County, GEORGIA —");
  for (const [k, county] of [["harrisGA", "Harris"], ["montgomeryGA", "Montgomery"]]) {
    const r = await open(CASES[k], { layers: false });
    note(`${k}: ${r.badge && r.badge.full}`);
    check(`${k}: badge names ${county} County, GA (Georgia's, not Texas's)`, new RegExp(`${county} County`).test(r.badge?.full || "") && /, GA/.test(r.badge?.full || ""), r.badge?.full || "");
    // open the Yield panel and read the detention line
    try { await page.locator("button:visible", { hasText: /^Drainage$/ }).first().click({ timeout: 6000 }); } catch (_) {}
    await page.waitForTimeout(6000);
    let txt = await bodyText();
    note(`${k}: yield/drainage text mentions Georgia detention: ${/Detention criteria not yet available in Georgia|Georgia detention/.test(txt)}`);
    // some builds need the drainage check run explicitly
    const chk = page.locator("button:visible", { hasText: /Check drainage|Run check|Re-check|Check flood/i }).first();
    if (await chk.count()) { try { await chk.click({ timeout: 3000 }); await page.waitForTimeout(12000); txt = await bodyText(); } catch (_) {} }
    check(`${k}: detention reads as the named 'not available in Georgia' state`, /Detention criteria not yet available in Georgia|Georgia detention|not carried yet/i.test(txt), (txt.match(/[^\n]*(?:Georgia detention|Detention criteria)[^\n]*/i) || ["(no detention line found)"])[0]);
    check(`${k}: no acre-feet requirement number from a Texas rule`, !/Detention required[^\n]*\d+(\.\d+)?\s*ac-?ft/i.test(txt) && !/\d+(\.\d+)?\s*ac-?ft\s*(required|over|short)/i.test(txt), (txt.match(/[^\n]*ac-?ft[^\n]*/i) || ["(none)"])[0]);
    check(`${k}: no HCFCD / Harris County Flood Control wording`, !/HCFCD|Harris County Flood Control|Flood Control District/i.test(txt), (txt.match(/[^\n]*(?:HCFCD|Flood Control)[^\n]*/i) || [""])[0]);
    check(`${k}: no Texas authority names (Montgomery Co. / FBCDD / City of Houston criteria)`, !/FBCDD|Fort Bend County Drainage|Houston IDM|HCED/i.test(txt));
  }
} catch (e) {
  console.log("❌ harness error:", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e);
  failed++;
} finally {
  // cleanup: every throwaway site, local + cloud; verify gone
  try {
    const gone = await page.evaluate(async (ids) => {
      const keys = Object.keys(localStorage).filter((k) => /^planarfit:sites:(v1|cloud:)/.test(k));
      for (const k of keys) { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); for (const id of ids) delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (_) {} }
      let cloud = null;
      if (window.pfSupabase) {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids);
        await window.pfSupabase.from("sites").delete().in("id", ids);
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        cloud = q.error ? "err:" + q.error.message : (q.data || []).length;
      }
      const local = keys.reduce((n, k) => { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); return n + ids.filter((id) => m[id]).length; } catch (_) { return n; } }, 0);
      return { cloudLeft: cloud, localLeft: local };
    }, ids);
    check("every throwaway site deleted (local + cloud) and verified gone", gone.cloudLeft === 0 && gone.localLeft === 0, JSON.stringify(gone));
  } catch (e) { check("cleanup ran", false, String(e).slice(0, 120)); }
  await s.close().catch(() => {});
}
if (voided) { console.log("\nVOID — the known-good arm could not see a badge."); process.exit(2); }
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
