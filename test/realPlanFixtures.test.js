import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixtureCensus, redactText, redactPlan, paintedRasters, heldButUnpaintedRasters, PARCEL_RECORD_FIELDS } from "../ui-audit/lib/planFixture.mjs";

/* NEW-1 — THE OWNER'S TWO REAL PLANS, AND THE ACCEPTANCE VALUES HE MEASURED THEM AT.
 *
 * ⛔ WHY THIS FILE IS THE GUARD AND A `--check` REGENERATOR IS NOT.
 *
 * `bain-concept-a.json` was checked against its own generator, byte for byte, and that check was
 * green for the entire life of the fixture — while the fixture's coordinates were INVENTED. A
 * regeneration guard proves a file matches the thing that produced it; it cannot notice that the
 * thing that produced it was making the plan up. docs/PERF-BAIN.md §6 named that as the bound on
 * its largest claim, and it was right.
 *
 * These two fixtures come out of `public.sites` JOINED to `public.site_elements`, and the guard on
 * them is the OWNER'S OWN CENSUS, asserted below. The numbers are not targets and they were not
 * read off the files — they were measured from his signed-in browser and from the database, and
 * every one of them is reproduced here so a fixture that quietly stops being his plan goes red.
 *
 * ⚠ AND THE COUNTS ARE NOT REDUNDANT WITH THE FILES. A fixture is a static artefact; if someone
 * re-pulls one against a plan that has moved on, or hand-edits it, the file still loads and still
 * measures — it just stops being the plan the report describes. That is the failure this catches,
 * and it is the same class as the one that produced a program of null results on the wrong site.
 */

const read = (p) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
const BAIN = read("ui-audit/fixtures/bain-concept-original.json");
const SYLVESTRI = read("ui-audit/fixtures/sylvestri-concept-d-full.json");

/* ---- The acceptance census, verbatim ---------------------------------------------------------- */

describe("Bain — site smr9olizi5ue, \"Concept - Original\"", () => {
  const c = fixtureCensus(BAIN);

  it("has 47 elements and 5 parcels", () => {
    expect(c.elements).toBe(47);
    expect(c.parcels).toBe(5);
  });

  it("has the measured element mix", () => {
    expect(c.byType).toEqual({ building: 11, sidewalk: 10, parking: 10, road: 8, paving: 5, trailer: 2, pond: 1 });
  });

  it("has 8 centreline roads carrying 34 points between them", () => {
    expect(c.centerlineRoads).toBe(8);
    expect(BAIN.els.filter((e) => e.type === "road").reduce((n, e) => n + e.pts.length, 0)).toBe(34);
  });

  it("has 38 of its 47 elements rotated", () => {
    expect(BAIN.els.filter((e) => e.rot).length).toBe(38);
  });

  it("carries no annotations at all — 0 markups, 0 measures, 0 callouts, 0 cross-sections", () => {
    expect([c.markups, c.measures, c.callouts, c.crossSections]).toEqual([0, 0, 0, 0]);
  });

  it("carries the sheet overlay at its measured parameters, INCLUDING the 1.5° rotation", () => {
    const ov = BAIN.rasters.find((r) => r.role === "sheetOverlay");
    expect([ov.imgW, ov.imgH]).toEqual([1728, 2592]);
    expect(ov.opacity).toBe(0.55);
    expect(ov.ftPerPx).toBe(2.7777777777777777);
    expect(ov.page).toBe(1);
    expect(ov.locked).toBe(true);
    expect(ov.fromIdb).toBe(true);
    /* The whole reason NEW-2 exists: every arm ran this raster axis-aligned. */
    expect(ov.rotation).toBe(1.5);
    /* And the gate on B749's up-to-8192px zoom re-raster — docs/PERF-BAIN.md §10's open lead. */
    expect(ov.pdfBacked).toBe(true);
  });

  it("carries the aerial underlay at 1800 × 1167, fromMap, opacity 1", () => {
    const un = BAIN.rasters.find((r) => r.role === "underlay");
    expect([un.imgW, un.imgH]).toEqual([1800, 1167]);
    expect(un.opacity).toBe(1);
    expect(un.fromMap).toBe(true);
  });

  /* ⛔ CORRECTS docs/PERF-BAIN.md §8, which said the underlay's ~384 KB string is "read out of
   * IndexedDB". The real row carries a live ArcGIS `export` URL as its `src` and has NO `idbKey`.
   * `dropIdbBackedSrc` strips the src of anything idb-backed, so a raster that KEPT its src is
   * proof it never was. It is still never painted (§7 stands, and is asserted below). */
  it("has an underlay that is FETCHED, not read from IndexedDB", () => {
    expect(BAIN.rasters.find((r) => r.role === "underlay").fromIdb).toBe(false);
  });

  it("paints the overlay and never paints the underlay, because the plan has an origin", () => {
    expect(BAIN.origin).toBeTruthy();
    expect(paintedRasters(BAIN).map((r) => r.role)).toEqual(["sheetOverlay"]);
    expect(heldButUnpaintedRasters(BAIN).map((r) => r.role)).toEqual(["underlay"]);
  });
});

