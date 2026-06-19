// Verifies the single-SVG print sheet composition (B200) + the buildings data table
// (B197): renders the real `buildPrintSheetSvg` output (the exact markup the print
// routine emits) to an HTML page and screenshots it. Confirms the title block, the
// plan, the right-hand buildings table and the metrics band live in ONE cohesive SVG.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { buildPrintSheetSvg, printSheetLayout, sheetFileName } from "../src/workspaces/site-planner/lib/printSheet.js";

const PAL = { ink: "#26231e", muted: "#8a8473", panelLine: "#cfc6af", paper: "#ffffff" };
const rows = [
  { name: "Building 1", sf: 250000, clearHeight: 36, slab: 7 },
  { name: "Cross Dock", sf: 620000, clearHeight: 40, slab: 7 },
  { name: "Building 3", sf: 95000, clearHeight: 32, slab: 6 },
  { name: "Building 4", sf: 145000, clearHeight: 36, slab: 7 },
];
const layout = printSheetLayout({ paper: "letter", orient: "landscape", buildingCount: rows.length });
const pb = layout.plan;
// Synthetic "plan" — a nested <svg> sized to the plan box with its own viewBox, exactly
// how the real plan clone is embedded.
const planSvg = `<svg x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet">`
  + `<rect x="0" y="0" width="800" height="560" fill="#eef3ec"/>`
  + `<rect x="110" y="90" width="420" height="200" fill="#cdd6c2" stroke="#5b6650" stroke-width="3"/>`
  + `<text x="320" y="200" text-anchor="middle" font-size="30" fill="#33402c" font-family="sans-serif">Building 1</text>`
  + `<rect x="110" y="330" width="600" height="150" fill="#d9d2c0" stroke="#8a8473" stroke-width="2"/>`
  + `<text x="410" y="415" text-anchor="middle" font-size="22" fill="#6b6557" font-family="sans-serif">parking</text>`
  + `</svg>`;
const metrics = [
  ["Site area", "42.0 ac (1,829,520 sf)"], ["Building", "1,110,000 sf"], ["Lot coverage", "61%"],
  ["FAR (1-story)", "0.61"], ["Car stalls", "640 (0.6/1k sf)"], ["Trailer stalls", "60"],
  ["Impervious", "82%"], ["Detention", "120,000 sf"], ["Open / green", "7.6 ac"],
];
const sheet = buildPrintSheetSvg({
  layout, planSvg, title: "Cypress Logistics", sub: "Plan 1", date: "2026.06.19",
  metrics, note: "Concept site plan — planning-level estimates, not a survey.", buildings: rows, pal: PAL,
});
mkdirSync("ui-audit/screens", { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#9a958c}
  svg{display:block;margin:24px auto;box-shadow:0 6px 26px rgba(0,0,0,.35)}
</style></head><body>${sheet}</body></html>`;
writeFileSync("ui-audit/screens/print-sheet.html", html);

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1240, height: 1040 }, deviceScaleFactor: 2 });
await page.goto("file://" + process.cwd() + "/ui-audit/screens/print-sheet.html");
await page.waitForTimeout(250);
// Assert there is exactly ONE root sheet svg, and the table text rendered.
const checks = await page.evaluate(() => {
  const root = document.querySelector("body > svg");
  const txt = root ? root.textContent : "";
  const nestedPlan = root ? root.querySelectorAll("svg").length : 0;
  return {
    oneRootSvg: document.querySelectorAll("body > svg").length === 1,
    hasTitle: txt.includes("Cypress Logistics"),
    hasTableTitle: txt.includes("BUILDINGS"),
    hasCrossDock: txt.includes("Cross Dock"),
    hasMetrics: txt.includes("Site area"),
    nestedPlan,
    viewBox: root && root.getAttribute("viewBox"),
    widthIn: root && root.getAttribute("width"),
  };
});
await page.screenshot({ path: "ui-audit/screens/print-sheet.png", fullPage: true });
await browser.close();
console.log("checks:", JSON.stringify(checks, null, 2));
console.log("filename example:", sheetFileName({ project: "Cypress Logistics", n: 1, date: new Date(2026, 5, 19) }));
console.log("wrote ui-audit/screens/print-sheet.png");
