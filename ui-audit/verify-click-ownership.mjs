/* NEW-1 (2026-09-12) — THE CLICK-OWNERSHIP AUDIT: does a press on the canvas ALWAYS belong to the
 * thing painted under the cursor, for BOTH buttons, with ONE sanctioned exception (Alt reaches
 * behind)?
 *
 * Owner's own words: "right click on any item shouldn't click on anything else but that item."
 * And the amendment that added the exception: "The only time it should [click on something else]
 * is if we're doing the alt thing to click on something behind, make sure that feature actually
 * works."
 *
 * TWO KNOWN GAPS this harness is built to catch, both fixed by this same item:
 *  1. LEFT-CLICK ON THE PARCEL ACREAGE BADGE selected NEITHER the badge nor whatever it happened to
 *     sit over — `startAcChip` armed a drag and touched `sel` not at all. Row A(a) below is RED on
 *     an unfixed `startAcChip` (no `setSel` call).
 *  2. A RIGHT-CLICK LANDING ON THE HANDLE LAYER'S OWN CHROME (a resize grip, the parcel's edge
 *     length label) had no `onContextMenu` anywhere in that subtree and fell through to the
 *     EMPTY-CANVAS menu. Rows C and D are RED on an unfixed handle layer (no `onContextMenu` on
 *     `<g data-handle-layer="1">`).
 *
 * THE EXACT REPORTED GEOMETRY, as its own row (Row A): the parcel acreage badge sits over a
 * building (B1186 anchors the badge at the parcel's `polylabel` — the developed middle of the lot,
 * which is exactly where the buildings are on any built-out plan). Unmodified press reaches the
 * PARCEL (the badge, topmost); Alt-held press reaches the BUILDING behind it, for both buttons.
 * ⛔ A second Alt-press at THIS point does not cycle any further, and that is correct, not a bug —
 * measured live (`window.__plannerHitWhy`): a parcel's own INTERIOR fill carries no pointer events
 * at all (`startMoveParcel`'s own contract — a parcel is grabbed by its BOUNDARY, never its empty
 * interior), so the only representation of the parcel at this pixel is the badge itself, which the
 * cycling resolver (like the double-click resolver beside it) treats as chrome and skips. The real
 * feature stack under the badge is therefore ONE deep (`[el:zzelBldg1]`), and Alt reaches it in a
 * single hop with nothing further to cycle to — reaching the parcel a SECOND way at this exact
 * pixel is the badge's own direct click, already proved in A(a)/A(b). Row A2 below proves the
 * repeated-Alt-cycles-deeper-then-wraps behaviour on a genuine two-deep stack (two fully
 * overlapping buildings), for both buttons.
 *
 * ROW F (NEW-1, B1610592, 2026-09-15) adds a PRIOR-MENU dimension on top of all of the above: does
 * dismissing one context menu (Escape, or an outside click) leave anything behind that steals the
 * next right-click, on the exact occluded-badge geometry B1609136 fixed? Settled GREEN, 24/24,
 * stable across repeated runs — the live report that prompted it was browser-automation instability
 * (synthetic right-clicks with no pointer travel between them), not a product defect. See that row's
 * own header comment for the full write-up.
 *
 * Needs `npm run preview` on :4173 (or BASE_URL). Runs logged out, no external GIS, no real data.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

/* ---- the fixture ---------------------------------------------------------------------------
 * A square lot with a building filling its middle (so `polylabel` — the parcel's own pole of
 * inaccessibility, unaffected by what's drawn on top of it — lands the badge squarely on the
 * building), plus a second, standalone building for the label-dispatch and resize-handle checks.
 */
