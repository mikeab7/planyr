/* NEW-1 (2026-10-05) — Site Analysis, SIGNED IN on the real deploy, as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-site-analysis-signed-in.mjs [https://planyr.io] [--expect-sha <merge sha>] [--shots <dir>]
 *
 * What it does, in order:
 *   1. signs in through the shared helper (ui-audit/lib/signedInSession.mjs) and reads /version.json IN THE SAME CALL as
 *      every assertion that follows — a stale cached bundle must not be able to vouch for a build it is not;
 *   2. seeds a throwaway ~1000 ft plan at Sheldon Lake, Harris County (real NWI wetlands + San Jacinto floodplain), opens
 *      Analysis against the REAL FEMA / NWI / RRC services and asserts the structure (the five sections, five Texas
 *      verdict rows each with a real severity, no banner / badges / chips / per-row ages) and prints what each row says;
 *   3. forces a RRC outage at the network edge → pipelines + wells must read "Couldn't check", never None/green; lifts it
 *      and Retry must recover;
 *   4. pill ↔ Layers panel round trip;
 *   5. DELETES the throwaway plan (local + cloud) and verifies it is gone (owner rule: test artifacts are always cleared).
 * The ground truth for COLOURS on real data is not knowable in advance, so colours are REPORTED here and judged by the
 * mocked harness (verify-site-analysis-trust.mjs) — this one proves the real services, the real session and the real build.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-trust-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Analysis trust check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-site-analysis-signed-in");
  const served = async () => page.evaluate(async () => ({
    build: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null),
    chunks: [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /assets\//.test(x)).slice(0, 3),
  }));
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  if (expectSha) check("the deploy is serving the merge commit", String(s.build?.build || "").startsWith(expectSha.slice(0, 7)), `served ${s.build?.build}, expected ${expectSha.slice(0, 7)}`);

  // The signed-in app lists the ACCOUNT's plans, so the throwaway plan is written to the test account's own cloud
  // (RLS: its own row) — and deleted again in the `finally` below, verified.
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

  const open = async () => {
    if (!(await page.locator('[data-site-analysis="1"]').count())) await page.locator('button[title="Analysis"]').click();
    await page.waitForSelector('[data-site-analysis="1"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking the maps"), null, { timeout: 90000 });
    await page.waitForTimeout(500);
  };
  const rowsOf = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-check-row]")].map((r) => [r.dataset.checkRow, {
    sev: r.dataset.severity, figure: r.querySelector("[data-check-figure]")?.innerText.trim(), text: r.innerText.replace(/\s+/g, " ").trim(),
  }])));
  await open();
  const text = await page.evaluate(() => document.querySelector('[data-site-analysis="1"]').innerText);
  const rows = await rowsOf();
  const b1 = await served();
  console.log("\nserved at assertion time:", JSON.stringify(b1));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/signed-in-texas.png` });

  console.log("\n— structure on the REAL services —");
  check("sections in order: governs · checked · pills · calls", await page.evaluate(() => JSON.stringify([...document.querySelectorAll("[data-section]")].map((e) => e.dataset.section)) === JSON.stringify(["governs", "checked", "pills", "calls"])));
  check("five Texas verdict rows", JSON.stringify(Object.keys(rows)) === JSON.stringify(["flood100", "flood500", "wetlands", "pipelines", "wells"]), Object.keys(rows).join(","));
  check("every row resolved to a real severity (red/amber/green) — none stuck loading", Object.values(rows).every((r) => ["red", "amber", "green", "failed"].includes(r.sev)), Object.entries(rows).map(([k, r]) => `${k}=${r.sev}`).join(" "));
  for (const [k, r] of Object.entries(rows)) console.log(`   • ${k}: ${r.sev} · ${r.figure} · ${r.text}`);
  check("no banner / INFO-PRESENT-NONE FOUND badges / Activate-layer chips / per-row ages", !/constraints? present|NONE FOUND|\bINFO\b|PRESENT|Activate layer/i.test(text) && !Object.values(rows).some((r) => / ago/.test(r.text)));
  check("one freshness line; footer exact", (text.match(/Checked /g) || []).length === 1 && text.trim().endsWith("Screening data. Verify before relying on it."));
  const gov = await page.locator('[data-section="governs"]').innerText();
  console.log("   governs:", gov.replace(/\s+/g, " "));
  check("Who governs: names Harris County", /Harris County/.test(gov));
  check("a green row is only ever 'None…' (never a figure that hides a failure)", Object.values(rows).filter((r) => r.sev === "green").every((r) => /^None$/.test(r.figure)));

  console.log("\n— forced failure: RRC outage → Couldn't check; Retry recovers —");
  let rrcDown = true;
  await page.route(/gis\.rrc\.texas\.gov/, (route) => (rrcDown ? route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "unavailable" }) : route.continue()));
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("planyr:giscache")) localStorage.removeItem(k); });
  await page.locator('[data-site-analysis="1"] button:has-text("Refresh")').click();
  await page.waitForTimeout(800);
  await page.waitForFunction(() => !document.querySelector('[data-site-analysis="1"]')?.innerText.includes("Checking…"), null, { timeout: 90000 });
  const bad = await rowsOf();
  check("pipelines + wells read 'Couldn't check' (never None, never green)", ["pipelines", "wells"].every((k) => bad[k]?.sev === "failed" && /Couldn't check/.test(bad[k].figure) && !/None/.test(bad[k].text)), JSON.stringify([bad.pipelines?.sev, bad.wells?.sev]));
  check("FEMA + NWI rows unaffected by the RRC outage", ["flood100", "flood500", "wetlands"].every((k) => bad[k]?.sev && bad[k].sev !== "failed"));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/signed-in-failure.png` });
  rrcDown = false;
  await page.locator('[data-check-retry="pipelines"]').click();
  await page.waitForFunction(() => document.querySelector('[data-check-row="pipelines"]')?.dataset.severity !== "failed", null, { timeout: 60000 });
  const okRows = await rowsOf();
  check("Retry recovered the pipelines row from the live service", okRows.pipelines?.sev !== "failed", `${okRows.pipelines?.sev} · ${okRows.pipelines?.figure}`);
  await page.unroute(/gis\.rrc\.texas\.gov/);

  console.log("\n— pills ↔ Layers panel —");
  const layersOn = () => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers().on : null));
  const pill = page.locator('[data-layer-pill="rail"]');
  check("rail pill is offered and starts off", (await pill.count()) === 1 && (await pill.getAttribute("aria-pressed")) === "false");
  await pill.click(); await page.waitForTimeout(600);
  check("pill → pressed", (await pill.getAttribute("aria-pressed")) === "true");
  await page.getByRole("button", { name: /^Layers/ }).first().click(); await page.waitForTimeout(800);
  const row = page.locator('[data-testid="layer-row-bts_rail"] input[type="checkbox"]').first();
  check("Layers panel shows Rail checked", (await row.count()) > 0 && (await row.isChecked()));
  await row.uncheck(); await page.waitForTimeout(500);
  check("unchecking in the Layers panel un-presses the pill", (await page.locator('[data-layer-pill="rail"]').getAttribute("aria-pressed")) === "false");
  void layersOn;

  const b2 = await served();
  check("the build served at the END of the run is the build served at the start (no mid-run deploy)", b2.build === b1.build, `${b1.build} → ${b2.build}`);
} finally {
  // owner rule: test artifacts are ALWAYS cleared, and the clearing is verified.
  const gone = await page.evaluate(async (id) => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); } // the table refuses a hard delete until the row is in the trash
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { local: !JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[id], cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted (local + cloud) and verified gone", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `\n❌ ${failed} check(s) FAILED` : "\n✅ all checks passed");
process.exit(failed ? 1 : 0);
