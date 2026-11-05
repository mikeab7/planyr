#!/usr/bin/env node
/* verify-pdf-hover-popup — B2433000/B2433001 (NEW-1, 2026-10-22): hovering an exported annotation in Chrome's built-in PDF
 * viewer must not pop up a yellow note box.
 *
 * WHY THIS EXISTS. The editable PDF ("Flatten markups" OFF) wrote /T (Planyr) and /Contents (the element's name) on every
 * annotation. PDFium (Chrome's and Edge's viewer) builds its OWN popup for any Text/Line/Square/Circle/Polygon/PolyLine/
 * Stamp/… annotation whose /Contents is non-empty — a fixed-size note box carrying /T as its title — and opens it on hover.
 * PDFium ignores any /Popup annotation a file carries (so adding one would not help); the lever is /Contents.
 *
 *   xvfb-run -a node ui-audit/verify-pdf-hover-popup.mjs [--assert] [--out <dir>]
 *
 * It builds two PDFs through the REAL writer (imagePdf.jpegToPdf + pdfAnnotations.buildAnnotations):
 *   · KNOWN-GOOD ARM ("with-contents"): the same fixture with /Contents forced back on every annotation. The viewer MUST
 *     show a popup on it — if it does not, the instrument cannot see the thing and the run is VOID (it prints no score).
 *   · the shipped output: NO annotation may raise a popup unless the user typed a comment into it.
 * Then it opens each in headed Chrome (the viewer is not in headless mode), hovers the middle of every annotation and counts
 * the popup-yellow pixels that appear compared with the same page with the cursor parked in a corner.
 * Chrome-for-Testing's viewer is PDFium, the same engine as Chrome and Edge; Acrobat is a different engine and is NOT run here.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import { M0, frame, descriptors, PAGE } from "../test/fixtures/pdfAnnotationsFixture.js";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { svgToFake } from "../test/fixtures/svgToFake.js";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
void here;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome";
const ASSERT = process.argv.includes("--assert");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/pdf-hover-popup";
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };

const PAGE0 = PAGE;
const VIEW = { width: 1280, height: 1000 };
const isYellow = (r, g, b) => r > 215 && g > 200 && b < 200 && r - b > 50; // the viewer's note colour; the white sheet and grey surround are neither

async function whiteJpeg(browser) {
  const p = await browser.newPage({ viewport: { width: 1056, height: 816 } });
  await p.setContent("<body style='margin:0;background:#fff'></body>");
  const j = await p.screenshot({ type: "jpeg", quality: 90 });
  await p.close();
  return new Uint8Array(j);
}
const pdfFor = (jpeg, annots, page = PAGE, viewport = null) => jpegToPdf({ jpeg, pixelW: 1056, pixelH: 816, widthIn: page.w / 72, heightIn: page.h / 72, title: "hover", annotations: annots, viewport });

/* the owner's Bain plan as the real export clone (the same fixture the unit tests replay), moved onto an 800 × 800 pt page */
const REAL_PAGE = { w: 800, h: 800 };
function realisticScene() {
  const FX = JSON.parse(readFileSync(new URL("../test/fixtures/realisticSiteClone.json", import.meta.url), "utf8"));
  const [o, ux, uy] = FX.f2p;
  const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
  const m0 = [1, 0, 0, -1, -250, 800], fr = [-1e6, -1e6, 1e6, 1e6];
  const r = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
  const unitsPerFt = Math.hypot(ux.x - o.x, ux.y - o.y);
  return buildAnnotations(r.descriptors, { M0: m0, frame: fr, patterns: r.patterns, ftPerPt: 1 / unitsPerFt });
}

/** The sheet's rectangle on screen = the bright (white) region; the viewer's surround is dark grey. */
function sheetBox(png) {
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const i = (y * png.width + x) * 4;
    if (png.data[i] > 245 && png.data[i + 1] > 245 && png.data[i + 2] > 245) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1 };
}
const yellowCount = (png) => { let n = 0; for (let i = 0; i < png.data.length; i += 4) if (isYellow(png.data[i], png.data[i + 1], png.data[i + 2])) n++; return n; };

