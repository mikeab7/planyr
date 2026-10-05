// NEW-1 (2026-10-05) — "Flatten markups" OFF: markups become native, editable PDF annotations.
// These tests build the file through the real writer (imagePdf.jpegToPdf) from SVG trees shaped exactly
// like the exported clone's markup nodes, then read it back with a SECOND PDF library (pdf.js) —
// the round-trip the owner's Bluebeam/Acrobat will perform.
import { describe, it, expect } from "vitest";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import {
  buildAnnotations, flattenTree, parsePathD, parseTransform, parseColor, arcToBeziers, winAnsi, compose,
} from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { cloudScallopPath } from "../src/workspaces/site-planner/lib/cloudGeometry.js";

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };

// A 792×612 pt Letter sheet; the plan window is the clone viewBox (0 0 1000 800) fitted "meet" into
// a 700×500 pt box — so k = 0.625 and the window is 625 pt tall... computed the same way exportSheet does.
const VB = { x: 0, y: 0, w: 1000, h: 800 };
const PAGE = { w: 792, h: 612 };
const PLAN = { x: 40, y: 40, w: 700, h: 500 };
const s = Math.min(PLAN.w / VB.w, PLAN.h / VB.h);           // 0.625
const ox = PLAN.x + (PLAN.w - VB.w * s) / 2, oy = PLAN.y + (PLAN.h - VB.h * s) / 2;
const M0 = [s, 0, 0, -s, ox - VB.x * s, PAGE.h - (oy - VB.y * s)];
const frame = [ox, PAGE.h - (oy + VB.h * s), ox + VB.w * s, PAGE.h - oy];

const T = (tag, a = {}, kids = [], extra = {}) => ({ tag, a, kids, ...extra });
const g = (a, ...kids) => T("g", a, kids);
const HIT = "rgba(0,0,0,0.001)";
const mk = (kind, id, inner, meta = {}, hints) => ({ family: "markup", id, kind, tree: g({ "data-feature": `markup:${id}`, "data-markup": id }, ...inner), meta, hints });

