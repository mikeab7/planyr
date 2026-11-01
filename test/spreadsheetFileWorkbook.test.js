/* NEW-1 — open an uploaded Excel in Spreadsheet: the OPEN / SAVE rules (lib/fileWorkbook.js) against an
 * in-memory Library, with the REAL parser and the REAL .xlsx writer — only Drive and Supabase are faked.
 *
 * What these pin, in the owner's words: "my edits save, survive a reload, and the file still opens
 * correctly in Excel afterwards", "opening it a second time shows my edits, not the original upload", and
 * "never overwrite my original file with a lossy save".
 * Red-proof (see the PR): each assertion below is one a broken save path could not satisfy by accident —
 * the original-bytes check compares against the exact uploaded bytes, and the reopen check reads the
 * edited value back out of the stored bytes, not out of memory. */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { openFileWorkbook, saveFileWorkbook, openingNotes, isSpreadsheetRecord, recordFileName } from "../src/workspaces/model/lib/fileWorkbook.js";
import { parseSpreadsheetFile } from "../src/workspaces/model/lib/spreadsheetFile.js";
import { exportViaUniver } from "./fixtures/spreadsheet/exportViaUniver.js";
import { applyToActiveSheet, commitCellText } from "../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook, displayFor } from "../src/workspaces/model/lib/sheetEngine.js";
import { versionList } from "../src/workspaces/doc-review/lib/docVersions.js";

