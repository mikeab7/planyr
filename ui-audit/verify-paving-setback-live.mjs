/* verify-paving-setback-live — NEW-1 (2026-11-09, B2671202 / V2115867): the PAVING setback on a REAL deploy, signed in as the throwaway test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-paving-setback-live.mjs [https://planyr.io]
 *
 * Seeds a throwaway plan (one 800 × 500 ft lot, building setback 25 ft, a parking field across the west line, a field inside, a SIDEWALK across the
 * east line, a driveway from OUTSIDE the lot, and a road stub that dead-ends inside the line). Reads /version.json in the SAME page call as every reading.
 *   1  before Add: no Paving row / line / flags, no stored key        2  Add: row at 0 (not 25), still nothing drawn, key = zeros
 *   3  type 10: dotted line + EXACTLY the straddling parking and the dead-end stub flagged (sidewalk, driveway, inside field are the known-good arms)
 *   4  the Building | Paving switch relabels the sketch               5  the printed sheet carries the paving line and NO red conflict mark
 *   6  Remove: row, line and flags gone, building setback unchanged, key gone from the CLOUD row; Undo brings it back
 *   7  reload keeps it
 * Deletes the throwaway at the end and VERIFIES it is gone (owner constraint 15). FOREGROUND-OR-VOID asserted first. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-paving-setback-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Paving setback", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, points: [{ x: -400, y: -250 }, { x: 400, y: -250 }, { x: 400, y: 250 }, { x: -400, y: 250 }], setbacks: [25, 25, 25, 25] }],
  els: [
    { id: "pk-west", type: "parking", cx: -392, cy: 0, w: 40, h: 80, rot: 0, z: 10 },
    { id: "pk-inside", type: "parking", cx: 0, cy: 0, w: 120, h: 80, rot: 0, z: 11 },
    { id: "sw-east", type: "sidewalk", cx: 392, cy: 0, w: 40, h: 80, rot: 0, z: 12 },
    { id: "drive", type: "road", pts: [{ x: -460, y: -150 }, { x: -200, y: -150 }], vtx: [{}, {}], travelW: 24, curb: 0.5, roadClass: "local", cx: -330, cy: -150, w: 260, h: 24, rot: 0, z: 13 },
    { id: "stub", type: "road", pts: [{ x: 100, y: 150 }, { x: 395, y: 150 }], vtx: [{}, {}], travelW: 24, curb: 0.5, roadClass: "local", cx: 247, cy: 150, w: 295, h: 24, rot: 0, z: 14 },
  ],
  measures: [], markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const T = (id) => page.getByTestId(id);
let served = null;
const read = () => page.evaluate(async () => {
  const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
  const flags = [...document.querySelectorAll("[data-paving-flag]")].map((n) => n.getAttribute("data-paving-flag")).sort();
  const ring = document.querySelectorAll('[data-testid="paving-ring"]');
  return { build, flags, ringCount: ring.length, ringDash: ring[0] ? ring[0].getAttribute("stroke-dasharray") : null, ringStroke: ring[0] ? ring[0].getAttribute("stroke") : null,
    bRingDash: document.querySelector('[data-testid="setback-ring"]')?.getAttribute("stroke-dasharray") || null, bRingStroke: document.querySelector('[data-testid="setback-ring"]')?.getAttribute("stroke") || null };
});
// Parcels sync as `site_elements` rows (kind "parcel", the object verbatim) — that row, not the plan's jsonb header, is the stored truth.
const cloudParcel = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("site_elements").select("data").eq("site_id", id).eq("kind", "parcel").is("deleted_at", null); return (q.data && q.data[0] && q.data[0].data) || null; }, ID);
const poll = async (fn, ok, ms = 12000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (ok(v)) return v; await page.waitForTimeout(300); } return v; };
const openPage = async () => { // the Land tab's list row — the same way a person gets to a parcel's page
  if (await T("parcel-page").count()) return;
  if (!(await T("parcels-panel").count())) await page.locator('[data-rail-tab="parcel"]').click();
  await T("parcel-row-pc1").waitFor({ timeout: 15000 });
  await T("parcel-row-pc1").click();
  await T("parcel-page").waitFor({ timeout: 15000 });
};

try {
  await assertMeasurable(page, "verify-paving-setback-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build);
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
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => ["pk-west", "stub", "sw-east"].every((id) => document.querySelector(`[data-el-id="${id}"]`)), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await openPage();

  // 1 — nothing paving-shaped yet
  let st = await read(); served = st.build;
  check("1 · before Add: '+ Add paving setback' is offered, no Paving row", (await T("paving-add").count()) === 1 && (await T("paving-all").count()) === 0);
  check("1 · the row now reads Building", /Building/.test(await T("setback-all").innerText()));
  check("1 · no paving line, no flags", st.ringCount === 0 && st.flags.length === 0, JSON.stringify(st.flags));
  check("known-good arm: the building setback ring is drawn", (await T("setback-ring").count()) === 1);

  // 2 — add
  await T("paving-add").click();
  await T("paving-all").locator("input").waitFor({ timeout: 8000 });
  check("2 · Paving row starts at 0 (never the building 25)", (await T("paving-all").locator("input").inputValue()) === "0");
  await page.waitForTimeout(1500);
  st = await read();
  check("2 · still no line and no flags at 0", st.ringCount === 0 && st.flags.length === 0);

  // 3 — type 10
  const inp = T("paving-all").locator("input");
  await inp.fill("10"); await inp.press("Enter");
  st = await poll(read, (x) => x.ringCount === 1 && x.flags.length === 2);
  served = st.build;
  check("3 · the dotted paving line appears", st.ringCount === 1);
  check("3 · EXACTLY the straddling parking field and the dead-end road are flagged", JSON.stringify(st.flags) === JSON.stringify(["pk-west", "stub"]), JSON.stringify(st.flags));
  check("3 · known-good arms: sidewalk across the line, the street driveway and the inside field are NOT flagged", !st.flags.includes("sw-east") && !st.flags.includes("drive") && !st.flags.includes("pk-inside"));
  check("3 · the paving line differs from the building line (dotted vs dashed, own colour)", st.ringDash !== st.bRingDash && st.ringStroke !== st.bRingStroke, `${st.ringDash} | ${st.bRingDash}`);

  // 4 — switch
  await T("setback-mode-paving").click();
  const t10 = await T("setback-sketch").locator("text").first().textContent();
  await T("setback-mode-building").click();
  const t25 = await T("setback-sketch").locator("text").first().textContent();
  check("4 · the Building | Paving switch relabels the sketch", t10.trim() === "10′" && t25.trim() === "25′", `${t10} / ${t25}`);

  // 5 — printed sheet: line yes, red marks no
  const sheet = await page.evaluate(async () => {
    const svg = await window.__plannerExportSvg();
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    return { paving: doc.querySelectorAll('[data-testid="paving-ring"]').length, flags: doc.querySelectorAll("[data-paving-flag]").length };
  });
  check("5 · the printed sheet carries the paving line", sheet.paving >= 1, JSON.stringify(sheet));
  check("5 · …and none of the red conflict marks (review chrome)", sheet.flags === 0, JSON.stringify(sheet));

  // cloud row has it
  await page.waitForTimeout(3000);
  let cp = await cloudParcel();
  check("3 · the cloud row stores pavingSetbacks = [10,10,10,10] and the building setback is untouched", JSON.stringify(cp && cp.pavingSetbacks) === "[10,10,10,10]" && JSON.stringify(cp.setbacks) === "[25,25,25,25]", JSON.stringify(cp && { p: cp.pavingSetbacks, b: cp.setbacks }));

  // 7 — reload keeps it
  await page.reload({ waitUntil: "load" });
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelector('[data-el-id="pk-west"]'), null, { timeout: 30000 });
  st = await poll(read, (x) => x.ringCount === 1 && x.flags.length === 2, 15000);
  served = st.build;
  check("7 · a reload keeps the line and the flags", st.ringCount === 1 && JSON.stringify(st.flags) === JSON.stringify(["pk-west", "stub"]), JSON.stringify(st.flags));

  // 6 — remove, then Undo
  await openPage();
  await T("paving-remove").click();
  st = await poll(read, (x) => x.ringCount === 0 && x.flags.length === 0);
  check("6 · Remove: the Paving row, the line and every flag are gone", (await T("paving-all").count()) === 0 && st.ringCount === 0 && st.flags.length === 0, JSON.stringify(st.flags));
  check("6 · the building setback line is still there", (await T("setback-ring").count()) === 1);
  await page.waitForTimeout(3500);
  cp = await cloudParcel();
  check("6 · the key is GONE from the cloud row; the building setback is unchanged", cp && !("pavingSetbacks" in cp) && JSON.stringify(cp.setbacks) === "[25,25,25,25]", JSON.stringify(cp));
  await page.getByRole("button", { name: "Undo" }).first().click();
  st = await poll(read, (x) => x.ringCount === 1);
  check("6 · Undo brings the paving back at 10", st.ringCount === 1 && (await T("paving-all").count()) === 1);

  console.log("served build at the readings:", served);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        if (k.endsWith(":p:" + id)) { localStorage.removeItem(k); continue; }
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
