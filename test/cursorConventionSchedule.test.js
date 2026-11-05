/* Cursor convention — SCHEDULE slice (owner convention 2026-10-20, docs/DESIGN.md "Cursor convention"; B2426786).
 * Red-proof on the pre-fix tree: the scheduler iframe (public/sequence/index.html) is a standalone page that never sees
 * src/index.css, so it had no disabled-arrow rule, three `not-allowed` sites, a row-reorder drag whose body cursor was
 * out-ranked by every cell's inline cursor, a grid cell cursor read from a ref at render time, column / divider resizes
 * that lost their cursor outside the grip, and no `progress` anywhere.
 * The runtime half (computed cursor at named points, signed in on the deployed build) is ui-audit/verify-cursors-schedule.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const html = readFileSync("public/sequence/index.html", "utf8");
const read = (p) => readFileSync(p, "utf8");
const link = read("src/workspaces/scheduler/components/LinkSchedulePanel.jsx");
const crumb = read("src/workspaces/scheduler/components/ScheduleCrumb.jsx");
const loadState = read("src/workspaces/scheduler/components/ScheduleLoadState.jsx");
const sched = read("src/workspaces/scheduler/Scheduler.jsx");

/** Source of the function/const starting at `marker`, up to `len` characters. */
const slice = (marker, len = 2600) => {
  const i = html.indexOf(marker);
  expect(i, `marker not found: ${marker}`).toBeGreaterThan(-1);
  return html.slice(i, i + len);
};

