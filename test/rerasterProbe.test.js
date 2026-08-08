/* The PURE half of the B749 zoom re-raster probe, and the guard that keeps the harness honest.
 *
 * Two things are pinned here, and the second matters more than the first:
 *   1. the probe's arithmetic — threshold, cap, raster size, sweep replay;
 *   2. that the probe's ONE mirrored piece of app logic — the effect's retention rule — still
 *      matches what `SitePlanner.jsx` actually does. A probe that has drifted from the code it
 *      probes reports a confident number about a program nobody is running.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  rerasterFault, pdfDeliveryFault, rerasterPlan, rerasterCount, peakRasterBytes,
  measuredThresholdPpf, capPpf, magnificationAt, overlayBaseScale, rasterAtScale,
  RERASTER_KEEP_TOLERANCE, RERASTER_SETTLE_MS, MAX_RERASTER_DIM,
} from "../ui-audit/lib/rerasterProbe.mjs";
import { sheetPdfBytes, sheetContentStream, hash32 } from "../ui-audit/lib/sheetPdf.mjs";
import { RERASTER_ARMS, rerasterArmFixture, rerasterBudget, fixtureSite, fixtureStorageKey } from "../ui-audit/lib/planFixture.mjs";

const BAIN = { imgW: 1728, imgH: 2592, ftPerPx: 2.7777777777777777 };
const ROOT = new URL("..", import.meta.url).pathname;

describe("rerasterProbe — the threshold, MEASURED rather than restated", () => {
  it("finds the gate by bisecting the app's own decision function", () => {
    const t = measuredThresholdPpf(BAIN);
    // Just under it the app stays on the base raster; just over it, it does not.
    expect(magnificationAt(BAIN, t * 0.99)).toBeLessThan(1.5);
    expect(magnificationAt(BAIN, t * 1.01)).toBeGreaterThan(1.5);
    expect(t).toBeGreaterThan(0);
  });

  it("the owner's overlay crosses the gate at an ORDINARY working zoom", () => {
    // ~0.94 px/ft: a 1,000 ft building is under a thousand pixels wide. This is not an extreme
    // zoom, which is why the path is reachable in normal use rather than only in a stress test.
    expect(measuredThresholdPpf(BAIN)).toBeCloseTo(0.9375, 3);
  });

  it("reports the 8192px cap and what a raster there actually costs", () => {
    const r = rasterAtScale(BAIN, MAX_RERASTER_DIM / BAIN.imgH);
    expect(Math.max(r.w, r.h)).toBe(MAX_RERASTER_DIM);
    expect(r.decodedBytes).toBe(r.w * r.h * 4);
    expect(r.megapixels).toBeGreaterThan(40);
    expect(capPpf(BAIN)).toBeGreaterThan(measuredThresholdPpf(BAIN));
  });

  it("a page too small ever to need a hi-res reports no threshold rather than guessing one", () => {
    // ftPerPx tiny → `want` never outruns the base scale inside the bracket.
    expect(measuredThresholdPpf({ imgW: 612, imgH: 792, ftPerPx: 1e-6 }, { hi: 10 })).toBe(null);
  });
});

describe("rerasterProbe — replaying a sweep", () => {
  it("a sweep below the gate plans no rasters at all", () => {
    const ppfs = Array.from({ length: 10 }, (_, i) => 0.2 * Math.pow(1.12, i));
    expect(rerasterCount(rerasterPlan(BAIN, ppfs))).toBe(0);
  });

  it("a sweep across the gate plans at least one, and reports its size", () => {
    const ppfs = Array.from({ length: 8 }, (_, i) => 0.55 * Math.pow(1.12, i + 1));
    const ev = rerasterPlan(BAIN, ppfs);
    expect(rerasterCount(ev)).toBeGreaterThanOrEqual(1);
    expect(peakRasterBytes(ev)).toBeGreaterThan(100e6);
    for (const e of ev.filter((x) => x.kind === "raster")) {
      expect(Math.max(e.w, e.h)).toBeLessThanOrEqual(MAX_RERASTER_DIM);
    }
  });

  it("dropping back below the gate is recorded as a drop, not as a raster", () => {
    const ev = rerasterPlan(BAIN, [1.3, 0.3, 1.3]);
    expect(ev.filter((e) => e.kind === "drop").length).toBe(1);
  });

  it("models the app's CACHE — a rung already rendered is free the second time", () => {
    const outAndBack = [1.3, 0.3, 1.3, 0.3, 1.3];
    expect(rerasterCount(rerasterPlan(BAIN, outAndBack))).toBe(1);
    // `cache:false` replays the pre-fix app, which revoked on every zoom-out.
    expect(rerasterCount(rerasterPlan(BAIN, outAndBack, { cache: false }))).toBe(3);
  });
});

describe("rerasterFault — the guard that makes a null result mean something", () => {
  it("faults an arm that claims to cross the gate and produced nothing", () => {
    const f = rerasterFault({ expect: "above", observed: 0, predicted: 2, label: "bain/across" });
    expect(f).toMatch(/NEVER FIRED/);
    expect(f).toMatch(/bain\/across/);
  });
  it("passes an arm that crossed and fired", () => {
    expect(rerasterFault({ expect: "above", observed: 2, predicted: 2 })).toBe(null);
  });
  it("faults a CONTROL arm that fired when it should not have", () => {
    expect(rerasterFault({ expect: "below", observed: 1, predicted: 0 })).toMatch(/FIRED BELOW THE GATE/);
    expect(rerasterFault({ expect: "none", observed: 1, predicted: 0 })).toMatch(/unreachable/);
  });
  it("passes a control arm that stayed silent", () => {
    expect(rerasterFault({ expect: "below", observed: 0, predicted: 0 })).toBe(null);
    expect(rerasterFault({ expect: "none", observed: 0, predicted: 0 })).toBe(null);
  });
  it("pdfDeliveryFault names the two ways the bytes fail to arrive", () => {
    const f = pdfDeliveryFault({ served: 0, expect: true, label: "bain/across" });
    expect(f).toMatch(/NEVER REQUESTED/);
    expect(f).toMatch(/Supabase config/);
    expect(pdfDeliveryFault({ served: 1, expect: true })).toBe(null);
    expect(pdfDeliveryFault({ served: 0, expect: false })).toBe(null); // an arm that should not fetch
  });
});

describe("rerasterProbe — it has not drifted from SitePlanner.jsx", () => {
  /* ⛔ A SOURCE GUARD, because the retention rule and the settle debounce are the only two things
   * this probe MIRRORS rather than imports, and a mirror that silently drifts is worse than no
   * probe: it reports a confident count for a program nobody is running. */
  const src = readFileSync(join(ROOT, "src/workspaces/site-planner/SitePlanner.jsx"), "utf8");
  it("the settle debounce the probe dwells past is still the effect's", () => {
    expect(src).toMatch(new RegExp(`\\}, ${RERASTER_SETTLE_MS}\\); // debounce behind zoom settle`));
  });
  it("the retention tolerance constant is still meaningful", () => {
    expect(RERASTER_KEEP_TOLERANCE).toBeGreaterThan(0);
    expect(RERASTER_KEEP_TOLERANCE).toBeLessThan(1);
  });
  it("the PDF gate the arms depend on is still `overlayDocs` OR a `.pdf` storage key", () => {
    expect(src).toMatch(/overlayDocs\.current\.has\(o\.id\) \|\| \(o\.storageKey \|\| ""\)\.toLowerCase\(\)\.endsWith\("\.pdf"\)/);
  });
});

