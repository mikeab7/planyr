/* verify-brittmoore-merge-live — V1563360 (B2090352 amendment): the two real Brittmoore Rd lots (HCAD 0210690010025 +
 * 0210690010007, one exact shared edge, the owner's stored rings verbatim) must be PICKABLE BY CANVAS CLICK while LOCKED
 * (county lots arrive locked) and MERGE to ONE ~9.51 ac parcel, signed in as the test account on the real deploy.
 * Throwaway site on the test account, always deleted and confirmed gone (owner constraint 15).
 * KNOWN-GOOD ARM: VOID unless the untouched plan reports exactly the two seeded locked parcels at ~9.51 ac total.
 * Usage: BASE_URL=https://planyr.io EXPECT_BUILD=<merge sha prefix> node ui-audit/verify-brittmoore-merge-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { execFileSync } from "node:child_process";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const EXPECT = process.env.EXPECT_BUILD || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const P = (a) => a.map(([x, y]) => ({ x, y }));
const A = [[-125.932,178.349],[-136.264,178.423],[-127.355,133.821],[-120.149,88.813],[-114.66,43.483],[-110.899,-2.08],[-108.873,-47.79],[-108.586,-93.558],[-110.037,-139.297],[-110.009,-232.353],[496.278,-236.517],[498.875,173.883]];
const B = [[892.997,-236.68],[899.414,171.025],[887.17,171.113],[498.875,173.883],[496.278,-236.517]];
const ID = "zz-britt-" + Math.random().toString(36).slice(2, 7);
const site = { id: ID, groupId: ID, site: "ZZ Brittmoore Throwaway", name: "Plan 1", origin: { lat: 29.8, lon: -95.5 }, county: "harris",
  parcels: [{ id: "pA", points: P(A), locked: true, acct: "0210690010025" }, { id: "pB", points: P(B), locked: true, acct: "0210690010007" }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12 };
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);

// The served build is a short sha of the DEPLOYED commit, which may be a LATER main commit than the merge (deploys coalesce):
// accept any served build that CONTAINS the merge commit (git ancestry), never an exact-prefix match.
const contains = (build) => { try { execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore" }); execFileSync("git", ["merge-base", "--is-ancestor", EXPECT, build], { stdio: "ignore" }); return true; } catch { return false; } };
if (EXPECT) {
  let b = null;
  for (let i = 0; i < 60; i++) { b = await fetch(BASE + "/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null); if (b && b.build && contains(String(b.build))) break; await sleep(20000); }
  if (!b || !contains(String(b.build))) { console.log("VOID — deploy never served a build containing", EXPECT, JSON.stringify(b)); process.exit(2); }
}
const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const T = (id) => page.getByTestId(id);
const parcelsLS = () => page.evaluate(([id, uid]) => (JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}")[id] || {}).parcels || null, [ID, UID]);
try {
  await page.evaluate(([uid, st]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [UID, site]);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.reload({ waitUntil: "load" }); await sleep(3000);
  await page.getByText("ZZ Brittmoore Throwaway", { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1500);
  await assertMeasurable(page, "verify-brittmoore-merge-live");
  const served = await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build);
  console.log("served build (same call as the assertions):", served);
  if (EXPECT) ok("served build contains the merge commit", contains(String(served)), `${served} ⊇ ${EXPECT}`);
  const before = await parcelsLS();
  ok("known-good: untouched plan holds the two seeded LOCKED parcels at ~9.51 ac", before && before.length === 2 && before.every((p) => p.locked) && Math.abs((area(before[0].points) + area(before[1].points)) / 43560 - 9.514) < 0.01);
  if (!(before && before.length === 2)) throw new Error("VOID run — seeded parcels not seen");
  await page.locator('[data-rail-tab="parcel"]').first().click(); await T("parcels-panel").waitFor({ timeout: 15000 });
  await page.getByTestId("rail-parcel-tools").click();
  await page.locator('[data-parcel-action="combine"]').click(); await sleep(400);
  const fit = page.getByTitle(/zoom to fit|fit to/i).first(); if (await fit.count()) await fit.click().catch(() => {}); await sleep(900);
  ok("banner starts at 0 picked", (await page.getByText(/0 picked/).count()) > 0);
  const boxes = async () => page.$$eval('[data-testid="parcel-outline"]', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
  const order = (await parcelsLS()).map((p) => p.id);
  for (let k = 0; k < 2; k++) {
    const b = (await boxes())[order.indexOf(k === 0 ? "pA" : "pB")];
    await page.mouse.click(b.x + b.w * (k === 0 ? 0.3 : 0.7), b.y + b.h * 0.5); await sleep(500);
  }
  const banner = await page.getByText(/parcels picked|parcels selected/).first().innerText().catch(() => "");
  ok("canvas clicks pick BOTH locked county lots (banner '2 parcels picked')", /2 parcels/.test(banner), banner);
  await page.getByRole("button", { name: /Merge parcels|Combine/ }).first().click(); await sleep(1200);
  const after = await parcelsLS();
  const danger = await page.getByText(/too far off to fuse|survey slop/).count();
  ok("no refusal banner ('too far off to fuse' / 'survey slop')", danger === 0);
  ok("ONE parcel remains", after && after.length === 1, `n=${after && after.length}`);
  const ac = after && after[0] ? area(after[0].points) / 43560 : 0;
  ok("it reads 9.51 ac (exact dissolved area of the two rings 9.514)", Math.abs(ac - 9.514) < 0.01, ac.toFixed(4));
  const ring = after && after[0] ? after[0].points : [];
  const inRing = (p) => ring.some((q) => Math.abs(q.x - p[0]) < 0.001 && Math.abs(q.y - p[1]) < 0.001);
  ok("input corners away from the shared edge survive exactly (acute NW spike + west curve facets)", A.slice(0, 10).every(inRing) && B.slice(0, 3).every(inRing));
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && (q.data || []).length === 0;
  }, [ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
