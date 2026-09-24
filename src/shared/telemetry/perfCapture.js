/* Building and encoding a performance capture (NEW-1) — and the privacy boundary that governs it.
 *
 * ⛔ THE PRIVACY RULE IS AN ALLOWLIST, NOT A HABIT, and that distinction is the entire point of
 * this file. The owner's condition was that a capture is *"something he would be comfortable
 * having read back to him"*: counters, timings and view state ONLY. No drawing geometry, no
 * parcel or county appraisal records, no owner names or addresses, no callout text, no raster
 * bytes. A denylist ("strip the fields we know are sensitive") fails the first time somebody adds
 * a field — which is exactly how telemetry accidents happen — so the payload is BUILT from a
 * fixed list of known keys and then PROVED against it:
 *
 *   • `CAPTURE_NUMERIC_KEYS` / `CAPTURE_ENUM_KEYS` are the complete surface. Anything else is a
 *     bug, and `assertCaptureClean()` says so rather than shipping it.
 *   • `test/perfRecorder.test.js` runs `assertCaptureClean` over a capture built from a fixture
 *     stuffed with realistic sensitive values (an owner name, a street address, a callout string,
 *     a polygon) and asserts none of them survive anywhere in the encoded string.
 *   • The plan identifier is SANITISED, not trusted: a plan id in this app can be a
 *     user-typed name, so anything outside `[A-Za-z0-9_-]` demotes the value to a short
 *     non-reversible hash. "Which plan" survives; "whose plan" never leaves the machine.
 *
 * This is the same discipline `scripts/extract-plan.mjs` already follows for plan fixtures.
 *
 * ⛔ AND WHY THERE IS AN ENCODER AT ALL. A capture rides the EXISTING `public.client_errors`
 * table — the precedent this repo names, and the one that needs no schema migration and no SQL
 * step from the owner (the B468 pattern). That column truncates at 2000 characters, and a
 * truncated payload is an unparseable payload. So the frame track is packed one character per
 * frame (a base-64 digit of milliseconds) with the rare slow frames carried as explicit pairs,
 * and the encoder TRIMS OLDEST-FIRST until it fits, recording how much it dropped. The FULL
 * capture, untrimmed, is kept on the device (IndexedDB, bounded — see perfCaptureStore.js), so
 * the compression costs fidelity only on the copy that has to travel.
 */

/** The wire format's version. Bump when a column's meaning changes, never for an addition. */
export const CAPTURE_VERSION = 1;

/** Characters available for the compact row. Deliberately under `clientErrors`' MSG_MAX (2000)
 *  with room for the tab prefix that wraps every event message. */
export const CAPTURE_MAX_CHARS = 1750;

/* Every scalar a capture may carry. NOTHING outside these two lists is permitted through
 * `assertCaptureClean`, which is what makes the privacy claim checkable instead of asserted. */
export const CAPTURE_NUMERIC_KEYS = [
  "v", "atMs", "atWall", "activeMs", "frames", "framesKept", "framesDropped",
  /* NEW-2 (B846385) — the long-task/counter twin of framesKept/framesDropped: which OTHER series
   * lost rows to the byte budget, so a reader can tell "there were none" from "some were cut". */
  "tasksDropped", "countersDropped",
  "baselineMs", "baselineFrames", "baselineSealedAtMs", "windowMeanMs", "slowFraction",
  "ratio", "multiplier", "sustainMs", "floorMs", "fires",
  /* NEW-3 — the boot-window judgment's own facts (perfTrigger.feedBootTask). Absent from every
   * ordinary steady-state capture; present only when a boot capture fired. */
  "bootTaskMs", "bootTaskCount",
  /* NEW-2 (this session) — the WORST window found anywhere in the retained frame history, not
   * just the live sustain window above. See perfTrigger.js's worstWindow() header for why this
   * exists: a manual capture pressed just after a lag ends must not report a clean "right now"
   * reading as if that were the whole story. */
  "worstWindowMeanMs", "worstWindowSlowFraction", "worstWindowRatio", "worstWindowFrames", "worstWindowAtMs",
  "p50Ms", "p95Ms", "p99Ms", "maxMs", "jankFrames",
  "longTasks", "longTaskMs", "longTaskMaxMs",
  "heapMB", "domNodes", "canvasNodes", "featuresDrawn", "elementsDrawn", "layersOn", "panelsOpen", "tiles",
  "ppf", "editsSinceLoad", "planSwitches", "dpr", "viewportW", "viewportH", "hardwareThreads",
  "deviceMemoryGB", "recorderSelfUs", "counterSamples", "sentRows",
];

