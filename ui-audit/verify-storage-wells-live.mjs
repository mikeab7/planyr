/* NEW-1 (2026-11-12) — salt-dome STORAGE wells in Site Analysis, SIGNED IN on the real deploy, at the Targa / Mont Belvieu fixture.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-storage-wells-live.mjs [https://planyr.io] [--expect-sha <merge sha>]
 *
 * Seeds a throwaway ~1000 ft plan at Targa Mont Belvieu (-94.9019, 29.8405) on the test account, opens Analysis against the
 * REAL Railroad Commission well service and asserts the wells row COUNTS the cavern wells ("storage (cavern)") instead of
 * leaving them as "other", and that its caveat names salt-dome storage. The known-good arm: the same page must still show the
 * ordinary well categories (the screen is alive and reading the RRC) — a run that reads no wells at all is VOID, not a pass.
 * The throwaway plan is DELETED at the end and the deletion verified (owner rule: test artifacts are always cleared).
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-storagewells-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Storage wells check", name: "Plan 1", origin: { lat: 29.8405, lon: -94.9019 }, county: "chambers",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-storage-wells-live");
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  if (expectSha) check("the deploy is serving the merge commit", String(s.build?.build || "").startsWith(expectSha.slice(0, 7)), `served ${s.build?.build}, expected ${expectSha.slice(0, 7)}`);

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
  await page.waitForTimeout(5000);

  if (!(await page.locator('[data-site-analysis="1"]').count())) await page.locator('button[title="Analysis"]').click();
  await page.waitForSelector('[data-site-analysis="1"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking the maps"), null, { timeout: 90000 });
  await page.waitForTimeout(500);

  // The served chunk hash is read in the SAME observation as the assertion (CLAUDE.md live-measurement rule).
  const obs = await page.evaluate(() => {
    const row = document.querySelector('[data-check-row="wells"]');
    return {
      chunks: [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3),
      text: row ? row.innerText.replace(/\s+/g, " ").trim() : null, severity: row ? row.dataset.severity : null,
    };
  });
  console.log("chunks at assertion time:", JSON.stringify(obs.chunks));
  console.log("wells row:", obs.severity, "|", obs.text);

  check("the wells row rendered with a verdict (known-good arm: the RRC screen is alive)", !!obs.text && ["red", "amber"].includes(obs.severity), `severity ${obs.severity}`);
  // Open the row's detail so its caveat is in the DOM, then read it.
  await page.locator('[data-check-row="wells"]').click().catch(() => {});
  await page.waitForTimeout(500);
  const detail = await page.evaluate(() => (document.querySelector('[data-site-analysis="1"]')?.innerText || "").replace(/\s+/g, " "));
  check("the row COUNTS the cavern wells as 'storage (cavern)'", /storage \(cavern\)/.test(obs.text || "") || /storage \(cavern\)/.test(detail));
  check("no cavern well is left as 'other'", !/\bother\b/.test(obs.text || ""), obs.text || "");
  check("the caveat names salt-dome storage (Mont Belvieu, Stratton Ridge, Markham)", /Mont Belvieu, Stratton Ridge, Markham/.test(detail), "caveat text must be in the opened row");
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      const all = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { local: !JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}")[id], cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted (local + cloud) and verified gone", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `\n❌ ${failed} check(s) FAILED` : "\n✅ all checks passed");
process.exit(failed ? 1 : 0);
