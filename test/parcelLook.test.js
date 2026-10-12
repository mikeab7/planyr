/* NEW-2 — parcel boundary / setback line / dimension-label LOOK.
 * Resolution order, validation on write, the per-parcel patch mapping, the trailing writer (the FINAL value always
 * lands), the account-prefs round trip, and source guards on the two render rules the owner locked:
 * weight is SCREEN pixels (no zoom factor on these two strokes) and the setback ring is its own render layer. */
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import {
  resolveParcelLook, validateLook, normalizeLook, patchLook, parcelPatchFor, parcelResetPatch, hasParcelOverride, parcelLookKeys, ptToPx, normalizeHex, LOOK_BUILTIN,
} from "../src/workspaces/site-planner/lib/parcelLook.js";
import { createTrailingWriter } from "../src/workspaces/site-planner/lib/trailingWrite.js";
import { _normalizePrefs, setParcelLookPref } from "../src/workspaces/site-planner/lib/userPrefsStore.js";

const THEME = { parcel: "#1d9e75", setback: "#7c3aed", ink: "#111111" };
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("resolution: parcel override → workspace default → built-in", () => {
  it("an untouched parcel with no default is the old look (2px solid, 1.25px dashed setback, theme colours)", () => {
    const l = resolveParcelLook({ points: [] }, undefined, THEME);
    expect(l.boundary).toMatchObject({ color: THEME.parcel, weightPx: 2, dash: "solid", dashed: false });
    expect(l.setback).toMatchObject({ color: THEME.setback, weightPx: 1.25, dash: "dashed", dashed: true });
    expect(l.labels).toMatchObject({ show: true, color: THEME.ink, sizePt: null });
    expect(l.from.boundary.color).toBe("builtin");
  });
  it("the workspace default wins over the built-in, per field", () => {
    const l = resolveParcelLook({}, { boundary: { color: "#ff0000", weightPx: 4 }, setback: { dashed: false }, labels: { show: false, sizePt: 12 } }, THEME);
    expect(l.boundary).toMatchObject({ color: "#ff0000", weightPx: 4, dashed: false });
    expect(l.setback.dashed).toBe(false);
    expect(l.labels).toMatchObject({ show: false, sizePt: 12 });
    expect(l.from.boundary.color).toBe("default");
    expect(l.from.boundary.dashed).toBe("builtin");
  });
  it("a parcel override wins over the default; null / absent inherits", () => {
    const ws = { boundary: { color: "#ff0000", weightPx: 4, dashed: true } };
    const l = resolveParcelLook({ stroke: "#00ff00", weight: null, dash: undefined }, ws, THEME);
    expect(l.boundary).toMatchObject({ color: "#00ff00", weightPx: 4, dashed: true });
    expect(l.from.boundary).toMatchObject({ color: "parcel", weightPx: "default", dashed: "default" });
  });
  it("an explicit solid on the parcel beats a dashed default (solid is an override, not 'unset')", () => {
    expect(resolveParcelLook({ dash: "solid" }, { boundary: { dashed: true } }, THEME).boundary.dashed).toBe(false);
  });
  it("a legacy 'dotted' parcel keeps its pattern and reads as dashed-on", () => {
    const l = resolveParcelLook({ dash: "dotted" }, null, THEME);
    expect(l.boundary.dash).toBe("dotted"); expect(l.boundary.dashed).toBe(true);
  });
  it("an existing parcel's stamped keys (stroke/weight/dash, sb*) still resolve exactly as before", () => {
    const l = resolveParcelLook({ stroke: "#abcdef", weight: 3, dash: "dashed", sbStroke: "#123456", sbWeight: 2, sbDash: "solid" }, { boundary: { color: "#ff0000" } }, THEME);
    expect(l.boundary).toMatchObject({ color: "#abcdef", weightPx: 3, dash: "dashed" });
    expect(l.setback).toMatchObject({ color: "#123456", weightPx: 2, dash: "solid" });
  });
  it("any colour is allowed even when boundary and setback end up identical", () => {
    const l = resolveParcelLook({ stroke: "#112233", sbStroke: "#112233" }, null, THEME);
    expect(l.boundary.color).toBe(l.setback.color);
  });
  it("label look reads dimShow / dimColor / dimSize; an out-of-range stored size is ignored", () => {
    expect(resolveParcelLook({ dimShow: false, dimColor: "#0000ff", dimSize: 14 }, null, THEME).labels).toMatchObject({ show: false, color: "#0000ff", sizePt: 14 });
    expect(resolveParcelLook({ dimSize: 40 }, null, THEME).labels.sizePt).toBe(LOOK_BUILTIN.labels.sizePt);
  });
});