export const CAPTURE_ENUM_KEYS = [
  "kind",        // "auto" | "manual"
  "route",       // the workspace id — site | markup | library | notes | …
  "plan",        // sanitised plan identifier, or a hash of one
  "planIdKind",  // "id" | "hash" — says which of the two the field above is
  "build",       // build id
  "baselineLate",// "y" | "n"
  "visibility",  // "visible" | "hidden"
  "layers",      // B265539 — WHICH GIS layers are on, by registry key. Public service names from
                 // this app's own table; sanitised, sorted, bounded, `+`-terminated when cut.

  "note",        // free-form ONLY from a fixed internal vocabulary — see NOTE_VOCAB
  "bootTrigger", // NEW-3 — "single" | "cumulative", which bar the boot judgment tripped; see BOOT_TRIGGER_VOCAB
];

/* A capture's `bootTrigger` may only ever be one of these — same discipline as NOTE_VOCAB. */
export const BOOT_TRIGGER_VOCAB = ["", "single", "cumulative"];

/* A capture's `note` may only ever be one of these. It exists so a capture can say something
 * about itself ("baseline never sealed") without opening a free-text channel.
 *
 * ⛔ `no-frames` (B265540) — THE WINDOW HELD NO FRAMES AT ALL, and it exists because the alternative
 * is a capture that looks ordinary and is empty. The frame loop is gated on interaction by design
 * (an idle tab's frame deltas measure the browser's throttling policy, not the app), so a MANUAL
 * capture taken in a still moment — he notices a panel is stuck, he has not moved the pointer for
 * five seconds — legitimately has no frame track. Such a capture is still worth having: it carries
 * the long tasks, the scene and the counter history. But a reader must be able to tell "nothing was
 * happening" from "the track was lost", because those support opposite conclusions, and the owner's
 * own button is the single worst place to be unable to tell. */
/* ⛔ NEW-1 (B1317824) — "trimmed" USED TO BE A BARE, UNDIFFERENTIATED FLAG covering three different
 * facts (a frame cut, a task cut, a counter cut) with no way to tell which. A reader could not tell
 * "the frame track survived intact" from "the frame track was thrown away entirely" without also
 * cross-checking framesKept — and the encoder itself made exactly that mistake (see encodeCapture's
 * header). The vocabulary now names WHICH series a genuine shortfall cut, so the note alone answers
 * the question the bare word never could. `trimmed-hard` is unchanged — the last-resort case where
 * even the reserved minimum still would not fit. */
export const NOTE_VOCAB = [
  "", "no-baseline", "baseline-late", "no-frames",
  "trimmed-frames", "trimmed-tasks", "trimmed-both", "trimmed-counters", "trimmed-hard",
];

/* ── Plan identity ───────────────────────────────────────────────────────────────────────────
 * A plan id here may be an opaque key OR a name the owner typed. Opaque-looking ids pass; anything
 * else becomes a short FNV-1a hash. Non-reversible, stable within and across sessions, and enough
 * to answer "is this always the same plan?" — which is the only question the recorder needs it for. */
export function safePlanId(raw) {
  const s = raw == null ? "" : String(raw);
  if (!s) return { plan: "", planIdKind: "id" };
  if (/^[A-Za-z0-9_-]{1,40}$/.test(s)) return { plan: s, planIdKind: "id" };
  return { plan: hash32(s), planIdKind: "hash" };
}

export function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ── Frame statistics ────────────────────────────────────────────────────────────────────────
 * Percentiles over the kept frames. `jankFrames` counts frames at or past the trigger's own slow
 * bar, so the headline number in a capture is measured the same way the decision to take it was. */
