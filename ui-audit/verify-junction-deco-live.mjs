/* verify-junction-deco-live — V1701312 + V1701313 (B1783376 ×2, B2276177), driven LIVE as the test account, light AND dark.
 *
 * Seeds a THROWAWAY site through the app's own local-cache path (same as verify-building-panel-v3) holding four scenes far apart:
 *   A  a tee, side AND through road carrying a designed cross-section (curb & gutter · travel · median · travel · curb & gutter · sidewalk)
 *   B  a designed road driving into a parking pad
 *   C  two tees on one trunk, a leftover connect vertex (a mild bend) 8 ft off each node          (B2276177)
 *   D  a plain tee (no cross-section)
 * and asks the DEPLOYED app's own geometry (`window.__plannerRoadNet()`, the E2E hook the init script arms) the same three questions the local spec asks —
 * via the shared ui-audit/lib/junctionDecoProbe.mjs — plus: every tee corner has a return (C), the bands are still drawn above the cluster fill, an outside-curb
 * band is clipped away from the pavement, and the exported sheet carries the same decoration clip paths as the screen.
 * KNOWN-GOOD ARM (WRONG-CASE): the run is VOID unless the app built 4 tees + 1 drive and scene C's leftover vertices SURVIVED the load-time cleanup.
 * The throwaway is ALWAYS deleted and confirmed gone (owner constraint 15).
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-junction-deco-live.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { decoSeamViolations, interiorStripePoints, arcsWithoutStripe } from "./lib/junctionDecoProbe.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-jd-" + Math.random().toString(36).slice(2, 7);
const siteName = (scheme) => `ZZ JD ${RUN.slice(-5)} ${scheme}`;
const idOf = (scheme) => `${RUN}-${scheme}`;
const ALL_IDS = [];

const CG = { type: "curbGutter", w: 2 };
const BANDS = [CG, { type: "travel", w: 10 }, { type: "median", w: 10 }, { type: "travel", w: 10 }, CG, { type: "sidewalk", w: 5 }];
const road = (id, pts, o = {}) => ({ id, type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: 34, curb: 0.5, roadClass: "local", cx: pts[0].x, cy: pts[0].y, w: 10, h: 10, rot: 0, ...o });
const designed = () => ({ xsection: { bands: BANDS } });
const P = (x, y) => ({ x, y });
const at = (dx, dy, els) => els.map((e) => ({ ...e, id: e.id, pts: e.pts ? e.pts.map((p) => P(p.x + dx, p.y + dy)) : e.pts, ...(typeof e.cx === "number" ? { cx: e.cx + dx, cy: e.cy + dy } : {}) }));
const aisle = (id, pts) => road(id, pts, { travelW: 24, roadClass: "aisle" });
const mkSite = (id, name) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [P(-2200, -1500), P(2600, -1500), P(2600, 1800), P(-2200, 1800)] }],
  els: [
    ...at(0, 0, [road("A-G", [P(-300, 0), P(0, 0), P(300, 0)], designed()), road("A-S", [P(0, -250), P(0, 0)], designed())]),
    ...at(1100, 0, [{ id: "B-PAD", type: "parking", z: 0, cx: 0, cy: 100, w: 400, h: 200, rot: 0 }, road("B-S", [P(0, -300), P(0, 10)], designed())]),
    ...at(0, 900, [aisle("C-G", [P(-400, 0), P(-8, 1.8), P(0, 0), P(52, 1.8), P(60, 0), P(400, 0)]), aisle("C-S1", [P(0, -160), P(0, 0)]), aisle("C-S2", [P(60, 160), P(60, 0)])]),
    ...at(-1100, 0, [road("D-G", [P(-300, 0), P(0, 0), P(300, 0)]), road("D-S", [P(0, -250), P(0, 0)])]),
  ],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const net = () => page.evaluate(() => window.__plannerRoadNet());

async function openScenario(scheme) {
  const id = idOf(scheme);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.evaluate(() => { window.__PLANYR_E2E = true; });
  await page.getByText(siteName(scheme), { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(2500);
  await assertMeasurable(page, "verify-junction-deco-live");
  await page.waitForFunction(() => window.__plannerRoadNet && window.__plannerRoadNet() && window.__plannerRoadNet().tees.length >= 4, null, { timeout: 25000 }).catch(() => {});
  return id;
}

try {
  const seeded = {};
  for (const scheme of ["light", "dark"]) { const id = idOf(scheme); ALL_IDS.push(id); seeded[id] = mkSite(id, siteName(scheme)); }
  await page.evaluate(([uid, all]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(all)); localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]); }, [UID, seeded]);
  for (const scheme of ["light", "dark"]) {
    console.log(`\n=== ${scheme.toUpperCase()} ===`);
    await openScenario(scheme);
    const n = await net();
    // known-good arm — VOID unless the instrument saw what the checks are about
    const stray = n && (n.roads || []).find((r) => r.id === "C-G");   // `roads` / `deco` / `arcs` exist only on a build carrying this change — an older build VOIDs here, honestly
    if (!n || n.tees.length !== 4 || n.drives.length !== 1 || !stray || stray.pts.length !== 6) throw new Error(`VOID run — expected 4 tees + 1 drive and C-G's 6 trunk vertices; saw ${n ? `${n.tees.length} tees, ${n.drives.length} drives, C-G ${stray ? stray.pts.length : "missing"} pts` : "no hook"}`);
    ok(`[${scheme}] known-good: 4 tees + 1 drive built, and the leftover vertices survived the load cleanup`, true);

    // B2276177 — every tee corner has a return
    const zero = n.tees.flatMap((t) => t.cornerR.map((r, k) => ({ side: t.sideId, corner: k, R: r }))).filter((c) => !(c.R > 0));
    ok(`[${scheme}] every tee corner has a curb return (${n.tees.map((t) => t.cornerR.map((r) => r.toFixed(0)).join("/")).join(" · ")})`, zero.length === 0, JSON.stringify(zero));

    // B1783376 ×2 — the three properties on the deployed geometry
    ok(`[${scheme}] every designed road at a junction has a decoration domain`, ["A-G", "A-S", "B-S"].every((id) => (n.deco || []).some((d) => d.id === id)));
    const v1 = decoSeamViolations(n, n.roads);
    ok(`[${scheme}] no decoration edge runs along the pavement beside a return`, v1.length === 0, JSON.stringify(v1.slice(0, 3)));
    const v2 = interiorStripePoints(n);
    ok(`[${scheme}] no face-of-curb stripe runs through the interior`, v2.length === 0, JSON.stringify(v2));
    const arcs = [...n.tees.map((t) => t.arcs), ...n.drives.map((d) => d.returns)].flat();
    const v3 = arcsWithoutStripe(n, arcs);
    ok(`[${scheme}] a stripe follows every curb return, inside the pavement (${arcs.filter(Boolean).length} returns)`, v3.length === 0, JSON.stringify(v3));

    // the picture: scene A at working zoom
    await page.evaluate(() => window.__plannerView && window.__plannerView.centerOn(0, -40, 0.5));
    await sleep(900);
    const dom = await page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-testid="planner-canvas"] *')];
      const surfaces = [...document.querySelectorAll('[data-testid="road-network-surface"]')];
      return ["A-G", "A-S"].map((id) => {
        const deco = document.querySelector(`[data-road-deco="${id}"]`);
        const clip = document.getElementById(`xsclip-${id}`);
        const own = surfaces.find((sf) => sf.closest("[data-road-cluster]")?.getAttribute("data-road-cluster").split(",").includes(id));
        return { id, after: !!deco && !!own && all.indexOf(deco) > all.indexOf(own), fills: deco ? deco.querySelectorAll("polygon").length : 0, clip: !!(clip && clip.querySelector("path")?.getAttribute("d")), outClip: !!document.getElementById(`xsout-${id}`) };
      });
    });
    ok(`[${scheme}] B1958144 holds: both designed roads paint their bands ABOVE the cluster fill, bounded by a decoration domain`, dom.every((d) => d.after && d.fills > 0 && d.clip), JSON.stringify(dom));
    ok(`[${scheme}] an outside-curb band (sidewalk) is clipped away from the pavement`, dom.some((d) => d.outClip));
    if (SHOTS) await page.getByTestId("planner-canvas").screenshot({ path: `${SHOTS}/${scheme}-tee.png` }).catch(() => {});

    // PDF-PARITY — the clone carries the same clip paths
    const exp = await page.evaluate(async () => {
      const m = window.__plannerExportSvg ? String(await window.__plannerExportSvg()) : "";
      const doc = new DOMParser().parseFromString(m, "image/svg+xml");
      return { len: m.length, clips: [...doc.querySelectorAll("clipPath")].filter((c) => /^xs(clip|out)-/.test(c.id)).length, surface: !!doc.querySelector('[data-testid="road-network-surface"]') };
    });
    const live = await page.evaluate(() => [...document.querySelectorAll("clipPath")].filter((c) => /^xs(clip|out)-/.test(c.id)).length);
    ok(`[${scheme}] the exported sheet carries the same decoration clip paths as the screen (${exp.clips} vs ${live})`, exp.len > 1000 && exp.surface && exp.clips === live && live > 0);
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
