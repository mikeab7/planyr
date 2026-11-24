// src/shared/schedule/engine/tasks.js
//
// Task-list structure: renumbering, visual order, indent/outdent/move, the row-drag drop rules (owner constraint #36), grouping by schedule.
//
// Pure functions only (no React, no DOM). The Schedule page (public/sequence/index.html) gets this code
// through the generated script public/sequence/page.js (npm run build:sequence-page), and the unit
// tests import it directly — ONE copy, no paste-in. Moved here verbatim from the page (audit batch J1);
// behaviour is unchanged.
import { crossScheduleLabel } from "../scheduleOwnership.js";
import { NOW } from "./calendar.js";
import { normPreds } from "./predecessors.js";
import { isMulti } from "../../selection/rangeSelection.js";

// NEW-1 — the prefix a notice should print in front of "#<id> "<name>"" for a row belonging to
// schedule `pid`: nothing at all when `pid` is the schedule already on screen (`currentPid`) —
// restating "Goose Creek / Master Schedule" next to every row of the very table you're looking at
// is pure noise, not disambiguation (PANEL-BREVITY) — otherwise the full label above, with a
// trailing space so a caller can splice it straight in front of the "#id" it already renders.
// `pid`/`currentPid` are compared as strings because a schedule id arrives as an object key
// (always a string, e.g. from `Object.keys(d.projects)`) in some call sites and as the numeric
// `.id`/`aPid` field in others — a strict `===` here would silently show every row as "elsewhere".
export function scheduleRowPrefix(projects, pid, currentPid) {
  if (pid == null || String(pid) === String(currentPid)) return "";
  const schedule = projects && projects[pid];
  if (!schedule) return "";
  return crossScheduleLabel(schedule) + " ";
}

export const fmtD = s => { if (!s) return ""; const [y,m,d] = s.split('-'); if (!y||!m||!d) return ""; return String(+m).padStart(2,'0')+'/'+String(+d).padStart(2,'0')+'/'+y.slice(2); };

export const toShortDate = s => { if (!s) return ""; const [y,m,d] = s.split("-"); return `${+m}/${+d}/${y.slice(2)}`; };

// Export filename — matches the Site Planner's PDF/PNG naming (src/workspaces/site-planner/lib/printSheet.js
// → "YYYY.MM.DD {Project} - {Plan}"): here "YYYY.MM.DD {Project} - Schedule" (the trailing slot is the
// document type, since a project has one schedule). A single selected project uses its name; multiple use
// the Planyr brand. Filesystem-illegal chars are stripped (same rule as sanitizeFilename). The caller adds
// the .pdf/.html/.json extension; for the PDF exhibit this string is the <title> the browser's "Save as
// PDF" uses as the filename.
export const scheduleExportName = (projects, date = new Date()) => {
  const p2 = n => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}.${p2(date.getMonth() + 1)}.${p2(date.getDate())}`;
  const clean = s => String(s == null ? "" : s).replace(/[\u0000-\u001f\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  const names = (Array.isArray(projects) ? projects : []).map(p => p && p.name).filter(Boolean);
  const proj = clean(names.length === 1 ? names[0] : "Planyr") || "Planyr";
  return `${stamp} ${proj} - Schedule`;
};

export const parseFlexDate = s => {
  if (!s) return null; s = String(s).trim();
  // ISO (YYYY-MM-DD) fast-path — but still reject impossible calendar dates (2026-02-30,
  // 2026-13-01, 2026-00-15). An unvalidated ISO string would persist a date the rest of the
  // app can't schedule (pd() silently rolls 2026-02-30 → Mar 2, or NaNs 2026-13-01), and would
  // disagree with the slash/dot path which rejects the same impossible dates below.
  const isoM = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoM) {
    const Y = +isoM[1], Mo = +isoM[2], Da = +isoM[3];
    const chk = new Date(s + "T12:00:00");
    return (!isNaN(chk) && chk.getMonth() + 1 === Mo && chk.getDate() === Da && Mo >= 1 && Mo <= 12 && Y >= 2000) ? s : null;
  }
  const parts = s.split(/[\/\-\.]/);
  if (parts.length < 2) return null;
  const m = parseInt(parts[0], 10), d = parseInt(parts[1], 10);
  let y = (parts[2] !== undefined && parts[2] !== "") ? parseInt(parts[2], 10) : new Date().getFullYear();
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;  // reject "-5/-5" → "NaN-NaN-05"
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
  const iso = `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  // Reject impossible calendar dates (e.g. 2/31) — silently rolling Feb 31 → Mar 3 is
  // worse than rejecting the edit (a wrong date beats a refused one is NOT our rule here).
  const chk = new Date(iso + "T12:00:00");
  if (isNaN(chk) || chk.getMonth() + 1 !== m || chk.getDate() !== d) return null;
  return iso;
};

