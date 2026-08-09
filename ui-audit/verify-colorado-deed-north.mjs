/* NEW-2 (B290241/B290242) — DOES THE CORRECTED GRID-NORTH ROTATION REACH THE SCREEN, AND BY HOW MUCH?
 *
 * The unit suite proves the ANGLE is right and goes red under mutation. It cannot prove the angle
 * reaches the drawing, or that the honest-null branch says something a person can act on — and this
 * repo has shipped a correct number that no surface rendered often enough (B1127, #848) that the
 * pixel check is the one that counts.
 *
 * This is deliberately NOT parked as a live-verify item. It needs no sign-in, no external GIS and no
 * real project data: a Colorado plan with a plotted deed and NO county parcel is exactly the
 * "raw land not in county records yet" case the grid-north fallback exists for, and it seeds from
 * localStorage (the verify-b1105-mhfd-panel precedent). ATTEMPT-BEFORE-YOU-PARK.
 *
 * What it measures, per site: the deed's vertex geometry BEFORE and AFTER "Rotate to grid north",
 * the rotation that implies, and the toast the app shows. Colorado must turn by its own zone's
 * convergence (+0.38° at Johnstown), Texas by 2278's (+1.56° at Katy), and ground outside every
 * modelled zone must turn by NOTHING and say so.
 *
 * Run: npm run build && node ui-audit/verify-colorado-deed-north.mjs
 */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const local = !process.env.BASE_URL;
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";