export function frameStats(deltas, slowBar) {
  const out = { frames: deltas.length, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: null, jankFrames: 0 };
  if (!deltas.length) return out;
  const v = Float64Array.from(deltas);
  v.sort();
  const at = (q) => v[Math.min(v.length - 1, Math.max(0, Math.round(q * (v.length - 1))))];
  out.p50Ms = r1(at(0.50));
  out.p95Ms = r1(at(0.95));
  out.p99Ms = r1(at(0.99));
  out.maxMs = r1(v[v.length - 1]);
  if (slowBar > 0) for (let i = 0; i < v.length; i++) if (v[i] >= slowBar) out.jankFrames++;
  return out;
}

/* ── The capture object ──────────────────────────────────────────────────────────────────────
 * `parts` is assembled by the recorder from its rings; this function is where the allowlist is
 * applied and where every value is rounded. Pure. */
export function buildCapture(parts) {
  const p = parts || {};
  const cap = {};
  const num = (k, v, d = 0) => { if (Number.isFinite(v)) cap[k] = d ? +(+v).toFixed(d) : Math.round(v); };
  const enu = (k, v) => { if (v != null && v !== "") cap[k] = String(v); };

  num("v", CAPTURE_VERSION);
  enu("kind", p.kind === "manual" ? "manual" : "auto");
  num("atMs", p.atMs);      // ms since this page loaded — the "a minute or two later" axis
  num("atWall", p.atWall);  // wall clock, so two captures from two sessions can be ordered
  num("activeMs", p.activeMs);
  enu("route", p.route);
  enu("build", p.build);
  enu("visibility", p.visibility);
  enu("layers", p.layers);

  const plan = safePlanId(p.planId);
  enu("plan", plan.plan);
  if (plan.plan) enu("planIdKind", plan.planIdKind);

  /* Trigger verdict — the numbers that justify the capture existing. */
  num("baselineMs", p.baselineMs, 1);
  num("baselineFrames", p.baselineFrames);
  num("baselineSealedAtMs", p.baselineSealedAtMs);
  enu("baselineLate", p.baselineLate ? "y" : "n");
  num("windowMeanMs", p.windowMeanMs, 1);
  num("slowFraction", p.slowFraction, 2);
  num("ratio", p.ratio, 2);
  num("multiplier", p.multiplier, 2);
  num("sustainMs", p.sustainMs);
  num("floorMs", p.floorMs);
  num("fires", p.fires);
  /* NEW-3 — present only on a boot-window capture (perfTrigger.feedBootTask's verdict). */
  num("bootTaskMs", p.bootTaskMs, 1);
  num("bootTaskCount", p.bootTaskCount);
  enu("bootTrigger", p.bootTrigger);
  /* NEW-2 — the worst sub-window found anywhere in the retained frame history. Omitted (not just
   * zero) when there wasn't enough retained history to find one — `num()` already does that for
   * any non-finite value, so a capture with no worst window simply carries none of these keys. */
  num("worstWindowMeanMs", p.worstWindowMeanMs, 1);
  num("worstWindowSlowFraction", p.worstWindowSlowFraction, 2);
  num("worstWindowRatio", p.worstWindowRatio, 2);
  num("worstWindowFrames", p.worstWindowFrames);
  num("worstWindowAtMs", p.worstWindowAtMs);

  /* Frame distribution over the retained window. */
  const fs = p.frameStats || {};
  num("frames", fs.frames);
  num("p50Ms", fs.p50Ms, 1);
  num("p95Ms", fs.p95Ms, 1);
  num("p99Ms", fs.p99Ms, 1);
  num("maxMs", fs.maxMs, 1);
  num("jankFrames", fs.jankFrames);

  num("longTasks", p.longTasks);
  num("longTaskMs", p.longTaskMs);
  num("longTaskMaxMs", p.longTaskMaxMs);

  /* The scene, at the moment of capture. */
  num("heapMB", p.heapMB, 1);
  num("domNodes", p.domNodes);
  num("canvasNodes", p.canvasNodes);
  num("featuresDrawn", p.featuresDrawn);
  num("elementsDrawn", p.elementsDrawn);
  num("layersOn", p.layersOn);
  num("panelsOpen", p.panelsOpen);
  num("tiles", p.tiles);
  num("ppf", p.ppf, 3);
  num("editsSinceLoad", p.editsSinceLoad);
  num("planSwitches", p.planSwitches);

  /* The machine. Coarse and non-identifying — the platform rounds deviceMemory to a power of two
   * and hardwareConcurrency is a core count. Neither narrows anyone down; both change how a frame
   * time should be read. */
  num("dpr", p.dpr, 2);
  num("viewportW", p.viewportW);
  num("viewportH", p.viewportH);
  num("hardwareThreads", p.hardwareThreads);
  num("deviceMemoryGB", p.deviceMemoryGB, 1);
  num("recorderSelfUs", p.recorderSelfUs, 2);
  num("counterSamples", p.counterSamples);

  /* Series. Arrays of NUMBERS only — never of records, never of strings except the interned
   * attribution table, which holds script URLs from this app's own build. */
  cap.f = Array.isArray(p.frameDeltas) ? p.frameDeltas.map((d) => r1(d)) : [];
  cap.g = Array.isArray(p.gaps) ? p.gaps.map((g) => [Math.round(g[0]), Math.round(g[1])]) : [];
  cap.lt = Array.isArray(p.tasks) ? p.tasks.map((t) => [Math.round(t[0]), Math.round(t[1]), Math.round(t[2]), t[3] | 0]) : [];
  cap.ltNames = Array.isArray(p.taskNames) ? p.taskNames.map(sanitizeAttribution) : [];
  cap.c = Array.isArray(p.counters) ? p.counters.map((row) => row.map((x) => (Number.isFinite(x) ? r2(x) : null))) : [];
  cap.cCols = Array.isArray(p.counterColumns) ? p.counterColumns.slice() : [];

  enu("note", NOTE_VOCAB.includes(p.note) ? p.note : "");
  if (cap.note === "") delete cap.note;
  return cap;
}

