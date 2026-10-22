#!/usr/bin/env node
/* verify-pdf-site-elements — NEW-1 / NEW-2 (2026-10-20): on a plan SHAPED LIKE A REAL ONE, every drawn site element comes
 * out of the editable PDF as its own annotation, a recipient can drag each one cleanly, and measurements carry the data a
 * viewer needs to redraw their value after a move.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-pdf-site-elements.mjs [--assert] [--out <dir>]                       (local, seeded plan)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-pdf-site-elements.mjs https://planyr.io [--assert]   (signed in, throwaway plans)
 *
 * The plan is ui-audit/lib/realisticSitePlan.mjs (the owner's Bain plan + a reference promoted above the plan over one
 * car-parking field, a GIS layer on, a markup behind the plan, a callout, every measurement kind). Exported through the
 * real compose screen with "Flatten markups" OFF and ON, plus a blank plan (the known-good arm for the parity ratio):
 *   · OFF: every element type the brief lists is an annotation (Subjects read from the file), every building is;
 *     the only thing kept in the page is the car-parking field under the reference, and the app's warning list says why;
 *   · ON: zero annotations; render parity OFF vs ON within the existing bar;
 *   · pdf.js reads every annotation back, unlocked, with an appearance — building, pond and road among them;
 *   · MuPDF move proxy (ui-audit/tools/pdf_move_proxy.py): EVERY annotation translated + update()d moves, paints at its
 *     new place, leaves nothing behind, carries /Subj /NM /AP /N and a valid /Rect, no blocking flag; measurements carry
 *     /IT + /Measure (NEW-2).
 * ⚠ Bluebeam itself is NOT run here (none in the sandbox) — MuPDF + pdf.js are the proxy. The sandbox cannot reach FEMA,
 * so the GIS layer is ON but does not paint; that is said, not hidden. Signed in, every throwaway plan is deleted and its
 * absence verified (owner constraint 15).
 */
import { chromium } from "playwright";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { blurLinear } from "./lib/perceptualDiff.mjs";
import { realisticSitePlan, REQUIRED_SUBJECTS } from "./lib/realisticSitePlan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const urlArg = process.argv.slice(2).find((a) => /^https?:/.test(a));
const LIVE = !!urlArg && !/127\.0\.0\.1|localhost/.test(urlArg);
const BASE = urlArg || process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome";
const ASSERT = process.argv.includes("--assert");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/pdf-site-elements";
const DPI = Number(process.env.PDF_DPI || 110);
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };

const ID = "zz-pdfsite-" + Math.random().toString(36).slice(2, 8);
const blank = (id) => ({ schemaVersion: 12, id, groupId: id, site: "zz realistic export check", name: "Blank", updatedAt: Date.now(), status: "active", data: { status: "active" }, origin: { lat: 29.86, lon: -95.17 }, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], sheetOverlays: [], settings: {}, underlay: null });
const recs = { full: realisticSitePlan(ID), blank: blank(ID + "b") };