describe("sheetPdf — real bytes at the owner's real page size", () => {
  it("emits a structurally valid PDF with the requested MediaBox", () => {
    const b = sheetPdfBytes({ wPt: 1728, hPt: 2592, strokes: 50 });
    const s = b.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/MediaBox[0 0 1728 2592]");
    expect(s).toContain("/Type/Catalog");
    expect(s).toMatch(/startxref\n\d+/);
  });

  it("the xref offsets point at the objects they claim to", () => {
    const b = sheetPdfBytes({ wPt: 612, hPt: 792, strokes: 10 });
    const s = b.toString("latin1");
    const xrefAt = Number(s.slice(s.lastIndexOf("startxref")).match(/startxref\n(\d+)/)[1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const rows = s.slice(xrefAt).split("\n").slice(2).filter((r) => / 00000 n /.test(r));
    rows.forEach((row, i) => {
      const off = Number(row.slice(0, 10));
      expect(s.slice(off, off + 10)).toMatch(new RegExp(`^${i + 1} 0 obj`));
    });
  });

  it("is deterministic — the same sheet twice is the same bytes", () => {
    expect(sheetPdfBytes({ strokes: 200, seed: 7 }).equals(sheetPdfBytes({ strokes: 200, seed: 7 }))).toBe(true);
    expect(sheetPdfBytes({ strokes: 200, seed: 7 }).equals(sheetPdfBytes({ strokes: 200, seed: 8 }))).toBe(false);
  });

  it("carries the linework it was asked for, inside the page", () => {
    const stream = sheetContentStream(1728, 2592, 300);
    const segs = [...stream.matchAll(/^(\d+) (\d+) m /gm)];
    expect(segs.length).toBeGreaterThanOrEqual(300);
    for (const [, x, y] of segs) {
      expect(Number(x)).toBeGreaterThanOrEqual(0);
      expect(Number(x)).toBeLessThanOrEqual(1728);
      expect(Number(y)).toBeLessThanOrEqual(2592);
    }
    expect(hash32(1, 2)).toBe(hash32(1, 2));
  });

  it("multi-page is available but page 1 is the default, like the owner's overlay", () => {
    expect(sheetPdfBytes({ pages: 1 }).toString("latin1")).toContain("/Count 1");
    expect(sheetPdfBytes({ pages: 3 }).toString("latin1")).toContain("/Count 3");
  });
});

describe("the re-raster arms are a real experimental design", () => {
  const fixture = {
    origin: { lat: 29, lon: -95 },
    rasters: [
      { role: "underlay", id: "underlay", imgW: 1800, imgH: 1167, ftPerPx: 2.2, opacity: 1, rotation: 0, visible: true },
      { role: "sheetOverlay", id: "ov", imgW: 1728, imgH: 2592, ftPerPx: 2.7777777777777777, opacity: 0.55, rotation: 1.5, pdfBacked: true, visible: true },
    ],
  };
  const overlayOf = (f) => f.rasters.find((r) => r.role === "sheetOverlay");

  it("every arm declares what it expects, so a silent no-fire is a fault either way", () => {
    for (const [name, a] of Object.entries(RERASTER_ARMS)) {
      expect(["above", "below", "none"]).toContain(a.expect);
      expect(["below", "across", "outback"]).toContain(a.sweep);
      expect(a.title.length).toBeGreaterThan(10);
      expect(name).toBeTruthy();
    }
    // Every arm also carries a re-raster BUDGET, which is what `--assert` gates on.
    for (const a of Object.values(RERASTER_ARMS)) expect(Number.isInteger(a.budget)).toBe(true);
    expect(Object.values(RERASTER_ARMS).filter((a) => a.expect === "above").length).toBe(2);
  });

  it("`across-image` changes the PDF backing and NOTHING else — the load-bearing control", () => {
    const before = overlayOf(fixture);
    const after = overlayOf(rerasterArmFixture(fixture, "across-image"));
    expect(after.pdfBacked).toBeUndefined();
    for (const k of ["imgW", "imgH", "ftPerPx", "opacity", "rotation", "visible", "id"]) {
      expect(after[k]).toBe(before[k]);
    }
  });

  it("`across-hidden` hides the overlay and leaves the rest of the plan alone", () => {
    const armed = rerasterArmFixture(fixture, "across-hidden");
    expect(overlayOf(armed).visible).toBe(false);
    expect(armed.rasters.find((r) => r.role === "underlay").visible).toBe(true);
  });

  it("`below` / `across` / `outback` do not touch the fixture — they differ only in the gesture", () => {
    for (const a of ["below", "across", "outback"]) expect(rerasterArmFixture(fixture, a)).toBe(fixture);
  });

  it("the budgets are the fix's claim: one re-raster for a crossing, none for a control", () => {
    expect(rerasterBudget("across")).toBe(1);
    expect(rerasterBudget("outback")).toBe(1);  // in, out below the gate, and in again — still one
    expect(rerasterBudget("below")).toBe(0);
    expect(rerasterBudget("across-image")).toBe(0);
    expect(rerasterBudget("across-hidden")).toBe(0);
  });
});

describe("the seed makes B749 reachable ONLY when asked — the fact that hid this path", () => {
  const fixture = {
    schemaVersion: 13, origin: { lat: 29, lon: -95 },
    rasters: [{ role: "sheetOverlay", id: "ov", imgW: 1728, imgH: 2592, ftPerPx: 2.78, opacity: 0.55, rotation: 1.5, pdfBacked: true, visible: true }],
  };
  it("by default the seeded record has NO storageKey, so the app's PDF gate stays shut", () => {
    const rec = fixtureSite(fixture, { id: "S" });
    expect(rec.sheetOverlays[0].storageKey).toBeUndefined();
    expect(rec.sheetOverlays[0].idbKey).toBeTruthy(); // the RASTER's bytes, not the source PDF's
  });
  it("`pdfStorage` emits a `.pdf` key for a pdfBacked overlay, and only for one", () => {
    const rec = fixtureSite(fixture, { id: "S", pdfStorage: true });
    expect(rec.sheetOverlays[0].storageKey).toBe(fixtureStorageKey("S", "ov"));
    expect(rec.sheetOverlays[0].storageKey.endsWith(".pdf")).toBe(true);
    const plain = fixtureSite(
      { ...fixture, rasters: [{ ...fixture.rasters[0], pdfBacked: undefined }] },
      { id: "S", pdfStorage: true },
    );
    expect(plain.sheetOverlays[0].storageKey).toBeUndefined();
  });
});
