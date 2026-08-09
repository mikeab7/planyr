/* ⛔ NEW-4 — THE FLOOD/DRAINAGE CHECK MEASURES ITSELF NOW.
 *
 * B1438 / B255200 built an always-on production performance recorder, and the check was not in
 * it: an eight-second leg on the owner's own signed-in tab stayed invisible until somebody read
 * PerformanceResourceTiming by hand. That is the owner being the instrument, which is exactly
 * what the recorder programme exists to stop. So every check now records what each of its legs
 * cost — the elevation transect, each county water-surface raster, each FEMA pull, the app's own
 * calc, and the cloud save that follows — and reports one row through the SAME production sink
 * the recorder uses.
 *
 * FOUR PROPERTIES, each load-bearing:
 *
 *  1. THE LEG NAMES ARE AN ALLOWLIST, NOT A HABIT (`perfCapture.js`'s discipline). A leg name can
 *     come from a GIS service key, and a service key is not automatically safe to carry off the
 *     machine — so a row is BUILT from `DRAIN_LEG_KEYS` plus a bounded set of sanitised county
 *     raster names, and anything else is dropped rather than shipped. Values are milliseconds.
 *     Nothing about the site, its geometry, its owner or its address is in this row.
 *
 *  2. NO SILENT SINK (B265536). `reportDrainageTiming` keeps the sink's OUTCOME — the row is not
 *     "sent" because we called send. The last outcome is readable (`drainageTimingRecent`), and a
 *     delivery failure is recorded as a failure rather than swallowed.
 *
 *  3. IT NEVER THROWS INTO THE CHECK. A timing instrument that can break the thing it measures is
 *     worse than no instrument. Every entry point here swallows its own failures.
 *
 *  4. IT COSTS NOTHING WHEN NOTHING IS RUNNING. One small object per check — a check happens when
 *     a human presses a button, not sixty times a second — so the per-frame allocation rule the
 *     recorder's ring buffers live by does not apply and a plain Map is the right shape here.
 *
 * Pure + injectable (`now`, `report`) — Node-testable end to end.
 */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

/* The fixed legs. `wse:*` county-raster legs are added dynamically from the registry's own
 * service names and sanitised; everything else must be on this list. */
export const DRAIN_LEG_KEYS = [
  "elev",       // the USGS 3DEP bare-earth transect (NEW-1's subject)
  "ctx",        // resolveDrainageContext: authority + district + channel + watershed identifies
  "flood",      // FEMA NFHL zone polygons
  "bfeLines",   // FEMA S_BFE lines
  "xs",         // FEMA S_XS regulatory cross-sections
  "siteGrid",   // the site-extent 3DEP DEM grid (LERC)
  "wse",        // the Fort Bend WSE group, wall clock across both samplers
  "ebfe",       // FEMA/USGS InFRM estimated BFE
  "maapnext",   // HCFCD MAAPnext model WSE
  "screening",  // Planyr's own screening study (watershed + rainfall + soils)
  "gis",        // wall clock across the whole parallel GIS batch
  "calc",       // last network response → publish: the app's OWN work on the main thread
  "save",       // the cloud write that follows the check (stamped by the push path)
  "total",      // the whole check
];
const LEG_SET = new Set(DRAIN_LEG_KEYS);

/** A county-raster leg name, sanitised and bounded. `wse:Willow_500YR_Existing_WSE` → kept. */
export const WSE_LEG_PREFIX = "wse:";
const WSE_NAME_MAX = 40;
export function wseLegName(service) {
  const s = String(service || "").replace(/[^A-Za-z0-9_]/g, "_").slice(0, WSE_NAME_MAX);
  return s ? WSE_LEG_PREFIX + s : null;
}
const legAllowed = (k) => LEG_SET.has(k) || (typeof k === "string" && k.startsWith(WSE_LEG_PREFIX) && k.length <= WSE_LEG_PREFIX.length + WSE_NAME_MAX);

/** How many legs a single row may carry — a bound, so a pathological run cannot grow the row. */
export const MAX_LEGS = 24;

/* A running timer for one check. `start`/`end` for a leg you can bracket, `mark` for one whose
 * duration another module measured. Re-`end`ing a leg keeps the FIRST duration (a leg that
 * settles twice is a bug in the caller, not a reason to overwrite an honest number). */
export function createDrainageTimer(now = defaultNow, startedAt = null) {
  const open = new Map();
  const legs = new Map();
  // `startedAt` lets the caller stamp t0 BEFORE this module was even loaded, so `total` measures
  // the check rather than the check minus its own lazy import.
  const t0 = Number.isFinite(startedAt) ? startedAt : now();
  /* When the LAST network leg settled. `calc` is the gap between that and the publish — which is
   * the owner's own definition and, importantly, is a GAP IN THE NETWORK TIMELINE rather than a
   * main-thread blocking measurement. The distinction matters (FOREGROUND-OR-VOID): a gap is
   * sound whatever the tab's visibility was doing; a blocking figure would not be. */
  let lastNet = t0;
  const touch = () => { lastNet = now(); };
  return {
    startedAt: t0,
    touchNetwork: touch,
    sinceNetwork() { return Math.max(0, now() - lastNet); },
    start(name) { try { if (legAllowed(name) && !open.has(name)) open.set(name, now()); } catch (_) {} return name; },
    end(name) {
      try {
        const s = open.get(name);
        if (s == null) return null;
        open.delete(name);
        const ms = Math.max(0, now() - s);
        if (!legs.has(name)) legs.set(name, ms);
        touch();
        return ms;
      } catch (_) { return null; }
    },
    mark(name, ms) {
      try {
        if (!legAllowed(name) || !Number.isFinite(ms)) return;
        if (!legs.has(name)) legs.set(name, Math.max(0, ms));
        // A leg somebody else timed is still network — except the two derived ones.
        if (name !== "calc" && name !== "total" && name !== "save") touch();
      } catch (_) {}
    },
    /** Wall clock since the timer started — used for `total` and for the calc gap. */
    elapsed() { return Math.max(0, now() - t0); },
    legs() { return new Map(legs); },
  };
}