describe("Sylvestri — site sms4zs8unbkg, \"Concept D - Sylvestri Retail\"", () => {
  const c = fixtureCensus(SYLVESTRI);

  it("has 98 elements and 3 parcels", () => {
    expect(c.elements).toBe(98);
    expect(c.parcels).toBe(3);
  });

  it("has the measured element mix", () => {
    expect(c.byType).toEqual({ building: 31, parking: 23, sidewalk: 18, paving: 14, road: 7, trailer: 5 });
  });

  it("has 7 centreline roads carrying 33 points between them", () => {
    expect(c.centerlineRoads).toBe(7);
    expect(SYLVESTRI.els.filter((e) => e.type === "road").reduce((n, e) => n + e.pts.length, 0)).toBe(33);
  });

  it("has 73 of its 98 elements rotated", () => {
    expect(SYLVESTRI.els.filter((e) => e.rot).length).toBe(73);
  });

  /* THE REASON NEW-3 EXISTS. Every plan this program has measured — Bain and Goose Creek — was
   * 0/0/0/0 here. Sylvestri is the first one that is not. */
  it("carries 16 callouts, 6 markups (4 polygons + 2 easements) and 2 measures", () => {
    expect(c.callouts).toBe(16);
    expect(c.markups).toBe(6);
    expect(SYLVESTRI.markups.filter((m) => m.kind === "polygon")).toHaveLength(4);
    expect(SYLVESTRI.markups.filter((m) => m.kind === "easement")).toHaveLength(2);
    expect(c.measures).toBe(2);
  });

  /* THE CONTROL PROPERTY. With no raster overlay, nothing this plan shows can be charged to one. */
  it("has NO sheet overlay at all", () => {
    expect(SYLVESTRI.rasters.filter((r) => r.role === "sheetOverlay")).toHaveLength(0);
  });

  it("carries the aerial underlay at 1800 × 1656, fromMap", () => {
    const un = SYLVESTRI.rasters.find((r) => r.role === "underlay");
    expect([un.imgW, un.imgH]).toEqual([1800, 1656]);
    expect(un.fromMap).toBe(true);
  });

  /* ⚠ NOT INTERCHANGEABLE WITH `sylvestri-concept-d.json`. That file is a 22-element geometry bag
   * pulled 2026-07-31 for the dock-zone tests, and three of the ids it drives have since been
   * DELETED from the live plan. Overwriting one with the other would take those tests' hosts away
   * without failing anything at pull time. */
  it("is a different artefact from the 22-element dock-zone geometry bag", () => {
    const bag = read("ui-audit/fixtures/sylvestri-concept-d.json");
    expect(bag.els).toHaveLength(22);
    expect(bag.parcels).toBeUndefined();
    const live = new Set(SYLVESTRI.els.map((e) => e.id));
    for (const id of ["e1454698mwpaoj", "e1454699mwpaoj", "e1454796yyuqqs"]) {
      expect(bag.els.some((e) => e.id === id), `${id} is a dock-zone host`).toBe(true);
      expect(live.has(id), `${id} was deleted from the live plan`).toBe(false);
    }
  });
});

/* ---- The properties that fail silently -------------------------------------------------------- */

describe("neither fixture leaks the owner's data", () => {
  for (const [name, f] of [["bain", BAIN], ["sylvestri", SYLVESTRI]]) {
    it(`${name}: no identity field, Storage key, appraisal record or data URL survives`, () => {
      const json = JSON.stringify(f);
      /* A Storage key is `<uuid>/site-overlays/...` — the uuid IS the owner's user id. */
      expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(json).not.toContain("site-overlays/");
      expect(json).not.toContain("data:image");
      for (const k of ["storageKey", "userId", "user_id", "ownerId", "sourceDwgKey"]) {
        expect(json, `${k} must not appear`).not.toContain(`"${k}"`);
      }
      /* `rev` is a cloud-row field; `_redacted` may NAME it in prose, so match the JSON key. */
      expect(json).not.toMatch(/"rev"\s*:/);
      for (const p of f.parcels) for (const k of PARCEL_RECORD_FIELDS) expect(p[k]).toBeUndefined();
    });
  }

  it("sylvestri's callout text is shape-preserved and content-destroyed", () => {
    /* Every character is a class representative or whitespace — no word survives. */
    for (const c of SYLVESTRI.callouts) {
      expect(c.text, JSON.stringify(c.text)).toMatch(/^[Nn0.\s]*$/);
      expect(redactText(c.text)).toBe(c.text); // idempotent — re-redacting changes nothing
    }
    /* …and the shape that costs money is intact: the longest note still wraps to 6 lines. */
    const lines = SYLVESTRI.callouts.map((c) => c.text.split("\n").length);
    expect(Math.max(...lines)).toBe(6);
    expect(lines.filter((n) => n > 1)).toHaveLength(4);
  });
});

