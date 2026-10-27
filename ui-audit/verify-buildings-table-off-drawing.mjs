#!/usr/bin/env node
/* verify-buildings-table-off-drawing — NEW-1 (2026-10-27): the PDF's BUILDINGS / SF table sits OFF the drawing, nothing
 * paints over it, and in the editable PDF it is its own object.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-buildings-table-off-drawing.mjs [--assert] [--out <dir>]                       (local, seeded plans)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-buildings-table-off-drawing.mjs https://planyr.io [--assert]   (signed in, throwaway plan)
 *
 * The owner's report (Goose Creek "Phase II - Base Case"): the table was a corner plate INSIDE the plan frame. In the
 * editable PDF every site element is a PDF annotation, which always paints above the page picture, so Building 3's trailer
 * strip painted over the table's third row ("ng 3") and the table hid part of the site.
 *
 * THIS HARNESS drives the REAL "Download PDF" flow (File ▾ → Continue ➜ → Download PDF, Flatten markups OFF then ON) and reads
 * the file it produced:
 *   · the table is ONE separate /Subtype /Stamp annotation (named, with a /Subj, no /Contents, no /T, no /Popup), lying wholly
 *     in the band between the title block and the plan — disjoint from the plan window and from every other annotation;
 *   · the scale bar and the north arrow are their own Stamps too, written LAST (so nothing paints over them);
 *   · rasterised with poppler (annotations ON), the table's rect holds the table's ink and the same-height strip beside it is
 *     blank paper (the known-good arm: a probe that cannot see a table would read the same);
 *   · Flatten ON: no annotations and the same table is printed into the page, at the same place, with the same ink;
 *   · pdf.js reads the Stamp back with an appearance and the right flags; the Export PNG has the table in a strip UNDER the
 *     frame (its height grew), never on it.
 * And, through the E2E composed-sheet hook, a MATRIX: every paper × orientation, on a 5-building plan, a 1-building plan and
 * the 16-building Goose Creek plan — the table band never meets the plan window, and the toggle off gives the plan box back.
 * ⚠ Bluebeam itself is not run (none in the sandbox) — poppler + pdf.js + the MuPDF move proxy are the proxy.
 */
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { realisticSitePlan } from "./lib/realisticSitePlan.mjs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const urlArg = process.argv.slice(2).find((a) => /^https?:/.test(a));
const LIVE = !!urlArg && !/127\.0\.0\.1|localhost/.test(urlArg);
const BASE = urlArg || process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome";
const ASSERT = process.argv.includes("--assert");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/buildings-table-off-drawing";
const DPI = 100;
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };
const PAPERS = ["letter", "tabloid", "archc", "archd", "ansic", "ansid"];

const ID = "zz-bldtable-" + Math.random().toString(36).slice(2, 8);
const bain = realisticSitePlan(ID);
// ONE building: the first parent plus whatever is bonded to it (its own courts / parking / sidewalks); no other building, no bump-outs of others
const oneRec = (() => {
  const r = JSON.parse(JSON.stringify(bain)); r.id = r.groupId = ID + "1"; r.name = "One building";
  const parents = r.els.filter((e) => e.type === "building" && !e.dogEar);
  const keep = parents[0].id;
  const dead = new Set(parents.slice(1).map((e) => e.id));
  r.els = r.els.filter((e) => !dead.has(e.id) && !dead.has(e.attachedTo) && !(e.type === "building" && e.dogEar && e.attachedTo !== keep));
  r.markups = []; r.callouts = []; r.measures = []; r.sheetOverlays = [];
  return r;
})();

