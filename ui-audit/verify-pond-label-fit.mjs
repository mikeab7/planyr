/* NEW-1 / NEW-2 — pond label fit ladder, driven against the REAL Goose Creek plan.
 *
 * Owner report (Goose Creek / "Plan 1 (copy)", City of Baytown, Harris County — project
 * smqfy48tlk9j, plan sms69x8rb2qk):
 *   • the SOUTHERN pond's label vanished entirely
 *   • the NORTHERN pond's label rendered OUTSIDE the pond outline
 *
 * The fixture (fixtures/goose-creek-plan1copy.json) is the plan's real drawn geometry pulled
 * from the production database — every element and parcel, not a shape invented for the test.
 * It is seeded into the LOGGED-OUT local store, so this runs with no auth and no external GIS.
 *
 * The harness walks a zoom sweep (the symptoms are zoom-dependent — the owner saw them zoomed
 * out) and, at each step, reports for each pond:
 *   present?   is there a label at all
 *   inside?    does its ink sit within the pond's own outline
 *   leadered?  was it pulled out with a connector
 *
 * PASS = at every zoom where the pond's label tier is on at all, BOTH ponds are present, and
 * neither is outside its outline while there is interior room for it.
 *
 * Usage: npm run build && npx vite preview --port 4173 & node ui-audit/verify-pond-label-fit.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PLAN = JSON.parse(readFileSync(new URL("./fixtures/goose-creek-plan1copy.json", import.meta.url)));
const ID = "verify-pond-label";
const NORTH = "e1454719dshobp", SOUTH = "e1454718dshobp";

const site = {
  id: ID, groupId: ID, site: "Goose Creek", name: "Plan 1 (copy)",
  origin: PLAN.origin, county: "harris",
  parcels: PLAN.parcels, els: PLAN.els,
  measures: [], callouts: [], markups: [], parcelDrawings: [],
  settings: PLAN.settings, underlay: null, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(ID)});
  // PDF-PARITY: capture the composed print-sheet SVG before it is rasterised, so the EXPORT path
  // can be asserted on the same run (the sheet reasons at its own px-per-foot — exportLabelScale —
  // so a ladder that only works on screen would silently ship an unlabelled pond to paper).
  window.__capturedSvgs = [];
  const origCOU = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    try { if (blob && blob.type === 'image/svg+xml') blob.text().then((t) => window.__capturedSvgs.push(t)); } catch (e) {}
    return origCOU(blob);
  };
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-pond-label-fit");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 6000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(600);

// Read each pond's outline (its own group, stamped `data-el-id`) and its OWN label (stamped
// `data-label-for` + `data-label-rung` + `data-label-leader`), then decide containment from real
// rendered client rects. Ownership comes from our own markup — never from proximity guessing.
const measure = () => page.evaluate(({ NORTH, SOUTH }) => {
  const rect = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const shapeOf = (id) => {
    const g = document.querySelector(`[data-el-id="${id}"]`);
    const node = g && (g.querySelector("path,polygon,rect") || g);
    return node ? rect(node) : null;
  };
  const labelOf = (id) => {
    const g = document.querySelector(`[data-label-for="${id}"]`);
    if (!g) return null;
    const t = g.querySelector("text");
    if (!t) return null;
    const spans = [...t.querySelectorAll("tspan")];
    const lines = spans.map((s) => s.textContent);
    // The NAME line's own width is what decides whether an outside placement was justified:
    // a pond drawn narrower on screen than its own name has no interior to hold it.
    const nameW = spans.length ? spans[0].getBoundingClientRect().width : rect(t).w;
    return { ...rect(t), text: t.textContent, lines: lines.length ? lines : [t.textContent], nameW,
      rung: g.getAttribute("data-label-rung"), leader: g.getAttribute("data-label-leader") === "1" };
  };
  return {
    north: { shape: shapeOf(NORTH), label: labelOf(NORTH) },
    south: { shape: shapeOf(SOUTH), label: labelOf(SOUTH) },
    totalText: document.querySelectorAll("svg text").length,
  };
}, { NORTH, SOUTH });

const inside = (a, b, tol = 3) =>
  !!a && !!b && a.x >= b.x - tol && a.y >= b.y - tol && a.x + a.w <= b.x + b.w + tol && a.y + a.h <= b.y + b.h + tol;

const cx = 880, cy = 460;
const zoom = async (n) => { for (let i = 0; i < Math.abs(n); i++) { await page.mouse.move(cx, cy); await page.mouse.wheel(0, n < 0 ? -300 : 300); await page.waitForTimeout(150); } await page.waitForTimeout(400); };

const report = [];
const step = async (tag) => {
  const m = await measure();
  await page.screenshot({ path: `${OUT}pond-label-${tag}.png` });
  const read = ({ shape, label }) => {
    if (!shape) return { shape: false };
    return {
      shape: true, shapeW: Math.round(shape.w), shapeH: Math.round(shape.h),
      present: !!label,
      insideOutline: label ? inside(label, shape) : null,
      leadered: label ? label.leader : null,
      rung: label ? label.rung : null,
      lines: label ? label.lines.length : 0,
      lineTexts: label ? label.lines : null,   // NEW-1 — the painted tspans, for the label-text check
      text: label ? label.text : null,
      // Rung (d) of the ladder — an outside, leadered placement — is legitimate ONLY when the pond
      // is drawn narrower on screen than its own name, i.e. there is genuinely no interior to use.
      outsideJustified: label ? label.nameW > shape.w : null,
      nameW: label ? Math.round(label.nameW) : null,
    };
  };
  report.push({ tag, totalText: m.totalText, north: read(m.north), south: read(m.south) });
};

await step("fit");
await zoom(2); await step("out1");
await zoom(2); await step("out2");
await zoom(-4); await step("in1");
await zoom(-2); await step("in2");

console.log(JSON.stringify(report, null, 2));

let fail = 0;
for (const r of report) {
  for (const key of ["north", "south"]) {
    const s = r[key];
    if (!s.shape) { console.error(`✗ ${r.tag}/${key}: pond outline not found in the DOM`); fail++; continue; }
    if (!s.present) { console.error(`✗ ${r.tag}/${key}: NO LABEL — a fit failure may never blank a pond`); fail++; continue; }
    if (!s.insideOutline) {
      if (s.outsideJustified && s.leadered) { console.log(`✓ ${r.tag}/${key}: leadered out (rung ${s.rung}) — the pond draws ${s.shapeW} wide, narrower than its own name (${s.nameW}); a leader is the right rung`); continue; }
      console.error(`✗ ${r.tag}/${key}: label OUTSIDE the outline with room to spare (rung ${s.rung}, leader ${s.leadered}, shape ${s.shapeW} vs name ${s.nameW}) — "${s.text}"`); fail++; continue;
    }
    console.log(`✓ ${r.tag}/${key}: rung ${s.rung}, ${s.lines} line(s), inside the outline — "${s.text}"`);
  }
}

/* ── NEW-1 (owner) — WHAT THE LABEL SAYS, read back off the rendered DOM ────────────────────
 * "Get rid of footprint and get rid of square feet, leave the acreage." A source grep can't
 * prove this: the label is ASSEMBLED from parts and then reflowed by the fit ladder, so the only
 * honest check is the text the browser actually painted, at every zoom step of the sweep above.
 * Shape: line 1 is the pond's noun, line 2 is a bare acreage, and no line anywhere carries the
 * word "footprint" or a square-footage figure. */
