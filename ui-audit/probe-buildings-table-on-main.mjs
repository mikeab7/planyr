#!/usr/bin/env node
/* probe-buildings-table-on-main — the RED PROOF for verify-buildings-table-off-drawing (NEW-1, 2026-10-27).
 *
 *   PLANYR_BASE=http://127.0.0.1:4174 node ui-audit/probe-buildings-table-on-main.mjs --fixture goose2 --out <dir>   (a build of the PRE-FIX tree)
 *
 * Drives the real Download PDF flow (Flatten markups OFF, Buildings table ON) on the 3-building Goose Creek Phase II plan, then
 * renders the editable PDF twice with poppler — annotations drawn, and `-hide-annotations` (the page picture alone) — and counts
 * the pixels of the table's own rectangle that the annotations change. The rectangle is read from the sheet's own SVG (the plate
 * holding the BUILDINGS text), so no coordinate is hard-coded.
 *   PRE-FIX tree: the table is page picture inside the plan; the detention pond's annotation paints over it —
 *     measured 2026-10-27: 87.7% of the table's rectangle changed ("RESULT: DEFECT REPRODUCED").
 *   FIXED tree: the page picture has no table inside the plan frame at all ("RESULT: the page picture has no BUILDINGS table…").
 * It exits 0 either way: it reports, verify-buildings-table-off-drawing asserts. Needs pdftoppm.
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { realisticSitePlan } from "./lib/realisticSitePlan.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4174";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome";
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/probe-bt-main";
mkdirSync(OUT, { recursive: true });
const FX = process.argv.includes("--fixture") ? process.argv[process.argv.indexOf("--fixture") + 1] : null; // e.g. goose2 (16 buildings, the owner's Goose Creek plan shape)
const rec = FX ? { id: "zz-probe-main" } : realisticSitePlan("zz-probe-main");
const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
if (FX) await ctx.addInitScript(fixtureSeed(readFixture(FX), { id: rec.id, pdfStorage: false }));
await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
const page = await ctx.newPage();
await assertMeasurable(page, "probe-buildings-table-on-main");
await page.goto(BASE, { waitUntil: "domcontentloaded" });
if (!FX) await page.evaluate((r) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, rec);
await page.goto(`${BASE}/#/project/${rec.id}/site`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 90000 });
await pacedWait(page, 3500);
await page.evaluate(() => {
  window.__pdfs = []; window.__svgs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { try {
    if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); window.__pdfs.push(btoa(s)); });
    if (b && b.type && b.type.indexOf("svg") >= 0) b.text().then((t) => window.__svgs.push(t));
  } catch (_) {} return real(b); };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
});
async function exportOnce(flatten) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
  for (const label of ["Buildings table", "Stats band"]) { // a saved plan can have these OFF (the Goose fixture does); the owner's export had them ON
    const t = page.getByLabel(label);
    if ((await t.count()) && !(await t.first().isChecked())) { await t.first().click(); await pacedWait(page, 1500); }
    console.log(`   compose toggle "${label}": ${(await t.count()) ? (await t.first().isChecked()) ? "ON" : "OFF" : "absent"}`);
  }
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const before = await page.evaluate(() => window.__pdfs.length);
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let n = before;
  for (let i = 0; i < 240 && n <= before; i++) { n = await page.evaluate(() => window.__pdfs.length); await page.waitForTimeout(250); }
  await pacedWait(page, 800);
  const b64 = await page.evaluate(() => window.__pdfs[window.__pdfs.length - 1]);
  await page.getByRole("button", { name: "Cancel" }).first().click().catch(() => {});
  await pacedWait(page, 500);
  return Buffer.from(b64, "base64");
}
const edit = await exportOnce(false);
writeFileSync(join(OUT, "editable.pdf"), edit);
const sheetSvg = await page.evaluate(() => window.__svgs.filter((t) => t.length > 5000 && t.includes(">BUILDINGS<")).pop() || "");
await browser.close();
// where the sheet printed the table, from its own markup: the plate <g> holding ">BUILDINGS<" inside the nested plan <svg>
const num = (re, str) => Number((re.exec(str) || [])[1]);
const nested = /<svg [^>]*viewBox="([-\d.\s]+)"[^>]*>/.exec(sheetSvg.slice(sheetSvg.indexOf("<svg", 10)));
const nestedTag = sheetSvg.slice(sheetSvg.indexOf("<svg", 10), sheetSvg.indexOf(">", sheetSvg.indexOf("<svg", 10)) + 1);
const at = sheetSvg.indexOf(">BUILDINGS<");
if (at < 0 || !nested || sheetSvg.includes('data-sheet-table="buildings"')) { console.log("RESULT: the page picture has no BUILDINGS table inside the plan frame (the fixed layout: it is its own band + annotation)"); process.exit(0); }
const [vx, vy, vw, vh] = nested[1].trim().split(/\s+/).map(Number);
const px = num(/ x="([-\d.]+)"/, nestedTag), py = num(/ y="([-\d.]+)"/, nestedTag), pw = num(/ width="([-\d.]+)"/, nestedTag), ph = num(/ height="([-\d.]+)"/, nestedTag);
const k = Math.min(pw / vw, ph / vh), ox = px + (pw - vw * k) / 2, oy = py + (ph - vh * k) / 2;
const gStart = sheetSvg.lastIndexOf('<g transform="translate(', at), tr = /translate\(([-\d.]+),([-\d.]+)\)/.exec(sheetSvg.slice(gStart, gStart + 60));
const rc = /<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)"/.exec(sheetSvg.slice(gStart, at));
const [tx, ty, tw, th] = [Number(tr[1]), Number(tr[2]), Number(rc[1]), Number(rc[2])];
const D = 100 / 100; // 1 c-in = 1/100 in; the render is 100 dpi → 1 px per c-in
const region = { x: Math.round(ox + (tx - vx) * k), y: Math.round(oy + (ty - vy) * k), w: Math.round(tw * k), h: Math.round(th * k) };
const render = (f, st, hide = false) => { execFileSync("pdftoppm", ["-r", "100", "-png", "-singlefile", ...(hide ? ["-hide-annotations"] : []), join(OUT, f), join(OUT, st)]); return decodePng(readFileSync(join(OUT, `${st}.png`))); };
const A = render("editable.pdf", "editable"), B = render("editable.pdf", "editable-page-only", true); // B = the page picture alone: what the table looks like when nothing paints over it
const lum = (img, x, y) => { const i = (y * img.width + x) * img.channels; return img.channels >= 3 ? (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 : img.data[i]; };
let n = 0, diff = 0, inkFlat = 0;
for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) { n++; const a = lum(A, x, y), b = lum(B, x, y); if (Math.abs(a - b) > 60) diff++; if (b < 140) inkFlat++; }
console.log(`table plate in the PAGE at px [${region.x},${region.y} ${region.w}×${region.h}] (${D}px/c-in); ink px in the page picture: ${inkFlat}; px of the plate region that the annotations CHANGE when painted above it: ${diff} of ${n} (${((diff / n) * 100).toFixed(1)}%)`);
console.log(diff > Math.max(20, n * 0.02) ? "RESULT: DEFECT REPRODUCED — the editable PDF's site annotations paint over the table that the page picture printed" : "RESULT: nothing paints over the table here");
process.exit(0);