// Fix #1: helper – pick a sensible default start for a new task
export const defaultStartFor = (tasks, parentId, excludeId = null) => {
  if (parentId !== null) {
    const parent = tasks.find(t => t.id === parentId);
    if (parent?.start) return parent.start;
  }
  const sibs = tasks.filter(t => t.parentId === parentId && t.id !== excludeId);
  for (let i = sibs.length - 1; i >= 0; i--) {
    if (sibs[i].start) return sibs[i].start;
  }
  return NOW;
};

// NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — a permanent per-task
// identity, independent of `id` (which renumberTasks reassigns by array position on every
// structural edit — never a stable reference). Minted once, here, at task-creation time, so every
// task built via mkt() — every live "add task"/"insert"/"deadline row" reducer, AND the built-in
// SEED fixture — carries its own identity from the moment it exists. See renumberTasks for how an
// EXISTING task (loaded from the cloud, already carrying one) keeps it untouched across renumbers,
// and normalizeIds for how a task that predates this fix (no _sid at all) is backfilled.
export let _sidSeq = 0;

export const _mintTaskSid = () => "s" + Date.now().toString(36) + (_sidSeq++).toString(36) + Math.random().toString(36).slice(2, 7);

// NEW-1 (false-conflict/merge-toast inflation, owner report 2026-09-17) — `id` below is reassigned
// by ARRAY POSITION on every structural edit ("ids are reassigned to visual order every structural
// edit" — see the comment just below), so it is NOT a stable identity: inserting or deleting one
// task shifts the `id` of every task after it, even though none of THEM were touched. A diff/merge
// keyed on `id` alone (mergeCloudDoc, countChangedTaskRows, changedProjectIds) reads that shift as
// real content change — a single insert can read as "every row below it changed."
//
// `_sid` is a second, permanent id: minted ONCE per task, on a fresh random basis, and never
// reassigned by renumberTasks or anything else — it rides along on every renumber exactly like any
// other content field (survives the `{...t, ...}` spread below untouched unless explicitly ordered
// otherwise). Diff/merge key on `_sid`; `id`/parentId/predecessors/etc. are UNCHANGED by this — the
// display numbering and cross-reference scheme stay exactly as they were. (`_mintTaskSid` itself is
// defined above, next to `mkt`, so the SEED fixture's own mkt() calls — evaluated at module load,
// long before this function ever runs — can mint one too.)
// Renumber all tasks by array position (1-based) and fix all ID references
export const renumberTasks = (tasks) => {
  const map = {};
  // B568: first-occurrence wins. If corrupt/legacy data carries DUPLICATE task ids (the app once
  // minted dupes before addTask switched to maxId+1, and normalizeIds does NOT dedup before this
  // remap), the LAST occurrence used to overwrite the map — so a parent/predecessor reference to a
  // duplicated id resolved to the stray copy lower in visual order instead of the original task,
  // silently scrambling the dependency graph on load. Guard makes the remap deterministic +
  // original-wins; no change for clean unique-id data (every other caller passes unique ids).
  tasks.forEach((t, i) => { if (!(t.id in map)) map[t.id] = i + 1; });
  // Every task-id POINTER must be remapped here or it silently re-points after any insert/delete/
  // indent (ids are reassigned to visual order every structural edit). deadlineForTaskId (deadline
  // rows) and minMeetingsAfter.taskId (the n-th-subsequent-meeting anchor — previously MISSING from
  // this remap, a latent re-pointing bug) follow the parentId/predecessors pattern; dangling → null.
  return tasks.map((t, i) => ({
    ...t,
    id: i + 1,
    // NEW-1 — preserve an existing _sid untouched (this is the same task as before, just renumbered);
    // mint a fresh one ONLY the first time this task is ever seen with none. A brand-new task created
    // via mkt()/addTask/insertTask/etc. always lacks _sid at this point and gets a genuinely fresh one
    // here — correct, since two tabs creating two DIFFERENT new tasks must never collide on identity.
    // (A task predating this fix, loaded from the cloud with no _sid at all, is backfilled
    // DETERMINISTICALLY by normalizeIds below, before it ever reaches this function — see _legacySid.)
    _sid: t._sid || _mintTaskSid(),
    parentId: t.parentId !== null && t.parentId !== undefined ? (map[t.parentId] ?? null) : null,
    predecessors: normPreds(t.predecessors).map(p => ({...p, id: map[p.id]})).filter(p => p.id),
    ...(t.deadlineForTaskId != null ? { deadlineForTaskId: map[t.deadlineForTaskId] ?? null } : {}),
    ...(t.minMeetingsAfter && t.minMeetingsAfter.taskId != null
      ? { minMeetingsAfter: (map[t.minMeetingsAfter.taskId] ? { ...t.minMeetingsAfter, taskId: map[t.minMeetingsAfter.taskId] } : undefined) }
      : {}),
  }));
};

