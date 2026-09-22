/* NEW-1 / NEW-2 — the render-loop probe's verdict, and the two effects it is pointed at.
 *
 * The probe's whole value is one distinction: an effect that re-ran because a dependency really
 * CHANGED (correct — that is what a dependency array is for) versus one that re-ran because a
 * dependency was replaced by a value-identical object (pure waste, and the fuel React's #185
 * nested-update breaker counts). Get that classification wrong in either direction and the
 * instrument reports a working build broken or a broken one working — so it is asserted directly
 * here rather than only through the browser harness that consumes it.
 *
 * The source sweep at the bottom is the half that cannot rot: a probe wired to an effect that has
 * since dropped its call, or a dependency array that has grown a React element back, is an
 * instrument that reports a clean number because it can no longer see anything.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  createLoopProbe,
  classifyDepChange,
  DEP_UNCHANGED,
  DEP_VALUE,
  DEP_IDENTITY_ONLY,
  DEP_PRESENCE,
  LOOP_SUSPECT_RUNS,
} from "../src/app/renderLoopProbe.js";

const REACT_ELEMENT = Symbol.for("react.element");
const el = (type, key = null, props = {}) => ({ $$typeof: REACT_ELEMENT, type, key, ref: null, props, _owner: null });

/* A clock the test drives, so nothing here depends on wall time. */
function probeAt() {
  let now = 1000;
  const p = createLoopProbe({ now: () => now });
  return { ...p, advance: (ms) => { now += ms; }, at: () => now };
}

describe("classifyDepChange — the verdict the whole instrument rests on", () => {
  it("calls an identical reference unchanged", () => {
    const o = { a: 1 };
    expect(classifyDepChange(o, o)).toBe(DEP_UNCHANGED);
    expect(classifyDepChange(3, 3)).toBe(DEP_UNCHANGED);
    expect(classifyDepChange(null, null)).toBe(DEP_UNCHANGED);
  });

  it("calls a changed primitive a VALUE change — an effect SHOULD re-run for this", () => {
    expect(classifyDepChange(0.35, 0.36)).toBe(DEP_VALUE);
    expect(classifyDepChange(true, false)).toBe(DEP_VALUE);
    expect(classifyDepChange("a", "b")).toBe(DEP_VALUE);
  });

  it("calls a value-identical replacement object IDENTITY-ONLY — this is the pump signature", () => {
    // Exactly the B1189 shape: a fresh `{w,h}` holding the same numbers.
    expect(classifyDepChange({ w: 1058, h: 640 }, { w: 1058, h: 640 })).toBe(DEP_IDENTITY_ONLY);
    expect(classifyDepChange({ ppf: 0.35, offX: 60, offY: 60 }, { ppf: 0.35, offX: 60, offY: 60 })).toBe(DEP_IDENTITY_ONLY);
  });

  it("does not mistake a real object change for identity-only churn", () => {
    expect(classifyDepChange({ ppf: 0.35, offX: 60 }, { ppf: 0.36, offX: 60 })).toBe(DEP_VALUE);
    expect(classifyDepChange({ a: 1 }, { a: 1, b: 2 })).toBe(DEP_VALUE);
  });

  it("compares REACT ELEMENTS by type+key, because their props are a fresh object every render", () => {
    // NEW-2's exact case: `plannerPlanCrumb` is a bare JSX expression in the planner's render body,
    // so every render mints a new element whose `props` object is new too. A shallow compare would
    // call that a real change and the pump would be invisible.
    const Crumb = () => null;
    expect(classifyDepChange(el(Crumb, "p1", { name: "Phase II" }), el(Crumb, "p1", { name: "Phase II" }))).toBe(DEP_IDENTITY_ONLY);
    // A genuinely different crumb is still a real change.
    const Other = () => null;
    expect(classifyDepChange(el(Crumb, "p1"), el(Other, "p1"))).toBe(DEP_VALUE);
    expect(classifyDepChange(el(Crumb, "p1"), el(Crumb, "p2"))).toBe(DEP_VALUE);
  });

  it("reports a null↔object transition as PRESENCE, never as identity churn", () => {
    expect(classifyDepChange(null, { a: 1 })).toBe(DEP_PRESENCE);
    expect(classifyDepChange({ a: 1 }, null)).toBe(DEP_PRESENCE);
  });

  it("does not confuse an array with an object of the same entries", () => {
    expect(classifyDepChange([1, 2], { 0: 1, 1: 2 })).toBe(DEP_VALUE);
    expect(classifyDepChange([1, 2], [1, 2])).toBe(DEP_IDENTITY_ONLY);
  });
});

