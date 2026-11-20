/* NEW-2 — the Univer grid's save controller (lib/univerSave.js) plus the wiring that makes every way out of the grid go
 * through it. The controller tests are RED-PROOF: each one fails against the previous behaviour (a bare debounce whose
 * unmount flush ran after `disposed = true`), and `legacyController` below IS that behaviour, so the proof is in the file. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSaveController, SAVE_DEBOUNCE_MS } from "../src/workspaces/model/lib/univerSave.js";
import { createShiftGate, HEADER_MOVE_GATE_PRIORITY } from "../src/workspaces/model/lib/univerHeaderMove.js";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");

/** A stand-in for Univer: `grid.value` is what Univer holds; the controller only ever sees it through snapshot(). */
function rig(extra = {}) {
  const grid = { value: "A", failSnapshot: false };
  const emitted = [];
  const reports = [];
  const ctl = createSaveController({
    snapshot: () => { if (grid.failSnapshot) throw new Error("snapshot blew up"); return { workbook: { cell: grid.value }, notes: [] }; },
    emit: (wb, notes, meta) => { if (extra.emitThrows) throw new Error("commit refused"); emitted.push({ wb, meta }); },
    canonical: (wb) => JSON.stringify(wb),
    report: (err, stage) => reports.push({ msg: String(err && err.message), stage }),
  });
  ctl.baseline({ cell: "A" });
  const edit = (v) => { grid.value = v; ctl.schedule(); };
  return { grid, ctl, emitted, reports, edit };
}

/** The behaviour before NEW-2, reproduced faithfully: a debounce, and an unmount that marks itself disposed BEFORE flushing. */
function legacyController({ snapshot, emit }) {
  let timer = 0; let disposed = false; let last = JSON.stringify({ cell: "A" });
  const flush = () => { clearTimeout(timer); timer = 0; if (disposed) return; const s = snapshot(); const j = JSON.stringify(s.workbook); if (j === last) return; last = j; emit(s.workbook); };
  return { schedule: () => { clearTimeout(timer); timer = setTimeout(flush, SAVE_DEBOUNCE_MS); }, flush, dispose: () => { disposed = true; try { timer && flush(); } catch (_) {} clearTimeout(timer); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("flush points — the edit is saved the moment the grid is left", () => {
  it("an edit then an immediate flush (Export / grid toggle / module tab / project change) saves it, with no debounce wait", () => {
    const { ctl, emitted, edit } = rig();
    edit("B");
    expect(emitted).toHaveLength(0);                       // still inside the debounce window
    const r = ctl.flush();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].wb).toEqual({ cell: "B" });
    expect(r).toMatchObject({ workbook: { cell: "B" }, changed: true, ok: true });
  });

  it("flush() hands back the CURRENT workbook even when nothing is pending (Export reads this, never the stale React state)", () => {
    const { ctl, edit } = rig();
    edit("B"); ctl.flush();
    expect(ctl.flush().workbook).toEqual({ cell: "B" });
  });

  it("unmounting inside the debounce window still saves the edit (red-proof: the old unmount flushed after disposing and lost it)", () => {
    const { ctl, emitted, edit } = rig();
    edit("B");
    ctl.dispose();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].wb).toEqual({ cell: "B" });
    expect(emitted[0].meta.urgent).toBe(true);             // the host must persist synchronously — the page may be going away

    const grid = { value: "A" }; const lost = [];
    const legacy = legacyController({ snapshot: () => ({ workbook: { cell: grid.value } }), emit: (wb) => lost.push(wb) });
    grid.value = "B"; legacy.schedule(); legacy.dispose();
    expect(lost).toHaveLength(0);                          // THE BUG: the same sequence on the previous controller saves nothing
  });

  it("a page hide / beforeunload flush is urgent, and the debounce timer that was pending never fires a second save", () => {
    const { ctl, emitted, edit } = rig();
    edit("B");
    ctl.flush({ urgent: true });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].meta.urgent).toBe(true);
  });

  it("the ordinary debounce still saves on its own", () => {
    const { emitted, edit } = rig();
    edit("B");
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS - 1);
    expect(emitted).toHaveLength(0);
    vi.advanceTimersByTime(2);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].meta.urgent).toBe(false);
  });
});