// Sort tasks array into visual (tree-walk) order so IDs always match what the user sees
export const sortByVisualOrder = (tasks) => {
  const childMap = {};
  tasks.forEach(t => {
    const p = t.parentId ?? null;
    if (!childMap[p]) childMap[p] = [];
    childMap[p].push(t);
  });
  const result = [];
  const walk = (parentId) => {
    (childMap[parentId] || []).forEach(t => { result.push(t); walk(t.id); });
  };
  walk(null);
  // Append any orphaned tasks (parentId pointing to non-existent task) at the end
  const seen = new Set(result.map(t => t.id));
  tasks.filter(t => !seen.has(t.id)).forEach(t => result.push(t));
  return result;
};

// Visual (tree-walk) order with each task's depth attached — the same walk the grid itself uses
// to decide what's visible (respects isExpanded), needed by indent/outdent to find "the row above
// at the same level."
export const flatOrderWithLevel = (tasks) => {
  const kidsBy = new Map();
  tasks.forEach(t => { const p = t.parentId ?? null; if (!kidsBy.has(p)) kidsBy.set(p, []); kidsBy.get(p).push(t); });
  const out = [];
  const walk = (parentId, level) => {
    (kidsBy.get(parentId) || []).forEach(t => {
      out.push({ ...t, level });
      if (t.isExpanded) walk(t.id, level + 1);
    });
  };
  walk(null, 0);
  return out;
};

