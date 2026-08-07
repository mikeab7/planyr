/* NEW-4 — THE CLICK-CONTRACT AUDIT: does a double-click open Properties, on every drawable thing?
 *
 * Nothing in this repo could see the double-click contract end to end. `e2e/click-contract.spec.js`
 * drives nine declared types; the source guards read code, not pixels. So a defect that killed the
 * gesture on the OWNER's plan (Bain / "Concept A — Quiddity Hydrologic") survived every green build
 * — and the type it actually broke, a centerline road, was the one nothing drove.
 *
 * This harness seeds ONE of every element type and every markup kind — including all THREE easement
 * modes — double-clicks each on the real canvas, and asserts `[data-testid="property-panel"]`
 * appears. It is a screening sweep for the whole surface, not a substitute for the specs.
 *
 *   node ui-audit/audit-doubleclick-properties.mjs            # every feature, at its shape CENTRE
 *   node ui-audit/audit-doubleclick-properties.mjs --labels   # …at its LABEL / dimension number
 *   node ui-audit/audit-doubleclick-properties.mjs --locked   # …with every feature LOCKED
 *
 * Needs `npm run preview` on :4173 (or BASE_URL). Runs logged out, no external GIS, no real data.
 *
 * ── THE --labels VARIANT IS NOT AN EXTRA, AND IT PRIMES THE SELECTION FIRST — ON PURPOSE. The
 *    owner double-clicks where his EYE is, and his eye is on the label, not on the centroid of the
 *    polygon. Two of the three defects this audit was built for live off-centre: a road's width
 *    number is painted on the pavement (NEW-3), and a pond's label can overhang its basin.
 *    Crucially, a detail-tier dimension number DOES NOT EXIST until its element is selected — so an
 *    unprimed probe cannot find it, silently falls back to the shape centre, and reports a green
 *    that proves nothing. (Verified: with NEW-3's fix reverted, the unprimed centre probe still
 *    passed, because press 2 landed on the dimension GRAB BAND instead of the number.) That is the
 *    named CHROME-NEVER-EATS-A-PRESS worst case — chrome a static reading cannot see — so this mode
 *    selects the feature, waits for the tap record to lapse, and then probes what appeared.
 *
 * ── THE --locked VARIANT MAKES A CARVE-OUT INTO A DECISION. A locked feature is select-only: the
 *    double-click selects it and does NOT open Properties. That is deliberate (locking guards the
 *    object from stray edits) but it was never written down or tested, so it was indistinguishable
 *    from a bug. Here it is asserted in the direction it actually holds, so changing it is a choice.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * ⛔ FIXTURE TRAPS — recorded so nobody pays for them twice. Every one of these cost a debugging
 *    session on the first run of this audit, and every one is silent (green build, wrong picture):
 *
 *  1. A CENTERLINE ROAD SEEDED WITHOUT ITS STRIP BBOX gives NaN bounds, and zoom-to-fit then
 *     collapses the ENTIRE SCENE into the top-left corner — every other feature's coordinates go
 *     wrong at once, so it reads as "the whole harness is broken". A road row is `{ pts, vtx }`
 *     PLUS the `roadStripBBox(pts, vtx, travelW, curb, { defaultRadius })` spread (cx/cy/w/h/rot).
 *     This harness derives that spread itself (`roadBBox` below) rather than hand-writing numbers.
 *
 *  2. A `utilRoute` WITHOUT `pad` CRASHES THE WHOLE WORKSPACE RENDER — "Cannot read properties of
 *     undefined (reading 'map')" — because the render maps `m.pad` unconditionally. Not a blank
 *     markup: a blank app. Seed `pts` + `corridor` + `pad` together, always.
 *
 *  3. `[title="Zoom to fit"]` MATCHES THE HEADER'S FULLSCREEN GLYPH FIRST. There are two controls
 *     with that title and the header one wins the query, so "fit the view" silently did nothing.
 *     Take the fit control from INSIDE the canvas zoom stack (see `fitView`).
 *
 *  4. A MARKUP CANNOT BE LOCATED BY AN nth-MATCH ON A SHARED PATTERN FILL. Several kinds paint with
 *     the same hatch, so an index-based pick crossed the boundary easement with the polyline — the
 *     pass/fail verdict was right and the NAME on it was wrong, which is worse than a plain failure.
 *     Every seeded markup here carries its OWN unique stroke colour, and is located by that colour.
 *
 *  5. ZOOM-TO-FIT FRAMES PARCELS + ELEMENTS + THE UNDERLAY. IT DOES NOT LOOK AT MARKUPS. So a
 *     fixture that puts its markups outside the ELEMENT extent renders half of them off-canvas and
 *     every one of those probes fails looking exactly like a broken contract. The layout below
 *     therefore parks elements in the FIRST and LAST grid rows on purpose, so the element bounds
 *     enclose every markup. (`fit` is at SitePlanner.jsx's `const fit = useCallback`; the harness
 *     also asserts the plan really is on screen before probing anything — see `contentFill`.)
 *
 *  6. AN ELEMENT IS CENTRED ON `cx`/`cy`, NOT `x`/`y`, AND SO IS A `rect`/`ellipse` MARKUP. Seeding
 *     x/y leaves the centre undefined, every derived corner is NaN, and the whole plan lands off
 *     the canvas — TRAP 1's symptom again, from a different cause. Both are silent.
 *
 *  7. AN OPEN-PATH MARKUP (line, polyline, traced, infwater) DRAWN AXIS-ALIGNED HAS A ZERO-HEIGHT
 *     BOUNDING BOX. A probe that requires both width AND height skips it and reports "did not
 *     render", which reads as a missing feature rather than a flat one.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const LOCKED = process.argv.includes("--locked");
const LABELS = process.argv.includes("--labels");
const MODE = LOCKED ? "locked" : LABELS ? "labels" : "centres";

/* ---- the fixture ---------------------------------------------------------------------------
 * One of everything, laid out on a grid in world FEET so nothing overlaps and every probe point
 * is unambiguous. Each row declares how to find itself on screen (`find`) and, for --labels, where
 * its label / dimension number sits relative to the shape (`labelAt`).
 */
