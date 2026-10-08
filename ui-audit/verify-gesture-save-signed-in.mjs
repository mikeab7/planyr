/* V1580368 step 1 (B217540 ×2) — signed in as the throwaway test account on a real deploy: dragging does not rewrite the
 * device's plans store on every pointer-move frame, and the settled position is saved after release.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-gesture-save-signed-in.mjs [https://planyr.io] [--expect-sha <merge sha>]
 * Seeds a throwaway one-building plan on the test account, deletes it at the end and verifies it is gone. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let KEY = "planarfit:sites:v1";   // signed in, the app uses planarfit:sites:cloud:<uid> instead — resolved below
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-gesture-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz Gesture save check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [{ z: 1, id: "b1", type: "building", cx: 0, cy: 0, w: 400, h: 250, rot: 0, dock: "cross", dockAxis: "x", dockSide: "bottom" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
try {
  await assertMeasurable(page, "verify-gesture-save-signed-in");
  const served = () => page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  const b1 = await served();
  console.log("signed in as", s.proof.email, "| served build", b1);
  if (expectSha) check("the deploy is serving the merge commit", String(b1 || "").startsWith(expectSha.slice(0, 7)), `served ${b1}`);
  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-feature^="el:"]').length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const sel = page.getByRole("button", { name: /^Select V$/ });
  if (await sel.count()) { await sel.click(); await page.waitForTimeout(300); }
  await page.keyboard.press("Escape");
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.mouse.click(box.x + 40, box.y + 40);
  await page.waitForTimeout(600);
  const p = await page.evaluate(() => {
    const g = document.querySelector('[data-feature^="el:"]'); const r = g.getBoundingClientRect();
    for (const [fx, fy] of [[0.62, 0.3], [0.38, 0.3], [0.62, 0.7], [0.85, 0.5], [0.15, 0.5], [0.3, 0.5]]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy, t = window.__plannerHitTarget && window.__plannerHitTarget(x, y);
      if (t && t.kind === "el") return { x, y };
    } return null; });
  check("a point exists where the app's own hit test answers 'the building' (precondition)", !!p);
  KEY = await page.evaluate(() => Object.keys(localStorage).find((k) => /^planarfit:sites:cloud:/.test(k)) || "planarfit:sites:v1");
  check("the signed-in plans store key is the user-scoped one", /cloud:/.test(KEY), KEY);
  if (p) {
    const pos = () => page.evaluate(([k, id]) => { const m = JSON.parse(localStorage.getItem(k) || "{}"); for (const r of Object.values(m)) { if (!r || (r.id !== id && r.groupId !== id)) continue; const e = (r.els || []).find((x) => x.id === "b1"); if (e) return Math.round(e.cx) + "," + Math.round(e.cy); } return null; }, [KEY, ID]);
    const before = await pos();
    check("precondition: the building is readable from the device store (else the position checks are vacuous)", before !== null, String(before));
    if (before === null) console.log("store keys:", await page.evaluate((k) => JSON.stringify(Object.entries(JSON.parse(localStorage.getItem(k) || "{}")).map(([a, r]) => [a, r && r.id, r && (r.els || []).length]).slice(0, 8)), KEY));
    await page.evaluate((k) => { window.__w = 0; window.__by = {}; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (a, b) { window.__by[a] = (window.__by[a] || 0) + 1; if (a === k) window.__w++; return o.call(this, a, b); }; }, KEY);
    console.log("localStorage keys:", await page.evaluate(() => JSON.stringify(Object.keys(localStorage).map((k) => [k, (localStorage.getItem(k) || "").length]).filter((x) => /planarfit|planyr/.test(x[0])).slice(0, 25))));
    const rect = () => page.evaluate(() => { const r = document.querySelector('[data-feature^="el:"]').getBoundingClientRect(); return Math.round(r.left) + "," + Math.round(r.top); });
    const rectBefore = await rect();
    console.log("diag hit", JSON.stringify(await page.evaluate(([x, y]) => window.__plannerHitTarget(x, y), [p.x, p.y])), "features", await page.evaluate(() => JSON.stringify([...document.querySelectorAll("[data-feature]")].map((e) => e.getAttribute("data-feature")).slice(0, 8))), "banner", await page.evaluate(() => (document.body.innerText.match(/(read-only|locked|can.t save|offline|changed in another)[^\n]{0,80}/i) || [""])[0]));
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(400); await page.mouse.down(); await page.waitForTimeout(250);
    await page.mouse.move(p.x - 12, p.y + 8, { steps: 4 }); await page.waitForTimeout(150);
    await page.mouse.move(p.x - 90, p.y + 60, { steps: 40 });
    const during = await page.evaluate(() => window.__w);
    console.log("diag mid-drag rect", await rect());
    await page.screenshot({ path: "/tmp/claude-0/-home-user-planyr/720c8ccf-2e2a-5c04-809a-6ed6fdb39dc0/scratchpad/mid.png" });
    await page.mouse.up();
    await page.waitForTimeout(3500);
    console.log("setItem writes by key (whole run after arming):", await page.evaluate(() => JSON.stringify(window.__by)));
    const after = await page.evaluate(() => window.__w), pAfter = await pos();
    const rectAfter = await rect();
    check("the drag really moved the building on screen (else the save checks are vacuous)", rectAfter !== rectBefore, `${rectBefore} → ${rectAfter}`);
    check("plans store written at most once WHILE the drag was in flight", during <= 1, `${during} write(s) in a 40-frame drag (main: ~29)`);
    check("the store is written after release", after >= 1, `${after} total`);
    check("the stored building is at the settled position", pAfter !== before, `${before} → ${pAfter}`);
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
    await page.waitForTimeout(3000);
    check("after a reload the building is where it was left", (await pos()) === pAfter, await pos());
  }
  const b2 = await served();
  check("the build served at the end is the build served at the start", b2 === b1, `${b1} → ${b2}`);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { local: !JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[id], cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted (local + cloud) and verified gone", !!gone.local && !!gone.cloud, JSON.stringify(gone));
  await s.close();
}
console.log(failed ? `FAIL (${failed})` : "PASS");
process.exit(failed ? 1 : 0);