// ── Multi-row indent/outdent — the whole selected block moves as ONE unit, not just whichever
// row happens to be the keyboard anchor or the right-clicked row (the B<NEW> bug: a 6-row
// selection indented only one of the six, on both the keyboard and the context-menu path — both
// read a single task id and never consulted the selection range at all).
//
// SEMANTICS (Smartsheet-style, decided here rather than left emergent):
//  - A contiguous block indents/outdents AS A BLOCK: only its "root" rows — selected rows whose
//    PARENT is not itself selected — get reparented. A selected row whose parent IS also selected
//    is left untouched, so it keeps its existing depth relative to the row above it. That is how
//    "select a parent and its own children together" preserves relative depth for free, with no
//    special case: the child was never a root row, so nothing about it changes.
//  - INDENT is all-or-nothing, gated on the TOPMOST selected row only. Every root row in the block
//    moves to the SAME new parent (the row immediately above the topmost row, at the topmost
//    row's own level — identical eligibility rule to the pre-existing single-row indent). If the
//    topmost row has no eligible predecessor (e.g. it's already the first child of its parent),
//    the whole block is a clean no-op rather than indenting some rows under a target the topmost
//    one couldn't reach — there is no sensible partial result when every row shares one destination.
//  - OUTDENT has no shared destination — each promoted row's new parent is ITS OWN grandparent, so
//    a per-row skip cannot corrupt structure the way a partial multi-target indent could. Rows
//    already at depth 0 are left exactly where they are; everything else that can outdent, does,
//    independently. Adjacent root rows sharing the same current parent move together as one batch
//    (see outdentSelection below for why: moving them one at a time re-derives the insertion point
//    off the shrinking remainder and scrambles their relative order).
//  - Non-contiguous selection (e.g. rows 11, 14, 16 with gaps) DOES occur since B2530690 (Ctrl+click adds
//    ranges to `selRange`, the shared model in the RANGE-SELECTION block). These functions still assume ONE
//    contiguous block, so every caller refuses a multi-range selection with a visible message
//    (`blockOnlyTargets`) instead of acting on part of it. Delete, copy/cut, clear and formatting DO take
//    every range — they never go through here.
export const indentSelection = (tasks, selectedIds) => {
  const flatOrder = flatOrderWithLevel(tasks);
  const posById = new Map(flatOrder.map((t, i) => [t.id, i]));
  const idSet = new Set(selectedIds.filter(id => posById.has(id)));
  if (!idSet.size) return null;
  let topPos = Infinity;
  idSet.forEach(id => { const p = posById.get(id); if (p < topPos) topPos = p; });
  if (topPos <= 0) return null; // nothing above the topmost row at all
  const top = flatOrder[topPos];
  const L = top.level;
  let newParent = null;
  for (let i = topPos - 1; i >= 0; i--) {
    if (flatOrder[i].level === L) { newParent = flatOrder[i]; break; }
    if (flatOrder[i].level < L) break; // hit the topmost row's own parent first — no eligible sibling above it
  }
  if (!newParent) return null;
  const rootIds = [...idSet].filter(id => !idSet.has(flatOrder[posById.get(id)].parentId));
  if (rootIds.every(id => flatOrder[posById.get(id)].parentId === newParent.id)) return null; // already there
  const rootSet = new Set(rootIds);
  return tasks.map(t => {
    if (rootSet.has(t.id)) return { ...t, parentId: newParent.id };
    if (t.id === newParent.id) return { ...t, isExpanded: true, focused: false };
    return t;
  });
};

export const outdentSelection = (tasks, selectedIds) => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const idSet = new Set(selectedIds.filter(id => byId.has(id)));
  if (!idSet.size) return null;
  const rootIds = selectedIds.filter(id => idSet.has(id) && !idSet.has(byId.get(id).parentId));
  // Group ADJACENT (in the given top-to-bottom order) root ids that share the same CURRENT parent
  // into one batch, so a whole run of siblings is promoted and re-sequenced together in a single
  // splice — moving them one row at a time would recompute "the end of the old parent's remaining
  // subtree" against an array that's already lost the earlier movers, placing later movers ahead
  // of earlier ones and reversing the block's visual order.
  const groups = [];
  rootIds.forEach(id => {
    const t = byId.get(id);
    const last = groups[groups.length - 1];
    if (last && last.parentId === t.parentId) last.ids.push(id);
    else groups.push({ parentId: t.parentId, ids: [id] });
  });
  let working = [...tasks];
  let changed = false;
  groups.forEach(g => {
    if (g.parentId === null || g.parentId === undefined) return; // already depth 0 — clean no-op for this run
    const parent = working.find(t => t.id === g.parentId);
    if (!parent) return; // orphaned parentId — nothing sane to promote to
    const grandParentId = parent.parentId ?? null;
    const moveSet = new Set(g.ids);
    const subtreeIds = new Set([g.parentId]);
    const collect = pid => { working.filter(t => t.parentId === pid && !moveSet.has(t.id)).forEach(c => { subtreeIds.add(c.id); collect(c.id); }); };
    collect(g.parentId);
    const moved = g.ids.map(id => working.find(t => t.id === id)).filter(Boolean).map(t => ({ ...t, parentId: grandParentId }));
    const remaining = working.filter(t => !moveSet.has(t.id));
    let insertAfter = -1;
    remaining.forEach((t, i) => { if (subtreeIds.has(t.id)) insertAfter = i; });
    const reordered = [...remaining];
    reordered.splice(insertAfter + 1, 0, ...moved);
    working = grandParentId !== null ? reordered.map(t => t.id === grandParentId ? { ...t, focused: false } : t) : reordered;
    changed = true;
  });
  return changed ? working : null;
};

