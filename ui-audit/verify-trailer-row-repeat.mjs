/* verify-trailer-row-repeat — B2268800 / V1693936, driven LIVE as the test account.
 * A THROWAWAY site (one building, docks S) is seeded through the app's own cloud-cache path. Through the real Docks & walls
 * strip: Court + Trailer, shorten the trailer to half its length (Start-aligned), add a SECOND trailer row (the + still
 * offers it) and a buffer. Asserts on the saved model: both come in at the shortened trailer's LENGTH and POSITION at their
 * OWN default depths, rows are adjacent, editing the new row's length leaves row 1 alone, and a reload keeps it all — at
 * rot 0 and 315. KNOWN-GOOD ARM: VOID unless the header reads "Building 1" and the wall list is dock · rear · ends · ends.
 * Throwaway always deleted and confirmed gone.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=... node ui-audit/verify-trailer-row-repeat.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-trr-" + Math.random().toString(36).slice(2, 7);
const SCEN0 = { single: { dock: "single", dockAxis: "x", dockSide: "bottom" }, cross: { dock: "cross", dockAxis: "x" }, bump: { dock: "single", dockAxis: "x", dockSide: "bottom" }, trailer: { dock: "single", dockAxis: "x", dockSide: "bottom" } };
const siteName = (scheme, tag) => `ZZ TRR ${RUN.slice(-5)} ${scheme} ${tag}`;
const idOf = (scheme, tag) => `${RUN}-${scheme}-${tag}`;
let CUR = null;                                    // the scenario site currently open
const ALL_IDS = [];
const mkSite = (id, name, b) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], els: [{ id: "bz1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 315, z: 1, ...b }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [CUR, UID]);
const bldg = async () => ((await model())?.els || []).find((e) => e.id === "bz1");
const kids = async () => ((await model())?.els || []).filter((e) => e.attachedTo === "bz1");
const T = (id) => page.getByTestId(id);
const wall = (side) => page.locator(`[data-testid="loading-wall-picker"] [data-wall="${side}"]`);
const rowByRole = (role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
const addLayer = async (r, key) => { await r.getByTestId("wall-add").click(); await T(`wall-add-${key}`).click(); await sleep(450); };
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }
const summary = async () => { const t = await T("building-summary").innerText(); return { sf: Number((t.match(/([\d,]+) SF/) || [])[1]?.replace(/,/g, "")), doors: Number((t.match(/(\d+) doors?/) || [])[1]), text: t }; };

async function openScenario(scheme, tag, fields) {
  // Every scenario is its OWN throwaway site, all seeded up front (a reload drops an unsynced seed, so there is none).
  CUR = idOf(scheme, tag);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText(siteName(scheme, tag), { exact: false }).filter({ visible: true }).first().click({ timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 }).catch(async (e) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/nocanvas-${tag}.png` }).catch(() => {}); throw e; });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-wall-layers-render");
  await page.waitForSelector('[data-el-id="bz1"]', { timeout: 20000 }).catch(async () => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/missing-${tag}.png` }).catch(() => {}); throw new Error("VOID run — the seeded building never rendered (" + tag + "); url " + page.url()); });
  const pt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="bz1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(pt.x, pt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const num = await T("building-header").getByRole("textbox", { name: "Building number" }).inputValue();
  if (num !== "1") throw new Error("VOID run — the instrument did not see the header (" + tag + ")");
}


const sorted = (host, side, ts) => {
  const sg = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[side];
  const r = (host.rot * Math.PI) / 180, u = { x: sg[0] * Math.cos(r) - sg[1] * Math.sin(r), y: sg[0] * Math.sin(r) + sg[1] * Math.cos(r) };
  return ts.map((t) => ({ ...t, out: (t.cx - host.cx) * u.x + (t.cy - host.cy) * u.y })).sort((x, y) => x.out - y.out);
};
const alongOf = (host, side, z) => {
  const horiz = side === "top" || side === "bottom", r = (host.rot * Math.PI) / 180;
  const t = horiz ? { x: Math.cos(r), y: Math.sin(r) } : { x: -Math.sin(r), y: Math.cos(r) };
  return { len: z.type === "trailer" ? z.w : (horiz ? z.w : z.h), centre: (z.cx - host.cx) * t.x + (z.cy - host.cy) * t.y };
};
const trailers = async () => (await kids()).filter((k) => k.type === "trailer");
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

async function judge(tag, side, expect) {
  const b = await bldg();
  const ts = sorted(b, side, await trailers());
  ok(`[${tag}] ${expect.rows} trailer rows saved`, ts.length === expect.rows, String(ts.length));
  if (ts.length === expect.rows && ts.length >= 2) {
    const a1 = alongOf(b, side, ts[0]), a2 = alongOf(b, side, ts[1]);
    ok(`[${tag}] row 1 length ${a1.len.toFixed(1)} (expected ${expect.len1.toFixed(1)})`, near(a1.len, expect.len1));
    ok(`[${tag}] row 2 length ${a2.len.toFixed(1)} (expected ${expect.len2.toFixed(1)})`, near(a2.len, expect.len2));
    if (expect.samePos) ok(`[${tag}] row 2 sits at row 1's position (${a1.centre.toFixed(1)} vs ${a2.centre.toFixed(1)})`, near(a1.centre, a2.centre));
    ok(`[${tag}] default depths 50 / 50 (nothing copied)`, ts.every((t) => Math.round(t.zd) === 50), ts.map((t) => t.zd).join(","));
    ok(`[${tag}] rows are adjacent bands`, near(ts[1].out - ts[0].out, 50, 1));
  }
  const painted = await page.evaluate((ids) => ids.map((id) => { const g = document.querySelector(`[data-el-id="${id}"]`); if (!g) return [id, 0]; const r = g.getBoundingClientRect(); return [id, r.width * r.height]; }), ts.map((t) => t.id));
  ok(`[${tag}] every trailer row paints on the canvas`, painted.length > 0 && painted.every(([, a]) => a > 0), JSON.stringify(painted));
}

try {
  const scheme = "light", id = idOf(scheme, "main"); ALL_IDS.push(id);
  const id2 = idOf(scheme, "spare"); ALL_IDS.push(id2);
  const seeded = { [id]: mkSite(id, siteName(scheme, "main"), { dock: "single", dockAxis: "x", dockSide: "bottom", rot: 0 }), [id2]: mkSite(id2, siteName(scheme, "spare"), { dock: "single", dockAxis: "x", dockSide: "bottom" }) };
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  await openScenario(scheme, "main", {});
  const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
  ok("known-good: the wall list holds dock · rear · ends · ends", JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
  const dock = rowByRole("dock").first();
  await addLayer(dock, "court"); await addLayer(dock, "trailer");
  const side = "bottom";
  await page.keyboard.press("Escape").catch(() => {});
  await dock.getByTestId("wall-piece").nth(1).click(); await sleep(300);
  if (!(await T("wall-extent-len").isVisible())) { await dock.getByTestId("wall-piece").nth(1).click(); await sleep(300); }
  const fullLen = Number(await T("wall-extent-len").inputValue());
  ok(`a layer straight after the court runs the full court length (${fullLen}) and Full-length is disabled`, fullLen > 100 && await T("wall-extent-full").isDisabled());
  const half = Math.round(fullLen / 2);
  await T("wall-extent-len").fill(String(half)); await T("wall-extent-len").press("Enter"); await sleep(400);
  await T("wall-align-start").click(); await sleep(500);
  const b0 = await bldg(); const t1 = (await trailers())[0]; const a1 = alongOf(b0, side, t1);
  ok(`row 1 shortened to ${half} and pulled to the start end`, near(a1.len, half) && a1.centre < -1, `${a1.len.toFixed(1)} @ ${a1.centre.toFixed(1)}`);
  await dock.getByTestId("wall-add").click(); await sleep(200);
  ok("the + menu still offers Trailer parking with a trailer row present", await T("wall-add-trailer").isVisible());
  await T("wall-add-trailer").click(); await sleep(500);
  await addLayer(dock, "buffer");
  const kinds = await dock.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
  ok("the strip reads court · trailer · trailer · buffer on one line", JSON.stringify(kinds) === '["court","trailer","trailer","buffer"]' && (await dock.getByTestId("wall-strip").evaluate((el) => el.getBoundingClientRect().height)) < 40, JSON.stringify(kinds));
  { const b = await bldg(); const buf = (await kids()).find((k) => k.buffer); const ab = alongOf(b, side, buf);
    ok(`the buffer takes row 1's length and position too (${ab.len.toFixed(1)} @ ${ab.centre.toFixed(1)})`, near(ab.len, a1.len) && near(ab.centre, a1.centre)); }
  await judge("rot 0", side, { rows: 2, len1: a1.len, len2: a1.len, samePos: true });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/trailer-rows-rot0.png` }).catch(() => {});
  { const f = page.getByLabel("Rotation in degrees"); await f.fill("315"); await f.press("Enter"); await sleep(1500); }
  await judge("rot 315", side, { rows: 2, len1: a1.len, len2: a1.len, samePos: true });
  // editing row 2's length leaves row 1 alone
  await dock.getByTestId("wall-piece").nth(2).click(); await sleep(300);
  if (!(await T("wall-extent-len").isVisible())) { await dock.getByTestId("wall-piece").nth(2).click(); await sleep(300); }
  await T("wall-extent-len").fill("80"); await T("wall-extent-len").press("Enter"); await sleep(600);
  await judge("row 2 edited", side, { rows: 2, len1: a1.len, len2: 80, samePos: false });
  await page.reload({ waitUntil: "load" }); await sleep(3500);
  await judge("after reload", side, { rows: 2, len1: a1.len, len2: 80, samePos: false });
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
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
