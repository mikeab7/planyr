/* NEW-4/B1080548 — copy/paste tasks BETWEEN schedules, and the hard part the owner named
 * explicitly: predecessor/successor links.
 *
 * The task clipboard (Ctrl+C/Ctrl+X/Ctrl+V, `public/sequence/index.html`) already supported
 * cross-schedule paste MECHANICALLY — `pasteTaskAfter` reads the CURRENT active project (`d.aPid`)
 * at paste time, not the source project the clipboard was filled from, so copying in one schedule
 * and switching to another before pasting already worked end to end. What it got wrong was
 * dependency links that point OUTSIDE the copied subtree (to a task left behind in the source):
 * same-project, that raw numeric id still resolves to a real task and correctly kept working;
 * cross-project, the destination has its OWN, unrelated id space — silently keeping the raw id
 * risked resolving onto whatever unrelated task happens to share that number in the destination,
 * exactly the "collision silently rewires the destination's existing dependencies" danger the
 * owner flagged, or letting it be dropped by `renumberTasks`' unrelated no-longer-exists prune
 * with no notice to the user either way.
 *
 * Fix: an external predecessor is now DROPPED on a cross-project paste (never kept under its old
 * id) and the toast reports exactly how many were dropped, LOUD-FAILURE style — a paste that
 * silently lost dependency logic is worse than one that says so.
 *
 * This test EXTRACTS the real remap logic from the shipped file (same pattern as
 * test/schedulerSaveQueue.test.js) so it can never drift from the code the owner actually runs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = readFileSync(fileURLToPath(new URL("../public/sequence/index.html", import.meta.url)), "utf8");

function sliceBetween(startMarker, endMarker, { fromLast = false } = {}) {
  const start = fromLast ? SRC.lastIndexOf(startMarker) : SRC.indexOf(startMarker);
  expect(start, `"${startMarker}" not found in public/sequence/index.html`).toBeGreaterThan(-1);
  const end = SRC.indexOf(endMarker, start);
  expect(end, `"${endMarker}" not found after "${startMarker}"`).toBeGreaterThan(-1);
  return SRC.slice(start, end + endMarker.length);
}

// Extract the "how many links can't survive" precomputation (runs BEFORE setData, from `cb` alone).
const dropCountSrc = sliceBetween(
  "const pastedOldIds = new Set(cb.tasks.map(t => t.id));",
  "      : 0;",
);
function computeDroppedLinkCount(cb, dataRef) {
  const fn = new Function("cb", "dataRef", `${dropCountSrc}\nreturn droppedLinkCount;`);
  return fn(cb, dataRef);
}

// Extract the actual pasted-subtree construction (id remap + parent remap + predecessor remap).
const pastedSrc = sliceBetween(
  "const rootOldIds = new Set(cb.sourceRootIds || [cb.sourceRootId]);",
  "}));",
);
function computePasted(cb, idMap, target, crossProject) {
  const fn = new Function("cb", "idMap", "target", "crossProject", `${pastedSrc}\nreturn pasted;`);
  return fn(cb, idMap, target, crossProject);
}

const task = (id, over = {}) => ({
  id, name: `Task ${id}`, notes: [], predecessors: [], parentId: null, ...over,
});

describe("pasteTaskAfter — dropped-link count (extracted, cb-only precomputation)", () => {
  it("0 when the paste is SAME-project, however many external predecessors exist", () => {
    const cb = {
      sourceProjId: 6,
      tasks: [task(1, { predecessors: [{ id: 1 }, { id: 999 }] })],
    };
    expect(computeDroppedLinkCount(cb, { current: { aPid: 6 } })).toBe(0);
  });

  it("counts every predecessor pointing OUTSIDE the pasted set, only when CROSS-project", () => {
    const cb = {
      sourceProjId: 6,
      tasks: [
        task(1, { predecessors: [{ id: 2 }, { id: 999 }] }), // id 2 is internal (pasted too), 999 is external
        task(2, { predecessors: [{ id: 998 }] }),             // 998 is external too
      ],
    };
    // internal ids: {1, 2} — so predecessors pointing at 999 and 998 are external → 2 dropped
    expect(computeDroppedLinkCount(cb, { current: { aPid: 15 } })).toBe(2);
  });

  it("0 for a clean copy with only internal links, even cross-project", () => {
    const cb = {
      sourceProjId: 6,
      tasks: [task(1, { predecessors: [{ id: 2 }] }), task(2)],
    };
    expect(computeDroppedLinkCount(cb, { current: { aPid: 15 } })).toBe(0);
  });
});

describe("pasteTaskAfter — the pasted subtree (extracted, real remap logic)", () => {
  const target = task(50, { parentId: null });

  it("SAME-project: an external predecessor keeps its ORIGINAL id — it still resolves there (unchanged behaviour)", () => {
    const cb = {
      sourceRootIds: [1],
      tasks: [task(1, { predecessors: [{ id: 999 }] })], // 999 is a real task left behind in the SAME project
    };
    const idMap = { 1: 5001 };
    const pasted = computePasted(cb, idMap, target, /* crossProject */ false);
    expect(pasted).toHaveLength(1);
    expect(pasted[0].id).toBe(5001); // the pasted copy itself always gets a FRESH id
    expect(pasted[0].predecessors).toEqual([{ id: 999 }]); // external link kept — same project, still valid
  });

  it("CROSS-project: an external predecessor is DROPPED, never kept under its stale id (NEW-4 fix)", () => {
    const cb = {
      sourceRootIds: [1],
      tasks: [task(1, { predecessors: [{ id: 999 }] })], // 999 does not exist in the destination's id space
    };
    const idMap = { 1: 5001 };
    const pasted = computePasted(cb, idMap, target, /* crossProject */ true);
    expect(pasted[0].id).toBe(5001);
    expect(pasted[0].predecessors).toEqual([]); // dropped, not silently rewired onto an unrelated task
  });

  it("a dependency BETWEEN two pasted tasks is preserved and remapped to the NEW ids, cross-project or not", () => {
    const cb = {
      sourceRootIds: [1], // task 1 is the selected root; task 2 is its child, carried along
      tasks: [
        task(1, { predecessors: [] }),
        task(2, { parentId: 1, predecessors: [{ id: 1 }] }), // depends on its own parent, within the copied set
      ],
    };
    const idMap = { 1: 5001, 2: 5002 };
    for (const crossProject of [false, true]) {
      const pasted = computePasted(cb, idMap, target, crossProject);
      const child = pasted.find((t) => t.id === 5002);
      expect(child.parentId).toBe(5001); // structural remap: still a child of the pasted parent
      expect(child.predecessors).toEqual([{ id: 5001 }]); // internal predecessor remapped, not dropped
    }
  });

  it("never reuses a source id — every pasted task gets a fresh id from idMap, regardless of project", () => {
    const cb = { sourceRootIds: [1], tasks: [task(1)] };
    const idMap = { 1: 7777 };
    for (const crossProject of [false, true]) {
      const pasted = computePasted(cb, idMap, target, crossProject);
      expect(pasted[0].id).not.toBe(1);
      expect(pasted[0].id).toBe(7777);
    }
  });
});

/* Source guards for the parts the extraction above can't reach on its own: that the toast actually
 * reports the drop, and that pasting stays reachable across a project switch (the mechanical half
 * the owner asked to confirm — "does pasting into the SAME schedule duplicate the tasks" — is
 * already true by construction, since `pid` is read fresh from `d.aPid` at paste time, never pinned
 * to the clipboard's source; asserted here so a future edit can't silently pin it). */
describe("pasteTaskAfter — LOUD-FAILURE reporting + cross-schedule reachability (source guards)", () => {
  it("the toast names how many links were dropped, never silently", () => {
    expect(SRC).toMatch(/\$\{droppedLinkCount\} link\$\{droppedLinkCount > 1 \? "s" : ""\} to/);
    expect(SRC).toMatch(/left in the source schedule/);
  });

  it("the active project id is read FRESH at paste time (`d.aPid`), never pinned to the clipboard's source", () => {
    const i = SRC.indexOf("const pasteTaskAfter = useCallback");
    expect(i).toBeGreaterThan(-1);
    const block = SRC.slice(i, SRC.indexOf("setData(d => {", i) + 200);
    expect(block).toMatch(/const pid = d\.aPid;/);
  });
});
