/* NEW-1 — CHROME THAT PAINTS ABOVE THE PLAN MUST NOT EAT THE PRESS UNDERNEATH IT.
 *
 * The owner's report, on Goose Creek "site phase two": double-click a building, and Properties never
 * opens. Nothing happens at all. Diagnosed as a GESTURE defect, not a panel one — `openInspector`
 * and the panel's render condition were both sound, and `startMoveEl`'s double-tap branch was intact
 * and unchanged. The press simply never reached the building.
 *
 * THE CULPRIT, and why it started now. The parcel acreage badge renders with `pointerEvents: auto`
 * whenever the Select tool is up, and paints AFTER the element bands. In SVG, paint order IS
 * hit-test order, so that solid pill won every press inside it — over a building, over a road, over
 * anything. Its handler stops propagation, sets no selection and never calls `isDoubleTap`, so the
 * press produced no visible change, could not pair as a double-tap, and burnt an undo frame.
 * B1186 is what moved it into the line of fire: changing the badge's anchor from `centroid()` (a
 * vertex average that often floated clean off the lot) to `polylabel()` (the pole of inaccessibility,
 * GUARANTEED inside the ring) parks it on the developed middle of the lot — which is exactly where
 * the buildings are. On the owner's own saved plan three badges moved several hundred feet and
 * landed on two buildings and a road.
 *
 * THIS SUITE IS THE GENERAL GUARD, because a guard that names one component protects one component
 * — which is what B1174 already taught when it applied this same rule to measurement chips and
 * nobody applied it to the acreage badge. Two independent halves:
 *
 *   1. STRUCTURAL — with nothing selected, a press at an element's own centre must REACH that
 *      element. Asked of every building/road/paving on the real plan via elementFromPoint, so ANY
 *      future late-painted, pointer-enabled node that covers content fails here by construction,
 *      whatever it is called and whoever adds it.
 *   2. BEHAVIOURAL — a double-click opens Properties. Run at the element's centre AND inside the
 *      dimension grab band, which the structural half cannot see: that fat transparent grab line
 *      lives INSIDE the element's own group (so it passes #1) but only exists AFTER the element is
 *      selected, so press 2 of a real double-click landed on a layer press 1 had just created.
 *
 * Run: npx playwright test e2e/chrome-swallows-press.spec.js
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-goose-creek-phase-two";

/* The three elements the audit found a relocated badge sitting on, on this exact plan. Named so a
 * failure says WHICH object went unreachable rather than "some element". */
const BADGED = ["e1454647dshobp", "e1454652dshobp", "e1454717dshobp"];

async function loadOwnerPlan(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Goose Creek", name: "site phase two",
    origin: null, county: "harris",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(10);
  /* Let the fit / label / declutter passes settle. Without this the rects measured below are the
     pre-fit ones and every press lands somewhere else — a flaky guard is worse than no guard. */
  await page.waitForTimeout(1200);
}

/* Zoom onto one element so the detail tier (the red dimension line and its number) actually renders
   — it is LOD-gated, and at the whole-site fit there is nothing to press. */
async function zoomTo(page, id) {
  const ok = await page.evaluate((elId) => {
    if (!window.__plannerView) return false;
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    if (!g) return false;
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const sr = svg.getBoundingClientRect(), r = g.getBoundingClientRect();
    const v = window.__plannerView.get();
    // screen → feet for the element's centre, then re-centre there at a detail zoom
    const fx = ((r.left + r.width / 2) - sr.left - v.offX) / v.ppf;
    const fy = ((r.top + r.height / 2) - sr.top - v.offY) / v.ppf;
    window.__plannerView.centerOn(fx, fy, 0.5);
    return true;
  }, id);
  if (ok) await page.waitForTimeout(700);
  return ok;
}

/* The screen point at the centre of an element's own rendered group, plus what actually answers a
 * press there. `elementFromPoint` is the browser's real hit test — the same one a pointer uses — so
 * this cannot drift from behaviour the way a source scan can. */
