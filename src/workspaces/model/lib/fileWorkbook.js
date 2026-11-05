/* A Library spreadsheet file, opened as an editable workbook — the open / save rules (NEW-1,
 * "open an uploaded Excel in Spreadsheet").
 *
 * ONE SOURCE OF TRUTH: the Library file IS the document. There is no second copy of the workbook in a
 * database table for the file to drift from. Opening reads the file's latest stored bytes; saving
 * writes the edited workbook back as a NEW stored version of that same Library file, and the
 * previous bytes move into the file's version history (docs: `doc-review/lib/docVersions.js`, the
 * mechanism Word/text files already use). So "open it a second time" reads the saved bytes — edits
 * are there — and the very first upload is still version 1, byte for byte, never overwritten.
 *
 * Which files save in place: only a real .xlsx (`savesInPlace`). An .xls / .xlsm / .csv would lose
 * formatting, macros or formulas if overwritten, so the FIRST save of one writes a NEW .xlsx Library
 * file beside it (same project/folder), records the link on the original, and every later open of the
 * original lands on that copy. The original is never touched.
 *
 * Autosave coalescing: a long editing session must not mint a version per keystroke-burst. The first
 * save of a session adds a version (the original moves into history); later saves in the SAME session
 * replace that session's own version — the original and every earlier session's final stay. The
 * replaced session bytes are deleted from storage (they were created by this session, nothing else
 * points at them).
 *
 * PURE decisions + injected I/O (`io`) so every rule here is asserted without Drive, Supabase or React.
 * The real I/O is lib/fileWorkbookStore.js.
 */
import { spreadsheetKindOf, savesInPlace, xlsxNameFor } from "./spreadsheetKind.js";
import { packSource, newVersionEntry, demote } from "../../doc-review/lib/docVersions.js";

export class FileWorkbookError extends Error {
  constructor(code, message) { super(message); this.name = "FileWorkbookError"; this.code = code; }
}

/** The file's name as the Library knows it. */
export function recordFileName(rec) {
  if (!rec) return "";
  const latest = Array.isArray(rec.sources) && rec.sources[0];
  return rec.sourceFile || (latest && latest.name) || (rec.single && rec.single.fileName) || "";
}

/** Is this Library record a spreadsheet file Spreadsheet can open? (By its original file name — the
 *  same authority the Library's own type tag uses.) */
export const isSpreadsheetRecord = (rec) => spreadsheetKindOf(recordFileName(rec)) !== null;

/** Open a Library file as a workbook.
 *  io.loadRecord(id) → record|null · io.readBytes(source) → Uint8Array|ArrayBuffer|null · io.parse(bytes, name) → parse result.
 *  Resolves { id, record, name, source, prior, workbook, notes, inPlace, openedFromCopy? }; throws FileWorkbookError
 *  (or the parser's SpreadsheetFileError, passed through untouched) with a message that names the file. */
export async function openFileWorkbook(id, io, { _depth = 0 } = {}) {
  const rec = await io.loadRecord(id);
  if (!rec) throw new FileWorkbookError("missing", "That file isn’t in your Library any more, or you’re signed out. Open it from the Library again.");
  const name = recordFileName(rec);
  if (!isSpreadsheetRecord(rec)) throw new FileWorkbookError("not-spreadsheet", `“${name || "This file"}” isn’t an Excel or CSV file, so Spreadsheet can’t open it.`);

  // An original that already has an editable Excel copy opens on the copy — the user's edits, not the upload.
  if (!savesInPlace(name) && rec.spreadsheetCopyId && _depth === 0) {
    try {
      const copy = await openFileWorkbook(rec.spreadsheetCopyId, io, { _depth: 1 });
      return { ...copy, openedFromCopy: { id, name } };
    } catch (_) { /* the copy was deleted or unreadable: fall through and open the original again */ }
  }

  const sources = Array.isArray(rec.sources) ? rec.sources : [];
  const source = sources[0];
  if (!source || !(source.driveKey || source.storageKey || source.local)) {
    throw new FileWorkbookError("no-bytes", `“${name}” hasn’t finished uploading to your Library yet, or its file is missing. Wait a moment and open it again, or upload it again.`);
  }
  const bytes = await io.readBytes(source);
  if (!bytes) throw new FileWorkbookError("download", `Couldn’t download “${name}” from your Library. Check your connection and try again.`);
  const parsed = await io.parse(bytes, name);
  return {
    id, record: rec, name, source, prior: sources.slice(1),
    workbook: parsed.workbook, notes: parsed.notes || [], kind: parsed.kind, inPlace: savesInPlace(name),
  };
}