/* Attribution strings come from the platform's LoAF `sourceURL` / `invoker` / `sourceFunctionName`
 * — this app's own bundle. They are still sanitised: strip any query string or fragment (a URL in
 * this app can carry a plan id), keep the last path segment, and cap the length. */
export function sanitizeAttribution(s) {
  const raw = s == null ? "" : String(s);
  const noQuery = raw.split("?")[0].split("#")[0];
  const tail = noQuery.split("/").pop() || noQuery;
  return tail.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 48);
}

/* ⛔ B844416 — `sourceFunctionName` is empty for every ANONYMOUS script, which covers every
 * Leaflet-scheduled callback and every app-level requestAnimationFrame arrow. The naive fallback
 * chain `sourceFunctionName || invoker || sourceURL` never reaches `sourceURL`, because `invoker`
 * is a non-empty CATEGORY constant ("FrameRequestCallback", "EventListener.wheel", …) for every one
 * of those — so a long-animation-frame entry attributed nothing more specific than "an animation
 * frame ran", true of most of the app. Measured in the owner's 2026-08-29 production capture: the
 * four worst blocks (515–606 ms each) all carried exactly that constant and nothing else.
 *
 * When there is no real function name, this folds the invoker CATEGORY together with a compact
 * SOURCE LOCATION (the script's file basename + its character offset) so two different anonymous
 * callbacks are distinguishable — `FrameRequestCallback:index-4f2a.js:81422` rather than a bare
 * `FrameRequestCallback` repeated for every long frame in the app. The basename is extracted via
 * `sanitizeAttribution` (never a raw URL) and the combined label carries no `/`, so the later
 * ltNames sanitisation pass in `buildCapture` cannot mis-truncate it on a slash that belongs to the
 * URL rather than to the label. */
export function attributionLabel(script) {
  const s = script || {};
  const fn = s.sourceFunctionName ? String(s.sourceFunctionName) : "";
  if (fn) return fn;
  const invoker = s.invoker ? String(s.invoker) : "";
  const basename = s.sourceURL ? sanitizeAttribution(s.sourceURL) : "";
  const pos = Number.isFinite(s.sourceCharPosition) && s.sourceCharPosition >= 0 ? s.sourceCharPosition : null;
  if (invoker && basename) return pos != null ? `${invoker}:${basename}:${pos}` : `${invoker}:${basename}`;
  return invoker || basename;
}