describe("createLoopProbe — counting, windowing and the report", () => {
  it("counts runs of a named site inside the rolling window", () => {
    const p = probeAt();
    for (let i = 0; i < 5; i++) p.noteEffectRun("a", ["x"], [1]);
    expect(p.loopReport()[0]).toMatchObject({ site: "a", runs: 5 });
  });

  it("drops a site whose window has lapsed rather than reporting a stale count", () => {
    const p = probeAt();
    for (let i = 0; i < 5; i++) p.noteEffectRun("a", ["x"], [1]);
    p.advance(5000);
    expect(p.loopReport()).toEqual([]);
  });

  it("stays a bare counter below the suspect threshold — no per-dependency work on a cool site", () => {
    const p = probeAt();
    for (let i = 0; i < LOOP_SUSPECT_RUNS - 1; i++) p.noteEffectRun("a", ["view"], [{ ppf: 1 }]);
    expect(p.loopReport()[0].deps).toEqual([]);
  });

  it("names the churning dependency once a site is running hot", () => {
    const p = probeAt();
    // The measured NEW-2 shape: one dependency replaced by a value-identical element every run.
    const Crumb = () => null;
    for (let i = 0; i < 40; i++) {
      p.noteEffectRun("app-header:breadcrumb-fit", ["narrow", "planSlot"], [true, el(Crumb, "p1", { n: i })]);
    }
    const row = p.loopReport()[0];
    expect(row.site).toBe("app-header:breadcrumb-fit");
    expect(row.runs).toBe(40);
    const planSlot = row.deps.find((d) => d.dep === "planSlot");
    expect(planSlot.identityOnly).toBeGreaterThan(20);
    expect(planSlot.value).toBe(0);
    // `narrow` never moved, so it must not be reported at all.
    expect(row.deps.find((d) => d.dep === "narrow")).toBeUndefined();
  });

  it("does NOT report a legitimately moving dependency as churn — a real pinch must read clean", () => {
    const p = probeAt();
    // The measured healthy shape: the geo-registration effect re-running because the view moved.
    for (let i = 0; i < 40; i++) p.noteEffectRun("site-planner:geo-registration", ["view.ppf"], [0.35 + i * 0.01]);
    const row = p.loopReport()[0];
    const ppf = row.deps.find((d) => d.dep === "view.ppf");
    expect(ppf.identityOnly).toBe(0);
    expect(ppf.value).toBeGreaterThan(20);
  });

  it("orders the report hottest-first and honours the limit", () => {
    const p = probeAt();
    for (let i = 0; i < 30; i++) p.noteEffectRun("hot", ["x"], [i]);
    for (let i = 0; i < 3; i++) p.noteEffectRun("cool", ["x"], [i]);
    const rows = p.loopReport({ limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].site).toBe("hot");
  });

  it("summarises for a telemetry payload without nesting", () => {
    const p = probeAt();
    const Crumb = () => null;
    for (let i = 0; i < 30; i++) p.noteEffectRun("app-header:breadcrumb-fit", ["planSlot"], [el(Crumb, "p1", { n: i })]);
    expect(p.loopSummary()).toMatch(/^app-header:breadcrumb-fit x30 planSlot=\d+i$/);
  });

  it("is bounded — a session that names endless sites cannot grow it without limit", () => {
    const p = createLoopProbe({ now: () => 1, maxSites: 4 });
    for (let i = 0; i < 50; i++) p.noteEffectRun(`site${i}`, ["x"], [1]);
    expect(p.loopReport({ limit: 100 }).length).toBeLessThanOrEqual(4);
  });

  it("tolerates a dependency list whose length changes (a remount) without misreporting", () => {
    const p = probeAt();
    for (let i = 0; i < 20; i++) p.noteEffectRun("a", ["x", "y"], [1, 2]);
    expect(() => p.noteEffectRun("a", ["x"], [1])).not.toThrow();
    expect(p.loopReport()[0].runs).toBe(21);
  });
});

/* ── The half that cannot rot ─────────────────────────────────────────────────────────────────
 *
 * A probe is only worth what it is pointed at. These read the real source, so an effect that drops
 * its `noteEffectRun` call — or grows a React element back into its dependency array — fails the
 * build rather than quietly reporting a clean number from an instrument that can no longer see. */
const readSrc = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("the two effects the #185 crashes threw from stay instrumented", () => {
  const planner = readSrc("../src/workspaces/site-planner/SitePlanner.jsx");
  const crumb = readSrc("../src/shared/ui/ProjectBreadcrumb.jsx");

  it("the geo-registration layout effect records its runs", () => {
    expect(planner).toContain("noteEffectRun(GEO_REG_EFFECT, GEO_REG_DEPS,");
    expect(planner).toContain('const GEO_REG_EFFECT = "site-planner:geo-registration";');
  });

  it("the crumb-fit layout effect records its runs", () => {
    expect(crumb).toContain("noteEffectRun(CRUMB_FIT_EFFECT, CRUMB_FIT_DEPS,");
    expect(crumb).toContain('const CRUMB_FIT_EFFECT = "app-header:breadcrumb-fit";');
  });

  it("⛔ the crumb-fit effect depends on WHETHER there is a plan crumb, never on the element", () => {
    // The measured NEW-2 pump: `planSlot` is a React element rebuilt on every planner render, so
    // depending on it re-ran this effect 78×/s, 67 of them for nothing.
    expect(crumb).toContain("}, [narrow, hasPlanSlot, currentName, cross, org, rowRef, commitCrumbCompact]);");
    expect(crumb).not.toContain("}, [narrow, planSlot, currentName, cross, org, rowRef]);");
  });

  it("⛔ the geo-registration effect depends on the view's NUMBERS, never on the state object", () => {
    // B1189's own documented rule — "depend on view.ppf/offX/offY, size.w/h" — had been applied to
    // `size` and left undone for `view`.
    expect(planner).toContain("}, [view.ppf, view.offX, view.offY, size.w, size.h, origin, geoOverscan]);");
    expect(planner).not.toContain("}, [view, size.w, size.h, origin, geoOverscan]);");
  });

  it("⛔ both effects GUARD THE DISPATCH rather than relying on a no-op updater", () => {
    // A setState whose updater returns the same value is still a dispatch, and a dispatch raised
    // from a layout effect is sync-lane work scheduled from inside a commit — exactly what React's
    // nested-update counter counts.
    expect(planner).toContain("commitRegShift(");
    expect(planner).toContain("commitGeoZoom(");
    expect(planner).not.toContain("setRegShift((r) =>");
    expect(planner).not.toContain("setGeoZoom((z) =>");
    expect(crumb).toContain("commitCrumbCompact(");
    expect(crumb).not.toContain("setCrumbCompact((prev)");
    expect(crumb).not.toContain("setCrumbCompact((c)");
  });
});
