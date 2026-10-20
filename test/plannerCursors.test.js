/* Site Planner cursor convention (owner-approved 2026-10-20) — the pure rules + source guards.
 * The browser half is e2e/planner-cursors.spec.js and e2e/map-cursors.spec.js (computed cursor under the real pointer); the live
 * half is ui-audit/verify-planner-cursors-live.mjs. Every source guard here is RED on the pre-fix tree (commit 2500b00). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  gripCursor, resizeCursorForVector, dragCursorFor, canvasRootCursor, parcelBodyCursor, controlCursor, bodyCursor,
  pinDragCursor, unpinDragCursor, dragCursorPinned, plannerCursorCss, installPlannerCursorStyle, setMapCursor, ROTATE_CURSOR,
} from "../src/workspaces/site-planner/lib/plannerCursors.js";
import { canDropOverlay } from "../src/workspaces/site-planner/lib/overlayOrder.js";

const ROOT = new URL("../src/workspaces/site-planner/", import.meta.url).pathname;
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const walk = (d) => readdirSync(join(ROOT, d)).flatMap((f) => (statSync(join(ROOT, d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const SLICE = ["SitePlanner.jsx", "MapFinder.jsx", ...walk("components"), ...walk("lib")].filter((f) => /\.(jsx|js)$/.test(f));

/* A tiny fake document: enough for the style-element helpers. */
function fakeDoc() {
  const nodes = new Map();
  return {
    head: { appendChild(n) { nodes.set(n.id, n); n.parentNode = { removeChild: () => nodes.delete(n.id) }; } },
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: (id) => nodes.get(id) || null,
    _nodes: nodes,
  };
}

describe("resize grips follow the grip's own axes and the object's rotation", () => {
  it("a long warehouse's four corners are the two diagonals, never ew/ns (the centre→corner angle gave ew on all of them)", () => {
    expect(gripCursor(-1, -1, 0)).toBe("nwse-resize");
    expect(gripCursor(1, -1, 0)).toBe("nesw-resize");
    expect(gripCursor(1, 1, 0)).toBe("nwse-resize");
    expect(gripCursor(-1, 1, 0)).toBe("nesw-resize");
  });
  it("edges are straight ew / ns and turn with the object", () => {
    expect(gripCursor(1, 0, 0)).toBe("ew-resize");
    expect(gripCursor(0, 1, 0)).toBe("ns-resize");
    expect(gripCursor(1, 0, 90)).toBe("ns-resize");
    expect(gripCursor(0, 1, 90)).toBe("ew-resize");
  });
  it("hand-worked: rotated 30°, corners read ns / ew / ns / ew; rotated 45° they swap diagonals", () => {
    expect([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => gripCursor(x, y, 30))).toEqual(["ns-resize", "ew-resize", "ns-resize", "ew-resize"]);
    expect(gripCursor(1, 1, 45)).toBe("ns-resize");
    expect(gripCursor(1, 1, 90)).toBe("nesw-resize");
  });
  it("a degenerate vector never throws", () => {
    expect(resizeCursorForVector(0, 0)).toBe("nwse-resize");
    expect(resizeCursorForVector(NaN, 1)).toBe("nwse-resize");
  });
});

