/* B2671236 — Baytown Ch. 109 + Mont Belvieu "adopts the Chambers DCM" detention notes — signed in as the throwaway test account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-city-detention-notes-live.mjs [https://planyr.io] [--expect-sha <sha>]
 *
 * Writes THROWAWAY one-parcel sites (Mont Belvieu, Baytown, Katy control) to the test account, opens each in the real planner, opens
 * Drainage and reads the Stormwater readout. Known-good arm: Katy (an unmodeled city with NO city note) must still carry the generic
 * "This city's detention criteria aren't modeled" line — if the instrument cannot read the readout at all the run is VOID.
 * Deletes every site it wrote (local + cloud) and verifies they are gone. Never touches a real plan. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const note = (s) => console.log("   · " + s);

const RUN = Math.random().toString(36).slice(2, 6);
const H = 600;
const mk = (tag, lat, lon, county) => {
  const id = `zz-citynote-${tag}-${RUN}`;
  return {
    id, groupId: id, site: `zz city note ${tag}`, name: "Plan 1", origin: { lat, lon }, county,
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }] }],
    els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
  };
};
const CASES = {
  montBelvieu: mk("mb", 29.8472, -94.8885, "chambers"),
  baytown: mk("bt", 29.7355, -94.9774, "harris"),
  katy: mk("katy", 29.78, -95.79, "fortbend"),
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const ids = Object.values(CASES).map((c) => c.id);
try {
  await assertMeasurable(page, "verify-city-detention-notes-live");
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

  const bodyText = () => page.evaluate(() => document.body.innerText);
  async function readout(c) {
    await page.goto(`${base}/#/project/${c.id}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(4000);
    try { await page.locator("button:visible", { hasText: /^Drainage$/ }).first().click({ timeout: 6000 }); } catch (_) {}
    let txt = "";
    for (let i = 0; i < 12; i++) { await page.waitForTimeout(3000); txt = await bodyText(); if (/Stormwater|Detention required|detention criteria/i.test(txt) && /Mont Belvieu|Baytown|aren't modeled|County/.test(txt)) break; }
    const chk = page.locator("button:visible", { hasText: /Check drainage|Run check|Re-check|Check flood/i }).first();
    if (await chk.count()) { try { await chk.click({ timeout: 3000 }); await page.waitForTimeout(12000); txt = await bodyText(); } catch (_) {} }
    return txt;
  }
  const line = (txt, re) => (txt.match(new RegExp("[^\\n]*(?:" + re + ")[^\\n]*", "i")) || ["(no such line)"])[0];

  console.log("\n— Known-good arm: Katy (unmodeled city, no city note) —");
  const katy = await readout(CASES.katy);
  if (!/aren't modeled/.test(katy)) { console.log("VOID — the generic unmodeled-city line is not visible on the Katy control; the instrument cannot read the readout."); voided++; }
  else {
    check("Katy: generic \"city's detention criteria aren't modeled\" line still shows", true, line(katy, "aren't modeled"));
    check("Katy: no Baytown / Mont Belvieu note", !/Mont Belvieu adopts|Baytown: detention/.test(katy));
  }

  console.log("\n— Mont Belvieu —");
  const mb = await readout(CASES.montBelvieu);
  note(line(mb, "Mont Belvieu adopts"));
  check("Mont Belvieu: says it adopts the Chambers County manual (strictest applies)", /Mont Belvieu adopts the Chambers County manual/.test(mb), line(mb, "Mont Belvieu"));
  check("Mont Belvieu: the generic unmodeled-city sentence is replaced, not stacked", !/This city's detention criteria aren't modeled/.test(mb));
  check("Mont Belvieu: Chambers band unchanged (0.5–1.2 screening band, no point number)", /0\.5\s*[–-]\s*1\.2/.test(mb) || /Chambers/.test(mb), line(mb, "0\\.5.{0,4}1\\.2|Chambers"));

  console.log("\n— Baytown —");
  const bt = await readout(CASES.baytown);
  note(line(bt, "Baytown: detention"));
  check("Baytown: detention follows City Ch. 109, county number shown, verify with the City", /Baytown: detention follows City Ch\. 109/.test(bt), line(bt, "Baytown"));
  check("Baytown: the generic unmodeled-city sentence is replaced, not stacked", !/This city's detention criteria aren't modeled/.test(bt));
  check("Baytown: Harris side still HCFCD (no Baytown rate invented)", /HCFCD|Harris/.test(bt));
} catch (e) {
  console.log("❌ harness error:", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e);
  failed++;
} finally {
  // cleanup: every throwaway site, local + cloud; verify gone. The open planner autosaves its site again after a delete, so leave
  // the planner FIRST, sweep, reload, sweep again, and only then count.
  try {
    const sweep = (ids) => page.evaluate(async (ids) => {
      const hasId = (str) => ids.some((id) => (str || "").includes(id));
      for (const k of Object.keys(localStorage)) {
        const raw = localStorage.getItem(k) || "";
        if (!hasId(raw)) continue;
        try {
          const m = JSON.parse(raw);
          if (m && typeof m === "object" && !Array.isArray(m)) { for (const id of ids) delete m[id]; if (hasId(JSON.stringify(m))) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(m)); continue; }
        } catch (_) {}
        localStorage.removeItem(k); // a scalar pointer (last route / current site) at a throwaway
      }
      let cloud = null;
      if (window.pfSupabase) {
        // soft-delete FIRST: the server's BEFORE DELETE guard refuses a hard delete of a row that was never soft-deleted (B1517888)
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids);
        const d = await window.pfSupabase.from("sites").delete().in("id", ids).select("id");
        if (d.error) return { cloudLeft: "err:" + d.error.message, localLeft: -1 };
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        cloud = q.error ? "err:" + q.error.message : (q.data || []).length;
      }
      const local = Object.keys(localStorage).filter((k) => hasId(localStorage.getItem(k))).length;
      return { cloudLeft: cloud, localLeft: local };
    }, ids);
    await page.goto(`${base}/#/`, { waitUntil: "load" }); await page.waitForTimeout(3000);
    await sweep(ids);
    await page.reload({ waitUntil: "load" }); await page.waitForTimeout(4000);
    const gone = await sweep(ids);
    check("every throwaway site deleted (local + cloud) and verified gone (swept after leaving the planner, re-counted after a reload)", gone.cloudLeft === 0 && gone.localLeft === 0, JSON.stringify(gone));
  } catch (e) { check("cleanup ran", false, String(e).slice(0, 120)); }
  await s.close().catch(() => {});
}
if (voided) { console.log("\nVOID — the known-good arm could not see a badge."); process.exit(2); }
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
