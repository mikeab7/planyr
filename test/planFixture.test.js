import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  redactPlan, fixtureCensus, armFixture, fixtureSite, fixtureSeed, rasterIdbPlan,
  rasterSpecOf, specDecodedBytes, specFootprintFt, paintedRasters, heldButUnpaintedRasters,
  overlayIdbKey, underlayIdbKey, RASTER_ARMS, PRIVATE_FIELDS,
} from "../ui-audit/lib/planFixture.mjs";
import { synthRasterPng, decodedBytes, megapixels, base64Len, hash32, rasterFill } from "../ui-audit/lib/synthRaster.mjs";
import { encodeRgbPng } from "../ui-audit/lib/fakeTile.mjs";

/* NEW-1 / NEW-2 — the plan→fixture pipeline that lets the harness open a site the owner ACTUALLY
 * works in, and the raster arms that decompose the Bain hypothesis.
 *
 * The properties under test here are the ones that fail SILENTLY, which is the only kind worth
 * unit-testing in a measurement harness:
 *   • redaction must not leak the owner's raster bytes or his Storage keys (a leak is invisible
 *     until it is committed);
 *   • the `quarter` arm must hold the ON-MAP FOOTPRINT constant while quartering the pixels — get
 *     that wrong and the arm isolates nothing, it just draws a smaller picture, and it would
 *     "prove" a size effect that is really a coverage effect;
 *   • the seeded record must take the app's `src: null` + `idbKey` path, because inlining the src
 *     measures a different program from the one the owner is running;
 *   • the underlay must be classified as HELD-BUT-NEVER-PAINTED whenever the plan has an origin —
 *     the product genuinely does not draw it under a live basemap, and expecting it would fault
 *     every run for a reason that is the app working correctly.
 */

const BAIN = JSON.parse(readFileSync(join(process.cwd(), "ui-audit/fixtures/bain-concept-original.json"), "utf8"));

const PLAN_WITH_SECRETS = {
  origin: { lat: 29.8, lon: -95.0 }, county: "harris", name: "Concept A", site: "Bain",
  els: [{ id: "e1", type: "building", cx: 0, cy: 0, w: 100, h: 50, rot: 0 }],
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
  callouts: [{ id: "c1", tip: { x: 1, y: 1 }, box: { x: 2, y: 2 }, text: "Call Bob at the county about the variance" }],
  measures: [], markups: [], parcelDrawings: [], settings: { snap: 5 },
  underlay: { imgW: 1800, imgH: 1167, opacity: 1, ftPerPx: 1.3, x: 0, y: 0, src: "data:image/png;base64,AAAA", idbKey: "raster:x:underlay", fromMap: true },
  sheetOverlays: [{
    id: "ov1", imgW: 1728, imgH: 2592, opacity: 0.55, ftPerPx: 2.7778, x: -10, y: -20, rotation: 0, locked: true, page: 1,
    src: "data:image/png;base64,BBBB", idbKey: "raster:x:overlay:ov1",
    storageKey: "b147d90d-b610-423d-af65-7e004f0ad72f/site-overlays/smr9olizi5ue/ov1.pdf",
    rev: 42,
  }],
};