/* ── The privacy proof ───────────────────────────────────────────────────────────────────────
 * Walk a built capture and return every violation found: an unknown key, a non-finite number, a
 * string where a number belongs, or a string anywhere in the series. Returns [] for a clean
 * capture. The unit tests assert [] over a capture built from a deliberately dirty fixture; the
 * recorder calls it before every send and refuses to send a capture that fails, because a
 * telemetry payload that has to be trusted is not a boundary. */
export function assertCaptureClean(cap) {
  const bad = [];
  const numeric = new Set(CAPTURE_NUMERIC_KEYS);
  const enums = new Set(CAPTURE_ENUM_KEYS);
  const series = new Set(["f", "g", "lt", "ltNames", "c", "cCols"]);
  for (const [k, v] of Object.entries(cap || {})) {
    if (numeric.has(k)) {
      if (typeof v !== "number" || !Number.isFinite(v)) bad.push(`${k}: not a finite number`);
    } else if (enums.has(k)) {
      if (typeof v !== "string") bad.push(`${k}: not a string`);
      else if (v.length > 48) bad.push(`${k}: over-long`);
      else if (k === "note" && !NOTE_VOCAB.includes(v)) bad.push(`note: outside the fixed vocabulary`);
      else if (k === "bootTrigger" && !BOOT_TRIGGER_VOCAB.includes(v)) bad.push(`bootTrigger: outside the fixed vocabulary`);
      else if (k === "plan" && !/^[A-Za-z0-9_-]*$/.test(v)) bad.push(`plan: unsanitised`);
      else if (k === "layers" && !/^[a-z0-9_,+]*$/i.test(v)) bad.push(`layers: unsanitised`);
    } else if (series.has(k)) {
      if (!Array.isArray(v)) bad.push(`${k}: not an array`);
      else if (k === "ltNames" || k === "cCols") {
        for (const s of v) if (typeof s !== "string" || !/^[A-Za-z0-9_.:-]*$/.test(s)) bad.push(`${k}: unsanitised entry`);
      } else {
        for (const row of v) {
          const cells = Array.isArray(row) ? row : [row];
          for (const cell of cells) if (cell !== null && (typeof cell !== "number" || !Number.isFinite(cell))) bad.push(`${k}: non-numeric cell`);
        }
      }
    } else {
      bad.push(`${k}: not on the allowlist`);
    }
  }
  return bad;
}

/* ── Compact encoding ────────────────────────────────────────────────────────────────────────
 * The frame track is the bulk of a capture, so it gets a dense representation: one base-64 digit
 * per frame holding the delta in whole milliseconds, clamped to 63. Frames past 63 ms — the ones
 * that matter most — are ALSO carried explicitly in `x` as [index, ms] so the clamp never hides a
 * stall. Everything else is ordinary JSON.
 *
 * `encodeCapture` trims OLDEST-FIRST until the whole row fits `maxChars`, and reports what it
 * dropped. A capture that silently lost its tail would read as a shorter, calmer episode than the
 * one that actually happened. */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/* The frame-count ladder `encodeCapture` sheds down (B265541). 60 is the historic floor and is
 * still tried first — a comfortable window nobody has to caveat. Below it the episode gets shorter
 * but stays REAL, and only past the last rung is the bare row the honest answer. */
const FRAME_FLOORS = [60, 30, 16, 8];

export function encodeFrames(deltas) {
  let track = "";
  const spikes = [];
  for (let i = 0; i < deltas.length; i++) {
    const ms = Math.round(deltas[i]);
    track += B64[Math.max(0, Math.min(63, ms))];
    if (ms > 63) spikes.push([i, Math.min(65535, ms)]);
  }
  return { track, spikes };
}

export function decodeFrames(track, spikes) {
  const out = new Array(track.length);
  for (let i = 0; i < track.length; i++) out[i] = B64.indexOf(track[i]);
  for (const [i, ms] of spikes || []) if (i >= 0 && i < out.length) out[i] = ms;
  return out;
}