const HOOK = () => {
  window.__pdfs = []; window.__pngs = [];
  const real = URL.createObjectURL.bind(URL);
  const b64 = (ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  URL.createObjectURL = (b) => {
    try {
      if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => window.__pdfs.push(b64(ab)));
      if (b && b.type === "image/png") b.arrayBuffer().then((ab) => window.__pngs.push(b64(ab)));
    } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};

let session = null, browser = null;
async function newPage(initScript = null) {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    session = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
    console.log("served build:", JSON.stringify(session.build));
    await assertMeasurable(session.page, "verify-buildings-table-off-drawing");
    return session.page;
  }
  if (!browser) browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  if (initScript) await ctx.addInitScript(initScript);
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-buildings-table-off-drawing");
  return page;
}
async function openPlan(page, rec, seeded = false) {
  if (LIVE) {
    const err = await page.evaluate(async (site) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county || null, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      await window.pfSupabase.from("sites").delete().eq("id", site.id);
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, rec);
    check(!err, `throwaway plan "${rec.name}" written to the test account${err ? " — " + err : ""}`);
  } else if (!seeded) {
    await page.evaluate((r) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, rec);
  }
  await page.goto(`${BASE}/#/project/${rec.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 90000 });
  await pacedWait(page, 3500);
  await page.evaluate(HOOK);
}
async function exportOnce(page, flatten) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const before = await page.evaluate(() => window.__pdfs.length);
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let pdfs = [];
  for (let i = 0; i < 240; i++) { pdfs = await page.evaluate(() => window.__pdfs); if (pdfs.length > before) break; await page.waitForTimeout(250); }
  if (pdfs.length <= before) throw new Error("no PDF was produced");
  await pacedWait(page, 800);
  return Buffer.from(pdfs[pdfs.length - 1], "base64");
}
const L1 = (b) => b.toString("latin1");
const annotsOf = (pdf) => (L1(pdf).match(/<< \/Type \/Annot [^\n]*/g) || []).map((d) => ({ d, nm: (/\/NM \(([^)]*)\)/.exec(d) || [])[1], sub: (/\/Subtype \/(\w+)/.exec(d) || [])[1], subj: (/\/Subj \(([^)]*)\)/.exec(d) || [])[1], rect: (/\/Rect \[([^\]]+)\]/.exec(d) || [])[1].split(/\s+/).map(Number) }));
const box = (r) => ({ x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] });
const hit = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01;
const raster = (file, stem) => { execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", file, join(OUT, stem)]); return decodePng(readFileSync(join(OUT, `${stem}.png`))); };
// dark-ink pixel count inside a PDF-point rect of a raster (origin top-left in the raster, bottom-left in PDF)
const inkIn = (img, pageHpt, r, thresh = 140) => {
  const k = DPI / 72, x0 = Math.max(0, Math.floor(r.x * k)), x1 = Math.min(img.width, Math.ceil((r.x + r.w) * k));
  const y0 = Math.max(0, Math.floor((pageHpt - r.y - r.h) * k)), y1 = Math.min(img.height, Math.ceil((pageHpt - r.y) * k));
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * img.width + x) * img.channels; const lum = img.channels >= 3 ? (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 : img.data[i]; if (lum < thresh) n++; }
  return { n, area: Math.max(1, (x1 - x0) * (y1 - y0)) };
};

const errors = [];
const matrix = async (page, label) => {
  let cells = 0, bad = [];
  const none = await page.evaluate(async () => { const c = await window.__plannerExportComposed({ buildingsTable: false }); return c && { plan: c.layout.plan, b: c.layout.buildings, page: c.layout.page, n: c.annotRects.filter((a) => /buildings-table/.test(a.nm)).length }; });
  for (const paper of PAPERS) for (const orient of ["landscape", "portrait"]) {
    const c = await page.evaluate(async (o) => { const c = await window.__plannerExportComposed(o); return c && { layout: c.layout, rects: c.annotRects, svg: c.sheetSvg.length, hasTable: /data-sheet-table/.test(c.sheetSvg) }; }, { paper, orient });
    cells++;
    if (!c) { bad.push(`${paper}/${orient}: no sheet`); continue; }
    const { layout: L, rects } = c, pu = (L.page.wIn * 72) / L.page.w, H = L.page.hIn * 72;
    const plan = { x: L.plan.x * pu, y: H - (L.plan.y + L.plan.h) * pu, w: L.plan.w * pu, h: L.plan.h * pu };
    const tbl = rects.filter((a) => a.nm === "planyr-sheet-furniture-buildings-table");
    if (tbl.length !== 1) { bad.push(`${paper}/${orient}: ${tbl.length} table annotations`); continue; }
    const t = box(tbl[0].rect);
    if (!L.buildings) bad.push(`${paper}/${orient}: no band reserved`);
    if (hit(t, plan)) bad.push(`${paper}/${orient}: table meets the plan window`);
    if (t.x < 0 || t.y < 0 || t.x + t.w > L.page.wIn * 72 || t.y + t.h > H) bad.push(`${paper}/${orient}: table off the page`);
    for (const a of rects.filter((r) => r.family !== "sheet-furniture")) if (hit(t, box(a.rect))) bad.push(`${paper}/${orient}: table meets ${a.nm}`);
    if (c.hasTable) bad.push(`${paper}/${orient}: the editable sheet's PAGE picture still carries the table (it must be only the annotation)`);
    const lastNonFurn = Math.max(...rects.map((a, i) => (a.family === "sheet-furniture" ? -1 : i)));
    const firstFurn = rects.findIndex((a) => a.family === "sheet-furniture");
    if (firstFurn >= 0 && firstFurn < lastNonFurn) bad.push(`${paper}/${orient}: a furniture Stamp is not after every site annotation`);
    if (!rects.some((a) => a.nm === "planyr-sheet-furniture-scale-bar") || !rects.some((a) => a.nm === "planyr-sheet-furniture-north-arrow")) bad.push(`${paper}/${orient}: scale bar / north arrow not their own annotations`);
  }
  check(bad.length === 0, `${label}: ${cells} sheets (6 papers × 2 orientations) — table is ONE Stamp in its own band: clear of the plan window, the page edge and every site annotation; scale bar + north arrow written last${bad.length ? " — " + bad.slice(0, 4).join("; ") : ""}`);
  check(!!none && none.b === null && none.n === 0, `${label}: Buildings table toggle OFF → no band, no annotation`);
  const on = await page.evaluate(async () => { const c = await window.__plannerExportComposed({}); return c && c.layout; });
  check(!!on && !!none && on.buildings && on.plan.h < none.plan.h, `${label}: the band takes its height from the plan box (${on && none ? `${on.plan.h} < ${none.plan.h} c-in` : "n/a"}) — so the frame/scale math must (and does) use the same band`);
  const flatSvg = await page.evaluate(async () => { const c = await window.__plannerExportComposed({ annotate: false }); return c && { has: /data-sheet-table="buildings"/.test(c.sheetSvg), b3: /Building \d/.test(c.sheetSvg), n: c.annotRects.length }; });
  check(!!flatSvg && flatSvg.has && flatSvg.n === 0, `${label}: flattened/preview sheet draws the table in the page and writes no annotations`);
};

