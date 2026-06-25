#!/usr/bin/env node
/* eval-titleblock.mjs — batch "every file, every sheet" evaluator for the auto-filing /
 * title-block / file-naming reader.
 *
 * WHY THIS EXISTS (owner request, 2026-06-25): before trusting the live app to name a real
 * drawing, point this at a folder of real PDFs and see — per page — exactly what the reader
 * extracts (discipline, sheet number, sheet title, stated scale) and, per file, the filing
 * decision + the auto-name it would produce + the project it matched. Anything the reader is
 * unsure about is flagged, so a miss is visible BEFORE the file is dropped into the app.
 *
 * It runs the REAL production logic — the same pure modules the browser runs:
 *   localTitleBlockRead  (doc-review/lib/localRead.js)  → the file-level filing decision
 *   readSheetMeta        (shared/files/sheetMeta.js)    → per-page sheet #, title, scale
 *   matchProjectInText / splitByDiscipline             → called inside localTitleBlockRead
 * The ONLY thing swapped out is the browser PDF plumbing (pdf.js + Vite worker URL): here we
 * load PDFs with the pdfjs-dist *legacy* build in Node and reproduce extractAllPagesText /
 * extractPageItems byte-for-byte (the y-flip to a top-left origin matches lib/pdf.js exactly).
 *
 * Scanned / image-only pages have no embedded text — in the browser those fall to Tesseract OCR.
 * Node OCR is not wired here (heavy WASM), so such pages are reported `scanned (needs OCR)` and
 * excluded from the text read, mirroring how the app degrades when OCR can't recover a page.
 *
 * USAGE
 *   node ui-audit/eval-titleblock.mjs --dir ./drawings
 *   node ui-audit/eval-titleblock.mjs file1.pdf file2.pdf --projects projects.json
 *   node ui-audit/eval-titleblock.mjs --dir ./drawings --json report.json
 *
 *   --projects projects.json  Named projects to match against (so it can test the auto-FILE step,
 *                             not just the auto-NAME step). Shape:
 *                               [{ "id":"p1", "name":"Katy Grand",
 *                                  "aliases": { "names":[], "addresses":[], "parcels":[], "jobNumbers":[] } }]
 *                             Without it, the project-match step is skipped (reported "no projects supplied").
 *   --json out.json           Also write the full structured result for diffing across runs.
 */
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join, basename, extname } from "node:path";

import { localTitleBlockRead } from "../src/workspaces/doc-review/lib/localRead.js";
import { readSheetMeta } from "../src/shared/files/sheetMeta.js";

const require = createRequire(import.meta.url);
GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