const SITE_ID = "zz-dblclick-audit";
const COL = 520, ROW = 430;                      // grid pitch, feet — 5 wide × 4 deep ≈ the viewport
const at = (c, r) => ({ x: 400 + c * COL, y: 400 + r * ROW });
/* ⛔ AN ELEMENT IS CENTRED ON `cx`/`cy`, NOT `x`/`y` (and so is a `rect`/`ellipse` MARKUP). Seeding
 * x/y leaves cx/cy undefined, every derived corner comes out NaN, and zoom-to-fit then puts the
 * whole plan off the canvas — the same silent, whole-scene symptom as TRAP 1. */
const rect = (c, r, w = 300, h = 200, extra = {}) => { const p = at(c, r); return { cx: p.x, cy: p.y, w, h, rot: 0, ...extra }; };
const ring = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];

/* TRAP 1 — a centerline road MUST carry its derived strip bbox or the whole scene's fit breaks. */
function roadBBox(pts, travelW, curb) {
  const vtx = pts.map(() => ({}));
  return { pts, vtx, travelW, curb, ...roadStripBBox(pts, vtx, travelW, curb, { defaultRadius: 40 }) };
}

let n = 0;
const eid = () => `zzel${++n}`;
const mid = () => `zzmk${++n}`;

/* ELEMENTS — every drawable type. TRAP 5: they occupy the FIRST and LAST grid rows so the element
 * extent (which is all zoom-to-fit looks at) encloses every markup seeded between them. */
