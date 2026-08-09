import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  inpFrom, decidePerfSend, buildPerfRow, readScene,
  installPerfInstrument, perfSnapshot, __resetPerfInstrument,
  PERF_MAX_ROWS, PERF_MIN_GAP_MS,
  routeLane, phaseAt, ROUTE_MOUNT_MS,
} from "../src/shared/telemetry/perfInstrument.js";
import { isEnrolled, notePerfEdit, __resetPerfEdits } from "../src/shared/telemetry/perfSampling.js";
import { SESSION_MAX } from "../src/shared/telemetry/clientErrors.js";

const here = dirname(fileURLToPath(import.meta.url));

/* NEW-4 — the always-on client performance instrument.
 *
 * Two things must be true of it and neither is obvious from reading it: it must never crowd out
 * an ERROR report (they share one per-page send ceiling), and it must never throw into the app.
 * Both are asserted here rather than hoped for. */

describe("enrolment — a tab is in the sample for its whole life or out of it for its whole life", () => {
  it("is deterministic for a given tab id", () => {
    const a = isEnrolled("abc12345", 0.5);
    for (let i = 0; i < 20; i++) expect(isEnrolled("abc12345", 0.5)).toBe(a);
  });

  it("splits a population roughly at the requested rate", () => {
    let n = 0;
    for (let i = 0; i < 4000; i++) if (isEnrolled(`tab-${i}`, 0.25)) n++;
    expect(n / 4000).toBeGreaterThan(0.20);
    expect(n / 4000).toBeLessThan(0.30);
  });

  it("honours the degenerate rates without calling the hash", () => {
    expect(isEnrolled("anything", 1)).toBe(true);
    expect(isEnrolled("anything", 0)).toBe(false);
    expect(isEnrolled("", 0.5)).toBe(false);
  });
});

describe("inpFrom — responsiveness, not an average", () => {
  it("is the WORST interaction on a short session", () => {
    expect(inpFrom([40, 120, 65])).toBe(120);
  });

  it("switches to the 98th percentile once the session is long, so one outlier is not the score", () => {
    const many = [900, ...Array.from({ length: 79 }, () => 50)];
    expect(inpFrom(many)).toBe(50);
  });

  it("returns NULL for no interactions — a zero would read as 'perfectly responsive'", () => {
    expect(inpFrom([])).toBeNull();
    expect(inpFrom(null)).toBeNull();
  });

  it("ignores junk entries rather than propagating NaN", () => {
    expect(inpFrom([NaN, undefined, 80, -5])).toBe(80);
  });
});

describe("decidePerfSend — rule 2: perf may never spend the error budget", () => {
  it("stops at its own per-page ceiling", () => {
    let state = {};
    let sent = 0;
    for (let i = 0; i < 50; i++) {
      const d = decidePerfSend({ now: i * 10 * 60_000, state, kind: "tick" });
      if (d.send) { sent++; state = d.state; }
    }
    expect(sent).toBe(PERF_MAX_ROWS);
  });

  it("keeps that ceiling FAR under the shared per-page ceiling errors also draw on", () => {
    expect(PERF_MAX_ROWS).toBeLessThan(SESSION_MAX / 10);
  });

  it("collapses a burst of long tasks into one row via the minimum gap", () => {
    let state = {};
    const first = decidePerfSend({ now: 1_000_000, state, kind: "longtask" });
    expect(first.send).toBe(true);
    state = first.state;
    for (const dt of [10, 500, 5_000, PERF_MIN_GAP_MS - 1]) {
      expect(decidePerfSend({ now: 1_000_000 + dt, state, kind: "longtask" }).send).toBe(false);
    }
    expect(decidePerfSend({ now: 1_000_000 + PERF_MIN_GAP_MS, state, kind: "longtask" }).send).toBe(true);
  });

  it("lets the FINAL pagehide row through the gap — it is the only chance to say how the session ended", () => {
    const state = { sent: 1, lastAt: 1_000_000 };
    expect(decidePerfSend({ now: 1_000_100, state, kind: "tick" }).send).toBe(false);
    expect(decidePerfSend({ now: 1_000_100, state, kind: "final" }).send).toBe(true);
  });

  it("but the final row is still bounded by the ceiling", () => {
    expect(decidePerfSend({ now: 9e9, state: { sent: PERF_MAX_ROWS, lastAt: 0 }, kind: "final" }).send).toBe(false);
  });
});

