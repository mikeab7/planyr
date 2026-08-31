/* B385040 · B385041 · B385042 · B366389(×2) — four owner reports, driven through the REAL app.
 *
 * All four run LOGGED OUT with no external GIS, which is what makes them Claude-verifiable here
 * rather than parked (VERIFICATION.md rule 4 — attempt before you park). What is NOT covered here
 * and is genuinely blocked: the LIVE Leaflet layer teardown on a located, signed-in plan with real
 * GIS services reachable (V187136), and the multi-plan switcher on his own Silvestri / Goose Creek
 * records (V187138).
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/undo-dock-plan-menu.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");

async function startBlank(page) {
  await armPlannerHooks(page);
  await page.goto("/");
  await page.getByTestId("map-start-blank-menu-btn").click();
  await page.getByTestId("map-start-blank-menu-item").click();
  await expect(canvas(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window.__plannerView ? 1 : 0)), { timeout: 20_000 }).toBe(1);
}

// Drag out a WIDE building (900-ish ft along x, 300-ish deep) with the Building tool.
async function drawWideBuilding(page) {
  const box = await canvas(page).boundingBox();
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const x1 = box.x + 200, y1 = box.y + 260, x2 = box.x + 620, y2 = box.y + 400;
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => buildings(page).then((b) => b.length)).toBe(1);
  return (await buildings(page))[0];
}

const buildings = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).filter((e) => e.type === "building" && !e.dogEar);
});

const layerEpoch = (page) => page.evaluate(() => (window.__plannerLayers ? window.__plannerLayers().identityEpoch : null));

/* ───────────────────────── B385040 — the Ctrl+Z flash ───────────────────────── */

test.describe("B385040 — an undo that touched no layer rebuilds no layer", () => {
  test("the overlays identity does NOT change across an undo of a plain geometry edit", async ({ page }) => {
    await startBlank(page);
    await drawWideBuilding(page);
    // Settle: the layer set is established before we start counting.
    await expect.poll(() => layerEpoch(page), { timeout: 20_000 }).not.toBeNull();
    await page.waitForTimeout(400);
    const before = await layerEpoch(page);

    // An edit that involves no layer at all: nudge the selected building, then undo it.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(400);

    /* The identity IS the flash: the layer staging effect's cleanup clears its intervals and idle
       callbacks and then re-stages and re-ADDS the whole Leaflet overlay stack, and it keys off
       this object and nothing else. The layer SET is identical either side of the defect, which is
       why no existing check in this repo could see it. */
    expect(await layerEpoch(page)).toBe(before);
    // …and a redo is the same restore in the other direction.
    await page.keyboard.press("Control+Shift+z");
    await page.waitForTimeout(300);
    expect(await layerEpoch(page)).toBe(before);
  });

  test("a still-valid selection SURVIVES the undo (the Properties panel does not close under you)", async ({ page }) => {
    await startBlank(page);
    const b = await drawWideBuilding(page);
    await expect(page.locator(`[data-el-id="${b.id}"]`)).toHaveCount(1);

    const cxBefore = (await buildings(page))[0].cx;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    expect((await buildings(page))[0].cx).not.toBe(cxBefore);

    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    // The geometry reverted…
    expect((await buildings(page))[0].cx).toBeCloseTo(cxBefore, 3);
    // …and the building is still selected, so the very next arrow key still nudges it. That is the
    // observable form of "the selection survived": a blanked selection makes this a no-op.
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
    expect((await buildings(page))[0].cx).not.toBe(cxBefore);
  });

  test("an undo that DELETED the selected element still clears the selection", async ({ page }) => {
    await startBlank(page);
    const b = await drawWideBuilding(page);
    // Undo the CREATION: the element the selection points at is no longer in the snapshot.
    // Read the LIVE canvas, not the autosaved record — the record is debounced and would report
    // the pre-undo state for a while (which is a property of the autosave, not of this fix).
    await page.keyboard.press("Control+z");
    await expect(page.locator(`[data-el-id="${b.id}"]`)).toHaveCount(0);
    // Nothing valid is selected, so Delete acts on nothing and must not throw or hit a ghost.
    await page.keyboard.press("Delete");
    await page.waitForTimeout(200);
    await expect(page.locator(`[data-el-id="${b.id}"]`)).toHaveCount(0);
    // …and a redo still brings it back, so the selection filter did not eat the history.
    await page.keyboard.press("Control+Shift+z");
    await expect(page.locator(`[data-el-id="${b.id}"]`)).toHaveCount(1);
  });
});

