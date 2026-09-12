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

  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed.`);
  if (passed < results.length) process.exit(1);
} finally {
  await browser.close();
}
