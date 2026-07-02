/* Self-verification for the NEW-1..NEW-5 backlog batch (B615–B619), driven in the REAL app,
 * logged-out / this-device mode, on the Vite preview (:4173). Seeds a site with a markup line,
 * a callout (deliberately PURPLE, the owner's repro), a parcel, and a road, then asserts:
 *
 *   B617 — a markup line's on-screen stroke width equals strokeZoom(2, ppf/0.35) at the current
 *          zoom (NOT a fixed 2px), and SHRINKS when you zoom out while its ratio to the line's
 *          pixel length stays ~constant (== "constant relative to the drawing").
 *   B619 — selecting the PURPLE callout keeps its own purple outline/leader (never recolored to the
 *          app accent), and a blue (#2563eb) selection chrome element tagged data-export="skip"
 *          appears (so it can never land in a PNG/PDF export).
 *   B615 — the callout Properties panel shows persistent "Text / Fill / Outline" swatch captions.
 *   B618 — the numeric fields carry ▲/▼ spinner buttons (aria-label Increase/Decrease).
 *   B616 — the inline callout editor auto-sizes with EQUAL padding per axis (left==right, top==bottom)
 *          and is NOT the old fixed 200×64 box.
 *
 * Ground truth = the rendered DOM + zero page errors. Run: node ui-audit/verify-b615-b619.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b615-b619";

const LINE_COLOR = "#0a7d22"; // unique green so we can find the seeded markup line
const CALLOUT_COLOR = "#7c3aed"; // purple — the owner's exact "purple → orange" repro
const SEL_BLUE = "#2563eb";
// pure mirror of SitePlanner's strokeZoom (kept in sync by the B617 source guard test)
const strokeZoom = (base, zk) => Math.max(0.6, Math.min(base * zk, base * 3.5));

const parcel = { id: "pc1", locked: false, points: [{ x: -260, y: -180 }, { x: 260, y: -180 }, { x: 260, y: 180 }, { x: -260, y: 180 }] };
// horizontal markup line, 200 ft long, base weight 2
const line = { id: "mkL", kind: "line", a: { x: -100, y: -40 }, b: { x: 100, y: -40 }, stroke: LINE_COLOR, weight: 2, dash: "solid", fill: LINE_COLOR, fillOpacity: 0 };
const callout = { id: "coA", box: { x: 0, y: 60 }, tip: { x: -60, y: 20 }, text: "18\" SANITARY SEWER", size: 16, color: "#111111", fill: "#fffbe8", stroke: CALLOUT_COLOR, align: "center", padX: 14, padY: 8, lineHeight: 1.3 };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B615-B619", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [],
  callouts: [callout], markups: [line], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("fit warn", e.message); }
await page.waitForTimeout(500);

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

// Read the seeded markup line's visible <line> (green stroke, pointer-inert): its px endpoints + width.
const readLine = () => page.evaluate((c) => {
  const ln = [...document.querySelectorAll("svg line")].find((l) => (l.getAttribute("stroke") || "").toLowerCase() === c);
  if (!ln) return null;
  const x1 = +ln.getAttribute("x1"), y1 = +ln.getAttribute("y1"), x2 = +ln.getAttribute("x2"), y2 = +ln.getAttribute("y2");
  return { len: Math.hypot(x2 - x1, y2 - y1), sw: +ln.getAttribute("stroke-width") };
}, LINE_COLOR);

// ---- B617: stroke tracks the drawing (formula applied), and shrinks on zoom-out ----
const l0 = await readLine();
if (!l0) { log(false, "B617: seeded markup line not found in the SVG"); }
else {
  const ppf0 = l0.len / 200;            // px per foot at the current (fit) zoom
  const zk0 = ppf0 / 0.35;
  const expected0 = strokeZoom(2, zk0);
  log(Math.abs(l0.sw - expected0) < 0.15, `B617: line width = strokeZoom(2, zk) at fit zoom (px=${l0.sw.toFixed(2)}, expected=${expected0.toFixed(2)}, ppf=${ppf0.toFixed(3)})`);
  log(Math.abs(l0.sw - 2) > 0.05 || Math.abs(zk0 - 1) < 0.02, `B617: width is NOT pinned to a fixed 2px (it follows the zoom)`);
  // zoom out via the canvas wheel (deltaY>0) → geometry shrinks; a scaled stroke must shrink WITH it
  await page.mouse.move(720, 450);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(60); }
  await page.waitForTimeout(400);
  const l1 = await readLine();
  if (l1) {
    const ppf1 = l1.len / 200, zk1 = ppf1 / 0.35, expected1 = strokeZoom(2, zk1);
    log(l1.len < l0.len - 1, `B617: zoom-out actually shrank the line geometry (${l0.len.toFixed(0)}px → ${l1.len.toFixed(0)}px)`);
    // width shrank too (unless the floor clamp kicked in — then it's pinned at the 0.6 floor, still not ballooning)
    log(l1.sw < l0.sw - 0.05 || l1.sw <= 0.61, `B617: line stroke SHRANK on zoom-out (${l0.sw.toFixed(2)}px → ${l1.sw.toFixed(2)}px) — no ballooning`);
    // and the formula still holds at the (unclamped) zoomed-out level → stroke tracks the drawing
    log(Math.abs(l1.sw - expected1) < 0.15, `B617: width = strokeZoom(2, zk) at the zoomed-out level too (px=${l1.sw.toFixed(2)}, expected=${expected1.toFixed(2)}) — tracks the drawing`);
  } else log(false, "B617: line vanished after zoom-out");
  await page.mouse.move(720, 450);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(60); } // wheel back in
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 3000 }); } catch (e) { /* noop */ }
  await page.waitForTimeout(400);
}

