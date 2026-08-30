/* NEW-5 — viewport culling is a FRAME-TIME fix, and it must never touch the export.
 *
 * The measured problem: the feet-frame SVG holds ~4,600 elements and its cost scaled with
 * the whole model rather than with what is on screen — median frame 20 ms, p90 80 ms, p99
 * 140 ms during a drag, against a 16.7 ms budget.
 *
 * The hard constraint from the brief: culling is SCREEN-ONLY. `buildExportSvg` and the
 * PDF/aerial path must render the complete model regardless of the current viewport, so the
 * last describe below asserts exactly that — element count out of the export path is
 * independent of where the view happens to be pointing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  visibleWorldRect, elementBounds, boundsIntersect, cullToView, shouldCull,
  CULL_MARGIN, CULL_MIN_ELEMENTS,
} from "../src/workspaces/site-planner/lib/viewCull.js";
import { sheetLabelPpf, makeLabelFrame, MIN_LABEL_PPF, MAX_LABEL_PPF } from "../src/workspaces/site-planner/lib/exportLabelScale.js";
import { layoutLabels, buildingLabelLines, dimCalloutVisible, detailLabelVisible } from "../src/workspaces/site-planner/lib/labelLayout.js";

const view = { ppf: 0.35, offX: 60, offY: 60 };
const size = { w: 1600, h: 465 };

describe("visibleWorldRect", () => {
  it("covers the viewport plus the pop-in margin", () => {
    const bare = visibleWorldRect(view, size, 0);
    const grown = visibleWorldRect(view, size, CULL_MARGIN);
    expect(bare.maxX - bare.minX).toBeCloseTo(size.w / view.ppf, 6);
    expect(grown.minX).toBeLessThan(bare.minX);
    expect(grown.maxY).toBeGreaterThan(bare.maxY);
  });

  it("tracks the pan — the rect moves with the view, not with the model", () => {
    const a = visibleWorldRect(view, size);
    const b = visibleWorldRect({ ...view, offX: view.offX - 3500 }, size);
    expect(b.minX).toBeGreaterThan(a.minX);
  });
});

describe("elementBounds", () => {
  it("bounds a point list", () => {
    expect(elementBounds({ points: [{ x: 0, y: 0 }, { x: 10, y: -4 }, { x: -3, y: 8 }] }))
      .toEqual({ minX: -3, minY: -4, maxX: 10, maxY: 8 });
  });

  it("bounds a rotated box by its circumscribed radius, so any rotation is covered", () => {
    const b = elementBounds({ cx: 100, cy: 50, w: 60, h: 80, rot: 37 });
    const r = Math.hypot(60, 80) / 2;
    expect(b).toEqual({ minX: 100 - r, minY: 50 - r, maxX: 100 + r, maxY: 50 + r });
  });

  it("returns null for a shape it does not understand — and null is NEVER culled", () => {
    expect(elementBounds({ kind: "something-new" })).toBeNull();
    expect(elementBounds({ points: [{ x: 0, y: NaN }] })).toBeNull();
    expect(boundsIntersect(null, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(true);
  });
});

describe("cullToView", () => {
  const rect = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const inside = { id: "in", cx: 500, cy: 500, w: 10, h: 10 };
  const outside = { id: "out", cx: 90000, cy: 90000, w: 10, h: 10 };
  const straddling = { id: "edge", points: [{ x: -50, y: 500 }, { x: 50, y: 520 }] };

  it("keeps what the view can reach and drops what it can't", () => {
    const kept = cullToView([inside, outside, straddling], rect);
    expect(kept.map((e) => e.id)).toEqual(["in", "edge"]);
  });

  it("always keeps the selection and whatever is mid-drag, wherever it is", () => {
    const kept = cullToView([inside, outside], rect, { keep: new Set(["out"]) });
    expect(kept.map((e) => e.id)).toEqual(["in", "out"]);
  });

  it("is the IDENTITY when disabled — not a copy, so an export path allocates nothing", () => {
    const list = [inside, outside];
    expect(cullToView(list, rect, { enabled: false })).toBe(list);
    expect(cullToView(list, null)).toBe(list);
  });

  it("does not cull a small plan at all — the filter would cost more than it saves", () => {
    expect(shouldCull(CULL_MIN_ELEMENTS - 1)).toBe(false);
    expect(shouldCull(CULL_MIN_ELEMENTS)).toBe(true);
  });
});

describe("the export renders the COMPLETE model, whatever the view (hard constraint)", () => {
  // A plan spread far wider than any one viewport — the reference scenario's shape.
  const model = Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, cx: i * 400, cy: (i % 7) * 900, w: 120, h: 90 }));

  it("an export pass keeps every element, from three very different views", () => {
    const views = [
      { ppf: 0.35, offX: 60, offY: 60 },
      { ppf: 2.4, offX: -41000, offY: -2200 },
      { ppf: 0.04, offX: 900, offY: 400 },
    ];
    for (const v of views) {
      const exported = cullToView(model, visibleWorldRect(v, size), { enabled: shouldCull(model.length, { exporting: true }) });
      expect(exported.length).toBe(model.length);
    }
  });

  /* NEW-4(a) — THE LABEL PASS NOW ITERATES `drawEls` TOO, so this same guarantee has to cover it.
   * The geometry pass has been culled since this suite was written, but the label/declutter pass and
   * the dimension-collision loop still swept the FULL model — two passes meant to see the same set,
   * seeing different ones. Aligning them is only safe because on an export pass `cullRect` is null,
   * which makes `drawEls` IDENTICAL to `els` (not merely similar), so the sheet still lays out every
   * label. Asserted here as identity, and asserted at the source below, because "PDF parity holds by
   * construction" is exactly the kind of claim that stops being true without anyone noticing. */
  it("on an export pass the culled set IS the model — same objects, same order (the label pass rides on this)", () => {
    const exported = cullToView(model, null, { enabled: false });
    expect(exported).toBe(model);   // identity, not a copy: `drawEls === els` on the sheet
  });

  it("SOURCE: both label passes iterate the culled set, and the cull is inert on an export", () => {
    const SP = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    // the element-label candidate pass and the dimension-number collision pass
    expect(SP).toMatch(/const labelCands = \[\];[\s\S]{0,1400}?\n  for \(const el of drawEls\) \{/);
    expect(SP).toMatch(/const dimItems = \[\];[\s\S]{0,400}?\n  for \(const el of drawEls\) \{/);
    /* …and `drawEls` is the CULL of `els`, with the cull disabled when cullRect is null. The cull's
     * own arguments are pinned exactly as before; what changed (NEW-1) is that the View menu's
     * content-visibility filter now runs INSIDE the same memo, immediately before the cull.
     *
     * ⛔ THE TWO ARE DIFFERENT IN KIND, and the distinction is why this guard was widened rather
     * than relaxed. CULLING is an invisible optimisation the user never asked for, so it may never
     * change what an export contains — that is the hard constraint this block defends, and it is
     * untouched. HIDING is an explicit decision the user just made while looking at the drawing he
     * is about to print, and the PDF/PNG path CLONES the live `<svg>`, so hidden content is
     * legitimately absent from that sheet (the same deliberate exception `kmzExport.js`'s header
     * names). A model-built export — KMZ — decides its own contents and is unaffected either way. */
    expect(SP).toMatch(/const drawEls = useMemo\(\(\) => \{[\s\S]{0,400}?cullToView\(vis, cullRect, \{ enabled: !!cullRect, keep: cullKeep \}\)/);
    // the visibility filter is applied to the MODEL LIST going into the cull, never to `els` itself
    expect(SP).toMatch(/const vis = hiddenGroups \? els\.filter\(\(el\) => !elHidden\(hiddenGroups, el\)\) : els;/);
    // and the metrics pass (site-metrics-extraction, lib/siteMetrics.js) is still fed the MODEL —
    // the whole promise of "hide never deletes" — never `drawEls`/`vis` (the culled/hidden-filtered
    // subsets). The `els.forEach` itself moved into siteMetrics(); asserted below that it iterates
    // exactly what it is handed, never a subset of its own choosing.
    expect(SP).toMatch(/const metrics = useMemo\(\(\) => siteMetrics\(els, parcels, parcelOverlapPairs, settings\)/);
    const SM = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/siteMetrics.js", import.meta.url)), "utf8");
    expect(SM).toMatch(/const els = elements \|\| \[\];/);
    expect(SM).toMatch(/\n  els\.forEach\(\(e\) => \{[\s\S]{0,120}?const a = isCenterlineRoad\(e\)/);
    expect(SP).toMatch(/cullActive = !exportPass/);
  });

  it("…while the SCREEN pass at those same views draws strictly fewer", () => {
    const v = { ppf: 2.4, offX: -41000, offY: -2200 };
    const drawn = cullToView(model, visibleWorldRect(v, size), { enabled: shouldCull(model.length) });
    expect(drawn.length).toBeLessThan(model.length);
    expect(drawn.length).toBeGreaterThan(0); // and it still draws what's actually there
  });

  it("every element is visible from SOME view — culling hides nothing permanently", () => {
    const seen = new Set();
    for (const el of model) {
      const v = { ppf: 0.35, offX: size.w / 2 - el.cx * 0.35, offY: size.h / 2 - el.cy * 0.35 };
      cullToView(model, visibleWorldRect(v, size), { enabled: true }).forEach((e) => seen.add(e.id));
    }
    expect(seen.size).toBe(model.length);
  });
});

/* ── the LABEL half of the same constraint (NEW-1, closing the V481(f) gap) ────────────────
 *
 * The assertions above are about DRAWN GEOMETRY, and on the owner's live measurement they
 * were all TRUE: rects 1,251 / polygons 34 / images 6, identical from a corner zoom and from
 * a wide zoom. What was FALSE at the same moment was the TEXT — 151 label nodes from the
 * corner export against 118 from the wide one, with "Building 12" carrying no label at all
 * on the wide-zoom sheet. Geometry-only counting is exactly why this guard didn't catch it.
 *
 * So this block asserts the thing the old one couldn't: that the LABEL tier's decisions —
 * which labels survive, and how many lines each keeps — are a function of the sheet, not of
 * the view. It models the real pipeline from SitePlanner's label pass (the `ls` ramp → per
 * candidate `fs`/`lh`/`charW`/`halfW`/`halfH` → `layoutLabels`), because that pass lives
 * inside the component; the two pure ends of it (the label frame and the collision engine)
 * are the parts a regression would actually break.
 */
describe("the export renders the COMPLETE LABEL SET, whatever the view (V481(f))", () => {
  // Buildings packed tightly enough that a zoomed-OUT screen render genuinely has to start
  // dropping labels — the condition that produced the live defect.
  const plan = Array.from({ length: 12 }, (_, i) => ({
    id: `b${i + 1}`, name: `Building ${i + 1}`,
    cx: (i % 4) * 760, cy: Math.floor(i / 4) * 520, w: 620, h: 380,
  }));
  const extent = { wFt: 3 * 760 + 620, hFt: 2 * 520 + 380 };
  const SHEET = { planW: 764, planH: 470 }; // a letter-landscape plan box, in centi-inches

  // The views the owner actually exported from: deep into a corner, and the whole site.
  const views = [
    { ppf: 0.40, offX: -900, offY: -400 },   // corner zoom
    { ppf: 0.025, offX: 60, offY: 60 },      // wide zoom (scale bar 0–5,000 ft — the whole site on screen)
    { ppf: 1.60, offX: -8000, offY: -3000 }, // zoomed right in on one building
  ];

  // One label pass, mirroring SitePlanner's. `sheetPpf` null == the pre-NEW-1 behaviour
  // (the label tier reads the live view), a number == an export pass on that sheet.
  const labelPass = (view, sheetPpf) => {
    const lf = makeLabelFrame(view.ppf, sheetPpf);
    const ls = Math.max(0.34, Math.min(1, lf.ppf / 0.45));
    const fs = 11 * ls * lf.k, lh = 14.5 * ls * lf.k, charW = fs * 0.6;
    const f2p = (p) => ({ x: p.x * view.ppf + view.offX, y: p.y * view.ppf + view.offY });
    const items = plan.map((el) => {
      const c = f2p({ x: el.cx, y: el.cy });
      return {
        id: el.id, cx: c.x, cy: c.y,
        lines: buildingLabelLines({ name: el.name, sqft: `${el.w * el.h} SF`, dims: `${el.w}′ × ${el.h}′` }),
        lh, charW, halfW: (el.w / 2) * view.ppf, halfH: (el.h / 2) * view.ppf, importance: el.w * el.h,
      };
    });
    const placed = layoutLabels(items, { pad: 2 * lf.k, gap: 4 * lf.k });
    return {
      // What a diff of the exported SVG would see: which labels exist, and what they say.
      labels: plan.map((el) => (placed.has(el.id) ? placed.get(el.id).lines.join("|") : null)),
      names: plan.filter((el) => placed.has(el.id)).map((el) => el.id),
      dims: dimCalloutVisible(lf.ppf),
      detail: detailLabelVisible(24, lf.ppf),
    };
  };

  const sheetPpf = sheetLabelPpf({ extentWft: extent.wFt, extentHft: extent.hFt, ...SHEET });

  it("the sheet's own scale doesn't depend on the view at all", () => {
    expect(sheetPpf).toBeGreaterThan(0);
    // Same plan, same paper → same number, however the caller is zoomed. (There is no `view`
    // parameter to pass; that IS the guarantee, and this pins it against a future signature.)
    expect(sheetLabelPpf({ extentWft: extent.wFt, extentHft: extent.hFt, ...SHEET })).toBe(sheetPpf);
    expect(sheetLabelPpf({ extentWft: 0, extentHft: 0, ...SHEET })).toBeNull();
    // A pathological extent can't hand the label tier a nonsense zoom.
    expect(sheetLabelPpf({ extentWft: 1e9, extentHft: 1e9, ...SHEET })).toBe(MIN_LABEL_PPF);
    expect(sheetLabelPpf({ extentWft: 0.001, extentHft: 0.001, ...SHEET })).toBe(MAX_LABEL_PPF);
  });

  it("an export pass places EVERY building label — none is silently dropped", () => {
    for (const v of views) {
      const { names } = labelPass(v, sheetPpf);
      expect(names).toEqual(plan.map((e) => e.id));
    }
  });

  it("every label present at one view is present, WORD FOR WORD, at every other view", () => {
    const ref = labelPass(views[0], sheetPpf);
    for (const v of views.slice(1)) {
      const got = labelPass(v, sheetPpf);
      expect(got.labels).toEqual(ref.labels); // content, not just count — the LOD line-drop too
      expect(got.dims).toBe(ref.dims);        // …and the declutter gates the sheet inherited
      expect(got.detail).toBe(ref.detail);
    }
  });

  it("…and would have FAILED before the fix — the pre-NEW-1 pass read the live view", () => {
    // Same plan, same two exports, label tier on `view.ppf`: the wide-zoom pass loses labels
    // the corner pass kept. This is the live V481(f) reading (151 texts → 118, Building 12
    // gone) reproduced in the pure layer, so the guard is known to bite.
    const corner = labelPass(views[0], null), wide = labelPass(views[1], null);
    expect(wide.labels).not.toEqual(corner.labels);
    expect(wide.names.length).toBeLessThan(corner.names.length);
  });

  it("on screen the label frame is the identity — no screen render moves a pixel", () => {
    for (const v of views) {
      const lf = makeLabelFrame(v.ppf, null);
      expect(lf).toEqual({ ppf: v.ppf, k: 1, sheet: false, strokeZk: v.ppf / 0.35 });
    }
  });

  it("k converts a label px back into a canvas px, so the sheet's text is paper-sized", () => {
    const lf = makeLabelFrame(0.025, sheetPpf);
    expect(lf.ppf).toBe(sheetPpf);
    expect(lf.k).toBeCloseTo(0.025 / sheetPpf, 12);
    // A canvas px is `k` label px, so a font authored at the sheet's scale lands at the same
    // PHYSICAL size once the viewBox rescales the clone — which is why two exports of the
    // same plan match in text size as well as in text content.
    expect(makeLabelFrame(0.25, sheetPpf).k / makeLabelFrame(0.025, sheetPpf).k).toBeCloseTo(10, 9);
  });

  it("an export authors zoom-scaled LINE WORK at its base weight, so the sheet prints one weight", () => {
    // `restyleExportClone` retargets each stroke to a physical drafting weight, but it reads the
    // AUTHORED width — which carried the live zoom — through a CLAMPED map it cannot invert. So
    // the export pass authors at zk = 1 and the clamp lands identically from any zoom.
    for (const v of views) expect(makeLabelFrame(v.ppf, sheetPpf).strokeZk).toBe(1);
    // …and on screen the B617 zoom multiplier is untouched.
    expect(makeLabelFrame(0.7, null).strokeZk).toBeCloseTo(2, 12);
  });
});