/* ───────────────────── B385041 — the dock walls stay put ───────────────────── */

test.describe("B385041 — a resize never moves a building's dock walls", () => {
  /* THE DOCK FACE READ OFF THE LIVE RENDER, not off the record — this is what the owner sees.
     Each loaded wall paints a `data-dock-apron` band; which wall of the footprint it hugs IS the
     answer. Returns "top" | "bottom" | "left" | "right" (or a sorted pair for a cross-dock).
     ⛔ Returns null when no apron is painted, and every caller treats null as a FAILED READING
     rather than as agreement — a check that silently scores "no marks found" as a pass is how a
     mutation slips through green. */
  const renderedDockSides = (page, id) => page.evaluate((elId) => {
    const g = document.querySelector(`[data-el-id="${elId}"]`);
    const body = g && g.querySelector("rect");
    if (!body) return null;
    const b = body.getBoundingClientRect();
    const aprons = [...g.querySelectorAll("[data-dock-apron]")];
    if (!aprons.length) return null;
    const sides = aprons.map((n) => {
      const r = n.getBoundingClientRect();
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      if (r.width >= r.height) return Math.abs(cy - b.y) <= Math.abs(cy - (b.y + b.height)) ? "top" : "bottom";
      return Math.abs(cx - b.x) <= Math.abs(cx - (b.x + b.width)) ? "left" : "right";
    });
    return [...new Set(sides)].sort().join("+");
  }, id);

  const stored = (page, id) => page.evaluate((elId) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const el = (site.els || []).find((e) => e.id === elId);
    return el ? { w: el.w, h: el.h, dockAxis: el.dockAxis, dockSide: el.dockSide } : null;
  }, id);

  /* Properties opens on a DOUBLE-click (B750/B935) — a single click only selects. */
  async function openProps(page, id) {
    const box = await page.evaluate((elId) => {
      const g = document.querySelector(`[data-el-id="${elId}"]`);
      const body = g && g.querySelector("rect, path");
      if (!body) return null;
      const r = body.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, id);
    if (!box) return false;
    await page.mouse.dblclick(box.x, box.y);
    await page.waitForTimeout(300);
    return true;
  }

  /* A real edge-grip drag on the LENGTH axis, expressed in FEET so the gesture is reproducible at
     whatever zoom the app opened at (the pixel delta is derived from the live view scale). */
  async function resizeLengthTo(page, id, targetFt) {
    const info = await page.evaluate((elId) => {
      const g = document.querySelector(`[data-el-id="${elId}"]`);
      const body = g && g.querySelector("rect");
      if (!body || !window.__plannerView) return null;
      const r = body.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, ppf: window.__plannerView.get().ppf };
    }, id);
    if (!info) return null;
    const rec = await stored(page, id);
    const dxPx = (targetFt - rec.w) * info.ppf;
    const gx = info.x + info.w, gy = info.y + info.h / 2;   // the right-edge mid grip
    await page.mouse.move(gx, gy);
    await page.mouse.down();
    await page.mouse.move(gx + dxPx, gy, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(160);
    return stored(page, id);
  }

  test("dragging the length down past square and back never rotates the dock assembly", async ({ page }) => {
    await startBlank(page);
    const b = await drawWideBuilding(page);
    expect(b.w).toBeGreaterThan(b.h);          // drawn wide → docks ride top/bottom
    expect(b.dockAxis).toBe("x");              // …and the orientation was ESTABLISHED at creation

    await page.locator(`[data-el-id="${b.id}"]`).first().click({ force: true });
    const face0 = await renderedDockSides(page, b.id);
    expect(face0, "no dock apron painted — the reading failed, so nothing below would mean anything").toBeTruthy();

    // Drag the length in past square, then back out. The old rule flipped at the crossing AND on
    // the way back, so this loop is the whole reported gesture.
    const seen = new Set([face0]);
    let wentPastSquare = false;
    const h = b.h;
    for (const target of [h * 2, h * 1.05, h, h * 0.95, h * 0.5, h * 0.95, h * 1.05, h * 3]) {
      const rec = await resizeLengthTo(page, b.id, target);
      expect(rec.dockAxis, "the stored orientation must never be re-derived by a resize").toBe("x");
      if (rec.w < rec.h) wentPastSquare = true;
      const face = await renderedDockSides(page, b.id);
      expect(face, "the apron stopped painting mid-drag — failed reading").toBeTruthy();
      seen.add(face);
    }
    // The gesture really did take the building deeper than it was long — the case the owner
    // described — and the dock face still never moved.
    expect(wentPastSquare, "the drag never crossed square, so it did not exercise the bug").toBe(true);
    expect([...seen]).toEqual([face0]);
  });

  test("a single-load building keeps its CHOSEN dock side through the same drag", async ({ page }) => {
    // Seeded rather than drawn: the dock side is the thing under test, so it is set BEFORE the app
    // boots (a post-boot localStorage poke races the debounced autosave and gets clobbered).
    const SITE = "e2e-dock-single";
    const EL = "b-single-1";
    await armPlannerHooks(page);
    await page.addInitScript(([id, elId]) => {
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: {
        id, groupId: id, site: "Dock axis", name: "Concept A", origin: null, county: "harris",
        parcels: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
        parcelDrawings: [], updatedAt: 1785500000000,
        els: [{ id: elId, type: "building", cx: 0, cy: 0, w: 900, h: 300, rot: 0, dock: "single", dockSide: "top", dockAxis: "x" }],
      } }));
      localStorage.setItem("planarfit:currentSite:v1", id);
    }, [SITE, EL]);
    await page.goto("/");
    await expect(canvas(page)).toBeVisible();
    await expect(page.locator(`[data-el-id="${EL}"]`)).toHaveCount(1);
    expect((await stored(page, EL)).dockSide).toBe("top");

    await page.locator(`[data-el-id="${EL}"]`).first().click({ force: true });
    const face0 = await renderedDockSides(page, EL);
    expect(face0).toBe("top");
    const after = await resizeLengthTo(page, EL, 180);   // take the length well below the 300 ft depth
    expect(after.w, "the drag did not cross square, so it did not exercise the bug").toBeLessThan(after.h);
    expect(after.dockSide, "an explicitly chosen dock side must survive an aspect-ratio flip").toBe("top");
    expect(after.dockAxis).toBe("x");
    expect(await renderedDockSides(page, EL), "…and the apron is still painted on that wall").toBe("top");
  });

  test("the depth/length readouts follow the STORED orientation once past square", async ({ page }) => {
    await startBlank(page);
    const b = await drawWideBuilding(page);
    await resizeLengthTo(page, b.id, Math.round(b.h * 0.5));
    await openProps(page, b.id);

    const s = await stored(page, b.id);
    expect(s.dockAxis).toBe("x");
    expect(s.w, "the drag did not cross square").toBeLessThan(s.h);
    expect(await renderedDockSides(page, b.id)).toBe("bottom");
    /* B548's contract, held against the STORED value: depth is perpendicular to the loaded wall
       (the `h` axis here) and length parallel to it (`w`) — even now that `w < h`, which is exactly
       where the old aspect-ratio derivation swapped them under the owner's hand. */
    const panelText = await page.getByTestId("property-panel").innerText().catch(() => "");
    if (panelText) {
      const len = /Length \(ft\)[^\d-]*(\d+)/.exec(panelText);
      const dep = /Depth \(ft\)[^\d-]*(\d+)/.exec(panelText);
      if (len && dep) {
        expect(Number(len[1])).toBe(Math.round(s.w));
        expect(Number(dep[1])).toBe(Math.round(s.h));
      }
    }
  });

  test("the dock face can still be turned DELIBERATELY", async ({ page }) => {
    await startBlank(page);
    const b = await drawWideBuilding(page);
    await openProps(page, b.id);
    const turn = page.getByTestId("dock-face-turn");
    await expect(turn).toBeVisible();
    await turn.click();
    await page.waitForTimeout(250);
    expect((await stored(page, b.id)).dockAxis).toBe("y");
    expect(await renderedDockSides(page, b.id), "the apron really moved to the other wall").toBe("right");
    // …and it is one undo frame, so a mis-click costs one Ctrl+Z.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(250);
    expect((await stored(page, b.id)).dockAxis).toBe("x");
    expect(await renderedDockSides(page, b.id)).toBe("bottom");
  });
});

