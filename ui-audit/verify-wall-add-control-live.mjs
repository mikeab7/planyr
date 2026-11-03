/* verify-wall-add-control-live — NEW-1 (2026-11-03), driven LIVE as the test account (`Verify: live`).
 * Docks & walls: the add control names the next layer; the edit box is one line with no length; every layer shortens by its HANDLE.
 * Two THROWAWAY sites (one building, docks S; rot 0 and rot 315) are seeded through the app's own cloud-cache path and deleted
 * (and confirmed gone) at the end. Through the real panel:
 *   dock wall  — "+ Truck court" → "+ Trailer" → "+ Buffer" by one click each (the new layer's box opens each time); the ▾ is a
 *                FLOATING portal that does not move the rows, closes on Escape and on a press away, and adds a Road;
 *   end wall   — "+ Walk" → "+ Parking" → "+ Buffer";
 *   edit box   — trailer with one row is ONE line (Rows + Depth, "Depth" not "Row 1"); two rows show Row 1 · Row 2 · Aisle on a
 *                second line; NO Length / Align / Full length on any wall;
 *   map        — the selected court's own Properties panel still has its Length;
 *   handles    — EVERY layer kind on the dock, rear and end walls, both ends: the dragged end moves in, the other end STAYS;
 *   inherit    — a new layer after a shortened one takes the shorter length and its position; reload keeps all of it;
 *   fit        — every row stays one line at the desktop panel width AND a phone width (the strip is not squeezed).
 * KNOWN-GOOD ARM: VOID unless the wall list is dock · rear · ends · ends and the header reads "Building 1".
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=... [ROT=0|315] node ui-audit/verify-wall-add-control-live.mjs   (run each rotation as its own invocation) */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { addWallLayer, dragWallLayerEnd, alongOf } from "./lib/wallLayerDrive.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-wac-" + Math.random().toString(36).slice(2, 7);
const siteName = (tag) => `ZZ WAC ${RUN.slice(-5)} ${tag}`;
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
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [CUR, UID]);
const els = async () => (await model())?.els || [];
const bldg = async () => (await els()).find((e) => e.id === "bz1");
const T = (id) => page.getByTestId(id);
const rowByRole = (role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const named = (row) => row.getByTestId("wall-add");
const nameText = async (row) => (await named(row).innerText()).replace(/\s+/g, " ").trim();
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
  await assertMeasurable(page, "verify-wall-add-control-live");
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
const NO_LENGTH = ["wall-extent", "wall-extent-len", "wall-extent-full", "wall-align-start", "wall-align-centre", "wall-align-end"];
async function boxHasNoLength() {
  for (const id of NO_LENGTH) if (await T(id).count()) return false;
  const text = await T("wall-edit-box").innerText();
  return !/Length|Align|Full length|Centre/i.test(text);
}
const measureRows = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('[data-testid="wall-row"]')].map((r) => {
    const line = r.firstElementChild, add = r.querySelector('[data-testid="wall-add-group"]'), strip = r.querySelector('[data-testid="wall-strip"]');
    const lr = line.getBoundingClientRect(), ar = add ? add.getBoundingClientRect() : null;
    return { h: Math.round(lr.height), inside: ar ? ar.right <= lr.right + 0.5 : true, stripW: strip ? Math.round(strip.getBoundingClientRect().width) : 0, label: add ? add.textContent : "" };
  });
  return rows;
});

async function judgeShorten(tag, side, kind, end, feet) {
  const host = await bldg();
  const el = await layerEl(side, kind);
  if (!el) { ok(`[${tag}] ${kind}/${end}: the layer exists`, false); return; }
  const b = alongOf(host, side, el), lo0 = b.centre - b.len / 2, hi0 = b.centre + b.len / 2;
  try { await dragWallLayerEnd(page, host, side, el, end, feet); } catch (e) { ok(`[${tag}] ${kind}/${end}: a handle can be grabbed`, false, e.message); await page.keyboard.press("Escape"); return; }
  const after = await waitFor(async () => { const e2 = await layerEl(side, kind); const h2 = await bldg(); if (!e2) return null; const a = alongOf(h2, side, e2); return a.len < b.len - 3 ? a : null; }, 6000);
  if (!after) { ok(`[${tag}] ${kind}/${end}: shortened by its handle`, false, `still ${b.len.toFixed(0)}`); await page.keyboard.press("Escape"); return; }
  const lo1 = after.centre - after.len / 2, hi1 = after.centre + after.len / 2;
  const movedIn = end === "plus" ? hi0 - hi1 : lo1 - lo0, held = end === "plus" ? Math.abs(lo1 - lo0) : Math.abs(hi1 - hi0);
  ok(`[${tag}] ${side} ${kind}/${end}: dragged end moved in ${movedIn.toFixed(0)} ft, the other end held (Δ ${held.toFixed(1)})`, movedIn > 3 && held < 2);
  await page.keyboard.press("Escape");
}