const HOOK = () => {
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try { if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); window.__pdfs.push(btoa(s)); }); } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};
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
const raster = (file, stem) => { execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", file, join(OUT, stem)]); return decodePng(readFileSync(join(OUT, `${stem}.png`))); };

async function openPlan(page, rec) {
  if (LIVE) {
    const err = await page.evaluate(async (site) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county || null, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      await window.pfSupabase.from("sites").delete().eq("id", site.id);
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, rec);
    check(!err, `throwaway plan ${rec.name} written to the test account${err ? " — " + err : ""}`);
  } else {
    await page.evaluate((r) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, rec);
  }
  await page.goto(`${BASE}/#/project/${rec.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 90000 });
  await pacedWait(page, 4000);
  await page.evaluate(HOOK);
}

let session = null, browser = null;
async function newPage() {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    session = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
    console.log("served build:", JSON.stringify(session.build));
    return session.page;
  }
  browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  return page;
}

const page = await newPage();
await assertMeasurable(page, "verify-pdf-site-elements");
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => { errors.push("alert: " + d.message()); d.dismiss().catch(() => {}); });
const out = {};
let comp = null;
try {
  await openPlan(page, recs.full);
  const feats = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid="planner-canvas"] [data-feature]')].map((n) => n.getAttribute("data-feature")))]);
  const elIds = recs.full.els.map((e) => `el:${e.id}`);
  check(elIds.filter((k) => feats.includes(k)).length >= elIds.length - 2 && feats.includes("reference:refAbove"), `the realistic plan renders (${elIds.filter((k) => feats.includes(k)).length}/${elIds.length} elements, the promoted reference${feats.includes("reference:refAbove") ? "" : " MISSING"})`);
  comp = await page.evaluate(async () => { const c = await window.__plannerExportComposed(); return c && { pins: c.pins, degraded: c.degraded, annots: c.annots }; });
  out.edit = await exportOnce(page, false); writeFileSync(join(OUT, "editable.pdf"), out.edit);
  out.flat = await exportOnce(page, true); writeFileSync(join(OUT, "flat.pdf"), out.flat);
  await openPlan(page, recs.blank);
  out.blank = await exportOnce(page, true); writeFileSync(join(OUT, "blank.pdf"), out.blank);
  const nonGis = errors.filter((e) => !/removeLayer/.test(e)); // sandbox: the GIS host is unreachable, Leaflet's teardown of the failed layer throws (pre-existing)
  check(nonGis.length === 0, `no JS crash or alert${nonGis.length ? " (" + nonGis.slice(0, 2).join("; ") + ")" : ""}`);
} finally {
  if (LIVE) {
    const ids = [recs.full.id, recs.blank.id];
    const gone = await page.evaluate(async (ids) => {
      try {
        const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); ids.forEach((id) => { delete all[id]; }); localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
        for (const id of ids) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        const left = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
        return { cloud: !(q.data && q.data.length), local: !ids.some((id) => left[id]) };
      } catch (e) { return { error: String(e) }; }
    }, ids).catch((e) => ({ error: String(e) }));
    check(!!gone.cloud && !!gone.local, "throwaway plans deleted and verified gone " + JSON.stringify(gone));
    await session.close();
  } else await browser.close();
}

// ---- the app's own account of what it lifted and what it kept
check(!!comp && comp.pins.length === 1 && /^Car parking /.test(comp.pins[0].name) && comp.pins[0].why === "under-reference", `exactly one object kept in the page — the car-parking field under the promoted reference (${comp ? JSON.stringify(comp.pins.map((p) => p.name + " / " + p.why)) : "no report"})`);
check(!!comp && comp.degraded.some((d) => /^Car parking .* printed into the page, not editable: a reference drawing shown above the plan covers it/.test(d)), "…and the export's warning list says why");

// ---- the file itself
const L = (b) => b.toString("latin1");
const edit = L(out.edit), flat = L(out.flat);
const dicts = edit.match(/\/Type \/Annot [^\n]*/g) || [];
check(!/\/Annots/.test(flat), "Flatten ON: zero annotations");
const subj = dicts.map((a) => (/\/Subj \(([^)]*)\)/.exec(a) || [])[1]);
const count = (s) => subj.filter((x) => x === s).length;
console.log("   Flatten OFF subjects:", JSON.stringify(Object.fromEntries([...new Set(subj)].map((s) => [s, count(s)]))));
for (const s of REQUIRED_SUBJECTS) check(count(s) > 0, `Flatten OFF: “${s}” is an annotation (${count(s)})`);
const hosts = recs.full.els.filter((e) => e.type === "building" && !e.dogEar && !e.attachedTo).length;
check(count("Building") === hosts, `every building is an annotation (${count("Building")} of ${hosts})`);
check(/\/IT \/PolygonDimension \/Measure << \/Type \/Measure \/Subtype \/RL/.test(edit) && /\/IT \/LineDimension \/Measure/.test(edit) && /\/IT \/PolyLineDimension \/Measure/.test(edit), "measurements are native: area /PolygonDimension, length /LineDimension, multi-leg /PolyLineDimension, each with a /Measure dictionary");

const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const an = await (await (await pdfjs.getDocument({ data: new Uint8Array(out.edit), verbosity: 0 }).promise).getPage(1)).getAnnotations();
check(an.length === dicts.length && an.every((a) => (a.annotationFlags & (2 | 32 | 64 | 128)) === 0 && a.hasAppearance), `pdf.js reads all ${an.length} annotations back, unlocked, each with an appearance`);
const pdfjsRow = (d) => an.find((x) => x.rect && Math.abs(x.rect[0] - d.rect[0]) < 0.01 && Math.abs(x.rect[1] - d.rect[1]) < 0.01);
const rectOf = (d) => (/\/Rect \[([^\]]+)\]/.exec(d) || [])[1].split(/\s+/).map(Number);
check(count("Building") >= hosts && count("Detention pond") >= 1 && an.filter((x) => x.annotationType === 7).length >= hosts + 7 + 1, `the buildings (${count("Building")}), the detention pond (${count("Detention pond")}) and the roads (${count("Road")}) are Polygon annotations, named in /Subj (${an.filter((x) => x.annotationType === 7).length} Polygons)`);

// ---- NEW-1 (2026-10-22): nothing here may raise Chrome's / Edge's hover note box (PDFium: a non-empty /Contents)
const named = dicts.filter((d) => REQUIRED_SUBJECTS.includes((/\/Subj \(([^)]*)\)/.exec(d) || [])[1]));
check(named.length >= hosts + 8, `${named.length} site-element annotations to check (not vacuous)`);
check(named.every((d) => !/\/Contents /.test(d)), `no site element carries /Contents — ${named.filter((d) => /\/Contents /.test(d)).length} do`);
check(dicts.every((d) => !/\/T \(Planyr\)/.test(d)) && !/\/Subtype \/Popup/.test(edit), "no annotation is titled “Planyr” and the file has no /Popup");
check(dicts.every((d) => /\/Subj \(/.test(d)), "every annotation keeps /Subj (Bluebeam's Markups list names it by that)");
const elementReads = named.map((d) => { const m = [...an].find((x) => x.rect && rectOf(d).every((v, i) => Math.abs(v - x.rect[i]) < 0.01)); return m ? { c: (m.contentsObj && m.contentsObj.str) || "", t: (m.titleObj && m.titleObj.str) || "" } : null; }).filter(Boolean);
check(elementReads.length >= hosts && elementReads.every((x) => x.c === "" && x.t === ""), `pdf.js getAnnotations: /Contents and /T are empty on every site element (${elementReads.length} read)`);
void pdfjsRow;

// ---- NEW-2 (2026-10-22): the page carries its scale; a translucent measurement fill is not stored as a fill
check(/\/VP \[<< \/Type \/Viewport \/BBox \[[^\]]+\] \/Name \(Plan\) \/Measure << \/Type \/Measure \/Subtype \/RL \/R \(1 in = \d+ ft\)/.test(edit), "the page carries a /VP viewport over the plan window with the sheet's /Measure scale (Bluebeam asks for no scale)");
const areaDict = dicts.find((d) => /\/Subj \(Area measurement\)/.test(d));
check(!!areaDict && /\/IT \/PolygonDimension/.test(areaDict) && !/\/IC /.test(areaDict) && /\/CA 1 /.test(areaDict), "the translucent area measurement stores no /IC (Bluebeam would paint it solid); its outline is /CA 1");

// ---- parity: Flatten OFF (page + annotations) vs ON
const A = raster(join(OUT, "flat.pdf"), "flat"), B = raster(join(OUT, "editable.pdf"), "editable"), C = raster(join(OUT, "blank.pdf"), "blank");
const meanAbs = (X, Y) => { let s = 0; for (let i = 0; i < X.length; i++) s += Math.abs(X[i] - Y[i]); return s / X.length; };
const bA = blurLinear(A, 2), bB = blurLinear(B, 2), bC = blurLinear(C, 2);
const vsBlank = meanAbs(bA, bC), vsEdit = meanAbs(bA, bB);
check(vsBlank > 0, `known-good arm: the flattened page differs from a blank plan (${vsBlank.toFixed(5)})`);
check(vsEdit / vsBlank <= 0.15, `render parity: editable vs flattened differs by ${((vsEdit / vsBlank) * 100).toFixed(1)}% of the plan's own ink weight (bar 15%)`);

// ---- MuPDF: drag every annotation
const r = spawnSync("python3", ["-I", join(here, "tools", "pdf_move_proxy.py"), join(OUT, "editable.pdf")], { encoding: "utf8", maxBuffer: 64 << 20 });
if (r.status !== 0 || !r.stdout.trim()) { console.error("VOID: the MuPDF move proxy did not run (pip install pymupdf numpy)\n" + r.stderr); process.exit(2); }
const mv = JSON.parse(r.stdout);
writeFileSync(join(OUT, "move-proxy.json"), JSON.stringify(mv, null, 1));
const rows = mv.rows;
check(rows.length === dicts.length && rows.length > 40, `MuPDF sees all ${rows.length} annotations`);
const bad = (f) => rows.filter((x) => !f(x)).map((x) => `${x.subj || x.subtype}#${x.i}`);
const nb = (f) => { const b = bad(f); return b.length ? ` — ${b.slice(0, 6).join(", ")}${b.length > 6 ? " …" : ""}` : ""; };
check(bad((x) => x.editable).length === 0, `no annotation is Hidden / NoView / ReadOnly / Locked / LockedContents${nb((x) => x.editable)}`);
check(bad((x) => x.subj && x.nm && x.ap && x.rect_ok).length === 0, `every annotation carries /Subj, /NM, /AP /N and a valid /Rect${nb((x) => x.subj && x.nm && x.ap && x.rect_ok)}`);
check(bad((x) => !x.moved_err && x.moved).length === 0, `every annotation moves when its geometry is translated and update()d${nb((x) => !x.moved_err && x.moved)}`);
check(bad((x) => x.ink_at_new > 0).length === 0, `…and paints at its new place${nb((x) => x.ink_at_new > 0)}`);
check(bad((x) => x.left_px <= Math.max(4, x.old_px * 0.002)).length === 0, `…and leaves NOTHING behind (the old place renders as the page does without it)${nb((x) => x.left_px <= Math.max(4, x.old_px * 0.002))}`);
const meas = rows.filter((x) => /Area measurement|Length measurement/.test(x.subj));
check(meas.length === 3 && meas.every((x) => x.measure && /Dimension/.test(x.it)), `the three measurements keep /IT + /Measure through the move (${meas.map((x) => x.it).join(", ")})`);
const areaRow = rows.find((x) => /Area measurement/.test(x.subj));
check(!!areaRow && areaRow.solid_frac < 0.5, `moved + rebuilt, the area measurement is never a solid block over the plan (interior heavy-ink share ${areaRow ? areaRow.solid_frac.toFixed(3) : "n/a"}; an opaque fill reads ~1.0)`);
console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})${LIVE ? "" : "\n   ⚠ local: the GIS layer is ON but the sandbox cannot reach FEMA, so it does not paint"}\n   ⚠ Bluebeam was not run — MuPDF and pdf.js are the proxy.`);
process.exit(ASSERT && fail ? 1 : 0);