describe("what a live drag shows", () => {
  it("pan is grabbing, draws are crosshair, moves and vertex grips are move, rotate is the rotate cursor", () => {
    expect(dragCursorFor("pan")).toBe("grabbing");
    for (const m of ["draw", "mkDraw", "marquee", "mkCloudGesture"]) expect(dragCursorFor(m)).toBe("crosshair");
    for (const m of ["move", "groupMove", "mkMove", "measureMove", "moveSheetOverlay", "callout", "vertex", "roadVtx", "roadEnd", "elVertex", "mkVertex", "easeVertex", "grLimitVertex", "printMove", "dimMove"]) expect(dragCursorFor(m)).toBe("move");
    for (const m of ["rotate", "mkRotate", "ovRotate", "calloutRotate", "easeLabelRot"]) expect(dragCursorFor(m)).toBe(ROTATE_CURSOR);
  });
  it("a resize drag keeps the arrow the grip showed at press, with a safe fallback", () => {
    expect(dragCursorFor("resize", "ns-resize")).toBe("ns-resize");
    expect(dragCursorFor("ovScale", "nesw-resize")).toBe("nesw-resize");
    expect(dragCursorFor("mkResize", "grab")).toBe("nwse-resize");
  });
  it("an unknown mode pins nothing (the drag falls back to the surface's own cursor)", () => {
    expect(dragCursorFor("somethingNew")).toBeNull();
  });
  it("every drag mode the planner arms is classified (a new mode cannot silently miss the pin)", () => {
    const modes = new Set([...read("SitePlanner.jsx").matchAll(/drag\.current = \{ mode: "([A-Za-z0-9]+)"/g)].map((m) => m[1]));
    expect(modes.size).toBeGreaterThan(25);
    const missing = [...modes].filter((m) => dragCursorFor(m, "nwse-resize") === null);
    expect(missing).toEqual([]);
  });
});

describe("root + body rules", () => {
  const base = { spacePan: false, panning: false, identifyMode: false, addCursor: "ADD", armedMode: false, editingCorners: false, tool: "select", printMode: false };
  it("idle select is the open hand; panning is grabbing; an armed mode or a draw tool is crosshair; identify is the + cursor", () => {
    expect(canvasRootCursor(base)).toBe("grab");
    expect(canvasRootCursor({ ...base, panning: true })).toBe("grabbing");
    expect(canvasRootCursor({ ...base, armedMode: true })).toBe("crosshair");
    expect(canvasRootCursor({ ...base, tool: "road" })).toBe("crosshair");
    expect(canvasRootCursor({ ...base, identifyMode: true })).toBe("ADD");
    expect(canvasRootCursor({ ...base, spacePan: true })).toBe("grab");
  });
  it("a lot's body pans outside Edit parcels (grab, never move); inside Edit a free lot moves, a locked one still pans; remove has its own cursor", () => {
    expect(parcelBodyCursor({ tool: "select", editingCorners: false, locked: false })).toBe("grab");
    expect(parcelBodyCursor({ tool: "select", editingCorners: false, locked: true })).toBe("grab");
    expect(parcelBodyCursor({ tool: "select", editingCorners: true, locked: false })).toBe("move");
    expect(parcelBodyCursor({ tool: "select", editingCorners: true, locked: true })).toBe("grab");
    expect(parcelBodyCursor({ tool: "select", editingCorners: true, addPoint: true, addCursor: "ADD" })).toBe("ADD");
    expect(parcelBodyCursor({ tool: "parcel", parcelMode: "remove", removeCursor: "REMOVE" })).toBe("REMOVE");
    expect(parcelBodyCursor({ tool: "road" })).toBe("crosshair");
  });
  it("a locked thing is never move; an armed mode is crosshair; disabled is default and busy is progress", () => {
    expect(bodyCursor({ armed: false, locked: true })).toBe("pointer");
    expect(bodyCursor({ armed: false, locked: false })).toBe("move");
    expect(bodyCursor({ armed: true, locked: false })).toBe("crosshair");
    expect(controlCursor({ disabled: true })).toBe("default");
    expect(controlCursor({ busy: true, disabled: true })).toBe("progress");
    expect(controlCursor({})).toBe("pointer");
  });
});

describe("the drag pin and the stylesheet", () => {
  it("pins one root rule, replaces it, and clears it", () => {
    const doc = fakeDoc();
    pinDragCursor("move", doc); expect(dragCursorPinned()).toBe("move");
    expect(doc.getElementById("planyr-drag-cursor-pin").textContent).toContain("cursor: move !important");
    pinDragCursor("nwse-resize", doc); expect(doc._nodes.size).toBe(1);
    unpinDragCursor(doc); expect(dragCursorPinned()).toBeNull(); expect(doc._nodes.size).toBe(0);
  });
  it("the stylesheet covers the armed modes, the Map's inherited cursor, hover-only layers, disabled and native controls", () => {
    const css = plannerCursorCss({ add: "A", remove: "R" });
    for (const frag of ['data-cursor-mode="armed"', "crosshair !important", 'data-cursor-mode="identify"', "cursor: A !important", 'data-cursor-mode="remove"', "cursor: R !important",
      "[data-cursor-owned]", ".pf-hover-only", "button:disabled", 'input[type="checkbox"]']) expect(css).toContain(frag);
    expect(css).toMatch(/button:disabled[^{]*\{ cursor: default !important/);
    const doc = fakeDoc(); installPlannerCursorStyle({}, doc); installPlannerCursorStyle({}, doc);
    expect(doc._nodes.size).toBe(1);
  });
  it("setMapCursor owns/releases the container", () => {
    const attrs = new Set();
    const c = { style: {}, setAttribute: (k) => attrs.add(k), removeAttribute: (k) => attrs.delete(k) };
    setMapCursor(c, "crosshair"); expect(c.style.cursor).toBe("crosshair"); expect(attrs.has("data-cursor-owned")).toBe(true);
    setMapCursor(c, ""); expect(c.style.cursor).toBe(""); expect(attrs.has("data-cursor-owned")).toBe(false);
  });
});

describe("overlay row drag: a drop the order rules would refuse says no-drop up front", () => {
  const ovs = [{ id: "a", aboveParcel: false }, { id: "b", aboveParcel: false }, { id: "c", aboveParcel: true }];
  it("same band is accepted; another band and self are refused", () => {
    expect(canDropOverlay(ovs, "a", "b", "front")).toBe(true);
    expect(canDropOverlay(ovs, "a", "c", "front")).toBe(false);
    expect(canDropOverlay(ovs, "a", "a", "front")).toBe(false);
    expect(canDropOverlay(ovs, null, "b", "front")).toBe(false);
  });
});

describe("source guards (all red on 2500b00)", () => {
  const sp = read("SitePlanner.jsx"), mf = read("MapFinder.jsx");
  it("no not-allowed cursor anywhere in the Site Planner slice", () => {
    const hits = SLICE.filter((f) => f !== "lib/plannerCursors.js" && /["']not-allowed["']/.test(read(f)));
    expect(hits).toEqual([]);
  });
  it("the canvas root asks ONE function, and the armed-mode set includes the pick modes the old ternary forgot", () => {
    expect(sp).toContain("canvasRootCursor({");
    expect(sp).not.toMatch(/cursor: spacePan \? \(panning/);
    const m = sp.match(/const cursorMode = [\s\S]*?: null;/)[0];
    for (const v of ["addLeaderFor", "ovAlignBase", "mergePick", "attachFor", "alignFor", "traceMode", "pobMode", "routeMode", "xsecMode", "ovCalib"]) expect(m).toContain(v);
    expect(sp).toContain("data-cursor-mode={cursorMode || undefined}");
  });
  it("corner/scale grips take their cursor from the grip's own axes; none reads grab; no fixed overlay/callout resize cursor", () => {
    expect(sp).not.toMatch(/resizeCursor\(c\.x - cpx\.x/);                          // building corners (centre→corner angle)
    expect(sp).not.toMatch(/startMarkupResize\(e, m\.id, sx, sy\)[\s\S]{0,5}\n?[^\n]*resizeCursor/);
    expect(sp).not.toContain('hi % 2 === 0 ? "nwse-resize" : "nesw-resize"');       // overlay scale grips
    expect(sp).not.toContain('{ cursor: "ew-resize" } : undefined');                // callout width grips
    for (const starter of ["startRotate(e, el.id)", "startMarkupRotate(e, m.id)", "startRotateOverlay(e, o.id)", "startCalloutRotate(e, c.id)", "startEaseLabelRotate(e, m.id)"]) {
      expect(sp, starter).toContain(`style={{ cursor: ROTATE_CURSOR }} onPointerDown={(e) => ${starter}}`);
    }
    for (const road of ['startRoadVtx(e, el.id, i)', 'startRoadEnd(e, el.id, "a")', 'startRoadEnd(e, el.id, "b")']) expect(sp).toContain(`style={{ cursor: "move" }} onPointerDown={(e) => ${road}}`);
  });
  it("a locked callout refuses the drag, and the planner pins a cursor for every live drag", () => {
    expect(sp).toMatch(/if \(c && c\.locked\) return;[^\n]*select-only/);
    expect(sp).toContain("dragCursorFor(d.mode, pressCursorRef.current)");
    expect(sp).toContain('pinDragCursor("col-resize")');
  });
  it("the Map view has ONE cursor owner: no direct container.style.cursor writes, the pan returns to the armed mode, sites go inert while a pin is armed", () => {
    expect(mf).not.toMatch(/getContainer\(\)\.style\.cursor\s*=/);
    expect(mf).not.toMatch(/el\.style\.cursor\s*=/);
    expect(mf).toContain("setMapCursor(map.getContainer(), mapCursorBaseRef.current)");
    expect(mf).toMatch(/const sitesInert = selectMode \|\| placingCompPin/);
    expect(mf.match(/interactive: !sitesInert/g).length).toBe(3);
    expect(mf).toContain("blockSelect: sitesInert");
  });
  it("hover-only layers do not advertise pointer; the plan image's select-click is pointer, a pin pick is crosshair", () => {
    expect(read("lib/featureHoverAttach.js")).toContain('el.style.cursor = "inherit"');
    expect(read("lib/mapSymbols.js")).toContain("pf-hover-only");
    expect((read("lib/evidenceLayers.js").match(/pf-hover-only/g) || []).length).toBe(5);
    expect(read("lib/rotatedImageLayer.js")).toContain('kind === "pin" ? "crosshair" : "pointer"');
    expect(read("lib/overlayPlacementHandles.js")).not.toContain("cursor:grab");
  });
});
