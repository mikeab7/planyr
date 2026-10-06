// Shared fixture for the markup-annotation tests and the regeneration harness: one of every markup
// type, in the same primitives the planner's renderMarkupNode / callout / measure code emits.
import { cloudScallopPath } from "../../src/workspaces/site-planner/lib/cloudGeometry.js";
import { buildAnnotations } from "../../src/workspaces/site-planner/lib/pdfAnnotations.js";

// A 792×612 pt Letter sheet; the plan window is the clone viewBox (0 0 1000 800) fitted "meet" into
// a 700×500 pt box — so k = 0.625 and the window is 625 pt tall... computed the same way exportSheet does.
export const VB = { x: 0, y: 0, w: 1000, h: 800 };
export const PAGE = { w: 792, h: 612 };
export const PLAN = { x: 40, y: 40, w: 700, h: 500 };
const s = Math.min(PLAN.w / VB.w, PLAN.h / VB.h);           // 0.625
const ox = PLAN.x + (PLAN.w - VB.w * s) / 2, oy = PLAN.y + (PLAN.h - VB.h * s) / 2;
export const M0 = [s, 0, 0, -s, ox - VB.x * s, PAGE.h - (oy - VB.y * s)];
export const frame = [ox, PAGE.h - (oy + VB.h * s), ox + VB.w * s, PAGE.h - oy];

export const T = (tag, a = {}, kids = [], extra = {}) => ({ tag, a, kids, ...extra });
export const g = (a, ...kids) => T("g", a, kids);
const HIT = "rgba(0,0,0,0.001)";
export const mk = (kind, id, inner, meta = {}, hints) => ({ family: "markup", id, kind, tree: g({ "data-feature": `markup:${id}`, "data-markup": id }, ...inner), meta, hints });

// One of every markup type, in the same primitives the planner's renderMarkupNode emits.
const poly = "100,100 300,120 280,260 120,240";
export const cloudPts = [{ x: 600, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 220 }, { x: 600, y: 220 }];
export const descriptors = [
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
      T("polygon", { points: "600,600 700,610 690,700 610,690", fill: "#0ea5e9", "fill-opacity": 0.15, stroke: "#0ea5e9", "stroke-width": 1.2 }),
      g({ "data-print-chip": "measure" }, T("text", { "data-chip-text": "", x: 650, y: 650, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 11, fill: "#111827", stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke" }, [], { str: "1.20 ac", tw: 38 }))) },
  { family: "measure", id: "M3", kind: "polyline", meta: { chipTexts: ["310′"] },
    tree: g({ "data-feature": "measure:2", "data-measure": "M3", "data-measure-mode": "polyline" },
      T("polyline", { points: "800,100 850,200 900,180", fill: "none", stroke: "#0ea5e9", "stroke-width": 1.2 }),
      g({ "data-print-chip": "measure" }, T("text", { "data-chip-text": "", x: 860, y: 140, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": 11, fill: "#111827", stroke: "#ffffff", "stroke-width": 3, "paint-order": "stroke" }, [], { str: "310′", tw: 26 }))) },
  { family: "measure", id: "M4", kind: "count", meta: { chipTexts: ["3"] },
    tree: g({ "data-feature": "measure:3", "data-measure": "M4", "data-measure-mode": "count" },
      g({}, T("circle", { cx: 900, cy: 500, r: 8, fill: "#0ea5e928", stroke: "#0ea5e9", "stroke-width": 1 }), T("text", { x: 900, y: 503, "text-anchor": "middle", "font-size": 8.5, fill: "#0ea5e9", "font-weight": 700 }, [], { str: "1", tw: 5 }))) },
];


export const buildFixture = () => buildAnnotations(descriptors, { M0, frame });
