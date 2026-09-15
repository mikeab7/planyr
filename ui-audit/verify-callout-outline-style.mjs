/* Self-verification for B1652704/B1652705/B1652706 — the Text box / Callout outline gains
 * weight + dash + opacity, the fill gains its own opacity, and the panel is rebuilt on the shared
 * row primitive. Driven in the REAL app (logged-out, Vite preview :4173) — no auth, no GIS, so
 * this is Claude-doable HERE per ATTEMPT-BEFORE-YOU-PARK; the production + WebKit + phone-width
 * pass is filed separately as a live-verify item (V1180736) since it needs a deployed build.
 *
 * Checks:
 *   NEW-1  an untouched callout/text box (no weight/dash set) renders the SAME box border as
 *          current main: strokeWidth 1.4, no strokeDasharray, strokeOpacity absent/1 (back-compat).
 *   NEW-1  THE LEADER LINE IS PART OF THE OUTLINE — changing Weight/Pattern in the panel updates
 *          the box border AND the leader's stub/run/arrowhead identically, live.
 *   NEW-2  Opacity (outline) and Fill opacity are independent controls, and fill opacity never
 *          touches the text (<text> stays fully opaque while the box fades).
 *   NEW-3  the panel is on the shared row primitive: a Fill|Line paired header, an X|Y padding
 *          paired header, and every row (single or paired) shares one left label-gutter edge.
 *
 * Run: node ui-audit/verify-callout-outline-style.mjs   (preview server must be up on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const DEMO_ID = "verify-b1652704";
// B1213312 (Work Item A) routes a project by id: `#/project/<groupId>/<slug>` — a bare `#/site`
// (or no hash at all) now lands on the Dashboard / project-less picker, not this seeded plan.
const BASE = process.env.BASE_URL || `http://localhost:4173/#/project/${DEMO_ID}/site`;
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const parcel = { id: "pc1", locked: false, points: [{ x: -900, y: -450 }, { x: 900, y: -450 }, { x: 900, y: 450 }, { x: -900, y: 450 }] };
// A callout WITH a leader (so the leader-coupling checks have a leader to read) and a plain text box.
const calloutX = { id: "coX", text: "CALLOUTX", box: { x: -300, y: 300 }, tip: { x: -650, y: 420 }, fill: "#ffd9a8", stroke: "#7a3b00", color: "#3a1c00", size: 20 };
const textBoxY = { id: "tbY", text: "TEXTBOXY", box: { x: 400, y: 300 }, noLeader: true, fill: "#a8d9ff", stroke: "#003a5a", color: "#00243a", size: 15 };

const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B1652704", name: "Plan 1", origin: null, county: null,
  parcels: [parcel], els: [], measures: [], callouts: [calloutX, textBoxY], markups: [],
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
await assertMeasurable(page, "verify-callout-outline-style");
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

const calloutBox = (fill) => page.evaluate((f) => {
  const r = [...document.querySelectorAll("svg rect")].find((x) => (x.getAttribute("fill") || "").toLowerCase() === f);
  if (!r) return null;
  const b = r.getBoundingClientRect();
  return {
    cx: b.x + b.width / 2, cy: b.y + b.height / 2,
    strokeWidth: r.getAttribute("stroke-width"), dash: r.getAttribute("stroke-dasharray"),
    strokeOpacity: r.getAttribute("stroke-opacity"), fillOpacity: r.getAttribute("fill-opacity"),
  };
}, fill);
const leaderLines = (idAttr) => page.evaluate((id) => {
  const g = document.querySelector(`g[data-testid="callout-${id}"]`);
  if (!g) return [];
  return [...g.querySelectorAll(`line[data-testid^="callout-leader-stub-"], line[data-testid^="callout-leader-run-"]`)]
    .map((l) => ({ strokeWidth: l.getAttribute("stroke-width"), dash: l.getAttribute("stroke-dasharray"), strokeOpacity: l.getAttribute("stroke-opacity") }));
}, idAttr);
const clickAt = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(250); };

// ---- back-compat: an UNTOUCHED callout (no weight/dash/opacity saved) renders exactly like main ----
let cc = await calloutBox("#ffd9a8");
log(!!cc && cc.strokeWidth === "1.4", `NEW-1 back-compat: untouched box border stroke-width is 1.4 (got ${cc?.strokeWidth})`);
log(!!cc && !cc.dash, `NEW-1 back-compat: untouched box has no dasharray (solid) (got ${cc?.dash})`);
log(!!cc && (cc.strokeOpacity === "1" || cc.strokeOpacity === null), `NEW-1 back-compat: untouched box stroke-opacity is 1/absent (got ${cc?.strokeOpacity})`);
log(!!cc && (cc.fillOpacity === "1" || cc.fillOpacity === null), `NEW-2 back-compat: untouched box fill-opacity is 1/absent (got ${cc?.fillOpacity})`);
const leadersBefore = await leaderLines("coX");
log(leadersBefore.length === 2 && leadersBefore.every((l) => l.strokeWidth === "1.4" && !l.dash),
  `NEW-1 back-compat: leader stub+run are ALSO 1.4/solid (NOT the old separately-hardcoded 1.6) — ${JSON.stringify(leadersBefore)}`);

// ---- select the callout (with leader), then dock the Properties tab (desktop: selecting alone
//      does not take over the left dock — B733's "properties" tab does) ----
if (cc) await clickAt(cc.cx, cc.cy);
await page.waitForTimeout(200);
try { await page.getByText("Properties", { exact: true }).first().click({ timeout: 3000 }); } catch (e) { /* noop */ }
await page.waitForTimeout(300);