describe("buildPerfRow — short, and a missing counter is ABSENT rather than zero", () => {
  it("carries the amplification axes, which is the whole point of the row", () => {
    const row = buildPerfRow({
      kind: "tick", secondsSinceLoad: 1834.7, inp: 212.44, longtaskMs: 900.2, longtasks: 12,
      longtaskMaxMs: 310.9, heapMB: 278.44, documentNodes: 5100, canvasNodes: 2200,
      elementsDrawn: 140, layersOn: 9, panelsOpen: 4, editsSinceLoad: 63, tiles: 105, dpr: 2.15, viewportW: 1512,
    });
    expect(row).toMatchObject({ el: 140, ly: 9, pn: 4, ed: 63, t: 1835, inp: 212.4 });
  });

  it("omits a counter that could not be read, so 'unmeasured' never looks like 'zero'", () => {
    const row = buildPerfRow({ kind: "tick", secondsSinceLoad: 10 });
    expect("heap" in row).toBe(false);
    expect("inp" in row).toBe(false);
    expect(row.k).toBe("tick");
  });

  it("stays comfortably inside the 2000-character message column it rides in", () => {
    const row = buildPerfRow({
      kind: "final", secondsSinceLoad: 99999, inp: 9999, longtaskMs: 999999, longtasks: 9999,
      longtaskMaxMs: 9999, heapMB: 9999, documentNodes: 999999, canvasNodes: 999999,
      elementsDrawn: 99999, layersOn: 999, panelsOpen: 99, editsSinceLoad: 99999, tiles: 9999, dpr: 3, viewportW: 9999,
    });
    expect(JSON.stringify(row).length).toBeLessThan(300);
  });
});

/* A minimal DOM stand-in. Deliberately hand-built rather than jsdom: the counting RULES are what
 * is under test (especially the exact-id panel match), and a fixture makes the wrong answer
 * visible as a number instead of as an environment difference. */
function fakeDoc({ panels = [], docked = false, els = 0, canvasNodes = 0, tiles = 0, layers = 0, featureKeys = null } = {}) {
  const testids = [];
  for (const p of panels) testids.push(`floating-panel-${p}`, `floating-panel-${p}-chrome`, `floating-panel-${p}-chrome-dock`, `floating-panel-${p}-chrome-close`);
  /* NEW-2 — the fixture now models `[data-feature]` too, and models it the way the render really
   * behaves: one NODE per stamp, with chrome repeating its owner's key, so a test that counted
   * nodes instead of distinct keys would come out wrong here rather than only in a browser. */
  const featureNodes = (featureKeys || Array.from({ length: els }, (_, i) => `el:e${i}`))
    .map((k) => ({ getAttribute: (a) => (a === "data-feature" ? k : null) }));
  const svg = {
    getElementsByTagName: () => ({ length: canvasNodes }),
    querySelectorAll: (s) => (s === "[data-el-id]" ? { length: els } : s === "[data-feature]" ? featureNodes : []),
  };
  return {
    querySelector: (s) => (s === '[data-testid="planner-canvas"]' ? svg : s === '[data-testid="left-menu-panel"]' ? (docked ? {} : null) : null),
    getElementsByTagName: () => ({ length: 4000 }),
    querySelectorAll: (s) => {
      if (s === "img.leaflet-tile") return { length: tiles };
      if (s === ".leaflet-layer") return { length: layers };
      if (s === "[data-testid]") return testids.map((t) => ({ getAttribute: () => t }));
      return { length: 0 };
    },
  };
}