/* ⛔ NEW-2 (B846385) — THE OLD ORDER SHED THE LONG-TASK TABLE FIRST, WHICH THREW AWAY THE MOST
 * DIAGNOSTIC PART OF THE CAPTURE EXACTLY WHEN THE EPISODE WAS WORST. Measured on the owner's real
 * 2026-09-01 Richfield capture: 1,201 long tasks totalling 92,232 ms, encoded to `note:"trimmed"`,
 * `framesKept:8` — and NO `lt`/`ltNames`/`c`/`cCols` at all. Not one of the 1,201 blocking tasks
 * was attributed to a name, file or line; the only thing that survived was 8 frame samples.
 *
 * A frame TRACK is mostly redundant once the summary stats exist — `frames`/`p50Ms`/`p95Ms`/
 * `p99Ms`/`maxMs`/`jankFrames` already ride the numeric columns (`buildCapture`, above) and answer
 * "how bad, how often" on their own. A long-task ROW is the only place a script gets a NAME
 * (`attributionLabel`) — it is not recoverable from anything else in the payload.
 *
 * ⛔ NEW-1 (B1317824) — THAT FIX OVERCORRECTED: SHEDDING THE FRAME TRACK "ALL THE WAY TO ZERO IF
 * THAT'S WHAT IT TAKES" MEANT THE WORSE THE STALL, THE MORE LONG TASKS IT PRODUCED, THE LESS OF THE
 * FRAME EVIDENCE SURVIVED — the exact shape the PR 951 trigger defect was in (a fixed budget that gets
 * LESS likely to succeed the worse the case it exists for gets). Measured on the owner's real
 * 2026-09-07 row: 114 frames, ~20 long tasks, `framesKept:0`, `framesDropped:114`, `ft` the empty
 * string — the frame track lost ENTIRELY to a long-task table that was never even trimmed. A
 * capture with no frame track at all is close to useless: it is the one series `attributionLabel`
 * doesn't cover and the reason this whole feature exists.
 *
 * So the two series now share the row rather than either one owning it outright. The frame track
 * gets a RESERVED FLOOR (the same `8` that was already the last rung of `FRAME_FLOORS` — no new
 * magic number) that survives as long as any long task remains; the long-task table is trimmed
 * OLDEST-FIRST into whatever room is left, exactly the direction the frame track already trims in
 * (dropping the earliest evidence, keeping the most recent). Only once the long-task table is
 * completely empty does the frame reserve itself give way, down toward zero. Counters are still shed
 * first of all, unchanged, because a scene snapshot is the least time-critical fact in the row.
 *
 * ⛔ B1892128 (2026-09-24) — "OLDEST-FIRST" ABOVE WAS NEVER TRUE OF THE TASK TABLE, ONLY OF THE
 * FRAME TRACK. `tasks` arrives from the recorder already sorted WORST-FIRST (duration descending —
 * "the biggest blocks are the ones worth the characters", perfRecorder.js's `taskOrder`), so
 * shedding from the FRONT of that array discarded the LARGEST tasks first, not the oldest ones —
 * the opposite of what this paragraph claims and the opposite of what the table exists to protect.
 * See `shedTasks` below for the fix (shed the TAIL, where the smallest durations sit once the array
 * is worst-first) and its own header for the real production row that caught it. */
