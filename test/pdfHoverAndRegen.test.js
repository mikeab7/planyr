/* NEW-1 / NEW-2 (2026-10-22) — the editable PDF on a plan SHAPED LIKE A REAL ONE (the same real export clone as
 * annotationExtractRealistic): what Chrome's viewer pops up on hover, and what Bluebeam does when it rebuilds a measurement.
 *
 * NEW-1. Chrome's and Edge's viewer (PDFium) builds its own yellow note box — 200 × 200 pt, titled by /T — on hover for any
 * Text / Line / Square / Circle / Polygon / PolyLine / Stamp / … annotation whose /Contents is non-empty, and ignores any
 * /Popup annotation the file carries. The export wrote /T (Planyr) and /Contents (the element's name) on every annotation, so
 * hovering a building opened a huge "Planyr / Building 1" box. Measured in a real Chrome by ui-audit/verify-pdf-hover-popup.mjs.
 * NEW-2. Bluebeam rebuilds a measurement from its dictionary on a move: it asked for a scale (no page /VP) and painted /IC as a
 * solid block (it does not read /CA as the fill's opacity there).
 * RED on the pre-fix writer (every element carried /Contents and /T (Planyr); no /VP; the translucent area carried /IC).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildAnnotations, annotationDict, measureDictFor } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import { svgToFake } from "./fixtures/svgToFake.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/realisticSiteClone.json", import.meta.url), "utf8"));
const [o, ux, uy] = FX.f2p;
const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
const M0 = [1, 0, 0, -1, 0, 5000], frame = [-1e6, -1e6, 1e6, 1e6];
const unitsPerFt = Math.hypot(ux.x - o.x, ux.y - o.y);
const ftPerPt = 1 / unitsPerFt;
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
const build = (opts = {}) => {
  const r = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
  return buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns, ftPerPt, ...opts });
};
const built = build();
const dict = (a) => annotationDict(a, "9 0 R");

describe("NEW-1 — no hover note box in Chrome's / Edge's viewer", () => {
  it("RED-PROOF: no site element, parcel label or measurement carries /Contents, and none carries /T (Planyr)", () => {
    const sites = built.annots.filter((a) => ["building", "element", "parcel-label", "measure"].includes(a.family));
    expect(sites.length).toBeGreaterThan(40);
    for (const a of sites) {
      const d = dict(a);
      expect(d, `${a.nm} /Contents`).not.toMatch(/\/Contents /);
      expect(d, `${a.nm} /T`).not.toMatch(/\/T \(Planyr\)/);
      expect(d, `${a.nm} /T`).not.toMatch(/\/T /);
    }
  });
  it("EVERY annotation keeps /Subj (what Bluebeam's Markups list names it by) and /NM", () => {
    for (const a of built.annots) { expect(dict(a), a.nm).toMatch(/\/Subj \(/); expect(dict(a), a.nm).toMatch(/\/NM \(/); }
    const subjects = new Set(built.annots.map((a) => a.subj));
    for (const s of ["Building", "Detention pond", "Road", "Truck court", "Car parking", "Sidewalk", "Trailer parking"]) expect(subjects.has(s), s).toBe(true);
  });
  it("the only /Contents left are text the person wrote or that IS the object: a callout's text, a typed markup comment", () => {
    for (const a of built.annots.filter((x) => annotationDict(x, "9 0 R").includes("/Contents "))) {
      expect(a.family === "callout" || (a.family === "markup" && a.contents), a.nm).toBeTruthy();
    }
    const cloud = built.annots.find((a) => a.nm === "planyr-markup-mkCloud");
    expect(dict(cloud)).toContain("/Contents (revise per RFI 12)");        // a reviewer's typed comment is data, not a label
    const callout = built.annots.find((a) => a.family === "callout");
    expect(dict(callout)).toMatch(/\/Contents \(Check dock count\)/);        // a FreeText is the text; PDFium raises no popup for it (measured)
  });
  it("a long element label cannot become a note: the label stays in /AP, never /Contents", () => {
    const pond = built.annots.find((a) => a.subj === "Detention pond");
    expect(dict(pond)).not.toMatch(/\/Contents /);
    expect(pond.ap.stream).toMatch(/Detention Pond\) Tj/);
  });
  it("the author is written as /T only when the model knows one", () => {
    const withAuthor = build({ author: "Michael" });
    expect(dict(withAuthor.annots[0])).toMatch(/\/T \(Michael\)/);
    expect(dict(built.annots[0])).not.toMatch(/\/T /);
  });
  it("the file carries no /Popup annotation and no /Open (PDFium ignores them; they would only invite a different viewer's box)", () => {
    const pdf = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 100, heightIn: 100, annotations: built.annots, viewport: built.viewport }));
    expect(pdf).not.toMatch(/\/Subtype \/Popup/);
    expect(pdf).not.toMatch(/\/Popup /);
    expect(pdf).not.toMatch(/\/Open true/);
    expect(pdf).not.toMatch(/\/T \(Planyr\)/);
  });
  it("a measurement keeps its person-typed note as /Contents; with no /Measure to compute from, the number rides as the caption", () => {
    const noted = build();
    const r = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
    const withNote = r.descriptors.map((d) => (d.id === "meLine" ? { ...d, meta: { ...d.meta, comment: "check width" } } : d));
    const a = buildAnnotations(withNote, { M0, frame, patterns: r.patterns, ftPerPt }).annots.find((x) => x.id === "meLine");
    expect(dict(a)).toContain("/Contents (check width)");
    expect(dict(a)).not.toMatch(/\/Cap /);
    const uncal = buildAnnotations(r.descriptors, { M0, frame, patterns: r.patterns }).annots.find((x) => x.id === "meLine");
    expect(dict(uncal)).toMatch(/\/Cap true/);
    expect(dict(uncal)).toMatch(/\/Contents \(300'\)/);
    void noted;
  });
});

describe("NEW-2 — a measurement Bluebeam rebuilds asks for no scale and never becomes a solid block", () => {
  const area = built.annots.find((a) => a.id === "meArea");
  it("RED-PROOF: the page carries ONE /VP over the plan window with the same /Measure the annotations carry", () => {
    expect(built.viewport).toBeTruthy();
    const pdf = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 100, heightIn: 100, annotations: built.annots, viewport: built.viewport }));
    const page = /3 0 obj\n(<< \/Type \/Page [^\n]*)/.exec(pdf)[1];
    const vp = /\/VP \[<< \/Type \/Viewport \/BBox \[([^\]]+)\] \/Name \(Plan\) \/Measure (<< \/Type \/Measure .*?>>) >>\]/.exec(page);
    expect(vp).toBeTruthy();
    expect(vp[1].split(/\s+/).map(Number)).toEqual(frame);
    expect(vp[2]).toMatch(/\/Subtype \/RL \/R \(1 in = \d+ ft\)/);
    // the annotation-level scale and the page-level scale agree on feet per point
    expect(vp[2]).toContain(`/X [<< /Type /NumberFormat /U (ft) /C ${/\/C ([\d.e-]+)/.exec(dict(area).match(/\/X \[(<<.*?>>)\]/)[1])[1]} `);
  });
  it("a page with no measurement, or no known scale, writes no /VP", () => {
    expect(build({ ftPerPt: null }).viewport).toBe(null);
    const pdf = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 10, pixelH: 10, widthIn: 100, heightIn: 100, annotations: built.annots.filter((a) => !a.measure), viewport: built.viewport }));
    expect(pdf).not.toMatch(/\/VP /);
  });
  it("RED-PROOF: a translucent area measurement names no stored fill (Bluebeam paints /IC solid) — its outline is /C at full strength", () => {
    expect(area.measure).toBeTruthy();
    const d = dict(area);
    expect(d).not.toMatch(/\/IC /);
    expect(d).toMatch(/\/CA 1 /);
    expect(d).toMatch(/\/C \[/);
    expect(built.degraded.some((m) => /translucent fill is in the appearance only/.test(m))).toBe(true);
  });
  it("…while the appearance still draws the translucent fill that shows until the viewer rebuilds", () => {
    expect(area.ap.gs.some((g) => g.ca < 0.95 && g.ca > 0)).toBe(true);
    expect(area.ap.stream).toMatch(/\n(f|B)\n/);
  });
  it("unmeasured filled shapes keep the REAL fill colour as /IC (never pre-blended): a building's /IC is its footprint's own fill", () => {
    const b = built.annots.find((a) => a.family === "building");
    expect(dict(b)).toMatch(/\/IC \[0\.953 0\.925 0\.882\]/);
    expect(b.ap.stream).toContain("0.953 0.925 0.882 rg");
    const pond = built.annots.find((a) => a.subj === "Detention pond");
    expect(dict(pond)).not.toMatch(/\/IC /);                                     // a pond's gradient is written as no stored fill, as before
  });
  it("an opaque measurement fill is untouched: only a translucent one leaves the dictionary", async () => {
    const { T, g, M0: m0, frame: fr } = await import("./fixtures/pdfAnnotationsFixture.js");
    const mk = (op) => ({ family: "measure", id: "Mx", kind: "area", meta: { chipTexts: ["1.20 ac"] },
      tree: g({ "data-feature": "measure:1", "data-measure": "Mx", "data-measure-mode": "area" },
        T("polygon", { points: "600,600 700,610 690,700 610,690", fill: "#0ea5e9", "fill-opacity": op, stroke: "#0ea5e9", "stroke-width": 1.2 })) });
    const opaque = buildAnnotations([mk(1)], { M0: m0, frame: fr, ftPerPt: 0.5 }).annots[0];
    expect(dict(opaque)).toMatch(/\/IC \[0\.055 0\.647 0\.914\]/);                // the real fill colour
    const faint = buildAnnotations([mk(0.15)], { M0: m0, frame: fr, ftPerPt: 0.5 }).annots[0];
    expect(dict(faint)).not.toMatch(/\/IC /);
    // no scale known → no /Measure → nothing regenerates it → its fill is stored as before
    const unscaled = buildAnnotations([mk(0.15)], { M0: m0, frame: fr }).annots[0];
    expect(dict(unscaled)).toMatch(/\/IC \[/); expect(dict(unscaled)).toMatch(/\/CA 0\.15 /);
  });
  it("measureDictFor still describes a page scale in feet and square feet", () => {
    const m = measureDictFor("area", [], 0.5);
    expect(m.A.U).toBe("sq ft");
    expect(m.X.C).toBe(0.5);
  });
});