console.log("\n== NEW-1 — the pond label reads name + acreage only ==");
const AC_ONLY = /^[\d,]+\.\d{2} ac$/;
for (const r of report) {
  for (const key of ["north", "south"]) {
    const s = r[key];
    if (!s.present) continue; // already counted as a failure above
    const painted = (s.lineTexts || []).map((t) => t.trim());
    if (/footprint/i.test(s.text)) { console.error(`✗ ${r.tag}/${key}: label still says "footprint" — "${s.text}"`); fail++; continue; }
    if (/[\d,]{3,}\s*sf\b/.test(s.text)) { console.error(`✗ ${r.tag}/${key}: label still carries a square-footage figure — "${s.text}"`); fail++; continue; }
    if (!painted.some((t) => AC_ONLY.test(t))) { console.error(`✗ ${r.tag}/${key}: no bare "N.NN ac" line found — "${s.text}"`); fail++; continue; }
    console.log(`✓ ${r.tag}/${key}: "${painted.join("  /  ")}"`);
  }
}

// ── PDF-PARITY: both ponds must be named on the exported sheet too ─────────────────────────
console.log("\n== PDF-PARITY — the printed sheet names both ponds ==");
try {
  await page.getByText("File ▾", { exact: false }).first().click({ timeout: 6000 });
  await page.waitForTimeout(400);
  await page.getByText("Download PDF / pick frame", { exact: false }).first().click({ timeout: 6000 });
  await page.waitForTimeout(700);
  // Wait for the real download to land — composing the sheet takes a while (the aerial stitch
  // retries against a host this sandbox blocks), and the SVG only reaches the blob hook at the end.
  const dl = page.waitForEvent("download", { timeout: 180000 }).catch(() => null);
  await page.getByRole("button", { name: "Download PDF" }).first().click({ timeout: 6000 });
  const file = await dl;
  console.log(file ? `  sheet downloaded: ${file.suggestedFilename()}` : "  (no download event)");
  let svg = null;
  for (let i = 0; i < 40 && !svg; i++) {
    await page.waitForTimeout(300);
    const arr = await page.evaluate(() => window.__capturedSvgs || []);
    if (arr.length) svg = arr[0];
  }
  if (!svg) {
    await page.screenshot({ path: `${OUT}pond-label-pdf-stuck.png` });
    console.error("✗ pdf: no composed print-sheet SVG captured");
    fail++;
  }
  else {
    const named = (svg.match(/Detention Pond/g) || []).length;
    if (named >= 2) console.log(`✓ pdf: the sheet names both ponds (${named} pond labels in ${svg.length} bytes of sheet SVG)`);
    else { console.error(`✗ pdf: only ${named} pond label(s) reached the sheet — screen and paper have drifted`); fail++; }
    // NEW-1 — and the sheet says the SAME thing the screen does. The trim is a change to the
    // picture, so PDF-PARITY is not "both ponds are named" but "named the same way": the printed
    // label must carry the acreage and must NOT have kept the old footprint/square-footage form.
    if (/footprint\s+[\d,]/.test(svg)) { console.error("✗ pdf: the printed sheet still carries a 'footprint …' pond line — screen and paper have drifted"); fail++; }
    else if (!/>\s*[\d,]+\.\d{2} ac\s*</.test(svg)) { console.error("✗ pdf: no bare acreage line reached the sheet"); fail++; }
    else console.log("✓ pdf: the printed labels match the screen — acreage only, no footprint/sf");
  }
} catch (e) { console.error(`✗ pdf: export path failed — ${e.message}`); fail++; }

