/* NEW-1 / NEW-2 (2026-10-12) — the ONE file-drag tracker.
 *
 * Owner reports: (1) dropping an .xlsx on the Library made Chrome DOWNLOAD it (a drop on any spot with no
 * handler is the browser's own); (2) after that the "Drop to add a site plan" overlay stayed on the Map
 * forever (per-element enter/leave counters strand when no matching dragleave fires).
 *
 * The property: the overlay state is true only for a Files drag, and EVERY way a drag can end clears it;
 * the browser default is cancelled for dragover AND drop of a Files drag, and for nothing else.
 * Driven on a fake window (the module is DOM-free), with a source guard on each consumer — the defect is
 * the ABSENCE of a wire, which a unit test of the module cannot see.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  installFileDragGuard, fileDragActive, clearFileDrag, isFileDrag, subscribeFileDrag,
  markDropHandled, dropWasHandled, DRAG_WATCHDOG_MS, LEAVE_GRACE_MS,
} from "../src/shared/files/fileDrag.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

class FakeWin extends EventTarget {
  constructor() { super(); this.document = Object.assign(new EventTarget(), { visibilityState: "visible" }); }
}
const ev = (type, extra = {}) => Object.assign(new Event(type, { cancelable: true, bubbles: true }), extra);
const files = { types: ["Files"] };
const text = { types: ["text/plain"] };

let win, off;
beforeEach(() => { vi.useFakeTimers(); win = new FakeWin(); off = installFileDragGuard(win); });
afterEach(() => { off(); vi.useRealTimers(); });

const raise = () => { win.dispatchEvent(ev("dragenter", { dataTransfer: files })); win.dispatchEvent(ev("dragover", { dataTransfer: files })); };

describe("what raises it", () => {
  it("a Files drag raises it; a text / map-feature drag never does", () => {
    win.dispatchEvent(ev("dragenter", { dataTransfer: text }));
    win.dispatchEvent(ev("dragover", { dataTransfer: text }));
    expect(fileDragActive()).toBe(false);
    raise();
    expect(fileDragActive()).toBe(true);
  });
  it("isFileDrag tolerates a missing / odd dataTransfer", () => {
    expect(isFileDrag(null)).toBe(false);
    expect(isFileDrag({})).toBe(false);
    expect(isFileDrag({ dataTransfer: { types: null } })).toBe(false);
    expect(isFileDrag({ dataTransfer: files })).toBe(true);
  });
});

describe("EVERY way a drag ends clears it (the stuck-overlay report)", () => {
  const cases = {
    "drag leaves the window (relatedTarget null)": () => { win.dispatchEvent(ev("dragleave", { dataTransfer: files, relatedTarget: null })); vi.advanceTimersByTime(LEAVE_GRACE_MS + 5); },
    "a drop anywhere": () => win.dispatchEvent(ev("drop", { dataTransfer: files })),
    "a drop that fails / is rejected (no handler took it)": () => win.dispatchEvent(ev("drop", { dataTransfer: { types: ["Files"], files: [] } })),
    "dragend": () => win.dispatchEvent(ev("dragend")),
    "Escape": () => win.dispatchEvent(ev("keydown", { key: "Escape" })),
    "window blur": () => win.dispatchEvent(ev("blur")),
    "a mousemove with no drag in progress": () => win.dispatchEvent(ev("mousemove")),
    "a pointerdown": () => win.dispatchEvent(ev("pointerdown")),
    "the tab hiding": () => { win.document.visibilityState = "hidden"; win.document.dispatchEvent(ev("visibilitychange")); },
    "a view change (hashchange)": () => win.dispatchEvent(ev("hashchange")),
    "back/forward (popstate)": () => win.dispatchEvent(ev("popstate")),
    "pagehide": () => win.dispatchEvent(ev("pagehide")),
    "NOTHING at all — dragenter + dragover and then silence (the measured stuck case)": () => vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 5),
  };
  for (const [name, end] of Object.entries(cases)) {
    it(name, () => { raise(); expect(fileDragActive()).toBe(true); end(); expect(fileDragActive()).toBe(false); });
  }
  it("an in-page transition (dragleave with a relatedTarget, or a null one followed by dragover) does NOT flicker it off", () => {
    raise();
    win.dispatchEvent(ev("dragleave", { dataTransfer: files, relatedTarget: {} }));
    expect(fileDragActive()).toBe(true);
    win.dispatchEvent(ev("dragleave", { dataTransfer: files, relatedTarget: null }));
    vi.advanceTimersByTime(LEAVE_GRACE_MS / 2);
    win.dispatchEvent(ev("dragover", { dataTransfer: files }));      // Chromium's null-relatedTarget hop, then the next dragover
    vi.advanceTimersByTime(LEAVE_GRACE_MS * 2);
    expect(fileDragActive()).toBe(true);
  });
  it("a live drag keeps itself alive past the watchdog while dragover keeps arriving", () => {
    raise();
    for (let i = 0; i < 10; i++) { vi.advanceTimersByTime(DRAG_WATCHDOG_MS / 2); win.dispatchEvent(ev("dragover", { dataTransfer: files })); }
    expect(fileDragActive()).toBe(true);
  });
  it("a zone that stopPropagation()s a drop cannot hide it from the tracker (capture phase)", () => {
    raise();
    const zone = new EventTarget();
    // simulate: the event is stopped below the window — the tracker listens in capture, so it already ran
    win.addEventListener("drop", (e) => e.stopPropagation(), false);
    win.dispatchEvent(ev("drop", { dataTransfer: files }));
    expect(fileDragActive()).toBe(false);
    void zone;
  });
});

describe("the browser default is cancelled — dragover AND drop — for a Files drag only", () => {
  it("dragover + drop of a Files drag are preventDefault()ed at the window", () => {
    const over = ev("dragover", { dataTransfer: files }); win.dispatchEvent(over);
    const drop = ev("drop", { dataTransfer: files }); win.dispatchEvent(drop);
    expect(over.defaultPrevented).toBe(true);
    expect(drop.defaultPrevented).toBe(true);
  });
  it("an in-page text drag is left alone", () => {
    const over = ev("dragover", { dataTransfer: text }); win.dispatchEvent(over);
    const drop = ev("drop", { dataTransfer: text }); win.dispatchEvent(drop);
    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
  });
});

describe("plumbing", () => {
  it("subscribers hear raise and clear exactly once each; a throwing subscriber breaks nothing", () => {
    const seen = []; const un = subscribeFileDrag(() => seen.push(fileDragActive()));
    subscribeFileDrag(() => { throw new Error("boom"); });
    raise(); raise(); clearFileDrag(); clearFileDrag();
    expect(seen).toEqual([true, false]);
    un();
  });
  it("installing twice is a no-op; uninstalling clears and detaches", () => {
    expect(installFileDragGuard(win)).toBeTypeOf("function");
    raise(); off();
    expect(fileDragActive()).toBe(false);
    raise();                       // detached: nothing listens any more
    expect(fileDragActive()).toBe(false);
    off = installFileDragGuard(win);
  });
  it("markDropHandled sees through a React synthetic event to its native one", () => {
    const native = ev("drop"); const synthetic = { nativeEvent: native };
    markDropHandled(synthetic);
    expect(dropWasHandled(native)).toBe(true);
    expect(dropWasHandled(ev("drop"))).toBe(false);
  });
});

describe("wiring (the defect is a MISSING wire — a unit test of the module cannot see it)", () => {
  it("the guard is armed at boot", () => {
    expect(read("src/main.jsx")).toMatch(/installFileDragGuard\(\)/);
  });
  it("no surface keeps its own enter/leave depth counter for the overlay any more", () => {
    expect(read("src/workspaces/library/components/FileBrowser.jsx")).not.toMatch(/dragDepth/);
    expect(read("src/workspaces/doc-review/DocReview.jsx")).not.toMatch(/dragDepth/);
    expect(read("src/workspaces/site-planner/MapFinder.jsx")).not.toMatch(/fileDragDepth/);
  });
  it("the Map's window-level drop handler is gated on the ACTIVE workspace, not just its map mode (the hidden-view leak)", () => {
    const mf = read("src/workspaces/site-planner/MapFinder.jsx");
    expect(mf).toMatch(/const dropLive = !!\(visible && isActive\)/);
    expect(mf).toMatch(/useFileDragActive\(dropLive\)/);
    expect(mf).not.toMatch(/if \(!visible \|\| !isFileDrag\(e\)\) return;/);
  });
  it("Library, Map, Site and Review read the shared tracker", () => {
    expect(read("src/workspaces/library/components/FileBrowser.jsx")).toMatch(/useFileDragActive\(isActive\)/);
        expect(read("src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/useFileDragActive\(true\)/);
    expect(read("src/workspaces/doc-review/DocReview.jsx")).toMatch(/useFileDragActive\(isActive && !narrow\)/);
  });
  it("the Library catches a drop ANYWHERE on its view (window level) and the home refuses out loud", () => {
    const fb = read("src/workspaces/library/components/FileBrowser.jsx");
    expect(fb).toMatch(/window\.addEventListener\("drop"/);
    expect(fb).toMatch(/dropInto\(dropTargetFolder\(\), e\.dataTransfer\)/);
    expect(fb).toMatch(/data-testid="library-drop-notice"/);
    expect(read("src/workspaces/library/Library.jsx")).toMatch(/library-home-drop-notice/);
  });
  it("the Site canvas names a file it cannot take instead of letting the browser have it", () => {
    expect(read("src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/Couldn't add “\$\{f\.name\}” — drop a PDF, DXF, DWG or image/);
  });
});