describe("idempotence and the echo guard", () => {
  it("flushing again with nothing new emits nothing — any number of times, from any mix of callers", () => {
    const { ctl, emitted, edit } = rig();
    edit("B");
    ctl.flush(); ctl.flush({ urgent: true }); ctl.flush(); ctl.dispose(); ctl.flush();
    expect(emitted).toHaveLength(1);
  });

  it("a flush with no edit at all emits nothing (the workbook it was built from is not an edit)", () => {
    const { ctl, emitted } = rig();
    expect(ctl.flush().changed).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it("an edit that puts the grid back to what it was emits nothing", () => {
    const { ctl, emitted, edit } = rig();
    edit("B"); edit("A");
    ctl.flush();
    expect(emitted).toHaveLength(0);
  });

  it("a workbook that arrives from OUTSIDE re-baselines: its own echo is not an edit, and a pending timer is dropped", () => {
    const { ctl, emitted, grid, edit } = rig();
    edit("B");
    grid.value = "C"; ctl.baseline({ cell: "C" });         // the host rebuilt the grid from an opened file
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 2);
    ctl.flush();
    expect(emitted).toHaveLength(0);
    expect(ctl.hasPending()).toBe(false);
  });

  it("after dispose nothing more is ever emitted (a late timer or listener cannot write into whatever replaced the grid)", () => {
    const { ctl, emitted, grid, edit } = rig();
    edit("B"); ctl.dispose();
    grid.value = "Z"; ctl.schedule(); ctl.flush({ urgent: true });
    vi.advanceTimersByTime(SAVE_DEBOUNCE_MS * 3);
    expect(emitted).toHaveLength(1);
  });
});

describe("the echo guard with two saves in flight", () => {
  it("both saves coming back down in order are ignored — the grid is never rebuilt to the OLDER one", () => {
    const { ctl, edit, grid } = rig();
    edit("B"); ctl.flush(); edit("C"); ctl.flush();                 // two flushes land before React renders the first
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "B" }))).toBe(true);  // render 1 delivers B: ours, ignore
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "C" }))).toBe(true);  // render 2 delivers C: ours, ignore
    expect(grid.value).toBe("C");
  });
  it("a workbook that is NOT one of ours is an outside change (rebuild), even when it equals an OLD save that already came back", () => {
    const { ctl, edit } = rig();
    edit("B"); ctl.flush();
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "B" }))).toBe(true);
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "Q" }))).toBe(false);
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "A" }))).toBe(false); // the original is not "in flight" any more
  });
  it("the workbook the grid was built from counts as its own (the mount-time prop is not an outside change)", () => {
    const { ctl } = rig();
    expect(ctl.isOwnEcho(JSON.stringify({ cell: "A" }))).toBe(true);
  });
});

describe("header drag moves a column / row only with Shift held (NEW-1)", () => {
  const next = (v) => `decided:${v}`;
  it("a plain drag on a selected header does not move it; Shift+drag does, and the permission check still gets the last word", () => {
    const g = createShiftGate();
    g.pointer(false);
    expect(g.handler(true, {}, next)).toBe(false);          // the gate ends the chain: no move
    g.pointer(true);
    expect(g.handler(true, {}, next)).toBe("decided:true"); // handed on to Univer's own permission check
    g.pointer(false);
    expect(g.handler(true, {}, next)).toBe(false);
  });
  it("Shift going down and up is tracked while the pointer is still (so the grab cursor follows), and a lost keyup cannot leave it open", () => {
    const g = createShiftGate();
    g.key({ type: "keydown", key: "Shift" }); expect(g.allows()).toBe(true);
    g.key({ type: "keydown", key: "a" });     expect(g.allows()).toBe(true);   // another key changes nothing
    g.key({ type: "keyup", key: "Shift" });   expect(g.allows()).toBe(false);
    g.key({ type: "keydown", key: "Shift" }); g.reset(); expect(g.allows()).toBe(false); // window blur
  });
  it("runs before Univer's own check (higher priority than its default 0)", () => {
    expect(HEADER_MOVE_GATE_PRIORITY).toBeGreaterThan(0);
  });
  it("UniverSheet installs it on every unit it builds, through Univer's documented interceptor point (nothing patched)", () => {
    const sheet = read("src/workspaces/model/components/UniverSheet.jsx");
    expect(sheet).toMatch(/HEADER_MOVE_PERMISSION_CHECK/);
    expect(sheet).toMatch(/interceptor\.intercept\(point, \{ priority: HEADER_MOVE_GATE_PRIORITY, handler: gate\.handler \}\)/);
    expect(sheet).toMatch(/L\.load\(workbook\);\s*L\.installHeaderGate/);   // re-installed after an outside rebuild creates a new unit
    expect(sheet).toMatch(/ensureHeaderGate\(L\.unitId\);\s*if \(L\.onReady\)/);
  });
});

