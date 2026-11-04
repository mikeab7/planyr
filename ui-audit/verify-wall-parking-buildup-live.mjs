/* verify-wall-parking-buildup-live — NEW-1/2/3 (2026-11-04), recurrence of B2641728 (V2086400 passed 53/53 yet the real gap stayed open:
 * it asserted the DESIGNED sequence). Driven LIVE as the test account (`Verify: live`) on THROWAWAY sites (deleted and confirmed gone):
 * a REAL BUILD-UP on an end wall — sidewalk, parking, rows to eight, a buffer, more parking — reading, after EVERY click, each layer's
 * interval along the wall's outward normal from the stored plan (no overlap; the buffer stays outermost and moves out by exactly what
 * the field grew), the stored row + stall count against the pure carStalls, and the panel's own row count; the lead button + the ▾ for
 * each wall state vs an INDEPENDENT list of the sensible layers; the icon control (a plus + the layer's swatch, no word; aria-label
 * carries the full name); and that no Docks & walls surface says "Walk".
 * KNOWN-GOOD ARM: VOID unless the wall list is dock - rear - ends - ends and the header reads "Building 1".
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=... [ROT=0|315] node ui-audit/verify-wall-parking-buildup-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { addWallLayer } from "./lib/wallLayerDrive.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-wpb-" + Math.random().toString(36).slice(2, 7);
const siteName = (tag) => `ZZ WPB ${RUN.slice(-5)} ${tag}`;
const idOf = (tag) => `${RUN}-${tag}`;
let CUR = null;
const ALL_IDS = [];
const mkSite = (id, name, b) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [{ id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 0, z: 1, ...b }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }]] });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [CUR, UID]);
const els = async () => (await model())?.els || [];
const bldg = async () => (await els()).find((e) => e.id === "bz1");
const T = (id) => page.getByTestId(id);
const rowByRole = (role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const named = (row) => row.getByTestId("wall-add");
// NEW-2 (2026-11-04): the lead button is a plus + the layer's icon, no word — read its kind (data-kind) and spell the old words from it.
const KIND_WORD = { court: "Truck court", trailer: "Trailer", buffer: "Buffer", sidewalk: "Walk", parking: "Parking", road: "Road" };
const nameText = async (row) => "+ " + (KIND_WORD[await named(row).getAttribute("data-kind")] || "?");
const kinds = (row) => row.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }

const sideOf = (h, e) => {
  const r = (h.rot * Math.PI) / 180, dx = e.cx - h.cx, dy = e.cy - h.cy, lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
  const ox = Math.abs(lx) - h.w / 2, oy = Math.abs(ly) - h.h / 2;
  return oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left");
};
const KIND_TEST = {
  court: (e) => !!e.truckCourt, trailer: (e) => e.type === "trailer", buffer: (e) => e.type === "landscape" && !e.sidewalkSide,
  sidewalk: (e) => e.type === "sidewalk" || (e.type === "landscape" && !!e.sidewalkSide), parking: (e) => e.type === "parking" && !!e.sideParkSide, road: (e) => e.type === "road",
};
const layerEl = async (side, kind, nth = 0) => { const h = await bldg(); return (await els()).filter((e) => e.attachedTo === "bz1" && !e.dogEar && KIND_TEST[kind](e) && sideOf(h, e) === side)[nth]; };

async function openScenario(tag) {
  CUR = idOf(tag);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText(siteName(tag), { exact: false }).filter({ visible: true }).first().click({ timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-wall-parking-buildup-live");
  await page.waitForSelector('[data-el-id="bz1"]', { timeout: 20000 });
  await openBuildingPanel();
}
async function openBuildingPanel() {
  const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const num = await T("building-header").getByRole("textbox", { name: "Building number" }).inputValue();
  if (num !== "1") throw new Error("VOID run — the instrument did not see the header");
}
async function reopenBuildingPanel() {
  const b = await bldg();
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 0.8), [b.cx, b.cy]);
  await sleep(300);
  const box = await T("planner-canvas").boundingBox();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await T("building-header").waitFor({ timeout: 10000 });
}

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a); return { x: x * c - y * sn, y: x * sn + y * c }; };
const lead = (row) => row.getByTestId("wall-add");
// Close an open edit box — and ONLY that: an Escape with nothing open deselects the building (the panel under test goes with it).
const closeBox = async () => { if (await T("wall-edit-box").count()) { await page.keyboard.press("Escape"); await sleep(250); } };
const leadKind = async (row) => ((await lead(row).count()) ? lead(row).getAttribute("data-kind") : null);
async function moreKinds(row) {
  if (!(await row.getByTestId("wall-add-more").count())) return [];
  await row.getByTestId("wall-add-more").click(); await sleep(250);
  const ks = await page.getByTestId("wall-add-menu").getByRole("menuitem").evaluateAll((n) => n.map((x) => (x.getAttribute("data-testid") || "").replace("wall-add-", "")));
  await page.keyboard.press("Escape"); await sleep(250);
  return ks;
}
const offered = async (row) => { const l = await leadKind(row); return l ? [l, ...(await moreKinds(row))] : []; };
async function wallLayers(side) {
  const all = await els(), b = all.find((e) => e.id === "bz1");
  const [nx, ny] = SIDE_N[side], isH = ny !== 0, sg = isH ? ny : nx, face = (isH ? b.h : b.w) / 2, out = [];
  for (const x of all) {
    if (x.attachedTo !== b.id || x.dogEar || x.points || !["sidewalk", "landscape", "parking", "paving", "road", "trailer"].includes(x.type) || x.truckCourt || x.forCourt || x.forTrailer) continue;
    const l = rot2(x.cx - b.cx, x.cy - b.cy, -b.rot), rel = ((((x.rot || 0) - b.rot) % 360) + 360) % 360, cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
    const dx = cross ? x.h : x.w, dy = cross ? x.w : x.h, depth = isH ? dy : dx, mid = sg * (isH ? l.y : l.x) - face;
    if (mid - depth / 2 < -0.5 || Math.abs(isH ? l.x : l.y) > ((isH ? b.w : b.h) / 2 + (isH ? dx : dy))) continue;   // outward of THIS wall's face (the other walls' layers project to lo < 0)
    out.push({ id: x.id, type: x.type, buffer: x.type === "landscape" && !x.sidewalkSide, lo: mid - depth / 2, hi: mid + depth / 2, depth, el: x });
  }
  return out.sort((a, c) => a.lo - c.lo);
}
const overlapFree = (ls) => ls.every((l, i) => i === 0 || l.lo >= ls[i - 1].hi - 0.5);
const flushOutside = (ls) => { const parkHi = Math.max(0, ...ls.filter((l) => l.type === "parking").map((l) => l.hi)); return ls.filter((l) => l.buffer || l.type === "road").every((f) => f.lo >= parkHi - 0.5); };
const parkRows = (h, sd, ai) => { const mod = 2 * sd + ai, m = Math.floor((h + 1e-6) / mod), rem = h - m * mod; return Math.max(1, 2 * m + (rem >= sd - 1e-6 ? 1 : 0)); };
async function facts(side) {
  const m = await model(), st = m.settings || {}, ls = await wallLayers(side), pads = ls.filter((l) => l.type === "parking");
  const sd = st.stallDepth || 18, ai = st.aisle ?? 24;
  return { rows: pads.reduce((t, p) => t + parkRows(p.el.h, (p.el.cfg || {}).stallDepth || sd, (p.el.cfg || {}).aisle ?? ai), 0), pads: pads.length };
}
const panelRows = async (row) => { const p = row.locator('[data-testid="wall-piece"][data-kind="parking"]'); if (!(await p.count())) return 0; return Number(/(\d+) rows?/.exec(await p.getAttribute("aria-label"))[1]); };
const SENSIBLE = (have) => (have.includes("road") ? [] : [...(have.includes("sidewalk") ? [] : ["sidewalk"]), "parking", "trailer", "buffer", "road"]);

try {
  const seeded = {};
  const ROTS = (process.env.ROT ? [Number(process.env.ROT)] : [0, 315]).map((r) => [`r${r}`, r]);
  for (const [tag, rot] of ROTS) { const id = idOf(tag); ALL_IDS.push(id); seeded[id] = mkSite(id, siteName(tag), { dock: "single", dockAxis: "x", dockSide: "bottom", rot }); }
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  for (const [tag, rot] of ROTS) {
    console.log(`\n=== rot ${rot} ===`);
    // The seed is a local cache write; the app's own cloud load can drop it before the plan opens (the "project doesn't exist" card) — reseed and retry.
    for (let attempt = 1; ; attempt++) {
      try { await openScenario(tag); break; }
      catch (e) {
        if (attempt >= 4) throw e;
        console.log(`(startup attempt ${attempt} lost the seed race: ${e.message.split("\n")[0]} — reseeding)`);
        await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
      }
    }
    const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
    ok(`[${tag}] known-good: the wall list holds dock · rear · ends · ends`, JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
    const dock = rowByRole("dock").first(), rear = rowByRole("rear").first(), end0 = rowByRole("ends").nth(0), end1 = rowByRole("ends").nth(1);
    const side0 = (await end0.getAttribute("data-sides")).split(",")[0];
    // ---- NEW-2: icons, not words — before anything is added
    { const b = lead(end0);
      ok(`[${tag}] the add control is a plus and the layer's own swatch, no word`, (await b.innerText()).replace(/\s/g, "") === "+" && (await b.getByTestId("wall-add-swatch").getAttribute("data-kind")) === "sidewalk");
      ok(`[${tag}] the full name is in aria-label and title`, /^Add sidewalk to the End wall/.test(await b.getAttribute("aria-label")) && (await b.getAttribute("title")) === "Add sidewalk to this wall", await b.getAttribute("aria-label")); }
    // ---- the REAL BUILD-UP on end wall 0
    await addWallLayer(page, end0, "sidewalk");
    ok(`[${tag}] after the sidewalk the lead is parking`, (await leadKind(end0)) === "parking");
    await addWallLayer(page, end0, "parking"); await sleep(500);
    let f = await facts(side0);
    ok(`[${tag}] first parking row: 1 row stored, panel says 1, no overlap`, f.rows === 1 && (await panelRows(end0)) === 1 && overlapFree(await wallLayers(side0)), JSON.stringify(f));
    let good = true, detail = "";
    for (let n = 2; n <= 8; n++) {
      if ((await leadKind(end0)) !== "parking") { good = false; detail = `lead before row ${n} = ${await leadKind(end0)}`; break; }
      await lead(end0).click(); await sleep(450);
      const ls = await wallLayers(side0); f = await facts(side0);
      const boxOpen = (await T("wall-edit-box").count()) && (await T("wall-edit-box").getAttribute("data-kind")) === "parking" && (await T("wall-parking-rows").inputValue()) === String(n);
      if (f.rows !== n || (await panelRows(end0)) !== n || !overlapFree(ls) || !boxOpen) { good = false; detail = `row ${n}: stored ${f.rows}, panel ${await panelRows(end0)}, overlap-free ${overlapFree(ls)}, box ${!!boxOpen}`; break; }
    }
    ok(`[${tag}] the lead adds ONE row per click up to eight (stored + panel agree, no overlap, Rows box opens ready)`, good, detail);
    await addWallLayer(page, end0, "buffer"); await sleep(500);
    let ls = await wallLayers(side0); const buf0 = ls.find((l) => l.buffer), parkHi0 = Math.max(...ls.filter((l) => l.type === "parking").map((l) => l.hi));
    ok(`[${tag}] buffer added beyond the parking; the lead moves on to Road and parking waits in the ▾`, overlapFree(ls) && flushOutside(ls) && (await leadKind(end0)) === "road" && (await moreKinds(end0)).includes("parking"));
    await addWallLayer(page, end0, "parking"); await sleep(600);
    ls = await wallLayers(side0); f = await facts(side0);
    const buf1 = ls.find((l) => l.buffer), parkHi1 = Math.max(...ls.filter((l) => l.type === "parking").map((l) => l.hi));
    ok(`[${tag}] more parking beside a buffer: 9 rows, the buffer pushed out by exactly what the field grew (${(buf1.lo - buf0.lo).toFixed(1)} vs ${(parkHi1 - parkHi0).toFixed(1)}), no overlap, still outermost`,
      f.rows === 9 && overlapFree(ls) && flushOutside(ls) && Math.abs((buf1.lo - buf0.lo) - (parkHi1 - parkHi0)) < 1 && Math.abs(buf1.depth - buf0.depth) < 0.5 && (await panelRows(end0)) === 9, JSON.stringify(f));
    await closeBox();
    // ---- a buffer between the walk and the lot (rear wall): parking offered, leads, buffer stays outermost
    const sideR = (await rear.getAttribute("data-sides")).split(",")[0];
    await addWallLayer(page, rear, "sidewalk"); await addWallLayer(page, rear, "buffer"); await sleep(400);
    ok(`[${tag}] rear: sidewalk > buffer → parking leads`, (await leadKind(rear)) === "parking" && (await moreKinds(rear)).includes("trailer"));
    await lead(rear).click();
    const rearKinds = () => rear.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind"))).then(JSON.stringify);
    await waitFor(async () => (await rearKinds()) === '["sidewalk","parking","buffer"]' && (await wallLayers(sideR)).filter((l) => l.type === "parking").length === 1, 8000);
    ls = await wallLayers(sideR);
    ok(`[${tag}] rear: parking added to sidewalk > buffer, no overlap, buffer outermost`, overlapFree(ls) && flushOutside(ls) && ls.filter((l) => l.type === "parking").length === 1 && (await rearKinds()) === '["sidewalk","parking","buffer"]', await rearKinds() + " " + JSON.stringify(ls.map((l) => [l.type, +l.lo.toFixed(1), +l.hi.toFixed(1)])));
    await closeBox();
    // ---- wall-state offers vs the independent list (states reached by real clicks on the other end wall, then the dock wall)
    const sideE1 = (await end1.getAttribute("data-sides")).split(",")[0];
    const stateOffer = async (name, row, build) => {
      for (const k of build) await addWallLayer(page, row, k);
      await closeBox();
      const have = await row.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
      const got = await offered(row), want = SENSIBLE(have);
      ok(`[${tag}] state "${name}" [${have.join(" > ") || "empty"}] offers ${JSON.stringify(got)}`, JSON.stringify(got.slice().sort()) === JSON.stringify(want.slice().sort()) && overlapFree(await wallLayers(sideE1)));
    };
    await stateOffer("empty", end1, []);
    await stateOffer("sidewalk", end1, ["sidewalk"]);
    await stateOffer("sidewalk > parking", end1, ["parking"]);
    await stateOffer("sidewalk > parking > buffer", end1, ["buffer"]);
    await stateOffer("sidewalk > parking > buffer > road", end1, ["road"]);
    const dseq = [[[], "court"], [["court"], "trailer"], [["court", "trailer"], "buffer"], [["court", "trailer", "buffer"], "sidewalk"]];
    for (const [have, want] of dseq) {
      const got = await offered(dock);
      ok(`[${tag}] dock wall [${have.join(" > ") || "empty"}] leads with ${want}`, got[0] === want && JSON.stringify(await dock.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")))) === JSON.stringify(have), JSON.stringify(got));
      await lead(dock).click(); await sleep(400);
    }
    // ---- NEW-3: no Walk anywhere in Docks & walls
    const text = await page.evaluate(() => { const h = document.querySelector('[data-testid="building-header"]'); let n = h; for (let i = 0; i < 6 && n && !n.querySelector('[data-testid="wall-legend"]'); i++) n = n.parentElement; return n ? n.innerText : ""; });
    const labels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="wall-"]')].map((n) => (n.getAttribute("aria-label") || "") + " " + (n.getAttribute("title") || "")).join(" | "));
    ok(`[${tag}] no Docks & walls surface says "Walk"`, !/\bWalk\b/.test(text) && !/\bWalk\b/.test(labels) && /Sidewalk/.test(text));
    // ---- one line at desktop and phone width
    for (const [label, w] of [["desktop", 1440], ["phone", 390]]) {
      await page.setViewportSize({ width: w, height: 900 }); await sleep(500);
      const m = await page.evaluate(() => [...document.querySelectorAll('[data-testid="wall-row"]')].map((r) => { const line = r.firstElementChild, add = r.querySelector('[data-testid="wall-add-group"]'); const lr = line.getBoundingClientRect(), ar = add && add.getBoundingClientRect(); return { h: Math.round(lr.height), inside: ar ? ar.right <= lr.right + 0.5 : true }; }));
      ok(`[${tag}] every row stays one line and the control fits at ${label} width`, m.every((r) => r.h <= 34 && r.inside), JSON.stringify(m));
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-parking-buildup-${tag}.png` }).catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
  try { if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-parking-buildup-failure.png` }); } catch (e2) { console.error("could not screenshot:", e2.message); }
} finally {
  const gone = await page.evaluate(async ([ids]) => {
    let all = true;
    for (const id of ids) {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      if (q.error || (q.data || []).length) all = false;
    }
    return all;
  }, [ALL_IDS]).catch(() => false);
  ok("throwaway sites deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