// ── no-regression pass: Tsakiris / Concept A ───────────────────────────────────────────────
// The plan the owner named as the reference ("its pond label currently sits inside its outline
// and must still do so"). Same real elements the other Tsakiris harnesses use.
const TS = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a-live.json", import.meta.url)));
const TS_POND = TS.els.find((e) => e.type === "pond");
const TS_ID = "verify-pond-label-tsakiris";
const tsCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await tsCtx.addInitScript(`(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [TS_ID]: {
    id: TS_ID, groupId: TS_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
    parcels: [], els: TS.els, measures: [], callouts: [], markups: [], parcelDrawings: [],
    settings: { showAreas: true }, underlay: null, updatedAt: Date.now(),
  } })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(TS_ID)});
} catch (e) {} })();`);
const ts = await tsCtx.newPage();
await ts.goto(BASE, { waitUntil: "load" });
await ts.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await ts.waitForTimeout(900);
try { await ts.locator('[title="Zoom to fit"]').first().click({ timeout: 6000 }); } catch (e) { console.warn("ts fit warn", e.message); }
await ts.waitForTimeout(600);
await ts.screenshot({ path: `${OUT}pond-label-tsakiris.png` });
const tsRead = await ts.evaluate((id) => {
  const rect = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const g = document.querySelector(`[data-el-id="${id}"]`), l = document.querySelector(`[data-label-for="${id}"]`);
  const t = l && l.querySelector("text");
  return { shape: g ? rect(g.querySelector("path,polygon") || g) : null,
    label: t ? { ...rect(t), text: t.textContent, rung: l.getAttribute("data-label-rung"), leader: l.getAttribute("data-label-leader") === "1" } : null };
}, TS_POND.id);
if (!tsRead.shape || !tsRead.label) { console.error(`✗ tsakiris: pond ${TS_POND.id} label missing`); fail++; }
else if (!inside(tsRead.label, tsRead.shape)) { console.error(`✗ tsakiris: pond label left its outline (rung ${tsRead.label.rung})`); fail++; }
else console.log(`✓ tsakiris: rung ${tsRead.label.rung}, still inside its outline — "${tsRead.label.text}"`);

await browser.close();
console.log(fail ? `FAIL (${fail})` : "PASS");
process.exit(fail ? 1 : 0);