const ELS = [
  { id: eid(), type: "building", ...rect(0, 0, 360, 220), label: "Building" },
  { id: eid(), type: "parking", ...rect(1, 0, 300, 180), label: "Car Parking" },
  { id: eid(), type: "paving", ...rect(2, 0, 300, 180), label: "Paving" },
  { id: eid(), type: "trailer", ...rect(3, 0, 300, 120), label: "Trailer Parking" },
  { id: eid(), type: "sidewalk", ...rect(4, 0, 300, 60), label: "Sidewalk" },
  { id: eid(), type: "pond", ...rect(0, 3, 320, 220), label: "Detention Pond" },
  /* ⛔ THE FIXTURE'S POND USED TO BE THE BARE RECT ABOVE, AND THAT IS HOW THIS HARNESS CERTIFIED A
   * POND 19/19 WHILE THE OWNER'S REAL DETENTION POND WAS REPORTED DEAD ON THE SAME BUILD (B227940).
   * A real pond is not a rect with a label: it carries a detention record, it is often an irregular
   * POLYGON rather than a rect (so it renders through a different branch of renderElPx entirely),
   * and it may carry an expansion BASELINE that paints a second fill over the basin. Each of those
   * is a different render path, so each gets a row — a type name in a fixture is not a class. */
  { id: eid(), type: "pond", variant: "polygon", ...rect(3, 3, 320, 220), points: ring(at(3, 3).x, at(3, 3).y, 320, 220), label: "Pond (irregular)" },
  { id: eid(), type: "pond", variant: "rect + detention", ...rect(0, 4, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (detention)" },
  { id: eid(), type: "pond", variant: "polygon + detention", ...rect(1, 4, 320, 220), points: ring(at(1, 4).x, at(1, 4).y, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (irregular, detention)" },
  { id: eid(), type: "pond", variant: "polygon + expansion baseline", ...rect(2, 4, 320, 220), points: ring(at(2, 4).x, at(2, 4).y, 320, 220),
    det: { ...{ role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, baseline: { ring: ring(at(2, 4).x, at(2, 4).y, 200, 140) } }, label: "Pond (expanded)" },
  /* A GROUPED pair. Its double-click is B261 DRILL-IN, not Properties — asserted in the direction it
   * actually holds (below), so the one element class whose double-click deliberately does NOT open
   * the panel is PINNED rather than left to look like a pass. */
  { id: eid(), type: "pond", variant: "grouped", groupId: "zzgrp1", ...rect(3, 4, 320, 220), det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 }, label: "Pond (grouped)", drillOnly: true },
  { id: eid(), type: "building", variant: "grouped", groupId: "zzgrp1", ...rect(4, 4, 240, 160), label: "Building (grouped)", drillOnly: true },
  // TRAP 1 in action: pts + vtx + the roadStripBBox spread, never hand-written bounds.
  { id: eid(), type: "road", label: "Road", roadClass: "truck",
    ...roadBBox([{ x: at(4, 3).x - 200, y: at(4, 3).y }, { x: at(4, 3).x + 200, y: at(4, 3).y }], 30, 1) },
];

/* MARKUPS — every kind, with all THREE easement modes, parked in the two middle rows plus the two
 * free slots on the bottom row. TRAP 4: each carries a UNIQUE stroke colour and is located by it,
 * never by an nth-match on a shared hatch fill. */
const MK_SLOTS = [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [1, 3], [2, 3]];
let sl = 0;
const mkAt = () => { const [c, r] = MK_SLOTS[sl++]; return at(c, r); };
const MARKUPS = [
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "centerline", stroke: "#ff0001", width: 60,
    centerline: [{ x: p.x - 180, y: p.y }, { x: p.x + 180, y: p.y }],
    pts: [{ x: p.x - 180, y: p.y - 30 }, { x: p.x + 180, y: p.y - 30 }, { x: p.x + 180, y: p.y + 30 }, { x: p.x - 180, y: p.y + 30 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "boundary", stroke: "#ff0002", pts: ring(p.x, p.y, 300, 180) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "easement", mode: "parceledge", stroke: "#ff0003", width: 50,
    centerline: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }],
    pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }, { x: p.x + 150, y: p.y + 50 }, { x: p.x - 150, y: p.y + 50 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "line", stroke: "#ff0004", weight: 3, a: { x: p.x - 150, y: p.y }, b: { x: p.x + 150, y: p.y } }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "polyline", stroke: "#ff0005", weight: 3, pts: [{ x: p.x - 150, y: p.y + 60 }, { x: p.x, y: p.y - 60 }, { x: p.x + 150, y: p.y + 60 }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "polygon", stroke: "#ff0006", weight: 3, fill: "#ff0006", fillOpacity: 0.25, pts: ring(p.x, p.y, 280, 180) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "rect", stroke: "#ff0007", weight: 3, fill: "#ff0007", fillOpacity: 0.25, cx: p.x, cy: p.y, w: 280, h: 180, rot: 0 }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "ellipse", stroke: "#ff0008", weight: 3, fill: "#ff0008", fillOpacity: 0.25, cx: p.x, cy: p.y, w: 280, h: 180, rot: 0 }; })(),
  // TRAP 2 — `pad` is not optional: without it the WORKSPACE render throws and the app is blank.
  (() => { const p = mkAt(); const c = { x: p.x + 150, y: p.y };
    return { id: mid(), kind: "utilRoute", util: "water", stroke: "#ff0009", width: 40, label: "Water service",
      pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }],
      corridor: [{ x: p.x - 150, y: p.y - 20 }, { x: p.x + 150, y: p.y - 20 }, { x: p.x + 150, y: p.y + 20 }, { x: p.x - 150, y: p.y + 20 }],
      pad: ring(c.x, c.y, 40, 40) }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "traced", stroke: "#ff000a", weight: 3, label: "Overhead electric (traced)", pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "infwater", stroke: "#ff000b", weight: 3, dash: "dashed", label: "Inferred water main", pts: [{ x: p.x - 150, y: p.y }, { x: p.x + 150, y: p.y }] }; })(),
  (() => { const p = mkAt(); return { id: mid(), kind: "encumbrance", stroke: "#ff000c", weight: 3, label: "Encumbrance", pts: ring(p.x, p.y, 280, 180), centerline: [] }; })(),
];

