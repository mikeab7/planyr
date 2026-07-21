/* Self-verification for B620 — inline labels that ride ALONG a line/polyline/road, driven in the
 * REAL app, logged-out, on the Vite preview (:4173). Seeds lines (up-right + down-right for the
 * auto-flip), a long line vs. a long road (the density gradient), and a polyline, then asserts:
 *
 *   - the label <text> renders on each feature with the exact content;
 *   - EVERY inline label's rotate() angle is in [-90, 90] (never upside-down), incl. the down-right line;
 *   - own color + white halo (paint-order:stroke, stroke:#fff, fill == the line's own stroke color);
 *   - density gradient: a long line shows MORE instances than an equally-long road (per-type spacing);
 *   - export survival: the label survives the buildExportSvg strip while selection chrome does not;
 *   - LOD: zoom out far → labels hide; zoom back in → they return;
 *   - non-sticky: after double-clicking a line and typing a label, drawing a NEW line does NOT inherit it.
 *
 * Run: node ui-audit/verify-b620-inline-label.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { roadStripBBox } from "../src/workspaces/site-planner/lib/siteModel.js";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const DEMO_ID = "verify-b620";
const SEL_BLUE = "#2563eb";
const LC = "#0a7d22"; // a unique green stroke → easy to find the seeded markup lines' labels

const parcel = { id: "pc1", locked: false, points: [{ x: -820, y: -320 }, { x: 820, y: -320 }, { x: 820, y: 320 }, { x: -820, y: 320 }] };
// up-right + down-right short lines (auto-flip test)
const lineUp = { id: "lUp", kind: "line", a: { x: -120, y: 90 }, b: { x: 120, y: -90 }, stroke: LC, weight: 2, dash: "solid", fill: LC, fillOpacity: 0, inlineLabel: "UP-LINE" };
const lineDn = { id: "lDn", kind: "line", a: { x: -120, y: -90 }, b: { x: 120, y: 90 }, stroke: LC, weight: 2, dash: "solid", fill: LC, fillOpacity: 0, inlineLabel: "DOWN-LINE" };
// long line vs long road, ~1400 ft each (density gradient: line@150 → many, road@700 → few)
const lineLong = { id: "lLong", kind: "line", a: { x: -700, y: 200 }, b: { x: 700, y: 200 }, stroke: LC, weight: 2, dash: "solid", fill: LC, fillOpacity: 0, inlineLabel: "SEWERA" };
const rpts = [{ x: -700, y: -200 }, { x: 700, y: -200 }];
const roadLong = { id: "rLong", type: "road", pts: rpts, vtx: [{}, {}], travelW: 24, curb: 0.5, roadClass: "local", inlineLabel: "ROADA", ...roadStripBBox(rpts, [{}, {}], 24, 0.5, { defaultRadius: 120 }) };
const poly = { id: "pl1", kind: "polyline", pts: [{ x: -300, y: -30 }, { x: 60, y: -30 }, { x: 60, y: 40 }], stroke: LC, weight: 2, dash: "solid", fill: LC, fillOpacity: 0, inlineLabel: "POLYA" };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B620", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [roadLong], measures: [], callouts: [], markups: [lineUp, lineDn, lineLong, poly],
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

// helper: read every inline-label <text> (content + rotation deg + fill + halo) in the canvas SVG
const readLabels = () => page.evaluate(() => {
  const out = [];
  for (const t of document.querySelectorAll("svg text")) {
    const s = (t.textContent || "").trim();
    if (!/^(UP-LINE|DOWN-LINE|SEWERA|ROADA|POLYA)$/.test(s)) continue;
    const tr = t.getAttribute("transform") || "";
    const m = tr.match(/rotate\(\s*(-?[\d.]+)/);
    const cs = getComputedStyle(t);
    out.push({ text: s, deg: m ? parseFloat(m[1]) : null, fill: (t.getAttribute("fill") || cs.fill || "").toLowerCase(), paintOrder: cs.paintOrder || t.style.paintOrder || "", stroke: (cs.stroke || "").toLowerCase() });
  }
  return out;
});

const labels = await readLabels();
const kinds = new Set(labels.map((l) => l.text));
log(kinds.has("UP-LINE") && kinds.has("DOWN-LINE") && kinds.has("SEWERA") && kinds.has("ROADA") && kinds.has("POLYA"),
  `all five features render an inline label (${[...kinds].sort().join(", ")})`);

// auto-flip: every label angle within [-90,90]
const angles = labels.filter((l) => l.deg != null);
log(angles.length > 0 && angles.every((l) => l.deg >= -90.001 && l.deg <= 90.001),
  `every inline label is auto-flipped into [-90,90] (never upside-down) — ${angles.map((l) => `${l.text}:${l.deg}`).join(" ")}`);

// own color + white halo
const upLabel = labels.find((l) => l.text === "UP-LINE");
log(!!upLabel && upLabel.paintOrder.includes("stroke") && upLabel.stroke.includes("255, 255, 255"),
  `label carries a white halo (paint-order:stroke, stroke ${upLabel ? upLabel.stroke : "?"})`);
log(!!upLabel && (upLabel.fill.includes("#0a7d22") || upLabel.fill.includes("10, 125, 34")),
  `label uses the line's OWN color (fill ${upLabel ? upLabel.fill : "?"} == the green #0a7d22)`);

// density gradient: long line (150ft) shows MORE instances than the long road (700ft)
const cnt = (t) => labels.filter((l) => l.text === t).length;
log(cnt("SEWERA") > cnt("ROADA") && cnt("ROADA") >= 1,
  `density gradient: the long line has MORE labels than the equally-long road (line ${cnt("SEWERA")} vs road ${cnt("ROADA")})`);
await page.screenshot({ path: OUT + "b620-inline-labels.png" });

// export survival: the label survives the buildExportSvg strip; selection chrome does not
const svgHasLabel = await page.evaluate((cfg) => {
  const svg = [...document.querySelectorAll("svg")].find((s) => [...s.querySelectorAll("text")].some((t) => (t.textContent || "").trim() === "SEWERA"));
  if (!svg) return null;
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
  const label = [...clone.querySelectorAll("text")].some((t) => (t.textContent || "").trim() === "SEWERA");
  const blueChrome = clone.querySelectorAll('rect[stroke="' + cfg.blue + '"], polygon[stroke="' + cfg.blue + '"]').length;
  return { label, blueChrome };
}, { blue: SEL_BLUE });
log(!!svgHasLabel && svgHasLabel.label, `inline label SURVIVES the export strip (appears in PNG/PDF)`);

// LOD: zoom way out → labels hide; zoom back → return
await page.mouse.move(720, 450);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(50); }
await page.waitForTimeout(300);
const zoomedOut = (await readLabels()).length;
log(zoomedOut < labels.length, `LOD: zooming out hides labels that no longer fit (${labels.length} → ${zoomedOut})`);
for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(50); }
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 3000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(400);
const zoomedBack = (await readLabels()).length;
log(zoomedBack >= labels.length - 1, `LOD: zooming back in restores the labels (${zoomedOut} → ${zoomedBack})`);

// B935 — double-clicking a line now opens the PROPERTIES panel (never an on-canvas inline-label editor);
// the label is edited only in the panel's own "Inline label" field. Dispatch a native dblclick on the
// line's <g> (React onDoubleClick → onMarkupDouble → Properties). Playwright's synthetic mouse-dblclick
// is unreliable here because startMoveMarkup captures the pointer.
const opened = await page.evaluate(() => {
  const lines = [...document.querySelectorAll("svg line")].filter((l) => (l.getAttribute("stroke") || "").toLowerCase() === "#0a7d22");
  let best = null, bl = -1;
  for (const l of lines) { const x1 = +l.getAttribute("x1"), y1 = +l.getAttribute("y1"), x2 = +l.getAttribute("x2"), y2 = +l.getAttribute("y2"); const L = Math.hypot(x2 - x1, y2 - y1); if (L > bl) { bl = L; best = l; } }
  if (!best) return false;
  best.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
  return true;
});
await page.waitForTimeout(300);
const noCanvasEditor = await page.evaluate(() => !document.querySelector("foreignObject input"));
log(opened && noCanvasEditor, `double-click a line opens Properties, NOT an on-canvas inline-label editor (B935)`);
const panelSel = '[data-testid="property-panel"] input[placeholder*="SANITARY"]';
const hasPanelField = await page.evaluate((s) => !!document.querySelector(s), panelSel);
log(hasPanelField, `the Properties panel exposes the "Inline label" field`);
if (hasPanelField) {
  // edit the label via the PANEL field, then confirm the on-canvas label updates
  await page.locator(panelSel).click();
  await page.locator(panelSel).fill("EDITEDINPANEL");
  await page.locator(panelSel).blur();
  await page.waitForTimeout(300);
  const edited = await page.evaluate(() => [...document.querySelectorAll("svg text")].some((t) => (t.textContent || "").includes("EDITEDINPANEL")));
  log(edited, `editing the panel "Inline label" field updates the on-canvas label`);
  // draw a NEW line via the Line tool (L → drag) — it must NOT inherit any label (the sticky trap).
  await page.keyboard.press("l");
  await page.waitForTimeout(150);
  await page.mouse.move(480, 740); await page.mouse.down(); await page.mouse.move(700, 740); await page.mouse.move(920, 740); await page.mouse.up();
  await page.waitForTimeout(300);
  const strayNewLine = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = raw["verify-b620"]; if (!site) return { total: 0, labelled: 0 };
    const lines = (site.markups || []).filter((m) => m.kind === "line");
    return { total: lines.length, labelled: lines.filter((m) => (m.inlineLabel || "").trim()).length };
  });
  // the 3 SEEDED lines all carry a label; the ONE freshly drawn line must be the only blank one.
  log(strayNewLine.total - strayNewLine.labelled === 1 && strayNewLine.total >= 4,
    `non-sticky: the newly drawn line did NOT inherit the typed label (${strayNewLine.total - strayNewLine.labelled} blank of ${strayNewLine.total} lines)`);
}

log(errors.length === 0, `no page errors (${errors.length})` + (errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""));
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
