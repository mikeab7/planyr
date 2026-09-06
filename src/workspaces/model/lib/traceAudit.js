/* Model workspace — Stage 3 (NEW-1, owner brief 2026-09-03): pure trace-precedents/dependents
 * stepping + render-model over sheetEngine.js's `graph` (evaluateWorkbook's own `hopsFor`/
 * `dependentsOf` — a READ-ONLY WALK of the existing per-cell dependency graph, never a second
 * one; see that file's header). This module owns nothing about the DOM or React — ModelApp.jsx
 * holds the `trace` object in plain state (never through undo/redo — a trace is a VIEW action,
 * the same "plain view state, not sheet data" convention zoom/painter/filterOn already use),
 * SheetView.jsx turns `renderableTrace`'s output into pixels for whichever sheet is on screen.
 *
 * LEVEL-AT-A-TIME, the way Excel's own Trace Precedents/Dependents buttons behave: the first
 * invocation on a cell shows its DIRECT precedents/dependents (level 1); invoking the SAME
 * button again on the SAME origin cell extends one level further. Every level already shown
 * stays drawn — arrows accumulate, they never replace — until "Remove Arrows" clears the whole
 * trace. Switching mode (Precedents -> Dependents) or origin cell always starts fresh at level 1
 * (`beginOrStepTrace` below is the one entry point that decides which of those happened).
 *
 * PERFORMANCE — a cell deep in a pro-forma can have hundreds of transitive dependents (or a
 * single shared constant can have hundreds of direct ones). `TRACE_STEP_CAP` bounds how many NEW
 * cells one single step is allowed to discover; a step that hits the cap sets `truncated: true`
 * on the trace so the UI can say so plainly rather than silently drawing a partial picture with
 * no explanation, or freezing the tab laying out thousands of arrows. Level-at-a-time stepping
 * already keeps each individual step bounded to one level's worth of fan-out — the cap is the
 * backstop for the pathological case where even ONE level is huge (a named constant every row of
 * a 1000-row sheet reads reaches the cap on its very first "Trace Dependents" click; the status
 * line reads "showing 400 of 1000+ — narrow the selection to see the rest" rather than hanging).
 */

export const TRACE_STEP_CAP = 400;

export const cellKey = (sheetId, row, col) => `${sheetId}:${row}:${col}`;

export function parseCellKey(key) {
  const [sheetId, r, c] = key.split(":");
  return { sheetId, row: Number(r), col: Number(c) };
}

function precedentNeighborKeys(graph, sheetId, row, col) {
  const hops = graph.hopsFor(sheetId, row, col);
  if (!hops) return [];
  const out = [];
  for (const hop of hops) for (const c of hop.cells) out.push(cellKey(hop.sheetId, c.row, c.col));
  return out;
}

function dependentNeighborKeys(graph, sheetId, row, col) {
  return [...graph.dependentsOf(sheetId, row, col)];
}

function freshTrace(mode, sheetId, row, col) {
  const originKey = cellKey(sheetId, row, col);
  return { mode, originSheetId: sheetId, originKey, levels: [[originKey]], visited: new Set([originKey]), truncated: false, noFurther: false };
}

/** Extend `trace` by exactly one level — the frontier is its OWN last level only, so the cost of
 *  one step is bounded by that one level's fan-out, never the whole accumulated trace. Returns a
 *  NEW trace object (never mutates); if the frontier has no unvisited neighbors at all (a true
 *  leaf — no further precedents/dependents), returns `{...trace, noFurther: true}` with an
 *  UNCHANGED `levels`/`visited`, so the caller can tell "nothing more to show" apart from "this
 *  step found more." */
export function stepTrace(trace, graph) {
  const frontier = trace.levels[trace.levels.length - 1];
  const discovered = [];
  const seenThisStep = new Set();
  let truncated = trace.truncated;
  stepLoop: for (const key of frontier) {
    const { sheetId, row, col } = parseCellKey(key);
    const neighbors = trace.mode === "precedents"
      ? precedentNeighborKeys(graph, sheetId, row, col)
      : dependentNeighborKeys(graph, sheetId, row, col);
    for (const nk of neighbors) {
      if (trace.visited.has(nk) || seenThisStep.has(nk)) continue;
      if (discovered.length >= TRACE_STEP_CAP) { truncated = true; break stepLoop; }
      discovered.push(nk);
      seenThisStep.add(nk);
    }
  }
  if (discovered.length === 0) return { ...trace, noFurther: true };
  const visited = new Set(trace.visited);
  for (const k of discovered) visited.add(k);
  return { ...trace, levels: [...trace.levels, discovered], visited, truncated, noFurther: false };
}

/** The one entry point Ribbon.jsx's Trace Precedents/Dependents buttons call. Same mode + same
 *  origin cell as the CURRENT trace (i.e. the button was clicked again on the same selection) ->
 *  step one level further; anything else (no trace yet, a different mode, or a different origin
 *  cell) -> start fresh at level 1. `existingTrace` may be `null`. */