const SITE_ID = "zz-click-ownership";
const LOT = { id: "zzlot1", points: [
  { x: 780, y: 840 }, { x: 1220, y: 840 }, { x: 1220, y: 1160 }, { x: 780, y: 1160 },
] }; // a 440×320 rect centred at (1000,1000) — polylabel of a rect IS its centre
const BLDG1 = { id: "zzelBldg1", type: "building", cx: 1000, cy: 1000, w: 300, h: 200, rot: 0 };
const BLDG2 = { id: "zzelBldg2", type: "building", cx: 1550, cy: 1000, w: 300, h: 200, rot: 0 };
/* Row A2's fixture — TWO buildings, IDENTICAL footprint, so the ONLY thing that differs between
 * them is which one paints on top (z). A genuine two-deep FEATURE stack (unlike Row A's, where the
 * "second layer" is chrome, not a feature), built to prove the repeated-Alt-cycles-then-wraps rule
 * on real ground rather than assert it from the pure `nextPickIndex` unit tests alone. */
const BLDG3 = { id: "zzelBldg3", type: "building", cx: 1000, cy: 1500, w: 200, h: 200, rot: 0, z: 2 };
const BLDG4 = { id: "zzelBldg4", type: "building", cx: 1000, cy: 1500, w: 200, h: 200, rot: 0, z: 1 };
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Click ownership audit", name: "Plan 1",
  origin: null, county: null, parcels: [LOT], measures: [], callouts: [], underlay: null,
  els: [BLDG1, BLDG2, BLDG4, BLDG3], markups: [], // BLDG4 before BLDG3: insertion order agrees with z, belt-and-suspenders
  settings: { showDims: true }, updatedAt: Date.now(),
};

/* ---- Row F's own fixture (NEW-1, B1610592, 2026-09-15) --------------------------------------
 * A SEPARATE small site, not more elements piled onto the Row A/A2 one above — those rows depend
 * on Building 1 being CENTRED on the lot (so the badge sits over its body but under no handle) and
 * on there being exactly a ONE-deep stack behind the badge; adding a genuinely occluding building
 * to that same plan, or widening its "fit" bounding box, would risk the very rows this file already
 * proves clean. Row F needs the OPPOSITE geometry — a building whose own CORNER (where a resize
 * handle renders) coincides with the badge's anchor point — which B1609136's own fix note recorded
 * could NOT be reproduced with a simple centred building; only an off-centre one whose corner meets
 * the lot's `polylabel` shows the occlusion at all.
 *
 * `LOT2` is the identical 440×320 rect (polylabel of a rectangle IS its centroid, (1000,1000) in
 * its own local frame), and `BLDG5` is shifted so its bottom-right corner lands exactly there:
 * cx=850,cy=900,w=300,h=200 → corner at (850+150, 900+100) = (1000,1000). Selecting it renders a
 * corner resize grip AT the badge's own anchor, the exact B1609136 geometry, live, not asserted
 * from a hand-built feature stack. `BLDG6` is a standalone building (same shape as Row B's) that
 * plays the role of "a DIFFERENT element" for the prior-context-menu checks below.
 */
