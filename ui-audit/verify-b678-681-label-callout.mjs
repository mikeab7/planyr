/* Self-verification for B678–B681, driven in the REAL app (logged-out, Vite preview :4173).
 *
 * B678 — inline-label per-feature controls + screen-space self-thinning:
 *   - a wider labelSpacing override yields FEWER restamps than the default on an identical line;
 *   - a tight labelSpacing (20 ft) does NOT crowd — the screen-space min-gap keeps restamps apart;
 *   - labelSize override changes the rendered font size;
 *   - labelHalo:false removes the white halo (no paint-order stroke).
 * B679 — a REAL physical double-click (two mouse down/up pairs, the gesture pointer-capture used to
 *   eat) opens the in-place editor for a callout, a text box, AND a line inline label.
 * B680 — the callout text editor overlays the callout box EXACTLY (same centre + size, no second
 *   offset box), verified while ZOOMED OUT (where the old Math.max floor pushed it outside the box).
 * B681 — the callout align buttons render the Word-style SVG icon (stacked <line> rows), not glyphs.
 *
 * Run: node ui-audit/verify-b678-681-label-callout.mjs   (preview server must be up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b677";

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
// three ~1400-ft horizontal lines, unique strokes so their labels are easy to find
const lineA = { id: "lA", kind: "line", a: { x: -700, y: 150 }, b: { x: 700, y: 150 }, stroke: "#b30d6a", weight: 2, dash: "solid", fill: "#b30d6a", fillOpacity: 0, inlineLabel: "AAAAA" };                                   // default spacing (150)
const lineB = { id: "lB", kind: "line", a: { x: -700, y: 0 },   b: { x: 700, y: 0 },   stroke: "#0d6ab3", weight: 2, dash: "solid", fill: "#0d6ab3", fillOpacity: 0, inlineLabel: "BBBBB", labelSpacing: 700 };                   // wide override → fewer
const lineC = { id: "lC", kind: "line", a: { x: -700, y: -150 },b: { x: 700, y: -150 },stroke: "#2f7d0d", weight: 2, dash: "solid", fill: "#2f7d0d", fillOpacity: 0, inlineLabel: "CC", labelSpacing: 20, labelSize: 8, labelHalo: false }; // tight + small + no halo
const calloutX = { id: "coX", text: "CALLOUTX", box: { x: -350, y: 320 }, tip: { x: -540, y: 400 }, fill: "#ffd9a8", stroke: "#7a3b00", color: "#3a1c00", size: 15 };
const textBoxY = { id: "tbY", text: "TEXTBOXY", box: { x: 380, y: 320 }, noLeader: true, fill: "#a8d9ff", stroke: "#003a5a", color: "#00243a", size: 15 };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B678", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [], measures: [], callouts: [calloutX, textBoxY], markups: [lineA, lineB, lineC],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// read inline-label <text> nodes for a given content string → {fontSize, hasHalo, cx}
const readLabelTexts = (content) => page.evaluate((c) => {
  const out = [];
  for (const t of document.querySelectorAll("svg text")) {
    if ((t.textContent || "").trim() !== c) continue;
    const cs = getComputedStyle(t);
    const b = t.getBoundingClientRect();
    out.push({
      fontSize: parseFloat(cs.fontSize) || parseFloat(t.getAttribute("font-size")) || 0,
      hasHalo: (cs.paintOrder || t.style.paintOrder || "").includes("stroke") && /255,\s*255,\s*255/.test(cs.stroke || ""),
      cx: b.x + b.width / 2,
    });
  }
  return out;
}, content);

// ---- B678: spacing override reduces restamp frequency ----
const aTexts = await readLabelTexts("AAAAA");
const bTexts = await readLabelTexts("BBBBB");
log(aTexts.length > bTexts.length && bTexts.length >= 1,
  `B678 wider labelSpacing → FEWER restamps (default line ${aTexts.length} vs wide-spacing line ${bTexts.length})`);

// ---- B678: tight labelSpacing self-thins via the screen-space min-gap (no crowding) ----
const cTexts = (await readLabelTexts("CC")).sort((p, q) => p.cx - q.cx);
let minGap = Infinity;
for (let i = 1; i < cTexts.length; i++) minGap = Math.min(minGap, cTexts[i].cx - cTexts[i - 1].cx);
log(cTexts.length >= 2 && minGap >= 110,
  `B678 tight labelSpacing (20 ft) SELF-THINS — restamps stay ≥110px apart on screen (min gap ${Number.isFinite(minGap) ? Math.round(minGap) : "n/a"}px, ${cTexts.length} shown)`);

// ---- B678: labelSize override + labelHalo:false ----
log(cTexts.length >= 1 && aTexts.length >= 1 && cTexts[0].fontSize < aTexts[0].fontSize,
  `B678 labelSize override shrinks the font (styled ${cTexts[0]?.fontSize?.toFixed(1)}px < default ${aTexts[0]?.fontSize?.toFixed(1)}px)`);
log(cTexts.length >= 1 && !cTexts[0].hasHalo && aTexts[0].hasHalo,
  `B678 labelHalo:false removes the white halo (styled hasHalo=${cTexts[0]?.hasHalo}, default hasHalo=${aTexts[0]?.hasHalo})`);
await page.screenshot({ path: OUT + "b677-inline-label-controls.png" });

// ---- helper: a REAL physical double-click at a screen point (two down/up pairs) ----
const realDblClick = async (x, y) => {
  await page.mouse.move(x, y);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(60);
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(250);
};
// centre of a committed callout box, found by its unique fill
const calloutCenter = (fill) => page.evaluate((f) => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === f);
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
}, fill);

// ---- B679: real double-click a CALLOUT opens the text editor (textarea) ----
let cc = await calloutCenter("#ffd9a8");
log(!!cc, `callout box located on canvas`);
if (cc) await realDblClick(cc.x, cc.y);
let editorVal = await page.evaluate(() => { const t = document.querySelector("foreignObject textarea"); return t ? t.value : null; });
log(editorVal != null && editorVal.includes("CALLOUTX"),
  `B679 REAL double-click a callout opens its text editor (value "${editorVal}")`);
await page.keyboard.press("Escape");     // commit/close
await page.waitForTimeout(200);

// ---- B679: real double-click a TEXT BOX opens the editor ----
const tc = await calloutCenter("#a8d9ff");
if (tc) await realDblClick(tc.x, tc.y);
editorVal = await page.evaluate(() => { const t = document.querySelector("foreignObject textarea"); return t ? t.value : null; });
log(editorVal != null && editorVal.includes("TEXTBOXY"),
  `B679 REAL double-click a text box opens its editor (value "${editorVal}")`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---- B679: real double-click a LINE opens its inline-label editor (shared fix) ----
const lineMid = await page.evaluate(() => {
  const l = [...document.querySelectorAll("svg line")].find((x) => (x.getAttribute("stroke") || "").toLowerCase() === "#b30d6a");
  if (!l) return null;
  const x1 = +l.getAttribute("x1"), y1 = +l.getAttribute("y1"), x2 = +l.getAttribute("x2"), y2 = +l.getAttribute("y2");
  const svg = l.ownerSVGElement.getBoundingClientRect();
  return { x: svg.x + (x1 + x2) / 2, y: svg.y + (y1 + y2) / 2 };
});
if (lineMid) await realDblClick(lineMid.x, lineMid.y);
const lineEditor = await page.evaluate(() => { const i = document.querySelector("foreignObject input"); return i ? String(i.value) : null; });
log(lineEditor != null && lineEditor.includes("AAAAA"),
  `B679 REAL double-click a line opens its inline-label editor (value "${lineEditor}")`);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// ---- B680: editor overlays the callout box EXACTLY, verified ZOOMED OUT (the floor-trigger regime) ----
await page.mouse.move(720, 450);
for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(50); }
await page.waitForTimeout(300);
cc = await calloutCenter("#ffd9a8");                       // committed box rect BEFORE editing (zoomed out)
log(!!cc && (cc.w < 64 || cc.h < 30),
  `B680 zoomed out into the OLD floor regime — box ${cc ? Math.round(cc.w) + "×" + Math.round(cc.h) : "n/a"} (< 64×30, so the removed Math.max floor WOULD have mis-sized it)`);
if (cc) {
  await realDblClick(cc.x, cc.y);
  const ta = await page.evaluate(() => { const t = document.querySelector("foreignObject textarea"); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; });
  // committed box hidden during edit → only ONE box remains (the editor)
  const stillHasCommittedRect = await page.evaluate(() => [...document.querySelectorAll("svg rect")].some((x) => (x.getAttribute("fill") || "").toLowerCase() === "#ffd9a8"));
  log(!!ta && Math.abs(ta.x - cc.x) <= 3 && Math.abs(ta.y - cc.y) <= 3,
    `B680 editor CENTERED on the callout box (Δcenter ${ta ? Math.round(Math.abs(ta.x - cc.x)) + "," + Math.round(Math.abs(ta.y - cc.y)) : "n/a"}px)`);
  log(!!ta && Math.abs(ta.w - cc.w) <= 4 && Math.abs(ta.h - cc.h) <= 4,
    `B680 editor SIZE matches the callout box (box ${Math.round(cc.w)}×${Math.round(cc.h)} vs editor ${ta ? Math.round(ta.w) + "×" + Math.round(ta.h) : "n/a"})`);
  log(!stillHasCommittedRect, `B680 committed box hidden during edit — no second offset box`);
  await page.screenshot({ path: OUT + "b679-editor-overlay.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 3000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(300);

// ---- B681: align buttons render the Word-style SVG icon, not a unicode glyph ----
const cc2 = await calloutCenter("#ffd9a8");
if (cc2) { await page.mouse.move(cc2.x, cc2.y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(300); }
const alignIcon = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[title="Align left"], button[aria-label="Align left"]')][0];
  if (!btn) return { found: false };
  return { found: true, svgLines: btn.querySelectorAll("svg line").length, text: (btn.textContent || "").trim() };
});
log(alignIcon.found && alignIcon.svgLines >= 3 && !/[⇤≣⇥⤙⤚]/.test(alignIcon.text),
  `B681 align button renders the Word-style icon (${alignIcon.svgLines} svg rows, no glyph)`);

log(errors.length === 0, `no page errors (${errors.length})${errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""}`);

console.log(fail === 0 ? "\n✓ all checks passed" : `\n✗ ${fail} check(s) failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