// ---- NEW-3: the panel shares one left gutter edge across single rows, the Fill|Line pair and the X|Y pair ----
// Only the TOP-LEVEL Field/PairedField rows use the shared 64px label gutter — NumInput wraps its
// own ▲▼ stepper in a `data-field-group` div too (a keyboard-scope marker), so isolate rows by the
// shared grid template rather than the attribute alone.
const layout = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('[data-field-group="1"]')].filter((g) => {
    const cs = getComputedStyle(g);
    return cs.display === "grid" && cs.gridTemplateColumns.startsWith("64px");
  });
  const heads = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && (el.textContent === "Fill" || el.textContent === "Line" || el.textContent === "X" || el.textContent === "Y"));
  const rowInfo = groups.map((g) => {
    const cs = getComputedStyle(g);
    return { cols: cs.gridTemplateColumns, left: g.getBoundingClientRect().x, label: (g.children[0]?.textContent || "").trim() };
  });
  return { rowInfo, hasFill: !!heads.find((h) => h.textContent === "Fill"), hasLine: !!heads.find((h) => h.textContent === "Line") };
});
const weightRow = layout.rowInfo.find((r) => r.label === "Weight");
const paddingRow = layout.rowInfo.find((r) => r.label === "Padding");
const colourRows = layout.rowInfo.filter((r) => r.label === "Colour");
const singleRows = layout.rowInfo.filter((r) => r.cols.split(" ").length === 2);
const pairedRows = layout.rowInfo.filter((r) => r.cols.split(" ").length === 3);
log(layout.hasFill && layout.hasLine, `NEW-3 the FILL | LINE paired column header renders`);
log(!!weightRow && !!paddingRow, `NEW-3 Weight and Padding rows both render on the rebuilt panel`);
const leftEdges = new Set(layout.rowInfo.map((r) => Math.round(r.left)));
log(leftEdges.size === 1, `NEW-3 every row (single-column and paired) shares ONE left gutter edge — edges seen: ${[...leftEdges].join(",")}`);
log(singleRows.length >= 5 && pairedRows.length >= 5, `NEW-3 both single (${singleRows.length}) and paired (${pairedRows.length}) row shapes are present`);
log(colourRows.length === 2, `NEW-3 exactly one single-column Colour row (text) + one paired Colour row (fill/line) — found ${colourRows.length}`);