describe("validation on write", () => {
  it("accepts good values and refuses bad hex / out-of-range numbers / wrong types", () => {
    expect(validateLook({ boundary: { color: "#A1b2C3", weightPx: 6, dashed: true }, labels: { show: false, color: "#fff", sizePt: 8 } })).toEqual([]);
    expect(validateLook({ boundary: { color: "red" } }).length).toBe(1);
    expect(validateLook({ boundary: { weightPx: 0.5 } }).length).toBe(1);
    expect(validateLook({ setback: { weightPx: 7 } }).length).toBe(1);
    expect(validateLook({ labels: { sizePt: 7 } }).length).toBe(1);
    expect(validateLook({ labels: { sizePt: 17 } }).length).toBe(1);
    expect(validateLook({ setback: { dashed: "yes" } }).length).toBe(1);
    expect(validateLook({ labels: { show: 1 } }).length).toBe(1);
  });
  it("normalizeHex expands #rgb and lower-cases; rejects junk", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc"); expect(normalizeHex("#A1B2C3")).toBe("#a1b2c3");
    expect(normalizeHex("a1b2c3")).toBeNull(); expect(normalizeHex("#12")).toBeNull(); expect(normalizeHex(5)).toBeNull();
  });
  it("normalizeLook drops invalid stored fields rather than rendering them", () => {
    expect(normalizeLook({ boundary: { color: "nope", weightPx: 99, dashed: true } })).toEqual({ boundary: { dashed: true } });
  });
  it("setParcelLookPref throws on a bad value instead of storing a repaired one", () => {
    expect(() => setParcelLookPref({}, "boundary", "color", "#zzz")).toThrow(/hex/);
    expect(() => setParcelLookPref({}, "labels", "sizePt", 3)).toThrow(/pt/);
  });
});

describe("per-parcel patch mapping + reset", () => {
  it("maps each field onto the parcel's existing keys", () => {
    expect(parcelPatchFor("boundary", "color", "#112233")).toEqual({ stroke: "#112233" });
    expect(parcelPatchFor("boundary", "weightPx", 3)).toEqual({ weight: 3 });
    expect(parcelPatchFor("boundary", "dashed", true)).toEqual({ dash: "dashed" });
    expect(parcelPatchFor("boundary", "dashed", false)).toEqual({ dash: "solid" });
    expect(parcelPatchFor("setback", "dashed", false)).toEqual({ sbDash: "solid" });
    expect(parcelPatchFor("setback", "color", "#000000")).toEqual({ sbStroke: "#000000" });
    expect(parcelPatchFor("labels", "sizePt", 12)).toEqual({ dimSize: 12 });
    expect(parcelPatchFor("labels", "show", false)).toEqual({ dimShow: false });
    expect(parcelPatchFor("labels", "color", "#ff00ff")).toEqual({ dimColor: "#ff00ff" });
    expect(parcelPatchFor("boundary", "bogus", 1)).toBeNull();
  });
  it("reset clears every look key (and only those) so the parcel inherits", () => {
    const r = parcelResetPatch();
    expect(Object.keys(r).sort()).toEqual([...parcelLookKeys].sort());
    expect(Object.values(r).every((v) => v === null)).toBe(true);
    const pc = { id: "a", fill: "#fff", strokeOpacity: 0.5, stroke: "#123456", dimShow: false, ...{} };
    expect(hasParcelOverride(pc)).toBe(true);
    const cleared = { ...pc, ...r };
    expect(hasParcelOverride(cleared)).toBe(false);
    expect(cleared.fill).toBe("#fff"); expect(cleared.strokeOpacity).toBe(0.5); // out of scope — untouched
    const l = resolveParcelLook(cleared, { boundary: { color: "#ff0000" } }, THEME);
    expect(l.boundary.color).toBe("#ff0000");
  });
  it("patchLook clears a field on null and drops an emptied section", () => {
    const a = patchLook({}, "boundary", "color", "#ff0000");
    expect(a).toEqual({ boundary: { color: "#ff0000" } });
    expect(patchLook(a, "boundary", "color", null)).toEqual({});
  });
  it("ptToPx is 96dpi", () => { expect(ptToPx(12)).toBe(16); expect(ptToPx(8)).toBeCloseTo(10.667, 2); });
});

describe("account prefs round trip", () => {
  it("parcelLook survives normalize and is private per-user data in the prefs blob", () => {
    const p = setParcelLookPref(_normalizePrefs(null), "boundary", "color", "#FF0000");
    expect(_normalizePrefs(JSON.parse(JSON.stringify(p))).parcelLook).toEqual({ boundary: { color: "#ff0000" } });
    expect(_normalizePrefs(null).parcelLook).toEqual({});
  });
  it("a write changes only its own field (other prefs and other look fields are carried)", () => {
    let p = setParcelLookPref(_normalizePrefs({ exportPrefs: { flattenMarkups: true } }), "setback", "weightPx", 3);
    p = setParcelLookPref(p, "labels", "show", false);
    expect(p.exportPrefs.flattenMarkups).toBe(true);
    expect(p.parcelLook).toEqual({ setback: { weightPx: 3 }, labels: { show: false } });
  });
});