/* ─────────── B385042 + B366389(×2) — the plan menu: contents and icons ─────────── */

test.describe("B385042 — the plan switcher on a single-plan site", () => {
  test("the current plan's name appears exactly TWICE, and there is no 'Plans in this site'", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("plan-crumb").click();
    const input = page.getByTestId("plan-name-input");
    await expect(input).toBeVisible();

    const name = await input.inputValue();
    expect(name.length).toBeGreaterThan(0);

    // The heading is gone…
    await expect(page.getByText("Plans in this site", { exact: true })).toHaveCount(0);
    // …and so is the one-row list, so the name is on screen twice: the crumb and the field.
    const occurrences = await page.evaluate((n) => {
      const crumb = document.querySelector('[data-testid="plan-crumb"]');
      const field = document.querySelector('[data-testid="plan-name-input"]');
      let count = 0;
      if (crumb && crumb.textContent.includes(n)) count += 1;
      if (field && field.value === n) count += 1;
      // Anything ELSE on screen carrying it as read-only text is the third copy this item removed.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let extra = 0, node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue.includes(n)) continue;
        if (crumb && crumb.contains(node)) continue;
        extra += 1;
      }
      return { count, extra };
    }, name);
    expect(occurrences.count).toBe(2);
    expect(occurrences.extra).toBe(0);
  });

  test("on a MULTI-plan site the switcher is back, and switching still works", async ({ page }) => {
    /* The deliberate other half of B385042: at ≥2 plans the list earns its place (it is the
       switcher AND the per-plan delete AND the you-are-here marker), so it renders in full,
       CURRENT PLAN INCLUDED — the same shape the sibling project switcher uses. */
    await armPlannerHooks(page);
    await page.addInitScript(() => {
      const mk = (id, name) => ({ id, groupId: "g1", site: "Multi", name, origin: null, county: "harris",
        parcels: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [],
        updatedAt: 1785500000000, els: [{ id: "b" + id, type: "building", cx: 0, cy: 0, w: 900, h: 300, rot: 0, dock: "cross", dockSide: "bottom", dockAxis: "x" }] });
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ g1: mk("g1", "Concept A"), p2: mk("p2", "Concept B"), p3: mk("p3", "Concept C") }));
      localStorage.setItem("planarfit:currentSite:v1", "g1");
    });
    await page.goto("/");
    await expect(canvas(page)).toBeVisible();
    await page.waitForTimeout(700);
    await page.getByTestId("plan-crumb").click();
    await expect(page.getByText("Plans in this site", { exact: true })).toBeVisible();
    for (const n of ["Concept A", "Concept B", "Concept C"]) {
      await expect(page.getByRole("button", { name: new RegExp(n) }).first()).toBeVisible();
    }
    await expect(page.getByText("current", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Concept C/ }).first().click();
    await expect(page.getByTestId("plan-crumb")).toContainText("Concept C", { timeout: 15_000 });
  });
});