// ── Move-to-destination — the shared primitive behind BOTH the drag-and-drop row reorder and the
// "Move to…" command (NEW-ROWMOVE). A generalization of indentSelection's block rule above ("reparent
// only the block's ROOT rows — a selected row whose parent is also selected is left untouched") to an
// ARBITRARY destination parent + sibling position, instead of "the row above, at the topmost row's own
// level." Reparenting only the root rows is what carries the rest of the block along for free — both
// non-root selected rows AND any hidden/collapsed descendants outside the selection, since none of them
// have their parentId touched, and sortByVisualOrder rebuilds the whole tree purely from parentId. So the
// only rows that ever get their array position moved are the roots themselves.
//
// destParentId: the new parent (null = top level). insertAfterId: "start" = first child of destParentId,
// "end" (default) = last child, or a sibling id already resolvable under destParentId = right after that
// sibling. A stale/foreign/self-selected insertAfterId falls back to "end" rather than corrupting the tree.
export const moveSelectionToDestination = (tasks, selectedIds, destParentId, insertAfterId = "end") => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const idSet = new Set(selectedIds.filter(id => byId.has(id)));
  if (!idSet.size) return null;
  if (destParentId != null && !byId.has(destParentId)) return null; // destination vanished

  // A row can never move into itself or its own descendant — walk every moved row's subtree (in the
  // ORIGINAL tree, before any reparenting) and refuse if destParentId falls inside any of them. This
  // also catches destParentId being one of the moved rows itself (rootId === targetId base case).
  const isInSubtree = (rootId, targetId) => rootId === targetId || tasks.some(t => t.parentId === rootId && isInSubtree(t.id, targetId));
  if (destParentId != null && [...idSet].some(id => isInSubtree(id, destParentId))) return null;

  const rootIds = [...idSet].filter(id => !idSet.has(byId.get(id).parentId));
  if (!rootIds.length) return null;
  const rootSet = new Set(rootIds);

  let working = tasks.map(t => rootSet.has(t.id) ? { ...t, parentId: destParentId } : t);
  // Auto-expand the destination so the moved block is immediately visible where it landed — the
  // only way to "see" a drop into a collapsed group without requiring it to be expanded first.
  if (destParentId != null) working = working.map(t => t.id === destParentId ? { ...t, isExpanded: true, focused: false } : t);

  const movedInOrder = rootIds.map(id => working.find(t => t.id === id));
  const remaining = working.filter(t => !rootSet.has(t.id));

  let insertAt = -1;
  if (insertAfterId === "start") {
    const firstChildIdx = remaining.findIndex(t => t.parentId === destParentId);
    insertAt = firstChildIdx >= 0 ? firstChildIdx - 1 : (destParentId != null ? remaining.findIndex(t => t.id === destParentId) : -1);
  } else if (insertAfterId !== "end" && insertAfterId != null && !rootSet.has(insertAfterId) && remaining.some(t => t.id === insertAfterId)) {
    insertAt = remaining.findIndex(t => t.id === insertAfterId);
  } else {
    remaining.forEach((t, i) => { if (t.parentId === destParentId) insertAt = i; }); // after the last existing child
    if (insertAt === -1 && destParentId != null) insertAt = remaining.findIndex(t => t.id === destParentId);
    if (insertAt === -1) insertAt = remaining.length - 1; // top-level fallback: end of the array
  }
  const result = [...remaining];
  result.splice(insertAt + 1, 0, ...movedInOrder);

  // No-op guard: refuse (return null) when the move changes nothing about the tree's shape — same
  // parents, same relative order for every row, not just the moved ones (a splice that lands a block
  // back exactly where it started must not manufacture an undo entry).
  const key = list => list.map(t => `${t.id}:${t.parentId ?? "null"}`).join(",");
  return key(result) === key(tasks) ? null : result;
};

// ── NEW-ROWNEST — what a row-drag release means at a given pointer position (pure; GridView's drag
// calls this every frame and again on drop, the unit tests call it directly). A hovered row has THREE
// zones: the top and bottom bands mean "insert above / below this row" (the 2BAND rule, unchanged), and
// a CENTRE band means "make the dragged rows children of THIS row" — the only way to nest under a row
// that has no children yet, where there is no gap between a parent and a first child to aim at.
// WHY THE CENTRE BAND IS DELIBERATELY THE SMALLEST OF THE THREE (30% vs 35% + 35%): the original
// three-band drag (#1107) had a 40% "into" band, the biggest target on the row, and nested rows by
// accident ("I tried to move a task above another task, and it somehow put it as a subtask"). Nesting
// must be the deliberate, harder-to-hit outcome; ui-audit/verify-schedule-row-move.mjs asserts the
// ordering (into < before and into < after) at every row height.
export const ROW_NEST_BAND = 0.30;

