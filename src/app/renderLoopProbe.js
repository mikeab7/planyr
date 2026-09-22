/* renderLoopProbe.js — NAME THE EFFECT THAT PUMPED THE LOOP, AND NAME THE DEPENDENCY THAT FED IT.
 *
 * ⛔ WHY THIS EXISTS (NEW-1/NEW-2, the recurring React error 185 crash on the Site route).
 *
 * React's "Maximum update depth exceeded" (minified: error 185) is a CIRCUIT BREAKER, not a diagnosis. It
 * fires after ~50 nested commits and reports exactly one useful fact — the source position of the
 * `setState` that tripped it. It says NOTHING about the thing a fix needs: which effect kept
 * re-running, and WHY. Every prior round on this class recovered that second half by hand: download
 * the deployed chunk, count characters to the reported column, read minified code, and reason
 * backwards about which dependency could have changed. That is how B1189 was found, how B1225296
 * was found again, and it is why the SAME failure has now been diagnosed from scratch three times.
 *
 * The missing observation is small and completely mechanical: **an effect that re-runs while every
 * dependency VALUE is unchanged is a pump.** That is the entire B1189 signature — a fresh object
 * holding identical numbers, which `Object.is` (all React's dependency check is) calls a change.
 * Nothing in this repo could see it, so this records it:
 *
 *   • how many times a named effect ran inside a rolling window (the re-render counter);
 *   • which dependency INDEX changed identity between two consecutive runs;
 *   • and — the part that turns a count into a diagnosis — whether that change was a real value
 *     change or an IDENTITY-ONLY change (a value-identical replacement object).
 *
 * A healthy effect during a real gesture shows `value` changes: the view genuinely moved. A pump
 * shows `identity-only`, at a rate no gesture can explain.
 *
 * ⛔ ALWAYS ON, DELIBERATELY — it is NOT gated behind a diagnostic flag, and that is the point.
 * `diagArm.js` exists because an instrument gated at mount is unreachable on the machine where the
 * defect lives (B280403). This goes one further: the crash it explains is rare, unpredictable, and
 * has only ever been seen on the owner's own device mid-gesture. An instrument he has to arm BEFORE
 * it happens would never have caught any of the four recorded incidents. So the cost is kept low
 * enough that it needs no gate — a Map lookup and a few comparisons per effect RUN (not per render),
 * with the per-dependency classification skipped entirely until a site is already running hot.
 * `ErrorBoundary` reads `loopReport()` when it catches a recoverable render error, so the NEXT error 185
 * arrives in `client_errors` already naming its own pump.
 *
 * The core is a factory over an injected clock, so the whole policy is unit-testable in Node with
 * no browser and no React (test/renderLoopProbe.test.js).
 */

/** Runs of ONE site inside this window are what "hot" is measured over. */
export const LOOP_WINDOW_MS = 1000;

/** Below this many runs in a window a gesture can honestly explain the rate, so no per-dependency
 *  classification is done at all — the hot path stays a counter. React's own breaker is at ~50, so
 *  this sits well under it and still leaves room to see the climb. */
export const LOOP_SUSPECT_RUNS = 12;

/** Bounded so a long session can never grow this without limit. */
export const LOOP_MAX_SITES = 32;

/** How a dependency changed between two consecutive runs of the same effect. */
export const DEP_UNCHANGED = "unchanged";
export const DEP_VALUE = "value";                  // a genuine change — an effect SHOULD re-run
export const DEP_IDENTITY_ONLY = "identity-only";  // ⛔ the pump signature: same contents, new object
export const DEP_PRESENCE = "presence";            // null ↔ non-null

const isObj = (v) => v !== null && typeof v === "object";
const REACT_ELEMENT = typeof Symbol === "function" && Symbol.for ? Symbol.for("react.element") : 0xeac7;

/* Is `v` a React element? Elements are the single most common identity-unstable dependency in this
 * codebase (a JSX expression assigned to a const is a brand-new object on every render, and passing
 * one as a prop puts it straight into a child's dependency array — which is exactly NEW-2). They
 * need their own comparison: two elements built from the same JSX differ in `props` identity, so a
 * shallow compare would call an identity-only churn a real change and hide the pump. */
function isElement(v) {
  return isObj(v) && (v.$$typeof === REACT_ELEMENT || (typeof v.$$typeof === "symbol" && String(v.$$typeof).includes("react.element")));
}

function shallowEqual(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is(a[k], b[k])) return false;
  return true;
}

/* Classify one dependency's change. Exported for the unit test — the classification IS the verdict,
 * so it is checked directly rather than only through a recorded report. */
export function classifyDepChange(prev, next) {
  if (Object.is(prev, next)) return DEP_UNCHANGED;
  const pO = isObj(prev), nO = isObj(next);
  if (!pO || !nO) return pO !== nO ? DEP_PRESENCE : DEP_VALUE;
  // Two elements from the same JSX site: same component type and same key. Their `props` are a
  // fresh object every render, so nothing deeper can be compared without walking the tree — and
  // type+key is already enough to say "this is the same crumb, rebuilt", which is the finding.
  if (isElement(prev) && isElement(next)) {
    return Object.is(prev.type, next.type) && Object.is(prev.key, next.key) ? DEP_IDENTITY_ONLY : DEP_VALUE;
  }
  if (Array.isArray(prev) !== Array.isArray(next)) return DEP_VALUE;
  return shallowEqual(prev, next) ? DEP_IDENTITY_ONLY : DEP_VALUE;
}