describe("readScene — the exact-id panel count, which a prefix match gets wrong by 4×", () => {
  it("counts one floating panel as ONE panel, not four", () => {
    expect(readScene(fakeDoc({ panels: ["yield"] })).panelsOpen).toBe(1);
  });

  it("counts the docked panel plus the floated ones", () => {
    expect(readScene(fakeDoc({ panels: ["yield", "standards", "analysis"], docked: true })).panelsOpen).toBe(4);
  });

  it("reads the canvas axes", () => {
    const s = readScene(fakeDoc({ els: 140, canvasNodes: 2200, tiles: 105, layers: 9 }));
    expect(s).toMatchObject({ elementsDrawn: 140, featuresDrawn: 140, canvasNodes: 2200, tiles: 105, layersOn: 9 });
  });

  /* NEW-2 — THE MISS THIS COLUMN EXISTS FOR. A plan of one element plus one of each other drawn
   * kind reads as ONE element and FIVE features; the old column reported the 1 and called it the
   * scene. Measured live at 120 against 145 on the owner's own Silvestri plan. */
  it("counts every drawn kind, not just elements — and counts KEYS, not nodes", () => {
    const s = readScene(fakeDoc({
      els: 1,
      featureKeys: [
        "el:b1", "markup:m1", "measure:0", "callout:c1", "parcel:p1",
        "el:b1", "parcel:p1",   // chrome repeating its owner's key — a pond label, an acreage badge
      ],
    }));
    expect(s.elementsDrawn).toBe(1);
    expect(s.featuresDrawn).toBe(5);
  });

  it("never throws on a hostile or absent document — rule 3", () => {
    expect(() => readScene(null)).not.toThrow();
    expect(() => readScene({ querySelector() { throw new Error("boom"); } })).not.toThrow();
    expect(readScene(null)).toEqual({});
  });
});

describe("installPerfInstrument — installs NOTHING at all when the tab is not enrolled", () => {
  let win;
  beforeEach(() => {
    win = {
      listeners: {}, intervals: [], observers: [],
      addEventListener(t, fn) { this.listeners[t] = fn; },
      setInterval(fn, ms) { this.intervals.push({ fn, ms }); return this.intervals.length; },
      clearInterval() {},
      performance: { now: () => 1234 },
      devicePixelRatio: 2,
      innerWidth: 1440,
      document: fakeDoc({ els: 62, docked: true }),
      PerformanceObserver: class {
        constructor(cb) { this.cb = cb; win.observers.push(this); }
        observe(opts) { this.opts = opts; }
      },
    };
  });
  afterEach(() => { __resetPerfInstrument(win); __resetPerfEdits(); });

  it("is a complete no-op for an unenrolled tab — no observer, no timer, no listener", () => {
    expect(installPerfInstrument(win, { tabId: "x", rate: 0 })).toBe(false);
    expect(win.observers.length).toBe(0);
    expect(win.intervals.length).toBe(0);
    expect(Object.keys(win.listeners).length).toBe(0);
  });

  it("installs two observers, one timer and one pagehide listener when enrolled", () => {
    expect(installPerfInstrument(win, { tabId: "x", rate: 1 })).toBe(true);
    expect(win.observers.map((o) => o.opts.type).sort()).toEqual(["event", "longtask"]);
    expect(win.intervals.length).toBe(1);
    expect(typeof win.listeners.pagehide).toBe("function");
  });

  it("is idempotent — a second install adds nothing", () => {
    installPerfInstrument(win, { tabId: "x", rate: 1 });
    expect(installPerfInstrument(win, { tabId: "x", rate: 1 })).toBe(false);
    expect(win.intervals.length).toBe(1);
  });

  it("skips the periodic sample while the tab is hidden — a background tab's numbers describe nothing", () => {
    win.document = { ...fakeDoc(), visibilityState: "hidden" };
    installPerfInstrument(win, { tabId: "x", rate: 1 });
    win.intervals[0].fn();
    win.intervals[0].fn();
    expect(win.pfPerf.sent()).toBe(0);
    win.document.visibilityState = "visible";
    win.intervals[0].fn();
    expect(win.pfPerf.sent()).toBe(1);
  });

  it("counts edits, which is the axis nothing in the DOM can report", () => {
    __resetPerfEdits();
    installPerfInstrument(win, { tabId: "x", rate: 1 });
    notePerfEdit(); notePerfEdit(); notePerfEdit();
    expect(perfSnapshot(win).editsSinceLoad).toBe(3);
  });

  it("survives a window with no PerformanceObserver at all (older Safari) — rule 3", () => {
    const bare = { ...win, PerformanceObserver: undefined };
    expect(() => installPerfInstrument(bare, { tabId: "y", rate: 1 })).not.toThrow();
  });
});

/* ── The bundle tier, which is a correctness property here and not a style note ─────────────── */

