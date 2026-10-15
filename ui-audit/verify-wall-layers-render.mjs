/* verify-wall-layers-render — B2272608 / V1697744, driven LIVE as the test account.
 * A THROWAWAY site (one building, docks E) is seeded through the app's own cloud-cache path; the rear wall gets Walk +
 * Buffer 10', the dock a court + trailer, two bump-outs, both ends Walk + Parking — all through the real Docks & walls
 * strip. Asserts on the saved model (every wall's layers stack without overlap; the rear Walk 5' against the wall and the
 * Buffer 10' beyond it) AND that every layer paints a node with area. Then rotates to 315 and reloads. KNOWN-GOOD ARM:
 * VOID unless the header reads "Building 1" and the wall list is dock · rear · ends · ends. Throwaway always deleted.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=... node ui-audit/verify-wall-layers-render.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-wlr-" + Math.random().toString(36).slice(2, 7);
const SCEN0 = { single: { dock: "single", dockAxis: "x", dockSide: "bottom" }, cross: { dock: "cross", dockAxis: "x" }, bump: { dock: "single", dockAxis: "x", dockSide: "bottom" }, trailer: { dock: "single", dockAxis: "x", dockSide: "bottom" } };
const siteName = (scheme, tag) => `ZZ WLR ${RUN.slice(-5)} ${scheme} ${tag}`;
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

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
function spanOf(b, side, k) {
  const r = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - b.cx, dy = k.cy - b.cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const kr = (((k.rot || 0) - (b.rot || 0)) * Math.PI) / 180;
  const kw = Math.abs(k.w * Math.cos(kr)) + Math.abs(k.h * Math.sin(kr)), kh = Math.abs(k.w * Math.sin(kr)) + Math.abs(k.h * Math.cos(kr));
  const vert = side === "left" || side === "right", [nx, ny] = SIDE_N[side];
  const perp = (vert ? nx : ny) * (vert ? lx : ly) - (vert ? b.w : b.h) / 2, d = vert ? kw : kh;
  return [perp - d / 2, perp + d / 2];
}
const sideOfKid = (b, k) => {
  const r = ((b.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - b.cx, dy = k.cy - b.cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const ox = Math.abs(lx) - b.w / 2, oy = Math.abs(ly) - b.h / 2;
  return oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left");
};
async function judge(tag) {
  const b = await bldg(), ks = await kids();
  const layers = ks.filter((k) => !k.dogEar && !k.truckCourt && !k.forCourt && !k.forTrailer && !k.prevZone && k.type !== "trailer" && !k.noFit && k.type !== "paving");
  const rear = layers.filter((k) => sideOfKid(b, k) === "left");
  ok(`[${tag}] the rear holds a sidewalk and a buffer`, JSON.stringify(rear.map((k) => k.type).sort()) === '["landscape","sidewalk"]', JSON.stringify(rear.map((k) => k.type)));
  const w = rear.find((k) => k.type === "sidewalk"), f = rear.find((k) => k.type === "landscape");
  if (w && f) {
    const [wi, wo] = spanOf(b, "left", w), [fi, fo] = spanOf(b, "left", f);
    ok(`[${tag}] Walk 5' against the wall, Buffer 10' beyond it (walk ${wi.toFixed(1)}..${wo.toFixed(1)}, buffer ${fi.toFixed(1)}..${fo.toFixed(1)})`, Math.abs(wi) < 1 && Math.abs(wo - 5) < 1 && Math.abs(fi - 5) < 1 && Math.abs(fo - fi - 10) < 1);
  }
  let overlap = "";
  for (const side of ["left", "top", "bottom"]) {
    const L = layers.filter((k) => sideOfKid(b, k) === side).map((k) => ({ k, sp: spanOf(b, side, k) })).sort((x, y) => x.sp[0] - y.sp[0]);
    let reach = 0; for (const { k, sp } of L) { if (sp[0] < reach - 0.5) overlap += ` ${k.type}@${side}`; reach = Math.max(reach, sp[1]); }
  }
  ok(`[${tag}] no two layers of a wall overlap`, !overlap, overlap);
  const painted = await page.evaluate((ids) => ids.map((id) => { const g = document.querySelector(`[data-el-id="${id}"]`); if (!g) return [id, 0]; const r = g.getBoundingClientRect(); return [id, r.width * r.height]; }), ks.map((k) => k.id));
  ok(`[${tag}] every layer paints a node with area (${ks.length})`, painted.every(([, a]) => a > 0), JSON.stringify(painted.filter(([, a]) => !(a > 0))));
}

try {
  const scheme = "light", id = idOf(scheme, "main"); ALL_IDS.push(id);
  // seeded as a pair, exactly like verify-building-panel-v2 (a lone seeded site does not resolve as a project route)
  const id2 = idOf(scheme, "spare"); ALL_IDS.push(id2);
  const seeded = { [id]: mkSite(id, siteName(scheme, "main"), { dock: "single", dockAxis: "y", dockSide: "right", rot: 0 }), [id2]: mkSite(id2, siteName(scheme, "spare"), { dock: "single", dockAxis: "x", dockSide: "bottom" }) };
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  await openScenario(scheme, "main", {});
  const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
  ok("known-good: the wall list holds dock · rear · ends · ends", JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
  await addLayer(rowByRole("rear"), "sidewalk");
  await addLayer(rowByRole("rear"), "buffer");
  { const d = T("wall-depth"); await d.fill("10"); await d.press("Enter"); await sleep(500); }
  await addLayer(rowByRole("dock").first(), "court"); await addLayer(rowByRole("dock").first(), "trailer");
  for (let i = 0; i < 2; i++) { await page.locator('[data-testid="picker-corner-add"]').first().click({ force: true }); await sleep(400); }
  const ends = rowByRole("ends");
  for (let i = 0; i < await ends.count(); i++) { await addLayer(ends.nth(i), "sidewalk"); await addLayer(ends.nth(i), "parking"); }
  await sleep(1500);
  await judge("rot 0");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/wall-layers-rot0.png` }).catch(() => {});
  { const f = page.getByLabel("Rotation in degrees"); await f.fill("315"); await f.press("Enter"); await sleep(1500); }
  await judge("rot 315");
  await page.reload({ waitUntil: "load" }); await sleep(3000);
  await judge("after reload");
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
