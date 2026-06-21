/* LIVE verify for B357 + B358 (bump-out resize persistence + bonded-child rotation repair).
 *
 * Drives the REAL Site Planner bundle in a headless browser. Seeds a Jacintoport-shaped site:
 *  - a host building at rot 0°,
 *  - four bonded children (a sidewalk, a truck court, two corner bump-outs) at the SAME ~1°
 *    drift Jacintoport showed (359.035°), positioned as if the host were still at 359.035°,
 *  - one bump-out carrying a USER size (along 80 / proj 70) instead of the 55×60 default.
 * Resumes into the planner (so loadSite → createSiteModel runs the B358 repair on the render
 * path), makes one tiny edit (toggle snap, the `s` shortcut) to fire the autosave, then reads
 * the persisted Site Model back out of localStorage and asserts:
 *   B358 — every drifted child's rot snapped to the host's 0° (re-anchored), the correct child
 *          is untouched, and the assembly is no longer ~1° off the building;
 *   B357 — the user-sized bump-out KEPT along/proj 80×70 across the load/save round-trip (it
 *          was not reset to the 55×60 default).
 * Runs logged-out (sandbox blocks sign-in); the logged-out localStorage store is the same code
 * path used signed-in. The real diverged site (cloud `smqdxst8pf3g`) still needs a signed-in
 * click-through — logged in VERIFICATION.md. NOTE: feet-space data (rot/cx/cy/along/proj) is
 * basemap-independent, so it's reliable even though headless has no basemap (NaN screen coords).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SITES_KEY = "planarfit:sites:v1";
const CURRENT_KEY = "planarfit:currentSite:v1";

const results = [];
const ok = (n, p, d) => { results.push(p); console.log(`${p ? "PASS ✅" : "FAIL ❌"}  ${n}  —  ${d}`); };
const norm = (a) => ((a % 360) + 360) % 360;

// Place a child's correct-at-0° centre as if the host were rotated to θ (the leak: the host was
// later straightened to 0° but the child kept θ in both its angle AND its position).
const THETA = 359.035;
function placedFor(cx, cy, rotOffset = 0) {
  const r = (THETA * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { cx: cx * c - cy * s, cy: cx * s + cy * c, rot: norm(THETA + rotOffset) };
}

function seed() {
  const id = "sJACINT";
  const parcels = [{ id: "p1", points: [[0, 0], [600, 0], [600, 700], [0, 700]], locked: true }];
  const H = { id: "H", type: "building", cx: 0, cy: 0, w: 300, h: 638, rot: 0, dock: "cross" };
  // correct-at-0° centres (bottom face): sidewalk, court beyond it, two bottom corner bumps
  const els = [
    H,
    { id: "SW", type: "sidewalk", attachedTo: "H", w: 300, h: 5, ...placedFor(0, 321.5), sidewalkSide: "bottom" },
    { id: "TC", type: "paving", attachedTo: "H", w: 300, h: 135, truckCourt: { side: "bottom" }, ...placedFor(0, 386.5) },
    // a DEFAULT bump (left corner) and a USER-SIZED bump (right corner, along 80 / proj 70)
    { id: "BL", type: "building", attachedTo: "H", noFit: true, noLabel: true, dock: "none",
      dogEar: { side: "bottom", sign: -1 }, w: 55, h: 60, ...placedFor(-122.5, 349) },
    { id: "BR", type: "building", attachedTo: "H", noFit: true, noLabel: true, dock: "none",
      dogEar: { side: "bottom", sign: 1, along: 80, proj: 70 }, w: 80, h: 70, ...placedFor(110, 354) },
    // a correctly-bonded child (rot already 0) — must be left untouched
    { id: "OK", type: "sidewalk", attachedTo: "H", w: 5, h: 638, cx: -152.5, cy: 0, rot: 0, sidewalkSide: "left" },
  ];
  const site = { id, groupId: id, site: "Jacintoport (seed)", name: "Concept A",
    origin: { lat: 29.78, lon: -95.1 }, county: "harris", parcels, els, measures: [], callouts: [],
    markups: [], settings: {}, underlay: null, status: "active", updatedAt: Date.now() };
  return { sites: JSON.stringify({ [id]: site }), cur: id, id };
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage();
  const errs = [];
  const isSeedNoise = (t) =>
    /attribute \w+: (Expected|.*NaN)/i.test(t) || /NaN/.test(t) ||
    /CORS|ERR_FAILED|Failed to load resource|Access to fetch/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isSeedNoise(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => { if (!isSeedNoise(String(e))) errs.push(String(e)); });

  try {
    const { sites, cur, id } = seed();
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.evaluate(([k, v, ck, cv]) => { localStorage.setItem(k, v); localStorage.setItem(ck, cv); }, [SITES_KEY, sites, CURRENT_KEY, cur]);
    await page.reload({ waitUntil: "networkidle" });
    // Resume lands in the planner (a real DOM node renders → not a blank screen / crash).
    await page.waitForSelector('[title="Switch or rename plan"]', { timeout: 15000 });
    ok("boots-and-renders", true, "seeded drifted assembly + custom bump → planner rendered, no crash");

    // One tiny edit (toggle snap) fires the debounced autosave, which re-persists the model.
    await page.keyboard.press("s");
    await page.waitForTimeout(700);
    await page.keyboard.press("s");
    await page.waitForTimeout(900);

    const saved = await page.evaluate(([k, sid]) => {
      const all = JSON.parse(localStorage.getItem(k) || "{}");
      return (all[sid] && all[sid].els) || null;
    }, [SITES_KEY, id]);
    if (!saved) throw new Error("no saved els read back from localStorage");

    const by = (eid) => saved.find((e) => e.id === eid);
    // B358 — every drifted child snapped to the host's 0°
    const drifted = ["SW", "TC", "BL", "BR"];
    const rots = drifted.map((eid) => norm(by(eid).rot));
    const allStraight = rots.every((r) => Math.min(r, 360 - r) < 0.01);
    ok("B358-children-resynced", allStraight, `drifted children rots → [${rots.map((r) => r.toFixed(3)).join(", ")}] (want all ≈ 0°)`);

    // the correctly-bonded child kept its angle (and wasn't shoved around)
    const okChild = by("OK");
    ok("B358-correct-child-untouched", norm(okChild.rot) === 0 && Math.abs(okChild.cx - (-152.5)) < 0.01 && Math.abs(okChild.cy) < 0.01,
      `correct child rot=${norm(okChild.rot)} cx=${okChild.cx.toFixed(2)} cy=${okChild.cy.toFixed(2)} (want 0 / -152.5 / 0)`);

    // B357 — the user-sized bump KEPT its 80×70, default bump stayed 55×60
    const br = by("BR"), bl = by("BL");
    ok("B357-user-size-persists", br.dogEar.along === 80 && br.dogEar.proj === 70,
      `right bump dogEar={along:${br.dogEar.along}, proj:${br.dogEar.proj}} (want 80/70, NOT reset to 55/60)`);
    ok("B357-default-bump-unchanged", bl.dogEar.along == null && bl.dogEar.proj == null,
      `left bump kept the default (no stored size): along=${bl.dogEar.along}, proj=${bl.dogEar.proj}`);

    ok("no-console-errors", errs.length === 0, errs.length ? `console errors: ${errs.slice(0, 3).join(" | ")}` : "clean boot, no genuine JS errors");
  } catch (e) {
    ok("harness", false, "threw: " + e.message);
  } finally {
    await browser.close();
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
