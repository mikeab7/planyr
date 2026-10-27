#!/usr/bin/env node
/* verify-sheet-furniture-on-top — NEW-1 (2026-10-27): the PDF's BUILDINGS table, scale bar and north arrow print ABOVE every drawn
 * site element, and in the editable PDF each is its own object.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-sheet-furniture-on-top.mjs [--assert] [--out <dir>]                       (local, seeded plans)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-sheet-furniture-on-top.mjs https://planyr.io [--assert]   (signed in, throwaway plan)
 *
 * Owner, on his real export (Goose Creek "Phase II - Base Case"): "the issue is that it's printing under." In the editable PDF every
 * site element is a PDF annotation, which always paints above the page picture; the table was page picture, so the pond / Building
 * 3's trailer strip painted over its rows ("ng 3"). The table stays where it was (top-right of the frame, as on screen) — the fix is
 * the STACKING. (An earlier cut moved it to a band off the drawing; that premise was retracted.)
 *
 * Drives the REAL "Download PDF" flow (File ▾ → Continue ➜ → Download PDF, Flatten markups OFF then ON) on the realistic Bain plan
 * and on the 3-building Goose Creek Phase II plan (local), and reads the file it produced:
 *   · table, scale bar and north arrow are each ONE /Subtype /Stamp (named, /Subj, no /Contents, no /T, no /Popup, /F 4), and they
 *     are the LAST annotations of the file — nothing the site draws is above them;
 *   · POSITIVE/NEGATIVE PIXEL PROOF (MuPDF): render the file with every annotation, and again with ONLY the three Stamps; every dark
 *     pixel of the table's own ink in the second must still be dark in the first (nothing covers it). On a pre-fix build the pond's
 *     annotation covered 87.7% of the table (ui-audit/probe-buildings-table-on-main.mjs);
 *   · Flatten ON: no annotations and the table is in the page; pdf.js reads the Stamps back unlocked with an appearance; MuPDF drags
 *     each Stamp and it leaves nothing behind; the PNG still carries the table.
 * Plus a matrix through the E2E composed-sheet hook: every paper × orientation, the table Stamp is last in the stack and absent from the
 * page picture; toggle off → no table anywhere.
 * ⚠ Bluebeam itself is not run (none in the sandbox) — poppler, pdf.js and MuPDF are the proxy.
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
    await assertMeasurable(session.page, "verify-sheet-furniture-on-top");
    return session.page;
  }
  if (!browser) browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  if (initScript) await ctx.addInitScript(initScript);
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-sheet-furniture-on-top");
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
const KINDS = ["buildings-table", "scale-bar", "north-arrow"];
// the compose screen's Content toggles — a saved plan can have them OFF (the Goose fixture does); the owner's export had them ON
async function ensureToggles(page) {
  for (const label of ["Buildings table", "Stats band"]) {
    const t = page.getByLabel(label);
    if ((await t.count()) && !(await t.first().isChecked())) { await t.first().click(); await pacedWait(page, 1500); }
  }
}
async function exportUi(page, flatten) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
  await ensureToggles(page);
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

// ---- matrix (E2E composed-sheet hook): the table is a Stamp last in the stack and NOT in the page picture, at every paper × orientation
const matrix = async (page, label) => {
  let cells = 0; const bad = [];
  for (const paper of PAPERS) for (const orient of ["landscape", "portrait"]) {
    const c = await page.evaluate(async (o) => { const c = await window.__plannerExportComposed(o); return c && { rects: c.annotRects, svg: c.sheetSvg }; }, { paper, orient });
    cells++;
    if (!c) { bad.push(`${paper}/${orient}: no sheet`); continue; }
    const furn = c.rects.map((a, i) => ({ ...a, i })).filter((a) => a.family === "sheet-furniture");
    const lastSite = Math.max(...c.rects.map((a, i) => (a.family === "sheet-furniture" ? -1 : i)));
    for (const k of KINDS) if (furn.filter((a) => a.nm === `planyr-sheet-furniture-${k}`).length !== 1) bad.push(`${paper}/${orient}: ${k} is not exactly one annotation`);
    if (furn.some((a) => a.i < lastSite)) bad.push(`${paper}/${orient}: a furniture Stamp is under a site annotation`);
    if (/>BUILDINGS</.test(c.svg)) bad.push(`${paper}/${orient}: the page picture still prints the table (it would sit UNDER the site)`);
  }
  check(bad.length === 0, `${label}: ${cells} sheets (6 papers × 2 orientations) — the table, scale bar and north arrow are each one Stamp, after every site annotation, and out of the page picture${bad.length ? " — " + bad.slice(0, 4).join("; ") : ""}`);
  const off = await page.evaluate(async () => { const c = await window.__plannerExportComposed({ buildingsTable: false }); return c && { n: c.annotRects.filter((a) => /buildings-table/.test(a.nm)).length, page: /BUILDINGS/.test(c.sheetSvg) }; });
  check(!!off && off.n === 0 && !off.page, `${label}: Buildings table toggle OFF → no table anywhere`);
  const flat = await page.evaluate(async () => { const c = await window.__plannerExportComposed({ annotate: false }); return c && { has: />BUILDINGS</.test(c.sheetSvg), n: c.annotRects.length }; });
  check(!!flat && flat.has && flat.n === 0, `${label}: flattened / preview sheet prints the table in the page and writes no annotations`);
};

// ---- one export's file, read back
function pdfChecks(label, pdfEdit, pdfFlat, dir) {
  const annots = annotsOf(pdfEdit), W = Number(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(L1(pdfEdit))[1]), H = Number(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(L1(pdfEdit))[2]);
  const furn = KINDS.map((k) => annots.filter((a) => a.nm === `planyr-sheet-furniture-${k}`));
  check(furn.every((f) => f.length === 1 && f[0].sub === "Stamp") && furn[0][0].subj === "Buildings table", `${label}: the table, scale bar and north arrow are each ONE /Subtype /Stamp ( /Subj ${furn.map((f) => f[0] && f[0].subj).join(" · ")} )`);
  const fl = furn.map((f) => f[0]);
  check(fl.every((a) => !/\/Contents /.test(a.d) && !/\/T /.test(a.d) && /\/F 4 /.test(a.d)) && !/\/Subtype \/Popup/.test(L1(pdfEdit)), `${label}: no hover note box (no /Contents, /T, /Popup) and /F 4 only — not Locked or ReadOnly, so each can be moved or deleted`);
  const idx = annots.map((a, i) => (/sheet-furniture/.test(a.nm || "") ? i : -1)).filter((i) => i >= 0);
  const lastSite = Math.max(...annots.map((a, i) => (/sheet-furniture/.test(a.nm || "") ? -1 : i)));
  check(annots.length - 3 > 20 && idx.length === 3 && Math.min(...idx) > lastSite, `${label}: the three Stamps are the LAST three of ${annots.length} annotations — every site annotation (${annots.length - 3}) is below them`);
  const t = box(fl[0].rect);
  check(t.x >= 0 && t.y >= 0 && t.x + t.w <= W && t.y + t.h <= H, `${label}: the table sits on the page at [${fl[0].rect.map((v) => v.toFixed(0)).join(" ")}] (placed with the other plates, as on screen)`);
  writeFileSync(join(dir, "editable.pdf"), pdfEdit); writeFileSync(join(dir, "flat.pdf"), pdfFlat);
  check(!/\/Annots/.test(L1(pdfFlat)), `${label}: Flatten ON → zero annotations`);
  // the pixel proof: render with every annotation, and with ONLY the three Stamps; the table's own dark ink must survive the site above-below stack
  const r = spawnSync("python3", ["-I", join(here, "tools", "pdf_furniture_cover.py"), join(dir, "editable.pdf"), join(dir, "only"), "--dpi", String(DPI)], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0 || !r.stdout.trim()) { console.log("   ⚠ MuPDF pixel proof did not run (pip install pymupdf numpy)\n" + (r.stderr || "").slice(0, 300)); fail++; return; }
  const m = JSON.parse(r.stdout);
  check(m.table_ink > 200 && m.table_survives >= 0.97 && m.plates_survive >= 0.97, `${label}: pixel proof — of the table's ${m.table_ink} dark ink pixels (rendered alone) ${(m.table_survives * 100).toFixed(1)}% look the same with every site annotation drawn (all three plates: ${(m.plates_survive * 100).toFixed(1)}%) — nothing paints over them (pre-fix the pond covered 87.7% of the table)`);
  // known-good arm: the same probe on the PRE-FIX stacking (plates moved below the site) — where the site overlaps a plate it must see the cover
  if (m.overlap) check(m.under_survives < 0.9, `${label}: known-good arm — with the plates moved BELOW the site the table's ink survival falls to ${(m.under_survives * 100).toFixed(1)}% (the probe sees a cover; the site does overlap a plate on this plan)`);
  else console.log(`   · known-good arm vacuous on ${label}: no site annotation overlaps a plate here, so the wrong order covers nothing — the /Annots-order check above carries it`);
  return m;
}

let pngInfo = null;
const scenario = async (label, page, rec, seeded) => {
  const dir = join(OUT, label.replace(/\W+/g, "_")); mkdirSync(dir, { recursive: true });
  await openPlan(page, rec, seeded);
  const edit = await exportUi(page, false), flat = await exportUi(page, true);
  pdfChecks(label, edit, flat, dir);
  await matrix(page, label);
  if (label.startsWith("5-building")) {
    await page.getByRole("button", { name: "Cancel" }).first().click().catch(() => {});
    await pacedWait(page, 400);
    await page.getByRole("button", { name: "File ▾" }).click().catch(() => {});
    const pngBtn = page.getByRole("button", { name: "Export PNG" });
    if (await pngBtn.count()) {
      await pngBtn.first().click();
      for (let i = 0; i < 160; i++) { const n = await page.evaluate(() => window.__pngs.length); if (n) break; await page.waitForTimeout(250); }
      const p = await page.evaluate(() => window.__pngs[window.__pngs.length - 1] || null);
      if (p) { writeFileSync(join(dir, "export.png"), Buffer.from(p, "base64")); pngInfo = decodePng(Buffer.from(p, "base64")); }
    }
  }
};

let page = null;
try {
  page = await newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { errors.push("alert: " + d.message()); d.dismiss().catch(() => {}); });
  await scenario("5-building Bain plan", page, bain);
  if (!LIVE) {
    await browser.close(); browser = null;
    const gooseFx = readFixture("goose2"), GID = "zz-furn-goose";
    page = await newPage(fixtureSeed(gooseFx, { id: GID, pdfStorage: false })); page.on("pageerror", (e) => errors.push(e.message));
    await scenario("3-building Goose Creek Phase II", page, { id: GID, name: "goose" }, true);
  }
} finally {
  if (LIVE && session) {
    const gone = await session.page.evaluate(async (id) => {
      try { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); const q = await window.pfSupabase.from("sites").select("id").eq("id", id); const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); return !(q.data && q.data.length); } catch (e) { return String(e); }
    }, bain.id).catch((e) => String(e));
    check(gone === true, "throwaway plan deleted and verified gone " + JSON.stringify(gone));
    await session.close().catch(() => {});
  }
  if (browser) await browser.close().catch(() => {});
}
check(!!pngInfo && pngInfo.width > 0, "Export PNG downloads (the table rides the PNG's furniture, drawn last, above the plan)");
const nonGis = errors.filter((e) => !/removeLayer/.test(e));
check(nonGis.length === 0, `no JS crash or alert${nonGis.length ? " (" + nonGis.slice(0, 2).join("; ") + ")" : ""}`);
console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})\n   ⚠ Bluebeam was not run — poppler, pdf.js and MuPDF are the proxy.`);
process.exit(ASSERT && fail ? 1 : 0);