// ---- NEW-1: drive the Weight control and confirm box + BOTH leader segments update together ----
// Real Playwright interaction (click-select-all → type → Tab to commit on blur), not a synthetic
// DOM event dispatch — NumInput commits on a real onBlur, and the two are not equivalent here
// (SYNTHETIC-KEYS-DONT-EDIT's own lesson generalizes: drive the real control, then re-read).
const rowGroupHandle = (labelText) => page.evaluateHandle((label) => {
  const groups = [...document.querySelectorAll('[data-field-group="1"]')].filter((g) => {
    const cs = getComputedStyle(g);
    return cs.display === "grid" && cs.gridTemplateColumns.startsWith("64px");
  });
  return groups.find((g) => (g.children[0]?.textContent || "").trim() === label) || null;
}, labelText);
const typeIntoRow = async (labelText, text) => {
  const handle = await rowGroupHandle(labelText);
  const group = handle.asElement();
  if (!group) return false;
  const input = await group.$("input");
  if (!input) return false;
  await input.click({ clickCount: 3 });
  await input.type(text);
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  return true;
};
const foundWeight = await typeIntoRow("Weight", "5");
const foundDash = await page.evaluate(() => {
  const groups = [...document.querySelectorAll('[data-field-group="1"]')].filter((g) => {
    const cs = getComputedStyle(g);
    return cs.display === "grid" && cs.gridTemplateColumns.startsWith("64px");
  });
  const patternGroup = groups.find((g) => (g.children[0]?.textContent || "").trim() === "Pattern");
  const dSelect = patternGroup?.querySelector("select");
  if (!dSelect) return false;
  dSelect.value = "dashed";
  dSelect.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
});
await page.waitForTimeout(250);
// Opacity row: PairedField renders fill (left) then outline (right) — the outline input is second.
const foundOpacity = await (async () => {
  const handle = await rowGroupHandle("Opacity");
  const group = handle.asElement();
  if (!group) return false;
  const inputs = await group.$$("input");
  const outlineInput = inputs[inputs.length - 1];
  if (!outlineInput) return false;
  await outlineInput.click({ clickCount: 3 });
  await outlineInput.type("40");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  return true;
})();
log(foundWeight && foundDash && foundOpacity, `NEW-1/NEW-2 Weight/Pattern/Opacity controls located and driven (weight=${foundWeight} dash=${foundDash} opacity=${foundOpacity})`);

cc = await calloutBox("#ffd9a8");
log(!!cc && cc.strokeWidth === "5", `NEW-1 box border strokeWidth follows the Weight control (got ${cc?.strokeWidth})`);
log(!!cc && cc.dash === "15 12", `NEW-1 box border strokeDasharray follows the Pattern control, scaled by the new weight (got ${cc?.dash})`);
log(!!cc && Math.abs(parseFloat(cc.strokeOpacity) - 0.4) < 0.01, `NEW-2 box border strokeOpacity follows the Opacity control (got ${cc?.strokeOpacity})`);

const leadersAfter = await leaderLines("coX");
log(leadersAfter.length === 2 && leadersAfter.every((l) => l.strokeWidth === "5" && l.dash === "15 12" && Math.abs(parseFloat(l.strokeOpacity) - 0.4) < 0.01),
  `NEW-1 THE LEADER LINE IS PART OF THE OUTLINE — both leader segments picked up the SAME weight/dash/opacity live — ${JSON.stringify(leadersAfter)}`);
await page.screenshot({ path: OUT + "callout-outline-style-live.png" });

// ---- NEW-2: fill opacity is independent, and the TEXT stays fully opaque while the fill fades ----
await (async () => {
  const handle = await rowGroupHandle("Opacity");
  const group = handle.asElement();
  if (!group) return;
  const inputs = await group.$$("input");
  const fillInput = inputs[0]; // left column = Fill
  if (!fillInput) return;
  await fillInput.click({ clickCount: 3 });
  await fillInput.type("10");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
})();
cc = await calloutBox("#ffd9a8");
log(!!cc && Math.abs(parseFloat(cc.fillOpacity) - 0.1) < 0.01, `NEW-2 box fill-opacity follows the Fill Opacity control independently of outline opacity (got ${cc?.fillOpacity})`);
const textOpacity = await page.evaluate(() => {
  const t = [...document.querySelectorAll("svg text")].find((x) => (x.textContent || "").trim() === "CALLOUTX");
  return t ? (t.getAttribute("fill-opacity") || getComputedStyle(t).fillOpacity) : null;
});
log(textOpacity === "1" || textOpacity === null, `NEW-2 the TEXT stays fully opaque while the fill fades (text fill-opacity: ${textOpacity})`);
await page.screenshot({ path: OUT + "callout-fill-opacity-text-unaffected.png" });

log(errors.length === 0, `no page errors (${errors.length})${errors.length ? " → " + errors.slice(0, 3).join(" | ") : ""}`);

console.log(fail === 0 ? "\n✓ all checks passed" : `\n✗ ${fail} check(s) failed`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
