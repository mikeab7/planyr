/* Cursor convention — REVIEW slice (owner convention 2026-10-20, docs/DESIGN.md "Cursor convention"; NEW-4 / B2426785).
 * Red-proof on the pre-fix tree: the Select tool showed the arrow over everything, vertex grips had no cursor,
 * the Stitcher / CompareView / popup read a REF at render time, Add Leader and the busy overlays set no cursor,
 * the rail divider had no capture, and dragover accepted a tab drag with no dropEffect.
 * The runtime half (computed cursor at named points, signed in on the deployed build) is ui-audit/verify-cursors-review.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { gripCursorFor, vertexGripAt, gripHoverCursor, viewportCursor, fileDropEffect, GRIP_TOL_PX } from "../src/workspaces/doc-review/lib/reviewCursor.js";

const DIR = "src/workspaces/doc-review";
const read = (p) => readFileSync(join(DIR, p), "utf8");
const doc = read("DocReview.jsx");
const stitcher = read("Stitcher.jsx");
const compare = read("CompareView.jsx");
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(jsx?|css)$/.test(n)) out.push(p);
  }
  return out;
}
const files = walk(DIR);

describe("grip cursors follow the grip's position, not its index (points are stored in DRAG ORDER)", () => {
  const rect = (a, b) => [a, b];
  it("a box drawn top-left → bottom-right: both grips are on the \\ diagonal", () => {
    const pts = rect({ x: 10, y: 10 }, { x: 90, y: 60 });
    expect(gripCursorFor("rect", pts, 0)).toBe("nwse-resize");
    expect(gripCursorFor("rect", pts, 1)).toBe("nwse-resize");
  });
  it("the SAME box drawn bottom-right → top-left reads identically (index order must not matter)", () => {
    const pts = rect({ x: 90, y: 60 }, { x: 10, y: 10 });
    expect(gripCursorFor("rect", pts, 0)).toBe("nwse-resize");
    expect(gripCursorFor("rect", pts, 1)).toBe("nwse-resize");
  });
  it("a box drawn along the / diagonal reads nesw, in either drag order", () => {
    expect(gripCursorFor("ellipse", rect({ x: 90, y: 10 }, { x: 10, y: 60 }), 0)).toBe("nesw-resize");
    expect(gripCursorFor("cloud", rect({ x: 10, y: 60 }, { x: 90, y: 10 }), 1)).toBe("nesw-resize");
    expect(gripCursorFor("snapshot", rect({ x: 10, y: 60 }, { x: 90, y: 10 }), 0)).toBe("nesw-resize");
  });
  it("a degenerate (flat) box resizes along its one axis", () => {
    expect(gripCursorFor("rect", rect({ x: 10, y: 10 }, { x: 90, y: 10 }), 0)).toBe("ew-resize");
    expect(gripCursorFor("rect", rect({ x: 10, y: 10 }, { x: 10, y: 90 }), 1)).toBe("ns-resize");
  });
  it("line / polyline / polygon / arc / callout / dimension vertices MOVE", () => {
    const pts = [{ x: 0, y: 0 }, { x: 50, y: 40 }, { x: 80, y: 10 }];
    for (const k of ["line", "polyline", "polygon", "arc", "callout", "dimension", "distance", "area", "text", "count"]) {
      expect(gripCursorFor(k, pts, 1)).toBe("move");
    }
  });
});

describe("one grip rule for the press and the hover", () => {
  const m = { kind: "line", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
  it("finds the vertex inside the tolerance at the viewport scale and ignores one outside it", () => {
    expect(GRIP_TOL_PX).toBe(8);
    expect(vertexGripAt(m, { x: 99, y: 3 }, 1)).toBe(1);
    expect(vertexGripAt(m, { x: 50, y: 0 }, 1)).toBe(-1);
    expect(vertexGripAt(m, { x: 4.1, y: 0 }, 2)).toBe(-1); // 4.1 page units at 2× is just past 8 px
    expect(vertexGripAt(m, { x: 3.9, y: 0 }, 2)).toBe(0);
  });
  it("ink (pen / highlight) has no grips", () => {
    expect(vertexGripAt({ kind: "pen", pts: [{ x: 0, y: 0 }] }, { x: 0, y: 0 }, 1)).toBe(-1);
    expect(vertexGripAt({ kind: "highlight", pts: [{ x: 0, y: 0 }] }, { x: 0, y: 0 }, 1)).toBe(-1);
  });
  it("hover cursor is the grip's own cursor, or null off a grip", () => {
    expect(gripHoverCursor(m, { x: 1, y: 1 }, 1)).toBe("move");
    expect(gripHoverCursor(m, { x: 50, y: 50 }, 1)).toBeNull();
    const box = { kind: "rect", pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    expect(gripHoverCursor(box, { x: 100, y: 99 }, 1)).toBe("nwse-resize");
  });
});

describe("the viewport cursor is derived from state", () => {
  const c = viewportCursor;
  it("Select over EMPTY sheet = grab (a drag pans); over a markup = move", () => {
    expect(c({ tool: "select" })).toBe("grab");
    expect(c({ tool: "select", hoverMarkup: true })).toBe("move");
  });
  it("a vertex grip under the pointer shows its own cursor (and outranks the markup's move)", () => {
    expect(c({ tool: "select", hoverMarkup: true, hoverGrip: "nesw-resize" })).toBe("nesw-resize");
  });
  it("a live move / group / vertex gesture holds its cursor for the whole gesture, wherever the pointer is", () => {
    expect(c({ tool: "select", dragCursor: "move" })).toBe("move");
    expect(c({ tool: "select", dragCursor: "nwse-resize", hoverMarkup: false })).toBe("nwse-resize");
  });
  it("a live pan is grabbing, over everything", () => {
    expect(c({ tool: "select", panning: true, dragCursor: "move", hoverGrip: "move" })).toBe("grabbing");
    expect(c({ tool: "pan", panning: true })).toBe("grabbing");
  });
  it("Pan tool / Space = grab", () => {
    expect(c({ tool: "pan", panMode: true })).toBe("grab");
    expect(c({ tool: "rect", panMode: true })).toBe("grab");
  });
  it("any armed draw tool = crosshair, even over an existing markup", () => {
    for (const t of ["rect", "line", "text", "calibrate", "distance", "eraser", "marquee"]) expect(c({ tool: t, hoverMarkup: true })).toBe("crosshair");
  });
  it("Add Leader armed = crosshair over everything, whatever the tool", () => {
    expect(c({ tool: "select", addLeader: true, hoverMarkup: true })).toBe("crosshair");
    expect(c({ tool: "pan", panMode: true, addLeader: true })).toBe("crosshair");
  });
  it("the Calibrate length box open: canvas presses are ignored, so the arrow", () => {
    expect(c({ tool: "calibrate", calibrating: true })).toBe("default");
  });
});

describe("a dragover that accepts a tab drag but ignores the drop says so", () => {
  it("fileDropEffect: copy for files, none for anything else", () => {
    expect(fileDropEffect(["Files"])).toBe("copy");
    expect(fileDropEffect(["text/plain"])).toBe("none");
    expect(fileDropEffect(undefined)).toBe("none");
  });
  it("both of DocReview's file-drop surfaces set dropEffect", () => {
    const hits = doc.match(/onDragOver=\{[^}]*\}/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) expect(h).toMatch(/dropEffect/);
  });
  it("Stitcher's drop surface and the tab strip's reorder both set dropEffect", () => {
    expect((stitcher.match(/onDragOver=\{[^}]*\}/g) || [])[0]).toMatch(/dropEffect/);
    expect(read("components/ReviewTabStrip.jsx")).toMatch(/dropEffect\s*=\s*"move"/);
  });
});

describe("DocReview wires the derived cursor", () => {
  it("the viewport's cursor comes from viewportCursor(), not an inline select→default ternary", () => {
    expect(doc).toMatch(/from "\.\/lib\/reviewCursor\.js"/);
    expect(doc).toMatch(/cursor:\s*viewportCursor\(/);
    expect(doc).not.toMatch(/tool === "select" \? "default" : "crosshair"/);
  });
  it("the press and the hover share vertexGripAt (no private 8-px loop in onDown)", () => {
    expect(doc).toMatch(/vertexGripAt\(/);
    expect(doc).not.toMatch(/Math\.hypot\(\(p\.x - q\.x\) \* view\.scale, \(p\.y - q\.y\) \* view\.scale\) <= 8/);
  });
  it("the live gesture cursor is STATE, cleared on pointerup and on cancel", () => {
    expect(doc).toMatch(/const \[dragCursor, setDragCursor\] = useState/);
    const up = doc.slice(doc.indexOf("const onUp = (e) =>"), doc.indexOf("const onCancel = (e) =>"));
    expect(up).toMatch(/setDragCursor\(null\)/);
    const cancel = doc.slice(doc.indexOf("const onCancel = (e) =>"), doc.indexOf("const finishDraft"));
    expect(cancel).toMatch(/setDragCursor\(null\)/);
  });
  it("the Opening… chip shows progress", () => {
    const i = doc.indexOf('data-testid="sheet-switching"');
    expect(doc.slice(i, i + 700)).toMatch(/cursor:\s*"progress"/);
  });
  it("the rail divider holds col-resize for the whole drag (pinned past the clamp)", () => {
    const i = doc.indexOf("const startRailResize");
    expect(doc.slice(i, i + 700)).toMatch(/pinDragCursor\("col-resize"\)/);
  });
});

describe("no cursor is read from a ref at render time", () => {
  for (const [name, src] of [["Stitcher", stitcher], ["CompareView", compare], ["DocReview", doc]]) {
    it(`${name}: no \`cursor: …\\.current\``, () => {
      const bad = src.split("\n").filter((l) => /cursor:[^,}]*\.current/.test(l));
      expect(bad).toEqual([]);
    });
  }
  it("Stitcher's canvas shows grabbing while it pans (state), and its detail popup likewise", () => {
    expect(stitcher).toMatch(/const \[panning, setPanning\] = useState/);
    expect(stitcher).toMatch(/cursor:\s*align \? "crosshair" : tool === "pan" \? \(panning \? "grabbing" : "grab"\)/);
    expect(stitcher).toMatch(/const \[detailDragging, setDetailDragging\] = useState/);
    expect(stitcher).toMatch(/cursor:\s*detailDragging \? "grabbing" : "grab"/);
  });
  it("CompareView's canvas pans from state and captures the pointer", () => {
    expect(compare).toMatch(/const \[panning, setPanning\] = useState/);
    expect(compare).toMatch(/cursor:\s*panning \? "grabbing" : "grab"/);
    expect(compare).toMatch(/setPointerCapture/);
  });
});

describe("busy / loading overlays show progress", () => {
  it("CompareView 'Comparing revisions…' overlay", () => {
    expect(compare).toMatch(/const busyOv = \{[^}]*cursor:\s*"progress"/);
  });
  it("VersionHistory 'Working…' note, and the buttons that are disabled because they are working say so", () => {
    const vh = read("components/VersionHistorySheet.jsx");
    expect(vh).toMatch(/Working…/);
    expect(vh).toMatch(/aria-busy/);
    expect(vh).toMatch(/cursor:\s*"progress"/);
  });
  it("DocEditor save / restore / copy buttons that are disabled while working carry aria-busy", () => {
    const de = read("docEditor/DocEditor.jsx");
    expect((de.match(/aria-busy/g) || []).length).toBeGreaterThanOrEqual(4);
  });
  it("CloseFileDialog's busy buttons carry aria-busy", () => {
    expect(read("components/CloseFileDialog.jsx")).toMatch(/aria-busy/);
  });
});

describe("a disabled control shows the arrow — never pointer, never not-allowed", () => {
  it("nothing in the slice sets cursor: not-allowed", () => {
    expect(files.filter((f) => /cursor:\s*["']?not-allowed/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  it("CompareView's page-step buttons (disabled at either end) take the arrow, not a hard-coded pointer", () => {
    const m = compare.match(/const stepBtn = [^\n]*/)[0];
    expect(m).toMatch(/disabled \? "default" : "pointer"/);
    expect(compare).not.toMatch(/style=\{stepBtn\}/);
  });
  it("no JSX tag in the slice that is `disabled=` also hard-codes an unconditional inline pointer", () => {
    const bad = [];
    for (const f of files.filter((x) => /\.jsx$/.test(x))) {
      const src = readFileSync(f, "utf8");
      for (const tag of src.match(/<(?:button|Button|input|select)\b[^>]*?disabled=[^>]*>/gs) || []) {
        if (/cursor:\s*"pointer"/.test(tag)) bad.push(`${f}: ${tag.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