const fixture = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/spreadsheet/${n}`, import.meta.url)));
const shown = (wb, idx, r, c) => { const e = wb.sheets[idx]; return displayFor(e.sheet, evaluateWorkbook(wb, {}).get(e.id), r, c); };
const raw = (wb, idx, r, c) => { const e = wb.sheets[idx]; return e.sheet.cells[`${e.sheet.columns[c].id}:${r}`]; };

/** A fake Library: records + stored bytes, with the same shape reviewStore hands the module. */
function makeLibrary() {
  const records = new Map(), blobs = new Map(), deleted = [];
  let n = 0, conflictNext = false, failStore = false;
  const lib = {
    records, blobs, deleted,
    failConflictOnce() { conflictNext = true; },
    failStore(v = true) { failStore = v; },
    /** Upload a file as a Library record (what fileNewReview writes). */
    async upload(name, bytes, extra = {}) {
      const id = `rv${++n}`, srcId = `src${++n}`, driveKey = `drive/${srcId}__${name}`;
      blobs.set(driveKey, new Uint8Array(bytes));
      records.set(id, { id, kind: "single", title: name, sourceFile: name, project: "P", projectId: "proj1", discipline: "Other", folderId: "f1",
        sources: [{ srcId, name, size: bytes.length, storageKey: null, driveKey, oversize: false }], single: { srcId, fileName: name, numPages: 0, page: 1, markups: [] }, ...extra });
      return id;
    },
    io: null,
  };
  lib.io = {
    loadRecord: async (id) => (records.has(id) ? JSON.parse(JSON.stringify(records.get(id))) : null),
    readBytes: async (src) => blobs.get(src.driveKey) || null,
    parse: (bytes, name) => parseSpreadsheetFile(bytes, name),
    exportBlob: (wb) => exportViaUniver(wb),
    newId: () => `src${++n}`,
    store: async (srcId, blob, { name }) => {
      if (failStore) return { ok: false, driveError: "Drive is out of space." };
      const driveKey = `drive/${srcId}__${name}`; blobs.set(driveKey, new Uint8Array(await blob.arrayBuffer())); return { ok: true, driveKey };
    },
    upsert: async (rec) => { if (conflictNext) { conflictNext = false; return { ok: false, conflict: true }; } records.set(rec.id, JSON.parse(JSON.stringify(rec))); return { ok: true }; },
    deleteBytes: (k) => { deleted.push(k); blobs.delete(k); },
    fileCopy: async ({ record, blob, name }) => {
      const id = await lib.upload(name, new Uint8Array(await blob.arrayBuffer()), { project: record.project, projectId: record.projectId, folderId: record.folderId });
      return { ok: true, id };
    },
  };
  return lib;
}

async function broker() {
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet("Assumptions"); a.getCell("A1").value = "Land"; a.getCell("B1").value = 1000;
  a.getCell("A2").value = "Date"; a.getCell("B2").value = 45292; a.getCell("B2").numFmt = "m/d/yyyy";
  const m = wb.addWorksheet("Model"); m.getCell("A1").value = "Total"; m.getCell("B1").value = { formula: "Assumptions!B1*2", result: 2000 };
  m.views = [{ state: "frozen", ySplit: 1 }];
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const edit = (wb, idx, r, c, text) => {
  const w2 = { ...wb, activeSheetId: wb.sheets[idx].id };
  return applyToActiveSheet(w2, (s) => commitCellText(s, r, c, text));
};

describe("open a Library .xlsx and save edits back to the SAME file", () => {
  it("edits persist in the stored bytes; the original upload is kept byte-for-byte as the prior version", async () => {
    const lib = makeLibrary();
    const original = await broker();
    const id = await lib.upload("pro forma.xlsx", original);
    const opened = await openFileWorkbook(id, lib.io);
    expect(opened.inPlace).toBe(true);
    expect(opened.workbook.sheets.map((s) => s.name)).toEqual(["Assumptions", "Model"]);

    // edit a value; the formula that reads it must recompute on screen
    const edited = edit(opened.workbook, 0, 0, 1, "5000");
    expect(shown(edited, 1, 0, 1)).toBe("10000");
    const saved = await saveFileWorkbook(opened, edited, lib.io, { by: "Mike" });
    expect(saved.ok).toBe(true);

    // ONE record; two stored versions; the OLDER one is exactly what was uploaded
    const rec = lib.records.get(id);
    expect(lib.records.size).toBe(1);
    expect(rec.sources).toHaveLength(2);
    expect(Array.from(lib.blobs.get(rec.sources[1].driveKey))).toEqual(Array.from(original));
    expect(versionList(rec.sources[0], rec.sources.slice(1)).map((v) => v.isCurrent)).toEqual([true, false]);

    // "second open shows my edits": a fresh open reads the saved bytes
    const again = await openFileWorkbook(id, lib.io);
    expect(raw(again.workbook, 0, 0, 1)).toBe("5000");
    expect(shown(again.workbook, 1, 0, 1)).toBe("10000");
    expect(raw(again.workbook, 1, 0, 1)).toBe("=Assumptions!B1*2"); // still a formula, not frozen to a number
    expect(shown(again.workbook, 0, 1, 1)).toBe("1/1/2024");       // still a date, not 45292
    expect(again.workbook.sheets[1].sheet.freezeRows).toBe(1);      // frozen header survives
  });

  it("further saves in the same session replace the session's version — the original and history stay", async () => {
    const lib = makeLibrary();
    const original = await broker();
    const id = await lib.upload("a.xlsx", original);
    let state = await openFileWorkbook(id, lib.io);
    let wb = edit(state.workbook, 0, 0, 1, "1");
    let r = await saveFileWorkbook(state, wb, lib.io); state = r.state;
    const firstSessionKey = state.source.driveKey;
    wb = edit(wb, 0, 0, 1, "2");
    r = await saveFileWorkbook(state, wb, lib.io); state = r.state;
    wb = edit(wb, 0, 0, 1, "3");
    r = await saveFileWorkbook(state, wb, lib.io); state = r.state;
    const rec = lib.records.get(id);
    expect(rec.sources).toHaveLength(2);                       // not 4
    expect(lib.deleted).toContain(firstSessionKey);            // the replaced session bytes are cleaned up…
    expect(lib.deleted).not.toContain(rec.sources[1].driveKey); // …but never the original
    expect(Array.from(lib.blobs.get(rec.sources[1].driveKey))).toEqual(Array.from(original));
    expect(raw((await openFileWorkbook(id, lib.io)).workbook, 0, 0, 1)).toBe("3");
  });

  it("a new session after reopening adds a NEW version and keeps the earlier session's final", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("a.xlsx", await broker());
    let s1 = await openFileWorkbook(id, lib.io);
    await saveFileWorkbook(s1, edit(s1.workbook, 0, 0, 1, "7"), lib.io);
    const s2 = await openFileWorkbook(id, lib.io);
    const r = await saveFileWorkbook(s2, edit(s2.workbook, 0, 0, 1, "8"), lib.io);
    expect(r.ok).toBe(true);
    expect(lib.records.get(id).sources).toHaveLength(3); // original, session 1 final, session 2
  });

  it("the saved bytes are a real .xlsx Excel can read: sheets, formulas (with cached values) and dates", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("a.xlsx", await broker());
    const s = await openFileWorkbook(id, lib.io);
    await saveFileWorkbook(s, edit(s.workbook, 0, 0, 1, "250"), lib.io);
    const bytes = lib.blobs.get(lib.records.get(id).sources[0].driveKey);
    const ex = new ExcelJS.Workbook(); await ex.xlsx.load(bytes); // read with the library directly, not through our reader
    expect(ex.worksheets.map((w) => w.name)).toEqual(["Assumptions", "Model"]);
    const f = ex.getWorksheet("Model").getCell("B1").value;
    expect(f.formula).toBe("Assumptions!B1*2");
    expect(f.result).toBe(500);
    const d = ex.getWorksheet("Assumptions").getCell("B2");
    expect(d.value instanceof Date).toBe(true);
    expect(d.numFmt).toBe("m/d/yyyy");
  });

  it("a conflict (the file changed elsewhere) is reported, not swallowed, and leaves no orphan bytes", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("a.xlsx", await broker());
    const s = await openFileWorkbook(id, lib.io);
    lib.failConflictOnce();
    const before = lib.blobs.size;
    const r = await saveFileWorkbook(s, edit(s.workbook, 0, 0, 1, "9"), lib.io);
    expect(r).toMatchObject({ ok: false, reason: "conflict" });
    expect(lib.blobs.size).toBe(before);
    expect(lib.records.get(id).sources).toHaveLength(1);
  });

  it("a failed upload is a visible failure with the reason", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("a.xlsx", await broker());
    const s = await openFileWorkbook(id, lib.io);
    lib.failStore();
    const r = await saveFileWorkbook(s, edit(s.workbook, 0, 0, 1, "9"), lib.io);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/out of space/);
  });
});

describe("a file that cannot be saved in place gets an .xlsx copy; the original is never touched", () => {
  it(".xls: first save files 'legacy.xlsx' beside it, links it, and every later open lands on the copy", async () => {
    const lib = makeLibrary();
    const xls = fixture("legacy.xls");
    const id = await lib.upload("legacy.xls", xls);
    const opened = await openFileWorkbook(id, lib.io);
    expect(opened.inPlace).toBe(false);
    expect(openingNotes(opened).map((n) => n.key)).toContain("copy-on-save");

    const saved = await saveFileWorkbook(opened, edit(opened.workbook, 0, 1, 1, "42"), lib.io);
    expect(saved.ok).toBe(true);
    expect(saved.switchedTo).toMatchObject({ name: "legacy.xlsx", fromName: "legacy.xls" });
    const orig = lib.records.get(id);
    expect(orig.spreadsheetCopyId).toBe(saved.switchedTo.id);
    expect(orig.sources).toHaveLength(1);
    expect(Array.from(lib.blobs.get(orig.sources[0].driveKey))).toEqual(Array.from(xls)); // untouched
    const copy = lib.records.get(saved.switchedTo.id);
    expect(copy.sourceFile).toBe("legacy.xlsx");
    expect(copy.folderId).toBe("f1");        // filed in the same folder
    expect(copy.projectId).toBe("proj1");

    // second open of the ORIGINAL shows the edits (it lands on the copy) and says so
    const again = await openFileWorkbook(id, lib.io);
    expect(again.openedFromCopy).toMatchObject({ id, name: "legacy.xls" });
    expect(again.id).toBe(saved.switchedTo.id);
    expect(raw(again.workbook, 0, 1, 1)).toBe("42");
    expect(openingNotes(again)[0].key).toBe("copy");

    // and the copy saves in place from then on
    const r2 = await saveFileWorkbook(saved.state, edit(again.workbook, 0, 1, 1, "43"), lib.io);
    expect(r2.ok).toBe(true);
    expect(lib.records.get(saved.switchedTo.id).sources).toHaveLength(2);
    expect(lib.records.size).toBe(2);
  });

  it(".csv: edits go to a new .xlsx; the CSV stays exactly as uploaded", async () => {
    const lib = makeLibrary();
    const csv = new TextEncoder().encode("Name,Rent\nAlpha,7.25\n");
    const id = await lib.upload("comps.csv", csv);
    const opened = await openFileWorkbook(id, lib.io);
    expect(opened.kind).toBe("csv");
    const saved = await saveFileWorkbook(opened, edit(opened.workbook, 0, 1, 1, "8"), lib.io);
    expect(saved.switchedTo.name).toBe("comps.xlsx");
    expect(Array.from(lib.blobs.get(lib.records.get(id).sources[0].driveKey))).toEqual(Array.from(csv));
    expect(raw((await openFileWorkbook(saved.switchedTo.id, lib.io)).workbook, 0, 1, 1)).toBe("8");
  });

  it("if the copy was deleted, the original opens again rather than failing", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("legacy.xls", fixture("legacy.xls"));
    const s = await openFileWorkbook(id, lib.io);
    const saved = await saveFileWorkbook(s, edit(s.workbook, 0, 1, 1, "1"), lib.io);
    lib.records.delete(saved.switchedTo.id);
    const again = await openFileWorkbook(id, lib.io);
    expect(again.id).toBe(id);
    expect(again.openedFromCopy).toBeUndefined();
  });
});

describe("opening problems are plain messages that name the file", () => {
  it("a missing record, a non-spreadsheet, a file with no bytes, a failed download", async () => {
    const lib = makeLibrary();
    await expect(openFileWorkbook("nope", lib.io)).rejects.toMatchObject({ code: "missing" });
    const pdf = await lib.upload("plan.pdf", new Uint8Array([1]));
    await expect(openFileWorkbook(pdf, lib.io)).rejects.toThrow(/plan\.pdf/);
    const xl = await lib.upload("x.xlsx", await broker());
    lib.records.get(xl).sources = [];
    await expect(openFileWorkbook(xl, lib.io)).rejects.toThrow(/x\.xlsx/);
    const xl2 = await lib.upload("y.xlsx", await broker());
    lib.blobs.clear();
    await expect(openFileWorkbook(xl2, lib.io)).rejects.toMatchObject({ code: "download" });
  });
  it("a password-protected upload surfaces the parser's message untouched", async () => {
    const lib = makeLibrary();
    const id = await lib.upload("locked.xlsx", fixture("locked.xlsx"));
    await expect(openFileWorkbook(id, lib.io)).rejects.toMatchObject({ code: "encrypted" });
  });
  it("record helpers", () => {
    expect(recordFileName({ sourceFile: "a.xlsx" })).toBe("a.xlsx");
    expect(recordFileName({ sources: [{ name: "b.csv" }] })).toBe("b.csv");
    expect(isSpreadsheetRecord({ sourceFile: "a.xls" })).toBe(true);
    expect(isSpreadsheetRecord({ sourceFile: "a.docx" })).toBe(false);
    expect(isSpreadsheetRecord({})).toBe(false); // no source name = a PDF drawing
  });
});
