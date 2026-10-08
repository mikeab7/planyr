/* B2156144 / V1571392 — signed-in live check on the deployed app, THROWAWAY plan only:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-easement-map-label.mjs [https://planyr.io] [<expected commit prefix>]
 * Seeds a throwaway plan with one easement, opens its Properties, and asserts on the DEPLOYED build (served
 * commit read in the SAME call): Map label is the first field, a custom label is what the map AND the real
 * built export sheet draw, clearing restores the automatic name, Recording details is collapsed with a
 * summary, "Exclusive easement" shows with no hint line, the label survives a reload; then deletes every trace. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const ID = "zz-easement-maplabel-verify";
const E = { id: "el1", kind: "easement", mode: "centerline", width: 50, easeType: "pipeline", status: "existing", holder: "CenterPoint",
  recording: "Vol 412 Pg 88", exclusive: true, restrictsBuildings: true, restrictsPaving: false, centerline: [{ x: 300, y: 600 }, { x: 2100, y: 600 }], z: 100 };
E.pts = deriveEasementRing(E);
const site = { id: ID, groupId: ID, site: "ZZ maplabel verify (throwaway)", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 2400, y: 0 }, { x: 2400, y: 1200 }, { x: 0, y: 1200 }] }],
  els: [], measures: [], callouts: [], markups: [E], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };

let s, failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };
async function openPlan(page) {
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.click().catch(() => {});
  for (let attempt = 0; attempt < 4 && !(await page.getByTestId("planner-canvas").first().isVisible().catch(() => false)); attempt++) {
    await page.getByPlaceholder("Filter by name…").fill("ZZ maplabel verify").catch(() => {});
    const row = page.getByText("ZZ maplabel verify", { exact: false }).first();
    if (await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
      await row.click(); await pacedWait(page, 1500);
      const open = page.getByRole("button", { name: /^open( project| plan| site)?$/i }).first();
      if (await open.count()) await open.click().catch(() => {});
      await pacedWait(page, 3000);
    }
  }
  await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await page.locator(`[data-markup="${E.id}"]`).first().waitFor({ timeout: 20000 });
  await pacedWait(page, 1500);
}
try {
  s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  const page = s.page;
  console.log("served build:", JSON.stringify(s.build));
  if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);
  await page.evaluate(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ ...(JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")), [id]: rec }));
    localStorage.setItem("planarfit:sites:history:v1", JSON.stringify({ [id]: [] }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [ID, site]);
  const ins = await page.evaluate(async (rec) => {
    const r = await window.pfSupabase.from("sites").upsert({ id: rec.id, group_id: rec.id, site: rec.site, name: rec.name, county: "harris", updated_at: new Date().toISOString(), data: rec });
    return r.error ? String(r.error.message) : null;
  }, site);
  if (ins) throw new Error("could not create the throwaway account row: " + ins);
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPlan(page);
  await assertMeasurable(page, "verify-easement-map-label");
  const mapLabel = () => page.locator(`[data-markup="${E.id}"] [data-easement-label] text`).first();
  const box = await page.locator(`[data-markup="${E.id}"] polygon`).first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByRole("button", { name: "Properties" }).first().click();
  const input = page.getByTestId("easement-map-label");
  await input.waitFor({ state: "visible", timeout: 15000 });
  const ys = [];
  for (const n of ["Map label", "Type", "Width (ft)", "Status", "Recording details"]) { const b = await page.getByText(n, { exact: true }).first().boundingBox(); ys.push(b ? b.y : -1); }
  check(ys.every((y, i) => y >= 0 && (i === 0 || y > ys[i - 1])), `field order Map label → Type → Width → Status → Recording details (y ${ys.map(Math.round).join(",")})`);
  check((await input.getAttribute("placeholder")) === "50′ Pipeline Esmt", "placeholder shows the automatic name");
  const hdr = page.getByRole("button", { name: /Recording details/ });
  check((await hdr.getAttribute("aria-expanded")) === "false", "Recording details collapsed by default");
  check((await hdr.innerText()).includes("CenterPoint · Vol 412 Pg 88 · Exclusive"), "collapsed header carries the summary");
  await hdr.click();
  check(await page.getByText("Holder / beneficiary").isVisible(), "expanding shows Holder / beneficiary");
  check(await page.getByLabel("Exclusive easement").isChecked(), "'Exclusive easement' checkbox present and checked");
  check((await page.getByText(/Exclusive use/).count()) === 0, "old 'Exclusive use' text gone, no hint line");
  await input.fill("Enterprise 12in"); await pacedWait(page, 600);
  check((await mapLabel().textContent()) === "Enterprise 12in", "map draws the custom label");
  const sheet = await page.evaluate(async () => {
    const markup = await window.__plannerExportSvg({ cx: 1200, cy: 600, wFt: 2600, hFt: 1400 });
    if (!markup) return null;
    return [...new DOMParser().parseFromString(markup, "image/svg+xml").documentElement.querySelectorAll("[data-easement-label] text")].map((t) => t.textContent);
  });
  check(Array.isArray(sheet) && sheet.includes("Enterprise 12in"), `the REAL built export sheet draws the custom label (${JSON.stringify(sheet)})`);
  await input.fill(""); await pacedWait(page, 600);
  check((await mapLabel().textContent()) === "50′ Pipeline Esmt", "clearing the box restores the automatic name");
  await input.fill("WL-A"); await pacedWait(page, 2500);
  await page.screenshot({ path: process.env.SHOT || "/tmp/easement-maplabel-live.png" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPlan(page);
  check((await mapLabel().textContent()) === "WL-A", "custom label survives a reload");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      const gone = await s.page.evaluate(async (id) => {
        const out = {};
        const e = await window.pfSupabase.from("site_elements").delete().eq("site_id", id); out.site_elements = e.error ? String(e.error.message) : "deleted";
        const t = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); out.trashed = t.error ? String(t.error.message) : "trashed";
        const d = await window.pfSupabase.from("sites").delete().eq("id", id); out.sites = d.error ? String(d.error.message) : "deleted";
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); delete o[id]; localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        out.remaining = ((await window.pfSupabase.from("sites").select("id").eq("id", id)).data || []).length;
        return out;
      }, ID);
      console.log("cleanup:", JSON.stringify(gone));
      if (gone.remaining !== 0) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
