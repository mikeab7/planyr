#!/usr/bin/env node
/* verify-easement-appearance — live-verify for NEW-EASE-STYLE (easement/encumbrance colour, fill,
 * hatch editing). Owner request (verbatim): "I should really be able to modify easements, like the
 * colors, fill, hatch."
 *
 * Drives the REAL app (headless Chromium, logged out, local-storage seeded — no auth needed) on the
 * owner's real Bain "Concept A - Quiddity DIA" plan (ui-audit/fixtures/bain-quiddity.json, 3
 * pipeline easements), one of the two plans named in the brief as a good candidate.
 *
 * What this proves, all read off the REAL rendered DOM / real export builder — never argued from
 * source:
 *   1) An easement with NO style override renders from the SHARED per-type <pattern> with the exact
 *      historic recipe (rect opacity 0.10, one 45° line at opacity 0.5, stroke-width 1.1) — the
 *      "zero visual change on the 26 production easements" claim, proven live rather than assumed.
 *   2) An easement with a style override (seeded here: fill/stroke #059669, fillOpacity 0.25, a
 *      CROSS hatch) renders from its OWN per-element <pattern> — the type pattern is untouched, and
 *      only the styled easement's polygon references the new one.
 *   3) An encumbrance shares the same primitives (a synthetic encumbrance is appended to the fixture
 *      for this — bain-quiddity carries none — to exercise the pat-encumber-el-* path live).
 *   4) The hatch tile does NOT rescale with zoom (constant screen-px tile — the "never mush at wide
 *      zoom, never a solid block at tight zoom" requirement): the <pattern>'s width/height stay "7"
 *      before and after a real zoom gesture.
 *   5) PDF-PARITY: window.__plannerExportSvg() (the same E2E hook the measure-export-lod spec uses)
 *      is called on the real built export clone, and the override pattern + the polygon referencing
 *      it are BOTH present in the exported SVG — the hatch survives export by construction (the
 *      export clones the live <defs>), proven live rather than argued from exportSheet.js's source.
 *   6) The Properties panel actually shows the new controls once an easement/encumbrance is
 *      selected, and a styled easement offers "Reset to type default".
 *
 * Logged-out / this-device mode. Run:
 *   node ui-audit/verify-easement-appearance.mjs   (preview server must be on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const fixture = JSON.parse(readFileSync(join(HERE, "fixtures", "bain-quiddity.json"), "utf8"));
const OVERRIDDEN_ID = "e1454856gyzzln"; // first of the 3 real pipeline easements on this plan
const UNSTYLED_ID = "e1454857gyzzln";   // left untouched — must keep rendering the historic look
const ease = fixture.markups.find((m) => m.id === OVERRIDDEN_ID);
if (!ease) throw new Error(`fixture missing expected easement ${OVERRIDDEN_ID} — has the fixture changed?`);
Object.assign(ease, { fill: "#059669", stroke: "#059669", fillOpacity: 0.25, hatch: "cross" });

// A synthetic encumbrance, appended to exercise the pat-encumber-el-* path live (bain-quiddity
// carries no encumbrances) — same appearance model, disclosed here rather than hidden in the fixture.
const ENC_ID = "verify-enc-1";
fixture.markups.push({
  id: ENC_ID, kind: "encumbrance", pts: [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 200, y: 400 }],
  centerline: [{ x: 200, y: 200 }, { x: 400, y: 200 }, { x: 400, y: 400 }, { x: 200, y: 400 }, { x: 200, y: 200 }],
  calls: [], label: "Verify Tract", stroke: "#7c3aed", weight: 2, dash: "solid",
  fill: "#f59e0b", fillOpacity: 0.22, hatch: "dots",
});

const seed = fixtureSeed(fixture, { id: "verify-ease-style", name: "Bain", site: "Concept A - Quiddity DIA" });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-easement-appearance");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`); };

// ---- 1/2/3: pattern wiring, read straight off the rendered SVG -------------------------------
const state = await page.evaluate(({ overriddenId, unstyledId, encId }) => {
  const attrsOf = (sel) => { const n = document.querySelector(sel); return n ? [...n.attributes].reduce((o, a) => (o[a.name] = a.value, o), {}) : null; };
  const patternBody = (id) => {
    const p = document.getElementById(id);
    if (!p) return null;
    return {
      width: p.getAttribute("width"), height: p.getAttribute("height"),
      rects: [...p.querySelectorAll("rect")].map((r) => ({ fill: r.getAttribute("fill"), opacity: r.getAttribute("opacity") })),
      lines: [...p.querySelectorAll("line")].map((l) => ({ stroke: l.getAttribute("stroke"), opacity: l.getAttribute("opacity"), strokeWidth: l.getAttribute("stroke-width") })),
      circles: [...p.querySelectorAll("circle")].map((c) => ({ fill: c.getAttribute("fill"), opacity: c.getAttribute("opacity") })),
    };
  };
  return {
    overriddenFill: attrsOf(`g[data-markup="${overriddenId}"] polygon`)?.fill || null,
    unstyledFill: attrsOf(`g[data-markup="${unstyledId}"] polygon`)?.fill || null,
    encFill: attrsOf(`g[data-markup="${encId}"] polygon`)?.fill || null,
    overriddenPattern: patternBody(`pat-ease-el-${overriddenId}`),
    typePattern: patternBody("pat-ease-pipeline"),
    encPattern: patternBody(`pat-encumber-el-${encId}`),
    sharedEncPatternPresent: !!document.getElementById("pat-encumber"),
  };
}, { overriddenId: OVERRIDDEN_ID, unstyledId: UNSTYLED_ID, encId: ENC_ID });

check("overridden easement references its own per-element pattern", state.overriddenFill === `url(#pat-ease-el-${OVERRIDDEN_ID})`, state.overriddenFill);
check("unstyled easement still shares the TYPE pattern (zero visual change)", state.unstyledFill === "url(#pat-ease-pipeline)", state.unstyledFill);
check("encumbrance references its own per-element pattern", state.encFill === `url(#pat-encumber-el-${ENC_ID})`, state.encFill);
check("shared pat-encumber default pattern still exists (untouched)", state.sharedEncPatternPresent);

check("type pattern matches the HISTORIC hardcoded recipe (rect 0.10, one line 0.5/1.1)",
  !!state.typePattern && state.typePattern.rects[0]?.opacity === "0.1" && state.typePattern.lines.length === 1 && state.typePattern.lines[0].opacity === "0.5" && state.typePattern.lines[0].strokeWidth === "1.1",
  JSON.stringify(state.typePattern));

check("overridden pattern is a CROSS hatch (two lines) in the override colour, at the override opacity",
  !!state.overriddenPattern && state.overriddenPattern.lines.length === 2 && state.overriddenPattern.lines.every((l) => l.stroke === "#059669") && state.overriddenPattern.rects[0]?.fill === "#059669" && state.overriddenPattern.rects[0]?.opacity === "0.25",
  JSON.stringify(state.overriddenPattern));

check("encumbrance pattern is a DOTS hatch in its override colour",
  !!state.encPattern && state.encPattern.circles.length === 1 && state.encPattern.circles[0].fill === "#f59e0b" && state.encPattern.rects[0]?.opacity === "0.22",
  JSON.stringify(state.encPattern));

// ---- 4: Properties panel reachability — DOUBLE-CLICK the overridden easement (BEFORE any zoom
// gesture, so its on-screen position still matches the post-"zoom to fit" frame) and look for the
// new controls. Single click selects; the app's own convention (doubleTap.js / B750 / B935) is
// that double-click is what opens Properties — a plain click leaves the panel on "Nothing selected".
// The strip is a many-vertex bent polygon (a digitised centerline buffered by width), so neither
// its bounding-box centre nor a plain vertex average is guaranteed to land inside it (a notch can
// put either outside the fill) — click the CENTERLINE polyline's own midpoint instead, which by
// construction sits on the strip's spine and therefore inside the buffered strip.
let clickedOk = false;
try {
  const pt = await page.evaluate((id) => {
    const line = document.querySelector(`g[data-markup="${id}"] polyline`);
    if (!line) return null;
    const pts = line.getAttribute("points").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    const mid = pts[Math.floor(pts.length / 2)];
    const svg = line.closest("svg");
    const sp = svg.createSVGPoint(); sp.x = mid[0]; sp.y = mid[1];
    const screen = sp.matrixTransform(line.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, OVERRIDDEN_ID);
  if (!pt) throw new Error("could not locate the easement's centerline midpoint");
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y, { clickCount: 2 });
  await page.waitForTimeout(500);
  clickedOk = true;
} catch (e) { console.warn("select warn", e.message); }
const panelText = await page.evaluate(() => document.body.innerText);
check("double-clicked the overridden easement (a real gesture on its rendered geometry)", clickedOk);
check("Properties panel shows 'Fill color' once an easement is selected", panelText.includes("Fill color"));
check("Properties panel shows 'Hatch'", panelText.includes("Hatch"));
check("Properties panel shows 'Outline color'", panelText.includes("Outline color"));
check("Properties panel offers 'Reset to type default' for the styled easement", panelText.includes("Reset to type default"));

// ---- 5: hatch tile stays constant-screen-px across a real zoom gesture -----------------------
const before = await page.evaluate((id) => { const p = document.getElementById(id); return p && { w: p.getAttribute("width"), h: p.getAttribute("height") }; }, `pat-ease-el-${OVERRIDDEN_ID}`);
// A real wheel gesture over the canvas — several notches zoomed IN.
const box = await page.locator("svg").first().boundingBox();
if (box) {
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -220);
    await page.waitForTimeout(60);
  }
}
await page.waitForTimeout(300);
const after = await page.evaluate((id) => { const p = document.getElementById(id); return p && { w: p.getAttribute("width"), h: p.getAttribute("height") }; }, `pat-ease-el-${OVERRIDDEN_ID}`);
check("hatch tile size is UNCHANGED across a real zoom-in gesture (constant screen-px, never mush/solid-block)",
  !!before && !!after && before.w === after.w && before.h === after.h, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

// ---- 6: PDF/PNG export parity — the REAL export builder, not source-reading -------------------
const exportHtml = await page.evaluate(async () => (window.__plannerExportSvg ? await window.__plannerExportSvg(null) : null));
check("export hook reachable (window.__plannerExportSvg)", typeof exportHtml === "string" && exportHtml.length > 0);
if (typeof exportHtml === "string") {
  check("exported SVG's <defs> carries the overridden easement's own pattern", exportHtml.includes(`id="pat-ease-el-${OVERRIDDEN_ID}"`));
  check("exported SVG's easement polygon references that pattern (fill survives export)", exportHtml.includes(`url(#pat-ease-el-${OVERRIDDEN_ID})`));
  check("exported SVG carries the encumbrance's own pattern too", exportHtml.includes(`id="pat-encumber-el-${ENC_ID}"`));
}

await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.error(`FAILED: ${failed.map((f) => f.name).join("; ")}`); process.exit(1); }
process.exit(0);