// ---- B619: select the callout → own color kept, blue export-skip chrome appears ----
const clickCallout = await page.evaluate((c) => {
  // the callout box rect: fill = its fill color, has an rx, pointer-events all
  const rect = [...document.querySelectorAll("svg rect")].find((r) => (r.getAttribute("fill") || "").toLowerCase() === "#fffbe8");
  if (!rect) return null;
  const b = rect.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
if (!clickCallout) { log(false, "B619: callout box not found"); }
else {
  await page.mouse.click(clickCallout.x, clickCallout.y);
  await page.waitForTimeout(400);
  const selState = await page.evaluate((cfg) => {
    const rects = [...document.querySelectorAll("svg rect")];
    const box = rects.find((r) => (r.getAttribute("fill") || "").toLowerCase() === "#fffbe8");
    // any canvas element recolored to the app accent? (accent is a warm/orange var — check the
    // callout box + leader line/arrow all still carry the purple author color)
    const boxStroke = box ? (box.getAttribute("stroke") || "").toLowerCase() : null;
    const leaderPurple = [...document.querySelectorAll("svg line, svg polygon")].some((e) => (e.getAttribute("stroke") || e.getAttribute("fill") || "").toLowerCase() === cfg.purple);
    // selection chrome = the on-canvas blue handles/outline/tip (white-filled handles + the box
    // outline + the tip circle). Every one of those must be export-skipped. (A blue pattern-def
    // stub at the origin is not chrome and is ignored — filter to elements actually placed on-canvas.)
    const chrome = [...document.querySelectorAll('svg rect[stroke="' + cfg.blue + '"], svg circle[stroke="' + cfg.blue + '"]')]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.x > 5; });
    const chromeSkip = chrome.filter((e) => e.getAttribute("data-export") === "skip" || e.closest('[data-export="skip"]'));
    return { boxStroke, leaderPurple, chrome: chrome.length, chromeSkip: chromeSkip.length };
  }, { purple: CALLOUT_COLOR, blue: SEL_BLUE });
  log(selState.boxStroke === CALLOUT_COLOR, `B619: selected callout box KEEPS its own purple outline (${selState.boxStroke}) — not recolored to the accent`);
  log(selState.leaderPurple, `B619: the callout leader/arrow stays purple too (owner's exact "purple→orange" repro fixed)`);
  log(selState.chrome >= 5, `B619: blue (#2563eb) selection chrome is present (${selState.chrome} on-canvas els)`);
  log(selState.chrome > 0 && selState.chromeSkip === selState.chrome, `B619: ALL blue selection chrome is data-export="skip" (${selState.chromeSkip}/${selState.chrome}) — never exported`);
  await page.screenshot({ path: OUT + "b619-callout-selected.png" });

  // B619 export path: reproduce buildExportSvg's strip (clone → remove [data-export="skip"]) and
  // confirm NO on-canvas blue selection chrome survives into an exported exhibit, while the real
  // content (the purple callout box + the green markup line) DOES, at a bounded stroke width.
  const exp = await page.evaluate((cfg) => {
    // pick the CANVAS svg (the one that actually holds the seeded green markup line), not a toolbar icon
    const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector('line[stroke="' + cfg.line + '"]'));
    if (!svg) return { noCanvas: true };
    const clone = svg.cloneNode(true);
    clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
    const blueChrome = clone.querySelectorAll('rect[stroke="' + cfg.blue + '"], circle[stroke="' + cfg.blue + '"], polygon[stroke="' + cfg.blue + '"]').length;
    const purpleBox = clone.querySelectorAll('rect[stroke="' + cfg.purple + '"]').length;
    const line = [...clone.querySelectorAll("line")].find((l) => (l.getAttribute("stroke") || "").toLowerCase() === cfg.line);
    const lineW = line ? +line.getAttribute("stroke-width") : null;
    return { blueChrome, purpleBox, lineW };
  }, { blue: SEL_BLUE, purple: CALLOUT_COLOR, line: LINE_COLOR });
  log(exp.blueChrome === 0, `B619/export: no blue selection chrome survives the export strip (${exp.blueChrome} left)`);
  log(exp.purpleBox >= 1 && exp.lineW != null && exp.lineW >= 0.6 && exp.lineW <= 7.01, `B617/export: real content kept — purple callout box + green line at a bounded weight (${exp.lineW})`);
}