describe("the instrument stays OFF every route's critical path", () => {
  const MAIN = readFileSync(join(here, "../src/main.jsx"), "utf8");
  const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

  it("main.jsx does NOT static-import the instrument — it breached the Notes budget when it did", () => {
    /* `main.jsx` is on the critical path of EVERY route, so a static edge charges Notes, Library
     * and Review for a Site-Planner-shaped diagnostic. Measured: +2.5 KB over the Notes ceiling.
     * The repo's rule (site-planner/CLAUDE.md, and the same trap StoragePanel hit) is to split by
     * TIER, not to hope for tree-shaking. */
    expect(MAIN).not.toMatch(/^import .*perfInstrument\.js/m);
    expect(MAIN).toContain('import("./shared/telemetry/perfInstrument.js")');
  });

  it("the instrument is fetched only for an ENROLLED tab, so 75% of loads never download it", () => {
    expect(MAIN).toMatch(/if \(isEnrolled\(TAB_ID\)\)/);
    expect(MAIN).toContain('from "./shared/telemetry/perfSampling.js"');
  });

  it("the planner's edit counter comes from the TINY module, not the instrument", () => {
    /* `pushHistory` calling into `perfInstrument.js` would drag the whole diagnostic into the site
     * chunk, whose largest-chunk budget had 6.8 KB of band left when this shipped. */
    expect(SP).toContain('import { notePerfEdit } from "../../shared/telemetry/perfSampling.js";');
    expect(SP).not.toContain("telemetry/perfInstrument.js");
    expect(SP).toContain("histRef.current.push(stateRef.current); notePerfEdit();");
  });
});

/* ── NEW-2: WHICH LANE, AND WHEN ─────────────────────────────────────────────────────────────
 *
 * ⛔ THE FINDING THAT FORCED THIS. Grouping 51 of the owner's own production reports by `ly`
 * (layers on) put the WORST main-thread blocks in `ly=0` — almost no DOM, no layers, more heap
 * than a fully loaded canvas — while every optimisation this programme has shipped targeted the
 * gesture lane. But `ly=0` conflates a boot, a non-canvas route and a long-idle tab, so no cause
 * could honestly be named from it. These fields separate them, and they are attribution ONLY: no
 * fix is written against them here.
 */
describe("routeLane — which lane a row belongs to (NEW-2)", () => {
  it("names the workspace, not the project", () => {
    /* The project id is dropped deliberately: it is high-cardinality and it identifies the owner's
     * deals, and "which lane is slow" is never answered by which site is open. */
    expect(routeLane("#/project/smqfy48tlk9j/site")).toBe("p/site");
    expect(routeLane("#/project/g-tsakiris/schedule")).toBe("p/schedule");
    expect(routeLane("#/project/smrp1wrgg6u5/notes")).toBe("p/notes");
    expect(routeLane("#/project/smqfy48tlk9j/site")).toBe(routeLane("#/project/DIFFERENT-SITE/site"));
  });
  it("names the project-less and cross-project forms distinctly", () => {
    expect(routeLane("#/markup")).toBe("markup");
    expect(routeLane("#/library")).toBe("library");
    expect(routeLane("#/all/schedule")).toBe("all/schedule");
    expect(routeLane("#/")).toBe("home");
    expect(routeLane("")).toBe("home");
  });
  it("⛔ reports an unknown slug VERBATIM instead of folding it into the default", () => {
    /* `parseRoute` resolves junk to the Site workspace by design. A lane that silently claimed to
     * be `site` would re-create exactly the blindness this field exists to remove — B1373 is the
     * precedent: `#/notes` on a build with no Notes opened the Site workspace with no clue. */
    expect(routeLane("#/quarry")).toBe("quarry");
    expect(routeLane("#/project/abc/quarry")).toBe("p/quarry");
  });
  it("never throws on a malformed hash", () => {
    for (const h of [null, undefined, "#", "#//", "#/project", "#/project/abc", "#/all"]) {
      expect(() => routeLane(h)).not.toThrow();
      expect(typeof routeLane(h)).toBe("string");
    }
  });
});

