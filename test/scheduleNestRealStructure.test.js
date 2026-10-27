import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grandPortTasks, GRAND_PORT_PLAN_A, GRAND_PORT_TASK_COUNT } from "../ui-audit/lib/grandPortScheduleStructure.mjs";

// B2445008 (×2) — "i still cant drop the rows under plan a", on the owner's REAL schedule structure.
// The first nest fix passed its own tests and a signed-in live check and still failed for him. Two causes,
// both outside what a 13-row, 100%-zoom, grip-only fixture could see (full write-up on the item and in
// ui-audit/verify-schedule-nest-real-structure.mjs, which drives both with a real mouse):
//   1. the drop math divided VISUAL pointer pixels (the grid is CSS-zoomed) by the UNZOOMED row height;
//   2. a press on an ID cell inside the selection started a new selection, never a move.
// These run the REAL functions sliced out of public/sequence/index.html. Red-proof: against 3a33571 the
// file fails at extraction (rowFloatAtPointer / idPressMovesRows did not exist) — and the browser
// harness goes 14/40 there, which is the behavioural red-proof.
const src = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");
const extractFn = (signature) => {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`"${signature}" not found in public/sequence/index.html`);
  let depth = 0, i = start, seen = false;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; seen = true; }
    else if (src[i] === "}") { depth--; if (seen && depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
};
const line = (prefix) => { const s = src.indexOf(prefix); if (s === -1) throw new Error(prefix + " missing"); return src.slice(s, src.indexOf("\n", s)); };
const stmt = (prefix) => { const s = src.indexOf(prefix); if (s === -1) throw new Error(prefix + " missing"); return src.slice(s, src.indexOf(";\n", s) + 1); };

const real = new Function(`
  ${line("const ROW_NEST_BAND =")}
  ${line("const rowDropZone =")}
  ${extractFn("const resolveDropParent = (tasks, blocked, gapIndex) => {")};
  ${extractFn("const rowDropIntent = (tasks, blocked, rowFloat) => {")};
  ${extractFn("const flatOrderWithLevel = (tasks) => {")};
  ${extractFn('const moveSelectionToDestination = (tasks, selectedIds, destParentId, insertAfterId = "end") => {')};
  ${stmt("const rowFloatAtPointer =")}
  ${extractFn("const idPressMovesRows = (selRange, ri, colCount) => {")};
  return { rowDropIntent, flatOrderWithLevel, moveSelectionToDestination, rowFloatAtPointer, idPressMovesRows };
`)();
const { rowDropIntent, flatOrderWithLevel, moveSelectionToDestination, rowFloatAtPointer, idPressMovesRows } = real;

const TL_H = 30, ROW_H = 20;   // his saved row height is 20
const tasks = grandPortTasks();
const flat = flatOrderWithLevel(tasks);
const vIdx = (id) => flat.findIndex(t => t.id === id);
const blockedFor = (ids) => {
  const b = new Set(ids);
  let grew = true;
  while (grew) { grew = false; tasks.forEach(t => { if (t.parentId != null && b.has(t.parentId) && !b.has(t.id)) { b.add(t.id); grew = true; } }); }
  return b;
};
// His selection: ID-click Kinder Morgan (153), shift-click "Set up meeting once we have pipeline depths" (166).
const selected = flat.slice(vIdx(153), vIdx(166) + 1).map(t => t.id);
const blocked = blockedFor(selected);

// Where a pointer at the CENTRE of visible row `idx` is, in client pixels, for a grid at `zoom`
// scrolled by `scrollTop` (CSS px) whose top edge sits at `rectTop`.
const clientYAtRowCentre = (idx, zoom, scrollTop, rectTop) => rectTop + (TL_H + (idx + 0.5) * ROW_H - scrollTop) * zoom;

describe("the fixture IS his structure", () => {
  it("365 rows, every parent before its children, Plan A a leaf sibling of Pipeline Coordination (132)", () => {
    expect(tasks.length).toBe(GRAND_PORT_TASK_COUNT);
    const seen = new Set();
    for (const t of tasks) { if (t.parentId != null) expect(seen.has(t.parentId)).toBe(true); seen.add(t.id); }
    const planA = tasks.find(t => t.id === GRAND_PORT_PLAN_A);
    expect(planA.name).toBe("Plan A");
    expect(planA.parentId).toBe(48);
    expect(tasks.find(t => t.id === 132).parentId).toBe(48);
    expect(tasks.some(t => t.parentId === GRAND_PORT_PLAN_A)).toBe(false);
  });
  it("the selection he made is 10 visible rows (Kinder Morgan and Enterprise collapsed), and Plan A is the very next visible row", () => {
    expect(selected).toEqual([153, 156, 159, 160, 161, 162, 163, 164, 165, 166]);
    expect(vIdx(GRAND_PORT_PLAN_A)).toBe(vIdx(166) + 1);
    expect(blocked.has(154) && blocked.has(157)).toBe(true);   // the collapsed parents' hidden children travel
  });
});

describe("rowFloatAtPointer — the pointer is measured in the grid's own (zoomed) pixels", () => {
  for (const zoom of [0.5, 0.8, 0.89, 1, 1.12, 1.25, 2]) {
    for (const scrollTop of [0, 1300, 2500]) {
      it(`zoom ${zoom}, scrolled ${scrollTop}: a pointer on Plan A's centre resolves to Plan A and offers "Nest inside"`, () => {
        const idx = vIdx(GRAND_PORT_PLAN_A);
        const f = rowFloatAtPointer(clientYAtRowCentre(idx, zoom, scrollTop, 80), 80, scrollTop, zoom, TL_H, ROW_H);
        expect(f).toBeCloseTo(idx + 0.5, 6);
        const intent = rowDropIntent(flat, blocked, f);
        expect(intent).toMatchObject({ kind: "into", targetId: GRAND_PORT_PLAN_A, destParentId: GRAND_PORT_PLAN_A, insertAfterId: "end" });
      });
    }
  }
  it("RED-PROOF of the first fix's formula: unzoomed math at 89% lands on a DRAGGED row — no drop at all", () => {
    // scrolled so Plan A sits about two-thirds down a desktop-height grid (its centre 600 CSS px below
    // the grid's top edge) — the error is (1 − zoom) × that distance, ~3 rows here, i.e. inside his selection
    const zoom = 0.89, idx = vIdx(GRAND_PORT_PLAN_A), scrollTop = TL_H + (idx + 0.5) * ROW_H - 600;
    const y = clientYAtRowCentre(idx, zoom, scrollTop, 80);
    const oldFloat = ((y - 80) + scrollTop - TL_H) / ROW_H;   // what 3a33571 computed
    const intent = rowDropIntent(flat, blocked, oldFloat);
    expect(intent.kind === "into" && intent.targetId === GRAND_PORT_PLAN_A).toBe(false);
    expect(blocked.has(flat[Math.floor(oldFloat)].id)).toBe(true);
  });
  it("a bad zoom reading falls back to 1 rather than producing NaN", () => {
    expect(rowFloatAtPointer(130, 80, 0, 0, TL_H, ROW_H)).toBeCloseTo(1, 6);
    expect(rowFloatAtPointer(130, 80, 0, NaN, TL_H, ROW_H)).toBeCloseTo(1, 6);
  });
});

describe("idPressMovesRows — an ID cell inside a multi-row selection picks the selection up", () => {
  const cols = 12, full = (r1, r2) => ({ r1, r2, c1: 0, c2: cols - 1 });
  it("inside a full-row range of 2+ rows → move (either end, any direction the range was drawn)", () => {
    expect(idPressMovesRows(full(10, 19), 10, cols)).toBe(true);
    expect(idPressMovesRows(full(10, 19), 19, cols)).toBe(true);
    expect(idPressMovesRows(full(19, 10), 14, cols)).toBe(true);
  });
  it("outside the range, a single selected row, a partial-column range or no selection → select as before", () => {
    expect(idPressMovesRows(full(10, 19), 20, cols)).toBe(false);
    expect(idPressMovesRows(full(10, 10), 10, cols)).toBe(false);
    expect(idPressMovesRows({ r1: 10, r2: 19, c1: 1, c2: 3 }, 12, cols)).toBe(false);
    expect(idPressMovesRows(null, 12, cols)).toBe(false);
  });
});

describe("the drop itself on his structure", () => {
  const intent = rowDropIntent(flat, blocked, vIdx(GRAND_PORT_PLAN_A) + 0.5);
  const moved = moveSelectionToDestination(tasks, selected, intent.destParentId, intent.insertAfterId);
  const kids = (list, id) => flatOrderWithLevel(list.map(t => ({ ...t, isExpanded: true }))).filter(t => t.parentId === id).map(t => t.id);
  it("the four top-most rows become Plan A's children in order; their own children travel with them", () => {
    expect(kids(moved, GRAND_PORT_PLAN_A)).toEqual([153, 156, 159, 164]);
    expect(kids(moved, 153)).toEqual([154, 155]);
    expect(kids(moved, 159)).toEqual([160, 161, 162, 163]);
    expect(moved.find(t => t.id === 153).isExpanded).toBe(false);
  });
  it("links, locked starts and notes on the moved rows are untouched; Pipeline keeps Plan B and Surveying", () => {
    expect(moved.find(t => t.id === 166).predecessors).toEqual([{ id: 152, type: "FS", lag: 0 }]);
    expect(moved.find(t => t.id === 154).pinnedStart).toBe(true);
    expect(moved.find(t => t.id === 157).notes[0].text).toBe("keep this note");
    expect(kids(moved, 132)).toEqual([133, 148]);
  });
});