// One of every markup type, in the same primitives the planner's renderMarkupNode emits.
const poly = "100,100 300,120 280,260 120,240";
const cloudPts = [{ x: 600, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 220 }, { x: 600, y: 220 }];
const descriptors = [
  mk("line", "L1", [T("line", { x1: 50, y1: 50, x2: 250, y2: 90, stroke: HIT, "stroke-width": 16 }),
    T("line", { x1: 50, y1: 50, x2: 250, y2: 90, stroke: "#dc2626", "stroke-width": 1.2, "stroke-dasharray": "6 3", fill: "none" })], { subject: "Line", comment: "check this", author: "Michael", createdAt: "2026-10-01T12:00:00Z" }),
  mk("polyline", "P1", [T("polyline", { points: "60,300 160,340 260,310 360,380", fill: "none", stroke: "#2563eb", "stroke-width": 1.5 })]),
  mk("rect", "R1", [T("rect", { x: 400, y: 300, width: 120, height: 80, stroke: "#16a34a", "stroke-width": 1, fill: "#16a34a", "fill-opacity": 0.25 })]),
  mk("rect", "R2", [T("rect", { x: 400, y: 450, width: 120, height: 60, stroke: "#16a34a", "stroke-width": 1, fill: "none", transform: "rotate(30 460 480)" })]),
  mk("ellipse", "E1", [T("ellipse", { cx: 700, cy: 400, rx: 80, ry: 40, stroke: "#9333ea", "stroke-width": 1, fill: "none" })]),
  mk("polygon", "G1", [T("polygon", { points: poly, stroke: "#ea580c", "stroke-width": 1.2, fill: "#ea580c", "fill-opacity": 0.2 })]),
  mk("cloud", "C1", [T("path", { d: cloudScallopPath(cloudPts, 12), stroke: "#dc2626", "stroke-width": 1.3, fill: "none", "stroke-linejoin": "round" })],
    { subject: "Cloud", comment: "revise", author: "Michael", createdAt: "2026-10-02T09:30:00Z", modifiedAt: "2026-10-03T10:00:00Z" }, { verts: cloudPts, arcFt: 3 }),
  { family: "callout", id: "K1", kind: "callout", meta: { lines: ["Move this", "away from the pad"], align: "center", rot: 0 },
    tree: g({ "data-testid": "callout-K1", "data-feature": "callout:K1", "data-callout-leaders": 1 },
      g({ "data-testid": "callout-leader-K1-0" },
        T("line", { "data-testid": "callout-leader-stub-K1-0", x1: 500, y1: 600, x2: 480, y2: 640, stroke: "#334155", "stroke-width": 1.4 }),
        T("line", { "data-testid": "callout-leader-run-K1-0", x1: 480, y1: 640, x2: 420, y2: 700, stroke: "#334155", "stroke-width": 1.4 }),
        T("polygon", { "data-testid": "callout-leader-arrow-K1-0", points: "420,700 430,688 436,696", fill: "#334155" })),
      g({},
        T("rect", { "data-testid": "callout-box-K1", x: 500, y: 560, width: 160, height: 60, rx: 4, fill: "#fff8e1", "fill-opacity": 1, stroke: "#334155", "stroke-width": 1.4 }),
        T("text", { x: 580, y: 580, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 13, fill: "#1e293b", "font-weight": 500 }, [], { str: "Move this", tw: 58 }),
        T("text", { x: 580, y: 600, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 13, fill: "#1e293b", "font-weight": 500 }, [], { str: "away from the pad", tw: 104 }))) },
  { family: "callout", id: "K2", kind: "textbox", meta: { lines: ["Note ⚠ 12°"], align: "left", rot: 0 },
    tree: g({ "data-testid": "callout-K2", "data-feature": "callout:K2", "data-callout-leaders": 0 },
      g({}, T("rect", { "data-testid": "callout-box-K2", x: 700, y: 620, width: 120, height: 40, rx: 4, fill: "none", stroke: "#334155", "stroke-width": 1 }),
        T("text", { x: 714, y: 640, "text-anchor": "start", "dominant-baseline": "middle", "font-size": 12, fill: "#1e293b", "font-weight": 700 }, [], { str: "Note ⚠ 12°", tw: 70 }))) },
  { family: "measure", id: "M1", kind: "line", meta: { chipTexts: ["142′ 6″"] },
    tree: g({ "data-feature": "measure:0", "data-measure": "M1", "data-measure-mode": "line" },
      T("polyline", { points: "100,700 300,690", fill: "none", stroke: "#0ea5e9", "stroke-width": 1.2 }),
      g({ "data-print-chip": "measure" }, T("text", { "data-chip-text": "", x: 200, y: 680, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 11, fill: "#111827", stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke" }, [], { str: "142′ 6″", tw: 40 }))) },
  { family: "measure", id: "M2", kind: "area", meta: { chipTexts: ["1.20 ac"] },
    tree: g({ "data-feature": "measure:1", "data-measure": "M2", "data-measure-mode": "area" },
      T("polygon", { points: "600,600 700,610 690,700 610,690", fill: "#0ea5e9", "fill-opacity": 0.15, stroke: "#0ea5e9", "stroke-width": 1.2 })) },
  { family: "measure", id: "M3", kind: "polyline", meta: { chipTexts: ["310′"] },
    tree: g({ "data-feature": "measure:2", "data-measure": "M3", "data-measure-mode": "polyline" },
      T("polyline", { points: "800,100 850,200 900,180", fill: "none", stroke: "#0ea5e9", "stroke-width": 1.2 })) },
  { family: "measure", id: "M4", kind: "count", meta: { chipTexts: ["3"] },
    tree: g({ "data-feature": "measure:3", "data-measure": "M4", "data-measure-mode": "count" },
      g({}, T("circle", { cx: 900, cy: 500, r: 8, fill: "#0ea5e928", stroke: "#0ea5e9", "stroke-width": 1 }), T("text", { x: 900, y: 503, "text-anchor": "middle", "font-size": 8.5, fill: "#0ea5e9", "font-weight": 700 }, [], { str: "1", tw: 5 }))) },
];

const built = buildAnnotations(descriptors, { M0, frame });
const pdf = jpegToPdf({ jpeg: fakeJpeg, pixelW: 3300, pixelH: 2550, widthIn: 11, heightIn: 8.5, title: "t", annotations: built.annots });
const text = latin1(pdf);

describe("buildAnnotations — one native annotation per markup, right subtype", () => {
  const sub = Object.fromEntries(built.annots.map((a) => [a.id, a.subtype]));
  it("maps every markup type to the closest standard subtype", () => {
    expect(sub).toEqual({
      L1: "Line", P1: "PolyLine", R1: "Square", R2: "Polygon", E1: "Circle", G1: "Polygon", C1: "Polygon",
      K1: "FreeText", K2: "FreeText", M1: "Line", M2: "Polygon", M3: "PolyLine", M4: "Stamp",
    });
    expect(built.skipped).toEqual([]);
  });
  it("a cloud carries the cloudy border effect and its real vertex ring", () => {
    const c = built.annots.find((a) => a.id === "C1");
    expect(c.BE).toEqual({ S: "C", I: 1 });
    expect(c.vertices).toHaveLength(8);
  });
  it("a callout is a FreeText callout with a closed-arrow leader and a knee", () => {
    const k = built.annots.find((a) => a.id === "K1");
    expect(k.IT).toBe("FreeTextCallout");
    expect(k.LE).toBe("ClosedArrow");
    expect(k.CL).toHaveLength(6);          // tip, knee, box edge
    expect(k.contents).toBe("Move this\naway from the pad");
    const t = built.annots.find((a) => a.id === "K2");
    expect(t.IT).toBe("FreeText");
    expect(t.CL).toBeNull();
    expect(t.Q).toBe(0);
  });
  it("every annotation sits inside the plan window, which sits inside the page", () => {
    for (const a of built.annots) {
      expect(a.rect[0]).toBeGreaterThanOrEqual(frame[0] - 1e-6);
      expect(a.rect[2]).toBeLessThanOrEqual(frame[2] + 1e-6);
      expect(a.rect[1]).toBeGreaterThanOrEqual(frame[1] - 1e-6);
      expect(a.rect[3]).toBeLessThanOrEqual(frame[3] + 1e-6);
      expect(a.rect[0]).toBeGreaterThanOrEqual(0); expect(a.rect[2]).toBeLessThanOrEqual(PAGE.w);
      expect(a.rect[1]).toBeGreaterThanOrEqual(0); expect(a.rect[3]).toBeLessThanOrEqual(PAGE.h);
    }
  });
  it("the hit-test companions (near-invisible fat strokes) are not drawn", () => {
    const l = built.annots.find((a) => a.id === "L1");
    expect(l.ap.stream).not.toMatch(/\b16 w\b|\b10 w\b/);   // 16 * 0.625 = 10
    expect((l.ap.stream.match(/^S$/gm) || []).length).toBe(1);
  });
  it("carries markup metadata: subject, contents, author, dates, colour, opacity", () => {
    const c = built.annots.find((a) => a.id === "L1");
    expect(c.subj).toBe("Line"); expect(c.contents).toBe("check this"); expect(c.title).toBe("Michael");
    expect(c.created).toBe("D:20261001120000Z");
    expect(c.color.map((v) => Math.round(v * 255))).toEqual([220, 38, 38]);
    const cl = built.annots.find((a) => a.id === "C1");
    expect(cl.modified).toBe("D:20261003100000Z");
  });
  it("a measurement keeps its number as the annotation's contents", () => {
    expect(built.annots.find((a) => a.id === "M1").contents).toBe("142′ 6″");
    expect(built.annots.find((a) => a.id === "M2").subj).toBe("Area measurement");
  });
  it("a markup wholly outside the plan window is reported, never silently lost", () => {
    const off = mk("line", "OUT", [T("line", { x1: 5000, y1: 5000, x2: 5100, y2: 5000, stroke: "#000", "stroke-width": 1 })]);
    const r = buildAnnotations([off], { M0, frame });
    expect(r.annots).toHaveLength(0);
    expect(r.skipped[0]).toMatchObject({ id: "OUT", why: "outside the plan window" });
  });
  it("a markup partly outside the window is clipped to it, like the flattened export", () => {
    const part = mk("line", "PART", [T("line", { x1: 900, y1: 400, x2: 1200, y2: 400, stroke: "#000", "stroke-width": 2 })]);
    const r = buildAnnotations([part], { M0, frame });
    expect(r.annots[0].rect[2]).toBeLessThanOrEqual(frame[2] + 1e-6);
  });
});

describe("the written PDF", () => {
  it("lists every annotation on the page, unlocked and printable, each with an /AP /N stream", () => {
    const annots = text.match(/\/Type \/Annot [^\n]*/g) || [];
    expect(annots).toHaveLength(built.annots.length);
    for (const a of annots) {
      expect(a).toMatch(/\/F 4 /);                 // Print only — never ReadOnly (64) or Locked (128)
      expect(a).toMatch(/\/AP << \/N \d+ 0 R >>/);
      expect(a).toMatch(/\/Rect \[/);
    }
    expect(text).toMatch(/\/Annots \[(\d+ 0 R ?){13}\]/);
  });
  it("is still a well-formed file: xref offsets point at their objects", () => {
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const n = Number(/xref\n0 (\d+)/.exec(text)[1]);
    const rows = text.slice(xrefAt).split("\n").slice(2, 2 + n);
    rows.slice(1).forEach((r, i) => {
      const off = Number(r.slice(0, 10));
      expect(text.slice(off, off + String(i + 1).length + 6)).toBe(`${i + 1} 0 obj`);
    });
  });
  it("with no annotations the file is byte-for-byte the old flat PDF", () => {
    const a = jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 11, heightIn: 8.5, title: "x", date: new Date(2026, 5, 20, 21, 15, 0) });
    const b = jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 11, heightIn: 8.5, title: "x", date: new Date(2026, 5, 20, 21, 15, 0), annotations: [] });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(latin1(a)).not.toMatch(/\/Annots/);
  });
});

describe("round-trip through pdf.js — a second PDF library reads and can move every annotation", () => {
  it("getAnnotations returns each one with a valid appearance and editable flags", async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, verbosity: 0 }).promise;
    const page = await doc.getPage(1);
    const an = await page.getAnnotations();
    expect(an).toHaveLength(built.annots.length);
    const byType = {};
    for (const a of an) (byType[a.annotationType] = byType[a.annotationType] || []).push(a);
    // pdf.js AnnotationType: 3 FreeText, 4 Line, 5 Square, 6 Circle, 7 Polygon, 8 Polyline, 13 Stamp
    expect(Object.keys(byType).map(Number).sort((x, y) => x - y)).toEqual([3, 4, 5, 6, 7, 8, 13]);
    for (const a of an) {
      expect(a.annotationFlags & 64).toBe(0);      // not ReadOnly
      expect(a.annotationFlags & 128).toBe(0);     // not Locked
      expect(a.rect.every(Number.isFinite)).toBe(true);
      expect(a.rect[2]).toBeGreaterThan(a.rect[0]);
      expect(a.hasAppearance).toBe(true);
    }
    const ft = byType[3].find((a) => (a.contentsObj?.str || a.contents || "").startsWith("Move this"));
    expect(ft).toBeTruthy();
    const clouds = byType[7].filter((a) => a.vertices);
    expect(clouds.length).toBeGreaterThanOrEqual(3);
  });
});