describe("the iframe page owns the disabled / busy / native-input cursors in its own stylesheet", () => {
  it("a disabled control shows the arrow, !important, so an inline `cursor: pointer` cannot survive it", () => {
    expect(html).toMatch(/button:disabled,[^{]*\[aria-disabled="true"\][^{]*\{\s*cursor:\s*default\s*!important/);
  });
  it("a disabled control that is WORKING (aria-busy) shows progress", () => {
    expect(html).toMatch(/button:disabled\[aria-busy="true"\][^{]*\{\s*cursor:\s*progress\s*!important/);
  });
  it("native checkbox / radio / select / range show the pointer when enabled", () => {
    expect(html).toMatch(/input\[type="?checkbox"?\]:enabled[^{]*select:enabled[^{]*\{\s*cursor:\s*pointer/);
    expect(html).toMatch(/input\[type="?range"?\]:enabled:active\s*\{\s*cursor:\s*grabbing/);
  });
  it("nothing sets not-allowed anywhere in the slice", () => {
    expect(html).not.toMatch(/not-allowed/);
    expect(link).not.toMatch(/not-allowed/);
    for (const f of ["ScheduleCrumb", "ScheduleOwnerList", "ScheduleToolbar", "AgendaView", "NewScheduleModal", "ScheduleLoadState"]) {
      expect(read(`src/workspaces/scheduler/components/${f}.jsx`), f).not.toMatch(/not-allowed/);
    }
  });
});

describe("the pin helper (the iframe's own pinDragCursor — it cannot import src/shared)", () => {
  const m = html.match(/<script id="sched-pin-cursor">([\s\S]*?)<\/script>/);
  it("exists as a plain script ahead of the Babel bundle", () => {
    expect(m).not.toBeNull();
    expect(html.indexOf('id="sched-pin-cursor"')).toBeLessThan(html.indexOf('<script type="text/babel">'));
  });
  it("is released on pointerup, mouseup, pointercancel, Escape and window blur", () => {
    const src = m ? m[1] : "";
    for (const ev of ["pointerup", "mouseup", "pointercancel", "keydown", "blur"]) expect(src).toContain(`"${ev}"`);
    expect(src).toContain("Escape");
    expect(src).toMatch(/cursor:\s*'?\s*\+?\s*c|cursor:\s*" ?\+/);
  });
  it("behaves: pins at the root, a second pin replaces the first, every exit path releases", () => {
    const src = m ? m[1] : "";
    const listeners = {};
    const styles = [];
    const win = {
      addEventListener: (t, f) => { (listeners[t] = listeners[t] || new Set()).add(f); },
      removeEventListener: (t, f) => { listeners[t] && listeners[t].delete(f); },
    };
    const doc = {
      head: { appendChild: (el) => { styles.push(el); el.isConnected = true; } },
      createElement: () => ({ setAttribute() {}, remove() { this.isConnected = false; styles.splice(styles.indexOf(this), 1); } }),
      documentElement: { setAttribute() {}, removeAttribute() {} },
    };
    // eslint-disable-next-line no-new-func
    new Function("window", "document", src)(win, doc);
    expect(typeof win.pinSchedCursor).toBe("function");
    const rel = win.pinSchedCursor("grabbing");
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toMatch(/cursor:\s*grabbing\s*!important/);
    win.pinSchedCursor("col-resize"); // replaces
    expect(styles.length).toBe(1);
    expect(styles[0].textContent).toMatch(/col-resize/);
    rel(); // the replaced pin's release must not tear down the live one
    expect(styles.length).toBe(1);
    for (const exit of [["mouseup", {}], ["pointerup", {}], ["pointercancel", {}], ["blur", {}], ["keydown", { key: "Escape" }]]) {
      win.pinSchedCursor("grabbing");
      expect(styles.length).toBe(1);
      [...(listeners[exit[0]] || [])].forEach((f) => f({ type: exit[0], ...exit[1] }));
      expect(styles.length, `released by ${exit[0]}`).toBe(0);
    }
    win.pinSchedCursor("grabbing");
    [...(listeners.keydown || [])].forEach((f) => f({ type: "keydown", key: "a" }));
    expect(styles.length, "a plain key must not release").toBe(1);
  });
});

describe("row reorder pins grabbing for the WHOLE drag (every cell / header / Gantt row sets its own inline cursor)", () => {
  it("startRowDrag pins through the helper, not body.style.cursor", () => {
    const s = slice("const startRowDrag = (e, anchorTaskId", 9000);   // NEW-1: the pin now happens in arm(), after the drag threshold
    expect(s).toMatch(/pinSchedCursor\("grabbing"[,)]/);
    expect(s).not.toMatch(/document\.body\.style\.cursor\s*=\s*"grabbing"/);
  });
  it("the drop / cancel path releases the pin", () => {
    const s = slice("const teardown = () => {\n      if (finished) return false;", 1500);   // NEW-1: commit, cancel and click all end in teardown()
    expect(s).toMatch(/releaseCursor\(\)|unpin\(\)/);
  });
  it("the grip keeps `grab` at rest and the .rowgrip:active rule cannot lose to it", () => {
    expect(html).toMatch(/\.rowgrip\s*\{[^}]*cursor:\s*grab/);
    expect(html).toMatch(/\.rowgrip:active\s*\{\s*cursor:\s*grabbing\s*!important/);
  });
});

describe("Gantt: a drag on a task row pans, so the row shows the hand", () => {
  it("no Gantt row paints its own `cursor: default` over the pane's grab", () => {
    let i = 0, n = 0;
    while ((i = html.indexOf("data-gantt-row={task.id}", i)) > -1) {
      n++;
      const s = html.slice(i, i + 900);
      const styleStart = s.indexOf("style={{");
      const styleEnd = s.indexOf("}}>", styleStart);
      expect(s.slice(styleStart, styleEnd), `gantt row #${n}`).not.toMatch(/cursor:\s*"default"/);
      i += 10;
    }
    expect(n).toBeGreaterThan(1);
  });
  it("the pan pins grabbing for the whole gesture (the pointer can leave the pane)", () => {
    const s = slice("const onPanDown = e => {", 700);
    expect(s).toMatch(/pinSchedCursor\("grabbing"[,)]/);
  });
});

describe("grid cell drag-select: the cursor is driven by the gesture, not a ref read at render", () => {
  it("the cell style no longer reads isDraggingCells.current for its cursor", () => {
    expect(html).not.toMatch(/cursor:\s*isDraggingCells\.current/);
  });
  it("a drag-select pins `cell` (range select), released with the mouseup", () => {
    expect(html).toMatch(/pinSchedCursor\("cell"[,)]/);
    expect(html).not.toMatch(/"crosshair"/);
  });
});

describe("resizes keep their cursor for the whole gesture", () => {
  it("project-grid column resize pins col-resize", () => {
    expect(slice("const startResize = (colKey, e) => {\n    e.preventDefault(); e.stopPropagation();\n    const startX = e.clientX, startW = dispW", 900)).toMatch(/pinSchedCursor\("col-resize"[,)]/);
  });
  it("desktop split divider pins col-resize (Snap mode jumps the divider away from the pointer)", () => {
    expect(slice("const onDividerDown = e => {", 2800)).toMatch(/pinSchedCursor\("col-resize"[,)]/);
  });
  it("MasterView column resize and the review divider use the same pin", () => {
    expect(slice("const startResize = (colKey, e) => {\n    e.preventDefault(); e.stopPropagation();\n    const startX = e.clientX, startW = colWidths", 900)).toMatch(/pinSchedCursor\("col-resize"[,)]/);
    expect(slice("const onDivDown = (e) => {", 500)).toMatch(/pinSchedCursor\("row-resize"[,)]/);
  });
});

describe("MasterView matches the Project grid", () => {
  it("sortable headers (click sorts) show the pointer; only the reorder-only ones keep grab", () => {
    expect(html).toMatch(/cursor:\s*sortable\s*\?\s*"pointer"\s*:\s*"grab"/);
  });
  it("name / leaf-duration / percent / owner cells rest on the arrow (text only appears with the editor)", () => {
    expect(html).not.toMatch(/\.\.\.tdBase,cursor:"text"/);
    expect(html).not.toMatch(/cursor:t\.isLeaf\?"text":"default"/);
  });
});

describe("busy states show progress", () => {
  it("the standalone Save button shows progress while the write is in flight", () => {
    expect(html).toMatch(/cursor:\s*saveStatus\s*===\s*"saving"\s*\?\s*"progress"/);
  });
  it("version history marks its buttons busy (aria-busy → progress via the stylesheet)", () => {
    expect(html).toMatch(/disabled=\{busy\}\s+aria-busy=\{busy/);
    expect(html).toMatch(/\.rev-loading\{[^}]*cursor:\s*progress/);
  });
  it("the history list's Loading… line shows progress", () => {
    expect(html).toMatch(/cursor:"progress"[^>]*>Loading…/);
  });
  it("ScheduleLoadState shows progress while loading / slow (not once failed, where Retry is the action)", () => {
    expect(loadState).toMatch(/cursor:\s*failed\s*\?\s*"default"\s*:\s*"progress"/);
  });
  it("the boot overlay shows progress until the iframe is ready", () => {
    const i = sched.indexOf('<ModuleLoader module="scheduler" />');
    expect(i).toBeGreaterThan(-1);
    expect(sched.slice(i - 700, i)).toMatch(/cursor:\s*\(ready && !gridMismatched\)\s*\?\s*"default"\s*:\s*"progress"/);
  });
  it("the schedule crumb is busy while the list loads", () => {
    expect(crumb).toMatch(/aria-busy=\{!listLoaded/);
    expect(crumb).toMatch(/cursor:\s*listLoaded\s*\?\s*"pointer"\s*:\s*"default"/);
  });
});

describe("disabled controls in React never set an inline pointer", () => {
  it("LinkSchedulePanel's two gated buttons rest on the arrow", () => {
    expect(link).toMatch(/cursor:\s*canCreate\s*\?\s*"pointer"\s*:\s*"default"/);
    expect(link).toMatch(/cursor:\s*pick\s*\?\s*"pointer"\s*:\s*"default"/);
  });
});

describe("the MasterView project-group drag keeps the closed hand while the pointer is off its grip", () => {
  it("startGroupDrag pins grabbing and releases it in end()", () => {
    const s = slice("const startGroupDrag = (e, siteId) => {", 3200);
    expect(s).toMatch(/pinSchedCursor\("grabbing"/);
    expect(s).toMatch(/const end = \(commit\) => \{\s*releaseCursor\(\)/);
  });
});