const pass = [], fail = [];
const check = (ok, label, detail = "") => {
  (ok ? pass : fail).push(label);
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `  · ${detail}` : ""}`);
};

let server = null;
async function serve() {
  if (!local) return;
  server = spawn("npx", ["vite", "preview", "--port", "4173", "--host"], { stdio: "ignore", detached: true });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("preview server never came up");
}

/* A deliberately ASYMMETRIC deed ring (feet, planner frame). A square is its own 90° alias and a
 * near-symmetric outline makes a small rotation hard to measure; this one has a distinct long axis
 * so the recovered angle is unambiguous. NO parcel is seeded — that is the branch under test. */
const DEED = [
  { x: -700, y: -400 }, { x: 700, y: -430 }, { x: 690, y: 380 }, { x: -60, y: 420 }, { x: -710, y: 300 },
];

const PLANS = [
  { key: "johnstown", name: "Johnstown CO", gid: "g-co", sid: "s-co", origin: { lat: 40.337, lon: -104.912 }, county: "co_weld", expectDeg: 0.378, tol: 0.02 },
  { key: "denver", name: "Denver CO", gid: "g-co2", sid: "s-co2", origin: { lat: 39.74, lon: -104.99 }, county: "co_denver", expectDeg: 0.320, tol: 0.02 },
  { key: "katy", name: "Katy TX", gid: "g-tx", sid: "s-tx", origin: { lat: 29.78, lon: -95.80 }, county: "harris", expectDeg: 1.560, tol: 0.02 },
  // Outside every modelled zone: the app must refuse rather than rotate by a projection that does
  // not govern there. Before this fix it turned Chicago ground by the Texas cone.
  { key: "chicago", name: "Chicago (unmodelled)", gid: "g-il", sid: "s-il", origin: { lat: 41.88, lon: -87.63 }, county: null, expectDeg: null },
];

/* The angle a rigid rotation actually applied, recovered from the geometry rather than from
 * anything the app reports about itself: the mean turn of every vertex about the centroid. */
const recoverRotation = (before, after) => {
  const cen = (p) => ({ x: p.reduce((s, q) => s + q.x, 0) / p.length, y: p.reduce((s, q) => s + q.y, 0) / p.length });
  const c0 = cen(before), c1 = cen(after);
  let sx = 0, sy = 0;
  for (let i = 0; i < before.length; i++) {
    const a = { x: before[i].x - c0.x, y: before[i].y - c0.y };
    const b = { x: after[i].x - c1.x, y: after[i].y - c1.y };
    sx += a.x * b.x + a.y * b.y;               // Σ |a||b| cos θ
    sy += a.x * b.y - a.y * b.x;               // Σ |a||b| sin θ
  }
  return (Math.atan2(sy, sx) * 180) / Math.PI;
};

const run = async () => {
  await serve();
  const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
  // ⛔ --ignore-certificate-errors: the sandbox TLS-inspection proxy (docs/REFERENCE.md).
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  // ⛔ FOREGROUND-OR-VOID — a background tab's geometry is a stale frame that agrees with itself.
  await assertMeasurable(page, "verify-colorado-deed-north");
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  await page.evaluate(({ sk, plans, deed }) => {
    const store = {};
    for (const p of plans) {
      store[p.sid] = {
        schemaVersion: 2, id: p.sid, groupId: p.gid, site: p.name, name: "Deed",
        origin: p.origin, county: p.county,
        parcels: [],                       // NO county parcel — the grid-north fallback's own case
        els: [],
        markups: [{ id: "deed1", kind: "encumbrance", label: "Tract 1", pts: deed, closed: true }],
        measures: [], callouts: [], settings: {},
      };
    }
    localStorage.setItem(sk, JSON.stringify(store));
  }, { sk: SITES_KEY, plans: PLANS, deed: DEED });

  const deedPts = () => page.evaluate(({ sk, sid }) => {
    const m = (JSON.parse(localStorage.getItem(sk))[sid].markups || []).find((x) => x.id === "deed1");
    return m ? m.pts : null;
  }, { sk: SITES_KEY, sid: page.__sid });

  for (const plan of PLANS) {
    console.log(`\n── ${plan.name} @ ${plan.origin.lat},${plan.origin.lon} ${plan.county ? `(${plan.county})` : "(no county)"}`);
    page.__sid = plan.sid;
    await page.evaluate(({ ck, sid }) => localStorage.setItem(ck, sid), { ck: CUR_KEY, sid: plan.sid });
    await page.goto(`${BASE}#/project/${plan.gid}/site`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(6000);

    const before = await deedPts();
    if (!before) { check(false, `${plan.key}: the deed seeded`, "no encumbrance markup in the store"); continue; }

    /* Reach the action the way a user does. Two things this needs and a synthetic dispatch does
     * not give you: a REAL CDP right-click (React's handlers run off real pointer events), and a
     * zoom-to-fit first — a plan with NO parcel never fits the deed, so its box lands partly
     * off-screen and a click at its centre misses the canvas entirely. */
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button, div")].filter((e) => e.textContent.trim() === "⤢" && e.getBoundingClientRect().width > 0);
      if (btns.length) btns[btns.length - 1].click();
    });
    await page.waitForTimeout(1200);
    const box = await page.evaluate(() => {
      const n = document.querySelector('[data-feature^="markup:"]');
      if (!n) return null;
      const r = n.getBoundingClientRect();
      // Clamp to the visible viewport so the press lands on the deed AND on the page.
      const x = Math.min(Math.max(r.left + r.width / 2, 8), window.innerWidth - 8);
      const y = Math.min(Math.max(r.top + r.height / 2, 8), window.innerHeight - 8);
      return { x, y };
    });
    if (!box) { check(false, `${plan.key}: the deed rendered on the canvas`, "no [data-feature^=markup:] node"); continue; }
    await page.mouse.click(box.x, box.y, { button: "right" });
    await page.waitForTimeout(1200);
    /* The row's OWN text, not an ancestor's — every menu wrapper also "contains" the label, and
     * taking the last container instead of the leaf is what made the first run report "not found"
     * against a menu that was open on screen. */
    const clicked = await page.evaluate(() => {
      const row = [...document.querySelectorAll("div, button")].find((e) =>
        /^(Rotate to grid north|Align to county parcel)$/.test((e.textContent || "").trim())
        && e.getBoundingClientRect().width > 0
        && !e.querySelector("div, button"));
      if (!row) return null;
      const label = row.textContent.trim();
      row.click();
      return label;
    });
    check(!!clicked, `${plan.key}: reached the deed's "Rotate to grid north" action`, clicked ? `menu row: "${clicked}"` : `selected=${fired}; menu row not found`);
    if (!clicked) continue;
    await page.waitForTimeout(2000);

    const toast = await page.evaluate(() => {
      const t = [...document.querySelectorAll("div")]
        .map((e) => e.textContent || "")
        .filter((s) => /grid convergence|State Plane|Rotated the deed|no grid rotation|doesn't carry a State Plane zone/i.test(s))
        .sort((a, b) => a.length - b.length)[0];
      return t ? t.slice(0, 320) : null;
    });
    const after = await deedPts();
    const turned = after ? recoverRotation(before, after) : null;
    console.log(`     toast: ${toast ? toast.replace(/\s+/g, " ") : "(none)"}`);
    console.log(`     geometry turned by: ${turned == null ? "n/a" : turned.toFixed(4) + "°"}`);

    if (plan.expectDeg == null) {
      // The honest-unknown branch: nothing moves, and the app SAYS why.
      check(turned != null && Math.abs(turned) < 1e-6, `${plan.key}: the deed was NOT rotated`, `turned ${turned == null ? "n/a" : turned.toFixed(6)}°`);
      check(!!toast && /doesn't carry a State Plane zone/i.test(toast), `${plan.key}: the toast names the reason it refused`, toast || "(no toast)");
    } else {
      check(turned != null && Math.abs(turned - plan.expectDeg) < plan.tol,
        `${plan.key}: rotated by its OWN zone's convergence (${plan.expectDeg}°)`,
        `measured ${turned == null ? "n/a" : turned.toFixed(4)}°`);
      // The defect this replaces: the Texas cone answered ~−2.9° on every Colorado site.
      if (plan.key !== "katy") {
        check(turned != null && turned > 0, `${plan.key}: the SIGN is Colorado's, not Texas's`, `Texas cone answered −2.9° here`);
      }
      check(!!toast && /grid convergence/i.test(toast), `${plan.key}: the toast reports the rotation`, toast || "(no toast)");
    }
  }

  if (errs.length) console.log("\n⚠ page errors:\n" + errs.slice(0, 6).join("\n"));
  console.log(`\n${fail.length ? "❌" : "✅"} ${pass.length} passed · ${fail.length} failed`);
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch { /* gone */ } }
  process.exit(fail.length ? 1 : 0);
};

run().catch((e) => { console.error(e); if (server) { try { process.kill(-server.pid); } catch { /* gone */ } } process.exit(1); });