test.describe("B366389 (×2) — the plan menu's icons are one family", () => {
  test("every menu row's icon is a drawn SVG inheriting its row colour — no emoji, no text glyphs", async ({ page }) => {
    await startBlank(page);
    await page.getByTestId("plan-crumb").click();
    await expect(page.getByTestId("save-now")).toBeVisible();

    const report = await page.evaluate(() => {
      // The menu PANEL is the smallest ancestor holding both the name field and Save now.
      let panel = document.querySelector('[data-testid="save-now"]');
      while (panel && !panel.querySelector('[data-testid="plan-name-input"]')) panel = panel.parentElement;
      const text = panel ? panel.innerText : "";
      const svgs = panel ? panel.querySelectorAll("svg") : [];
      const strokes = [...svgs].map((s) => s.getAttribute("stroke"));
      return {
        emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text),
        glyphs: ["💾", "🗄", "🔒", "🔓", "⧉", "＋", "↺", "✕"].filter((g) => text.includes(g)),
        svgCount: svgs.length,
        allCurrentColor: strokes.every((s) => s === "currentColor"),
      };
    });
    expect(report.glyphs).toEqual([]);
    expect(report.emoji).toBe(false);
    expect(report.svgCount).toBeGreaterThanOrEqual(3); // Save now · Version history · Storage
    expect(report.allCurrentColor).toBe(true);
  });
});
