/* V1801008 — B2370480 LIVE: while the Parcels tool is up, parcels draw ABOVE everything, and a press in
 * Pick county lots picks the REAL county lot under a building (planyr.io, signed in as e2e@planyr.test).
 *
 * Seeds ONE throwaway plan on the test account (a lot with a building, a filled markup and a promoted
 * reference centred on its lines), drives it, and DELETES it (site_elements, then sites) with a confirmed-gone
 * read (constraint #15). The deployed build is read in the same call as the assertions; pass the build you
 * expect as argv[2] (any prefix), e.g. `node ui-audit/verify-parcels-in-front-live.mjs 7cceef0`.
 * Steps: 1 buried (Land closed) · 2 parcel on top at all three points, line band beneath the plan, sheet keeps
 * the NORMAL order (PDF-PARITY) · 3 real Harris outlines painted in the in-SVG host (never the backdrop), a
 * press on the building picks the lot and does not move the building.
 * Never pass --ignore-certificate-errors (owner-ruled-out). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const WANT = process.argv[2] || "";
const SHOTS = process.env.SHOTS_DIR || "/tmp";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const ID = "zz-v1801008-throwaway";
const site = {
  schemaVersion: 12, id: ID, groupId: ID, site: "ZZ V1801008 throwaway", name: "Plan 1",
  origin: { lat: 29.7604, lon: -95.3698 }, county: "harris", updatedAt: Date.now(), status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }], active: true, z: 0 }],
  els: [{ id: "b1", type: "building", cx: 400, cy: 150, w: 200, h: 140, rot: 0, z: 1 }],
  markups: [{ id: "mk1", kind: "rect", cx: 200, cy: 300, w: 160, h: 90, rot: 0, stroke: "#e11d48", weight: 2, fill: "#e11d48", fillOpacity: 0.4, z: 2 }],
  sheetOverlays: [{ id: "ov1", name: "Exhibit.png", src: PNG, x: 100, y: -50, imgW: 200, imgH: 100, ftPerPx: 1, rotation: 0, opacity: 0.9, locked: false, visible: true, aboveParcel: true }],
  measures: [], callouts: [], underlay: null, parcelDrawings: [], settings: {},
};
const s = await openSignedIn({ base: "https://planyr.io", initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s; const out = [];
const rec = (k, ok, d) => { out.push({ k, ok, d }); console.log(ok ? "PASS" : "FAIL", k, d ?? ""); };
try {
  console.log("build", JSON.stringify(s.build), "signed in as", s.proof.email);
  if (WANT && !String(s.build && s.build.build).startsWith(WANT)) throw new Error("deployed build is " + (s.build && s.build.build) + ", not " + WANT);
  const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([uid, rec]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [rec.id]: rec })); localStorage.setItem("planarfit:currentSite:v1", rec.id); }, [UID, site]);
  await page.evaluate(() => sessionStorage.setItem("planyr:diag", "1"));
  await page.goto("https://planyr.io/#/site-planner", { waitUntil: "load" });
  await page.getByText("ZZ V1801008 throwaway").first().click({ timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await assertMeasurable(page, "V1801008");
  const centre = (sel) => page.evaluate((q) => { const n = document.querySelector(q); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  const topAt = (p) => page.evaluate(({ x, y }) => { for (const n of document.elementsFromPoint(x, y)) { const f = n.closest && n.closest("[data-feature]"); if (f) return f.getAttribute("data-feature"); } return null; }, p);
  const landOpen = async () => (await page.getByTestId("parcels-panel").count()) + (await page.getByTestId("parcel-page").count());
  const bPt = { x: 0, y: 0 };
  // edge points: east edge x=400 -> building centre; south edge -> markup centre; north -> reference centre
  const pts = { east: "[data-el-id=\"b1\"]", south: '[data-feature="markup:mk1"]', north: '[data-overlay-id="ov1"]' };
  const want0 = { east: "el:b1", south: "markup:mk1", north: "reference:ov1" };
  const p0 = {}; for (const k in pts) p0[k] = await centre(pts[k]);
  for (const k in pts) rec("1 buried " + k, (await topAt(p0[k])) === want0[k], await topAt(p0[k]));
  await page.locator('[data-rail-tab="parcel"]').click(); await page.waitForTimeout(900);
  const p1 = {}; for (const k in pts) p1[k] = await centre(pts[k]);
  for (const k in pts) { const t = await topAt(p1[k]); rec("2 parcel on top " + k, t === "parcel:p1", t); }
  const z = await page.evaluate(() => { const svg = document.querySelector('[data-testid="planner-canvas"]'); const h = [...svg.parentElement.children].find((el) => el.tagName === "DIV" && el.querySelector(".leaflet-gisLine-pane")); return { host: parseInt(getComputedStyle(h).zIndex, 10), plan: parseInt(getComputedStyle(svg).zIndex, 10) }; });
  rec("2 line band beneath plan", z.host < z.plan, JSON.stringify(z));
  // PDF-PARITY (step 4) with Land open
  const order = await page.evaluate(async () => { const html = await window.__plannerExportSvg(); const doc = new DOMParser().parseFromString(html, "image/svg+xml"); const all = [...doc.querySelectorAll("*")]; const ix = (q) => { const n = doc.querySelector(q); return n ? all.indexOf(n) : -1; }; return { o: ix('[data-testid="parcel-outline"]'), b: ix('[data-el-id="b1"]'), leak: doc.querySelectorAll("[data-parcel-tier],[data-parcel-tier-slot]").length }; });
  rec("4 sheet normal order", order.o > -1 && order.o < order.b && order.leak === 0, JSON.stringify(order));
  await page.locator('[data-rail-tab="parcel"]').click(); await page.waitForTimeout(600);
  // step 3: Pick county lots on the REAL Harris service
  await page.getByTestId("rail-parcel-tools").click(); await page.locator('[data-parcel-action="identify"]').click();
  await page.waitForTimeout(3000);
  for (let i = 0; i < 2; i++) { await page.getByRole("button", { name: "−" }).or(page.locator('button[title*="Zoom out" i]')).first().click().catch(() => {}); await page.waitForTimeout(400); }
  await page.waitForTimeout(12000);
  const diag = await page.evaluate(() => (window.__plannerParcelOutlines ? window.__plannerParcelOutlines() : "no-hook"));
  console.log("DIAG", JSON.stringify(diag));
  const ink = await page.evaluate(() => { const band = document.querySelector("[data-parcel-pick-band]"); const cs = band ? [...band.querySelectorAll("canvas")] : []; let n = 0; for (const c of cs) { try { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; } catch (e) {} } const markers = band ? band.querySelectorAll(".planyr-lot-no").length : 0; return { canvases: cs.length, ink: n, lotNumbers: markers, backdropInk: document.querySelectorAll(".leaflet-overlay-pane canvas").length }; });
  rec("3 county outline painted in the front host", ink.ink > 0 && ink.backdropInk === 0, JSON.stringify(ink));
  await page.screenshot({ path: SHOTS + "/live-pick.png" });
  const before = await page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature"))).size);
  const bRect0 = await page.evaluate(() => { const r = document.querySelector('[data-el-id="b1"]').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; });
  const bc = await centre('[data-el-id="b1"]');
  await page.mouse.click(bc.x, bc.y);
  await page.waitForTimeout(500);
  const ackSeen = await page.getByTestId("click-ack").count();
  let added = false; for (let i = 0; i < 20 && !added; i++) { await page.waitForTimeout(500); added = (await page.evaluate(() => new Set([...document.querySelectorAll('[data-feature^="parcel:"]')].map((n) => n.getAttribute("data-feature"))).size)) > before; }
  const noMove = await page.evaluate(() => { const r = document.querySelector('[data-el-id="b1"]').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width)]; });
  const _old = await page.evaluate(() => { const uid = Object.keys(localStorage).find((k) => k.startsWith("planarfit:sites:cloud:")); const m = JSON.parse(localStorage.getItem(uid) || "{}"); const r = m["zz-v1801008-throwaway"]; const b = r && r.els.find((e) => e.id === "b1"); return b ? [b.cx, b.cy] : null; });
  rec("3 press on the building picked the real county lot (ack or added)", ackSeen > 0 || added, JSON.stringify({ ackSeen, added }));
  rec("3 building not moved", JSON.stringify(noMove) === JSON.stringify(bRect0), JSON.stringify({ bRect0, noMove }));
  await page.screenshot({ path: SHOTS + "/live-after-click.png" });
} catch (e) { rec("script", false, String(e && e.message || e)); await page.screenshot({ path: SHOTS + "/live-fail.png" }).catch(() => {}); }
finally {
  // CLEAR the throwaway (constraint #15) and verify it is gone, locally and in the account
  const gone = await page.evaluate(async (id) => {
    const uid = (await window.pfSupabase.auth.getUser()).data.user.id;
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    for (const k of ["planarfit:sites:cloud:" + uid, "planarfit:sites:v1"]) { try { const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {} }
    return { cloudRemaining: (q.data || []).length, err: q.error && q.error.message };
  }, ID).catch((e) => String(e));
  console.log("CLEANUP", JSON.stringify(gone));
  console.log("PAGEERRORS", JSON.stringify(s.errors.slice(0, 3)));
  await s.close();
}
console.log("SUMMARY", out.filter((o) => !o.ok).length === 0 ? "ALL PASS" : "FAILURES: " + out.filter((o) => !o.ok).map((o) => o.k).join("; "));
