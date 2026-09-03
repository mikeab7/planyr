/* B1107680 (NEW-1) — the embedded Scheduler stored per-tab, per-user VIEW state (which project is
 * selected, which grid view, column widths, sort/filter/grouping) inside the SAME versioned hs-v1
 * document as all the schedule data. Measured live on production planar_data, 2026-09-03: four
 * project switches with zero task edits bumped __rev 3948 → 3949 → 3951 → 3953 and rewrote the
 * whole ~355KB document each time, and a second tab open on a different project then rendered a
 * phantom "a newer version was saved on another device" banner from nothing but navigation.
 *
 * The fix moves the 13 offending top-level keys out of the cloud document entirely: aPid/view/
 * section (per-tab) into sessionStorage, the nine durable preferences (zoom, column widths, sort,
 * grouping, filters, health-column style) into localStorage, and editProjId (an in-progress rename)
 * is never persisted at all. This test extracts the real functions from public/sequence/index.html
 * — the same "never drift from the shipped code" pattern as test/schedulerSaveQueue.test.js — so it
 * can never pass against a stale reimplementation.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end);
}

// Structural landmarks (the block's own opening declaration and the next top-level component's
// declaration) rather than a copy of the logic — a mutation inside the block changes what gets
// extracted and evaluated, it never breaks the extraction step itself.
const viewStateSrc = sliceBetween("const VIEW_TAB_KEYS", "function App() {");

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    _map: m,
  };
}

function makeSandbox() {
  const sessionStorage = makeStorage();
  const localStorage = makeStorage();
  const fn = new Function(
    "sessionStorage", "localStorage",
    `${viewStateSrc}\nreturn { VIEW_TAB_KEYS, VIEW_PREF_KEYS, VIEW_TRANSIENT_KEYS, VIEW_STATE_KEYS, loadTabView, saveTabView, loadViewPrefs, saveViewPrefs, coreChanged, stripViewState, persistViewState, resolveViewState };`
  );
  const mod = fn(sessionStorage, localStorage);
  return { ...mod, sessionStorage, localStorage };
}

// A single stable base document — every FULL_DOC() call spreads from this SAME object, so keys not
// named in `over` keep IDENTICAL references across calls. That matches how the real app builds a
// "next" doc (setData(d => ({...d, aPid: x}))), and it's exactly what coreChanged/persistViewState
// rely on: a shallow reference-equality check is only meaningful when unrelated keys are untouched.
const BASE_DOC = {
  __rev: 42,
  nPid: 4, nTid: { 1: 12, 2: 5, 3: 179 },
  settings: { defaultSplit: 60, holidays: {} },
  projects: {
    1: { id: 1, name: "Goose Creek", tasks: [] },
    2: { id: 2, name: "Grand Port", tasks: [] },
    3: { id: 3, name: "Bain", tasks: [] },
  },
  _v6: true, _v7: true, _v8: true,
  aPid: 1, view: "split", section: "projects", editProjId: null,
  gridZoom: 1, gridColWidths: {}, masterSort: { col: "health", dir: "asc" },
  masterCols: ["name", "start"], masterColWidths: {}, masterGroupBy: null,
  masterLevelFilter: 3, masterHealthFilter: true, healthColStyle: "stoplight",
};
const FULL_DOC = (over = {}) => ({ ...BASE_DOC, ...over });

describe("VIEW_STATE_KEYS — the exact 13 keys measured on the real production hs-v1 row", () => {
  it("matches the enumerated jsonb_object_keys list from the B1107680 measurement", () => {
    const { VIEW_TAB_KEYS, VIEW_PREF_KEYS, VIEW_TRANSIENT_KEYS } = makeSandbox();
    const all = [...VIEW_TAB_KEYS, ...VIEW_PREF_KEYS, ...VIEW_TRANSIENT_KEYS].sort();
    expect(all).toEqual([
      "aPid", "editProjId", "gridColWidths", "gridZoom", "healthColStyle", "masterCols",
      "masterColWidths", "masterGroupBy", "masterHealthFilter", "masterLevelFilter",
      "masterSort", "section", "view",
    ].sort());
  });
});

describe("coreChanged — the gate that must fire on real edits and stay silent on navigation", () => {
  it("false when only per-tab keys change (the reported repro: 4 project switches, 0 task edits)", () => {
    const { coreChanged } = makeSandbox();
    const a = FULL_DOC({ aPid: 1 });
    const b = FULL_DOC({ aPid: 2 });
    const c = FULL_DOC({ aPid: 3 });
    expect(coreChanged(a, b)).toBe(false);
    expect(coreChanged(b, c)).toBe(false);
  });

  it("false when only durable-preference keys change (a grid zoom / column resize / sort click)", () => {
    const { coreChanged } = makeSandbox();
    const a = FULL_DOC({ gridZoom: 1 });
    const b = FULL_DOC({ gridZoom: 1.4 });
    expect(coreChanged(a, b)).toBe(false);
    expect(coreChanged(FULL_DOC({ masterSort: { col: "health", dir: "asc" } }), FULL_DOC({ masterSort: { col: "name", dir: "desc" } }))).toBe(false);
  });

  it("false when opening/closing a rename box (editProjId) with nothing else different", () => {
    const { coreChanged } = makeSandbox();
    expect(coreChanged(FULL_DOC({ editProjId: null }), FULL_DOC({ editProjId: 2 }))).toBe(false);
  });

  it("true when a real task/settings edit changes a core key", () => {
    const { coreChanged } = makeSandbox();
    const a = FULL_DOC();
    const b = FULL_DOC({ projects: { ...a.projects, 1: { ...a.projects[1], name: "Goose Creek (renamed)" } } });
    expect(coreChanged(a, b)).toBe(true);
    expect(coreChanged(a, FULL_DOC({ settings: { ...a.settings, defaultSplit: 70 } }))).toBe(true);
    expect(coreChanged(a, FULL_DOC({ nPid: 5 }))).toBe(true);
  });

  it("true on first load (no prior doc) and for null/undefined", () => {
    const { coreChanged } = makeSandbox();
    expect(coreChanged(null, FULL_DOC())).toBe(true);
    expect(coreChanged(FULL_DOC(), null)).toBe(true);
  });

  it("false for the identical object (reference equality short-circuit)", () => {
    const { coreChanged } = makeSandbox();
    const a = FULL_DOC();
    expect(coreChanged(a, a)).toBe(false);
  });
});

describe("stripViewState — the payload actually written to the cloud", () => {
  it("removes exactly the 13 view keys and nothing else", () => {
    const { stripViewState, VIEW_STATE_KEYS } = makeSandbox();
    const out = stripViewState(FULL_DOC());
    for (const k of VIEW_STATE_KEYS) expect(out).not.toHaveProperty(k);
    // the keys that MUST stay versioned (BACKLOG.md B1107680's own list)
    expect(out).toMatchObject({ __rev: 42, nPid: 4, _v6: true, _v7: true, _v8: true });
    expect(out.projects).toBeTruthy();
    expect(out.settings).toBeTruthy();
    expect(out.nTid).toBeTruthy();
  });

  it("is a pure copy — never mutates the input document", () => {
    const { stripViewState } = makeSandbox();
    const d = FULL_DOC();
    stripViewState(d);
    expect(d.aPid).toBe(1); // untouched
  });
});

describe("persistViewState — writes only the storage tier that actually changed, never the cloud", () => {
  it("writes sessionStorage when a per-tab key changes, leaves localStorage untouched", () => {
    const { persistViewState, sessionStorage, localStorage } = makeSandbox();
    persistViewState(FULL_DOC({ aPid: 1 }), FULL_DOC({ aPid: 2 }));
    expect(JSON.parse(sessionStorage.getItem("planar:tabView:v1")).aPid).toBe(2);
    expect(localStorage.getItem("planar:viewPrefs:v1")).toBeNull();
  });

  it("writes localStorage when a durable preference changes, leaves sessionStorage untouched", () => {
    const { persistViewState, sessionStorage, localStorage } = makeSandbox();
    persistViewState(FULL_DOC({ gridZoom: 1 }), FULL_DOC({ gridZoom: 1.5 }));
    expect(JSON.parse(localStorage.getItem("planar:viewPrefs:v1")).gridZoom).toBe(1.5);
    expect(sessionStorage.getItem("planar:tabView:v1")).toBeNull();
  });

  it("touches neither store when nothing in either group changed", () => {
    const { persistViewState, sessionStorage, localStorage } = makeSandbox();
    const a = FULL_DOC();
    persistViewState(a, FULL_DOC());
    expect(sessionStorage.getItem("planar:tabView:v1")).toBeNull();
    expect(localStorage.getItem("planar:viewPrefs:v1")).toBeNull();
  });
});

describe("resolveViewState — load-time migration + cross-tab isolation", () => {
  it("first load ever (nothing saved yet): migrates the doc's own baked-in values and persists them", () => {
    const { resolveViewState, sessionStorage, localStorage } = makeSandbox();
    const d = FULL_DOC({ aPid: 3, gridZoom: 1.3 });
    const out = resolveViewState(d);
    expect(out.aPid).toBe(3);
    expect(out.gridZoom).toBe(1.3);
    expect(JSON.parse(sessionStorage.getItem("planar:tabView:v1")).aPid).toBe(3);
    expect(JSON.parse(localStorage.getItem("planar:viewPrefs:v1")).gridZoom).toBe(1.3);
  });

  it("a later load in the SAME tab prefers what's already saved over the doc's baked-in value", () => {
    const sandbox = makeSandbox();
    sandbox.saveTabView({ aPid: 2, view: "grid", section: "projects" });
    sandbox.saveViewPrefs({ gridZoom: 1.8, gridColWidths: {}, masterSort: null, masterCols: [], masterColWidths: {}, masterGroupBy: null, masterLevelFilter: 3, masterHealthFilter: true, healthColStyle: "stoplight" });
    // An import/restore snapshot baked in a DIFFERENT project — must not win over the live tab state.
    const imported = FULL_DOC({ aPid: 1, gridZoom: 1.0 });
    const out = sandbox.resolveViewState(imported);
    expect(out.aPid).toBe(2);
    expect(out.gridZoom).toBe(1.8);
  });

  it("editProjId is NEVER resurrected from the loaded document, even if the doc has one baked in", () => {
    const { resolveViewState } = makeSandbox();
    const out = resolveViewState(FULL_DOC({ editProjId: 7 }));
    expect(out.editProjId).toBeNull();
  });

  it("a stale per-tab aPid pointing at a deleted project falls back to the doc's own aPid", () => {
    const sandbox = makeSandbox();
    sandbox.saveTabView({ aPid: 99, view: "grid", section: "projects" }); // 99 no longer exists
    const out = sandbox.resolveViewState(FULL_DOC({ aPid: 2 }));
    expect(out.aPid).toBe(2);
    expect(out.projects[out.aPid]).toBeTruthy();
  });

  it("falls all the way back to the first project if even the doc's own aPid is gone", () => {
    const sandbox = makeSandbox();
    sandbox.saveTabView({ aPid: 99, view: "grid", section: "projects" });
    const out = sandbox.resolveViewState(FULL_DOC({ aPid: 999 }));
    expect(out.projects[out.aPid]).toBeTruthy();
  });

  it("never crashes / never returns a dangling aPid — data.projects[data.aPid] is always defined", () => {
    const sandbox = makeSandbox();
    for (const staleAPid of [null, undefined, 0, -1, "ghost"]) {
      sandbox.sessionStorage.clear();
      sandbox.saveTabView({ aPid: staleAPid, view: "grid", section: "projects" });
      const out = sandbox.resolveViewState(FULL_DOC());
      expect(out.projects[out.aPid]).toBeTruthy();
    }
  });
});

describe("end-to-end: the exact production repro (4 project switches, 0 task edits)", () => {
  it("never reports a core change across a sequence of pure navigations", () => {
    const { coreChanged, persistViewState } = makeSandbox();
    let cur = FULL_DOC({ aPid: 1 });
    let prevCore = cur;
    const switches = [2, 3, 1, 3];
    for (const aPid of switches) {
      const next = { ...cur, aPid };
      persistViewState(prevCore, next);
      expect(coreChanged(prevCore, next)).toBe(false); // no __rev bump, no cloud write would fire
      prevCore = next;
      cur = next;
    }
  });
});

describe("source-guarded — the fix is actually wired into the App component, not just defined", () => {
  it("attemptCloudSave strips view state before it ever reaches window.storage.set", () => {
    const i = SRC.indexOf("const attemptCloudSave = (d) => {");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("};", i));
    expect(block).toMatch(/window\.storage\.set\("hs-v1",\s*JSON\.stringify\(stripViewState\(d\)\)/);
  });

  it("the main data-change effect gates attemptCloudSave on coreChanged, not on every data change", () => {
    const i = SRC.indexOf("persistViewState(prevCoreRef.current, data);");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, i + 1200);
    expect(block).toMatch(/const coreIsNew = coreChanged\(prevCoreRef\.current, data\);/);
    expect(block).toMatch(/if \(!isFirstLoad && coreIsNew\) attemptCloudSave\(data\);/);
  });

  it("all four load-effect setData calls route through resolveViewState", () => {
    const matches = SRC.match(/setData\(resolveViewState\(d\)\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it("every explicit pre-X checkpoint save strips view state too (pre-restore/pre-delete/pre-import/pre-recascade)", () => {
    for (const label of ["pre-restore", "pre-delete-project", "pre-import", "pre-recascade"]) {
      const i = SRC.indexOf(`label: "${label}"`);
      expect(i, `label "${label}" not found`).toBeGreaterThan(-1);
      const lineStart = SRC.lastIndexOf("\n", i);
      const line = SRC.slice(lineStart, i);
      expect(line, `checkpoint save for "${label}" must strip view state`).toMatch(/stripViewState\(/);
    }
  });
});
