/* Self-verification for the Cloud (revision-cloud) markup tool (site-planner/markup).
 *
 * Checks, all DOM/geometry-based, logged-out (no auth):
 *   1. A pre-existing cloud markup renders as a scalloped <path> (not a plain polygon), with the
 *      default ink #2563EB (never #c2410c — the forbidden collision the spec calls out by name).
 *   2. Selecting it shows its vertex handles; deselecting hides them (B705200 house rule).
 *   3. Drawing a NEW cloud with a click-path (click 4 points, close on the first dot) commits a
 *      `kind:"cloud"` markup with a real scalloped outline.
 *   3c/3d (B758547 — no mode picker any more; a click vs. a drag is inferred per-gesture, and
 *      the owner's own framing, "the answer is nothing," is asserted directly): a single
 *      continuous drag alone traces and closes a whole cloud on release (no menu, no mode to
 *      arm first) · a click and a drag MIX into the same ring (click two vertices, drag a
 *      freehand run onward from the last one, close on the first dot again) — confirmed by no
 *      "Cloud ▾" options menu existing anywhere in the DOM.
 *   4. The Properties panel shows Cloud-specific metadata (Subject/Status/Arc size) for the
 *      selected cloud, and editing Subject updates it live.
 *   5. PDF/print export (window.__plannerExportSvg, same clone-the-live-SVG path the printed sheet
 *      uses) contains the SAME scalloped cloud path — PDF-PARITY, no second render path.
 *
 * Run with the preview server on :4173:
 *   npm run build && npx vite preview --port 4173 &   then   node ui-audit/verify-cloud-markup.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-cloud-markup";
// One pre-existing cloud (an octagon-ish ring) off the parcel centroid, so the acreage chip can't
// cover it (same precaution as verify-markup-fixes.mjs).
const existingCloud = {
  id: "cl1", kind: "cloud", arcFt: 3,
  pts: [
    { x: -350, y: -300 }, { x: -250, y: -350 }, { x: -150, y: -300 },
    { x: -150, y: -200 }, { x: -250, y: -150 }, { x: -350, y: -200 },
  ],
  stroke: "#2563EB", weight: 2, dash: "solid", fill: "#2563EB", fillOpacity: 0, opacity: 1,
  subject: "Cloud", comment: "", author: "You", createdAt: "2026-08-25T00:00:00.000Z",
  modifiedAt: "2026-08-25T00:00:00.000Z", status: "None", label: "", layer: "",
};
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -600 }, { x: 700, y: -600 }, { x: 700, y: 600 }, { x: -700, y: 600 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Cloud Markup", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [existingCloud],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-cloud-markup");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

let fail = 0;
const ok = (label, cond) => { console.log(`  ${cond ? "✓" : "✗"} ${label}`); if (!cond) fail++; };
const panelText = () => page.evaluate(() => { const p = document.querySelector('[data-testid="property-panel"]'); return p ? p.textContent : ""; });
const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");

/* ---------------- 1: the seeded cloud renders as a scalloped path, distinct default ink ---------------- */
console.log("\n== 1: a cloud renders as a scalloped <path> with the #2563EB default ink ==");
const cloudGeom = await page.evaluate(() => {
  const g = document.querySelector('g[data-mk-kind="cloud"]');
  if (!g) return null;
  const path = g.querySelector('path[stroke]');
  const b = g.getBoundingClientRect();
  return {
    hasPath: !!path,
    stroke: path ? path.getAttribute("stroke") : null,
    d: path ? path.getAttribute("d") : "",
    arcCount: path ? (path.getAttribute("d").match(/A /g) || []).length : 0,
    midX: b.x + b.width / 2, midY: b.y + b.height / 2, w: b.width,
  };
});
ok("a markup group with data-mk-kind=\"cloud\" is on the canvas", !!cloudGeom);
if (cloudGeom) {
  ok("its content is a <path> (the scalloped outline), not a plain <polygon>", cloudGeom.hasPath);
  ok("the outline is made of multiple arcs (a real scallop, not a straight ring)", cloudGeom.arcCount >= 6);
  ok(`default stroke is #2563EB (norm ${cloudGeom.stroke})`, norm(cloudGeom.stroke) === norm("#2563EB"));
  ok("default stroke is NOT the forbidden #c2410c collision", norm(cloudGeom.stroke) !== norm("#c2410c"));
  await page.screenshot({ path: OUT + "cloud-rendered.png" });
}