export const rowDropZone = frac => frac < 0.5 - ROW_NEST_BAND / 2 ? "before" : frac >= 0.5 + ROW_NEST_BAND / 2 ? "after" : "into";

// The new PARENT + insertion anchor (+ resulting indent LEVEL, for the drop indicator) for a drop
// landing at gapIndex — "insert immediately before tasks[gapIndex]" in the CURRENT visible order,
// 0 <= gapIndex <= tasks.length. `blocked` = the dragged rows + every descendant: they are still
// physically present in `tasks` during the drag (only dimmed), so they cannot answer for "the row
// above/below" and are skipped. Depth rule (NEW-ROWMOVE-2BAND): match the row above the insertion
// point, but never shallower than the row below (the row below can only be deeper when it is the row
// above's own first child — landing shallower would silently adopt it).
export const resolveDropParent = (tasks, blocked, gapIndex) => {
  let ai = gapIndex - 1;
  while (ai >= 0 && blocked.has(tasks[ai].id)) ai--;
  const rowAbove = ai >= 0 ? tasks[ai] : null;
  let bi = gapIndex;
  while (bi < tasks.length && blocked.has(tasks[bi].id)) bi++;
  const rowBelow = bi < tasks.length ? tasks[bi] : null;
  if (!rowAbove) return { destParentId: null, insertAfterId: "start", level: 0 };
  if (rowBelow && rowBelow.parentId === rowAbove.id) return { destParentId: rowAbove.id, insertAfterId: "start", level: rowBelow.level };
  return { destParentId: rowAbove.parentId ?? null, insertAfterId: rowAbove.id, level: rowAbove.level };
};

// rowFloat = (pointer y within the row area − header) / ROW_H, fractional. Returns one of
//   {kind:"gap",     gapIndex, destParentId, insertAfterId, level}   insert above/below
//   {kind:"into",    index, targetId, destParentId, insertAfterId:"end"}   nest under the hovered row
//   {kind:"blocked", index}  the CENTRE of a row that is being dragged or sits inside one — a nest
//                            into itself / its own descendant is NOT a legal drop, shown as "not
//                            allowed" (never a silent no-op)
//   {kind:"none"}            over a blocked row's top/bottom band, or past the end of the list over one
export const rowDropIntent = (tasks, blocked, rowFloat) => {
  if (!tasks.length) return { kind: "none" };
  const idxRaw = Math.floor(rowFloat);
  const idx = Math.max(0, Math.min(tasks.length - 1, idxRaw));
  const hover = tasks[idx];
  const over = idxRaw >= 0 && idxRaw < tasks.length;   // the pointer is really ON a row
  if (blocked.has(hover.id)) return over && rowDropZone(rowFloat - idx) === "into" ? { kind: "blocked", index: idx } : { kind: "none" };
  let gapIndex;
  if (idxRaw < 0) gapIndex = 0;
  else if (idxRaw >= tasks.length) gapIndex = tasks.length;
  else {
    const zone = rowDropZone(rowFloat - idx);
    if (zone === "into") return { kind: "into", index: idx, targetId: hover.id, destParentId: hover.id, insertAfterId: "end" };
    gapIndex = zone === "before" ? idx : idx + 1;
  }
  return { kind: "gap", gapIndex, ...resolveDropParent(tasks, blocked, gapIndex) };
};

// B2445008 (×2) — where the pointer is, in ROWS, over the grid's scroll element. The grid scales
// itself with CSS `zoom` (Ctrl+wheel, `gridZoom`, kept per browser), so clientY and the element's
// bounding rect are VISUAL pixels while scrollTop, the header and every row's layout are the element's
// own, UNZOOMED CSS pixels. The first nest fix divided visual pixels by an unzoomed row height, so at
// any zoom other than 100% the drop resolved to a row ABOVE (zoom < 1) or BELOW (zoom > 1) the one
// under the pointer — and with the selection directly above the target, "the row above" is a dragged
// row, which offers no drop at all. `zoom` is MEASURED (rect height / layout height), never assumed.
export const rowFloatAtPointer = (clientY, rectTop, scrollTop, zoom, headerH, rowH) =>
  (((clientY - rectTop) / (zoom > 0 && isFinite(zoom) ? zoom : 1)) + scrollTop - headerH) / rowH;

