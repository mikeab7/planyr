// Verifies the single-SVG print sheet composition (B200): renders the real
// `buildPrintSheetSvg` output (the exact markup the print routine emits) to an HTML page
// and screenshots it. Confirms the title block, the plan and the metrics band live in ONE
// cohesive SVG. (The right-hand buildings table this once also confirmed — B197 — was
// removed in B1804993; the plan takes the full width that column used to reserve. B1934529
// brought a printed buildings table back as a compact CORNER INSET, toggleable — this harness
// now renders the sheet with that inset ON and OFF and screenshots both, so the before/after is
// a real artifact, not just an assertion.)
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { buildPrintSheetSvg, printSheetLayout, sheetFileName } from "../src/workspaces/site-planner/lib/printSheet.js";
import { buildSheetFurnitureSvg } from "../src/workspaces/site-planner/lib/sheetFurnitureLayout.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PAL = { ink: "#26231e", muted: "#8a8473", panelLine: "#cfc6af", paper: "#ffffff" };
const layout = printSheetLayout({ paper: "letter", orient: "landscape" });
const pb = layout.plan;
const metrics = [
  ["Site area", "42.0 ac (1,829,520 sf)"], ["Building", "1,110,000 sf"], ["Lot coverage", "61%"],
  ["FAR (1-story)", "0.61"], ["Car stalls", "640 (0.6/1k sf)"], ["Trailer stalls", "60"],
  ["Impervious", "82%"], ["Detention", "120,000 sf"], ["Open / green", "7.6 ac"],
];
const BUILDING_ROWS = [{ name: "Building 1", sf: 1176940 }, { name: "Building 2", sf: 245574 }];
const BUILDING_TOTAL = BUILDING_ROWS.reduce((s, r) => s + r.sf, 0);

// Synthetic "plan" — a nested <svg> sized to the plan box with its own viewBox, exactly how the
// real plan clone is embedded, PLUS the same sheet-furniture group `buildExportSvgRaw` appends
// (scale bar / north arrow / the buildings inset when toggled on) — so this fixture exercises the
// same composition the real export builds, not a simplified stand-in that could hide a defect.
function planSvgFor({ withBuildingsTable }) {
  const contentW = 800, contentH = 560;
  const furniture = buildSheetFurnitureSvg({
    x: 0, y: 0, w: contentW, h: contentH, ftPerUnit: 2, fmtFeet: (n) => String(Math.round(n)), pal: {},
    obstacles: [{ x: 110, y: 90, w: 420, h: 200 }, { x: 110, y: 330, w: 600, h: 150 }],
    buildingRows: withBuildingsTable ? BUILDING_ROWS : [],
    buildingTotal: BUILDING_TOTAL,
    fmtSf: (n) => Math.round(n).toLocaleString(),
  });
  return `<svg x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" viewBox="0 0 ${contentW} ${contentH}" preserveAspectRatio="xMidYMid meet">`
    + `<rect x="0" y="0" width="${contentW}" height="${contentH}" fill="#eef3ec"/>`
    + `<rect x="110" y="90" width="420" height="200" fill="#cdd6c2" stroke="#5b6650" stroke-width="3"/>`
    + `<text x="320" y="200" text-anchor="middle" font-size="30" fill="#33402c" font-family="sans-serif">Building 1</text>`
    + `<rect x="110" y="330" width="600" height="150" fill="#d9d2c0" stroke="#8a8473" stroke-width="2"/>`
    + `<text x="410" y="415" text-anchor="middle" font-size="22" fill="#6b6557" font-family="sans-serif">parking</text>`
    + furniture
    + `</svg>`;
}

mkdirSync("ui-audit/screens", { recursive: true });
const sheetOn = buildPrintSheetSvg({
  layout, planSvg: planSvgFor({ withBuildingsTable: true }), title: "Cypress Logistics", sub: "Plan 1", date: "2026.06.19",
  metrics, note: "Concept site plan — planning-level estimates, not a survey.", pal: PAL,
});
const sheetOff = buildPrintSheetSvg({
  layout, planSvg: planSvgFor({ withBuildingsTable: false }), title: "Cypress Logistics", sub: "Plan 1", date: "2026.06.19",
  metrics, note: "Concept site plan — planning-level estimates, not a survey.", pal: PAL,
});
const htmlFor = (sheet) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#9a958c}
  svg{display:block;margin:24px auto;box-shadow:0 6px 26px rgba(0,0,0,.35)}
</style></head><body>${sheet}</body></html>`;
writeFileSync("ui-audit/screens/print-sheet.html", htmlFor(sheetOn));
writeFileSync("ui-audit/screens/print-sheet-buildings-on.html", htmlFor(sheetOn));
writeFileSync("ui-audit/screens/print-sheet-buildings-off.html", htmlFor(sheetOff));

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1240, height: 1040 }, deviceScaleFactor: 2 });
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-print-sheet");

async function checkFor(file) {
  await page.goto("file://" + process.cwd() + `/ui-audit/screens/${file}`);
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const root = document.querySelector("body > svg");
    const txt = root ? root.textContent : "";
    const nestedPlan = root ? root.querySelectorAll("svg").length : 0;
    return {
      oneRootSvg: document.querySelectorAll("body > svg").length === 1,
      hasTitle: txt.includes("Cypress Logistics"),
      hasBuildingsHeading: txt.includes("BUILDINGS"),
      hasBuilding1Row: txt.includes("Building 1") && txt.includes("1,176,940"),
      hasMetrics: txt.includes("Site area"),
      nestedPlan,
      viewBox: root && root.getAttribute("viewBox"),
      widthIn: root && root.getAttribute("width"),
      planX: root && root.querySelector("svg")?.getAttribute("x"),
      planW: root && root.querySelector("svg")?.getAttribute("width"),
    };
  });
}

const on = await checkFor("print-sheet-buildings-on.html");
await page.screenshot({ path: "ui-audit/screens/print-sheet-buildings-on.png", fullPage: true });
const off = await checkFor("print-sheet-buildings-off.html");
await page.screenshot({ path: "ui-audit/screens/print-sheet.png", fullPage: true }); // kept for back-compat with any existing consumer of this filename
await page.screenshot({ path: "ui-audit/screens/print-sheet-buildings-off.png", fullPage: true });
await browser.close();

const checks = {
  on, off,
  // NEW-2 (B1934529): toggling the inset adds/removes it and nothing else — same plan box.
  toggleAddsInsetOnly: on.hasBuildingsHeading && on.hasBuilding1Row && !off.hasBuildingsHeading && !off.hasBuilding1Row,
  planBoxUnaffectedByToggle: on.planX === off.planX && on.planW === off.planW, // the map area is not shrunk by the toggle
};
console.log("checks:", JSON.stringify(checks, null, 2));
console.log("filename example:", sheetFileName({ project: "Cypress Logistics", n: 1, date: new Date(2026, 5, 19) }));
console.log("wrote ui-audit/screens/print-sheet-buildings-on.png + print-sheet-buildings-off.png");
if (!checks.toggleAddsInsetOnly || !checks.planBoxUnaffectedByToggle) {
  console.error("FAIL — see checks above");
  process.exit(1);
}