// ---- file naming (faithful copy of reviewStore.composeTitle / fmtDocDate; that module pulls in
// the browser Supabase client, so it can't be imported in Node — the 6 lines are mirrored exactly) ----
const pad = (n) => String(n).padStart(2, "0");
function fmtDocDate(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) { const [y, m, day] = d.slice(0, 10).split("-"); return `${y}.${m}.${day}`; }
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}.${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
}
function composeTitle({ project, item, docDate } = {}) {
  const head = [project, item].map((s) => (s || "").trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${head} - ${date}` : head;
}

// ---- pdf.js plumbing in Node — byte-for-byte equivalents of lib/pdf.js ----
async function loadPdf(bytes) {
  return getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false }).promise;
}
async function extractAllPagesText(pdf) {
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    try {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      out.push(tc.items.map((i) => i.str).join(" "));
    } catch { out.push(""); }
  }
  return out;
}
// mirrors lib/pdf.js extractPageItems (top-left origin y-flip)
async function extractPageItems(pdf, pageNum) {
  try {
    const page = await pdf.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const t = it.transform || [1, 0, 0, 1, 0, 0];
      const h = it.height || Math.hypot(t[2], t[3]) || 0;
      const w = it.width || 0;
      items.push({ str, x: t[4], y: Math.max(0, vp.height - t[5] - h), w, h });
    }
    return { items, width: vp.width, height: vp.height };
  } catch { return { items: [], width: 0, height: 0 }; }
}

// ---- per-file evaluation ----
async function evalFile(path, projects) {
  const name = basename(path);
  const bytes = await readFile(path);

  // File-level filing decision — the REAL localTitleBlockRead, with Node text extraction injected
  // and OCR disabled (scanned pages report as no-text, exactly as the app degrades without OCR).
  let decisionRes;
  try {
    decisionRes = await localTitleBlockRead(bytes, projects, {
      extractPages: async (f) => extractAllPagesText(await loadPdf(f)),
      ocr: null,
    });
  } catch (e) { decisionRes = { ok: false, error: (e && e.message) || String(e) }; }

  // Per-page positional read — the REAL readSheetMeta (what the Markup sidebar shows per sheet).
  const pages = [];
  let pdf = null;
  try {
    pdf = await loadPdf(bytes);
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await extractPageItems(pdf, p);
      const meta = readSheetMeta(page);
      pages.push({
        pageNum: p,
        hasText: meta.hasText,
        sheetNumber: meta.sheetNumber || "",
        sheetTitle: meta.sheetTitle || "",
        discipline: meta.discipline || "",
        item: meta.item || "",
        scale: meta.scale ? (meta.scale.label || meta.scale.explicit || meta.scale.form || "") : "",
        revision: meta.revision || "",
        date: meta.date || "",
        confidence: typeof meta.confidence === "number" ? meta.confidence : null,
        textDense: !!meta.textDense,
        nItems: page.items.length,
      });
    }
  } catch (e) {
    if (!pages.length) pages.push({ pageNum: 1, error: (e && e.message) || String(e) });
  } finally { try { pdf && pdf.destroy(); } catch { /* best-effort */ } }

  // Per-page flags — anything a human should eyeball before trusting the auto-name.
  for (const pg of pages) {
    const flags = [];
    if (pg.error) { flags.push("READ-ERROR"); pg.flags = flags; continue; }
    if (!pg.hasText && pg.nItems === 0) flags.push("scanned (needs OCR)");
    if (pg.hasText && !pg.sheetNumber) flags.push("no sheet #");
    if (pg.hasText && !pg.sheetTitle) flags.push("no title");
    if (pg.hasText && !pg.scale && !pg.textDense) flags.push("no scale");
    if (pg.confidence != null && pg.confidence < 0.4) flags.push("low confidence");
    pg.flags = flags;
  }

  // File-level flags.
  const d = decisionRes.ok && decisionRes.decision ? decisionRes.decision : null;
  const fileFlags = [];
  if (!decisionRes.ok) fileFlags.push("OPEN-FAILED");
  else if (decisionRes.hasText === false) fileFlags.push("no text layer (whole file scanned → OCR/AI)");
  else if (d) {
    if (projects.length && !d.matched) fileFlags.push("NO PROJECT MATCH → holding tray");
    if (projects.length && d.needsFiling) fileFlags.push("needs filing (low/ambiguous match)");
    if (d.multiDiscipline) fileFlags.push(`multi-discipline (${(d.sets || []).map((s) => s.discipline).join(", ")})`);
    if (!d.docDate) fileFlags.push("no date");
  }

  const composed = d
    ? composeTitle({ project: d.project || (projects.length ? "" : "(no project list)"), item: d.item, docDate: d.docDate })
    : "(no decision)";

  return { name, path, decision: decisionRes, composed, pages, fileFlags };
}

// ---- reporting ----
function clip(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n); }
function printFile(r) {
  console.log("\n" + "═".repeat(96));
  console.log("FILE: " + r.name);
  const d = r.decision.ok && r.decision.decision ? r.decision.decision : null;
  if (!r.decision.ok) console.log("  ⚠ could not open: " + (r.decision.error || "unknown"));
  else if (r.decision.hasText === false) console.log("  ⚠ no embedded text — whole file is scanned (would OCR/AI in the app)");
  else if (d) {
    console.log("  AUTO-NAME : " + r.composed);
    console.log("  FILE INTO : project=" + (d.project || "—") + "  discipline=" + d.discipline +
      "  item=" + d.item + "  date=" + d.docDate + "  rev=" + (d.revision || "—"));
    console.log("  MATCH     : matched=" + d.matched + "  confidence=" + (d.confidence != null ? d.confidence.toFixed(2) : "—") +
      "  reason=" + d.reason + (d.candidates && d.candidates.length ? "  top=" + d.candidates.slice(0, 3).map((c) => `${c.name}:${c.score}`).join(", ") : ""));
    if (d.ocrUsed) console.log("  OCR       : " + d.ocrUsed + " image-only page(s) recovered");
    if (d.multiDiscipline && (d.sets || []).length) {
      console.log("  SETS      : each discipline files separately —");
      for (const s of d.sets) {
        const setName = composeTitle({ project: d.project || (r.decision && "(no project list)"), item: s.item || s.discipline, docDate: d.docDate });
        console.log("              • " + s.discipline + "  pp[" + (s.pageNums || []).join(",") + "]  → " + setName);
      }
    }
  }
  if (r.fileFlags.length) console.log("  ⚑ " + r.fileFlags.join("  |  "));

  console.log("  ┌─ sheets ─────────────────────────────────────────────────────────────────────────────");
  console.log("  │ pg  " + clip("sheet#", 9) + clip("discipline", 14) + clip("title", 30) + clip("scale", 10) + "flags");
  for (const pg of r.pages) {
    const line = "  │ " + clip(pg.pageNum, 4) + clip(pg.sheetNumber || "—", 9) +
      clip(pg.discipline || "—", 14) + clip(pg.sheetTitle || pg.item || "—", 30) +
      clip(pg.scale || "—", 10) + " " + (pg.flags && pg.flags.length ? pg.flags.join(", ") : "ok");
    console.log(line);
  }
  console.log("  └──────────────────────────────────────────────────────────────────────────────────────");
}

function summarize(results) {
  let files = results.length, pages = 0, flaggedPages = 0, scanned = 0, noMatch = 0, openFail = 0;
  for (const r of results) {
    pages += r.pages.length;
    flaggedPages += r.pages.filter((p) => p.flags && p.flags.length).length;
    scanned += r.pages.filter((p) => p.flags && p.flags.includes("scanned (needs OCR)")).length;
    if (r.fileFlags.some((f) => f.startsWith("NO PROJECT MATCH"))) noMatch++;
    if (!r.decision.ok) openFail++;
  }
  console.log("\n" + "═".repeat(96));
  console.log(`SUMMARY  files=${files}  pages=${pages}  flagged-pages=${flaggedPages}  scanned-pages=${scanned}  no-project-match-files=${noMatch}  open-failures=${openFail}`);
  if (flaggedPages || noMatch || openFail) console.log("  → review the ⚑ / flagged rows above; each is a place the auto-name could be wrong.");
  else console.log("  → every page read cleanly.");
}

// ---- main ----
async function main() {
  const argv = process.argv.slice(2);
  let dir = null, projectsPath = null, jsonOut = null;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir") dir = argv[++i];
    else if (a === "--projects") projectsPath = argv[++i];
    else if (a === "--json") jsonOut = argv[++i];
    else files.push(a);
  }
  if (dir) {
    const entries = await readdir(dir);
    for (const e of entries) if (extname(e).toLowerCase() === ".pdf") files.push(join(dir, e));
  }
  if (!files.length) {
    console.error("No PDFs given. Usage: node ui-audit/eval-titleblock.mjs --dir ./drawings [--projects projects.json] [--json out.json]");
    process.exit(1);
  }
  let projects = [];
  if (projectsPath) {
    try { projects = JSON.parse(await readFile(projectsPath, "utf8")); }
    catch (e) { console.error("Could not read --projects: " + e.message); process.exit(1); }
  }

  console.log(`Evaluating ${files.length} PDF(s)${projects.length ? ` against ${projects.length} project(s)` : " (no project list → testing auto-NAME only)"}…`);
  const results = [];
  for (const f of files.sort()) {
    const r = await evalFile(resolve(f), projects);
    results.push(r);
    printFile(r);
  }
  summarize(results);
  if (jsonOut) { await writeFile(jsonOut, JSON.stringify(results, null, 2)); console.log("\nWrote " + jsonOut); }
}

main().catch((e) => { console.error(e); process.exit(1); });