export function beginOrStepTrace(existingTrace, mode, sheetId, row, col, graph) {
  const originKey = cellKey(sheetId, row, col);
  const sameOrigin = !!existingTrace && existingTrace.mode === mode && existingTrace.originKey === originKey;
  const base = sameOrigin ? existingTrace : freshTrace(mode, sheetId, row, col);
  return stepTrace(base, graph);
}

function boundingRect(cells) {
  let r1 = Infinity, c1 = Infinity, r2 = -Infinity, c2 = -Infinity;
  for (const c of cells) {
    if (c.row < r1) r1 = c.row;
    if (c.row > r2) r2 = c.row;
    if (c.col < c1) c1 = c.col;
    if (c.col > c2) c2 = c.col;
  }
  return { r1, c1, r2, c2 };
}

/** Turn a `trace` (mode + the full set of cells discovered so far, across every level) into what
 *  SheetView should actually draw for the sheet CURRENTLY on screen (`activeSheetId`) —
 *  everything else in the trace still exists (stepping further from it still works) but has
 *  nowhere to be drawn until its own sheet is the one being viewed.
 *
 *  Cross-sheet edges cannot be drawn as an arrow — the target sheet isn't mounted — so they
 *  become a `marker` at the cell that HELD the reference instead: which sheet, the label (a
 *  named range's own NAME when the reference was one, never the raw address — see
 *  collectRefHops's header), and the specific target cell a click should jump to. */
export function renderableTrace(trace, graph, activeSheetId) {
  if (!trace) return null;
  const arrows = [];
  const markers = [];
  if (trace.mode === "precedents") {
    // ⛔ A hop is drawn ONLY once its OWN target cell(s) are actually in `trace.visited` — a
    // cell that was merely DISCOVERED this step (the newest frontier) is visited but has not
    // been STEPPED FROM yet, so its own precedents must not appear a level early. Filtering
    // each hop's `cells` down to the visited subset (rather than tracking an "expanded" set
    // separately) also naturally clips a hop that TRACE_STEP_CAP cut off mid-range — the drawn
    // rect only ever covers what the trace has actually revealed.
    for (const key of trace.visited) {
      const { sheetId, row, col } = parseCellKey(key);
      if (sheetId !== activeSheetId) continue;
      const hops = graph.hopsFor(sheetId, row, col);
      if (!hops) continue;
      for (const hop of hops) {
        // spreadsheet-live-data-refs — a "project" hop (Site.Acres, Comp.<title>.RentPSF, …) has
        // no cells to reveal at all — its value comes from outside the grid entirely
        // (sheetEngine.js's collectRefHops) — so it can never pass the `revealed.length` gate
        // below. Surface it unconditionally as a marker instead, or it silently vanishes from
        // every trace the moment it's typed (the exact under-reporting this was built to avoid).
        if (hop.kind === "project") {
          markers.push({ atCell: { row, col }, label: hop.label, sourceLabel: hop.sourceLabel, targetSheetId: null, targetCell: null, direction: "in" });
          continue;
        }
        const revealed = hop.cells.filter((c) => trace.visited.has(cellKey(hop.sheetId, c.row, c.col)));
        if (revealed.length === 0) continue;
        if (hop.sheetId === activeSheetId) {
          arrows.push({ fromRect: boundingRect(revealed), toCell: { row, col }, label: hop.kind === "cell" ? null : hop.label, kind: hop.kind });
        } else {
          markers.push({ atCell: { row, col }, label: hop.label, targetSheetId: hop.sheetId, targetCell: revealed[0], direction: "in" });
        }
      }
    }
  } else {
    for (const key of trace.visited) {
      const { sheetId, row, col } = parseCellKey(key);
      if (sheetId !== activeSheetId) continue;
      const depKeys = graph.dependentsOf(sheetId, row, col);
      for (const depKey of depKeys) {
        if (!trace.visited.has(depKey)) continue; // only draw an edge INTO something the trace has actually revealed
        const d = parseCellKey(depKey);
        const depHops = graph.hopsFor(d.sheetId, d.row, d.col) || [];
        // Which of the DEPENDENT's own hops is the one that reads THIS cell — carries the
        // right label (a name/range this cell sits inside of) for the SAME edge, viewed from
        // the other direction.
        const hop = depHops.find((h) => h.sheetId === sheetId && h.cells.some((c) => c.row === row && c.col === col)) || null;
        if (d.sheetId === activeSheetId) {
          arrows.push({ fromRect: { r1: row, c1: col, r2: row, c2: col }, toCell: { row: d.row, col: d.col }, label: hop && hop.kind !== "cell" ? hop.label : null, kind: hop ? hop.kind : "cell" });
        } else {
          markers.push({ atCell: { row, col }, label: hop ? hop.label : d.sheetId, targetSheetId: d.sheetId, targetCell: { row: d.row, col: d.col }, direction: "out" });
        }
      }
    }
  }
  return {
    mode: trace.mode, level: trace.levels.length - 1, truncated: trace.truncated, noFurther: trace.noFurther,
    originKey: trace.originKey, cellCount: trace.visited.size, arrows, markers,
  };
}
