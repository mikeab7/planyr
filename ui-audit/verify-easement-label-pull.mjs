/* NEW-1/NEW-2 (easement label: pull out · move · rotate · snap back · area off) — signed-in live check on
 * the DEPLOYED app, THROWAWAY plan only (deleted at the end, verified gone):
 *   E2E_LOGIN_KEY=… node ui-audit/verify-easement-label-pull.mjs [https://planyr.io] [<expected commit prefix>]
 * Drives the owner's whole sequence with the real mouse on a throwaway project: no acreage by default · drag the
 * label off the strip (leader appears) · rotate it upside down · the CLOUD ROW carries the offset+angle · reload and
 * it stuck · move the easement and the label follows · the REAL built export sheet prints the label + leader and no
 * editing chrome · right-click → Snap back to strip · Show area / Hide area · dark theme. The served build is read in
 * the SAME call as the assertions. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const ID = "zz-easement-pull-verify";
const NAME = "ZZ label pull verify";
const V = (() => { const m = { id: "ev", kind: "easement", mode: "centerline", width: 100, easeType: "storm", status: "existing", exclusive: false, restrictsBuildings: true, restrictsPaving: false, centerline: [{ x: 600, y: 300 }, { x: 600, y: 1900 }], z: 100 }; m.pts = deriveEasementRing(m); return m; })();
const site = { id: ID, groupId: ID, site: NAME + " (throwaway)", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 1400, y: 0 }, { x: 1400, y: 2400 }, { x: 0, y: 2400 }] }],
  els: [], measures: [], callouts: [], markups: [V], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };

let s, failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };
async function openPlan(page) {
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  await tab.click().catch(() => {});
  for (let attempt = 0; attempt < 4 && !(await page.getByTestId("planner-canvas").first().isVisible().catch(() => false)); attempt++) {
    await page.getByPlaceholder("Filter by name…").fill(NAME).catch(() => {});
    const row = page.getByText(NAME, { exact: false }).first();
    if (await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
      await row.click();
      await pacedWait(page, 1500);
      const open = page.getByRole("button", { name: /^open( project| plan| site)?$/i }).first();
      if (await open.count()) await open.click().catch(() => {});
      await pacedWait(page, 3000);
    }
  }
  await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await pacedWait(page, 1500);
  await assertMeasurable(page, "verify-easement-label-pull");
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

  const canvas = page.getByTestId("planner-canvas").first();
  const lab = () => page.locator('[data-markup="ev"] [data-easement-label]').first();
  const info = () => lab().evaluate((g) => ({
    angle: parseFloat(g.getAttribute("data-label-angle")), pulled: g.getAttribute("data-label-pulled") === "1",
    area: g.getAttribute("data-label-area") === "1", leader: !!g.querySelector("[data-easement-leader]"),
    stroke: g.querySelector("[data-easement-leader] line")?.getAttribute("stroke") || null, fill: g.querySelector("text")?.getAttribute("fill") || null,
    texts: [...g.querySelectorAll("text")].map((t) => t.textContent) }));
  const hit = () => page.locator('[data-markup="ev"] [data-easement-label-hit]').first().boundingBox();
  const ctr = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const poly = () => page.locator('[data-markup="ev"] polygon').first().boundingBox();
  const drag = async (a, b, steps = 12) => { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps }); await page.mouse.up(); await pacedWait(page, 450); };
  const zoomIn = async () => {
    await page.getByRole("button", { name: "Zoom to fit" }).click(); await pacedWait(page, 800);
    for (let i = 0; i < 4; i++) {
      const b = await poly(), c = await canvas.boundingBox();
      await page.mouse.move(Math.min(Math.max(b.x + b.width / 2, c.x + 40), c.x + c.width - 40), Math.min(Math.max(b.y + b.height / 2, c.y + 40), c.y + c.height - 40));
      await page.mouse.wheel(0, -200); await pacedWait(page, 350);
    }
  };
  const row = (name) => page.getByText(name, { exact: true }).filter({ visible: true }).first();

  await zoomIn();
  await assertMeasurable(page, "verify-easement-label-pull:start");
  let st = await info();
  check(!st.area && st.texts.length === 1, "NEW-2: no acreage on the label by default (name only)");
  check(!st.pulled && !st.leader, "inline label has no leader");

  const c0 = ctr(await hit());
  await page.mouse.click(c0.x, c0.y); await pacedWait(page, 450);
  check((await page.getByTestId("markup-selected").count()) === 1, "clicking the label of an unselected easement selects the easement");
  await drag(c0, { x: c0.x + 170, y: c0.y + 40 });
  st = await info();
  check(st.pulled && st.leader, "dragging the label off the strip detaches it and draws a leader to the easement");
  const hb = await hit();
  const grip = await page.locator("[data-easement-label-rotate]").first().boundingBox();
  const lc = ctr(hb);
  await drag(ctr(grip), { x: lc.x, y: lc.y + 120 }, 16);
  st = await info();
  check(Math.abs(st.angle) > 170, `free rotation: label upside down (${st.angle}°), not forced upright`);
  await page.screenshot({ path: process.env.SHOT || "/tmp/easement-pull-live.png" });

  // the cloud row must carry the pull (sync) — poll
  let cloud = null;
  for (let i = 0; i < 20 && !(cloud && cloud.labelPull); i++) {
    await pacedWait(page, 1000);
    cloud = await page.evaluate(async (id) => { const r = await window.pfSupabase.from("site_elements").select("data").eq("site_id", id).eq("kind", "markup").eq("id", "ev").maybeSingle(); return r.data ? r.data.data : { error: r.error && r.error.message }; }, ID);
  }
  check(!!(cloud && cloud.labelPull && Math.abs(cloud.labelPull.angle) > 170), `cloud row carries labelPull ${JSON.stringify(cloud && cloud.labelPull)}`);

  // PDF-PARITY on the real built sheet
  const screenAngle = (await info()).angle;
  const sheet = await page.evaluate(async () => {
    const markup = await window.__plannerExportSvg({ cx: 600, cy: 1100, wFt: 600, hFt: 400 });
    if (!markup) return null;
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    const g = root.querySelector('[data-easement-label="ev"]');
    return g ? { xf: g.getAttribute("transform"), leader: !!g.querySelector("[data-easement-leader] line") && !!g.querySelector("[data-easement-leader] circle"), chrome: root.querySelectorAll("[data-easement-label-hit],[data-easement-label-handles],[data-easement-label-rotate]").length } : { missing: true };
  });
  check(!!sheet && !sheet.missing && sheet.leader && sheet.chrome === 0, "the REAL export sheet prints the pulled label + leader and no editing chrome " + JSON.stringify(sheet));
  const rot = (t) => parseFloat(/rotate\((-?[\d.]+)\)/.exec(t || "")?.[1]);
  check(sheet && Math.abs(Math.abs(rot(sheet.xf)) - Math.abs(screenAngle)) < 0.2, `export rotation ${rot(sheet && sheet.xf)} matches screen ${screenAngle}`);

  // reload → stuck
  await page.reload({ waitUntil: "domcontentloaded" });
  await openPlan(page); await zoomIn();
  st = await info();
  check(st.pulled && Math.abs(st.angle) > 170 && st.leader, "after a reload the label is still pulled out, upside down, with its leader");

  // dark theme: leader + label keep their (non-white) type colour
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); }); await pacedWait(page, 400);
  st = await info();
  check(!!st.stroke && st.stroke === st.fill && !/^#?(fff|ffffff)$/i.test(st.stroke), `dark theme: leader ${st.stroke} matches label ${st.fill}`);
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "light"); }); await pacedWait(page, 300);

  // move the easement: label follows
  const before = ctr(await hit()), pb0 = await poly();
  const cb = await canvas.boundingBox();
  const sp = { x: pb0.x + pb0.width / 2, y: cb.y + cb.height * 0.45 };
  await drag(sp, { x: sp.x - 90, y: sp.y + 30 });
  const after = ctr(await hit()), pb1 = await poly();
  const mdx = pb1.x - pb0.x;
  check(Math.abs(mdx) > 40 && Math.abs(after.x - before.x - mdx) < 5 && (await info()).leader, "moving the easement carries the label (same offset) and the leader re-aims");

  // snap back (right-click menu), then Show / Hide area
  const h2 = ctr(await hit());
  await page.mouse.click(h2.x, h2.y, { button: "right" }); await pacedWait(page, 400);
  await row("Snap back to strip").click(); await pacedWait(page, 500);
  st = await info();
  check(!st.pulled && !st.leader && Math.abs(Math.abs(st.angle) - 90) < 0.6, "right-click → Snap back to strip returns it inline, upright, no leader");
  const h3 = ctr(await hit());
  await page.mouse.click(h3.x, h3.y, { button: "right" }); await pacedWait(page, 400);
  check(await row("Snap back to strip").isDisabled().catch(() => false), "on an inline label, Snap back is disabled");
  await row("Show area").click(); await pacedWait(page, 500);
  st = await info();
  check(st.area && st.texts.length === 2 && /SF · .* AC/.test(st.texts[1]), `Show area → "${st.texts[1]}"`);
  await page.mouse.click(h3.x, h3.y, { button: "right" }); await pacedWait(page, 400);
  await row("Hide area").click(); await pacedWait(page, 500);
  check(!(await info()).area, "Hide area → name only again");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      const gone = await s.page.evaluate(async (id) => {
        const out = {};
        { const e = await window.pfSupabase.from("site_elements").delete().eq("site_id", id); out.site_elements = e.error ? String(e.error.message) : "deleted";
          const t = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); out.trashed = t.error ? String(t.error.message) : "trashed"; // trash first, then permanent (the DB refuses a live delete)
          const d = await window.pfSupabase.from("sites").delete().eq("id", id); out.sites = d.error ? String(d.error.message) : "deleted"; }
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); delete o[id]; localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const left = await window.pfSupabase.from("sites").select("id").eq("id", id);
        out.remaining = (left.data || []).length;
        return out;
      }, ID);
      console.log("cleanup:", JSON.stringify(gone));
      if (gone.remaining !== 0) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