const NAMES = new Map([
  ...ELS.map((e) => [e.id, `element ${e.type}${e.variant ? ` · ${e.variant}` : ""}`]),
  ...MARKUPS.map((m) => [m.id, `markup ${m.kind}${m.mode ? ` (${m.mode})` : ""}`]),
]);

const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Double-click audit", name: "Plan 1",
  origin: null, county: null, parcels: [], measures: [], callouts: [], underlay: null,
  els: ELS.map(({ variant, drillOnly, ...e }) => ({ ...e, locked: LOCKED || undefined })),
  markups: MARKUPS.map((m) => ({ ...m, locked: LOCKED || undefined })),
  settings: { showDims: true }, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE_ID]: site }))});
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

/* ---- reporting ------------------------------------------------------------------------------ */
const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  /* Open the seeded project through the real project picker. Seeding `currentSite` instead looks
   * like a shortcut and is not one — the app boots to the landing / map surface and the planner
   * canvas never mounts, so every probe below times out for a reason that has nothing to do with
   * the contract under test. */
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator(`button:has-text(${JSON.stringify(site.site)})`).first().click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1200);

  // TRAP 2's tripwire: a fixture that crashes the render leaves a blank workspace and every probe
  // below then "fails" for the wrong reason. Say so once, loudly, instead of 19 times misleadingly.
  if (pageErrors.length) {
    console.log("\n⛔ THE FIXTURE CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 200)));
    process.exit(1);
  }

  /* TRAP 3 — take the fit control from INSIDE the canvas zoom stack. `[title="Zoom to fit"]` also
   * matches the header's fullscreen glyph, which wins the query and silently does nothing. */
  /* How much of the canvas the seeded plan actually occupies. This is the CHECK that turns TRAP 3
   * from a comment into something the harness can notice: a fit that silently did nothing leaves
   * every feature a few px across, huddled at the top-left, and then all 19 probes "fail" for a
   * reason that has nothing to do with the click contract. */
  const contentFill = () => page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll("[data-el-id],[data-mk-id]")].map((g) => g.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return 0;
    const x0 = Math.min(...boxes.map((b) => b.left)), x1 = Math.max(...boxes.map((b) => b.right));
    const y0 = Math.min(...boxes.map((b) => b.top)), y1 = Math.max(...boxes.map((b) => b.bottom));
    return Math.min((x1 - x0) / c.width, (y1 - y0) / c.height);
  });

  async function fitView() {
    /* TRAP 3 — `[title="Zoom to fit"]` matches the HEADER's fullscreen glyph as well as the canvas
     * zoom stack's real fit control, and the header one wins a naive query. Try every match until
     * the plan is actually on screen, rather than trusting one of them. */
    const fits = page.locator('button[title="Zoom to fit"]');
    const n = await fits.count();
    for (let i = n - 1; i >= 0; i--) {                       // the canvas stack's is the LAST one
      await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await contentFill() > 0.3) return true;
    }
    return false;
  }
  if (!await fitView()) {
    console.log(`\n⛔ ZOOM-TO-FIT DID NOTHING — the plan is not on screen (fill ${(await contentFill()).toFixed(3)}).`);
    console.log("   Every probe below would fail for the wrong reason. See TRAP 1 and TRAP 3 in the header.");
    process.exit(1);
  }

  const panelOpen = () => page.locator('[data-testid="property-panel"]').count().then((c) => c > 0);
  /* ⛔ SELECTION HAS TO BE READ, NOT ASSUMED — and it has to be able to reach ZERO first.
   * The owner's pond report was "no panel, NO SELECTION", and this harness could not see the second
   * half at all: it asserted the panel and nothing else, so a feature that silently refuses to
   * select was indistinguishable from one that selects fine. Elements carry no per-feature
   * "selected" stamp, so selection is read off the ONE handle layer; a markup also stamps itself.
   * The deselect below is a PRECONDITION, not politeness: if handles never clear, `handles > 0`
   * would pass for every feature whether or not the press did anything — a green that means
   * nothing, which is the exact failure mode this whole audit exists to prevent. */
  const selectionCount = () => page.evaluate(() =>
    document.querySelectorAll('[data-handle-layer] *').length
    + document.querySelectorAll('[data-testid="markup-selected"], [data-testid="measure-selected"], [data-testid="selection-chrome"], [data-testid="selection-ring"]').length);
  /* Escape alone does NOT reliably clear the canvas selection (measured: it closed the panel and
   * left 45 handle nodes up), so the deselect presses EMPTY CANVAS — the same way a user drops a
   * selection. The empty point is found by asking the document, never hard-coded: a fixture whose
   * layout shifts would otherwise "clear" by pressing some other feature. */
  async function emptyPoint() {
    return page.evaluate(() => {
      const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
      for (const fx of [0.5, 0.08, 0.92]) for (const fy of [0.06, 0.94, 0.5]) {
        const x = Math.round(c.left + c.width * fx), y = Math.round(c.top + c.height * fy);
        const n = document.elementFromPoint(x, y);
        if (n && n.closest && !n.closest("[data-feature]") && !n.closest("[data-handle-layer]")) return { x, y };
      }
      return null;
    });
  }
  async function deselect() {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    if (await selectionCount() > 0) {
      const e0 = await emptyPoint();
      if (e0) { await page.mouse.click(e0.x, e0.y); await page.waitForTimeout(200); }
    }
    return await selectionCount();
  }
  const closePanel = async () => {
    const x = page.locator('button[aria-label="Close properties"]');
    if (await x.count()) await x.first().click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  };

  /* WHERE TO PRESS FOR A FEATURE — and the point must be one the feature actually ANSWERS TO.
   *
   * A bounding-box centre is not good enough and the failures are instructive: a polyline drawn as
   * a "V" has its box centre in the empty air between the arms, and a `traced` line's box is
   * inflated by its own text label so the centre slides off the stroke. Both would have been
   * reported as "double-click does nothing" — a false accusation against a working contract, which
   * is worse than no audit at all.
   *
   * So candidates are generated from the RENDERED geometry (segment midpoints, then the box
   * centre) and each is validated with `elementFromPoint`: the first point whose topmost node
   * resolves to THIS feature's `data-feature` stamp wins. That is the same question the browser
   * asks when the user presses, so a point that passes here is a point the user could have hit.
   *
   * In `labels` mode the dimension number / map label is tried FIRST — the owner double-clicks
   * where his eye is, and his eye is on the label. If the label is pointer-transparent the press
   * falls through to the shape and still resolves to the same feature, which is a pass and is
   * reported as such (`via`), not hidden. */
  async function probePoint(id, kind) {
    return page.evaluate(({ id, kind, labels }) => {
      const key = `${kind}:${id}`;
      const sel = kind === "el" ? `[data-el-id="${id}"]` : `[data-mk-id="${id}"]`;
      const g = document.querySelector(sel);
      if (!g) return null;

      /* ⛔ IN CENTRES MODE THE POINT MUST LAND ON THE FEATURE'S BODY, NOT ON ITS DIMENSION CHROME
       * (B227940). This is the hole that let this harness certify a pond that could not be clicked
       * at all: `pointer-events` is INHERITED, but a child may override it, and the dimension
       * number sets its own `pointer-events: all`. So a pond whose entire group was pointer-DEAD
       * still had one live child, the probe found it, NEW-3 forwarded the press from the number to
       * the body's action, and the row passed — 19/19 green over an element the user cannot press.
       * Proven, not theorised: with the pond group forced to `pointer-events: none` the suite still
       * reported 50/50 before this guard, and goes red with it.
       * `--labels` is the deliberate exception: probing the label/number IS its whole purpose. */
      const answers = (x, y) => {
        const n = document.elementFromPoint(x, y);
        const f = n && n.closest ? n.closest("[data-feature]") : null;
        if (!f || f.getAttribute("data-feature") !== key) return false;
        if (!labels) {
          // The BODY is geometry. Text chrome (the map label's <text>/<tspan>, the dimension
          // number) is what --labels exists to probe, and accepting it here is exactly how a
          // pointer-DEAD pond passed: its label stayed live and forwarded the press to Properties.
          if (n.closest('[data-el-dim], [data-testid="el-dim"], [data-label-for]')) return false;
          const tag = (n.tagName || "").toLowerCase();
          if (tag === "text" || tag === "tspan") return false;
        }
        return true;
      };
      const push = (out, x, y, via) => { if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x: Math.round(x), y: Math.round(y), via }); };

      const cands = [];
      if (labels) {
        const dim = g.querySelector('[data-testid="el-dim"]');
        const lab = document.querySelector(`[data-label-for="${id}"]`);
        for (const [node, via] of [[dim, "dimension number"], [lab, "label"]]) {
          if (!node) continue;
          const r = node.getBoundingClientRect();
          if (r.width || r.height) push(cands, r.left + r.width / 2, r.top + r.height / 2, via);
        }
      }
      /* Segment midpoints off the rendered geometry — this is what puts the probe ON a stroke rather
       * than in the hollow of a shape. ⛔ A `points` / `x1` attribute is in SVG USER UNITS and the
       * canvas carries a pan+zoom transform, so those numbers are NOT client coordinates: feeding
       * them straight to `elementFromPoint` silently probes somewhere else entirely. Map them
       * through the node's own screen CTM. */
      const svg = g.ownerSVGElement || g.closest("svg");
      const toClient = (n, x, y) => {
        const m = n.getScreenCTM && n.getScreenCTM();
        if (!m || !svg || !svg.createSVGPoint) return null;
        const p = svg.createSVGPoint(); p.x = x; p.y = y;
        const q = p.matrixTransform(m);
        return { x: q.x, y: q.y };
      };
      for (const n of g.querySelectorAll("line, polyline, polygon, rect, ellipse, circle, path")) {
        const r = n.getBoundingClientRect();
        const mid = (x1, y1, x2, y2) => { const c = toClient(n, (x1 + x2) / 2, (y1 + y2) / 2); if (c) push(cands, c.x, c.y, "segment midpoint"); };
        if (n.tagName === "line") { mid(+n.getAttribute("x1"), +n.getAttribute("y1"), +n.getAttribute("x2"), +n.getAttribute("y2")); continue; }
        const raw = n.getAttribute("points");
        if (raw) {
          const pts = raw.trim().split(/\s+/).map((t) => t.split(",").map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
          for (let i = 0; i + 1 < pts.length; i++) mid(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
          if (pts.length > 2) mid(pts[0][0], pts[0][1], pts[pts.length - 1][0], pts[pts.length - 1][1]);
        }
        if (r.width && r.height) push(cands, r.left + r.width / 2, r.top + r.height / 2, "shape centre");
      }
      const box = g.getBoundingClientRect();
      if (box.width || box.height) push(cands, box.left + box.width / 2, box.top + box.height / 2, "group centre");
      /* INTERIOR POINTS OFF THE CENTRE. A filled feature usually carries its map label AT its
       * centre, so every centre-ish candidate resolves to the label's <text>/<tspan> — which the
       * centres-mode body rule (above) correctly rejects. Without these the probe would then
       * report a perfectly clickable pond as unreachable. These are what a user actually does:
       * press the basin somewhere that is not the writing. */
      for (const fy of [0.28, 0.72, 0.5]) for (const fx of [0.28, 0.72, 0.5]) {
        if (fx === 0.5 && fy === 0.5) continue;
        push(cands, box.left + box.width * fx, box.top + box.height * fy, "interior point");
      }

      for (const c of cands) if (answers(c.x, c.y)) return c;
      return cands.length ? { ...cands[0], via: cands[0].via + " (UNANSWERED — nothing under it claims this feature)" } : null;
    }, { id, kind, labels: LABELS });
  }

  /* Two separate down/up pairs at one point — pointer capture releases on the first up before the
   * second down, which a fast clickCount:2 cannot promise. */
  async function doubleClick(x, y) {
    await page.mouse.move(x, y);
    await page.mouse.down(); await page.mouse.up();
    await page.mouse.down(); await page.mouse.up();
    await page.waitForTimeout(180);
  }

  const targets = [
    ...ELS.map((e) => ({ id: e.id, kind: "el", drillOnly: !!e.drillOnly })),
    ...MARKUPS.map((m) => ({ id: m.id, kind: "markup" })),
  ];

  console.log(`\n=== double-click → Properties · ${targets.length} features · mode: ${MODE} ===\n`);

  for (const t of targets) {
    const name = NAMES.get(t.id);
    await closePanel();
    await page.waitForTimeout(400);          // clear the pending tap record (DBLTAP_MS = 350)

    if (LABELS) {
      /* Prime the selection so selection-only chrome EXISTS to be probed — a detail-tier dimension
       * number renders only once its element is selected, which is precisely how it ends up taking
       * press 2 of a real double-click. Then let the tap record lapse so the double-click that
       * follows is a clean pair rather than press 3 of this one. */
      const seed = await probePoint(t.id, t.kind);
      if (seed) { await page.mouse.click(seed.x, seed.y); await page.waitForTimeout(450); }
    }
    const pt = await probePoint(t.id, t.kind);
    if (!pt) { ok(`${name} — double-click opens Properties`, false, "feature did not render / has no box"); continue; }
    /* ⛔ AN UNANSWERED PROBE POINT IS A FAILURE, NOT SOMETHING TO PRESS ANYWAY (B227940).
     * This is THE hole that let the suite certify a pond nobody can click. `probePoint` falls back
     * to its first candidate when no point resolves to the feature — and the loop then pressed it,
     * the press landed on whatever lay beneath, SOME panel opened, and `panelOpen()` — which only
     * ever asked "is a panel up", never "is it THIS feature's panel" — reported a pass.
     * Measured, not argued: with the pond's own group forced to `pointer-events: none` (a pond the
     * user provably cannot press) the suite still reported 50/50; with this check it reports the
     * pond rows red and names the reason. If nothing under a feature claims it, the user cannot
     * reach it either, and that IS the bug being hunted. */
    if (String(pt.via).includes("UNANSWERED")) {
      ok(`${name} — single click selects`, false, `⛔ no point on this feature answers to it — it is unreachable by pointer (probed ${pt.x},${pt.y})`);
      ok(`${name} — double-click opens Properties`, false, `⛔ UNREACHABLE: ${pt.via}`);
      continue;
    }

    /* HALF ONE — A SINGLE CLICK SELECTS. New with B227940. This is the half the owner reported
     * ("no panel, no selection") that nothing in the repo could see. It holds in EVERY mode: a
     * locked feature is select-only (B922) and a grouped one selects its whole group (B261), so
     * "something is selected" is the common floor even where the panel deliberately stays shut. */
    const zeroed = await deselect();
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(280);
    const selN = await selectionCount();
    if (LOCKED && t.drillOnly) {
      /* ⛔ NOT A PASS, AND DELIBERATELY NOT SILENT (B227940). A LOCKED + GROUPED element paints
       * NOTHING the DOM can see when it is selected: locked suppresses the handles (B922) and an
       * element — unlike a markup — carries no per-feature "selected" stamp, so `sel` moves in
       * state with no observable consequence. That is a real gap in the selection contract and it
       * is filed, not waved through; it is reported here rather than asserted because asserting
       * either direction would pin behaviour nobody has decided on yet. */
      console.log(`SKIP — ${name} — single click selects  ::  locked+grouped paints no DOM-observable selection (filed, B227940)`);
    } else {
      ok(`${name} — single click selects`, zeroed === 0 && selN > 0,
        zeroed === 0 ? `${selN} selection node(s)` : `⛔ PRECONDITION: Escape left ${zeroed} selection node(s) — this assertion cannot mean anything until that is fixed`);
    }

    await closePanel();
    await page.waitForTimeout(420);            // let the tap record lapse (DBLTAP_MS = 350)

    // HALF TWO — the double-click contract itself.
    await doubleClick(pt.x, pt.y);
    const opened = await panelOpen();

    if (t.drillOnly) {
      /* B261 drill-in: a GROUPED element's double-click selects the member and deliberately does
       * NOT open Properties. Asserted in the direction it holds so it reads as the decision it is.
       * If this ever flips it is a product change, not a silent drift. */
      ok(`${name} — GROUPED: double-click drills in, Properties stays shut`, !opened, pt.via);
    } else if (LOCKED) {
      // The carve-out, asserted in the direction it actually holds: a locked feature SELECTS and
      // stays select-only. If this flips, it is a product decision, not a silent drift.
      const selected = await page.evaluate((id) => !!document.querySelector(`[data-mk-id="${id}"][data-testid="markup-selected"]`) || !!document.querySelector('[data-handle-layer] *'), t.id);
      ok(`${name} — LOCKED: select-only, Properties stays shut`, !opened, `${pt.via}${selected ? "" : " · nothing appeared selected either"}`);
    } else {
      ok(`${name} — double-click opens Properties`, opened, `via the ${pt.via} at ${pt.x},${pt.y}`);
    }
  }

  if (pageErrors.length) console.log("\nPAGE ERRORS:\n" + pageErrors.slice(0, 5).join("\n"));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed (mode: ${MODE})`);
if (failed.length) {
  console.log("FAILED:\n" + failed.map((f) => "  · " + f.name).join("\n"));
  process.exit(1);
}