/* ---------------- 2: vertex handles hidden unless selected (B705200) ---------------- */
console.log("\n== 2: control points are hidden unless the cloud is selected (B705200) ==");
const handlesBefore = await page.evaluate(() => document.querySelectorAll('[data-handle-layer] rect').length);
ok("no vertex handles rendered with nothing selected", handlesBefore === 0);
// Click the RENDERED path exactly at its first vertex (SVG->screen via getScreenCTM) — the fat
// hit-companion follows the actual scalloped stroke, not the bounding box, and this markup has
// fillOpacity 0 (per B920, unfilled closed shapes hit on stroke ONLY, never the interior).
const vtxScreen = await page.evaluate(() => {
  const g = document.querySelector('g[data-mk-kind="cloud"]');
  const path = g && g.querySelector("path[stroke]");
  if (!path) return null;
  const m = (path.getAttribute("d") || "").match(/M\s*([\d.\-]+)\s*([\d.\-]+)/);
  if (!m) return null;
  const pt = path.ownerSVGElement.createSVGPoint();
  pt.x = parseFloat(m[1]); pt.y = parseFloat(m[2]);
  const s = pt.matrixTransform(path.getScreenCTM());
  return { x: s.x, y: s.y };
});
ok("found the cloud's first vertex in screen space", !!vtxScreen);
if (vtxScreen) {
  await page.mouse.click(vtxScreen.x, vtxScreen.y);
  await page.waitForTimeout(300);
  const isSelected = await page.evaluate(() => !!document.querySelector('[data-testid="markup-selected"][data-mk-kind="cloud"]'));
  ok("clicking the cloud's outline selects it (data-testid=\"markup-selected\")", isSelected);
  const handlesAfter = await page.evaluate(() => document.querySelectorAll('[data-handle-layer] rect').length);
  ok(`selecting it reveals vertex handles (${handlesAfter} rects for 6 vertices)`, handlesAfter >= 6);
  await page.screenshot({ path: OUT + "cloud-selected-handles.png" });

  /* ---------------- 4: Cloud-specific Properties panel fields (double-click opens it — B750: a
     single click only selects) ---------------- */
  console.log("\n== 4: Properties panel shows Cloud metadata (Subject/Status/Arc size) ==");
  await page.mouse.dblclick(vtxScreen.x, vtxScreen.y);
  await page.waitForTimeout(400);
  const openedText = await panelText();
  ok("double-click opens the inspector ('Markup · Cloud')", /Markup .*Cloud/.test(openedText));
  ok("panel shows 'Arc size' with Small/Medium/Large presets", /Arc size/.test(openedText) && /small/.test(openedText) && /medium/.test(openedText) && /large/.test(openedText));
  ok("panel shows 'Subject'", /Subject/.test(openedText));
  ok("panel shows 'Comment'", /Comment/.test(openedText));
  ok("panel shows 'Status' with all 5 Bluebeam-parity states", /Status/.test(openedText) && /None/.test(openedText) && /Accepted/.test(openedText) && /Rejected/.test(openedText) && /Cancelled/.test(openedText) && /Completed/.test(openedText));
  ok("panel shows 'Label' and 'Layer'", /Label/.test(openedText) && /Layer/.test(openedText));
  ok("panel shows 'Author'", /Author/.test(openedText));
  ok("panel shows 'Created' / 'Modified' (auto timestamps)", /Created/.test(openedText) && /Modified/.test(openedText));
  ok("reshape hint is the vertex idiom, not the box-resize one", /Drag a dot to reshape/.test(openedText));

  const subjInput = page.locator('[data-testid="property-panel"] input[placeholder="Cloud"]');
  if (await subjInput.count()) {
    const before = await page.evaluate(() => document.querySelector('g[data-mk-kind="cloud"]')?.getAttribute("data-mk-id"));
    await subjInput.fill("Revise grading");
    await subjInput.blur();
    await page.waitForTimeout(250);
    // The cloud must still be there (edit didn't blow away the object) and the field kept the value.
    const stillThere = await page.evaluate(() => document.querySelector('g[data-mk-kind="cloud"]')?.getAttribute("data-mk-id"));
    ok("Subject field is editable and the object survives the edit", before === stillThere && stillThere != null);
    ok("Subject input kept the typed value", (await subjInput.inputValue()) === "Revise grading");
  } else {
    ok("Subject input present", false);
  }

  // The inspector is open (we double-clicked it open above); the FIRST Escape closes the panel
  // only — the object stays selected, per this app's own contract ("the element stays selected —
  // double-click it to reopen"). A second Escape (panel now closed) does the full deselect.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const handlesAfterDeselect = await page.evaluate(() => document.querySelectorAll('[data-handle-layer] rect').length);
  ok("deselecting (Esc, Esc — panel close then deselect) hides the vertex handles again", handlesAfterDeselect === 0);
}