// B2445008 (×2) — does a press on row `ri`'s ID cell PICK UP the selected rows (Microsoft Project's
// gesture: select rows by their ID, then drag an ID to move them) rather than start a new row
// selection? Only when the row is inside a multi-row, full-row selection — a press on any other ID
// cell (or on the only selected row) still selects/extends exactly as before. A press that does not
// move is a plain click and selects that one row (GridView's startRowDrag onClick).
export const idPressMovesRows = (selRange, ri, colCount) => {
  if (!selRange) return false;
  if (isMulti(selRange)) return false;   // B2530690 — several blocks selected: a plain press collapses to this row (Excel), it never picks them up
  const r1 = Math.min(selRange.r1, selRange.r2), r2 = Math.max(selRange.r1, selRange.r2);
  const c1 = Math.min(selRange.c1, selRange.c2), c2 = Math.max(selRange.c1, selRange.c2);
  return r2 > r1 && ri >= r1 && ri <= r2 && c1 === 0 && c2 >= colCount - 1;
};

// NEW-1 (2026-10-28) — "I'll just click a row by the left cell that selects the whole row, and it'll just
// automatically jump to move it." A press on a row's ID cell / grip used to ARM the move the instant the
// button went down (rows dimmed with a dashed outline, the page cursor pinned to "grabbing", a live drop
// target painted) and any release after 4 px of travel committed wherever the pointer then sat. A click
// is now a click until the held pointer has travelled a clear distance, and the distance depends on WHO is
// pressing: a finger or a pen wobbles far more than a mouse. Distances are SCREEN pixels (the travel of the
// hand, not of the zoomed grid). Pure, so test/scheduleIdClickNoMove.test.js runs the real function.
export const ROW_DRAG_THRESHOLD = { mouse: 6, pen: 10, touch: 16 };

export const rowDragThreshold = pointerType => ROW_DRAG_THRESHOLD[pointerType] || ROW_DRAG_THRESHOLD.mouse;

export const rowDragArmed = (pointerType, dx, dy) => Math.hypot(dx, dy) >= rowDragThreshold(pointerType);

// ── Delete-with-children: "keep subtasks" path — promote survivors to the nearest ancestor NOT
// being deleted. Handles a whole deleted CHAIN transitively (delete a parent and its own selected
// child together, and the child's own children promote past both, straight to the grandparent) —
// survivingAncestor walks past every deleted ancestor, not just the immediate one. No repositioning
// is needed: filtering never changes the relative order of the rows that remain, so a promoted row
// already sits exactly where it needs to among its new parent's other children.
export const promoteChildrenAndDelete = (tasks, deleteIds) => {
  const delSet = new Set(deleteIds);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const survivingAncestor = (parentId) => {
    let cur = parentId;
    while (cur !== null && cur !== undefined && delSet.has(cur)) cur = byId.get(cur)?.parentId ?? null;
    return cur ?? null;
  };
  return tasks.filter(t => !delSet.has(t.id)).map(t => (
    t.parentId != null && delSet.has(t.parentId) ? { ...t, parentId: survivingAncestor(t.parentId) } : t
  ));
};