// ---- B615 + B618: the callout Properties panel (auto-opened on select) ----
const panel = await page.evaluate(() => {
  const p = document.querySelector('[data-testid="property-panel"]');
  if (!p) return null;
  const txt = p.textContent || "";
  const btns = [...p.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "");
  return { hasText: txt.includes("Text"), hasFill: txt.includes("Fill"), hasOutline: txt.includes("Outline"),
    inc: btns.filter((a) => a === "Increase").length, dec: btns.filter((a) => a === "Decrease").length };
});
if (!panel) { log(false, "B615/B618: property panel did not open on select"); }
else {
  log(panel.hasText && panel.hasFill && panel.hasOutline, `B615: swatch captions present — Text:${panel.hasText} Fill:${panel.hasFill} Outline:${panel.hasOutline}`);
  log(panel.inc >= 1 && panel.dec >= 1, `B618: stepper spinner buttons present (Increase×${panel.inc}, Decrease×${panel.dec})`);
}

// ---- B616: WYSIWYG inline editor — equal padding per axis, not the old fixed 200×64 ----
if (clickCallout) {
  // open the editor via the panel's "✎ Edit text" button (robust vs. a canvas double-click)
  try { await page.locator('[data-testid="property-panel"] button', { hasText: "Edit text" }).first().click({ timeout: 3000 }); }
  catch (e) { await page.mouse.dblclick(clickCallout.x, clickCallout.y); }
  await page.waitForTimeout(400);
  const ed = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return null;
    const cs = getComputedStyle(ta);
    const px = (v) => parseFloat(v) || 0;
    return { w: px(cs.width), h: px(cs.height), pl: px(cs.paddingLeft), pr: px(cs.paddingRight), pt: px(cs.paddingTop), pb: px(cs.paddingBottom) };
  });
  if (!ed) { log(false, "B616: inline editor textarea not found"); }
  else {
    log(Math.abs(ed.pl - ed.pr) < 0.6, `B616: left/right padding equal (${ed.pl.toFixed(1)} ≈ ${ed.pr.toFixed(1)})`);
    log(Math.abs(ed.pt - ed.pb) < 0.6, `B616: top/bottom padding equal (${ed.pt.toFixed(1)} ≈ ${ed.pb.toFixed(1)})`);
    log(!(Math.abs(ed.w - 200) < 1 && Math.abs(ed.h - 64) < 1), `B616: box auto-sized to content, not the old fixed 200×64 (w=${ed.w.toFixed(0)}, h=${ed.h.toFixed(0)})`);
    await page.screenshot({ path: OUT + "b616-editor.png" });
  }
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""));
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
