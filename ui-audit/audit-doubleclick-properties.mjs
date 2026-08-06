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
  ...ELS.map((e) => [e.id, `element ${e.type}`]),
  ...MARKUPS.map((m) => [m.id, `markup ${m.kind}${m.mode ? ` (${m.mode})` : ""}`]),
]);

const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Double-click audit", name: "Plan 1",
  origin: null, county: null, parcels: [], measures: [], callouts: [], underlay: null,
  els: ELS.map((e) => ({ ...e, locked: LOCKED || undefined })),
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

      const answers = (x, y) => {
        const n = document.elementFromPoint(x, y);
        const f = n && n.closest ? n.closest("[data-feature]") : null;
        return !!f && f.getAttribute("data-feature") === key;
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
    ...ELS.map((e) => ({ id: e.id, kind: "el" })),
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

    await doubleClick(pt.x, pt.y);
    const opened = await panelOpen();

    if (LOCKED) {
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
