/* verify-building-panel-v3 — Building panel v3 (NEW-1…NEW-6), driven LIVE as the test account, light AND dark.
 *
 * Seeds a THROWAWAY site (a building at 315°, a second building, one default and one user-coloured parking field) through
 * the app's own local-cache path (same as verify-building-panel-v2), opens the Building inspector and walks the owner's
 * NEW-6 checklist on the real canvas model:
 *   (a) the header number box is sized to 1 / 2 digits, renumber works incl. the conflict dialog; lock · ⋯ · ✕ are borderless;
 *   (b) the Footprint boxes (value · unit · ▲▼) type and step, rotation Shift+ArrowUp moves 0.1°, Edit outline sits in the
 *       heading and does not collapse the section;
 *   (c) court + 2 trailer rows + buffer + walk + road on the dock wall read as ONE strip; the legend shows only the kinds
 *       present; piece colours equal the canvas colours;
 *   (d) trailer rows 60 / 55 draw two bands of those depths (row 1 against the court) with the aisle between;
 *   (e) bin the trailer → buffer / walk / road stay and move in; bin a buffer on an end wall → only it goes;
 *   (f) the new default colours on the canvas AND in the export sheet; an element with a user-set colour keeps it;
 *   (g) no "px" and no "Remove + outer" anywhere.
 * The throwaway is ALWAYS deleted and confirmed gone (owner constraint 15). KNOWN-GOOD ARM: the run is VOID unless the
 * untouched header reports "Building 1" and the wall list holds dock · rear · ends · ends.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-building-panel-v3.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-bv3-" + Math.random().toString(36).slice(2, 7);
const siteName = (scheme) => `ZZ BV3 ${RUN.slice(-5)} ${scheme}`;
const idOf = (scheme) => `${RUN}-${scheme}`;
let CUR = null;
const ALL_IDS = [];
const mkSite = (id, name) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [],
  els: [
    { id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 315, z: 1, dock: "single", dockAxis: "x", dockSide: "bottom" },
    { id: "bz2", type: "building", cx: 1700, cy: 400, w: 300, h: 200, rot: 0, z: 2, dock: "single", dockAxis: "x", dockSide: "bottom" },
    { id: "pk1", type: "parking", cx: 600, cy: 1000, w: 260, h: 120, rot: 0, z: 3 },                       // default colour
    { id: "pk2", type: "parking", cx: 1000, cy: 1000, w: 260, h: 120, rot: 0, z: 4, fill: "#654321" },       // a colour the user set
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});
const hex = (rgb) => "#" + (rgb.match(/\d+/g) || []).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
await page.addInitScript(() => { window.__PLANYR_E2E = true; });      // arms window.__plannerExportSvg (read-only) on the next load
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [CUR, UID]);
const els = async () => (await model())?.els || [];
const bldg = async () => (await els()).find((e) => e.id === "bz1");
const kids = async () => (await els()).filter((e) => e.attachedTo === "bz1");
const T = (id) => page.getByTestId(id);
const rowByRole = (role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await T(`wall-add-${key}`).click(); await sleep(450); };
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }
const fillOf = (id) => page.evaluate((i) => { const g = document.querySelector(`[data-el-id="${i}"]`); const r = g && g.querySelector("rect, path, polygon"); return r ? (r.getAttribute("fill") || "").toLowerCase() : null; }, id);

async function openScenario(scheme) {
  CUR = idOf(scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.evaluate(() => { window.__PLANYR_E2E = true; });          // same-document hash nav never re-runs the init script; the hook effect re-reads this flag every render
  await page.getByText(siteName(scheme), { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 }); // the list is still reordering as 70+ sites load, so a driver click never sees a "stable" row
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-building-panel-v3");
  await page.waitForSelector('[data-el-id="bz1"]', { timeout: 20000 }).catch(async (e) => { if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/missing-${scheme}.png` }).catch(() => {}); throw new Error("VOID run — the seeded building never rendered (" + scheme + "); url " + page.url() + " :: " + e.message.split("\n")[0]); });
  const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const num = await page.getByLabel("Building number").inputValue();
  if (num !== "1") throw new Error("VOID run — the instrument did not see the header");
}

try {
  const seeded = {};
  for (const scheme of ["light", "dark"]) { const id = idOf(scheme); ALL_IDS.push(id); seeded[id] = mkSite(id, siteName(scheme)); }
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  for (const scheme of ["light", "dark"]) {
    console.log(`\n=== ${scheme.toUpperCase()} ===`);
    await openScenario(scheme);
    const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
    ok(`[${scheme}] known-good: the wall list holds dock · rear · ends · ends`, JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
    if (roles.length !== 4) throw new Error("VOID run — wall rows missing");
    ok(`[${scheme}] the section is titled "Docks & walls"`, (await page.getByRole("button", { name: /Docks & walls/ }).count()) === 1);

    // ---- (a) header ----
    const num = page.getByLabel("Building number");
    const w1 = (await num.boundingBox()).width;
    const tok = await page.evaluate(() => { const p = (v) => { const d = document.createElement("i"); d.style.color = `var(${v})`; document.documentElement.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }; return { strong: p("--border-strong"), faint: p("--border-default") }; });
    const st = await num.evaluate((el) => ({ bc: getComputedStyle(el).borderTopColor, h: el.getBoundingClientRect().height }));
    ok(`[${scheme}] number box: the STRONGER outline token, small (height ${Math.round(st.h)})`, st.bc === tok.strong && st.bc !== tok.faint && st.h <= 24);
    await num.fill("12"); await num.press("Enter"); await sleep(500);
    const w2 = (await num.boundingBox()).width;
    ok(`[${scheme}] the box grows for two digits (${Math.round(w1)} → ${Math.round(w2)}) and renumber took (box reads 12)`, w2 > w1 && (await num.inputValue()) === "12");
    await num.fill("1"); await num.press("Enter"); await sleep(400);
    await num.fill("2"); await num.press("Enter"); await sleep(500);
    const conflict = T("bldg-num-conflict");
    ok(`[${scheme}] renumbering onto Building 2 raises the conflict dialog`, (await conflict.count()) === 1 && /belongs to Building 2/.test(await conflict.innerText()));
    if (await T("bldg-num-cancel").count()) await T("bldg-num-cancel").click();
    await sleep(300);
    const bare = [];
    for (const id of ["building-lock", "building-more", "building-close"]) { const x = await T(id).evaluate((el) => { const c = getComputedStyle(el); return { bw: parseFloat(c.borderTopWidth), bg: c.backgroundColor }; }); bare.push(x.bw === 0 && x.bg === "rgba(0, 0, 0, 0)"); }
    ok(`[${scheme}] lock · ⋯ · ✕ are borderless with no resting background`, bare.every(Boolean), JSON.stringify(bare));
    if (SHOTS) await T("building-header").screenshot({ path: `${SHOTS}/${scheme}-header.png` }).catch(() => {});

    // ---- (b) footprint ----
    const frames = await Promise.all(["footprint-length", "footprint-depth", "footprint-rotation"].map((id) => T(id).locator("xpath=ancestor::*[@data-numbox][1]")));
    const shape = [];
    for (const f of frames) shape.push((await f.locator("[data-num-stepper] button").count()) === 2 && parseFloat(await f.evaluate((el) => getComputedStyle(el).borderTopWidth)) >= 1);
    ok(`[${scheme}] Length · Depth · Rotation are ONE bordered box each with stacked ▲▼`, shape.every(Boolean));
    const len = T("footprint-length"); const l0 = Math.round((await bldg()).w);
    await len.fill(String(l0 + 10)); await len.press("Enter"); await sleep(600);
    await frames[0].getByRole("button", { name: "Increase" }).click(); await sleep(600);
    ok(`[${scheme}] Length types and steps (${l0} → ${Math.round((await bldg()).w)})`, Math.round((await bldg()).w) === l0 + 11);
    const rot = T("footprint-rotation"); const r0 = (await bldg()).rot;
    await rot.focus(); await page.keyboard.press("Shift+ArrowUp"); await sleep(600);
    const r1 = (await bldg()).rot;
    ok(`[${scheme}] rotation Shift+ArrowUp moves 0.1° (${r0} → ${r1})`, Math.abs(r1 - r0 - 0.1) < 0.011);
    await rot.fill("315"); await rot.press("Enter"); await sleep(600);
    const head = page.getByRole("button", { name: /Footprint/ });
    await T("edit-outline").click(); await sleep(500);
    ok(`[${scheme}] Edit outline in the heading started the outline edit and left the section open`, (await head.getAttribute("aria-expanded")) === "true" && !!((await bldg()).points || (await bldg()).footEdit));
    await page.keyboard.press("Control+z"); await sleep(600);

    // ---- (c) the dock wall as ONE strip ----
    const dock = rowByRole("dock").first();
    for (const key of ["court", "trailer", "buffer", "sidewalk", "road"]) await addLayer(dock, key);
    const one = await dock.evaluate((el) => { const sb = el.querySelector('[data-testid="wall-strip"]').getBoundingClientRect(), rb = el.getBoundingClientRect(), hb = el.querySelector('[data-testid="wall-row-head"]').getBoundingClientRect(); return sb.top >= hb.top - 4 && sb.bottom <= rb.bottom + 1; });
    ok(`[${scheme}] five layers on the dock wall read as ONE line (a strip, never wrapping chips)`, (await dock.getByTestId("wall-piece").count()) === 5 && one);
    const kindsOnLegend = await T("wall-legend").getByTestId("wall-legend-item").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
    ok(`[${scheme}] the legend shows only the kinds present (${kindsOnLegend.join(" · ")})`, JSON.stringify(kindsOnLegend) === JSON.stringify(["court", "trailer", "buffer", "sidewalk", "road"]));
    const pieceBg = await dock.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => [x.getAttribute("data-kind"), getComputedStyle(x).backgroundColor]));
    const kidsNow = await kids();
    const want = { court: kidsNow.find((k) => k.truckCourt), trailer: kidsNow.find((k) => k.type === "trailer"), buffer: kidsNow.find((k) => k.buffer), sidewalk: kidsNow.find((k) => k.type === "sidewalk"), road: kidsNow.find((k) => k.type === "road") };
    const canvasFill = {}; for (const [k, e] of Object.entries(want)) canvasFill[k] = e ? await fillOf(e.id) : null;
    ok(`[${scheme}] every piece is its canvas colour`, pieceBg.every(([k, bg]) => canvasFill[k] && hex(bg) === canvasFill[k]), JSON.stringify({ pieceBg: pieceBg.map(([k, bg]) => [k, hex(bg)]), canvasFill }));
    await dock.getByTestId("wall-piece").nth(1).click(); await sleep(300);
    ok(`[${scheme}] the selected piece's kind is bold in the legend and its edit box is one line (no wall name / total / ✕)`, (await T("wall-legend-item").nth(1).getAttribute("data-selected")) === "1" && !/total|deep|Remove \+|Truck court/.test(await T("wall-edit-box").innerText()));

    // ---- (d) rows 60 / 55 ----
    const rows = page.getByLabel("Trailer rows", { exact: true }); await rows.fill("2"); await rows.press("Enter"); await sleep(600);
    const r1f = page.getByLabel("Trailer row 1 depth"), r2f = page.getByLabel("Trailer row 2 depth");
    await r1f.fill("60"); await r1f.press("Enter"); await sleep(500);
    await r2f.fill("55"); await r2f.press("Enter"); await sleep(700);
    const tz = (await kids()).find((k) => k.type === "trailer");
    ok(`[${scheme}] trailerRowDepths [60, 55], zone 175 deep`, JSON.stringify(tz.trailerRowDepths) === "[60,55]" && Math.round(tz.zd) === 175 && Math.round(tz.h) === 175, JSON.stringify({ d: tz.trailerRowDepths, zd: tz.zd, h: tz.h }));
    const rects = await page.evaluate((id) => [...document.querySelector(`[data-el-id="${id}"]`).querySelectorAll("rect")].map((r) => ({ y: +r.getAttribute("y"), h: +r.getAttribute("height") })), tz.id);
    const zone = rects.reduce((m, r) => (r.h > m.h ? r : m), rects[0]);
    const bands = rects.filter((r) => r.h > zone.h * 0.05 && r.h < zone.h * 0.9).sort((p, q) => p.y - q.y);
    const ppf = zone.h / 175;
    const side = (await bldg()).dockSide || "bottom";
    const [near, far] = side === "bottom" || side === "left" ? [bands[0], bands[1]] : [bands[1], bands[0]];
    ok(`[${scheme}] the canvas draws two bands of 60 and 55 with a 60 aisle between, the 60 against the court`, bands.length === 2 && Math.abs(near.h / ppf - 60) < 0.6 && Math.abs(far.h / ppf - 55) < 0.6 && Math.abs((bands[1].y - (bands[0].y + bands[0].h)) / ppf - 60) < 0.6, JSON.stringify({ n: bands.length, near: near && near.h / ppf, far: far && far.h / ppf }));
    ok(`[${scheme}] the strip label stays ×2`, /×2/.test(await dock.getByTestId("wall-piece").nth(1).innerText()));
    if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/${scheme}-trailer.png` }).catch(() => {});

    // ---- (e) the bin ----
    const bb = await bldg();
    const dist = (k) => Math.hypot(k.cx - bb.cx, k.cy - bb.cy);   // layers sit on the wall's normal through the building centre
    const before = (await kids()); const get = (list, f) => list.find(f);
    const b0 = { buf: get(before, (k) => k.buffer), walk: get(before, (k) => k.type === "sidewalk"), road: get(before, (k) => k.type === "road") };
    await page.keyboard.press("Escape");
    await dock.getByTestId("wall-piece").nth(1).click(); await sleep(250);
    await T("wall-piece-remove").click(); await sleep(900);
    const after = await kids();
    const a0 = { buf: get(after, (k) => k.buffer), walk: get(after, (k) => k.type === "sidewalk"), road: get(after, (k) => k.type === "road") };
    ok(`[${scheme}] bin the trailer: buffer / walk / road stay, keep their depths and move in by the trailer's depth`, !get(after, (k) => k.type === "trailer") && a0.buf && a0.walk && a0.road
      && a0.buf.zd === b0.buf.zd && a0.walk.zd === b0.walk.zd && a0.road.zd === b0.road.zd
      && Math.abs((dist(b0.buf) - dist(a0.buf)) - 175) < 1.5, JSON.stringify({ moved: dist(b0.buf) - dist(a0.buf) }));
    await page.keyboard.press("Control+z"); await sleep(800);
    ok(`[${scheme}] one undo brings the trailer back`, !!(await kids()).find((k) => k.type === "trailer"));
    const ends = rowByRole("ends").first();
    await addLayer(ends, "sidewalk"); await addLayer(ends, "buffer");
    const nBefore = (await kids()).length;
    await T("wall-piece-remove").click(); await sleep(900);     // the new layer's box is open: bin the buffer
    const nAfter = (await kids()).length;
    ok(`[${scheme}] bin a buffer on an end wall: only it goes (${nBefore} → ${nAfter})`, nAfter === nBefore - 1 && (await ends.getByTestId("wall-piece").count()) === 1);

    // ---- (f) colours: canvas + export; a user-set colour keeps ----
    const [pk1, pk2, court] = [await fillOf("pk1"), await fillOf("pk2"), canvasFill.court];
    ok(`[${scheme}] new defaults on the canvas: parking ${pk1}, court ${court}; the user-set parking keeps ${pk2}`, pk1 === "#d6e5f2" && court === "#d5d9de" && pk2 === "#654321");
    const svg = await page.evaluate(async () => (window.__plannerExportSvg ? String(await window.__plannerExportSvg()) : ""));
    const low = svg.toLowerCase();
    ok(`[${scheme}] the export sheet carries the same colours (new defaults present, retired ones absent, user colour kept)`, low.includes("#d6e5f2") && low.includes("#d5d9de") && low.includes("#654321") && !/#d6d1c7|#cdd7dd|#b9b4a8|#eceae3/.test(low), `len ${svg.length}`);

    // ---- (g) no px, no "Remove + outer" ----
    const panelText = await T("property-panel").innerText();
    ok(`[${scheme}] no "px" and no "Remove + outer" anywhere in the inspector`, !/\bpx\b/.test(panelText) && !panelText.includes("Remove + outer"));
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  const gone = await page.evaluate(async ([ids, uid]) => {
    let all = true;
    for (const id of ids) {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      if (q.error || (q.data || []).length) all = false;
    }
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((id) => delete m[id]); localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return all;
  }, [ALL_IDS, UID]).catch(() => false);
  ok("throwaway sites deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