const defaultNow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/* ⛔ THE ALLOWLIST IS APPLIED HERE, and this is the only way a row is built. Returns a plain
 * object of rounded milliseconds plus a small set of enum/boolean facts. Pure. */
export function buildDrainageTimingRow({ legs, auto = false, ground = null, dropped = 0, at = null } = {}) {
  const row = { kind: "draincheck", mode: auto ? "auto" : "manual" };
  const entries = [];
  const src = legs instanceof Map ? legs.entries() : Object.entries(legs || {});
  for (const [k, v] of src) {
    if (!legAllowed(k) || !Number.isFinite(v)) continue;
    entries.push([k, Math.round(v)]);
  }
  // Slowest first, so a truncated row keeps the legs worth looking at.
  entries.sort((a, b) => b[1] - a[1]);
  const kept = entries.slice(0, MAX_LEGS);
  row.legs = {};
  for (const [k, v] of kept) row.legs[k] = v;
  const over = entries.length - kept.length + (Number.isFinite(dropped) ? dropped : 0);
  if (over > 0) row.legsDropped = over;
  if (ground && typeof ground === "object") {
    // The four states, verbatim — this is the fact the whole NEW-1/NEW-2/NEW-3 strand turns on.
    if (typeof ground.status === "string") row.ground = ground.status.slice(0, 16);
    if (ground.fromCache != null) row.groundCached = !!ground.fromCache;
    if (ground.timedOut) row.groundTimedOut = true;
  }
  if (Number.isFinite(at)) row.at = Math.round(at);
  return row;
}

/* ── The bounded local ring, and the delivery outcome ────────────────────────────────────────
 * Readable without a database round trip, the same way `pfTelemetry.recent()` is. Bounded so an
 * instrument can never become a leak. */
const RECENT_MAX = 8;
const _recent = [];
let _delivery = { attempted: 0, ok: 0, failed: 0, lastReason: null };

export function drainageTimingRecent() { return _recent.map((r) => ({ ...r })); }
export function drainageTimingDelivery() { return { ..._delivery }; }
export function __resetDrainageTiming() { _recent.length = 0; _delivery = { attempted: 0, ok: 0, failed: 0, lastReason: null }; }

/* Report one check. Never throws; returns a promise of the SINK's outcome so a caller (and the
 * tests) can tell "the server took it" from "nothing left the machine" — B265536's rule, which
 * exists because a telemetry channel that can fail in silence makes the whole recorder able to. */
export function reportDrainageTiming(row, report = reportClientEvent) {
  let outcome = Promise.resolve({ ok: false, reason: "threw", error: null });
  try {
    _recent.push({ ...row, sentAt: Date.now() });
    while (_recent.length > RECENT_MAX) _recent.shift();
    _delivery.attempted++;
    outcome = Promise.resolve(report("draincheck", JSON.stringify(row)))
      .then((r) => {
        const ok = !!(r && r.ok);
        if (ok) _delivery.ok++; else { _delivery.failed++; _delivery.lastReason = (r && (r.reason || (r.error && String(r.error)))) || "unknown"; }
        return r || { ok: false, reason: "no-result" };
      })
      .catch((e) => { _delivery.failed++; _delivery.lastReason = String((e && e.message) || e); return { ok: false, reason: "threw", error: e }; });
  } catch (e) {
    try { _delivery.failed++; _delivery.lastReason = String((e && e.message) || e); } catch (_) {}
  }
  return outcome;
}

/* ── The SAVE leg ─────────────────────────────────────────────────────────────────────────────
 * The Supabase write that follows a check is not issued by the check — it rides the plan's own
 * debounced cloud push — so it is stamped from there, and only when a check settled recently
 * enough for the two to be the same episode. Outside that window a save is just a save and is
 * not attributed to a check it had nothing to do with. */
export const SAVE_ATTRIBUTION_MS = 8000;
let _pendingSave = null;   // { at, apply(ms) }

/** Called by the check once it has published: the next cloud push within the window is ours. */
export function armDrainageSaveLeg(apply, now = Date.now) {
  try { _pendingSave = typeof apply === "function" ? { at: now(), apply } : null; } catch (_) { _pendingSave = null; }
}

/** Called by the cloud-push path with the write's duration. No armed check → a no-op. */
export function noteDrainageSave(ms, now = Date.now) {
  try {
    const p = _pendingSave;
    if (!p || !Number.isFinite(ms)) return false;
    _pendingSave = null;
    if (now() - p.at > SAVE_ATTRIBUTION_MS) return false;
    p.apply(ms);
    return true;
  } catch (_) { return false; }
}