let pdfEdit = null, pdfFlat = null, png = null, frameVB = null, comp = null, hosts = 0;
try {
  // ---- 5-building plan: the full UI flow
  let page = await newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("alert: " + d.message()); d.dismiss().catch(() => {}); });
  await openPlan(page, bain);
  hosts = bain.els.filter((e) => e.type === "building" && !e.dogEar && !e.attachedTo).length;
  comp = await page.evaluate(async () => { const c = await window.__plannerExportComposed(); return c && { layout: c.layout, rects: c.annotRects, svgHasTable: /data-sheet-table/.test(c.sheetSvg) }; });
  check(!!comp && comp.layout.buildings && comp.rects.some((a) => a.nm === "planyr-sheet-furniture-buildings-table"), `composed editable sheet carries a buildings band (${hosts} building plan)`);
  pdfEdit = await exportOnce(page, false); writeFileSync(join(OUT, "editable.pdf"), pdfEdit);
  pdfFlat = await exportOnce(page, true); writeFileSync(join(OUT, "flat.pdf"), pdfFlat);
  frameVB = await page.evaluate(async () => { const s = await window.__plannerExportSvg(); const m = /viewBox="([^"]+)"/.exec(s || ""); return m ? m[1].split(/\s+/).map(Number) : null; });
  await page.getByRole("button", { name: "Cancel" }).first().click().catch(() => {});
  await pacedWait(page, 400);
  await page.getByRole("button", { name: "File ▾" }).click().catch(() => {});
  const pngBtn = page.getByRole("button", { name: "Export PNG" });
  if (await pngBtn.count()) {
    await pngBtn.first().click();
    for (let i = 0; i < 160; i++) { const n = await page.evaluate(() => window.__pngs.length); if (n) break; await page.waitForTimeout(250); }
    const p = await page.evaluate(() => window.__pngs[window.__pngs.length - 1] || null);
    png = p ? Buffer.from(p, "base64") : null;
    if (png) writeFileSync(join(OUT, "export.png"), png);
  }
  await matrix(page, `${hosts} buildings`);
  if (!LIVE) await browser.close().then(() => { browser = null; }); // signed in, the session stays open: the finally block below deletes the throwaway plan with it, THEN closes it

  // ---- 1 building, and the 16-building Goose Creek plan (local only — big fixture)
  if (!LIVE) {
    page = await newPage(); page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluate(() => {}); await openPlan(page, oneRec);
    await matrix(page, "1 building");
    await browser.close(); browser = null;
    const gooseFx = readFixture("goose2"), GID = "zz-bldtable-goose";
    page = await newPage(fixtureSeed(gooseFx, { id: GID, pdfStorage: false })); page.on("pageerror", (e) => errors.push(e.message));
    await openPlan(page, { id: GID, name: "goose" }, true);
    await matrix(page, "16-building Goose Creek");
    await browser.close(); browser = null;
  }
} finally {
  if (LIVE && session) {
    const gone = await session.page?.evaluate?.(async (id) => {
      try { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); const q = await window.pfSupabase.from("sites").select("id").eq("id", id); const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); return !(q.data && q.data.length); } catch (e) { return String(e); }
    }, bain.id).catch((e) => String(e));
    check(gone === true, "throwaway plan deleted and verified gone " + JSON.stringify(gone));
    await session.close().catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
}