describe("trailing writer — the final value always lands", () => {
  it("collapses a burst into one write carrying every edit, after the quiet period", async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async () => {});
    const w = createTrailingWriter(commit, 400);
    for (let i = 1; i <= 50; i++) w.push({ section: "boundary", field: "weightPx", value: i / 10 });
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(commit).toHaveBeenCalledTimes(1);
    const batch = commit.mock.calls[0][0];
    expect(batch[batch.length - 1].value).toBe(5); // the trailing (final) value is in the write
    vi.useRealTimers();
  });
  it("the default timers are safe to call as methods (a browser throws 'Illegal invocation' on a bare setTimeout reference)", async () => {
    const real = globalThis.setTimeout;
    globalThis.setTimeout = function strict(f, m) { if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation"); return real(f, m); };
    try {
      const commit = vi.fn(async () => {});
      const w = createTrailingWriter(commit, 1);
      w.push({ value: 1 });
      await w.flush();
      expect(commit).toHaveBeenCalledTimes(1);
    } finally { globalThis.setTimeout = real; }
  });
  it("flush writes immediately (page hide / unmount) and nothing is lost", async () => {
    const commit = vi.fn(async () => {});
    const w = createTrailingWriter(commit, 10_000);
    w.push({ section: "labels", field: "sizePt", value: 14 });
    expect(w.pending()).toBe(true);
    await w.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(w.pending()).toBe(false);
  });
  it("writes never overlap: an edit made during a slow write goes out in the NEXT batch, in order", async () => {
    const order = [];
    let release;
    const commit = vi.fn(async (b) => { order.push(`start:${b[0].value}`); if (b[0].value === 1) await new Promise((r) => { release = r; }); order.push(`end:${b[0].value}`); });
    const w = createTrailingWriter(commit, 1);
    w.push({ value: 1 }); const f1 = w.flush();
    await Promise.resolve();
    w.push({ value: 2 }); const f2 = w.flush();
    await Promise.resolve();
    expect(order).toEqual(["start:1"]);
    release(); await f1; await f2;
    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
  });
  it("a failing commit does not wedge later writes", async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const w = createTrailingWriter(commit, 1);
    w.push({ value: 1 }); await w.flush();
    w.push({ value: 2 }); await w.flush();
    expect(commit).toHaveBeenCalledTimes(2);
  });
});

describe("persisting the workspace default — failure is loud and reverts", async () => {
  const { persistLookBatch } = await import("../src/workspaces/site-planner/lib/parcelLookPersist.js");
  const mk = (result) => {
    let prefs = _normalizePrefs(null);
    prefs = setParcelLookPref(prefs, "boundary", "color", "#ff0000"); // the optimistic local apply already happened
    const warn = vi.fn();
    const deps = {
      uid: "u1", warn,
      updateUserPrefs: vi.fn(async () => result),
      applyPrefsLocal: (r) => { prefs = _normalizePrefs(r(prefs)); return prefs; },
      setParcelLookPref,
    };
    return { deps, warn, get prefs() { return prefs; } };
  };
  const batch = [{ section: "boundary", field: "color", value: "#ff0000" }];
  it("ok: no warning, nothing reverted", async () => {
    const t = mk({ ok: true });
    expect(await persistLookBatch({ ...t.deps, batch, prev: new Map() })).toEqual({ ok: true });
    expect(t.warn).not.toHaveBeenCalled();
    expect(t.prefs.parcelLook.boundary.color).toBe("#ff0000");
  });
  it("signed out: keeps the value (the mirror is the store) and says it is this computer only", async () => {
    const t = mk({ ok: false, error: "not signed in" });
    const r = await persistLookBatch({ ...t.deps, batch, prev: new Map() });
    expect(r.localOnly).toBe(true);
    expect(t.warn.mock.calls[0][0]).toMatch(/this computer only/);
    expect(t.prefs.parcelLook.boundary.color).toBe("#ff0000");
  });
  it("a real failure REVERTS to the value before the burst and says so out loud", async () => {
    const t = mk({ ok: false, error: "network down" });
    const r = await persistLookBatch({ ...t.deps, batch, prev: new Map([["boundary.color", "#00aa00"]]) });
    expect(r.reverted).toBe(true);
    expect(t.prefs.parcelLook.boundary.color).toBe("#00aa00");
    expect(t.warn.mock.calls[0][0]).toMatch(/put back.*network down/);
  });
  it("a failure on a field that had no value before clears it back to the built-in", async () => {
    const t = mk({ ok: false, error: "boom" });
    await persistLookBatch({ ...t.deps, batch, prev: new Map([["boundary.color", undefined]]) });
    expect(t.prefs.parcelLook).toEqual({});
  });
  it("the cloud write receives every edit of the burst, last value per field", async () => {
    const t = mk({ ok: true });
    const burst = [{ section: "boundary", field: "weightPx", value: 2 }, { section: "boundary", field: "weightPx", value: 5 }, { section: "labels", field: "show", value: false }];
    await persistLookBatch({ ...t.deps, batch: burst, prev: new Map() });
    const reducer = t.deps.updateUserPrefs.mock.calls[0][1];
    expect(reducer(_normalizePrefs(null)).parcelLook).toEqual({ boundary: { weightPx: 5 }, labels: { show: false } });
  });
});