describe("redactPlan", () => {
  const { fixture, stripped } = redactPlan(PLAN_WITH_SECRETS);

  it("carries no raster bytes anywhere in the emitted fixture", () => {
    expect(JSON.stringify(fixture)).not.toMatch(/data:image/);
    expect(fixture.rasters).toHaveLength(2);
    expect(fixture.rasters.every((r) => !("src" in r))).toBe(true);
  });

  it("removes every identity-bearing field, including the uid inside a Storage key", () => {
    const s = JSON.stringify(fixture);
    expect(s).not.toContain("b147d90d-b610-423d-af65-7e004f0ad72f");
    for (const f of PRIVATE_FIELDS) expect(s).not.toContain(`"${f}"`);
  });

  it("names what it stripped rather than removing it quietly", () => {
    expect(stripped.some((s) => /raster bytes/.test(s))).toBe(true);
    expect(stripped.some((s) => /storageKey/.test(s))).toBe(true);
    expect(stripped.some((s) => /callout text/.test(s))).toBe(true);
  });

  /* ⛔ THE STAND-IN IS SHAPE-PRESERVING, NOT "Note 1" — and the change is not cosmetic. A callout's
   * COST is its text: the lines it wraps to and the nodes that lands on the canvas. Collapsing the
   * owner's six-line note to "Note 1" destroys exactly the property the fixture exists to
   * reproduce, which would make NEW-3's annotations-present arm understate its own effect. See the
   * long note above `redactText`; the character-level properties are pinned in
   * test/realPlanFixtures.test.js. */
  it("replaces callout prose with a same-shape stand-in but keeps the callout's geometry", () => {
    const src = PLAN_WITH_SECRETS.callouts[0].text;
    expect(fixture.callouts[0].text).toBe("Nnnn Nnn nn nnn nnnnnn nnnnn nnn nnnnnnnn");
    expect(fixture.callouts[0].text).toHaveLength(src.length);
    expect(fixture.callouts[0].text).not.toContain("Bob");
    expect(fixture.callouts[0].tip).toEqual({ x: 1, y: 1 });
  });

  it("keeps geometry untouched — the coordinates are the thing being measured", () => {
    expect(fixture.els).toEqual(PLAN_WITH_SECRETS.els);
    expect(fixture.parcels[0].points).toEqual(PLAN_WITH_SECRETS.parcels[0].points);
  });

  it("is idempotent — re-redacting an already-redacted fixture changes nothing and finds no bytes left", () => {
    const again = redactPlan({ ...fixture, sheetOverlays: [], underlay: null });
    expect(again.stripped.filter((s) => /raster bytes|storageKey|rev /.test(s))).toHaveLength(0);
    expect(again.fixture.els).toEqual(fixture.els);
    expect(again.fixture.callouts[0].text).toBe(fixture.callouts[0].text);
  });

  it("preserves the measured raster parameters verbatim — they ARE the cost", () => {
    const ov = fixture.rasters.find((r) => r.role === "sheetOverlay");
    expect(ov).toMatchObject({ imgW: 1728, imgH: 2592, opacity: 0.55, ftPerPx: 2.7778, locked: true, page: 1, fromIdb: true });
  });
});

describe("rasterSpecOf / census arithmetic", () => {
  it("computes decoded texture bytes at 4 bytes per pixel", () => {
    expect(specDecodedBytes({ imgW: 1728, imgH: 2592 })).toBe(1728 * 2592 * 4);
    expect(decodedBytes(1800, 1167)).toBe(1800 * 1167 * 4);
  });

  it("reads encodedBytes off an inline data URL when it was not measured separately", () => {
    const s = rasterSpecOf({ imgW: 2, imgH: 2, src: "data:image/png;base64,ABCD" }, "underlay");
    expect(s.encodedBytes).toBe("data:image/png;base64,ABCD".length);
  });

  it("reports megapixels and semi-transparency, which is what the hypothesis turns on", () => {
    const c = fixtureCensus(BAIN);
    const ov = c.rasters.find((r) => r.role === "sheetOverlay");
    expect(ov.megapixels).toBeCloseTo(4.48, 2);
    expect(ov.semiTransparent).toBe(true);
    expect(c.rasters.find((r) => r.role === "underlay").semiTransparent).toBe(false);
    expect(megapixels(1800, 1167)).toBeCloseTo(2.1, 2);
  });
});

/* ⛔ THE BAIN CENSUS AND THE BLANK-CANVAS SCHEMA GUARDS MOVED TO `test/realPlanFixtures.test.js`,
 * and the generator they used to check moved to /dev/null.
 *
 * What stood here was a byte-identity check: the committed fixture against what
 * `ui-audit/build-bain-fixture.mjs` produced. It was green for the fixture's whole life — while
 * the fixture's coordinates were INVENTED. That is the shape of the check's limit: it proves a
 * file matches the thing that produced it, and says nothing about whether that thing was making
 * the plan up. docs/PERF-BAIN.md §6 named it as the bound on the report's largest claim.
 *
 * Both fixtures are now pulled from `public.sites` JOINED to `public.site_elements`, so there is
 * no generator to be identical to, and the guard is the OWNER'S OWN MEASURED CENSUS asserted
 * against the files. The road-schema and non-finite-number guards below moved with it and now run
 * over BOTH plans rather than one. */

