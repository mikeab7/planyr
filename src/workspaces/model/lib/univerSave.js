/* Model workspace — the Univer grid's SAVE CONTROLLER (NEW-2, 2026-10-30; docs/SPREADSHEET-UNIVER-SPIKE.md "Save path").
 *
 * Pure: imports nothing from Univer or React. UniverSheet.jsx feeds it a `snapshot()` (Univer → Planyr workbook) and an
 * `emit()` (ModelApp's ONE commit), and every way of leaving the grid funnels through `flush()`.
 *
 * WHY THIS IS ONE OBJECT AND NOT A TIMER IN A COMPONENT. An edit in Univer is only a Planyr workbook after a debounce
 * (so a held key doesn't snapshot a whole workbook per keystroke). That left a window — up to SAVE_DEBOUNCE_MS — in which
 * the edit existed only inside Univer. Anything that read the saved workbook in that window (Export, a project switch, the
 * grid toggle, closing the tab, unmounting) missed it, and the unmount path flushed AFTER marking itself disposed, which
 * made its own flush a no-op. The rules, all pinned by test/modelUniverSave.test.js:
 *   · flush() is SYNCHRONOUS and IDEMPOTENT: it saves what is pending now, and calling it again with nothing new changes
 *     nothing and emits nothing (the echo guard: `lastJson` is what we last emitted or were built from).
 *   · flush() returns the workbook as it is NOW (the edit included), so Export can use it without waiting for React.
 *   · dispose() flushes FIRST, then stops — never the other way round.
 *   · a failure is never silent: `report` is called, the edit stays pending (the next flush retries), and the controller
 *     keeps working. */

export const SAVE_DEBOUNCE_MS = 300;

/** @param {{
 *   snapshot: () => { workbook: object, notes?: string[] },
 *   emit: (workbook: object, notes: string[], meta: { urgent: boolean }) => void,
 *   canonical: (workbook: object) => string,
 *   report?: (err: unknown, stage: "snapshot" | "emit") => void,
 *   debounceMs?: number, setTimer?: Function, clearTimer?: Function,
 * }} deps */
export function createSaveController(deps) {
  const { snapshot, emit, canonical, report = () => {}, debounceMs = SAVE_DEBOUNCE_MS } = deps;
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer || ((t) => clearTimeout(t));
  let timer = 0;
  let disposed = false;
  let lastJson = null;      // canonical JSON of the workbook last emitted, or last built the grid from
  let lastWorkbook = null;  // that workbook
  let pending = false;      // a mutation happened since the last successful flush
  const inflight = [];      // emitted, but not yet seen coming back down as the host's `workbook` prop (oldest first)

  const cancelTimer = () => { if (timer) { clearTimer(timer); timer = 0; } };

  /** The grid was (re)built from `workbook` — at mount, or when it changed from OUTSIDE (a cloud load, an opened file).
   *  Whatever was pending belonged to the content that just got replaced. */
  function baseline(workbook) {
    cancelTimer(); pending = false; inflight.length = 0;
    lastWorkbook = workbook; lastJson = canonical(workbook);
  }

  /** The host's `workbook` prop changed to `json`: is that one of OUR saves coming back (ignore it), or a change from
   *  outside (rebuild the grid)? Two flushes can land before React renders the first, so it is a queue, not one value —
   *  matching only the latest would rebuild the grid to the older save and visibly undo the newer edit. */
  function isOwnEcho(json) {
    if (json === lastJson) { inflight.length = 0; return true; }
    const i = inflight.indexOf(json);
    if (i >= 0) { inflight.splice(0, i + 1); return true; }
    return false;
  }

  /** A mutation happened in Univer: save after the debounce. */
  function schedule() {
    if (disposed) return;
    pending = true;
    cancelTimer();
    timer = setTimer(() => { timer = 0; flush(); }, debounceMs);
  }

  /** Save what is pending NOW. `urgent` tells the host the page may be going away (so it must persist synchronously, not
   *  wait for React to render). Always returns `{ workbook, changed, ok }` — `workbook` is the up-to-date Planyr workbook. */
  function flush({ urgent = false } = {}) {
    cancelTimer();
    if (disposed) return { workbook: lastWorkbook, changed: false, ok: true };
    let snap;
    try { snap = snapshot(); }
    catch (err) { pending = true; report(err, "snapshot"); return { workbook: lastWorkbook, changed: false, ok: false }; }
    if (!snap || !snap.workbook) return { workbook: lastWorkbook, changed: false, ok: true };
    const json = canonical(snap.workbook);
    if (json === lastJson) { pending = false; return { workbook: lastWorkbook, changed: false, ok: true }; }
    const prev = { json: lastJson, workbook: lastWorkbook };
    lastJson = json; lastWorkbook = snap.workbook; pending = false; inflight.push(json);
    try { emit(snap.workbook, snap.notes || [], { urgent }); }
    catch (err) { // the host refused: keep the edit pending so the next flush offers it again
      lastJson = prev.json; lastWorkbook = prev.workbook; pending = true; inflight.pop();
      report(err, "emit");
      return { workbook: snap.workbook, changed: false, ok: false };
    }
    return { workbook: snap.workbook, changed: true, ok: true };
  }

  /** Flush, THEN stop. (The old unmount path set its disposed flag first, which silently turned its own flush into a no-op.) */
  function dispose() {
    const r = flush({ urgent: true });
    cancelTimer(); disposed = true;
    return r;
  }

  return {
    baseline, schedule, flush, dispose, isOwnEcho,
    hasPending: () => pending || !!timer,
    current: () => lastWorkbook,
    isDisposed: () => disposed,
  };
}
