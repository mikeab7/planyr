/* The REAL I/O behind lib/fileWorkbook.js — the Library file store (reviewStore: Drive + the
 * `doc_reviews` record) and the parse worker. Kept apart from the rules so those are testable with
 * fakes. Nothing here decides anything; it moves bytes and records. */
import {
  loadReview, upsertReview, downloadFromDrive, downloadSource, storeSource, deleteFromDrive, fileNewReview,
  newSourceId, cloudReady,
} from "../../doc-review/lib/reviewStore.js";
import { getSourceBytes, cacheSourceBytes } from "../../doc-review/lib/sessionBytes.js";
import { parseSpreadsheetInWorker, exportWorkbookInWorker } from "./spreadsheetClient.js";

async function toBytes(x) {
  if (!x) return null;
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof x.arrayBuffer === "function") return new Uint8Array(await x.arrayBuffer());
  return null;
}

const scopeOf = (rec) => ({
  projectId: rec && rec.orgScope ? null : ((rec && rec.projectId) || null),
  discipline: (rec && rec.discipline) || "Other",
  folderId: (rec && rec.folderId) || null,
  orgScope: !!(rec && rec.orgScope),
});

export const libraryFileIO = {
  loadRecord: (id) => loadReview(id),
  /** Bytes dropped/saved this session win (a signed-out or mid-upload file); then Drive; then the old Supabase bucket. */
  async readBytes(source) {
    const cached = await toBytes(getSourceBytes(source.srcId));
    if (cached) return cached;
    let buf = source.driveKey ? await downloadFromDrive(source.driveKey) : null;
    if (!buf && source.storageKey) buf = await downloadSource(source.storageKey);
    return toBytes(buf);
  },
  parse: (bytes, name) => parseSpreadsheetInWorker(bytes, name),
  exportBlob: (workbook) => exportWorkbookInWorker(workbook),
  newId: newSourceId,
  cacheBytes: cacheSourceBytes,
  async store(srcId, blob, { name, record }) {
    if (!(await cloudReady())) return { ok: false, signedOut: true, driveError: "Sign in to save changes to your Library." };
    return storeSource(srcId, blob, { ...scopeOf(record), fileName: name });
  },
  upsert: (rec) => upsertReview(rec),
  deleteBytes: (driveKey) => { deleteFromDrive(driveKey).catch(() => {}); },
  async fileCopy({ record, blob, name }) {
    if (!(await cloudReady())) return { ok: false, signedOut: true, error: "Sign in to save your edits as a new Excel file in your Library." };
    return fileNewReview({ ...scopeOf(record), project: record.project || "", blob, fileName: name });
  },
};
