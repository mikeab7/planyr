/* jurisdictionSwitch — the pure half of perf-jurisdiction-switch: what counts as "jurisdiction response
 * handling" in a long-animation-frame record, and whether a run is inside its budget.
 *
 * ⛔ WHAT THE OWNER'S CAPTURE ACTUALLY SAID (slow report 55807aa9, build 99c87bb). Its long-task names are
 * `Response.json.then:jurisdiction-CuR1TIW8.js:5638`. Two readings of that label are wrong and one is right:
 *   · WRONG — "line 5638". The number is `sourceCharPosition`, a CHARACTER offset into a minified chunk, and the label is
 *     cut to 48 characters by `perfCapture.sanitizeAttribution` (18 + 1 + 24 + 1 + 4), so the real offset is five digits
 *     (≈56383 in a rebuilt chunk) — the `await res.json()` inside `gisFetch.fetchArcgisJson`.
 *   · WRONG — "the JSON parse is slow". A parse of these payloads is single-digit milliseconds; the invoker NAMES the
 *     promise reaction that resumed, not the work it then did.
 *   · RIGHT — that resumed continuation runs every `.then` after it in ONE microtask chain, so the task is charged to
 *     `Response.json` for everything the chain does synchronously: the cache write, `cityAreasFromFeatures`' clipper
 *     intersections, and whatever consumer awaits the result. The label is where the task STARTED, not what it spent.
 * So attribution here is by INVOKER (`Response.json*`) or by the jurisdiction/gis chunk basename, never by the parse. */

const num = (v) => (Number.isFinite(v) ? v : 0);

/* Is this LoAF script entry work of the jurisdiction chunk? By CHUNK, whatever the invoker: the response continuation
 * (`Response.json.then`), and — since the share pass is time-sliced — each resumed slice (`Scheduler.yield.then`, or a timer / message
 * task on a browser without scheduler.yield). Matching only `Response.json*` made a first draft of this verdict count the unsliced
 * work and miss the slices, so a change that merely MOVED work out of the labelled task would have read as "0 ms". */
export function isJurisdictionScript(s) {
  if (!s) return false;
  return /jurisdiction-[\w-]+\.js/i.test(String(s.sourceURL || s.u || ""));
}

/* Reduce one run's recorded long tasks + long animation frames to the numbers the budget is written against. `win` is
 * [startMs, endMs] in performance.now() terms; only entries STARTING inside it count. */
export function attribute({ lt = [], loaf = [] } = {}, win = [0, Infinity]) {
  const inWin = (t) => t >= win[0] && t <= win[1];
  const tasks = lt.filter(([t]) => inWin(t)).map(([t, d]) => ({ t, d }));
  const frames = loaf.filter((f) => inWin(f.t));
  let attrMs = 0, attrMax = 0, attrCount = 0, frameMax = 0, frameCount = 0;
  const bySource = new Map();
  for (const f of frames) {
    let hit = false;
    for (const s of f.scripts || []) {
      if (!isJurisdictionScript(s)) continue;
      hit = true;
      const d = num(s.d != null ? s.d : s.duration);
      attrMs += d; attrCount++; if (d > attrMax) attrMax = d;
      const k = `${s.invoker || s.i}:${String(s.sourceURL || s.u || "").split("/").pop()}`;
      bySource.set(k, (bySource.get(k) || 0) + d);
    }
    /* the FRAME is what the user feels: slices that run back-to-back with no rendering opportunity between them are one stall to
     * the eye even when each task is short. Reported per frame that carried any jurisdiction work. */
    if (hit) { frameCount++; if (f.d > frameMax) frameMax = f.d; }
  }
  const totalMs = tasks.reduce((a, t) => a + t.d, 0);
  return {
    tasks: tasks.length, totalMs: +totalMs.toFixed(1), maxTaskMs: +Math.max(0, ...tasks.map((t) => t.d)).toFixed(1),
    over50: tasks.filter((t) => t.d > 50).length,
    jurisdictionScripts: attrCount, jurisdictionMs: +attrMs.toFixed(1), jurisdictionMaxMs: +attrMax.toFixed(1),
    jurisdictionFrames: frameCount, jurisdictionFrameMaxMs: +frameMax.toFixed(1),
    bySource: [...bySource.entries()].map(([k, v]) => [k, +v.toFixed(1)]).sort((a, b) => b[1] - a[1]),
  };
}

/* The budget: counts and ceilings, written against a REPLAYED run (recorded payloads, no network jitter), so the
 * numbers do not depend on how far the county server is from the runner. A scenario that did not exercise the path
 * at all is VOID, not green — a vacuous pass is exactly how this class of guard rots. */
export function verdict(scenarios = [], budget = {}) {
  const lines = []; let pass = true;
  const maxSingle = budget.maxSingleJurisdictionScriptMs ?? 50;
  const maxTotal = budget.maxJurisdictionMsPerScenario ?? 100;
  const minReq = budget.minGisRequests ?? 4;
  const maxFrame = budget.maxJurisdictionFrameMs ?? Infinity;
  for (const s of scenarios) {
    const a = s.attr || {};
    const exercised = (s.gisRequests || 0) >= minReq && (s.responses || 0) >= minReq;
    const okSingle = (a.jurisdictionMaxMs || 0) <= maxSingle;
    const okTotal = (a.jurisdictionMs || 0) <= maxTotal;
    /* tasks over 50 ms are REPORTED for every scenario but gated only when the budget names a ceiling: the plan's own load has
     * long tasks that are not this path (another session owns them), and gating on them would make this guard fail for the wrong reason. */
    const okLong = budget.maxTasksOver50ms == null || (a.over50 || 0) <= budget.maxTasksOver50ms;
    const okFrame = (a.jurisdictionFrameMaxMs || 0) <= maxFrame;
    const ok = exercised && okSingle && okTotal && okLong && okFrame;
    if (!ok) pass = false;
    lines.push(`${ok ? "PASS" : exercised ? "FAIL" : "VOID"}  ${String(s.name).padEnd(34)} gis ${s.gisRequests ?? "?"}/${s.responses ?? "?"}  jurisdiction ${a.jurisdictionMs ?? "?"} ms (max ${a.jurisdictionMaxMs ?? "?"}, worst frame ${a.jurisdictionFrameMaxMs ?? "?"})  tasks>50ms ${a.over50 ?? "?"}  longest ${a.maxTaskMs ?? "?"} ms${exercised ? "" : "  ← the scenario never reached the GIS path; nothing was measured"}`);
  }
  if (!scenarios.length) { pass = false; lines.push("VOID  no scenarios ran"); }
  return { pass, lines };
}