describe("source guards on the render rules", () => {
  const src = read("src/workspaces/site-planner/SitePlanner.jsx");
  it("boundary and setback ring strokes carry NO zoom factor (screen pixels, constant across zoom)", () => {
    const outline = src.slice(src.indexOf('data-testid="parcel-outline"'), src.indexOf('data-testid="parcel-outline"') + 900);
    expect(outline).toMatch(/strokeWidth=\{\(removeHover \|\| picked \|\| isSel\) \? Math\.max\(3, baseW\) : baseW\}/);
    expect(outline).not.toMatch(/strokeZoom/);
    const ring = src.slice(src.indexOf('data-testid="setback-ring"'), src.indexOf('data-testid="setback-ring"') + 400);
    expect(ring).toMatch(/strokeWidth=\{sbs\.weight\}/);
    expect(ring).not.toMatch(/strokeZoom|dashZoom/);
  });
  it("both draw sites resolve through lookOf (override → default → built-in), not pc.stroke / pc.weight directly", () => {
    expect(src).toMatch(/const lkB = lookOf\(pc\)\.boundary/);
    expect(src).toMatch(/lkS = lkP\.setback/);
    expect(src).not.toMatch(/const baseW = pc\.weight \?\? 2/);
  });
  it("the setback ring is its own polygon layer, not a byproduct of the boundary", () => {
    expect(src).toMatch(/data-testid="setback-ring"[^>]*points=\{ring\}/);
    expect(src).toMatch(/key=\{`sb\$\{pc\.id\}`\}/);
  });
  it("dimension labels honour show / colour / size", () => {
    expect(src).toMatch(/if \(!lk\.labels\.show\) return null/);
    expect(src).toMatch(/fill=\{on \? SEL_BLUE : lk\.labels\.color\}/);
    expect(src).toMatch(/ptToPx\(lk\.labels\.sizePt\)/);
  });
  it("the panel is mounted in the parcel page with both scopes wired", () => {
    expect(src).toMatch(/<ParcelStylePanel parcel=\{pc\} workspace=\{userPrefs\.parcelLook\}/);
    expect(src).toMatch(/onEditDefault=\{editLookDefault\} onEditParcel=\{editLookParcel\}/);
  });
});

describe("the panel with no parcel selected", () => {
  it("disables 'This parcel only' and falls back to the workspace default (an edit is never applied to nothing)", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const React = (await import("react")).default;
    const Panel = (await import("../src/workspaces/site-planner/components/ParcelStylePanel.jsx")).default;
    const html = renderToStaticMarkup(React.createElement(Panel, { parcel: null, workspace: {}, themeHex: { parcel: "#1d9e75", setback: "#7c3aed", ink: "#111111" }, onEditDefault() {}, onEditParcel() {}, onBeginGesture() {}, onResetParcel() {} }));
    expect(html).toMatch(/data-scope="default"/);
    expect(html).toMatch(/data-testid="parcel-style-scope-parcel"[^>]*disabled/);
    expect(html).not.toMatch(/parcel-look-reset/);
    const withParcel = renderToStaticMarkup(React.createElement(Panel, { parcel: { id: "p", stroke: "#123456" }, workspace: {}, themeHex: { parcel: "#1d9e75", setback: "#7c3aed", ink: "#111111" }, onEditDefault() {}, onEditParcel() {}, onBeginGesture() {}, onResetParcel() {} }));
    expect(withParcel).toMatch(/data-scope="parcel"/);
    expect(withParcel).not.toMatch(/data-testid="parcel-style-scope-parcel"[^>]*disabled/);
    expect(withParcel).toMatch(/data-testid="parcel-look-reset"/);
  });
});