describe("pure pieces", () => {
  it("parses colours incl. the 8-digit hex the measure count marker uses", () => {
    expect(parseColor("#0ea5e928").a).toBeCloseTo(40 / 255, 3);
    expect(parseColor("rgba(0,0,0,0.001)").a).toBeCloseTo(0.001, 5);
    expect(parseColor("none")).toBeNull();
  });
  it("rotate(a cx cy) leaves its centre fixed", () => {
    const M = parseTransform("rotate(30 460 480)");
    expect(M[0] * 460 + M[2] * 480 + M[4]).toBeCloseTo(460, 6);
    expect(M[1] * 460 + M[3] * 480 + M[5]).toBeCloseTo(480, 6);
  });
  it("arcs become béziers that end exactly on the endpoint", () => {
    const b = arcToBeziers(0, 0, 10, 10, 0, 0, 1, 20, 0);
    expect(b[b.length - 1].slice(4)).toEqual([20, 0]);
    expect(b.length).toBeGreaterThanOrEqual(2);
  });
  it("the cloud path round-trips through the path parser as closed", () => {
    const segs = parsePathD(cloudScallopPath(cloudPts, 12));
    expect(segs[0][0]).toBe("M"); expect(segs[segs.length - 1][0]).toBe("Z");
    expect(segs.some((x) => x[0] === "C")).toBe(true);
  });
  it("text that WinAnsi cannot carry degrades to a readable stand-in, and says so", () => {
    expect(winAnsi("⚠ 12°")).toEqual({ text: "! 12°", lossy: false });   // benign stand-in, not reported
    expect(winAnsi("142′ 6″")).toEqual({ text: "142' 6\"", lossy: false });
    expect(winAnsi("日本")).toEqual({ text: "??", lossy: true });          // no equivalent at all → reported
  });
  it("compose applies the right-hand matrix first", () => {
    const M = compose([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 5, 5]);
    expect(M.slice(4)).toEqual([10, 10]);
  });
  it("flattenTree skips display:none and data-export=skip subtrees", () => {
    const r = flattenTree(g({}, T("line", { x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#000", "stroke-width": 1, "data-export": "skip" }),
      T("line", { x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#000", "stroke-width": 1, display: "none" }),
      T("line", { x1: 0, y1: 0, x2: 1, y2: 1, stroke: "#000", "stroke-width": 1 })), [1, 0, 0, 1, 0, 0]);
    expect(r.items).toHaveLength(1);
  });
});