describe("phaseAt — pre-first-paint vs post-mount vs idle (NEW-2)", () => {
  it("is `pre` before First Contentful Paint", () => {
    expect(phaseAt(100, { fcpMs: 800, routeEnteredMs: 0 })).toBe("pre");
  });
  it("⛔ treats a supported-but-not-yet-painted read (Infinity) as `pre`, not as unknown", () => {
    /* An empty paint-entry list means EITHER "this browser has no PerformancePaintTiming" OR "we
     * genuinely have not painted yet", and those are opposite answers. Collapsing them makes `pre`
     * unreachable forever. */
    expect(phaseAt(100, { fcpMs: Infinity, routeEnteredMs: 0 })).toBe("pre");
  });
  it("is `mount` just after paint and `idle` once the route settles", () => {
    expect(phaseAt(1200, { fcpMs: 800, routeEnteredMs: 0 })).toBe("mount");
    expect(phaseAt(ROUTE_MOUNT_MS + 1, { fcpMs: 800, routeEnteredMs: 0 })).toBe("idle");
  });
  it("⛔ measures the mount of THIS ROUTE, not of the page — a workspace switch mounts a fresh tree in an old tab", () => {
    /* Charging that mount to `idle` is exactly how a route's mount cost hides, and the scheduler
     * rows are the case in point: their worst blocks land 1–3 seconds after the route is entered,
     * in a tab that may have been open for an hour. */
    const hourIn = 3_600_000;
    expect(phaseAt(hourIn + 2000, { fcpMs: 800, routeEnteredMs: hourIn })).toBe("mount");
    expect(phaseAt(hourIn + 2000, { fcpMs: 800, routeEnteredMs: 0 })).toBe("idle");
  });
  it("says `early` rather than guessing when paint timing is unreadable", () => {
    /* A phase that MIGHT be either must not be indistinguishable from one that was measured. */
    expect(phaseAt(500, { fcpMs: NaN, routeEnteredMs: 0 })).toBe("early");
    expect(phaseAt(500, { fcpMs: null, routeEnteredMs: 0 })).toBe("early");
    expect(phaseAt(ROUTE_MOUNT_MS + 1, { fcpMs: NaN, routeEnteredMs: 0 })).toBe("idle");
  });
  it("never throws on missing options", () => {
    expect(() => phaseAt(0)).not.toThrow();
  });
});

describe("the row carries the attribution (NEW-2)", () => {
  it("stamps the lane, the phase and the route age", () => {
    const row = buildPerfRow({ kind: "tick", routeLane: "p/schedule", phase: "mount", secondsInRoute: 2.4 });
    expect(row).toMatchObject({ rt: "p/schedule", ph: "mount", rts: 2.4 });
  });
  it("⛔ stamps the WORST BLOCK's own phase and lane, which its row's phase cannot stand in for", () => {
    /* `ltx` is a high-water mark since load, so it is routinely reported by a row sent minutes
     * later, in a different phase, on a different route. Reading a 3-second `ltx` off an `idle`
     * row as "the app blocks while idle" is the specific misreading this pair prevents. */
    const row = buildPerfRow({
      kind: "tick", phase: "idle", routeLane: "p/site", longtaskMaxMs: 3254,
      longtaskMaxPhase: "mount", longtaskMaxLane: "p/schedule", longtaskMaxAtSec: 2.7,
    });
    expect(row.ph).toBe("idle");
    expect(row.ltxp).toBe("mount");
    expect(row.ltxr).toBe("p/schedule");
    expect(row.ltxt).toBe(2.7);
  });
  it("leaves every new field ABSENT when it could not be read, never zero or empty", () => {
    const row = buildPerfRow({ kind: "tick" });
    for (const k of ["rt", "ph", "rts", "ltxp", "ltxr", "ltxt"]) expect(k in row).toBe(false);
  });
  it("stays inside the 2000-character message column with the new fields on a worst-case row", () => {
    const row = buildPerfRow({
      kind: "final", secondsSinceLoad: 98765, inp: 1234.5, longtaskMs: 987654, longtasks: 4321,
      longtaskMaxMs: 76543, heapMB: 1234.5, documentNodes: 99999, canvasNodes: 99999,
      elementsDrawn: 9999, layersOn: 99, layerKeys: Array.from({ length: 14 }, (_, i) => `layer-key-${i}`),
      panelsOpen: 99, editsSinceLoad: 9999, tiles: 999, dpr: 2.15, viewportW: 3840,
      routeLane: "p/schedule", phase: "mount", secondsInRoute: 98765,
      longtaskMaxPhase: "mount", longtaskMaxLane: "p/schedule", longtaskMaxAtSec: 98765,
    }, null);
    expect(JSON.stringify(row).length).toBeLessThan(2000);
  });
});