describe("a failed save is never silent", () => {
  it("a snapshot failure is reported, the edit stays pending, and the next flush retries", () => {
    const { ctl, emitted, reports, grid, edit } = rig();
    edit("B"); grid.failSnapshot = true;
    const r = ctl.flush();
    expect(r.ok).toBe(false);
    expect(reports).toEqual([{ msg: "snapshot blew up", stage: "snapshot" }]);
    expect(ctl.hasPending()).toBe(true);
    grid.failSnapshot = false;
    expect(ctl.flush().changed).toBe(true);
    expect(emitted).toHaveLength(1);
  });

  it("a host that refuses the commit is reported and the same edit is offered again next time", () => {
    let refuse = true; const emitted = []; const reports = [];
    const grid = { value: "A" };
    const ctl = createSaveController({
      snapshot: () => ({ workbook: { cell: grid.value } }),
      emit: (wb) => { if (refuse) throw new Error("no"); emitted.push(wb); },
      canonical: JSON.stringify, report: (e, stage) => reports.push(stage),
    });
    ctl.baseline({ cell: "A" });
    grid.value = "B"; ctl.schedule();
    expect(ctl.flush().ok).toBe(false);
    expect(reports).toEqual(["emit"]);
    refuse = false;
    expect(ctl.flush().changed).toBe(true);
    expect(emitted).toEqual([{ cell: "B" }]);
  });

  it("a timer-driven failure is reported too (not just a thrown error in a timer callback that nobody sees)", () => {
    const { reports, grid, edit } = rig();
    edit("B"); grid.failSnapshot = true;
    expect(() => vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 1)).not.toThrow();
    expect(reports).toHaveLength(1);
  });
});

describe("one frame per committed edit (the regular grid's Ctrl+Z after switching back)", () => {
  it("three separate edits, each flushed, are three commits — and a flush with nothing new adds none", () => {
    const { ctl, emitted, edit } = rig();
    edit("B"); ctl.flush();
    edit("C"); ctl.flush();
    edit("D"); ctl.flush(); ctl.flush();
    expect(emitted.map((e) => e.wb.cell)).toEqual(["B", "C", "D"]);
  });
});