// ── Insert row ABOVE the selection — the Insert key and the right-click "Insert row above" (NEW-1).
// Excel / Microsoft Project parity: the new row lands immediately above the selected row IN THE
// VISIBLE ORDER, and NOTHING that was hidden (Focus-filtered or collapsed) is expanded or unhidden.
// `visibleIds` is the grid's own visible order (flatTasks ids). Pure: returns the raw task array
// with `newTask` spliced in (parentId set) — every other task is returned untouched, so no
// isExpanded / focused flag can change. Parent rule, read off the VISIBLE row directly above:
//  · no row above (the selection is the first visible row) → same parent as the selection, directly
//    before it;
//  · the row above IS the selection's parent (selection is its first visible child) → same parent
//    as the selection, directly before it;
//  · otherwise → the next sibling of the row above: after that row's own (possibly hidden) subtree
//    and after any hidden siblings that follow it, i.e. directly before the first VISIBLE sibling
//    after it, or as its parent's last child when there is none. Sibling order is raw-array order
//    (sortByVisualOrder groups children by raw position), so placing newTask in the raw array is
//    all the positioning needed.
// An anchor that is null / not in the task list → appended at the end as a top-level row.
export const insertRowAbove = (tasks, visibleIds, anchorId, newTask) => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const anchor = anchorId == null ? null : byId.get(anchorId);
  if (!anchor) return [...tasks, { ...newTask, parentId: null }];
  const pos = visibleIds.indexOf(anchorId);
  const above = pos > 0 ? byId.get(visibleIds[pos - 1]) : null;
  const out = [...tasks];
  const anchorParent = anchor.parentId ?? null;
  if (!above || above.id === anchorParent) {
    out.splice(out.indexOf(anchor), 0, { ...newTask, parentId: anchorParent });
    return out;
  }
  const parentId = above.parentId ?? null;
  const visible = new Set(visibleIds);
  const siblings = tasks.filter(t => (t.parentId ?? null) === parentId);
  const after = siblings.slice(siblings.indexOf(above) + 1);
  const nextVisible = after.find(t => visible.has(t.id));
  const row = { ...newTask, parentId };
  if (nextVisible) out.splice(out.indexOf(nextVisible), 0, row);
  else out.splice(out.indexOf(siblings[siblings.length - 1]) + 1, 0, row);
  return out;
};

// B1873360 — MasterView's "Group by project" sections, keyed and ordered so two schedules that
// happen to share a bare name (the owner's live account has two schedules both named "Master
// Schedule", one under Goose Creek and one under Grand Port) can never merge into one section.
// Pure and standalone (no React) so it's unit-testable without rendering the table: unit-tested in 
// test/schedulerEngine.test.js (groupRowsByProject).
//
// Keys by `projId`, never by the bare schedule name — the old `groups[t.projName]` keying is
// exactly what let two differently-owned, identically-named schedules collapse into one bucket
// with a summed count badge. A schedule that filters/sorts down to zero rows here never gets a
// key at all (rows only arrives already filtered), so it renders no header — never an empty one.
//
// Groups are ordered by owner label, then schedule name, then `projId` as a stable tiebreak (two
// schedules can share BOTH a name and an owner before either is renamed) — never insertion order,
// which scattered one project's several schedules across the table instead of keeping them together.
export function groupRowsByProject(rows, order) {
  // NEW-1 (2026-10-08, B2210992 follow-up) — `order` is the owner's project order: the project (group)
  // ids the shell pushes (planar:project-order), the SAME list the Dashboard's Pursuits card uses. A
  // schedule linked to a project in that list sorts by that project's position; anything else (an
  // org-owned schedule, a project the shell doesn't know) keeps the owner-label order BENEATH them.
  // Schedules of ONE project stay together, by schedule name. The column sort never reaches this
  // function — it orders the rows WITHIN each group (they arrive already sorted).
  const rank = new Map();
  if (Array.isArray(order)) order.forEach((id, i) => { if (!rank.has(String(id))) rank.set(String(id), i); });
  const groups = new Map();
  rows.forEach(t => {
    if (!groups.has(t.projId)) groups.set(t.projId, []);
    groups.get(t.projId).push(t);
  });
  return [...groups.entries()]
    .map(([projId, gRows]) => {
      const siteId = gRows[0].projSiteId != null ? gRows[0].projSiteId : null;
      return {
        projId, gRows, siteId,
        rank: siteId != null && rank.has(String(siteId)) ? rank.get(String(siteId)) : Infinity,
        ownerLabel: gRows[0].projOwnerLabel || "",
        name: gRows[0].projName || "",
        label: gRows[0].projLabel || "",
      };
    })
    .sort((a, b) =>
      (a.rank !== b.rank ? (a.rank < b.rank ? -1 : 1) : 0) ||
      a.ownerLabel.localeCompare(b.ownerLabel) ||
      a.name.localeCompare(b.name) ||
      String(a.projId).localeCompare(String(b.projId)));
}
