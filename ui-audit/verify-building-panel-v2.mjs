/* verify-building-panel-v2 — Building panel v2 (NEW-1…NEW-6), driven LIVE as the test account.
 *
 * Seeds a THROWAWAY site (one building) through the app's own local-cache path (same as
 * verify-building-panel-rethink), opens the Building inspector in LIGHT then DARK at 315° (dock walls
 * read NW/SE) and walks the owner's checklist on the real canvas model:
 *   (a) single-load shows rows dock · rear · ends · ends (rear and each end SEPARATE); 8 parking rows on
 *       the rear only leave both end walls untouched;
 *   (b) cross-dock shows ONE dock row ("same"); split it, give one side a buffer — only that side changes;
 *   (c) a dashed picker corner adds a bump-out AT that corner, the dock line stops at it, SF and the door
 *       count change; size 70 × 60 lands on the model;
 *   (d) Trailer rows 2 → a two-band trailer zone with an aisle (stall count doubles);
 *   (e) no "px" anywhere in the inspector; (f) the bottom readout block is gone for a building and
 *       Pad elev. lives in Structure.
 * The throwaway is ALWAYS deleted and confirmed gone (owner constraint 15). KNOWN-GOOD ARM: the run is VOID
 * unless the untouched header reports "Building 1" and the wall list holds its four walls.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-building-panel-v2.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-bv2-" + Math.random().toString(36).slice(2, 7);
const mkSite = (b) => ({
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Building Panel V2 Throwaway", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [{ id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 315, z: 1, ...b }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [SITE_ID, UID]);
const bldg = async () => ((await model())?.els || []).find((e) => e.id === "bz1");
const kids = async () => ((await model())?.els || []).filter((e) => e.attachedTo === "bz1");
const T = (id) => page.getByTestId(id);
const wall = (side) => page.locator(`[data-testid="loading-wall-picker"] [data-wall="${side}"]`);
const rowByRole = (role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await T(`wall-add-${key}`).click(); await sleep(450); };
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }
const summary = async () => { const t = await T("building-summary").innerText(); return { sf: Number((t.match(/([\d,]+) SF/) || [])[1]?.replace(/,/g, "")), doors: Number((t.match(/(\d+) doors?/) || [])[1]), text: t }; };

async function openScenario(scheme, tag, fields) {
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, mkSite(fields)]);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText("ZZ Building Panel V2 Throwaway", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-building-panel-v2");
  const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const num = await T("building-header").getByRole("textbox", { name: "Building number" }).inputValue();
  if (num !== "1") throw new Error("VOID run — the instrument did not see the header (" + tag + ")");
}

try {
  for (const scheme of ["light", "dark"]) {
    console.log(`\n=== ${scheme.toUpperCase()} ===`);

    // ---- (a) single-load: dock · rear · ends · ends; 8 rows on the rear only ----
    await openScenario(scheme, "single", { dock: "single", dockAxis: "x", dockSide: "bottom" });
    const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
    ok(`[${scheme}] known-good: the wall list holds dock · rear · ends · ends`, JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
    if (roles.length !== 4) throw new Error("VOID run — wall rows missing");
    const picker = await page.locator('[data-testid="loading-wall-picker"] [data-wall]').evaluateAll((n) => n.map((g) => g.getAttribute("data-compass")));
    const badges = await T("wall-row-badge").allInnerTexts();
    ok(`[${scheme}] badges carry the picker's compass letters at 315° (dock walls read NW/SE)`, badges.every((t) => picker.includes(t)) && picker.includes("NW") && picker.includes("SE"), JSON.stringify({ badges, picker }));
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-single.png` }).catch(() => {});
    const rearSide = await rowByRole("rear").getAttribute("data-sides");
    await addLayer(rowByRole("rear"), "parking");
    const rows = page.getByLabel("Parking rows"); await rows.fill("8"); await rows.press("Enter"); await sleep(900);
    await rows.evaluate((el) => el.blur());
    const park = (await kids()).filter((k) => k.type === "parking" && k.sideParkSide);
    ok(`[${scheme}] 8 parking rows on the REAR only (${park.map((p) => p.sideParkSide).join(",")})`, park.length === 1 && park[0].sideParkSide === rearSide);
    ok(`[${scheme}] the end walls are untouched on the canvas model (no kid on either end)`, (await kids()).filter((k) => k.sideParkSide && k.sideParkSide !== rearSide).length === 0 && (await T("wall-row").nth(2).getByTestId("wall-chip").count()) === 0);
    ok(`[${scheme}] the parking is painted on the canvas`, (await page.locator(`[data-el-id="${park[0].id}"]`).count()) === 1);

    // ---- (b) cross-dock: one "same" row, split, buffer on one side only ----
    await openScenario(scheme, "cross", { dock: "cross", dockAxis: "x" });
    ok(`[${scheme}] cross-dock: ONE dock row, chain toggle reads "same"`, (await rowByRole("dock").count()) === 1 && /same/.test(await T("dock-link-toggle").innerText()));
    await addLayer(rowByRole("dock").first(), "court");
    ok(`[${scheme}] linked: a court on BOTH dock walls`, (await kids()).filter((k) => k.truckCourt).length === 2);
    await T("dock-link-toggle").click(); await sleep(400);
    ok(`[${scheme}] split → two dock rows, toggle reads "split"`, (await rowByRole("dock").count()) === 2 && /split/.test(await T("dock-link-toggle").innerText()));
    await addLayer(rowByRole("dock").nth(0), "buffer");
    const bufs = (await kids()).filter((k) => k.buffer);
    ok(`[${scheme}] a buffer on ONE side only`, bufs.length === 1 && (await rowByRole("dock").nth(1).getByTestId("wall-chip").count()) === 1);
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-split.png` }).catch(() => {});

    // ---- (c) bump-out from a dashed picker corner ----
    await openScenario(scheme, "bump", { dock: "single", dockAxis: "x", dockSide: "bottom" });
    await addLayer(rowByRole("dock").first(), "court");
    const sf0 = await summary();
    await T("picker-corner-add").first().click({ force: true }); await sleep(800);
    const de = (await kids()).find((k) => k.dogEar);
    ok(`[${scheme}] a bump-out exists at the clicked corner (${de ? de.dogEar.side + de.dogEar.sign : "none"}) and is painted on the canvas`, !!de && (await page.locator(`[data-el-id="${de.id}"]`).count()) === 1);
    const lens = await T("picker-wall-line").evaluateAll((n) => n.map((l) => Math.hypot(l.x2.baseVal.value - l.x1.baseVal.value, l.y2.baseVal.value - l.y1.baseVal.value)).sort((a, c) => a - c));
    ok(`[${scheme}] the dock line stops at the bump-out (butt cap, shorter than a bare wall)`, lens[0] < lens[lens.length - 1] && (await T("picker-wall-line").first().getAttribute("stroke-linecap")) === "butt", JSON.stringify(lens.map((x) => Math.round(x))));
    const sf1 = await summary();
    ok(`[${scheme}] header SF grew (${sf0.sf} → ${sf1.sf}) and the door count fell (${sf0.doors} → ${sf1.doors})`, sf1.sf > sf0.sf && sf1.doors < sf0.doors);
    await T("bump-chip").click();
    const along = page.getByLabel("Bump-out size along the dock wall"), out = page.getByLabel("Bump-out size out from the dock face");
    await along.fill("70"); await along.press("Enter"); await out.fill("60"); await out.press("Enter"); await sleep(900);
    const de2 = (await kids()).find((k) => k.dogEar);
    ok(`[${scheme}] size 70 × 60 lands on the model (${de2?.dogEar?.along}×${de2?.dogEar?.proj}, box ${Math.round(de2?.w)}×${Math.round(de2?.h)})`, de2 && Math.round(de2.dogEar.along) === 70 && Math.round(de2.dogEar.proj) === 60);
    ok(`[${scheme}] the end toggles carry a compass letter only`, (await page.locator('[data-testid^="bump-end-"]').allInnerTexts()).every((t) => /^[NSEW]{1,2}$/.test(t)));
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-bump.png` }).catch(() => {});

    // ---- (d) trailer rows 2 ----
    await openScenario(scheme, "trailer", { dock: "single", dockAxis: "x", dockSide: "bottom" });
    await addLayer(rowByRole("dock").first(), "court");
    await addLayer(rowByRole("dock").first(), "trailer");
    const stalls = async () => Number(((await T("planner-canvas").textContent()).match(/(\d+) trailers/) || [])[1]);
    const n1 = await waitFor(stalls);
    await T("wall-trailer-rows-plus").click(); await sleep(900);
    const tz = (await kids()).find((k) => k.type === "trailer");
    const n2 = await waitFor(async () => { const n = await stalls(); return n && n !== n1 ? n : 0; });
    ok(`[${scheme}] Trailer rows 2: zone = 2 × 50 + 60 aisle, two bands on the canvas (${n1} → ${n2} stalls)`, tz && tz.trailerRows === 2 && Math.round(tz.zd) === 160 && tz.cfg.single === false && n2 === 2 * n1);
    ok(`[${scheme}] the chip reads "Trailer ×2" and the editor shows the total depth`, /Trailer ×2/.test(await rowByRole("dock").first().innerText()) && /160′ deep/.test(await T("wall-trailer-total").innerText()));
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-trailer.png` }).catch(() => {});

    // ---- (e)/(f) no px; the bottom block is gone; Pad elev. in Structure ----
    const panelText = await T("property-panel").innerText();
    ok(`[${scheme}] no "px" anywhere in the inspector`, !/\bpx\b/.test(panelText));
    ok(`[${scheme}] the bottom readout block is gone (no Footprint: / Dock doors: / Column grid: / Pad elev. (ft NAVD88) rows)`, !/Footprint:|Dock doors:|Column grid:|Pad elev\. \(ft NAVD88\)/.test(panelText));
    await page.getByRole("button", { name: /Structure/ }).click();
    ok(`[${scheme}] Pad elev. lives in Structure, with one Standards link`, (await page.getByLabel("Pad elevation (ft NAVD88)").count()) === 1 && (await T("property-panel").getByRole("button", { name: "Standards ↗" }).count()) === 1);
    ok(`[${scheme}] Line weight row with a live sample`, (await T("property-panel").getByText("Line weight").count()) > 0 && (await T("line-weight-sample").count()) === 1);
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-structure.png` }).catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    // the DB refuses a hard delete of a live site — trash it first (same as verify-parcel-combine-split)
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && (q.data || []).length === 0;
  }, [SITE_ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
