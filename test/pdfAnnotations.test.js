// NEW-1 (2026-10-05) — "Flatten markups" OFF: markups become native, editable PDF annotations.
// These tests build the file through the real writer (imagePdf.jpegToPdf) from SVG trees shaped exactly
// like the exported clone's markup nodes, then read it back with a SECOND PDF library (pdf.js) —
// the round-trip the owner's Bluebeam/Acrobat will perform.
import { describe, it, expect } from "vitest";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import {
  buildAnnotations, flattenTree, parsePathD, parseTransform, parseColor, arcToBeziers, winAnsi, compose, annotationDict, cloudIntensity, cloudPitch,
} from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { cloudScallopPath } from "../src/workspaces/site-planner/lib/cloudGeometry.js";

const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };

import { VB, PAGE, PLAN, M0, frame, T, g, mk, cloudPts, descriptors } from "./fixtures/pdfAnnotationsFixture.js";
void VB; void PLAN;

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
    expect(c.BE).toEqual({ S: "C", I: 2 });
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
    expect(built.annots.find((a) => a.id === "M1").contents).toBe(`142' 6"`);   // a Line's caption: WinAnsi stand-ins (see regeneration block)
    expect(built.annots.find((a) => a.id === "M3").contents).toBe("310′");
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

// NEW-1 (2026-10-06, amends B2127664) — REGENERATION. A viewer that REBUILDS an annotation's appearance from its
// dictionary (Bluebeam / Acrobat when a recipient edits text or properties) must get the same look back. The /AP
// stream only covers the as-written page, so every key a regenerating viewer reads has to agree with it.
// Red-proof: each of these fails on the pre-amendment writer (FreeText /C = border colour; /CA 1 on translucent fills;
// cloud /I fixed at 1 or 2 by an unrelated hint; measurement label only in the AP).
describe("regeneration inputs agree with the appearance stream", () => {
  const dictOf = (id) => { const a = built.annots.find((x) => x.id === id); return { a, d: annotationDict(a, "9 0 R") }; };
  const arrOf = (d, key) => { const m = new RegExp(`/${key} \\[([^\\]]*)\\]`).exec(d); return m ? m[1].trim().split(/\s+/).map(Number) : null; };
  const rgb255 = (v) => v.map((x) => Math.round(x * 255));

  it("FreeText /C is the BOX FILL (absent for an unfilled box), never the border colour", () => {
    const k1 = dictOf("K1").d, k2 = dictOf("K2").d;
    expect(rgb255(arrOf(k1, "C"))).toEqual([255, 248, 225]);        // #fff8e1, the callout's fill
    expect(arrOf(k2, "C")).toBeNull();                               // K2's box has fill="none" → no /C at all
  });
  it("FreeText carries its border colour in /DA (RG) and its width in /BS, text colour in rg", () => {
    for (const id of ["K1", "K2"]) {
      const d = dictOf(id).d;
      expect(d).toMatch(/\/DA \(\/\w+ [\d.]+ Tf [\d. ]+ rg 0\.2 0\.255 0\.333 RG\)/);
      expect(d).toMatch(/\/BS << \/Type \/Border \/W [\d.]+ /);
    }
  });
  it("a FreeText never carries /IC (MuPDF would read it as the box background)", () => {
    expect(dictOf("K1").d).not.toMatch(/\/IC /);
  });
  it("filled shapes carry their FILL opacity as /CA, outside the appearance stream", () => {
    expect(dictOf("R1").a.ca).toBeCloseTo(0.25, 6);
    expect(dictOf("G1").a.ca).toBeCloseTo(0.2, 6);
    expect(dictOf("M2").a.ca).toBeCloseTo(0.15, 6);
    expect(dictOf("R1").d).toMatch(/\/CA 0\.25 /);
    // an opaque stroke-only shape is untouched
    expect(dictOf("P1").d).toMatch(/\/CA 1 /);
  });
  it("a cloud's /BE /I is derived from the scallop pitch the appearance really draws", () => {
    const c = dictOf("C1").a;
    // the pitch helper: 26 scallops round a 400 pt ring = ~15.4 pt
    const ring = [0, 0, 100, 0, 100, 100, 0, 100];
    expect(cloudPitch({ segs: Array.from({ length: 16 }, () => ["C"]) }, ring)).toBeCloseTo(50, 6);
    expect(c.BE.I).toBeGreaterThanOrEqual(0.5);
    expect(c.BE.I).toBeLessThanOrEqual(2);
    // ~15 pt scallops on the fixture → the spec ceiling (2); a tiny scallop asks for a small /I
    expect(c.BE.I).toBe(2);
    expect(cloudIntensity(3)).toBe(0.5);
    expect(cloudIntensity(6.2)).toBe(1);
    expect(cloudIntensity(40)).toBe(2);
    expect(cloudIntensity(0)).toBe(1);
  });
  it("a two-point measurement keeps its label as an on-line caption (/Cap, /Contents) so it survives a rebuild", () => {
    const { a, d } = dictOf("M1");
    expect(a.cap).toBe(true);
    expect(d).toMatch(/\/Cap true /);
    expect(d).toMatch(/\/CP \/Top /);
    expect(d).toContain(`/Contents (142' 6")`);          // WinAnsi stand-ins for ′ ″, the glyphs a regenerated caption can set
    // a typed note rides after the number instead of replacing it
    const noted = buildAnnotations([{ ...descriptors.find((x) => x.id === "M1"), meta: { chipTexts: ["142′ 6″"], comment: "check width" } }], { M0, frame }).annots[0];
    expect(noted.contents).toBe(`142' 6" — check width`);
  });
  it("only a Line can carry a caption", () => {
    for (const id of ["M2", "M3", "L1"]) expect(dictOf(id).d).not.toMatch(/\/Cap /);
  });
  it("every FreeText names a font its AcroForm /DR actually defines", () => {
    const m = /\/DA \(\/(\w+) /.exec(dictOf("K2").d);
    expect(["Helv", "HeBo", "HeOb", "HeBO"]).toContain(m[1]);
    expect(text).toContain(`/${m[1]} `);                    // present in the catalog's /DR font dictionary
    expect(/\/AcroForm [^\n]*\/DR << \/Font << ([^>]*)>>/.exec(text)[1]).toContain(`/${m[1]} `);
  });
});