async function hitAtCentre(page, id) {
  return page.evaluate((elId) => {
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    if (!g) return { missing: true };
    const r = g.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const node = document.elementFromPoint(x, y);
    const owner = node && node.closest ? node.closest("[data-el-id]") : null;
    return {
      x, y,
      ownerId: owner ? owner.getAttribute("data-el-id") : null,
      // Which late-painted chrome took it, if any — named so the failure message is actionable.
      chip: !!(node && node.closest && node.closest("[data-print-chip]")),
      handleLayer: !!(node && node.closest && node.closest("[data-handle-layer]")),
      tag: node ? node.tagName : null,
    };
  }, id);
}

const dockState = (page) => page.evaluate(() => {
  const on = document.querySelector('[data-rail-tab][aria-pressed="true"]');
  return on ? on.getAttribute("data-rail-tab") : "none";
});

test.describe("NEW-1 — no chrome painted above the plan swallows a press meant for an element", () => {
  test("STRUCTURAL: with nothing selected, every element's own centre answers to that element", async ({ page }) => {
    await loadOwnerPlan(page);
    const ids = await page.locator("[data-el-id]").evaluateAll((ns) => [...new Set(ns.map((n) => n.getAttribute("data-el-id")))]);
    expect(ids.length).toBeGreaterThan(10);
    const stolen = [];
    for (const id of ids) {
      const hit = await hitAtCentre(page, id);
      if (hit.missing) continue;
      // Off-screen elements have a degenerate rect — skip rather than assert about a point nobody
      // can press. Anything ON screen must be reachable at its own centre.
      if (hit.x < 0 || hit.y < 0) continue;
      if (hit.ownerId !== id) stolen.push({ id, took: hit.ownerId, chip: hit.chip, handleLayer: hit.handleLayer, tag: hit.tag });
    }
    /* An element MAY legitimately be covered by another element (a bump-out over its host, a
       building over paving) — that is ordinary stacking. What may never happen is chrome taking it:
       the acreage badge, or any other `data-print-chip` pill. */
    const byChrome = stolen.filter((s) => s.chip || s.ownerId === null);
    expect(byChrome, `chrome swallowed the press at these elements' own centres: ${JSON.stringify(byChrome)}`).toEqual([]);
  });

  /* NEW-4 amended the GATE and not the GUARANTEE. B1327 made the badge a hit target only while its
     own lot was SELECTED; that gate turned out to be unreachable (the badge sits on the building,
     so pressing it selected the building and the lot never got selected — see
     e2e/parcel-chip-move-delete.spec.js), and the gate is now HOVER. What this test protects is
     unchanged and is the thing that actually matters: with the pointer nowhere near a badge — which
     is every static hit test, and every press aimed at something else — no badge answers anything. */
  test("STRUCTURAL: the acreage badge is inert until the pointer is on it", async ({ page }) => {
    await loadOwnerPlan(page);
    const badges = page.locator('[data-print-chip="acre"]');
    await expect(badges.first(), "the badge still DRAWS at all times — only its PRESS is gated").toBeVisible();
    // Park the pointer off every badge, then assert not one of them can answer a press.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(250);
    const live = await badges.evaluateAll((ns) => ns.filter((n) => getComputedStyle(n).pointerEvents !== "none").length);
    expect(live, "an acreage badge was pointer-enabled with the pointer elsewhere — this is the B1186 regression").toBe(0);
  });

  test("BEHAVIOURAL: double-clicking a badged building opens Properties (the owner's report)", async ({ page }) => {
    await loadOwnerPlan(page);
    for (const id of BADGED) {
      await zoomTo(page, id);                       // detail zoom, so the press is unambiguous
      const hit = await hitAtCentre(page, id);      // measured AFTER the zoom, never before
      if (hit.missing) continue;
      expect(hit.chip, `the acreage badge is still covering ${id}'s centre`).toBe(false);
      await page.mouse.move(hit.x, hit.y);
      await page.mouse.dblclick(hit.x, hit.y);
      await page.waitForTimeout(250);
      expect(await dockState(page), `double-click on ${id} did not open Properties`).toBe("properties");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
  });

  test("BEHAVIOURAL: a double-click in the dimension band opens something instead of dying", async ({ page }) => {
    await loadOwnerPlan(page);
    /* The defect this covers is invisible to the structural half. The fat transparent grab line and
       the dimension number both live INSIDE the element's own group (so they pass #1), but the grab
       line renders only ONCE THE ELEMENT IS SELECTED — so press 2 of a real double-click lands on a
       layer press 1 has just created, and `startDimMove` swallowed it. The number had the twin
       defect: it keyed the gesture on a PRIVATE `eldim:` id, which both broke its own pairing with a
       body press and clobbered the single shared tap record.
       Driven on the element the owner's badge was found sitting on, at a detail zoom (the dimension
       tier is LOD-gated and renders nothing at the whole-site fit). */
    const ID = BADGED[0];
    expect(await zoomTo(page, ID), "could not zoom to the target element").toBe(true);
    /* Find the grab band's own screen position. It renders only while the element is SELECTED, so
       select, measure, then DESELECT — the repro needs the band absent when press 1 lands and
       present when press 2 does, which is precisely the shape that made the double-click undeliverable. */
    const c = await page.evaluate((id) => {
      const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ID);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(350);
    const band = await page.evaluate((id) => {
      const g = document.querySelector(`[data-el-id="${id}"] [data-testid="el-dim-grab"]`);
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, ID);
    expect(band, "no dimension grab band rendered on the selected element — the LOD zoom needs revisiting").toBeTruthy();
    await page.keyboard.press("Escape");            // deselect: the band goes away again
    await page.waitForTimeout(300);
    expect(await dockState(page)).toBe("none");
    /* ONE double-click, straight onto the band's position. Press 1 hits the element body and selects
       it — which MINTS the band under the cursor — and press 2 lands on that brand-new band. */
    await page.mouse.dblclick(band.x, band.y);
    await page.waitForTimeout(350);
    const opened = await page.evaluate(() => ({
      dock: (document.querySelector('[data-rail-tab][aria-pressed="true"]') || { getAttribute: () => "none" }).getAttribute("data-rail-tab"),
      inline: !!document.querySelector('foreignObject input[type="number"]'),
    }));
    /* EITHER surface is a pass — Properties, or the inline length editor the number owns. What is
       NOT a pass is the pre-fix behaviour: a double-click in this band that opened nothing at all. */
    expect(opened.dock === "properties" || opened.inline, `a double-click in the dimension band opened nothing: ${JSON.stringify(opened)}`).toBeTruthy();
  });
});

/* ═══ B233153 — THE THIRD INSTANCE, AND THE WORST SHAPE OF IT ═════════════════════════════════
 *
 * Captured live on the owner's machine (planyr.io, Bain / "Concept A — Quiddity Hydrologic"), one
 * double-click on a detention pond, from a capture-phase listener at the svg root:
 *
 *     pointerdown#1 → path[fill=url(#grad-water)]      ← the pond; it SELECTS, grips go 4 → 16
 *     pointerup#1, click#1 → same path
 *     pointerdown#2 → rect[data-testid="vtx-handle"]   ← 18×18 transparent, in [data-handle-layer]
 *     click#2, dblclick → that same rect
 *
 * Selecting the pond mounted its own 41-node handle layer and one hit square landed exactly on the
 * point already under the cursor. Press 2 therefore never reached the pond: no tap pair, and the
 * native dblclick — the only path left — resolved to nothing, because the root resolver used to
 * treat a handle on top as "the handle owns this press". Silent. Zero console output.
 *
 * ⛔ WHY SIX REALISTIC SANDBOX PONDS MISSED IT, which is the lesson worth more than the fix: the
 * variable is not the SHAPE, it is VERTEX COUNT AGAINST HANDLE SIZE AT THE PROBE POINT. A
 * four-vertex fixture ring keeps its grips at four distant corners; a surveyed basin has dozens and
 * its edge is peppered with them. So the pond seeded here carries a REALISTIC ring, and the press
 * point is not guessed — it is FOUND, by selecting the pond and asking where one of its own grips
 * lands over its own body. A test that passes on the old fixture proves nothing, because the old
 * fixture already passed.
 *
 * The corollary this adds to the named rule: CHROME MOUNTED BY THE FIRST PRESS IS INVISIBLE TO ANY
 * CHECK THAT READS THE DOM BEFORE THE INTERACTION. Hence the two-press invariant below — the app's
 * own resolution, asked BETWEEN the presses.
 *
 * The second test is the other half of the contract and is not optional: identification sees through
 * the grips, DELIVERY does not. A vertex must still drag.
 * ═════════════════════════════════════════════════════════════════════════════════════════════ */
const POND_SITE = "e2e-b233153-surveyed-pond";
const POND_ID = "e2eSurveyedPond";
/* Deterministic, and irregular ON PURPOSE — the handle decimation ranks by corner-ness and thins to
 * a screen-space spacing, so a smooth ellipse would keep only a handful of grips. */
const surveyRing = (cx, cy, rx, ry, n = 44) => Array.from({ length: n }, (_, i) => {
  const t = (i / n) * Math.PI * 2;
  const k = 1 + 0.16 * Math.sin(t * 5) + 0.07 * Math.cos(t * 11);
  return { x: cx + Math.cos(t) * rx * k, y: cy + Math.sin(t) * ry * k };
});

async function loadSurveyedPond(page) {
  await armPlannerHooks(page);
  const site = {
    id: POND_SITE, groupId: POND_SITE, site: "B233153 surveyed pond", name: "Plan 1",
    origin: null, county: null, parcels: [], measures: [], callouts: [], markups: [], underlay: null,
    els: [{
      id: POND_ID, type: "pond", cx: 600, cy: 500, w: 420, h: 300, rot: 0, label: "Detention Pond",
      points: surveyRing(600, 500, 170, 120),
      det: { role: "detention", depth: 8, tobElev: 100, poolElev: 96, freeboard: 1, slope: 3, outlet: "weir", contourInterval: 1, contours: true, daAcres: 12, daImpPct: 70, releaseRateCfs: 5 },
    }],
    settings: { showDims: true }, updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [POND_SITE, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible();
  await expect.poll(async () => page.locator(`[data-el-id="${POND_ID}"]`).count(), { timeout: 20_000 }).toBe(1);
  await page.waitForTimeout(1000);
}

const deselect = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(350); };

/* A point where one of the pond's OWN grips lands over the pond's OWN body. Call it with the pond
 * SELECTED, so the grips exist to be read. The handle layer is made pointer-inert while sampling so
 * `elementFromPoint` answers with what is UNDERNEATH — i.e. what the user was aiming at before
 * press 1 mounted anything. Leaves only: a wrapper <g>'s box spans every grip inside it, so
 * sampling that box lands on ordinary body pixels no grip covers. */
async function gripOverBody(page, id) {
  return page.evaluate((elId) => {
    const layer = document.querySelector("[data-handle-layer]");
    if (!layer) return null;
    const grips = [...layer.querySelectorAll("*")].filter((n) => {
      if (n.children.length) return false;
      const b = n.getBoundingClientRect();
      return b.width >= 6 && b.height >= 6 && getComputedStyle(n).pointerEvents !== "none";
    });
    const prev = layer.style.pointerEvents;
    layer.style.pointerEvents = "none";
    try {
      for (const g of grips) {
        const b = g.getBoundingClientRect();
        for (const fy of [0.5, 0.25, 0.75]) for (const fx of [0.5, 0.25, 0.75]) {
          const x = Math.round(b.left + b.width * fx), y = Math.round(b.top + b.height * fy);
          const n = document.elementFromPoint(x, y);
          const owner = n && n.closest ? n.closest("[data-el-id]") : null;
          if (!owner || owner.getAttribute("data-el-id") !== elId) continue;
          const tag = (n.tagName || "").toLowerCase();
          if (tag === "text" || tag === "tspan") continue;   // the body is geometry, not writing
          return { x, y, grip: g.getAttribute("data-testid") || g.tagName.toLowerCase(), grips: grips.length };
        }
      }
    } finally { layer.style.pointerEvents = prev; }
    return { grips: grips.length };
  }, id);
}

test.describe("B233153 — a feature's own vertex handle, mounted by press 1, must not eat press 2", () => {
  test("BEHAVIOURAL: double-clicking where the pond's own grip will land opens Properties", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadSurveyedPond(page);

    // Select once, purely to FIND the press point, then drop the selection so the gesture below is
    // a clean, ordinary double-click on an unselected pond — the owner's case exactly.
    const body = await page.evaluate((id) => {
      const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.28) };
    }, POND_ID);
    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(300);
    const gp = await gripOverBody(page, POND_ID);
    expect(gp && gp.grips, "the selected pond painted no grips — the fixture's vertex count is not doing its job").toBeGreaterThan(8);
    expect(gp.x, `no grip landed over the pond's own body (${gp.grips} grips) — this fixture can no longer reproduce B233153`).toBeGreaterThan(0);
    await deselect(page);
    await expect(page.getByTestId("property-panel")).toHaveCount(0);

    /* ⛔ `clickCount` 1 then 2 is what makes Chromium synthesise a native `dblclick` at all. Two bare
       down/up pairs leave the counter at 1 and no dblclick is delivered — so the gesture would run
       on the reconstructed double-TAP alone, which is precisely the path a grip kills. A harness
       that cannot deliver a native dblclick cannot see this bug. */
    await page.mouse.move(gp.x, gp.y);
    await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 });

    /* THE TWO-PRESS INVARIANT, measured in the middle of the gesture: press 1 has just mounted the
       grip under the unmoved cursor, and press 2 must still have this pond to resolve to. This is
       the assertion that goes RED on the pre-fix build. */
    const mid = await page.evaluate(({ x, y }) => (window.__plannerHitTarget ? window.__plannerHitTarget(x, y) : "no-hook"), gp);
    expect(mid, "window.__plannerHitTarget is gone — the invariant is no longer measuring the product").not.toBe("no-hook");
    expect(mid && mid.id, `with the ${gp.grip} press 1 just mounted, this point resolves to ${JSON.stringify(mid)}`).toBe(POND_ID);

    await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 });
    await expect(page.getByTestId("property-panel"),
      `a double-click on the pond opened nothing — its own ${gp.grip} took press 2`).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  /* THE OTHER HALF OF THE CONTRACT. The fix makes the handle layer transparent to IDENTIFICATION
     only; grips keep their own pointer events and their own onPointerDown, so reshaping must be
     untouched. A careless reading of "make the handle layer transparent" produces exactly the
     regression this pins: an undraggable vertex. */
  test("REGRESSION GUARD: a vertex handle still drags its vertex", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await loadSurveyedPond(page);

    /* ⛔ THE RING'S VERTICES, NOT A HASH OF THEM. "The geometry changed" is not the assertion: if
       the grip goes pointer-inert the press falls THROUGH to the pond body and MOVES the whole
       pond, which changes the ring just as thoroughly — and a test that only asks "is it different"
       passes on that regression while the vertex is undraggable. A drag of one grip moves ONE
       vertex; a move of the element moves all of them by the same delta. The view does not change
       during the drag, so the raw user-unit coordinates are directly comparable. */
    const ringOf = () => page.evaluate((id) => {
      // A polygon pond paints its basin as the FIRST <path> in its group (the contours follow).
      const n = document.querySelector(`[data-el-id="${id}"] path`);
      const d = n && n.getAttribute("d");
      if (!d) return null;
      return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    }, POND_ID);
    const movedCount = (a, b) => (a.length !== b.length ? -1 : a.filter((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 3).length);

    const body = await page.evaluate((id) => {
      const r = document.querySelector(`[data-el-id="${id}"]`).getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.28) };
    }, POND_ID);
    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(300);

    const before = await ringOf();
    expect(before && before.length, "the pond's ring did not render").toBeGreaterThan(20);

    const handle = await page.evaluate(() => {
      const h = document.querySelector('[data-handle-layer] [data-testid="vtx-handle"]');
      if (!h) return null;
      const b = h.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    });
    expect(handle, "the selected pond painted no vertex handles at all").toBeTruthy();

    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 30, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await ringOf();
    const moved = movedCount(before, after);
    expect(moved, "dragging a vertex handle moved nothing — the grip is no longer receiving its own press").toBeGreaterThan(0);
    expect(moved, `the WHOLE POND moved (${moved} of ${before.length} vertices) — the press fell through the grip to the body instead of reshaping`)
      .toBeLessThan(before.length / 2);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
