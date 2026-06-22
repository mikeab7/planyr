/* Diagnostic: capture the CURRENT exported Gantt (PDF/Print Exhibit preview) to see
 * NEW-1 (vertical rules over bars), NEW-2 (broken left edge), NEW-3 (diagonal deps),
 * NEW-4 (timeline framing). Screenshots the .split-gantt and dumps the SVG paint order. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1050 }, ignoreHTTPSErrors: true, deviceScaleFactor: 3 });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [err]", m.text().slice(0, 160)); });
const seqFrame = () => page.frames().find((f) => f.url().includes("/sequence/"));
const blobFrames = () => page.frames().filter((f) => f.url().startsWith("blob:"));

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector('button[title^="All projects —"]', { timeout: 20000 });
await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Schedule"); if (t) t.click(); });
let frame = null;
for (let i = 0; i < 50; i++) {
  frame = seqFrame();
  if (frame) {
    const ready = await page.evaluate(() => { const h = document.querySelector("header"); return !!h && [...h.querySelectorAll("button[title]")].some((b) => b.getAttribute("title").startsWith("Export")); }).catch(() => false);
    if (ready) break;
  }
  await page.waitForTimeout(400);
}
await page.waitForTimeout(500);
await page.evaluate(() => { const h = document.querySelector("header"); const b = h && [...h.querySelectorAll("button[title]")].find((x) => x.getAttribute("title").startsWith("Export")); if (b) b.click(); });
await page.waitForTimeout(300);
await page.evaluate(() => { const item = [...document.querySelectorAll("div,span,button")].find((e) => e.textContent.trim() === "PDF / Print Exhibit" && e.getClientRects().length > 0); const click = item && (item.closest("[role='menuitem'],[style*='cursor'],button") || item.parentElement || item); if (click) click.click(); });

let blob = null;
for (let i = 0; i < 50; i++) {
  blob = blobFrames()[0];
  if (blob && await blob.evaluate(() => !!document.querySelector(".split-gantt svg")).catch(() => false)) break;
  await page.waitForTimeout(300);
}
if (!blob) { console.log("no preview"); await browser.close(); process.exit(1); }
await page.waitForTimeout(1200);
blob = blobFrames()[0];

const info = await blob.evaluate(() => {
  const svg = document.querySelector(".split-gantt svg");
  const kids = [...svg.children].map((c) => c.tagName + (c.getAttribute("class") ? "." + c.getAttribute("class") : "") + (c.getAttribute("fill") ? " fill=" + c.getAttribute("fill") : "") + (c.getAttribute("stroke") ? " stroke=" + c.getAttribute("stroke") : ""));
  // group counts by visual role
  const html = svg.innerHTML;
  const sg = document.querySelector(".split-gantt").getBoundingClientRect();
  const svgr = svg.getBoundingClientRect();
  return {
    childCount: svg.children.length,
    first12: kids.slice(0, 12),
    last12: kids.slice(-12),
    hasViewBox: svg.hasAttribute("viewBox"),
    svgWidthAttr: svg.getAttribute("width"),
    deps: (html.match(/class="dep"/g) || []).length,
    bezier: (html.match(/ C\d/g) || html.match(/C[\d.]+,/g) || []).length,
    todayDash: /stroke-dasharray="3,2"/.test(html),
    yearLine: /stroke="#8b95a3"/.test(html),
    ganttBox: { w: Math.round(sg.width), h: Math.round(sg.height) },
    svgBox: { w: Math.round(svgr.width), h: Math.round(svgr.height) },
  };
});
console.log(JSON.stringify(info, null, 2));

// Screenshot the gantt region only (high DSF) + the split-view seam
await blob.locator(".split-gantt").first().screenshot({ path: "ui-audit/screens/diag-gantt-only-before.png" }).catch(() => {});
await blob.locator(".split-view").first().screenshot({ path: "ui-audit/screens/diag-gantt-export-before.png" }).catch(async () => {
  await page.screenshot({ path: "ui-audit/screens/diag-gantt-export-before.png" });
});
console.log("screenshots: ui-audit/screens/diag-gantt-{only,export}-before.png");
await browser.close();