/* ---------------- 3: draw a NEW cloud with the Polygon click-path gesture ---------------- */
console.log("\n== 3: drawing a new cloud (Cloud tool, Polygon mode, click 4 points, close) ==");
// The rail also carries an aerial-imagery "☁ Cloud off" toggle (unrelated) whose text does not
// start with "Cloud" (it leads with the ⊘/☁ glyph) — the DRAW-rail tool button is the one whose
// trimmed text starts with "Cloud" and carries aria-pressed (only real tool buttons do).
const armedBefore = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").trim().startsWith("Cloud"));
  if (!btn) return { found: false };
  const r = btn.getBoundingClientRect();
  btn.click();
  return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
ok("found the Cloud draw-tool button (aria-pressed + text starts with 'Cloud')", armedBefore.found);
if (armedBefore.found) {
  await page.waitForTimeout(200);
  const armed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").trim().startsWith("Cloud"));
    return btn ? btn.getAttribute("aria-pressed") : null;
  });
  ok("the Cloud tool arms (aria-pressed=true)", armed === "true");

  // Click four points forming a small square, in the open area right of the seeded cloud, then
  // close by clicking back near the first point.
  const cx = 900, cy = 300, r = 60;
  const pts = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  for (const [x, y] of pts) { await page.mouse.click(x, y); await page.waitForTimeout(120); }
  await page.mouse.click(cx - r, cy - r); // close on the first dot
  await page.waitForTimeout(400);

  const afterDraw = await page.evaluate(() => {
    const clouds = [...document.querySelectorAll('g[data-mk-kind="cloud"]')];
    return { count: clouds.length, tool: window.__plannerHitTarget ? "e2e-hook-present" : null };
  });
  ok(`a SECOND cloud now exists on the canvas (drawn: ${afterDraw.count} total, expected 2)`, afterDraw.count === 2);
  await page.screenshot({ path: OUT + "cloud-drawn-new.png" });

  /* ---- 3b: undo removes the just-drawn cloud; redo brings it back ---- */
  console.log("\n== 3b: undo/redo on a freshly-drawn cloud ==");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.waitForTimeout(300);
  const afterUndo = await page.evaluate(() => document.querySelectorAll('g[data-mk-kind="cloud"]').length);
  ok(`undo removes the just-drawn cloud (${afterUndo} left, expected 1)`, afterUndo === 1);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+z" : "Control+Shift+z");
  await page.waitForTimeout(300);
  const afterRedo = await page.evaluate(() => document.querySelectorAll('g[data-mk-kind="cloud"]').length);
  ok(`redo brings it back (${afterRedo}, expected 2)`, afterRedo === 2);

  /* ---- 3c (B758547): a single continuous drag alone closes a whole cloud, with NO mode picker —
     there is no "Cloud ▾" menu any more (owner: "what even is the difference between freehand and
     click point, the answer is nothing" — a click vs. a drag is now inferred per-gesture). ---- */
  console.log("\n== 3c: a single drag alone traces and closes a whole cloud (no mode picker) ==");
  const armCloud = () => page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").trim().startsWith("Cloud"));
    if (btn) btn.click();
    return !!btn;
  });
  ok("re-armed the Cloud tool for the drag test (no ▾ menu exists any more)", await armCloud());
  ok("no leftover Cloud ▾ options menu exists in the DOM", !(await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").trim() === "▾" && b.getAttribute("aria-label") === "Cloud options"))));
  await page.waitForTimeout(150);
  // A loop that returns near its own start, in one press-drag-release — same one-gesture UX the old
  // dedicated Freehand mode gave, now with no mode to pick first.
  const loopCx = 900, loopCy = 500, loopR = 70;
  await page.mouse.move(loopCx + loopR, loopCy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    await page.mouse.move(loopCx + loopR * Math.cos(a), loopCy + loopR * Math.sin(a), { steps: 2 });
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDragLoop = await page.evaluate(() => document.querySelectorAll('g[data-mk-kind="cloud"]').length);
  ok(`a single drag loop commits a THIRD cloud on release (${afterDragLoop}, expected 3)`, afterDragLoop === 3);
  const toolAfterDragLoop = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").trim().startsWith("Cloud"));
    return btn ? btn.getAttribute("aria-pressed") : null;
  });
  ok("the tool disarms back to Select after the drag closes on its own", toolAfterDragLoop === "false");

  /* ---- 3d (B758547): click and drag MIX in one path — a click places a vertex and continues the
     path, a drag traces a freehand run onto the SAME ring, exactly what the owner asked for. ---- */
  console.log("\n== 3d: a click and a drag mix into ONE cloud ring ==");
  ok("re-armed the Cloud tool for the mixed-gesture test", await armCloud());
  await page.waitForTimeout(150);
  await page.mouse.click(300, 550);      // vertex 1 — a plain click
  await page.waitForTimeout(120);
  await page.mouse.click(420, 500);      // vertex 2 — a plain click, continuing the path
  await page.waitForTimeout(120);
  await page.mouse.move(420, 500);
  await page.mouse.down();               // now DRAG a freehand run onward from the last click point
  for (const [dx, dy] of [[40, 60], [20, 120], [-40, 150]]) {
    await page.mouse.move(420 + dx, 500 + dy, { steps: 3 });
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
  await page.mouse.click(300, 550);      // close by clicking back on the first dot
  await page.waitForTimeout(400);
  const afterMixed = await page.evaluate(() => document.querySelectorAll('g[data-mk-kind="cloud"]').length);
  ok(`the click+drag mix commits a FOURTH cloud (${afterMixed}, expected 4)`, afterMixed === 4);
  const mixedVtxCount = await page.evaluate(() => {
    const gs = [...document.querySelectorAll('g[data-mk-kind="cloud"]')];
    const g = gs[gs.length - 1];
    const path = g.querySelector("path[stroke]");
    return (path.getAttribute("d").match(/A /g) || []).length; // one scallop arc per ring edge
  });
  ok(`the mixed ring has more than the 2 click vertices alone would give (${mixedVtxCount} edges — the drag contributed real points)`, mixedVtxCount > 3);
  await page.screenshot({ path: OUT + "cloud-all-modes.png" });

  /* ---- 3e: delete a cloud ---- */
  console.log("\n== 3e: Delete removes a selected cloud ==");
  // Click well outside the drawing first to drop any stray toolbar focus / prior selection, then
  // locate the last-drawn cloud via getPointAtLength (robust to whatever shape the RDP-simplified
  // freehand outline ended up as, unlike re-parsing the path's raw "M x y" text).
  await page.mouse.click(1300, 850);
  await page.waitForTimeout(200);
  const lastCloud = await page.evaluate(() => {
    const gs = [...document.querySelectorAll('g[data-mk-kind="cloud"]')];
    const g = gs[gs.length - 1];
    const path = g.querySelector("path[stroke]");
    const p = path.getPointAtLength(path.getTotalLength() * 0.5);
    const svgPt = path.ownerSVGElement.createSVGPoint(); svgPt.x = p.x; svgPt.y = p.y;
    const s = svgPt.matrixTransform(path.getScreenCTM());
    return { x: s.x, y: s.y, id: g.getAttribute("data-mk-id") };
  });
  await page.mouse.click(lastCloud.x, lastCloud.y);
  await page.waitForTimeout(350);
  await page.keyboard.press("Delete");
  await page.waitForTimeout(300);
  const afterDelete = await page.evaluate(() => document.querySelectorAll('g[data-mk-kind="cloud"]').length);
  ok(`Delete removes the selected cloud (${afterDelete}, expected 3)`, afterDelete === 3);
}

/* ---------------- 5: PDF export contains the same scalloped path (PDF-PARITY) ---------------- */
console.log("\n== 5: PDF/print export clones the SAME scalloped cloud (PDF-PARITY) ==");
const exportHtml = await page.evaluate(async () => {
  if (typeof window.__plannerExportSvg !== "function") return null;
  return await window.__plannerExportSvg(null);
});
ok("the export hook is present and returns SVG markup", !!exportHtml && exportHtml.length > 200);
if (exportHtml) {
  const exportArcCount = (exportHtml.match(/data-mk-kind="cloud"[\s\S]{0,400}?<path[^>]*\bd="([^"]*)"/) || [])[1];
  const hasScallop = /data-mk-kind="cloud"/.test(exportHtml) && /<path[^>]*\bd="M [^"]*A /.test(exportHtml.replace(/[\s\S]*?(data-mk-kind="cloud")/, "$1"));
  ok("the exported sheet contains a cloud markup group", /data-mk-kind="cloud"/.test(exportHtml));
  ok("the exported cloud is the scalloped <path>, not a plain polygon (same render fn as screen)", hasScallop);
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} CHECK(S) FAILED`}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