// ---- the file itself
if (pdfEdit) {
  const annots = annotsOf(pdfEdit);
  const tbl = annots.filter((a) => a.nm === "planyr-sheet-furniture-buildings-table");
  const pageM = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(L1(pdfEdit));
  const W = Number(pageM[1]), H = Number(pageM[2]);
  check(tbl.length === 1 && tbl[0].sub === "Stamp" && tbl[0].subj === "Buildings table", `the editable PDF has exactly ONE Buildings-table annotation: /Subtype /Stamp, /Subj (Buildings table) (${tbl.length})`);
  check(tbl.every((a) => !/\/Contents /.test(a.d) && !/\/T /.test(a.d)) && !/\/Subtype \/Popup/.test(L1(pdfEdit)), "…raises no hover note box: no /Contents, no /T, no /Popup anywhere");
  check(/\/F 4 /.test(tbl[0].d), "…and carries /F 4 (Print) only — not Locked or ReadOnly, so the recipient can move or delete it");
  const others = annots.filter((a) => a.nm !== tbl[0].nm);
  const planW = comp.layout.plan, pu = (comp.layout.page.wIn * 72) / comp.layout.page.w;
  const plan = { x: planW.x * pu, y: H - (planW.y + planW.h) * pu, w: planW.w * pu, h: planW.h * pu };
  const t = box(tbl[0].rect);
  check(!hit(t, plan) && t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H, `the table's rect [${tbl[0].rect.map((v) => v.toFixed(0)).join(" ")}] is on the page and shares no point with the plan window`);
  const siteAn = others.filter((a) => !/sheet-furniture/.test(a.nm));
  check(siteAn.length >= hosts && siteAn.every((a) => !hit(t, box(a.rect))), `…nor with any of the ${siteAn.length} other annotations (buildings, courts, parking, roads, pond, markups, measurements)`);
  const furnIdx = annots.map((a, i) => (/sheet-furniture/.test(a.nm) ? i : -1)).filter((i) => i >= 0), lastSite = Math.max(...annots.map((a, i) => (/sheet-furniture/.test(a.nm) ? -1 : i)));
  check(furnIdx.length === 3 && furnIdx.every((i) => i > lastSite), `the table, scale bar and north arrow are the LAST three annotations — nothing the site draws paints over them (${furnIdx.length} furniture Stamps)`);
  check(annots.filter((a) => a.nm === "planyr-sheet-furniture-scale-bar").length === 1 && annots.filter((a) => a.nm === "planyr-sheet-furniture-north-arrow").length === 1, "scale bar and north arrow are each ONE removable annotation");

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfEdit), verbosity: 0 }).promise;
  const an = await (await doc.getPage(1)).getAnnotations();
  const furnAn = annots.filter((a) => /sheet-furniture/.test(a.nm));
  const st = furnAn.map((f) => an.find((x) => x.annotationType === 13 && x.rect && f.rect.every((v, i) => Math.abs(v - x.rect[i]) < 0.01)));
  check(st.length === 3 && st.every((x) => x && (x.annotationFlags & (2 | 32 | 64 | 128)) === 0 && x.hasAppearance), `pdf.js reads the 3 furniture Stamps back, unlocked, each with an appearance`);

  // pixels: the table's ink is where the annotation says it is; the band beside it is blank (known-good arm)
  writeFileSync(join(OUT, "editable.pdf"), pdfEdit); writeFileSync(join(OUT, "flat.pdf"), pdfFlat);
  const E = raster(join(OUT, "editable.pdf"), "editable"), F = raster(join(OUT, "flat.pdf"), "flat");
  const inTable = inkIn(E, H, t), beside = inkIn(E, H, { x: t.x + t.w + 8, y: t.y, w: 40, h: t.h });
  check(inTable.n > 120 && beside.n === 0, `editable PDF, rendered: table rect holds its ink (${inTable.n} dark px) and the paper beside it is blank (${beside.n}) — the probe can tell the difference`);
  const flatTable = inkIn(F, H, t);
  check(!/\/Annots/.test(L1(pdfFlat)) && Math.abs(flatTable.n - inTable.n) <= Math.max(40, inTable.n * 0.2), `Flatten ON: zero annotations and the SAME table is printed at the same place (${flatTable.n} vs ${inTable.n} dark px)`);
  console.log(`   rendered pages: ${join(OUT, "editable.png")}  ${join(OUT, "flat.png")}`);

  const r = spawnSync("python3", ["-I", join(here, "tools", "pdf_move_proxy.py"), join(OUT, "editable.pdf")], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status === 0 && r.stdout.trim()) {
    const rows = JSON.parse(r.stdout).rows, furn = rows.filter((x) => /Buildings table|Scale bar|North arrow/.test(x.subj || ""));
    check(furn.length === 3 && furn.every((x) => x.editable && x.moved && x.ink_at_new > 0 && x.left_px <= Math.max(4, x.old_px * 0.002)), `MuPDF move proxy: the 3 furniture Stamps each move when dragged, paint at the new place and leave nothing behind`);
  } else console.log("   ⚠ MuPDF move proxy did not run (pip install pymupdf numpy) — move check skipped");
}
if (png && frameVB) {
  const dim = decodePng(png), frameAspect = frameVB[3] / frameVB[2];
  check(dim.height / dim.width > frameAspect * 1.02, `Export PNG: the table is in a strip UNDER the frame (image is taller than the frame alone: ${(dim.height / dim.width).toFixed(3)} vs ${frameAspect.toFixed(3)})`);
} else console.log("   ⚠ Export PNG was not captured — PNG check skipped");
const nonGis = errors.filter((e) => !/removeLayer/.test(e));
check(nonGis.length === 0, `no JS crash or alert${nonGis.length ? " (" + nonGis.slice(0, 2).join("; ") + ")" : ""}`);
console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})\n   ⚠ Bluebeam was not run — poppler, pdf.js and MuPDF are the proxy.`);
process.exit(ASSERT && fail ? 1 : 0);