/** The "this will not carry over" notes for a banner, plus the standing sentence about where edits go. */
export function openingNotes({ notes = [], inPlace, name, openedFromCopy }) {
  const out = notes.map((n) => ({ ...n }));
  if (openedFromCopy) out.unshift({ key: "copy", text: `Opened your editable Excel copy of “${openedFromCopy.name}”. The original upload is unchanged in your Library.` });
  else if (!inPlace) out.push({ key: "copy-on-save", text: `Your edits save to a new Excel file, “${xlsxNameFor(name)}”, next to this one. “${name}” itself is never changed.` });
  return out;
}

/** Save the edited workbook.
 *  `state` = { id, record, name, source, prior, inPlace, sessionSrcId }  (what openFileWorkbook returned + the session's own srcId, if it has saved yet)
 *  io.exportBlob(workbook) → Blob · io.loadRecord · io.store(srcId, blob, {name, record}) → {ok, driveKey, storageKey, driveError}
 *  io.upsert(record) → {ok, conflict?, error?} · io.newId() · io.deleteBytes(driveKey) · io.fileCopy({record, blob, name}) → {ok, id, error}
 *  Resolves { ok:true, state: <next state> , switchedTo? } or { ok:false, reason: "conflict"|"error"|"signed-out", error }. Never throws. */
export async function saveFileWorkbook(state, workbook, io, { by = "", now = Date.now() } = {}) {
  try {
    const blob = await io.exportBlob(workbook);
    if (!state.inPlace) return await saveAsCopy(state, blob, io, { by, now });
    const fresh = (await io.loadRecord(state.id)) || state.record;
    const srcId = io.newId();
    io.cacheBytes && io.cacheBytes(srcId, blob);
    const stored = await io.store(srcId, blob, { name: state.name, record: fresh });
    if (!stored || !stored.ok) return { ok: false, reason: stored && stored.signedOut ? "signed-out" : "error", error: (stored && stored.driveError) || "Couldn’t upload the saved file. Your edits are still here — they will be tried again." };

    const entry = newVersionEntry({ srcId, name: state.name, size: blob.size, driveKey: stored.driveKey || null, storageKey: stored.storageKey || null, savedBy: by, now });
    const replacing = !!state.sessionSrcId && state.source && state.source.srcId === state.sessionSrcId;
    const prior = replacing ? state.prior : demote(state.prior, state.source);
    const sources = [entry, ...prior.map(packSource)];
    const next = { ...fresh, sources, ...(fresh.single ? { single: { ...fresh.single, srcId } } : {}), updatedAt: now };
    const res = await io.upsert(next);
    if (!res || !res.ok) {
      if (stored.driveKey && io.deleteBytes) io.deleteBytes(stored.driveKey); // the version never landed in the record; don't leave an orphan
      return res && res.conflict
        ? { ok: false, reason: "conflict", error: "This file was changed somewhere else. Reload it to see the newer version." }
        : { ok: false, reason: "error", error: (res && res.error) || "Couldn’t save to your Library. Your edits are still here." };
    }
    if (replacing && state.source.driveKey && io.deleteBytes) io.deleteBytes(state.source.driveKey);
    return { ok: true, state: { ...state, record: next, source: entry, prior, sessionSrcId: srcId } };
  } catch (e) {
    return { ok: false, reason: "error", error: `Couldn’t save: ${(e && e.message) || "unknown error"}. Your edits are still here.` };
  }
}

async function saveAsCopy(state, blob, io, { by, now }) {
  // The copy already exists (an earlier save this session, or a link recorded on the original): it is now
  // the file being edited, so this is an ordinary in-place save of THAT file.
  if (state.copyOfId) return { ok: false, reason: "error", error: "Internal: copy state without an in-place file." };
  const name = xlsxNameFor(state.name);
  const made = await io.fileCopy({ record: state.record, blob, name });
  if (!made || !made.ok || made.uploadFailed) {
    return { ok: false, reason: made && made.signedOut ? "signed-out" : "error", error: (made && (made.error || made.driveError)) || `Couldn’t save “${name}” to your Library. Your edits are still here.` };
  }
  // Record the link on the ORIGINAL (metadata only — its bytes and version list are not touched) so the next open lands on the copy.
  const orig = (await io.loadRecord(state.id)) || state.record;
  const link = await io.upsert({ ...orig, spreadsheetCopyId: made.id, updatedAt: now });
  const adopted = await io.loadRecord(made.id);
  if (!adopted) return { ok: false, reason: "error", error: `Saved “${name}”, but couldn’t reopen it. Find it in your Library.` };
  const sources = Array.isArray(adopted.sources) ? adopted.sources : [];
  return {
    ok: true, switchedTo: { id: made.id, name, linkRecorded: !!(link && link.ok), fromName: state.name },
    state: { id: made.id, record: adopted, name, source: sources[0], prior: sources.slice(1), inPlace: true, sessionSrcId: null },
  };
}