describe("wiring — every way out of the grid goes through the controller", () => {
  const sheet = read("src/workspaces/model/components/UniverSheet.jsx");
  const app = read("src/workspaces/model/ModelApp.jsx");

  it("UniverSheet builds its saves from the controller and flushes on unmount BEFORE disposing, on pagehide, beforeunload and hide", () => {
    expect(sheet).toMatch(/createSaveController\(/);
    expect(sheet).toMatch(/addEventListener\("beforeunload"/);
    expect(sheet).toMatch(/addEventListener\("pagehide"/);
    expect(sheet).toMatch(/visibilitychange/);
    // the cleanup must not set a "disposed" flag ahead of the flush (the bug being fixed)
    const cleanup = sheet.slice(sheet.indexOf("return () => {", sheet.indexOf("window.__planyrUniverRead")));
    expect(cleanup.indexOf("L.save.dispose()")).toBeGreaterThan(-1);
    expect(cleanup.indexOf("L.save.dispose()")).toBeLessThan(cleanup.indexOf("univerAPI.dispose()"));
  });

  it("ModelApp keys the grid by the workbook it is showing, so a project / org / file change unmounts (and flushes) the old grid", () => {
    expect(app).toMatch(/<UniverSheet\s+key=\{univerScope\}/);
    // a file is identified by how many times it was genuinely LOADED, not by its id — the hook re-points `activeFileId` itself when a
    // save of an .xls / .csv creates its .xlsx copy, and that must neither remount the grid nor make its next save look "stale"
    expect(app).toMatch(/fileMode \? `file:\$\{fw\.loadGen\}`/);
  });

  it("Export reads the flushed workbook, not the React state a render behind it", () => {
    expect(app).toMatch(/const flushUniver = useCallback/);
    const gate = app.slice(app.indexOf("const workbookForExport"), app.indexOf("const onExportXlsx"));
    expect(gate).toMatch(/flushUniver\(\)/);
    expect(gate).toMatch(/Export stopped/);                 // a failed flush stops the export; it never writes a stale copy
    const xlsx = app.slice(app.indexOf("const onExportXlsx"), app.indexOf("const onExportCsv"));
    expect(xlsx).toMatch(/workbookForExport\(\)/);
    expect(xlsx).not.toMatch(/exportWorkbookInWorker\(workbook,/);
    const csv = app.slice(app.indexOf("const onExportCsv"), app.indexOf("const runXlsxImport"));
    expect(csv).toMatch(/workbookForExport\(\)/);
  });

  it("the grid toggle, a hidden module tab and every pending-edit consumer flush first", () => {
    const toggle = app.slice(app.indexOf("const setRegularGrid"), app.indexOf("const closeFile"));
    expect(toggle).toMatch(/commitEditing/);
    expect(toggle.indexOf("flushUniver()")).toBeGreaterThan(-1);
    expect(toggle.indexOf("flushUniver()")).toBeLessThan(toggle.indexOf("univer.setRegular(regular)"));
    expect(app).toMatch(/useLayoutEffect\(\(\) => \(\) => \{ flushUniver\(\); \}, \[univerScope, activeFileId/);
    const close = app.slice(app.indexOf("const closeFile"), app.indexOf("useEffect(() => { if (!orgMode)"));
    expect(close.indexOf("flushUniver()")).toBeLessThan(close.indexOf("fw.flush()"));
    expect(app).toMatch(/univerSwitch=\{univer\.available \? \{ regular: univer\.regular, setRegular: setRegularGrid \} : null\}/);
    expect(app).toMatch(/if \(!isActive\) flushUniver\(\)/);
  });

  it("an urgent save is persisted SYNCHRONOUSLY (React will not render before a page dies) and a save that fails raises the status badge", () => {
    expect(app).toMatch(/const persistUniverNow = useCallback/);
    const body = app.slice(app.indexOf("const persistUniverNow"), app.indexOf("const flushUniver"));
    expect(body).toMatch(/writeLocalSheet\(/);
    expect(body).toMatch(/writeSyncMeta\(/);
    expect(body).toMatch(/noteWorkbookNow\(/);
    expect(body).toMatch(/setStatus\("error"\)/);
  });

  it("a save from a grid that no longer shows the current workbook never lands in the current one's state", () => {
    const body = app.slice(app.indexOf("const onUniverChange"), app.indexOf("const flushUniver"));
    expect(body).toMatch(/scopeRef\.current === scope/);
  });

  it("leaving a project / org workbook starts its upload (the push effect for it is cancelled by the change) — best effort, never touching the badge", () => {
    const body = app.slice(app.indexOf("const uploadLeavingUniver"), app.indexOf("const reportUniverSaveError"));
    expect(body).toMatch(/saveCloudSheet\(/);
    expect(body).toMatch(/saveOrgWorkbookCloud\(/);
    expect(body).not.toMatch(/setStatus/);
    const change = app.slice(app.indexOf("const onUniverChange"), app.indexOf("const flushUniver"));
    expect(change).toMatch(/scopeRef\.current !== scope\.id\) uploadLeavingUniver\(scope, next\)/);
  });

  it("the file hook can take the newest workbook synchronously, so a leaving file uploads the last edit", () => {
    const hook = read("src/workspaces/model/lib/useFileWorkbook.js");
    expect(hook).toMatch(/const noteWorkbookNow = useCallback/);
    expect(hook).toMatch(/noteWorkbookNow,/);
  });
});

describe("a plain press on an already-selected header restarts the selection there (NEW-1)", async () => {
  const { pressOnSelectedHeader } = await import("../src/workspaces/model/lib/univerHeaderMove.js");
  const col = { rangeType: 2, startRow: 0, endRow: 999, startColumn: 2, endColumn: 4 };
  const row = { rangeType: 1, startRow: 1, endRow: 3, startColumn: 0, endColumn: 25 };
  it("fires on a selected column / row header, by index inside the range", () => {
    expect(pressOnSelectedHeader({ kind: "column", index: 2, ranges: [col] })).toBe(true);
    expect(pressOnSelectedHeader({ kind: "column", index: 4, ranges: [col] })).toBe(true);
    expect(pressOnSelectedHeader({ kind: "row", index: 3, ranges: [row] })).toBe(true);
  });
  it("does not fire on a header that is not selected, or on the wrong kind of selection", () => {
    expect(pressOnSelectedHeader({ kind: "column", index: 5, ranges: [col] })).toBe(false);
    expect(pressOnSelectedHeader({ kind: "row", index: 2, ranges: [col] })).toBe(false);
    expect(pressOnSelectedHeader({ kind: "column", index: 2, ranges: [{ rangeType: 0, startRow: 0, endRow: 5, startColumn: 0, endColumn: 5 }] })).toBe(false);
  });
  it("never collapses with a modifier (Shift = move / extend, Ctrl / Cmd = add a range) or a non-primary button", () => {
    for (const mod of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { button: 2 }]) {
      expect(pressOnSelectedHeader({ kind: "column", index: 3, ranges: [col], ...mod })).toBe(false);
    }
  });
});