async function sweep(ctx, file, annots, tag, PAGE = PAGE0) {
  const page = await ctx.newPage();
  await page.setViewportSize(VIEW);
  await page.goto(`file://${file}#toolbar=0&navpanes=0&view=Fit`);
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-pdf-hover-popup");
  await page.mouse.move(2, 2);
  await pacedWait(page, 500);
  const base = decodePng(await page.screenshot());
  const box = sheetBox(base);
  const k = (box.x1 - box.x0 + 1) / PAGE.w;
  const baseline = yellowCount(base);
  const rows = [];
  for (const a of annots) {
    // PDF → screen (origin bottom-left → top-left)
    const cx = (a.rect[0] + a.rect[2]) / 2, cy = (a.rect[1] + a.rect[3]) / 2;
    const sx = box.x0 + cx * k, sy = box.y0 + (PAGE.h - cy) * k;
    await page.mouse.move(2, 2); await pacedWait(page, 150);
    await page.mouse.move(sx, sy); await pacedWait(page, 120);
    await page.mouse.move(sx + 1, sy + 1); await pacedWait(page, 450);
    const shot = await page.screenshot();
    const popup = yellowCount(decodePng(shot)) - baseline;
    rows.push({ id: a.id, subtype: a.subtype, contents: a.contents, popup });
    if (popup > 400) writeFileSync(join(OUT, `${tag}-${a.id}.png`), shot);
  }
  await page.close();
  return { rows, k, box };
}

const browser0 = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const jpeg = await whiteJpeg(browser0);
await browser0.close();

const built = buildAnnotations(descriptors, { M0, frame, ftPerPt: 0.5 });
// the known-good arm: the pre-fix shape — every annotation named, with /Contents (and the old author)
const legacy = built.annots.map((a) => ({ ...a, contents: a.contents || a.subj || "Planyr item", title: "Planyr" }));
const fileLegacy = join(OUT, "with-contents.pdf"), fileShipped = join(OUT, "shipped.pdf");
writeFileSync(fileLegacy, pdfFor(jpeg, legacy));
writeFileSync(fileShipped, pdfFor(jpeg, built.annots));

const real = realisticScene();
const realLegacy = real.annots.map((x) => ({ ...x, contents: x.contents || x.subj, title: "Planyr" }));
writeFileSync(join(OUT, "real-with-contents.pdf"), pdfFor(jpeg, realLegacy, REAL_PAGE));
writeFileSync(join(OUT, "real-shipped.pdf"), pdfFor(jpeg, real.annots, REAL_PAGE, real.viewport));