const SITE_ID2 = "zz-prior-menu";
const LOT2 = { id: "zzlot2", points: [
  { x: 780, y: 840 }, { x: 1220, y: 840 }, { x: 1220, y: 1160 }, { x: 780, y: 1160 },
] };
const BLDG5 = { id: "zzelBldg5", type: "building", cx: 850, cy: 900, w: 300, h: 200, rot: 0 };
const BLDG6 = { id: "zzelBldg6", type: "building", cx: 1550, cy: 1000, w: 300, h: 200, rot: 0 };
const site2 = {
  id: SITE_ID2, groupId: SITE_ID2, site: "ZZ Prior-menu dimension", name: "Plan 1",
  origin: null, county: null, parcels: [LOT2], measures: [], callouts: [], underlay: null,
  els: [BLDG5, BLDG6], markups: [],
  settings: { showDims: true }, updatedAt: Date.now(),
};

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE_ID]: site, [SITE_ID2]: site2 }))});
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
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; }); // arms window.__plannerHitWhy (read-only diag)
const page = await ctx.newPage();
await assertMeasurable(page, "verify-click-ownership");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  /* B1239330/B1253249 (pre-existing, already-filed, NOT fixed here) — the Dashboard landing route
   * added 2026-09-05 means `goto("/")` no longer lands in a workspace at all, so every boot helper
   * written before that change (including the one this ui-audit family used to share) times out at
   * its very first step. The documented remedy (`e2e/helpers.js`'s `openModule`) is one explicit
   * click on the Site module tab before anything else. STILL BLOCKING as of this session — see the
   * PR/backlog note for the confirmation (this harness reproduced the timeout with the OLD
   * navigation before this fix was applied here). */
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).first().click({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.locator('button:has-text("Select a project"), button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator(`button:has-text(${JSON.stringify(site.site)})`).first().click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1200);

  if (pageErrors.length) {
    console.log("\n⛔ THE FIXTURE CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 200)));
    process.exit(1);
  }

  const contentFill = () => page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    const boxes = [...document.querySelectorAll("[data-feature]")].map((g) => g.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return 0;
    const x0 = Math.min(...boxes.map((b) => b.left)), x1 = Math.max(...boxes.map((b) => b.right));
    const y0 = Math.min(...boxes.map((b) => b.top)), y1 = Math.max(...boxes.map((b) => b.bottom));
    return Math.min((x1 - x0) / c.width, (y1 - y0) / c.height);
  });
  async function fitView() {
    const fits = page.locator('button[title="Zoom to fit"]');
    const n = await fits.count();
    for (let i = n - 1; i >= 0; i--) {
      await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      if (await contentFill() > 0.15) return true;
    }
    return false;
  }
  if (!await fitView()) {
    console.log(`\n⛔ ZOOM-TO-FIT DID NOTHING — the plan is not on screen (fill ${(await contentFill()).toFixed(3)}).`);
    process.exit(1);
  }

  /* selection() reads the app's OWN current selection, via the same read-only diagnostic hook
   * built for the double-click resolver (window.__plannerHitWhy — `selection: selFeatureKey(sel)`
   * is independent of the (x,y) it's called with). This is the one honest way to ask "what did
   * that press actually select" without re-implementing the app's own selection model. */
  const selection = () => page.evaluate(() => window.__plannerHitWhy?.(0, 0)?.selection ?? null);

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
  async function closeAnyMenu() {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
  }
  async function deselect() {
    await closeAnyMenu();
    const e0 = await emptyPoint();
    if (e0) { await page.mouse.click(e0.x, e0.y); await page.waitForTimeout(150); }
  }
  /* A generic-menu census, keyed off the shared ContextMenu primitive's default className
   * ("menu"). Feature-specific text tells menus apart without hand-rolling a second resolver in
   * the harness. */
  const menuText = () => page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".menu")];
    return nodes.map((n) => n.innerText || "").join(" | ");
  });
  const rectCenter = async (sel) => {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) return null;
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  };
  /* Several selectors below (a parcel's edge-length labels, one per edge) match more than one
   * node, and `.first()` in DOM order is not "the one actually on screen" — a spaceOut'd-out or
   * simply off-screen sibling can win that race. Take the first match whose box is genuinely
   * inside the viewport. */
  const visibleRectCenter = async (sel) => {
    const vp = page.viewportSize();
    const n = await page.locator(sel).count();
    for (let i = 0; i < n; i++) {
      const box = await page.locator(sel).nth(i).boundingBox();
      if (box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height) {
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      }
    }
    return null;
  };

  /* ============================== ROW A — the exact reported geometry ==============================
   * The badge (parcel chip) sits over Building 1. Hovering it first is required — B1327/B280402's
   * hover-gated hit box means the badge is `pointer-events:none` until the pointer has rested on it. */
  const badgePt = await rectCenter('[data-chrome="acreage-badge"][data-chip-parcel="zzlot1"]');
  if (!badgePt) { ok("Row A setup: the acreage badge is on screen", false); }
  else {
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150); // let the hover latch arm (draggable = hoverChipId === pc.id)

    await deselect();
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    await page.mouse.click(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    ok("A(a) unmodified LEFT-click on the badge selects the PARCEL (known gap #1)", await selection() === "parcel:zzlot1", `got ${await selection()}`);

    await deselect();
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    await page.mouse.click(badgePt.x, badgePt.y, { button: "right" });
    await page.waitForTimeout(150);
    const rtxt = await menuText();
    ok("A(b) unmodified RIGHT-click on the badge opens the PARCEL's own menu", rtxt.includes("Merge parcels"), rtxt.slice(0, 80));
    ok("A(b) …and selects the parcel", await selection() === "parcel:zzlot1", `got ${await selection()}`);
    await closeAnyMenu();

    await deselect();
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    await page.keyboard.down("Alt");
    await page.mouse.click(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    ok("A(c) Alt-held LEFT-click reaches the BUILDING behind the badge (the sanctioned exception)", await selection() === "el:zzelBldg1", `got ${await selection()}`);
    await page.keyboard.up("Alt");

    await deselect();
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    await page.keyboard.down("Alt");
    await page.mouse.click(badgePt.x, badgePt.y, { button: "right" });
    await page.waitForTimeout(150);
    const atxt = await menuText();
    ok("A(d) Alt-held RIGHT-click opens the BUILDING's menu, not the parcel's", atxt.length > 0 && !atxt.includes("Merge parcels"), atxt.slice(0, 80));
    ok("A(d) …and selects the building", await selection() === "el:zzelBldg1", `got ${await selection()}`);
    await page.keyboard.up("Alt");
    await closeAnyMenu();
  }

  /* ============================== ROW A2 — repeated Alt cycles deeper, then wraps ==============================
   * A genuine two-deep FEATURE stack (Building 3 and Building 4, identical footprint) — proves the
   * "walk further down in a stable order, wrap at the bottom" half of the amendment, for BOTH
   * buttons, on ground where the second layer is a real feature rather than the parcel's own
   * chrome (see Row A's header note on why depth there is only 1). Which of the two paints on top
   * is MEASURED, not assumed from `z` — same-type elements order by `z` as a tiebreak, and this
   * fixture doesn't need to know or care which direction that resolves; it only needs one stable
   * "top" and one stable "behind" to drive the cycle against, so A2(a)'s own unmodified click
   * (never touched by this item — the ordinary top-most dispatch) DECIDES which id plays which
   * role for the rest of the row, rather than hardcoding one and risking a false red from a tie
   * that resolves the other way on a different build/run. */
  const stackPt = await rectCenter('[data-el-id="zzelBldg3"]');
  let TOP_ID = null, BEHIND_ID = null;
  if (!stackPt) { ok("Row A2 setup: the overlapping buildings are on screen", false); }
  else {
    /* THE ORDER, stated once: unmodified (or the FIRST Alt-press at a fresh point) resolves to the
     * TOP of the stack, exactly like a plain press — `nextPickIndex`'s documented behaviour,
     * unchanged by this item, and what makes the picker's starting point predictable rather than a
     * guess at how deep something is buried. Each FURTHER press AT THE SAME POINT steps one deeper
     * and wraps at the bottom. ONE cycle position (`stackPickRef`) is shared by BOTH buttons — a
     * left-click pick and a right-click pick at the same point can never disagree — so this drives
     * one continuous Alt-held gesture, alternating buttons, and checks the cycle advances by
     * exactly one step per press regardless of which button pressed it. (Row A's single Alt-press
     * already reached the building on its FIRST press only because the badge is chrome, not a
     * counted stack entry, at that pixel — see that row's own header note. Here, with two genuine
     * features, the full cycle plays out.) */
    await deselect();
    await page.mouse.click(stackPt.x, stackPt.y);
    await page.waitForTimeout(150);
    TOP_ID = await selection();
    BEHIND_ID = TOP_ID === "el:zzelBldg3" ? "el:zzelBldg4" : "el:zzelBldg3";
    ok("A2(a) unmodified click reaches ONE of the two, unambiguously", TOP_ID === "el:zzelBldg3" || TOP_ID === "el:zzelBldg4", `got ${TOP_ID}`);

    await deselect();
    await page.mouse.move(stackPt.x, stackPt.y);
    await page.waitForTimeout(150);
    await page.keyboard.down("Alt");
    await page.mouse.click(stackPt.x, stackPt.y); // press 1 (left) — fresh point, matches the top
    await page.waitForTimeout(150);
    ok("A2(b) the FIRST Alt-press at a fresh point still matches the top — predictable, not a guess", await selection() === TOP_ID, `got ${await selection()}`);

    await page.mouse.click(stackPt.x, stackPt.y, { button: "right" }); // press 2 (right) — same point, one step deeper
    await page.waitForTimeout(150);
    ok("A2(c) the NEXT Alt-press at the same point steps BEHIND it — and it's the RIGHT button, opening its menu", await selection() === BEHIND_ID, `got ${await selection()}`);
    await closeAnyMenu();

    await page.mouse.click(stackPt.x, stackPt.y); // press 3 (left) — same point, wraps (stack depth 2)
    await page.waitForTimeout(150);
    ok("A2(d) the cycle WRAPS back to the top — no skip, no unpredictable loop, and the button switched again", await selection() === TOP_ID, `got ${await selection()}`);

    await page.mouse.click(stackPt.x, stackPt.y, { button: "right" }); // press 4 (right) — continues the SAME cycle
    await page.waitForTimeout(150);
    ok("A2(e) …and the cycle keeps advancing identically no matter which button drives it (back BEHIND)", await selection() === BEHIND_ID, `got ${await selection()}`);
    await page.keyboard.up("Alt");
    await closeAnyMenu();
  }

  /* ============================== ROW B — an ordinary element label ==============================
   * Building 2 stands alone (no badge, no overlap) — this proves the GENERALISED label dispatch
   * (labelInteractive) actually fires in the real DOM: pointer-events enabled, the press resolves
   * to its own element via a closure over its id (never a position-dependent fallthrough), for
   * click, right-click AND double-click. */
  const labelPt = await rectCenter('[data-label-for="zzelBldg2"]');
  if (!labelPt) { ok("Row B setup: Building 2's label is on screen", false); }
  else {
    await deselect();
    await page.mouse.click(labelPt.x, labelPt.y);
    await page.waitForTimeout(150);
    ok("B(a) a plain click on the element's own LABEL selects that element", await selection() === "el:zzelBldg2", `got ${await selection()}`);

    await deselect();
    await page.mouse.click(labelPt.x, labelPt.y, { button: "right" });
    await page.waitForTimeout(150);
    const btxt = await menuText();
    ok("B(b) a right-click on the label opens that element's OWN menu", btxt.length > 0, btxt.slice(0, 80));
    await closeAnyMenu();

    await deselect();
    await page.mouse.dblclick(labelPt.x, labelPt.y);
    await page.waitForTimeout(200);
    ok("B(c) a double-click on the label opens Properties for that element", await page.locator('[data-testid="property-panel"]').count() > 0);
    await page.keyboard.press("Escape");
  }

  /* ============================== ROW C — a resize grip's right-click ==============================
   * None of the resize/rotate/vertex grips carried their own onContextMenu; an unhandled right-click
   * on one used to bubble straight to the empty-canvas menu. Select Building 2's body first (grips
   * only render while selected), then right-click its corner grip. */
  await deselect();
  await page.mouse.click(labelPt ? labelPt.x : 0, labelPt ? labelPt.y : 0);
  await page.waitForTimeout(150);
  const cornerPt = await rectCenter('[data-handle="corner"]');
  if (!cornerPt) { ok("Row C setup: a resize corner grip is on screen", false); }
  else {
    await page.mouse.click(cornerPt.x, cornerPt.y, { button: "right" });
    await page.waitForTimeout(150);
    const ctxt = await menuText();
    ok("C a right-click on a resize grip opens the SELECTED element's menu, not the empty-canvas one",
      ctxt.length > 0 && !/Zoom to fit|Paste here|Export/.test(ctxt), ctxt.slice(0, 80));
    await closeAnyMenu();
  }

  /* ============================== ROW D — the parcel's own edge-length label ==============================
   * Same species of gap as Row C: `parcelEdgeLabels` never carried its own onContextMenu either.
   * `[data-testid="parcel-outline"]` is deliberately `pointer-events:none` (B420 — a lot is grabbed
   * by its boundary, never its painted interior; the real hit target is an untagged, wider,
   * near-invisible hit-stroke polygon on the same ring) so it cannot be clicked directly — select
   * the parcel the way Row A already proved works instead: hover + click its own acreage badge. */
  await deselect();
  let edgeDimPt = null;
  if (badgePt) {
    await page.mouse.move(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    await page.mouse.click(badgePt.x, badgePt.y);
    await page.waitForTimeout(150);
    edgeDimPt = await visibleRectCenter('[data-testid="parcel-edge-dim"]');
    // The label only draws once its edge clears a screen-space length floor
    // (`detailLabelVisible`); if the fit view is too zoomed out for that, zoom in around the
    // badge (cursor-anchored — viewAnchor.js) a step at a time until one is on screen.
    for (let i = 0; i < 10 && !edgeDimPt; i++) {
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(150);
      edgeDimPt = await visibleRectCenter('[data-testid="parcel-edge-dim"]');
    }
  }
  if (!edgeDimPt) { ok("Row D setup: a parcel edge length label is on screen", false); }
  else {
    await page.mouse.click(edgeDimPt.x, edgeDimPt.y, { button: "right" });
    await page.waitForTimeout(150);
    const dtxt = await menuText();
    ok("D a right-click on the parcel's edge-length label opens the PARCEL's menu, not the empty-canvas one",
      dtxt.includes("Merge parcels"), dtxt.slice(0, 80));
    await closeAnyMenu();
  }

  /* ============================== ROW E — regression guard ==============================
   * The handle-layer fallback must not swallow a right-click that genuinely has nothing under it. */
  await deselect();
  const empty = await emptyPoint();
  if (!empty) { ok("Row E setup: found a genuinely empty canvas point", false); }
  else {
    await page.mouse.click(empty.x, empty.y, { button: "right" });
    await page.waitForTimeout(150);
    const etxt = await menuText();
    ok("E a right-click on truly empty canvas still opens the empty-canvas menu", /Zoom to fit|Paste/.test(etxt), etxt.slice(0, 80));
    await closeAnyMenu();
  }

  /* ============================== ROW F — the PRIOR-MENU dimension (NEW-1, B1610592) ==============
   * Settles a live observation from production, not a hypothesis: with a building selected so its
   * OWN corner grip sits exactly on the parcel acreage badge (B1609136's occlusion geometry, built
   * into BLDG5/LOT2 above), does a right-click on the badge ever resolve to the BUILDING instead of
   * the PARCEL when the immediately preceding interaction was a DIFFERENT context menu — however it
   * was dismissed — rather than a fresh press with nothing in front of it? Driven entirely through
   * Playwright's real input path (page.mouse.click / page.keyboard.press — genuine CDP input
   * events, the same ones every other row in this file uses), never a hand-rolled dispatchEvent and
   * never a synthetic zero-travel double right-click.
   */
  // Switch to Row F's own plan by navigating the app's own hash route directly
  // (`#/project/<id>/site` — read off the live URL after the first project switch above), rather
  // than drive the project-switcher dropdown a second time. That dropdown renders a real
  // `<button onClick={() => pickProject(...)}>` per row, but a second, closed copy of the whole
  // switcher stays mounted for the kept-alive Map finder route (the same pattern behind the
  // project-crumb button's own stale-match trap noted above), and this file's one live attempt at a
  // second in-session switch landed on that copy and reset the workspace to "no project selected"
  // instead — a direct hash navigation avoids the fragile second interaction entirely.
  await page.goto(`${BASE}#/project/${SITE_ID2}/site`, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1200);
  if (!await fitView()) {
    ok("Row F setup: Row F's own plan is on screen", false);
  } else {
    const badge2Pt = await rectCenter('[data-chrome="acreage-badge"][data-chip-parcel="zzlot2"]');
    const bldg5Pt = await rectCenter('[data-el-id="zzelBldg5"]');
    const bldg6LabelPt = await rectCenter('[data-label-for="zzelBldg6"]');
    if (!badge2Pt || !bldg5Pt) {
      ok("Row F setup: the badge and Building 5 are on screen", false);
    } else {
      const selectBldg5 = async () => {
        await deselect();
        await page.mouse.click(bldg5Pt.x, bldg5Pt.y);
        await page.waitForTimeout(150);
        return (await selection()) === "el:zzelBldg5";
      };
      // Escape / an outside click are the app's own two dismissals (ContextMenu.jsx) — the outside
      // click lands on the menu's own full-viewport backdrop, which is what a "left-click on empty
      // ground" actually hits while a menu is open, so `emptyPoint()`'s canvas-fraction probe is the
      // faithful equivalent, not a hardcoded corner pixel.
      const dismissBy = async (method) => {
        if (method === "escape") { await page.keyboard.press("Escape"); }
        else { const p = await emptyPoint(); await page.mouse.click(p ? p.x : 10, p ? p.y : 10); }
        await page.waitForTimeout(150);
      };
      const rightClickBadge = async () => {
        await page.mouse.move(badge2Pt.x, badge2Pt.y);
        await page.waitForTimeout(150); // let the hover latch arm (B1327/B280402)
        await page.mouse.click(badge2Pt.x, badge2Pt.y, { button: "right" });
        await page.waitForTimeout(150);
        return menuText();
      };

      // Setup proof: with Building 5 selected, is the badge's own point GENUINELY occluded by its
      // corner grip, the way the production report describes — not merely nearby? Read the real DOM
      // stack at that exact pixel instead of assuming the engineered geometry landed where intended.
      if (await selectBldg5()) {
        // The badge is `pointer-events:none` (so `elementsFromPoint` skips it entirely) until the
        // pointer has rested on it (B1327/B280402) — hover first, the same precondition every real
        // right-click on it needs, or this reads as "not occluding" for the wrong reason.
        await page.mouse.move(badge2Pt.x, badge2Pt.y);
        await page.waitForTimeout(150);
        // `closest`, not a bare attribute read — `elementsFromPoint` returns the actual painted leaf
        // nodes (a `<rect>`/`<text>`), and both `data-handle` and `data-chrome` are stamped on an
        // ANCESTOR group, exactly the way the app's own occlusion check (SitePlanner.jsx's handle-
        // layer `onContextMenu`) reads it.
        const stack = await page.evaluate(({ x, y }) => [...document.elementsFromPoint(x, y)]
          .map((n) => (n.closest && (n.closest("[data-handle]")?.getAttribute("data-handle") || n.closest("[data-chrome]")?.getAttribute("data-chrome"))) || null)
          .filter(Boolean), { x: badge2Pt.x, y: badge2Pt.y });
        ok("Row F setup: Building 5's corner grip genuinely occludes the badge at this pixel", stack.includes("corner") && stack.includes("acreage-badge"), stack.join(","));
      } else ok("Row F setup: Building 5 selects", false);

      // (a) — nothing before. Re-proves B1609136's own fix live in a real render — its shipped
      // regression coverage is pure-JS over a hand-built feature stack, never a real DOM/browser.
      if (await selectBldg5()) {
        const txt = await rightClickBadge();
        ok("F(a) nothing before — building selected, right-click the occluded badge still opens the PARCEL's menu", txt.includes("Merge parcels"), txt.slice(0, 80));
        await closeAnyMenu();
      } else ok("F(a) setup: Building 5 selected", false);

      // (b)/(c) — a DIFFERENT element's menu (Building 6's), dismissed by Escape / by an outside
      // click, THEN Building 5 re-selected (right-clicking Building 6 selects it — a real user's
      // stray right-click elsewhere changes the selection the same way here), THEN the occluded badge.
      for (const method of ["escape", "outside"]) {
        const label = method === "escape" ? "b" : "c";
        if (!(await selectBldg5()) || !bldg6LabelPt) { ok(`F(${label}) setup: Building 5 selected`, false); continue; }
        await page.mouse.click(bldg6LabelPt.x, bldg6LabelPt.y, { button: "right" }); // Building 6's OWN menu
        await page.waitForTimeout(150);
        await dismissBy(method);
        if (!(await selectBldg5())) { ok(`F(${label}) re-setup: Building 5 re-selected`, false); continue; }
        const txt = await rightClickBadge();
        ok(`F(${label}) a DIFFERENT element's menu (Building 6's), dismissed via ${method === "escape" ? "Escape" : "an outside click"} — badge still opens the PARCEL's menu`,
          txt.includes("Merge parcels"), txt.slice(0, 80));
        await closeAnyMenu();
      }

      // (d) — a context menu opened on a CONTROL POINT of the SELECTED element, dismissed, then the
      // badge. A plain rect building has no editable vertices of its own (only resize/rotate grips),
      // so its "control point" menu is the one Row C already proved: a right-click on its own corner
      // grip forwards to its own element menu via the handle layer's blanket fallback — exactly the
      // chrome occluding the badge in the first place, so this replays the reported sequence at the
      // SAME pixel: right-click it once (via the grip), dismiss, right-click it again (via the badge).
      if (await selectBldg5()) {
        const corner = await rectCenter('[data-handle="corner"]');
        if (corner) {
          await page.mouse.click(corner.x, corner.y, { button: "right" });
          await page.waitForTimeout(150);
          await dismissBy("escape");
          if (await selectBldg5()) {
            const txt = await rightClickBadge();
            ok("F(d) a menu opened on the SELECTED element's own control point (its resize grip), dismissed — badge still opens the PARCEL's menu",
              txt.includes("Merge parcels"), txt.slice(0, 80));
            await closeAnyMenu();
          } else ok("F(d) re-setup: Building 5 re-selected", false);
        } else ok("F(d) setup: a resize corner grip is on screen", false);
      } else ok("F(d) setup: Building 5 selected", false);

      // (d2) — the same dimension against a GENUINE vertex "Delete control point" menu (not a grip
      // forward): select the parcel itself (vertex-editable, 4 points), right-click one of its own
      // control points, dismiss, then right-click its own badge again.
      await deselect();
      await page.mouse.move(badge2Pt.x, badge2Pt.y);
      await page.waitForTimeout(150);
      await page.mouse.click(badge2Pt.x, badge2Pt.y);
      await page.waitForTimeout(150);
      if (await selection() === "parcel:zzlot2") {
        const vtx = await rectCenter('[data-testid="vtx-handle"]');
        if (vtx) {
          await page.mouse.click(vtx.x, vtx.y, { button: "right" });
          await page.waitForTimeout(150);
          const vtxTxt = await menuText();
          const openedVtxMenu = /Delete control point/.test(vtxTxt);
          await dismissBy("escape");
          const txt2 = await rightClickBadge();
          ok("F(d2) a genuine vertex 'Delete control point' menu on the SELECTED parcel, dismissed — its own badge still opens the PARCEL's menu",
            openedVtxMenu && txt2.includes("Merge parcels"), `${vtxTxt.slice(0, 40)} -> ${txt2.slice(0, 80)}`);
          await closeAnyMenu();
        } else ok("F(d2) setup: a parcel vertex control point is on screen", false);
      } else ok("F(d2) setup: the parcel is selected", false);

      // (e) — regression: none of the above priors leave the resolver believing something is under
      // a point where nothing is. Genuinely empty canvas still opens the empty-canvas menu.
      await deselect();
      const empty2 = await emptyPoint();
      if (!empty2) { ok("F(e) setup: found a genuinely empty canvas point", false); }
      else {
        await page.mouse.click(empty2.x, empty2.y, { button: "right" });
        await page.waitForTimeout(150);
        const ftxt = await menuText();
        ok("F(e) after the prior-menu checks, a right-click on truly empty canvas still opens the empty-canvas menu", /Zoom to fit|Paste/.test(ftxt), ftxt.slice(0, 80));
        await closeAnyMenu();
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed.`);
  if (passed < results.length) process.exit(1);
} finally {
  await browser.close();
}