export function createLoopProbe({ now = () => Date.now(), windowMs = LOOP_WINDOW_MS, suspectRuns = LOOP_SUSPECT_RUNS, maxSites = LOOP_MAX_SITES } = {}) {
  /** site -> { runs, since, last, names, prev, tally: { [name]: { value, identityOnly, presence } } } */
  const sites = new Map();

  function noteEffectRun(site, names, deps) {
    const t = now();
    let s = sites.get(site);
    if (!s) {
      if (sites.size >= maxSites) return;
      s = { runs: 0, since: t, last: t, names: names || [], prev: null, tally: null };
      sites.set(site, s);
    }
    if (t - s.since > windowMs) { s.since = t; s.runs = 0; s.tally = null; }
    s.runs++;
    s.last = t;
    // Under the threshold a gesture explains the rate: keep the previous deps (free — the caller
    // already allocated the array) and skip every comparison.
    if (s.runs >= suspectRuns && s.prev && deps && s.prev.length === deps.length) {
      if (!s.tally) s.tally = Object.create(null);
      for (let i = 0; i < deps.length; i++) {
        const verdict = classifyDepChange(s.prev[i], deps[i]);
        if (verdict === DEP_UNCHANGED) continue;
        const name = (s.names && s.names[i]) || `dep[${i}]`;
        const row = s.tally[name] || (s.tally[name] = { value: 0, identityOnly: 0, presence: 0 });
        if (verdict === DEP_VALUE) row.value++;
        else if (verdict === DEP_IDENTITY_ONLY) row.identityOnly++;
        else row.presence++;
      }
    }
    s.prev = deps || null;
  }

  /* The top `limit` sites by run count inside the live window, hottest first. Sites whose window
   * has already lapsed are reported with `runs: 0` rather than stale numbers — a report that
   * silently ages is how a measurement becomes a wrong number that looks right. */
  function loopReport({ limit = 4 } = {}) {
    const t = now();
    const rows = [];
    for (const [site, s] of sites) {
      const live = t - s.since <= windowMs;
      const runs = live ? s.runs : 0;
      if (!runs) continue;
      const deps = [];
      if (s.tally) {
        for (const name of Object.keys(s.tally)) {
          const r = s.tally[name];
          deps.push({ dep: name, value: r.value, identityOnly: r.identityOnly, presence: r.presence });
        }
        deps.sort((a, b) => (b.identityOnly - a.identityOnly) || (b.value - a.value));
      }
      rows.push({ site, runs, windowMs, sinceMs: t - s.since, deps });
    }
    rows.sort((a, b) => b.runs - a.runs);
    return rows.slice(0, limit);
  }

  /* A one-line-per-site rendering for a telemetry payload, where a nested object would be
   * truncated into uselessness by the message cap. Shaped to stay readable in a SQL cell:
   *   "app-header:breadcrumb-fit x51 planSlot=51i" — 51 runs, planSlot changed identity-only 51×. */
  function loopSummary({ limit = 3 } = {}) {
    return loopReport({ limit })
      .map((r) => {
        const worst = r.deps.filter((d) => d.identityOnly || d.value).slice(0, 3)
          .map((d) => `${d.dep}=${d.identityOnly ? `${d.identityOnly}i` : ""}${d.value ? `${d.identityOnly ? "+" : ""}${d.value}v` : ""}`)
          .join(" ");
        return `${r.site} x${r.runs}${worst ? ` ${worst}` : ""}`;
      })
      .join(" | ");
  }

  function reset() { sites.clear(); }

  return { noteEffectRun, loopReport, loopSummary, reset };
}

/* The one instance the app writes to. */
const probe = createLoopProbe();

/** Record one RUN of a named effect. `names` should be a module-level constant array (so it costs
 *  no allocation); `deps` is the same list the effect's dependency array carries. */
export function noteEffectRun(site, names, deps) {
  try { probe.noteEffectRun(site, names, deps); } catch (_) { /* an instrument never breaks the app */ }
}

export function loopReport(opts) {
  try { return probe.loopReport(opts); } catch (_) { return []; }
}

export function loopSummary(opts) {
  try { return probe.loopSummary(opts); } catch (_) { return ""; }
}

export function resetLoopProbe() {
  try { probe.reset(); } catch (_) { /* nothing to reset */ }
}

/* Read-only handle for a harness. Installed unconditionally and at module scope so there is no
 * mount to wait for and no flag to arm — see the header for why that is deliberate. */
if (typeof window !== "undefined") {
  try {
    window.__planyrLoopProbe = (opts) => loopReport(opts);
    window.__planyrLoopProbeReset = () => resetLoopProbe();
  } catch (_) { /* a locked-down window is not a reason to fail */ }
}