const ctx = await chromium.launchPersistentContext(join(OUT, "profile"), { executablePath: EXEC, headless: false, viewport: VIEW, args: ["--no-sandbox"], ignoreDefaultArgs: ["--disable-extensions"] });
const scenes = [
  { name: "markup fixture", legacyFile: fileLegacy, shippedFile: fileShipped, legacy: legacy.filter((a) => a.subtype !== "FreeText"), shipped: built.annots, page: PAGE0 },
  { name: "Bain plan (every element type)", legacyFile: join(OUT, "real-with-contents.pdf"), shippedFile: join(OUT, "real-shipped.pdf"), legacy: realLegacy.filter((a) => a.subtype !== "FreeText"), shipped: real.annots, page: REAL_PAGE },
];
try {
  for (const sc of scenes) {
    console.log(`\n=== ${sc.name} ===\nKNOWN-GOOD ARM — /Contents + /T (Planyr) on every annotation (the viewer must pop up):`);
    const known = await sweep(ctx, sc.legacyFile, sc.legacy, "legacy-" + sc.name.slice(0, 4), sc.page);
    const sees = known.rows.filter((r) => r.popup > 400).length;
    console.log(`    ${sees} of ${known.rows.length} annotations raised the popup`);
    if (sees < 3) {
      console.log(`\n  ✗ VOID — the viewer raised a popup on only ${sees} of ${known.rows.length} annotations in the known-good arm, so this instrument cannot see the defect. No score.`);
      await ctx.close();
      process.exit(2);
    }
    check(true, `instrument sees the defect on "${sc.name}": ${sees} of ${known.rows.length} raise the popup when /Contents is present`);
    console.log("SHIPPED OUTPUT:");
    const out = await sweep(ctx, sc.shippedFile, sc.shipped, "shipped-" + sc.name.slice(0, 4), sc.page);
    // a comment the person typed legitimately has /Contents (a FreeText never raises one); everything else must not
    const typed = (r) => !!r.contents && r.subtype !== "FreeText";
    const bad = out.rows.filter((r) => !typed(r) && r.popup > 400);
    const quiet = out.rows.filter((r) => !typed(r));
    for (const r of out.rows.filter((r) => typed(r))) console.log(`    (typed comment) ${r.id} ${r.subtype} → popup px ${r.popup}`);
    check(quiet.length >= 3, `${quiet.length} annotations without a typed comment were hovered (not vacuous)`);
    check(bad.length === 0, `no annotation without a typed comment raises a popup (${quiet.length - bad.length} of ${quiet.length} quiet${bad.length ? `; popups on ${bad.map((r) => r.id + ":" + r.subtype).join(", ")}` : ""})`);
  }
  // a PDF the REAL export wrote (ui-audit/verify-pdf-site-elements.mjs --out <dir> → <dir>/editable.pdf), read back from its bytes
  const pi = process.argv.indexOf("--pdf");
  if (pi > 0) {
    const file = process.argv[pi + 1];
    const txt = readFileSync(file).toString("latin1");
    const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt);
    const page = { w: +mb[1], h: +mb[2] };
    const annots = (txt.match(/<< \/Type \/Annot [^\n]*/g) || []).map((d, i) => ({
      id: (/\/NM \(planyr-[a-z-]+-([^)]*)\)/.exec(d) || [])[1] || `a${i}`, subtype: (/\/Subtype \/(\w+)/.exec(d) || [])[1],
      rect: /\/Rect \[([^\]]+)\]/.exec(d)[1].split(/\s+/).map(Number), contents: /\/Contents /.test(d) ? "x" : "",
    }));
    console.log(`\n=== the real export ${file} (${page.w}×${page.h} pt, ${annots.length} annotations) ===`);
    const out = await sweep(ctx, file, annots, "realexport", page);
    const typed = (r) => !!r.contents && r.subtype !== "FreeText";
    // a point that a typed-comment annotation also covers cannot be attributed to the quiet one under it (that comment pops up there, by design)
    const covered = (r) => { const a = annots.find((x) => x.id === r.id); const cx = (a.rect[0] + a.rect[2]) / 2, cy = (a.rect[1] + a.rect[3]) / 2; return annots.some((t) => t.contents && t.subtype !== "FreeText" && cx >= t.rect[0] && cx <= t.rect[2] && cy >= t.rect[1] && cy <= t.rect[3]); };
    const quiet = out.rows.filter((r) => !typed(r) && !covered(r)), bad = quiet.filter((r) => r.popup > 400);
    check(quiet.length >= 10 && bad.length === 0, `${quiet.length - bad.length} of ${quiet.length} annotations without a typed comment raise no popup${bad.length ? " — popups on " + bad.map((r) => r.id + ":" + r.subtype).join(", ") : ""}`);
  }
} finally {
  await ctx.close();
}
console.log(`\n${pass} passed, ${fail} failed.   PDFs + screenshots: ${OUT}`);
if (ASSERT && fail) process.exit(1);
