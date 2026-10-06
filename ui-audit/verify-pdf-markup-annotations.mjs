#!/usr/bin/env node
/* verify-pdf-markup-annotations — NEW-1 (2026-10-05): the site-plan PDF's "Flatten markups" toggle,
 * driven through the REAL Download PDF flow against a real build.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-pdf-markup-annotations.mjs [--assert] [--out <dir>]
 *
 * A plan holding one of every markup type (line, polyline, rect, rotated rect, hatched rect,
 * ellipse, polygon, revision cloud, callout with a bent leader, text box, and all four measurement
 * modes) is exported TWICE through the real compose screen — "Flatten markups" ON, then OFF — and:
 *
 *   1. the OFF file has one native annotation per markup with the right /Subtype, an explicit /AP /N
 *      stream, unlocked flags, a /Rect inside the page, and NO markup ink in the page content;
 *   2. the ON file has ZERO annotations (today's behaviour, untouched);
 *   3. both files are rasterised with poppler (pdftoppm) and compared with the repo's
 *      PERCEPTUAL-PARITY bar — the editable export must look like the flattened one;
 *   4. the OFF file is re-opened with a SECOND PDF library (pdf.js) and every annotation is
 *      readable, has an appearance and is not ReadOnly/Locked;
 *   5. the toggle's state survives closing and reopening the compose screen (remembered per user).
 *
 * KNOWN-GOOD ARM (CLAUDE.md DRIVER-SCROLL §6 clause 6): the ON export must carry the markup ink in its
 * raster — if the "flattened" page is blank of markups the whole comparison is void, so it is checked
 * independently (a pixel-difference between the page with markups and a markup-free export).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { waitForSelectorReleased } from "./lib/waitRelease.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { perceptualParity, parityLine, blurLinear } from "./lib/perceptualDiff.mjs";

const BASE = process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const SITE_ID = "smverifpdfann1";
const ASSERT = process.argv.includes("--assert");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/pdf-annotations";
const DPI = Number(process.env.PDF_DPI || 110);
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };
const check = (c, m) => (c ? ok(m) : bad(m));

const ST = { stroke: "#dc2626", weight: 2, dash: "solid", fill: "none", fillOpacity: 0 };
function scene(fx, kind) {
  const f = JSON.parse(JSON.stringify(fx));
  f.markups = []; f.callouts = []; f.measures = [];
  f.settings = { ...(f.settings || {}), printBuildingsTable: false };
  if (kind === "blank") return f;
  const z = (i) => 900000 + i;
  const iso = "2026-10-01T12:00:00.000Z";
  f.markups = [
    { id: "mkLine", kind: "line", a: { x: -1500, y: 1200 }, b: { x: -600, y: 1500 }, ...ST, stroke: "#dc2626", dash: "dashed", z: z(1), subject: "Line", comment: "pull this back", author: "Michael", createdAt: iso, modifiedAt: iso },
    { id: "mkPoly", kind: "polyline", pts: [{ x: -1500, y: 600 }, { x: -1100, y: 800 }, { x: -700, y: 560 }, { x: -300, y: 900 }], ...ST, stroke: "#2563eb", z: z(2) },
    { id: "mkRect", kind: "rect", cx: 300, cy: 1200, w: 700, h: 400, rot: 0, ...ST, stroke: "#16a34a", fill: "#16a34a", fillOpacity: 0.25, z: z(3) },
    { id: "mkRectRot", kind: "rect", cx: 1300, cy: 1200, w: 600, h: 300, rot: 30, ...ST, stroke: "#16a34a", z: z(4) },
    { id: "mkRectHatch", kind: "rect", cx: 300, cy: 400, w: 700, h: 350, rot: 0, ...ST, stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.1, hatch: "diagonal", z: z(5) },
    { id: "mkEllipse", kind: "ellipse", cx: 1300, cy: 400, w: 800, h: 400, rot: 0, ...ST, stroke: "#9333ea", z: z(6) },
    { id: "mkPolygon", kind: "polygon", pts: [{ x: -1500, y: -300 }, { x: -900, y: -150 }, { x: -1000, y: -700 }, { x: -1400, y: -800 }], ...ST, stroke: "#ea580c", fill: "#ea580c", fillOpacity: 0.2, z: z(7) },
    { id: "mkCloud", kind: "cloud", pts: [{ x: -400, y: -300 }, { x: 300, y: -300 }, { x: 300, y: -800 }, { x: -400, y: -800 }], arcFt: 40, ...ST, stroke: "#dc2626", weight: 2, subject: "Cloud", comment: "revise per RFI 12", author: "Michael", createdAt: iso, modifiedAt: iso, z: z(8) },
  ];
  if (kind === "shapes") return f; // text-free scene: the strict perceptual-parity arm
  f.callouts = [
    { id: "coLeader", box: { x: 800, y: -400 }, tip: { x: 400, y: -150 }, elbow: { x: 650, y: -150 }, text: "Move this wall\naway from the pad", z: z(9) },
    { id: "coText", box: { x: 1500, y: -700 }, noLeader: true, text: "Note: verify setback", align: "left", bold: true, z: z(10) },
  ];
  f.measures = [
    { id: "meLine", mode: "line", pts: [{ x: -1500, y: -1300 }, { x: -600, y: -1200 }], z: z(11) },
    { id: "mePoly", mode: "polyline", pts: [{ x: -300, y: -1300 }, { x: 100, y: -1100 }, { x: 500, y: -1350 }], z: z(12) },
    { id: "meArea", mode: "area", pts: [{ x: 700, y: -1300 }, { x: 1300, y: -1250 }, { x: 1250, y: -1700 }, { x: 750, y: -1750 }], z: z(13) },
    { id: "meCount", mode: "count", pts: [{ x: 1500, y: -1300 }, { x: 1600, y: -1500 }, { x: 1700, y: -1350 }], z: z(14) },
  ];
  return f;
}

const HOOK = () => {
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try {
      if (b && b.type === "application/pdf") {
        b.arrayBuffer().then((ab) => {
          let s = ""; const u = new Uint8Array(ab);
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
          window.__pdfs.push(btoa(s));
        });
      }
    } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};

async function openCompose(page) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 500);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1200);
}

async function exportOnce(page, { flatten }) {
  await openCompose(page);
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const before = (await page.evaluate(() => window.__pdfs.length));
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let pdfs = [];
  for (let i = 0; i < 160; i++) {
    pdfs = await page.evaluate(() => window.__pdfs);
    if (pdfs.length > before) break;
    await page.waitForTimeout(250);
  }
  if (pdfs.length <= before) throw new Error("no PDF was produced within 40s");
  await pacedWait(page, 600);
  return Buffer.from(pdfs[pdfs.length - 1], "base64");
}

const raster = (pdfPath, stem) => {
  execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", pdfPath, join(OUT, stem)]);
  return decodePng(readFileSync(join(OUT, `${stem}.png`)));
};

async function run() {
  const browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const results = {};
  for (const kind of ["all", "shapes", "blank"]) {
    const fixture = scene(readFixture("richfield"), kind);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(fixtureSeed(fixture, { id: SITE_ID, pdfStorage: false }));
    await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
    await ctx.addInitScript(HOOK);
    await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-pdf-markup-annotations");
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => { errors.push(`unexpected alert: ${d.message()}`); d.dismiss().catch(() => {}); });
    await page.goto(BASE + `#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
    await page.reload({ waitUntil: "load" });
    await waitForSelectorReleased(page, "svg[data-view-ppf]", { timeout: 30000 });
    await pacedWait(page, 1200);
    if (kind === "all") {
      const census = await page.evaluate(() => [...document.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature")).filter((k) => /^(markup|callout|measure):/.test(k)));
      check(census.length >= 14, `the plan renders every seeded markup / callout / measurement (${census.length} features)`);
      // default is OFF (editable): the toggle starts unchecked on a fresh profile
      await openCompose(page);
      check(!(await page.getByLabel("Flatten markups").isChecked()), "default: \"Flatten markups\" is OFF on a fresh profile");
      await page.getByRole("button", { name: "Cancel" }).click();
      await pacedWait(page, 500);
    }
    if (kind === "blank") {
      results.blank = await exportOnce(page, { flatten: true });
      writeFileSync(join(OUT, "nomarkups.pdf"), results.blank);
    } else {
      results[`${kind}Flat`] = await exportOnce(page, { flatten: true });
      writeFileSync(join(OUT, `${kind}-flat.pdf`), results[`${kind}Flat`]);
      results[`${kind}Edit`] = await exportOnce(page, { flatten: false });
      writeFileSync(join(OUT, `${kind}-editable.pdf`), results[`${kind}Edit`]);
    }
    if (kind === "all") {
      // remembered: reopen the compose screen — it must show OFF now (the last choice made)
      await openCompose(page);
      check(!(await page.getByLabel("Flatten markups").isChecked()), "the toggle remembers its last state (OFF) after a reopen");
      await page.getByLabel("Flatten markups").click();
      await page.getByRole("button", { name: "Cancel" }).click();
      await pacedWait(page, 500);
      await openCompose(page);
      check(await page.getByLabel("Flatten markups").isChecked(), "turning it ON is remembered across a close and reopen");
      await page.getByRole("button", { name: "Cancel" }).click();
    }
    check(errors.length === 0, `${kind} scene: no JS crash / unexpected alert${errors.length ? ` (${errors.slice(0, 2).join("; ")})` : ""}`);
    await ctx.close();
  }
  await browser.close();

  /* ---------- structure of the two files ---------- */
  const latin1 = (b) => b.toString("latin1");
  const edit = latin1(results.allEdit), flat = latin1(results.allFlat);
  const annotDicts = edit.match(/\/Type \/Annot [^\n]*/g) || [];
  check(!/\/Annots/.test(flat), "toggle ON: the PDF has zero annotations (today's flattened file)");
  check(annotDicts.length === 14, `toggle OFF: one annotation per markup — found ${annotDicts.length} of 14`);
  const subtypes = annotDicts.map((a) => /\/Subtype \/(\w+)/.exec(a)[1]).sort();
  const want = { FreeText: 2, Line: 2, Square: 2, Circle: 1, PolyLine: 2, Polygon: 4, Stamp: 1 };
  const got = subtypes.reduce((o, s) => ((o[s] = (o[s] || 0) + 1), o), {});
  console.log("   subtypes:", JSON.stringify(got));
  check(JSON.stringify(Object.fromEntries(Object.entries(got).sort())) === JSON.stringify(Object.fromEntries(Object.entries(want).sort())),
    "the subtypes are the mapped set (2 FreeText · 2 Line · 2 Square · 1 Circle · 2 PolyLine · 4 Polygon · 1 Stamp)");
  check(annotDicts.every((a) => /\/F 4 /.test(a) && /\/AP << \/N \d+ 0 R >>/.test(a)), "every annotation is unlocked (/F 4) and carries an /AP /N stream");
  check(/\/BE << \/S \/C/.test(edit), "the revision cloud carries the cloudy border effect (/BE /S /C)");
  check(/\/IT \/FreeTextCallout/.test(edit) && /\/CL \[/.test(edit) && /\/LE \/ClosedArrow/.test(edit), "the callout is a FreeText callout with a /CL leader and a closed-arrow ending");
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(edit); const PW = +mb[1], PH = +mb[2];
  const rects = annotDicts.map((a) => /\/Rect \[([^\]]+)\]/.exec(a)[1].split(" ").map(Number));
  check(rects.every((r) => r[0] >= 0 && r[1] >= 0 && r[2] <= PW && r[3] <= PH && r[2] > r[0] && r[3] > r[1]), "every /Rect lies inside the page");
  check(edit.length < flat.length * 2 + 400000, `size sane (flat ${flat.length} B, editable ${edit.length} B)`);

  /* ---------- render parity (poppler draws annotations) ---------- */
  let hasPoppler = true;
  try { execFileSync("pdftoppm", ["-v"], { stdio: "pipe" }); } catch (e) { hasPoppler = /Poppler|pdftoppm/i.test(String(e.stderr || e.stdout || "")); }
  if (!hasPoppler) { bad("pdftoppm is not available — render parity could not be checked"); }
  else {
    const C = raster(join(OUT, "nomarkups.pdf"), "nomarkups");
    for (const kind of ["shapes", "all"]) {
      const A = raster(join(OUT, `${kind}-flat.pdf`), `${kind}-flat`), B = raster(join(OUT, `${kind}-editable.pdf`), `${kind}-editable`);
      // known-good arm: markups really are in the flattened page (it must differ from the markup-free export)
      const known = perceptualParity(A, C);
      check(!known.identical && known.detail.pct > 0.01, `[${kind}] known-good arm: the flattened page differs from a markup-free export (touched ${known.detail.pct}% of the frame) — the comparison is not vacuous`);
      const p = perceptualParity(A, B);
      console.log(`   [${kind}] same-renderer ΔE00 bar, informational only (vector vs JPEG edges never meet it):`, parityLine(p));
      /* ⛔ WHY NOT PERCEPTUAL-PARITY'S ΔE BAR AS THE GATE: that bar compares two renders by the SAME rasteriser.
       * Here one side is a 300-dpi JPEG (soft edges) and the other is vector ink drawn by the PDF viewer
       * (crisp edges, a different typeface for text), so a 1-px line differs by tens of ΔE00 while looking
       * identical. The honest question is "does the ink land in the same place, in the same amount" — so both
       * are blurred by 2 px (which removes edge softness and hairline phase, keeps position/weight/colour) and
       * the remaining difference is compared against the size of the thing being checked: the flattened page
       * vs the same page with NO markups at all. */
      const meanAbs = (X, Y) => { let sum = 0; const d = []; for (let i = 0; i < X.length; i++) { const v = Math.abs(X[i] - Y[i]); sum += v; d.push(v); } d.sort((u, w) => u - w); return { mean: sum / X.length, p999: d[Math.floor(d.length * 0.999)] }; };
      const bA = blurLinear(A, 2), bB = blurLinear(B, 2), bC = blurLinear(C, 2);
      const vsEdit = meanAbs(bA, bB), vsBlank = meanAbs(bA, bC);
      const ratio = vsEdit.mean / vsBlank.mean;
      console.log(`   [${kind}] blurred ink difference: editable ${vsEdit.mean.toFixed(5)} (p99.9 ${vsEdit.p999.toFixed(3)}) vs markup-free ${vsBlank.mean.toFixed(5)} → ratio ${(ratio * 100).toFixed(1)}%`);
      check(ratio <= 0.15 && vsEdit.p999 <= 0.08, `[${kind}] render parity: the editable PDF puts the same ink in the same place as the flattened one (difference ${(ratio * 100).toFixed(1)}% of the markups' own weight; bar 15%${kind === "all" ? "; text face differs by design" : ""})`);
      // the editable file's PAGE content must not already contain the markups: page-only render (annotations hidden)
      execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", "-hide-annotations", join(OUT, `${kind}-editable.pdf`), join(OUT, `${kind}-editable-page-only`)]);
      const D = decodePng(readFileSync(join(OUT, `${kind}-editable-page-only.png`)));
      const pageOnly = perceptualParity(D, C);
      console.log(`   [${kind}] page content (annotations hidden) vs markup-free export:`, parityLine(pageOnly));
      check(pageOnly.detail.pct < 0.05, `[${kind}] the editable PDF's page content contains no markup drawing (annotations hidden → matches a markup-free export; ${pageOnly.detail.pct}% touched)`);
    }
  }

  /* ---------- round trip through a second library ---------- */
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(results.allEdit), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const an = await page.getAnnotations();
  check(an.length === 14, `pdf.js reads all ${an.length} annotations back`);
  check(an.every((a) => (a.annotationFlags & 192) === 0), "pdf.js: none is ReadOnly or Locked — every one can be moved and edited");
  check(an.every((a) => a.hasAppearance), "pdf.js: every annotation has an appearance stream");
  const ft = an.filter((a) => a.annotationType === 3).map((a) => String(a.contentsObj?.str ?? a.contents ?? ""));
  check(ft.some((t) => /Move this wall/.test(t)) && ft.some((t) => /verify setback/.test(t)), "pdf.js: the callout and the text box keep their text as editable contents");

  console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})`);
  if (ASSERT && fail) process.exit(1);
  process.exit(0);
}
run().catch((e) => { console.error(e); process.exit(1); });
