import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  inpFrom, decidePerfSend, buildPerfRow, readScene,
  installPerfInstrument, perfSnapshot, __resetPerfInstrument,
  PERF_MAX_ROWS, PERF_MIN_GAP_MS,
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
function fakeDoc({ panels = [], docked = false, els = 0, canvasNodes = 0, tiles = 0, layers = 0 } = {}) {
  const testids = [];
  for (const p of panels) testids.push(`floating-panel-${p}`, `floating-panel-${p}-chrome`, `floating-panel-${p}-chrome-dock`, `floating-panel-${p}-chrome-close`);
  const svg = {
    getElementsByTagName: () => ({ length: canvasNodes }),
    querySelectorAll: (s) => (s === "[data-el-id]" ? { length: els } : { length: 0 }),
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
    expect(s).toMatchObject({ elementsDrawn: 140, canvasNodes: 2200, tiles: 105, layersOn: 9 });
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