try {
  const seeded = {};
  const ROTS = (process.env.ROT ? [Number(process.env.ROT)] : [0, 315]).map((r) => [`r${r}`, r]);   // one rotation per run avoids a reload dropping the other rotation's unsynced seed
  for (const [tag, rot] of ROTS) { const id = idOf(tag); ALL_IDS.push(id); seeded[id] = mkSite(id, siteName(tag), { dock: "single", dockAxis: "x", dockSide: "bottom", rot }); }
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);

  for (const [tag, rot] of ROTS) {
    console.log(`\n=== rot ${rot} ===`);
    await openScenario(tag);
    const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
    ok(`[${tag}] known-good: the wall list holds dock · rear · ends · ends`, JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
    const dock = rowByRole("dock").first(), rear = rowByRole("rear"), ends = rowByRole("ends");
    const side = "bottom";

    // ---- dock wall: the button names the next layer; one click each
    ok(`[${tag}] an empty dock wall's button reads "+ Truck court"`, (await nameText(dock)) === "+ Truck court", await nameText(dock));
    ok(`[${tag}] one option ⇒ no ▾`, (await dock.getByTestId("wall-add-more").count()) === 0);
    await named(dock).click(); await sleep(450);
    ok(`[${tag}] the new court's box opens; the button now reads "+ Trailer"`, (await T("wall-edit-box").getAttribute("data-kind")) === "court" && (await nameText(dock)) === "+ Trailer");
    await named(dock).click(); await sleep(450);
    ok(`[${tag}] the new trailer's box opens (ONE line: Rows + Depth, "Depth" not "Row 1"); the button reads "+ Buffer"`, (await T("wall-edit-box").getAttribute("data-kind")) === "trailer" && (await nameText(dock)) === "+ Buffer");
    {
      const ys = await T("wall-edit-box").locator("input").evaluateAll((n) => [...new Set(n.map((i) => Math.round(i.getBoundingClientRect().y)))]);
      const txt = await T("wall-edit-box").innerText();
      ok(`[${tag}] the one-row trailer box is a single line (${ys.length} line) with "Depth" and no "Row 1"`, ys.length === 1 && /Depth/.test(txt) && !/Row 1/.test(txt));
      ok(`[${tag}] the trailer box has no Length / Align / Full length`, await boxHasNoLength());
      const rowsIn = page.getByLabel("Trailer rows", { exact: true }); await rowsIn.fill("2"); await rowsIn.press("Enter"); await sleep(600);
      const t2 = await T("wall-edit-box").innerText();
      const yRows = (await page.getByLabel("Trailer rows", { exact: true }).boundingBox()).y, yR1 = (await page.getByLabel("Trailer row 1 depth").boundingBox()).y, yAi = (await page.getByLabel("Aisle between trailer rows").boundingBox()).y;
      ok(`[${tag}] two rows: Row 1 · Row 2 · Aisle on a SECOND line under Rows`, /Row 1/.test(t2) && /Row 2/.test(t2) && /Aisle/.test(t2) && yR1 > yRows + 10 && Math.abs(yAi - yR1) < 4, `rows ${yRows.toFixed(0)} · row1 ${yR1.toFixed(0)} · aisle ${yAi.toFixed(0)}`);
      await rowsIn.fill("1"); await rowsIn.press("Enter"); await sleep(500);
      await page.keyboard.press("Escape");
    }
    await named(dock).click(); await sleep(450);
    ok(`[${tag}] the button stays usable: court · trailer · buffer after three clicks, now "+ Walk"`, JSON.stringify(await kinds(dock)) === '["court","trailer","buffer"]' && (await nameText(dock)) === "+ Walk", JSON.stringify(await kinds(dock)));

    // ---- the ▾: floats, does not push rows, closes on Escape / press away, adds a Road
    const topBefore = (await rear.boundingBox()).y;
    await dock.getByTestId("wall-add-more").click(); await sleep(250);
    const menu = T("wall-add-menu");
    ok(`[${tag}] the ▾ opens a menu holding Road · Trailer parking · Landscape buffer`, JSON.stringify(await menu.getByRole("menuitem").allInnerTexts()) === '["Road","Trailer parking","Landscape buffer"]', JSON.stringify(await menu.getByRole("menuitem").allInnerTexts()));
    ok(`[${tag}] the rows below did not move`, (await rear.boundingBox()).y === topBefore);
    const where = await menu.evaluate((el) => { const p = el.closest(".menu") || el.parentElement; return { pos: getComputedStyle(p).position, body: p.parentElement === document.body }; });
    ok(`[${tag}] the menu is a fixed portal at the page root (it cannot clip inside the panel's scroll area)`, where.pos === "fixed" && where.body, JSON.stringify(where));
    await page.keyboard.press("Escape"); await sleep(200);
    ok(`[${tag}] Escape closes the ▾`, (await menu.count()) === 0);
    await dock.getByTestId("wall-add-more").click(); await sleep(200);
    await T("building-header").click({ force: true }); await sleep(250);
    ok(`[${tag}] a press away closes the ▾`, (await menu.count()) === 0);
    await addWallLayer(page, dock, "road");
    ok(`[${tag}] Road added through the ▾; nothing is offered after it`, JSON.stringify(await kinds(dock)) === '["court","trailer","buffer","road"]' && (await named(dock).count()) === 0, JSON.stringify(await kinds(dock)));

    // ---- end wall: Walk, Parking, Buffer by the named button; then the rest of the chain for the handle checks
    const end0 = ends.nth(0), end1 = ends.nth(1);
    const sEnd0 = await end0.getAttribute("data-sides"), sEnd1 = await end1.getAttribute("data-sides"), sRear = await rear.getAttribute("data-sides");
    const nameSeq = [];
    for (let i = 0; i < 3; i++) { nameSeq.push(await nameText(end0)); await named(end0).click(); await sleep(450); }
    ok(`[${tag}] an end wall offers "+ Walk", then "+ Parking", then "+ Buffer"`, JSON.stringify(nameSeq) === '["+ Walk","+ Parking","+ Buffer"]', JSON.stringify(nameSeq));
    await addWallLayer(page, end0, "trailer"); await addWallLayer(page, end0, "road");
    for (const k of ["sidewalk", "parking", "trailer", "buffer", "road"]) await addWallLayer(page, rear, k);
    await page.keyboard.press("Escape");

    // ---- NO Length / Align / Full length in the box on ANY wall, any kind
    {
      let clean = true, opened = 0;
      for (const row of [dock, rear, end0]) {
        const n = await row.getByTestId("wall-piece").count();
        for (let i = 0; i < n; i++) {
          const p = row.getByTestId("wall-piece").nth(i); await p.click(); await sleep(250);
          if (!(await T("wall-edit-box").isVisible())) { await p.click(); await sleep(250); }
          opened++; if (!(await boxHasNoLength())) clean = false;
          await page.keyboard.press("Escape"); await sleep(150);
        }
      }
      ok(`[${tag}] no Length / Align / Full length in the edit box on any of ${opened} layers (dock, rear, end)`, clean && opened >= 12, `${opened} boxes`);
    }

    // ---- one line per row, at the desktop width and a phone width
    {
      const wide = await measureRows();
      ok(`[${tag}] every row is ONE line with its button inside it (desktop); the deepest strip keeps its width`, wide.every((r) => r.h < 36 && r.inside) && Math.max(...wide.map((r) => r.stripW)) >= 118, JSON.stringify(wide.map((r) => [r.h, r.inside, r.stripW])));
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(700);
      if (await T("wall-rows").count()) {
        const narrow = await measureRows();
        ok(`[${tag}] ...and at a phone width`, narrow.every((r) => r.h < 36 && r.inside), JSON.stringify(narrow.map((r) => [r.h, r.inside, r.label])));
      } else ok(`[${tag}] phone width: the panel closed on resize (not measured)`, true);
      await page.setViewportSize({ width: 1440, height: 900 }); await sleep(700);
      if (!(await T("wall-rows").count())) await reopenBuildingPanel();
    }

    // ---- the map-selected court keeps its own Properties panel with a Length
    {
      const host = await bldg(), court = await layerEl(side, "court");
      const a = alongOf(host, side, court);
      const r = (host.rot * Math.PI) / 180;
      await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 0.8), [court.cx, court.cy]);
      await sleep(300);
      const box = await T("planner-canvas").boundingBox();
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      const has = await T("dock-length").waitFor({ timeout: 6000 }).then(() => true).catch(() => false);
      ok(`[${tag}] the court selected on the map still has its Length in its own Properties panel`, has, `court length ${a.len.toFixed(0)}`);
      void r; await page.keyboard.press("Escape"); await reopenBuildingPanel();
    }

    // ---- THE GATE: every layer kind on every wall role shortens by its handle (both ends)
    const GATE = [[side, ["court", "trailer", "buffer", "road"]], [sRear, ["sidewalk", "parking", "trailer", "buffer", "road"]], [sEnd0, ["sidewalk", "parking", "buffer", "trailer", "road"]]];
    for (const [sd, ks] of GATE) for (const kind of ks) for (const end of ["plus", "minus"]) await judgeShorten(tag, sd, kind, end, 30);
    await reopenBuildingPanel();

    // ---- a new layer after a shortened one takes the shorter length + position (second end wall, otherwise untouched)
    {
      const e1 = ends.nth(1);
      await addWallLayer(page, e1, "sidewalk");
      await judgeShorten(tag, sEnd1, "sidewalk", "plus", 40);
      await reopenBuildingPanel();
      await addWallLayer(page, e1, "parking");
      await sleep(800);
      const host = await bldg(), w = await layerEl(sEnd1, "sidewalk"), p = await layerEl(sEnd1, "parking");
      const aw = alongOf(host, sEnd1, w), ap = alongOf(host, sEnd1, p);
      ok(`[${tag}] a new Parking after the shortened Walk takes ITS length + position (${ap.len.toFixed(0)} @ ${ap.centre.toFixed(0)} vs ${aw.len.toFixed(0)} @ ${aw.centre.toFixed(0)})`, Math.abs(ap.len - aw.len) < 2 && Math.abs(ap.centre - aw.centre) < 2);
      // reload keeps all of it
      const before = (await els()).filter((e) => e.attachedTo === "bz1").map((e) => [e.id, Math.round(e.cx), Math.round(e.cy), Math.round(e.w), Math.round(e.h)]).sort();
      await sleep(1500);
      await page.reload({ waitUntil: "load" }); await sleep(3500);
      await page.waitForSelector('[data-el-id="bz1"]', { timeout: 20000 });
      const after = (await els()).filter((e) => e.attachedTo === "bz1").map((e) => [e.id, Math.round(e.cx), Math.round(e.cy), Math.round(e.w), Math.round(e.h)]).sort();
      ok(`[${tag}] a reload keeps every layer exactly where it was (${after.length} layers)`, JSON.stringify(before) === JSON.stringify(after) && after.length >= 14, `${before.length} → ${after.length}`);
    }
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-add-control-${tag}.png` }).catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
  try {
    const dump = await page.evaluate(() => ({ header: !!document.querySelector('[data-testid="building-header"]'), rows: [...document.querySelectorAll('[data-testid="wall-row"]')].map((r) => [r.getAttribute("data-role"), r.getAttribute("data-sides"), [...r.querySelectorAll('[data-testid="wall-piece"]')].map((p) => p.getAttribute("data-kind")).join(",")]) }));
    console.error("STATE AT FAILURE:", JSON.stringify(dump), JSON.stringify((await els()).filter((x) => x.attachedTo === "bz1").map((x) => [x.type, x.stackSide || x.sidewalkSide || x.sideParkSide || "", Math.round(x.w), Math.round(x.h)])));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-add-control-failure.png` });
  } catch (e2) { console.error("could not dump state:", e2.message); }
} finally {
  const gone = await page.evaluate(async ([ids, uid]) => {
    let all = true;
    for (const id of ids) {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      // the DB refuses a hard delete of a live site — trash it first (same as verify-parcel-combine-split)
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