export function encodeCapture(cap, { maxChars = CAPTURE_MAX_CHARS } = {}) {
  const base = { ...cap };
  const deltas = Array.isArray(base.f) ? base.f.slice() : [];
  delete base.f;

  /* ⛔ NEW-2 (B846385) — `ltNames` SHIPPED THE WHOLE SESSION-WIDE STRING TABLE (up to
   * `STRING_TABLE_MAX` = 64 entries, perfRing.js) ON EVERY CAPTURE, not just the names the kept
   * `tasks` actually reference. A session that accumulates many distinct attributions over its
   * life can fill that table with long strings that alone exceed `maxChars` — no amount of
   * shedding `tasks` or `frames` helps, because the names array cost is independent of how many
   * task ROWS survive. So every `build()` re-indexes to a table holding ONLY the names the
   * CURRENTLY KEPT tasks reference, which is rarely more than a handful even when the session-wide
   * table is full. */
  const namesFull = Array.isArray(base.ltNames) ? base.ltNames : [];
  const build = (frames, tasks, counters) => {
    const { track, spikes } = encodeFrames(frames);
    const remap = new Map();
    const names = [];
    const lt = tasks.map((t) => {
      const label = namesFull[t[3] | 0] || "";
      let idx = remap.get(label);
      if (idx == null) { idx = names.length; names.push(label); remap.set(label, idx); }
      return [t[0], t[1], t[2], idx];
    });
    const row = { ...base, ft: track, fx: spikes, lt, ltNames: names, c: counters };
    if (!row.fx.length) delete row.fx;
    if (!row.lt.length) { delete row.lt; delete row.ltNames; }
    if (!row.c.length) { delete row.c; delete row.cCols; }
    return JSON.stringify(row);
  };

  let frames = deltas;
  let tasks = Array.isArray(base.lt) ? base.lt.slice() : [];
  let counters = Array.isArray(base.c) ? base.c.slice() : [];
  let s = build(frames, tasks, counters);
  let trimmedFrames = 0, trimmedTasks = 0, trimmedCounters = 0;

  // Stage 1 — shed the oldest counter samples first: a scene snapshot is the least time-critical
  // fact in the row, so it always yields before either the frame track or the long-task table.
  while (s.length > maxChars && counters.length > 6) { counters.shift(); trimmedCounters++; s = build(frames, tasks, counters); }

  /* ⛔ B265541 — THE FRAME FLOOR IS A LADDER, NOT A WALL, AND THE OLD WALL LOST THE WHOLE EPISODE
   * ON EXACTLY THE WORST CAPTURES. A frame over 63 ms cannot be held in the packed track's one
   * base-64 digit, so it is ALSO carried explicitly in `fx` as `[index, ms]` — about ten characters
   * apiece. On a smooth capture almost nothing lands in `fx`; on a genuine stall almost EVERYTHING
   * does, so 60 retained frames can cost ~660 characters on their own — the jankier the episode,
   * the likelier the row overran a fixed floor. The ladder steps the floor down in stages
   * (60 → 30 → 16 → 8) so a bad episode still keeps SOME frames rather than losing the whole track
   * to one hard cutoff. Stage 2 stops at the ladder's LAST rung (8) — see NEW-1 below for why that
   * rung is now a protected reserve rather than just another step toward zero. */
  const shedFrames = (floor) => {
    while (s.length > maxChars && frames.length > floor) {
      const drop = Math.max(1, Math.min(frames.length - floor, Math.ceil((s.length - maxChars) / 1.2)));
      frames = frames.slice(drop);
      trimmedFrames += drop;
      s = build(frames, tasks, counters);
    }
  };
  const shedFramesToFit = (floors) => { for (const floor of floors) { shedFrames(floor); if (s.length <= maxChars) return; } };
  // Stage 2 — shed frames down the ladder to its reserved floor (never below it while a task remains).
  shedFramesToFit(FRAME_FLOORS);

  /* ⛔ NEW-1 (B1317824) — TASKS NOW TRIM OLDEST-FIRST, THE SAME DIRECTION THE FRAME TRACK ALREADY
   * TRIMS IN, so a reader can say "the most recent N tasks" the same way it already says "the most
   * recent N frames." The FLOOR (4) is the smallest set still worth naming — this is unchanged from
   * the old code, only the direction of what gets dropped first has changed (oldest, not shortest).
   *
   * ⛔ B1892128 (2026-09-24) — THAT "OLDEST-FIRST" DIRECTION WAS WRONG, BECAUSE `tasks` IS NOT
   * CHRONOLOGICAL. It arrives from `perfRecorder.js`'s `capture()` already sorted WORST-FIRST
   * (duration descending — "the biggest blocks are the ones worth the characters"), so index 0
   * holds the LONGEST task, not the oldest one. Shedding `tasks[0]` therefore discarded the most
   * diagnostic rows first — exactly backwards, since a long-task row is the only place a script
   * gets a NAME (`ltNames`) and the biggest blocks are the ones worth naming.
   *
   * Measured on a real Sylvestri capture (client_errors row `0f5ceb12-e62f-4b36-8a31-c3e5764ccf51`,
   * 2026-09-23 16:23:36Z): 54 long tasks recorded, only 17 survived trim — all in the 51-94 ms
   * band — while the 1,216 ms worst task, the one that would have named the slow code path, was
   * the very first one dropped.
   *
   * The array is already worst-first, so the smallest durations sit at the TAIL — shed from there
   * instead, and the kept set is always the biggest N tasks, which is the whole reason the
   * producer sorted them that way to begin with. */
  const TASK_FLOOR = 4;
  const shedTasks = (floor) => {
    while (s.length > maxChars && tasks.length > floor) {
      tasks = tasks.slice(0, -1);
      trimmedTasks++;
      s = build(frames, tasks, counters);
    }
  };
  // Stage 3 — shed the long-task table smallest-first (the tail of the worst-first order the
  // recorder produced) into whatever room the frame reserve left, so the biggest blocks survive.
  shedTasks(TASK_FLOOR);

  const stampFrames = () => { base.framesKept = frames.length; base.framesDropped = trimmedFrames; };
  const stampTasksCounters = () => {
    if (trimmedTasks) base.tasksDropped = trimmedTasks;
    if (trimmedCounters) base.countersDropped = trimmedCounters;
  };
  /* ⛔ NEW-1 (B1317824) — THE NOTE NAMES WHICH LIST WAS CUT, NEVER A BARE "trimmed". A reader used
   * to have to cross-check `framesKept` against `frames` to learn whether the frame track survived
   * at all; now the note says so directly. */
  const stampNote = () => {
    if (trimmedFrames && trimmedTasks) base.note = "trimmed-both";
    else if (trimmedTasks) base.note = "trimmed-tasks";
    else if (trimmedFrames) base.note = "trimmed-frames";
    else if (trimmedCounters) base.note = "trimmed-counters";
  };
  /* Stamping the trim onto the row makes the row LONGER, which can push it back over the budget —
   * so the accounting keys go on first and both sheds run again underneath them. Getting this
   * order wrong is what made a capture fall all the way through to the bare last-resort row while
   * a perfectly good frame track was available. */
  if (trimmedFrames || trimmedTasks || trimmedCounters) {
    stampFrames(); stampTasksCounters(); stampNote();
    s = build(frames, tasks, counters);
    shedFramesToFit(FRAME_FLOORS);
    shedTasks(TASK_FLOOR);
    stampFrames(); stampTasksCounters(); stampNote();
    s = build(frames, tasks, counters);
  }

  /* ⛔ NEW-1 (B1317824) — THE FRAME RESERVE OUTRANKS THE TASK FLOOR NOW: the long-task table gives
   * up its remaining entries, ALL THE WAY TO ZERO, before the frame track is ever asked to drop
   * below its own reserved floor. This is the exact inversion of the B846385 order (which sacrificed
   * the frame track to zero before touching the task floor) — that direction is precisely how a
   * capture came back with `framesKept:0` while a full long-task table survived untouched. */
  if (s.length > maxChars && tasks.length > 0) {
    shedTasks(0);
    stampFrames(); stampTasksCounters(); stampNote();
    s = build(frames, tasks, counters);
  }

  /* Only now, with the long-task table already empty, does the frame reserve itself give way —
   * the last-resort case where even 8 frames plus the base fields will not fit. */
  if (s.length > maxChars && frames.length > 0) {
    trimmedFrames += frames.length;
    frames = [];
    stampFrames(); stampTasksCounters(); stampNote();
    s = build(frames, tasks, counters);
  }

  // Give up whatever counters remain — should already be at floor from Stage 1, kept for parity.
  if (s.length > maxChars && counters.length) {
    trimmedCounters += counters.length;
    counters = [];
    stampFrames(); stampTasksCounters(); stampNote();
    s = build(frames, tasks, counters);
  }
  if (s.length > maxChars) {
    base.note = "trimmed-hard";
    s = build(frames, tasks, counters);
  }
  /* Last resort: the row still does not fit (a pathological attribution table). Drop the series
   * entirely rather than emit something the column will truncate into unparseable JSON — the
   * headline numbers are worth more than a half-written track. */
  if (s.length > maxChars) {
    const bare = { ...base, note: "trimmed-hard", framesKept: 0, framesDropped: deltas.length };
    delete bare.lt; delete bare.ltNames; delete bare.c; delete bare.cCols;
    s = JSON.stringify(bare);
  }
  return { text: s, chars: s.length, trimmedFrames, trimmedTasks, trimmedCounters, fits: s.length <= maxChars };
}

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
