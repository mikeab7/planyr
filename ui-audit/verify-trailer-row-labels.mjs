/* verify-trailer-row-labels — B2160240 / B2160241 / B2160242 / V1575488, driven LIVE as the test account.
 *
 * Seeds a THROWAWAY site holding two stacked trailer rows (the owner's scene: the upper one shallower), opens it
 * on the real deploy and checks, in order:
 *   1. COUNT — at every zoom step the upper row's label reads "<n> trailers" (never just the name, never nothing),
 *      and the deeper row's does too (the known-good arm).
 *   2. HIDE / SHOW — right-click → "Hide label" removes ONLY that row's label, the saved row carries
 *      `labelHidden`, a real reload keeps it hidden, the Properties switch brings it back, a reload keeps it shown.
 *   3. STALL DEPTH — Properties → Stalls → Stall depth accepts 50 / 53 / 45; the label and count follow
 *      (count = row length ÷ stall width); a value far under the sanity floor is answered, not swallowed.
 * KNOWN-GOOD ARM: the run is VOID unless the untouched lower row shows its count at zoom step 0.
 * The throwaway site is ALWAYS deleted and confirmed gone (owner constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-trailer-row-labels.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SITE_ID = "zz-trl-" + Math.random().toString(36).slice(2, 7);
const NAME = "ZZ Trailer Rows Throwaway";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: NAME, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
  els: [
    { id: "tup", type: "trailer", cx: 700, cy: 380, w: 1429, h: 51, rot: 0, z: 1, cfg: { trailerL: 51 } },
    { id: "tlo", type: "trailer", cx: 700, cy: 480, w: 1429, h: 143, rot: 0, z: 2 },
  ],
};

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [SITE_ID, UID]);
const row = async (id) => ((await model())?.els || []).find((e) => e.id === id);
const dbRow = (id) => page.evaluate(async ([sid, eid]) => { const q = await window.pfSupabase.from("site_elements").select("id,data,deleted_at").eq("site_id", sid).eq("id", eid); return q.error ? { error: String(q.error.message) } : (q.data || [])[0] || null; }, [SITE_ID, id]);
const labelText = (id) => page.locator(`[data-label-for="${id}"]`).allTextContents().then((a) => a.join("|"));
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }

async function openPlan() {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText(NAME, { exact: false }).filter({ visible: true }).first().click({ timeout: 30000 });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800);
  await assertMeasurable(page, "verify-trailer-row-labels");
}
const rightClick = async (id) => {
  const b = await page.locator(`[data-el-id="${id}"]`).first().boundingBox();
  await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2, { button: "right" });
};

try {
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
  await openPlan();
  const canvas = await page.getByTestId("planner-canvas").boundingBox();

  // 1. COUNT at every zoom step — known-good arm first
  const t0 = await labelText("tlo");
  ok("known-good: the untouched deeper row shows its count at full zoom", /\d+ trailers/.test(t0), t0);
  if (!/\d+ trailers/.test(t0)) throw new Error("VOID run — the instrument did not see the deeper row's label");
  for (let z = 0; z < 5; z++) {
    const up = await labelText("tup"), lo = await labelText("tlo");
    ok(`zoom step ${z}: upper row shows its count`, /\d+ trailers/.test(up), JSON.stringify(up));
    ok(`zoom step ${z}: lower row shows its count`, /trailers/.test(lo), JSON.stringify(lo));
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await page.mouse.wheel(0, 250); await sleep(500);
  }
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }

  // 2. HIDE / SHOW, persisted
  await rightClick("tup");
  const menuRow = page.getByTestId("el-menu-label-toggle");
  ok("right-click menu offers 'Hide label' on a trailer row", /Hide label/.test(await menuRow.innerText().catch(() => "")));
  await menuRow.click();
  await waitFor(async () => (await page.locator('[data-label-for="tup"]').count()) === 0);
  ok("only that row's label disappears", (await page.locator('[data-label-for="tup"]').count()) === 0 && (await page.locator('[data-label-for="tlo"]').count()) === 1);
  ok("saved row carries labelHidden; neighbour untouched", (await row("tup"))?.labelHidden === true && !(await row("tlo"))?.labelHidden);
  const cloud1 = await waitFor(async () => (await dbRow("tup"))?.data?.labelHidden === true && (await dbRow("tup")));
  ok("the cloud row (site_elements) holds labelHidden — round-trips per item", !!cloud1 && !(await dbRow("tlo"))?.data?.labelHidden, JSON.stringify(cloud1 && cloud1.data && { labelHidden: cloud1.data.labelHidden }));
  await openPlan();
  ok("after a REAL reload the row is still hidden and its neighbour still labelled", (await page.locator('[data-label-for="tup"]').count()) === 0 && /trailers/.test(await labelText("tlo")));
  // Properties switch
  { const b = await page.locator('[data-el-id="tup"]').first().boundingBox(); await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2); await page.mouse.dblclick(b.x + b.width * 0.85, b.y + b.height / 2); }
  const toggle = page.getByTestId("trailer-label-toggle");
  await toggle.waitFor({ timeout: 10000 });
  ok("Properties → Stalls → Label reads Hidden (unchecked)", !(await toggle.isChecked()));
  await toggle.check();
  await waitFor(async () => (await page.locator('[data-label-for="tup"]').count()) === 1);
  ok("ticking it brings the label back and clears the flag", /trailers/.test(await labelText("tup")) && (await row("tup"))?.labelHidden == null);
  await waitFor(async () => (await dbRow("tup"))?.data?.labelHidden == null);
  await openPlan();
  ok("after a REAL reload it is still shown", /trailers/.test(await labelText("tup")));

  // 3. STALL DEPTH
  { const b = await page.locator('[data-el-id="tup"]').first().boundingBox(); await page.mouse.click(b.x + b.width * 0.85, b.y + b.height / 2); await page.mouse.dblclick(b.x + b.width * 0.85, b.y + b.height / 2); }
  const depth = page.locator('input[aria-label="Trailer Stall depth (ft)"]');
  await depth.waitFor({ timeout: 10000 });
  ok("Stall depth field reads the row's own depth, not 53", Number(await depth.inputValue()) === 51, await depth.inputValue());
  for (const d of [50, 53, 45]) {
    await depth.fill(String(d)); await depth.press("Enter");
    await waitFor(async () => (await row("tup"))?.cfg?.trailerL === d);
    const r = await row("tup");
    const per = Math.floor(r.w / (r.cfg.trailerW ?? 12));
    const txt = await labelText("tup");
    ok(`stall depth ${d}: saved, label reads "${d}′ Trailer Parking" and ${per} trailers`, r.cfg.trailerL === d && txt.includes(`${d}′ Trailer Parking`) && txt.includes(`${per.toLocaleString()} trailers`), txt);
  }
  await depth.fill("3"); await depth.press("Enter"); await sleep(400);
  ok("a depth far under any real stall is answered ('Using 8'), not silently kept", /Using 8/.test(await page.locator("body").innerText()) && (await row("tup"))?.cfg?.trailerL === 8);
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/trailer-rows-failure.png` }).catch(() => {});
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
