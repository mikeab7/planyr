/* B2198432 / V1611264 — signed-in live check on the deployed app, THROWAWAY plan only:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-easement-label-orient.mjs [https://planyr.io] [<expected commit prefix>]
 * Seeds a throwaway plan with a vertical, a 30° and a 120° easement, then asserts on the DEPLOYED build
 * (served commit read in the SAME call as the assertions): the label angle, every label corner inside its
 * own strip, the REAL built export sheet carrying the same rotated labels, then deletes every trace. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { deriveEasementRing } from "../src/workspaces/site-planner/lib/easements.js";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const ID = "zz-easement-orient-verify";
const rad = (d) => (d * Math.PI) / 180;
const ease = (id, a, b, width) => { const m = { id, kind: "easement", mode: "centerline", width, easeType: "storm", status: "existing", exclusive: false, restrictsBuildings: true, restrictsPaving: false, centerline: [a, b], z: 100 }; m.pts = deriveEasementRing(m); return m; };
const V = ease("ev", { x: 600, y: 300 }, { x: 600, y: 1900 }, 100);
const D30 = ease("e30", { x: 1500, y: 300 }, { x: 1500 + 1500 * Math.cos(rad(30)), y: 300 + 1500 * Math.sin(rad(30)) }, 90);
const D120 = ease("e120", { x: 3200, y: 300 }, { x: 3200 + 1500 * Math.cos(rad(120)), y: 300 + 1500 * Math.sin(rad(120)) }, 90);
const site = { id: ID, groupId: ID, site: "ZZ label verify (throwaway)", name: "A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, pts: [{ x: 0, y: 0 }, { x: 4200, y: 0 }, { x: 4200, y: 2400 }, { x: 0, y: 2400 }] }],
  els: [], measures: [], callouts: [], markups: [V, D30, D120], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };

let s, failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };
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
  await page.reload({ waitUntil: "domcontentloaded" });
  const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
  if (!(await page.getByTestId("planner-canvas").count())) await tab.click();
  await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
  await pacedWait(page, 1500);
  await assertMeasurable(page, "verify-easement-label-orient");
  const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.src.split("/").pop()).filter((n) => /SitePlanner/.test(n)));
  console.log("site-planner chunk(s):", chunks.join(", "));

  const read = (id) => page.evaluate((mid) => [...document.querySelectorAll(`[data-markup="${mid}"]`)].map((g) => {
    const poly = g.querySelector("polygon"), lab = g.querySelector("[data-easement-label]");
    if (!poly || !lab) return null;
    const inv = poly.getScreenCTM().inverse();
    return { angle: parseFloat(lab.getAttribute("data-label-angle")), texts: [...lab.querySelectorAll("text")].map((t) => {
      const b = t.getBBox(), m = t.getScreenCTM();
      const inside = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].every(([x, y]) => { const p = new DOMPoint(x, y).matrixTransform(m).matrixTransform(inv); return poly.isPointInFill(new DOMPoint(p.x, p.y)); });
      return { text: t.textContent, inside }; }) };
  }).filter(Boolean), id);

  const canvas = page.getByTestId("planner-canvas").first();
  for (const [mk, wantDeg] of [[V, -90], [D30, 30], [D120, -60]]) {
    const box = await page.locator(`[data-markup="${mk.id}"] polygon`).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.up();
    await pacedWait(page, 500);
    const c = await canvas.boundingBox();
    const seen = [];
    for (let i = 0; i < 5; i++) {
      await assertMeasurable(page, "verify-easement-label-orient:zoom");
      seen.push(...(await read(mk.id)));
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.wheel(0, -200); await pacedWait(page, 400);
    }
    check(seen.length > 0, `${mk.id}: label rendered (${seen.length} reads across zoom + pan, selected)`);
    check(seen.every((r) => Math.abs(r.angle - wantDeg) < 0.6), `${mk.id}: angle ${[...new Set(seen.map((r) => r.angle))].join("/")} = ${wantDeg}° upright`);
    check(seen.every((r) => r.texts.every((t) => t.inside)), `${mk.id}: every corner of name${seen[0] && seen[0].texts.length > 1 ? " + area line" : ""} inside its strip`);
    await page.getByTestId("zoom-fit").click().catch(() => {});
  }
  await page.screenshot({ path: process.env.SHOT || "/tmp/easement-live.png" });
  const sheet = await page.evaluate(async () => {
    const markup = window.__plannerExportSvg ? await window.__plannerExportSvg() : null;
    if (!markup) return null;
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    return [...root.querySelectorAll("[data-easement-label]")].map((g) => g.getAttribute("data-label-angle"));
  });
  console.log("export sheet label angles:", JSON.stringify(sheet));
  check(!!sheet && sheet.length >= 3, "the REAL built export sheet carries the easement labels");
  check(!!sheet && ["-90.0", "30.0", "-60.0"].every((a) => sheet.includes(a)), "export sheet carries the same rotated angles as the canvas");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      const gone = await s.page.evaluate(async (id) => {
        const out = {};
        for (const [t, col] of [["site_elements", "site_id"], ["sites", "id"]]) { const r = await window.pfSupabase.from(t).delete().eq(col, id); out[t] = r.error ? String(r.error.message) : "deleted"; }
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
