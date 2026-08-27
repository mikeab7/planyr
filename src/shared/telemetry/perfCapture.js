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
  "baselineMs", "baselineFrames", "baselineSealedAtMs", "windowMeanMs", "slowFraction",
  "ratio", "multiplier", "sustainMs", "floorMs", "fires",
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
];

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
export const NOTE_VOCAB = ["", "no-baseline", "baseline-late", "no-frames", "trimmed", "trimmed-hard"];

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

export function encodeCapture(cap, { maxChars = CAPTURE_MAX_CHARS } = {}) {
  const base = { ...cap };
  const deltas = Array.isArray(base.f) ? base.f.slice() : [];
  delete base.f;

  const build = (frames, tasks, counters) => {
    const { track, spikes } = encodeFrames(frames);
    const row = { ...base, ft: track, fx: spikes, lt: tasks, c: counters };
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

  /* Shed in order of what a reader can most afford to lose: the oldest counter samples first
   * (the recent ones describe the episode), then the smallest long tasks, then the oldest
   * frames. Frames go last because the frame track IS the episode. */
  while (s.length > maxChars && counters.length > 6) { counters.shift(); trimmedCounters++; s = build(frames, tasks, counters); }
  while (s.length > maxChars && tasks.length > 4) {
    let min = 0;
    for (let i = 1; i < tasks.length; i++) if (tasks[i][1] < tasks[min][1]) min = i;
    tasks.splice(min, 1); trimmedTasks++; s = build(frames, tasks, counters);
  }
  /* ⛔ B265541 — THE FRAME FLOOR IS A LADDER, NOT A WALL, AND THE OLD WALL LOST THE WHOLE EPISODE
   * ON EXACTLY THE WORST CAPTURES. This used to stop shedding at 60 frames and, if the row still
   * did not fit, fall through to the bare last-resort row — which drops EVERY series, frame track
   * included. Caught by `ui-audit/verify-capture-pipe.mjs` on a real induced stall: one auto
   * capture arrived `note:"trimmed-hard"` with `framesKept:0`.
   *
   * The mechanism is a perverse one. A frame over 63 ms cannot be held in the packed track's one
   * base-64 digit, so it is ALSO carried explicitly in `fx` as `[index, ms]` — about ten characters
   * apiece. On a smooth capture almost nothing lands in `fx`; on a genuine stall almost EVERYTHING
   * does, so 60 retained frames can cost ~660 characters on their own. The jankier the episode, the
   * likelier the row overran the floor — and the reward for overrunning it was losing all of it.
   * A capture of a bad moment is the only kind worth having, so the failure was aimed at the data
   * this whole programme exists to collect.
   *
   * Thirty frames of a stall is half a second of evidence and is worth far more than nothing, so
   * the floor now steps down and the bare row is reached only if even `FRAME_FLOOR_MIN` will not
   * fit. `framesKept`/`framesDropped` still say exactly what was lost. */
  const shedFrames = (floor) => {
    while (s.length > maxChars && frames.length > floor) {
      const drop = Math.max(1, Math.min(frames.length - floor, Math.ceil((s.length - maxChars) / 1.2)));
      frames = frames.slice(drop);
      trimmedFrames += drop;
      s = build(frames, tasks, counters);
    }
  };
  const shedToFit = () => { for (const floor of FRAME_FLOORS) { shedFrames(floor); if (s.length <= maxChars) return; } };
  shedToFit();

  /* Stamping the trim onto the row makes the row LONGER, which can push it back over the budget —
   * so the accounting keys go on first and the frame shed runs again underneath them. Getting this
   * order wrong is what made a capture fall all the way through to the bare last-resort row while
   * a perfectly good 1,079-frame track was available. */
  if (trimmedFrames || trimmedTasks || trimmedCounters) {
    base.framesKept = frames.length;
    base.framesDropped = trimmedFrames;
    base.note = "trimmed";
    s = build(frames, tasks, counters);
    shedToFit();
    base.framesKept = frames.length;
    base.framesDropped = trimmedFrames;
    if (s.length > maxChars) base.note = "trimmed-hard";
    s = build(frames, tasks, counters);
  }
  /* ⛔ B265541 — BEFORE GIVING UP THE EPISODE, GIVE UP EVERYTHING ELSE. The shed above holds a
   * floor under the counters (6) and the long tasks (4), so on a tight budget those floors could
   * consume the room the frame track needed and the whole thing fell to the bare row — dropping
   * the series the file's own comment calls "the episode" in order to preserve six counter samples
   * and four task records. So the last rung before surrender empties BOTH and re-sheds the frames.
   * The order is the same as it always was, taken to its conclusion: frames go last. */
  if (s.length > maxChars) {
    tasks = []; counters = [];
    shedToFit();
    /* Same ordering discipline as above: the accounting keys make the row LONGER, so they go on
     * first, the frames re-shed underneath them, and the note is decided from the FINAL length. */
    base.framesKept = frames.length;
    base.framesDropped = trimmedFrames;
    base.note = "trimmed";
    s = build(frames, tasks, counters);
    shedToFit();
    base.framesKept = frames.length;
    base.framesDropped = trimmedFrames;
    base.note = s.length > maxChars ? "trimmed-hard" : "trimmed";
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
