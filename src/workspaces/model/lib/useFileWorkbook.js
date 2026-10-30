/* useFileWorkbook — the React side of "a Library spreadsheet file open in Spreadsheet" (NEW-1).
 *
 * All the RULES live in lib/fileWorkbook.js (pure, injected I/O, unit-tested); this hook only owns
 * the timing: load on open, an on-device draft on every edit, a debounced save to the Library,
 * serialized so two saves never overlap, and the status the header's save badge shows. It hands the
 * loaded workbook to the caller (`onLoaded`) instead of owning the workbook, because ModelApp's
 * undo-tracked `workbook` state is shared by all three modes (project / organization / file).
 *
 * Statuses (the same vocabulary modelSaveState.js already maps): idle · saving · error · conflict.
 * A failed save is never silent: `saveError` carries the reason shown in the bar, the edits stay in
 * the on-device draft, and the next edit (or Retry) tries again.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { openFileWorkbook, saveFileWorkbook, openingNotes } from "./fileWorkbook.js";
import { libraryFileIO } from "./fileWorkbookStore.js";
import { migrateWorkbook } from "./sheetModel.js";
import { readFileDraft, writeFileDraft, clearFileDraft, setAsideFileDraft, decideDraft } from "./fileDraft.js";

export const FILE_SAVE_DEBOUNCE_MS = 1500;

export function useFileWorkbook({ fileId, userId, workbook, onLoaded, onFileChanged, io = libraryFileIO, debounceMs = FILE_SAVE_DEBOUNCE_MS }) {
  const [phase, setPhase] = useState(fileId ? "loading" : "idle"); // idle | loading | ready | error
  const [error, setError] = useState(null);                       // { code, message }
  const [name, setName] = useState("");
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState("idle");                    // idle | saving | error | conflict
  const [saveError, setSaveError] = useState("");
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  const [inPlace, setInPlace] = useState(true);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [loadGen, setLoadGen] = useState(0);                      // +1 per genuine load of a file (never when the hook re-points itself at its own copy) — NEW-2: the Univer grid's scope
  const [hasOriginal, setHasOriginal] = useState(false);              // an earlier stored version (the upload) exists to download

  const stateRef = useRef(null);       // fileWorkbook.js state (record/source/prior/sessionSrcId)
  const baselineRef = useRef(null);    // the workbook object last loaded or saved — anything else is an unsaved edit
  const wbRef = useRef(workbook);
  wbRef.current = workbook;
  const loadTok = useRef(0);
  const cancelOpen = useCallback(() => { loadTok.current += 1; }, []); // a stale open must never land over a newer one
  const adoptedRef = useRef(null);     // a file id THIS hook switched to itself — no reload needed
  const savingRef = useRef(null);      // the in-flight save promise
  const timerRef = useRef(0);
  const userRef = useRef(userId); userRef.current = userId;
  const onLoadedRef = useRef(onLoaded); onLoadedRef.current = onLoaded;
  const onChangedRef = useRef(onFileChanged); onChangedRef.current = onFileChanged;

  /* ---- open ---- */
  useEffect(() => {
    clearTimeout(timerRef.current);
    // Moving to a DIFFERENT file with edits still unsaved: start their upload now (they are also in the on-device
    // draft, so a failure here is recovered the next time that file opens — never lost).
    const leaving = stateRef.current;
    if (leaving && fileId !== leaving.id && adoptedRef.current !== fileId && wbRef.current !== baselineRef.current) {
      saveFileWorkbook(leaving, wbRef.current, io, { by: "" }).catch(() => {});
    }
    const tok = ++loadTok.current;
    setError(null); setStatus("idle"); setSaveError(""); setCloudConfirmed(false);
    if (!fileId) { stateRef.current = null; baselineRef.current = null; setPhase("idle"); setNotes([]); setName(""); return undefined; }
    if (adoptedRef.current === fileId && stateRef.current && stateRef.current.id === fileId) { adoptedRef.current = null; setCloudConfirmed(true); setPhase("ready"); return undefined; }
    setPhase("loading");
    (async () => {
      try {
        const opened = await openFileWorkbook(fileId, io);
        if (tok !== loadTok.current) return;
        let wb = opened.workbook;
        const extra = [];
        const draft = readFileDraft(userRef.current, opened.id);
        const verdict = decideDraft(draft, opened.source.srcId);
        if (verdict === "restore") { wb = migrateWorkbook(draft.workbook); extra.push({ key: "restored", text: "Restored edits you made on this device that hadn’t finished saving to your Library." }); }
        else if (verdict === "stale") { setAsideFileDraft(userRef.current, opened.id); extra.push({ key: "stale-draft", text: "This file was saved from somewhere else after the edits kept on this device, so the file’s version is showing. The earlier on-device edits were set aside, not deleted." }); }
        stateRef.current = { id: opened.id, record: opened.record, name: opened.name, source: opened.source, prior: opened.prior, inPlace: opened.inPlace, sessionSrcId: null };
        baselineRef.current = opened.workbook;
        setName(opened.name); setInPlace(opened.inPlace); setHasOriginal(opened.prior.length > 0);
        setNotes([...openingNotes(opened), ...extra]);
        if (opened.id !== fileId) { adoptedRef.current = opened.id; onChangedRef.current && onChangedRef.current(opened.id, opened.name); }
        onLoadedRef.current(wb);
        setCloudConfirmed(true);
        setLoadGen((g) => g + 1);
        setPhase("ready");
      } catch (e) {
        if (tok !== loadTok.current) return;
        stateRef.current = null;
        setError({ code: (e && e.code) || "error", message: (e && e.message) || "Couldn’t open this file." });
        setPhase("error");
      }
    })();
    return cancelOpen;
  }, [fileId, userId, reloadNonce, io, cancelOpen]);

  /* ---- save ---- */
  const runSave = useCallback(async () => {
    if (savingRef.current) return savingRef.current;
    const st = stateRef.current;
    const target = wbRef.current;
    if (!st || target === baselineRef.current) return null;
    const p = (async () => {
      setStatus("saving");
      const res = await saveFileWorkbook(st, target, io, { by: "" });
      savingRef.current = null;
      if (!res.ok) { setStatus(res.reason === "conflict" ? "conflict" : "error"); setSaveError(res.error || "Couldn’t save to your Library."); return res; }
      const prevId = st.id;
      stateRef.current = res.state;
      baselineRef.current = target;
      setHasOriginal(res.state.prior.length > 0);
      setSaveError(""); setStatus("idle"); setCloudConfirmed(true);
      if (res.switchedTo) {
        adoptedRef.current = res.switchedTo.id;
        clearFileDraft(userRef.current, prevId);
        setName(res.switchedTo.name); setInPlace(true);
        setNotes([{ key: "copy-made", text: `Saved your edits as “${res.switchedTo.name}” in your Library. “${res.switchedTo.fromName}” is unchanged.${res.switchedTo.linkRecorded ? "" : " (The link from the original to this copy couldn’t be recorded, so open the .xlsx copy from the Library next time.)"}` }]);
        onChangedRef.current && onChangedRef.current(res.switchedTo.id, res.switchedTo.name);
      }
      if (wbRef.current !== target) { // edited while saving: the draft now sits on the NEW version, and another save follows
        writeFileDraft(userRef.current, res.state.id, res.state.source.srcId, wbRef.current);
        timerRef.current = setTimeout(runSave, 0);
      } else clearFileDraft(userRef.current, res.state.id);
      return res;
    })();
    savingRef.current = p;
    return p;
  }, [io]);

  useEffect(() => {
    if (phase !== "ready" || !stateRef.current) return undefined;
    if (workbook === baselineRef.current) return undefined; // loaded or saved as-is
    const st = stateRef.current;
    writeFileDraft(userRef.current, st.id, st.source.srcId, workbook); // synchronous, every edit
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(runSave, debounceMs);
    return () => clearTimeout(timerRef.current);
  }, [workbook, phase, runSave, debounceMs]);

  // A tab going to the background is the last reliable moment to start the upload.
  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") runSave(); };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", runSave);
    return () => { document.removeEventListener("visibilitychange", flush); window.removeEventListener("pagehide", runSave); };
  }, [runSave]);

  /** Save right now and resolve true when nothing unsaved remains (used before closing the file). */
  const flush = useCallback(async () => {
    clearTimeout(timerRef.current);
    for (let i = 0; i < 5; i++) { // edits made while a save is in flight need another pass
      if (savingRef.current) await savingRef.current;
      if (wbRef.current === baselineRef.current) return true;
      const r = await runSave();
      if (!r || !r.ok) return false;
    }
    return wbRef.current === baselineRef.current;
  }, [runSave]);

  /** Drop to the Library's version (the on-device edits are set aside, not deleted) — the way out of a conflict. */
  const reloadFromLibrary = useCallback(() => {
    const st = stateRef.current;
    if (st) setAsideFileDraft(userRef.current, st.id);
    baselineRef.current = null;
    setReloadNonce((n) => n + 1);
  }, []);

  /** The file exactly as first uploaded (the oldest stored version) — the way back to it. { blob, name } | null. */
  const downloadOriginal = useCallback(async () => {
    const st = stateRef.current;
    const oldest = st && st.prior.length ? st.prior[st.prior.length - 1] : null;
    if (!oldest) return null;
    const bytes = await io.readBytes(oldest);
    return bytes ? { blob: new Blob([bytes]), name: oldest.name || st.name } : null;
  }, [io]);

  const hasUnsaved = useCallback(() => wbRef.current !== baselineRef.current, []);

  /** NEW-2 — the Univer grid hands over its newest workbook the moment it flushes (leaving the file, closing the tab, the
   *  grid toggle), BEFORE React has rendered it back as `workbook`. Take it into the refs and the on-device draft
   *  synchronously, so a save that starts in the same breath (the leaving-file upload, `flush`, pagehide) uploads the last
   *  edit and a failure is recovered from the draft next time. `forFileId` guards a late call for a file no longer open. */
  const noteWorkbookNow = useCallback((wb, forFileId) => {
    const st = stateRef.current;
    if (!st || (forFileId && st.id !== forFileId && adoptedRef.current !== st.id)) return false;
    wbRef.current = wb;
    if (wb !== baselineRef.current) writeFileDraft(userRef.current, st.id, st.source.srcId, wb);
    return true;
  }, []);

  return {
    phase, error, name, notes, status, saveError, cloudConfirmed, inPlace, hasOriginal, downloadOriginal,
    retrySave: runSave, flush, reloadFromLibrary, hasUnsaved,
    noteWorkbookNow, loadGen,
    retryOpen: useCallback(() => setReloadNonce((n) => n + 1), []),
  };
}
