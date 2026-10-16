/* verify-wall-extent-rear-end — B2268801 / V1693937, driven LIVE as the test account.
 * A THROWAWAY site (one building, docks S) is seeded through the app's own cloud-cache path. Through the real Docks & walls
 * strip on the REAR wall: Walk, shortened to a third and Start-aligned; then Trailer parking (offered on a rear wall),
 * a second Trailer row and a Buffer. Asserts, on the saved model in the HOST's frame: each new layer takes the Walk's
 * LENGTH and POSITION at its own default depth; editing one layer's length leaves the others alone; the END walls are
 * separate (one end shortened + a trailer inheriting it, the other end untouched); a bump-out keeps the extents; rot 315
 * and a reload keep it all. KNOWN-GOOD ARM: VOID unless the wall list is dock · rear · ends · ends.
 * Throwaway always deleted and confirmed gone.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=... node ui-audit/verify-wall-extent-rear-end.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-wer-" + Math.random().toString(36).slice(2, 7);
const SCEN0 = { single: { dock: "single", dockAxis: "x", dockSide: "bottom" }, cross: { dock: "cross", dockAxis: "x" }, bump: { dock: "single", dockAxis: "x", dockSide: "bottom" }, trailer: { dock: "single", dockAxis: "x", dockSide: "bottom" } };
const siteName = (scheme, tag) => `ZZ WER ${RUN.slice(-5)} ${scheme} ${tag}`;
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


const along = (host, side, k) => {
  const r = (host.rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = k.cx - host.cx, dy = k.cy - host.cy, lx = dx * c + dy * s, ly = -dx * s + dy * c;
  const rel = (((k.rot - host.rot) % 360) + 360) % 360, cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45;
  const bx = cross ? k.h : k.w, by = cross ? k.w : k.h, horiz = side === "top" || side === "bottom";
  return { len: horiz ? bx : by, centre: horiz ? lx : ly, depth: horiz ? by : bx };
};
const sideOf = (h, e) => {
  const r = (h.rot * Math.PI) / 180, dx = e.cx - h.cx, dy = e.cy - h.cy, lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
  const ox = Math.abs(lx) - h.w / 2, oy = Math.abs(ly) - h.h / 2;
  return oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left");
};
const wallKids = async (side) => { const h = await bldg(); return (await kids()).filter((e) => !e.dogEar && !e.noFit && !e.truckCourt && sideOf(h, e) === side); };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const openPiece = async (row, i) => { const p = row.getByTestId("wall-piece").nth(i); await p.click(); await sleep(300); if (!(await T("wall-edit-box").isVisible())) { await p.click(); await sleep(300); } };

try {
  const scheme = "light", id = idOf(scheme, "main"); ALL_IDS.push(id);
  const id2 = idOf(scheme, "spare"); ALL_IDS.push(id2);
  const seeded = { [id]: mkSite(id, siteName(scheme, "main"), { dock: "single", dockAxis: "x", dockSide: "bottom", rot: 0 }), [id2]: mkSite(id2, siteName(scheme, "spare"), { dock: "single", dockAxis: "x", dockSide: "bottom" }) };
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  await openScenario(scheme, "main", {});
  const roles = await page.locator('[data-testid="wall-row"]').evaluateAll((n) => n.map((r) => r.getAttribute("data-role")));
  ok("known-good: the wall list holds dock · rear · ends · ends", JSON.stringify(roles) === JSON.stringify(["dock", "rear", "ends", "ends"]), JSON.stringify(roles));
  const rear = rowByRole("rear"), rSide = await rear.getAttribute("data-sides");
  await addLayer(rear, "sidewalk");
  await openPiece(rear, 0);
  const full = Number(await T("wall-extent-len").inputValue());
  ok(`the first layer against the rear wall runs the full wall (${full}) and Full length is disabled`, full > 100 && await T("wall-extent-full").isDisabled());
  const third = Math.round(full / 3);
  await T("wall-extent-len").fill(String(third)); await T("wall-extent-len").press("Enter"); await sleep(400);
  await T("wall-align-start").click(); await sleep(500);
  const h0 = await bldg(); const walk = (await wallKids(rSide)).find((k) => k.type === "sidewalk"); const wa = along(h0, rSide, walk);
  ok(`Walk shortened to ${third} and pulled to the start end`, near(wa.len, third) && wa.centre < 0, `${wa.len.toFixed(1)} @ ${wa.centre.toFixed(1)}`);
  await page.keyboard.press("Escape").catch(() => {});
  await rear.getByTestId("wall-add").click(); await sleep(200);
  ok("Trailer parking is offered on the rear wall", await T("wall-add-trailer").isVisible());
  await T("wall-add-trailer").click(); await sleep(500);
  await addLayer(rear, "trailer"); await addLayer(rear, "buffer");
  const kinds = await rear.getByTestId("wall-piece").evaluateAll((n) => n.map((x) => x.getAttribute("data-kind")));
  ok("the rear strip reads sidewalk · trailer · trailer · buffer on one line", JSON.stringify(kinds) === '["sidewalk","trailer","trailer","buffer"]' && (await rear.getByTestId("wall-strip").evaluate((el) => el.getBoundingClientRect().height)) < 40, JSON.stringify(kinds));
  const check = async (tag, expectLens) => {
    const h = await bldg(), ks = await wallKids(rSide);
    const trs = ks.filter((k) => k.type === "trailer"), buf = ks.find((k) => k.type === "landscape" && !k.sidewalkSide);
    ok(`[${tag}] 2 trailer rows + a buffer on the rear wall`, trs.length === 2 && !!buf, `${trs.length} trailers`);
    if (trs.length === 2 && buf) {
      const lens = trs.map((t) => Math.round(along(h, rSide, t).len)).sort((p, q) => p - q);
      ok(`[${tag}] trailer lengths ${lens.join(",")} (expected ${expectLens.join(",")})`, lens.every((l, i) => near(l, expectLens[i])));
      if (expectLens[0] === expectLens[1]) {
        const ab = along(h, rSide, buf), at = trs.map((t) => along(h, rSide, t));
        ok(`[${tag}] trailers + buffer sit at the Walk's position (${wa.centre.toFixed(1)})`, [ab, ...at].every((a) => near(a.centre, wa.centre) && near(a.len, wa.len)));
      }
      ok(`[${tag}] default trailer depth 50 (nothing copied)`, trs.every((t) => t.wallTrailer && Math.round(along(h, rSide, t).depth) === 50));
    }
    const painted = await page.evaluate((ids) => ids.map((i) => { const g = document.querySelector(`[data-el-id="${i}"]`); if (!g) return [i, 0]; const r = g.getBoundingClientRect(); return [i, r.width * r.height]; }), ks.map((k) => k.id));
    ok(`[${tag}] every rear-wall layer paints`, painted.length === 4 && painted.every(([, a]) => a > 0), JSON.stringify(painted));
  };
  await check("rot 0", [Math.round(wa.len), Math.round(wa.len)]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rear-wall-rot0.png` }).catch(() => {});
  // the end walls are separate
  const ends = rowByRole("ends"), eSides = [await ends.nth(0).getAttribute("data-sides"), await ends.nth(1).getAttribute("data-sides")];
  await addLayer(ends.nth(0), "buffer"); await addLayer(ends.nth(1), "buffer");
  await openPiece(ends.nth(0), 0);
  const eFull = Number(await T("wall-extent-len").inputValue());
  await T("wall-extent-len").fill(String(Math.round(eFull / 2))); await T("wall-extent-len").press("Enter"); await sleep(400);
  await T("wall-align-end").click(); await sleep(500);
  await page.keyboard.press("Escape").catch(() => {});
  await addLayer(ends.nth(0), "trailer");
  { const h = await bldg(); const k0 = await wallKids(eSides[0]), k1 = await wallKids(eSides[1]);
    const b0 = along(h, eSides[0], k0.find((k) => k.type === "landscape")), t0 = along(h, eSides[0], k0.find((k) => k.type === "trailer")), b1 = along(h, eSides[1], k1.find((k) => k.type === "landscape"));
    ok(`end wall 1: buffer ${b0.len.toFixed(1)} (half of ${eFull}), its trailer inherits length and position`, near(b0.len, Math.round(eFull / 2)) && near(t0.len, b0.len) && near(t0.centre, b0.centre));
    ok(`end wall 2 is untouched (buffer ${b1.len.toFixed(1)} runs the full wall)`, b1.len > b0.len + 10); }
  // a bump-out lengthens an end wall: extents survive
  await page.locator('[data-testid="picker-corner-add"]').first().click({ force: true }); await sleep(900);
  { const h = await bldg(); const k0 = await wallKids(eSides[0]); const t0 = along(h, eSides[0], k0.find((k) => k.type === "trailer")), b0 = along(h, eSides[0], k0.find((k) => k.type === "landscape"));
    ok("after a bump-out the end wall's trailer and buffer still agree with each other and stay shortened", near(t0.len, b0.len) && near(t0.centre, b0.centre) && t0.len < eFull - 10, `${t0.len.toFixed(1)} / ${b0.len.toFixed(1)}`); }
  { const f = page.getByLabel("Rotation in degrees"); await f.fill("315"); await f.press("Enter"); await sleep(1500); }
  await check("rot 315", [Math.round(wa.len), Math.round(wa.len)]);
  // editing one rear trailer's length leaves the others alone
  await openPiece(rear, 2);
  await T("wall-extent-len").fill("60"); await T("wall-extent-len").press("Enter"); await sleep(600);
  await check("row edited", [60, Math.round(wa.len)]);
  await page.reload({ waitUntil: "load" }); await sleep(3500);
  await check("after reload", [60, Math.round(wa.len)]);
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