describe("the arms each change exactly one thing", () => {
  const ov = (f) => f.rasters.find((r) => r.role === "sheetOverlay");

  it("`opaque` changes ONLY the alpha", () => {
    const a = armFixture(BAIN, "opaque");
    expect(ov(a).opacity).toBe(1);
    expect(ov(a).imgW).toBe(ov(BAIN).imgW);
    expect(specFootprintFt(ov(a))).toEqual(specFootprintFt(ov(BAIN)));
  });

  it("`no-overlay` hides the overlay and leaves the underlay alone", () => {
    const a = armFixture(BAIN, "no-overlay");
    expect(ov(a).visible).toBe(false);
    expect(a.rasters.find((r) => r.role === "underlay").visible).toBe(true);
  });

  it("`no-rasters` hides both", () => {
    expect(armFixture(BAIN, "no-rasters").rasters.every((r) => r.visible === false)).toBe(true);
  });

  it("`quarter` quarters the PIXELS while holding the ON-MAP FOOTPRINT — the whole point of it", () => {
    const a = armFixture(BAIN, "quarter");
    for (const role of ["underlay", "sheetOverlay"]) {
      const before = BAIN.rasters.find((r) => r.role === role);
      const after = a.rasters.find((r) => r.role === role);
      expect(after.imgW * after.imgH).toBeCloseTo((before.imgW * before.imgH) / 4, -3);
      const fb = specFootprintFt(before), fa = specFootprintFt(after);
      expect(fa.w).toBeCloseTo(fb.w, 6);                  // width: exact, by construction
      /* Height: exact when the pixel height is even, and within 0.1% when it is odd (Bain's
       * underlay is 1167 px tall and the overlay sizes both axes from ONE ftPerPx). Pinned, so the
       * residual can never quietly grow into a real coverage change and be read as a size effect. */
      expect(Math.abs(fa.h - fb.h) / fb.h).toBeLessThan(0.001);
      expect(after.opacity).toBe(before.opacity); // opacity must NOT move — that is the other arm
    }
  });

  /* ---- NEW-2 ---------------------------------------------------------------------------------
   * The same invariant as `quarter`, on the other axis: change the ROTATION and nothing else. This
   * arm was impossible before the real plan landed — the synthesised fixture had `rotation: 0`, so
   * an arm forcing it to 0 would have been the baseline wearing a different name, and would have
   * reported a guaranteed null.
   */
  it("`unrotated` changes ONLY the rotation — every other overlay term is held exactly", () => {
    const before = ov(BAIN), after = ov(armFixture(BAIN, "unrotated"));
    expect(before.rotation).toBe(1.5);   // the owner's measured value; if this moves, the arm is moot
    expect(after.rotation).toBe(0);
    for (const k of ["imgW", "imgH", "opacity", "ftPerPx", "x", "y", "visible", "page", "locked", "encodedBytes"]) {
      expect(after[k], `${k} must not move`).toEqual(before[k]);
    }
    expect(specFootprintFt(after)).toEqual(specFootprintFt(before));
    expect(specDecodedBytes(after)).toBe(specDecodedBytes(before));
  });

  it("`unrotated` leaves the underlay alone — it was never rotated, so touching it would confound", () => {
    const a = armFixture(BAIN, "unrotated");
    expect(a.rasters.find((r) => r.role === "underlay")).toEqual(BAIN.rasters.find((r) => r.role === "underlay"));
  });

  it("an unknown arm is a no-op rather than a silent partial change", () => {
    expect(armFixture(BAIN, "nonsense").rasters).toEqual(BAIN.rasters);
  });

  it("every named arm states what it changes", () => {
    for (const [, a] of Object.entries(RASTER_ARMS)) {
      expect(a.title.length).toBeGreaterThan(5);
      expect(a.changes.length).toBeGreaterThan(5);
    }
  });
});