describe("redactText preserves the shape and destroys the content", () => {
  it("keeps line count, per-line length and every whitespace position", () => {
    const src = "JEFF LINDENBERGER - CAPITAL\n- $10-12M FOR TXDOT";
    const out = redactText(src);
    expect(out).toBe("NNNN NNNNNNNNNNNN . NNNNNNN\n. .00.00N NNN NNNNN");
    expect(out).toHaveLength(src.length);
    expect(out.split("\n").map((l) => l.length)).toEqual(src.split("\n").map((l) => l.length));
    /* Word-wrap breaks on spaces, so preserving space POSITIONS preserves where the lines break. */
    const spaces = (s) => [...s].map((ch, i) => (/\s/.test(ch) ? i : -1)).filter((i) => i >= 0);
    expect(spaces(out)).toEqual(spaces(src));
  });

  it("is idempotent, so a re-redaction cannot change a committed fixture", () => {
    const once = redactText("Call Bob at the county about the variance");
    expect(redactText(once)).toBe(once);
  });

  it("leaves empty and non-string values alone", () => {
    expect(redactText("")).toBe("");
    expect(redactText(null)).toBe(null);
    expect(redactText(undefined)).toBe(undefined);
  });
});

describe("redactPlan strips the county appraisal record", () => {
  it("drops attrs / acct / addr and NAMES them, rather than dropping them quietly", () => {
    const { fixture, stripped } = redactPlan({
      parcels: [{ id: "p1", points: [{ x: 0, y: 0 }], attrs: { OWNER_NAME: "A REAL PERSON", MAIL_ADDR: "1 Main St" }, acct: "1234", addr: "1 Main St" }],
      els: [], callouts: [], measures: [], markups: [],
    });
    expect(fixture.parcels[0].attrs).toBeUndefined();
    expect(fixture.parcels[0].acct).toBeUndefined();
    expect(fixture.parcels[0].addr).toBeUndefined();
    expect(fixture.parcels[0].points).toHaveLength(1); // geometry is never redacted
    expect(stripped.join(" ")).toContain("county appraisal record");
    expect(JSON.stringify(fixture)).not.toContain("A REAL PERSON");
  });
});

/* ---- The blank-canvas schema guards ------------------------------------------------------------
 * ⛔ A road authored without `rot`, or with a `vtx` radius carrying no `treatment`, resolves the
 * whole VIEW to NaN: the canvas renders ~117 nodes, ZERO elements, and `data-view-ppf` reads "NaN".
 * It does not throw. A fixture in that state measures as "this plan is fast".
 */
describe("neither fixture can silently blank the canvas", () => {
  for (const [name, f] of [["bain", BAIN], ["sylvestri", SYLVESTRI]]) {
    it(`${name}: every road carries the fields whose absence blanks it`, () => {
      for (const r of f.els.filter((e) => e.type === "road")) {
        expect(Number.isFinite(r.rot), `${r.id}.rot`).toBe(true);
        expect(Number.isFinite(r.cx) && Number.isFinite(r.cy), `${r.id} centre`).toBe(true);
        expect(r.pts.length).toBeGreaterThan(1);
        for (const v of r.vtx || []) if (v.radius != null) expect(v.treatment).toBe("arc");
      }
    });

    it(`${name}: contains no non-finite number anywhere`, () => {
      const walk = (o, path) => {
        if (o == null) return;
        if (typeof o === "number") { expect(Number.isFinite(o), `non-finite at ${path}`).toBe(true); return; }
        if (typeof o === "object") for (const k of Object.keys(o)) walk(o[k], `${path}.${k}`);
      };
      walk(f, name);
    });

    it(`${name}: every id is unique, and every attachedTo resolves`, () => {
      const ids = f.els.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      const set = new Set(ids);
      for (const e of f.els) if (e.attachedTo) expect(set.has(e.attachedTo), `${e.id} → ${e.attachedTo}`).toBe(true);
    });
  }
});
