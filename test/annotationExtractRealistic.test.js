/* NEW-1 (2026-10-20) — the editable-PDF export on a plan SHAPED LIKE A REAL ONE.
 *
 * The owner exported his real plan with "Flatten markups" OFF and nothing on it was selectable in Bluebeam except the
 * markups. B2326896 / B2352496 had passed on a throwaway plan of one square building. The cause, measured on his Bain
 * plan: the pin test compared axis-aligned BOUNDING BOXES, and his buildings and truck courts are rotated (168°–204°),
 * so every tilted truck court's box swallowed its building's box and all five buildings stayed burned into the page.
 *
 * Fixture: the real export clone of ui-audit/lib/realisticSitePlan.mjs (his Bain plan verbatim + a reference promoted
 * above the plan over one car-parking field, a markup behind the plan, a callout and every measurement kind), captured
 * from window.__plannerExportSvg. RED on the pre-fix extractor (every building pinned; roads/ponds/parking never lifted).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildAnnotations, annotationDict } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { svgToFake } from "./fixtures/svgToFake.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/realisticSiteClone.json", import.meta.url), "utf8"));
const [o, ux, uy] = FX.f2p;
const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
const M0 = [1, 0, 0, -1, 0, 5000], frame = [-1e6, -1e6, 1e6, 1e6];
const run = () => {
  const clone = svgToFake(FX.svg);
  const order = clone.querySelectorAll("[data-feature],[data-road-cluster]").filter((n) => n.getAttribute("data-label-for") == null && n.getAttribute("data-print-chip") == null);
  const r = extractMarkupAnnotations(clone, { ...FX.model, f2p });
  return { clone, order, r, built: buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns, ftPerPt: 0.5 }) };
};
const REQUIRED = ["Building", "Truck court", "Trailer parking", "Car parking", "Sidewalk", "Road", "Detention pond"];

describe("NEW-1 — every site element on a real-shaped plan becomes an annotation", () => {
  const { clone, order, r, built } = run();
  const hosts = FX.model.els.filter((e) => e.type === "building" && !e.dogEar && !e.attachedTo);

  it("RED-PROOF: every building lifts — none is pinned by its rotated truck court", () => {
    const lifted = r.descriptors.filter((d) => d.family === "building").map((d) => d.id).sort();
    expect(lifted).toEqual(hosts.map((e) => String(e.id)).sort());
  });
  it("every listed element type is a native annotation, with its Subject in plain words", () => {
    const subjects = new Set(built.annots.map((a) => a.subj));
    for (const s of REQUIRED) expect(subjects.has(s), s).toBe(true);
    for (const a of built.annots.filter((x) => x.family === "building" || x.family === "element")) {
      expect(a.subtype).toBe("Polygon");
      expect(a.vertices.length).toBeGreaterThanOrEqual(6);
      expect(a.nm).toMatch(/^planyr-(building|element)-/);
    }
  });
  it("the ONLY object kept in the page is the car-parking field under the promoted reference — and it says why", () => {
    expect(r.pinned).toHaveLength(1);
    expect(r.pinned[0]).toMatchObject({ why: "under-reference", by: "reference:refAbove" });
    expect(r.pinned[0].name).toMatch(/^Car parking /);
    const left = clone.querySelectorAll("[data-feature]").map((n) => n.getAttribute("data-feature")).filter((k) => /^(el|markup|measure|callout):/.test(k));
    expect([...new Set(left)]).toEqual([r.pinned[0].key]); // nothing else drawn stays in the page
  });
  it("/Annots order is the canvas paint order (each object at its last drawn piece)", () => {
    const pos = (key) => order.reduce((m, n, i) => (n.getAttribute("data-feature") === key || (n.getAttribute("data-road-cluster") || "").split(",").includes(key.slice(3)) ? i : m), -1);
    const at = r.descriptors.filter((d) => d.family !== "parcel-label").map((d) => {
      const keys = d.family === "measure" ? [`measure:${FX.model.measures.findIndex((m) => m.id === d.id)}`]
        : d.family === "building" || d.family === "element" ? [d.id, ...(d.meta.bumpOuts || []), ...(d.meta.roads || [])].map((x) => `el:${x}`)
          : [`${d.family}:${d.id}`];
      return Math.max(...keys.map(pos));
    });
    expect(at.every((p) => p >= 0)).toBe(true);
    expect(at).toEqual(at.slice().sort((a, b) => a - b));
  });
  it("a building's label travels in its own appearance; a parcel's acreage label never rides on a building", () => {
    const b = built.annots.find((a) => a.family === "building" && /Building 3/.test(a.contents));
    expect(b).toBeTruthy();
    expect(b.ap.stream).toContain("(Building 3) Tj");
    for (const a of built.annots.filter((x) => x.family === "building")) expect(a.ap.stream).not.toMatch(/Parcel \d+ [\d.]+ AC/);
    const labels = built.annots.filter((a) => a.family === "parcel-label");
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) { expect(l.subj).toBe("Parcel label"); expect(l.contents).toMatch(/AC$/); }
  });
  it("two roads joined into one paved network are ONE annotation (the joint moves with them)", () => {
    const net = r.descriptors.find((d) => d.family === "element" && (d.meta.roads || []).length > 1);
    expect(net).toBeTruthy();
    expect(net.meta.subject).toBe("Road");
  });
  it("every annotation is editable: /F 4 only (never ReadOnly / Locked / NoView), /Subj, /NM, an /AP /N and a valid /Rect", () => {
    for (const a of built.annots) {
      expect(a.subj).toBeTruthy(); expect(a.nm).toBeTruthy();
      expect(a.rect.every(Number.isFinite) && a.rect[2] > a.rect[0] && a.rect[3] > a.rect[1]).toBe(true);
      expect(a.ap && a.ap.stream).toBeTruthy();
    }
    expect(new Set(built.annots.map((a) => a.nm)).size).toBe(built.annots.length);
  });
});

describe("NEW-2 — a measurement carries what a viewer needs to redraw its value after a move", () => {
  // M0 is the identity scale here, so a PDF point IS a clone unit and feet-per-point is 1 / (clone units per foot).
  const unitsPerFt = Math.hypot(ux.x - o.x, ux.y - o.y);
  const clone = svgToFake(FX.svg);
  const r = extractMarkupAnnotations(clone, { ...FX.model, f2p });
  const built = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns, ftPerPt: 1 / unitsPerFt });
  const dictOf = (id) => annotationDict(built.annots.find((a) => a.family === "measure" && a.id === id), "9 0 R");
  const num = (s) => parseFloat(String(s).replace(/,/g, ""));

  it("RED-PROOF: area → Polygon /IT /PolygonDimension with a /Measure dictionary; length → /LineDimension; multi-leg → /PolyLineDimension", () => {
    expect(dictOf("meArea")).toMatch(/\/Subtype \/Polygon .*\/IT \/PolygonDimension \/Measure << \/Type \/Measure \/Subtype \/RL /);
    expect(dictOf("meLine")).toMatch(/\/Subtype \/Line .*\/IT \/LineDimension \/Measure << /);
    expect(dictOf("mePoly")).toMatch(/\/Subtype \/PolyLine .*\/IT \/PolyLineDimension \/Measure << /);
  });
  it("a viewer recomputing the AREA from /Vertices and /Measure gets Planyr's own number, in Planyr's unit", () => {
    const a = built.annots.find((x) => x.id === "meArea");
    const d = dictOf("meArea");
    const C = parseFloat(/\/X \[<< \/Type \/NumberFormat \/U \(ft\) \/C ([\d.e-]+)/.exec(d)[1]);
    const unit = /\/A \[<< \/Type \/NumberFormat \/U \(([^)]+)\) \/C ([\d.e-]+)/.exec(d);
    const v = a.vertices; let s2 = 0;
    for (let i = 0, n = v.length / 2, j = n - 1; i < n; j = i++) s2 += v[2 * j] * v[2 * i + 1] - v[2 * i] * v[2 * j + 1];
    const recomputed = (Math.abs(s2) / 2) * C * C * parseFloat(unit[2]);
    const head = r.descriptors.find((x) => x.id === "meArea").meta.chipTexts.find((t) => /(SF|AC)$/.test(t));
    expect(unit[1]).toBe(/AC$/.test(head) ? "ac" : "sq ft");
    expect(Math.abs(recomputed - num(head)) / num(head)).toBeLessThan(0.01);
  });
  it("a viewer recomputing the LENGTH gets Planyr's number too", () => {
    const a = built.annots.find((x) => x.id === "meLine");
    const C = parseFloat(/\/X \[<< \/Type \/NumberFormat \/U \(ft\) \/C ([\d.e-]+)/.exec(dictOf("meLine"))[1]);
    const len = Math.hypot(a.L[2] - a.L[0], a.L[3] - a.L[1]) * C;
    const head = r.descriptors.find((x) => x.id === "meLine").meta.chipTexts.find((t) => /′$/.test(t));
    expect(Math.abs(len - num(head)) / num(head)).toBeLessThan(0.01);
  });
  it("a count keeps its value in a Stamp's appearance (a Stamp is moved, never redrawn); no scale → no /Measure, never a wrong one", () => {
    expect(built.annots.find((x) => x.id === "meCount").subtype).toBe("Stamp");
    const noScale = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns });
    expect(annotationDict(noScale.annots.find((a) => a.id === "meArea"), "9 0 R")).not.toMatch(/\/Measure/);
  });
});