describe("fixtureSite takes the app's real storage path", () => {
  const site = fixtureSite(BAIN, { id: "S1" });

  it("seeds `src: null` + an idbKey, never an inlined raster", () => {
    expect(site.sheetOverlays[0].src).toBeNull();
    expect(site.sheetOverlays[0].idbKey).toBe(overlayIdbKey("S1", "e1454614mmzcgq"));
    expect(site.underlay.src).toBeNull();
    expect(site.underlay.idbKey).toBe(underlayIdbKey("S1"));
  });

  it("keys match what the app itself would write for that site", () => {
    expect(rasterIdbPlan(BAIN, "S1").map((p) => p.key))
      .toEqual(["raster:S1:underlay", "raster:S1:overlay:e1454614mmzcgq"]);
  });

  it("has a fixed updatedAt so the seeded bytes are identical run to run", () => {
    expect(site.updatedAt).toBe(0);
    expect(fixtureSeed(BAIN, { id: "S1" })).toBe(fixtureSeed(BAIN, { id: "S1" }));
  });

  it("carries the plan's real settings and every collection through to the record", () => {
    expect(Object.keys(site.settings).length).toBeGreaterThan(20);
    expect(site.els).toHaveLength(47);
    expect(site.parcels).toHaveLength(5);
  });
});

describe("which rasters the app will actually PAINT", () => {
  it("does not expect the underlay on a plan with an origin — the live basemap replaces it", () => {
    const painted = paintedRasters(BAIN);
    expect(painted.map((r) => r.role)).toEqual(["sheetOverlay"]);
    expect(heldButUnpaintedRasters(BAIN).map((r) => r.role)).toEqual(["underlay"]);
  });

  it("does expect it when there is no origin, because then there is no basemap to replace it", () => {
    expect(paintedRasters({ ...BAIN, origin: null }).map((r) => r.role)).toEqual(["underlay", "sheetOverlay"]);
  });

  it("never expects a hidden raster", () => {
    expect(paintedRasters(armFixture(BAIN, "no-overlay"))).toHaveLength(0);
  });
});

describe("synthRaster produces real, distinct, size-targeted PNGs", () => {
  it("emits a structurally valid PNG with the requested dimensions in its IHDR", () => {
    const { png } = synthRasterPng(64, 48, { seed: 3 });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x08 + 2]);
    expect(png.readUInt32BE(16)).toBe(64);
    expect(png.readUInt32BE(20)).toBe(48);
    expect(png.subarray(12, 16).toString("latin1")).toBe("IHDR");
  });

  it("gives two rasters DISTINCT bytes, so Chromium cannot share one decoded bitmap", () => {
    const a = synthRasterPng(64, 64, { seed: 1 }).png;
    const b = synthRasterPng(64, 64, { seed: 2 }).png;
    expect(a.equals(b)).toBe(false);
  });

  it("is deterministic — same inputs, byte-identical output", () => {
    expect(synthRasterPng(32, 32, { seed: 9 }).png.equals(synthRasterPng(32, 32, { seed: 9 }).png)).toBe(true);
  });

  it("entropy is monotonic in q, which is what makes the size search well-behaved", () => {
    const size = (q) => encodeRgbPng(128, 128, rasterFill(5, q)).length;
    expect(size(0.9)).toBeGreaterThan(size(0.5));
    expect(size(0.5)).toBeGreaterThan(size(0.05));
  });

  it("hits a byte target within tolerance and reports the error rather than claiming a match", () => {
    const target = 40_000;
    const r = synthRasterPng(256, 256, { seed: 4, targetBytes: target, tolerance: 0.1 });
    expect(Math.abs(r.bytes - target) / target).toBeLessThan(0.15);
    expect(typeof r.errorPct).toBe("number");
    expect(r.iters).toBeGreaterThan(0);
  });

  it("hash32 is total and finite for any input", () => {
    for (const [a, b, c] of [[0, 0, 0], [-1, -1, -1], [1e6, 1e6, 7]]) {
      const h = hash32(a, b, c);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });

  it("base64Len matches what a real encode produces", () => {
    for (const n of [1, 2, 3, 4, 100, 1001]) {
      expect(base64Len(n)).toBe(Buffer.alloc(n).toString("base64").length);
    }
  });
});
