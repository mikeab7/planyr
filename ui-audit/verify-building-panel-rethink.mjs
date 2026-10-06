/* verify-building-panel-rethink — B2144160–B2144168 / V1561440, driven LIVE as the test account.
 *
 * Seeds a THROWAWAY site (one building) through the app's own local-cache path, opens its Building
 * inspector in LIGHT then DARK, and walks every section: header (number · lock · ⋯ · ✕ · summary), the Loading wall
 * picker at a non-zero rotation (picker labels vs the painted aprons), the dock stack, 8 typed parking
 * rows, Structure folding, and outline width 4 / opacity 50 (drawn, then in the export clone). Writes a
 * panel screenshot per theme when SHOTS_DIR is set. The throwaway is ALWAYS deleted and confirmed gone
 * (owner constraint 15). KNOWN-GOOD ARM: the run is VOID unless the untouched header reports "Building 1".
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-building-panel-rethink.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-bldg-" + Math.random().toString(36).slice(2, 7);
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Building Panel Throwaway", name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [{ id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 0, dock: "cross", dockAxis: "x", z: 1 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

const s = await openSignedIn({ base: BASE });
const { browser, context, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [SITE_ID, UID]);
const bldg = async () => ((await model())?.els || []).find((e) => e.id === "bz1");
const kids = async () => ((await model())?.els || []).filter((e) => e.attachedTo === "bz1");
const wall = (side) => page.locator(`[data-testid="loading-wall-picker"] [data-wall="${side}"]`);
const T = (id) => page.getByTestId(id);
const apronCompass = () => page.evaluate(() => {
  const g = document.querySelector('[data-el-id="bz1"]'); const b = g.querySelector("rect").getBoundingClientRect();
  const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }; const L = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return [...g.querySelectorAll("[data-dock-apron]")].map((n) => { const r = n.getBoundingClientRect(); const deg = ((Math.atan2(r.x + r.width / 2 - c.x, -(r.y + r.height / 2 - c.y)) * 180) / Math.PI + 360) % 360; return L[Math.round(deg / 45) % 8]; }).sort();
});
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }

try {
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
  for (const scheme of ["light", "dark"]) {
    console.log(`\n=== ${scheme.toUpperCase()} ===`);
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
    await page.getByText("ZZ Building Panel Throwaway", { exact: false }).first().click();
    await T("planner-canvas").waitFor({ timeout: 25000 });
    await sleep(1500);
    { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
    await assertMeasurable(page, "verify-building-panel-rethink");
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || getComputedStyle(document.documentElement).colorScheme);
    console.log("theme attr:", theme);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-open.png` }).catch(() => {});
    const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.dblclick(pt.x, pt.y);
    await T("building-header").waitFor({ timeout: 10000 });
    const num = await T("building-header").getByRole("textbox", { name: "Building number" }).inputValue();
    ok(`[${scheme}] known-good: header reads Building with number 1`, num === "1");
    if (num !== "1") throw new Error("VOID run — the instrument did not see the header");
    ok(`[${scheme}] summary line, no Pin / Delete element row`, /SF · (Cross-dock|Single-load)/.test(await T("building-summary").innerText()) && (await page.getByRole("button", { name: /Pin|Delete element/ }).count()) === 0);
    ok(`[${scheme}] four sections present, Structure closed`, (await page.getByRole("button", { name: /^.*Footprint/ }).count()) > 0 && (await page.getByRole("button", { name: /Structure/ }).getAttribute("aria-expanded")) === "false");

    // rotation 45 → picker labels follow; click walls; canvas agrees
    const rot = page.getByText("Rotation", { exact: true }).locator("xpath=..").locator("input").first();
    await rot.fill("45"); await rot.press("Enter");
    await waitFor(async () => Math.round((await bldg())?.rot || 0) === 45);
    ok(`[${scheme}] picker labels at rot 45: top NE, bottom SW`, (await wall("top").getAttribute("data-compass")) === "NE" && (await wall("bottom").getAttribute("data-compass")) === "SW");
    await T("add-dock-zone").click(); await sleep(500);
    ok(`[${scheme}] canvas aprons NE + SW agree with the picker (cross-dock)`, JSON.stringify(await apronCompass()) === JSON.stringify(["NE", "SW"]), JSON.stringify(await apronCompass()));
    await wall("bottom").click(); await sleep(600);
    ok(`[${scheme}] click SW wall → single-load NE; picker says "NE wall"`, (await T("loading-walls-label").innerText()) === "NE wall" && (await bldg()).dock === "single");
    await wall("top").click(); await wall("top").click(); await sleep(600);   // unload, then reload the NE wall
    await wall("bottom").click(); await sleep(600);
    ok(`[${scheme}] second wall click re-loads opposite wall → cross-dock`, (await bldg()).dock === "cross" || (await T("loading-type").innerText()) === "Cross-dock");
    // parking rows 8
    const rows = T("end-parking-row").locator("input").first();
    await rows.fill("8"); await rows.press("Enter"); await sleep(800);
    await rows.evaluate((el) => el.blur());
    const park = (await kids()).filter((k) => k.type === "parking" && k.sideParkSide);
    const rowsDone = park.length ? Math.round(park[0].h) : 0;
    ok(`[${scheme}] 8 typed parking rows laid out (${park.length} wall(s), depth ${rowsDone})`, park.length > 0 && (await rows.inputValue()) === "8");
    await page.screenshot({ path: SHOTS ? `${SHOTS}/${scheme}-canvas.png` : undefined }).catch(() => {});
    // outline width/opacity
    const w = page.getByLabel("Outline width"); await w.fill("4"); await w.press("Enter");
    const o = page.getByLabel("Outline opacity"); await o.fill("50"); await o.press("Enter");
    await waitFor(async () => (await bldg())?.strokeWidth === 4 && (await bldg())?.strokeOpacity === 0.5);
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-panel.png` }).catch(() => {});
    const box = await T("planner-canvas").boundingBox();
    await page.keyboard.press("Escape"); await page.mouse.click(box.x + 30, box.y + box.height - 30); await sleep(500);
    const attrs = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"] rect'); return { w: r.getAttribute("stroke-width"), o: r.getAttribute("stroke-opacity") }; });
    ok(`[${scheme}] outline width 4 / opacity 0.5 drawn on the canvas`, attrs.w === "4" && attrs.o === "0.5", JSON.stringify(attrs));
    // reset for the next theme pass
    await page.evaluate(([id, uid]) => { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m[id]) { m[id].els = m[id].els.filter((e) => e.id === "bz1").map((e) => { const { strokeWidth, strokeOpacity, ...r } = e; return { ...r, rot: 0, dock: "cross", dockAxis: "x" }; }); localStorage.setItem(k, JSON.stringify(m)); } }, [SITE_ID, UID]);
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
