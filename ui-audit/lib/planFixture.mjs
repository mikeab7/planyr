/* planFixture — turn ANY real saved plan into something the harness can open, WITH its rasters.
 *
 * ⛔ THE MISS THIS FILE EXISTS TO CLOSE, stated plainly because it invalidates a program's worth of
 * null results. Every performance number this repo has ever produced came from Goose Creek or a
 * scene derived from it. The owner has reported two different sites as slow — Bain and Sylvestri —
 * and the harness could open NEITHER. B1448 recorded the reason honestly for Sylvestri ("only an
 * elements-only export, no parcels, no settings, no origin — it cannot be opened as a plan at
 * all") and then measured Goose Creek anyway. So the instrument has been measuring the one site it
 * CAN open while the owner reports on two it cannot, and calling the result a floor.
 *
 * The root cause is not that a particular fixture was missing. It is that there was NO PATH from a
 * plan the owner actually works in to a fixture the harness can drive. This file is that path.
 *
 * ── THE THREE THINGS A REAL PLAN CARRIES THAT A HAND-AUTHORED FIXTURE NEVER DOES ────────────────
 *  1. RASTERS. Bain composites a 1728 × 2592 sheet overlay at opacity 0.55 over a 1800 × 1167
 *     aerial underlay. Goose Creek has none. That is ~26 MB of decoded texture and a
 *     semi-transparent blend on every frame, and no instrument here has ever exercised it.
 *  2. The STORAGE PATH those rasters take: the app keeps them as base64 `data:` URL STRINGS in
 *     IndexedDB under `raster:<siteId>:overlay:<id>` / `raster:<siteId>:underlay`, and the record
 *     it persists has `src: null` plus an `idbKey`. A fixture that inlines the src measures a
 *     different program.
 *  3. The plan's REAL `settings` — 30-odd keys that decide which layers restore, whether the
 *     drainage pass runs, what the setback ring does. An empty settings object boots a different
 *     app.
 *
 * ── WHAT IS COMMITTED, AND WHAT IS NOT ──────────────────────────────────────────────────────────
 * A fixture file carries the plan's SHAPE and its raster PARAMETERS. It never carries raster
 * BYTES: a `rasterSpec` records `{ imgW, imgH, opacity, ftPerPx, encodedBytes }` and the harness
 * synthesises a real decodable PNG to those parameters at run time (lib/synthRaster.mjs). Two
 * reasons, and both are load-bearing — 20 MB of the owner's survey scans have no business in a git
 * repository, and the picture is not what the cost depends on. Dimensions and alpha are.
 *
 * ── REDACTION ───────────────────────────────────────────────────────────────────────────────────
 * `redactPlan` is what the owner (or a future session with a signed-in browser) runs against a real
 * plan. It strips, and NAMES what it stripped, every field that is his rather than the shape's:
 * raster bytes, Supabase Storage keys (they contain his user id), cloud row ids and revisions, the
 * per-site `data` block, and free text (callout bodies, plan/site names) unless explicitly kept.
 * Geometry is NOT redacted — the coordinates are the whole point, and a plan's outline is the
 * thing being measured.
 */

/** The fields a saved plan record carries. The canonical list, so a redactor cannot silently drop
 *  one and a loader cannot silently omit it. */
export const PLAN_FIELDS = [
  "schemaVersion", "origin", "county", "parcels", "parcelDrawings", "underlay", "sheetOverlays",
  "settings", "els", "markups", "measures", "callouts", "elevation", "layerOverrides", "layerAbove",
];

/** Fields that carry the owner's identity or his cloud row, never the plan's shape. */
export const PRIVATE_FIELDS = ["storageKey", "sourceDwgKey", "rev", "revision", "userId", "user_id", "uid", "ownerId"];

/* Parcel fields that carry the COUNTY APPRAISAL RECORD rather than the parcel's shape: third-party
 * landowner names, mailing addresses, valuations, legal descriptions. Measured on the owner's own
 * plans: 5.2 KB of `attrs` across Bain's 5 parcels, 3.1 KB across Sylvestri's 3, with keys like
 * `OWNER_NAME`, `MAIL_ADDR`, `LAND_VALUE`, `owner_name_1`. NOTHING in any render path reads them —
 * the outline, the acreage badge and the label all read `points` — so they are pure liability in a
 * git repository and are stripped by name. */
export const PARCEL_RECORD_FIELDS = ["attrs", "acct", "addr"];

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const isDataUrl = (s) => typeof s === "string" && s.startsWith("data:");

/* ---- Raster specs ----------------------------------------------------------------------------
 * A `rasterSpec` is everything about a raster that the RENDERER's cost depends on, and nothing
 * about what it depicts. `encodedBytes` is the measured length of the stored string, kept because
 * the IndexedDB read/base64-decode half of the cost is a function of it and of nothing else.
 */
export function rasterSpecOf(raster, role) {
  if (!raster) return null;
  const src = raster.src;
  return {
    role,                                   // "sheetOverlay" | "underlay"
    id: raster.id || role,
    imgW: num(raster.imgW), imgH: num(raster.imgH),
    opacity: Number.isFinite(raster.opacity) ? raster.opacity : 1,
    ftPerPx: num(raster.ftPerPx, 1),
    ftPerPxY: Number.isFinite(raster.ftPerPxY) ? raster.ftPerPxY : undefined,
    x: num(raster.x), y: num(raster.y),
    rotation: num(raster.rotation),
    locked: !!raster.locked,
    page: raster.page || undefined,
    pageCount: raster.pageCount || undefined,
    /* ⛔ CARRIED THROUGH BECAUSE IT GATES A COST PATH, not because it is descriptive metadata.
     * B749 re-rasters a PDF-backed overlay at up to 8192 px once magnification exceeds ~1.5× its
     * base raster, gated on `overlayDocs.has(id) || storageKey.endsWith(".pdf")`. A spec that drops
     * this makes a PDF-backed overlay indistinguishable from a bare image, and the arm measuring it
     * would silently be measuring the cheaper thing. */
    pdfBacked: raster.pdfBacked === true || /\.pdf$/i.test(String(raster.storageKey || raster.name || "")) || undefined,
    visible: raster.visible !== false,
    /* Byte length of the stored base64 string, if the extractor could measure it. `null` means
     * "not measured", and the synthesiser reports an untargeted size rather than inventing one. */
    encodedBytes: Number.isFinite(raster.encodedBytes) ? raster.encodedBytes
      : (isDataUrl(src) ? src.length : null),
    /* Whether the bytes lived in IndexedDB (the measured Bain path) rather than inline. */
    fromIdb: !!raster.idbKey || raster.fromIdb === true,
    /* ⛔ EMITTED ONLY WHEN TRUE, like `page` / `pageCount` / `pdfBacked` — because two fixtures of
     * THE SAME raster must compare equal, and a `false` here against an omitted key there is a
     * difference in bookkeeping masquerading as a difference in the picture. That matters
     * concretely: the Bain pair (`bain-concept-original` / `bain-quiddity`) shares one physical PDF
     * overlay, and the whole force of that pair is that the shared thing is IDENTICAL. `fromIdb` is
     * deliberately NOT normalised this way — `false` there is a load-bearing claim (the underlay is
     * fetched from ArcGIS, not read out of IndexedDB) and must stay visible. */
    fromMap: raster.fromMap === true || undefined,
  };
}

/** Decoded texture bytes a spec costs the renderer — 4 per pixel, whatever the file's colour type. */
export const specDecodedBytes = (s) => (s ? Math.max(0, s.imgW) * Math.max(0, s.imgH) * 4 : 0);

/** On-map footprint in plan feet. Two rasters with the SAME footprint and different pixel counts
 *  are what isolates SIZE from BLENDING, so this is the invariant the `quarter` arm holds. */
export const specFootprintFt = (s) => (s ? { w: s.imgW * s.ftPerPx, h: s.imgH * (s.ftPerPxY || s.ftPerPx) } : null);

/* ---- SHAPE-PRESERVING TEXT REDACTION ----------------------------------------------------------
 * ⛔ WHY REPLACING FREE TEXT WITH "Note 3" IS THE WRONG REDACTION FOR A PERF FIXTURE, and why the
 * right one is not "keep it".
 *
 * The owner's real Sylvestri plan carries 16 callouts and they are the most sensitive thing in
 * either plan — named third parties, who is and is not interested in a deal, and what the
 * interchanges would cost. None of that belongs in this repository, whatever it would buy.
 *
 * But a callout's COST is its text: how many lines it wraps to, how wide the box is, how many text
 * nodes land on the canvas. Collapsing six lines to "Note 3" deletes exactly the property the
 * fixture exists to reproduce — the plan would read as 16 cheap callouts when the owner has 16
 * expensive ones, and NEW-3's annotations-present arm would understate its own effect.
 *
 * So the redaction preserves the SHAPE and destroys the CONTENT:
 *   • line count and per-line length: EXACT
 *   • whitespace positions: VERBATIM — which makes every word-wrap break land where it really does
 *   • case and character class: preserved by representative (upper→N, lower→n, digit→0, punct→.)
 *
 * ⚠ WHAT IT DOES NOT PRESERVE, said plainly rather than implied: per-glyph advance width. The app
 * renders in a proportional font, where "WWW" is far wider than "iii", so a redacted line is the
 * right LENGTH but not, to the pixel, the right WIDTH. Line count, node count and box count — which
 * is what paint and layout scale with — are exact. Width is approximate, and any claim that rests
 * on the exact measured width of a callout box must say so.
 */
const CLASS_OF = (ch) => (
  /\s/.test(ch) ? ch
    : /[A-Z]/.test(ch) ? "N"
      : /[a-z]/.test(ch) ? "n"
        : /[0-9]/.test(ch) ? "0"
          : "."
);

/** Replace free text with a same-shape stand-in. Idempotent on already-redacted text. */
export function redactText(text) {
  if (typeof text !== "string" || !text) return text;
  return [...text].map(CLASS_OF).join("");
}

/* ---- Redaction --------------------------------------------------------------------------------
 * Returns { fixture, stripped } — never mutates its input, and never silently removes anything: a
 * caller that does not print `stripped` is the caller's problem, but the list is always produced.
 */
export function redactPlan(plan, { keepNames = false, note = "" } = {}) {
  const stripped = [];
  const strip = (what) => { if (!stripped.includes(what)) stripped.push(what); };

  const scrub = (obj) => {
    if (!obj || typeof obj !== "object") return obj;
    const out = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (PRIVATE_FIELDS.includes(k)) { if (v != null) strip(`${k} (identity / cloud row)`); continue; }
      if (PARCEL_RECORD_FIELDS.includes(k)) { if (v != null) strip(`${k} (county appraisal record — third-party owner names, mailing addresses, valuations)`); continue; }
      if (k === "src" && isDataUrl(v)) { strip("raster bytes (src data URLs → rasterSpec)"); continue; }
      if (k === "idbKey") { continue; } // re-derived from the fixture's own site id at load time
      /* User free text on a markup / easement, shape-redacted rather than dropped — see the long
       * note above `redactText` for why the SHAPE is the thing worth keeping. `inlineLabel` is
       * deliberately NOT in this list: those are public infrastructure names ("BAUER HOCKLEY",
       * "CenterPoint Overhead"), they render along the geometry, and their length is real cost. */
      if (!keepNames && ["notes", "holder", "recording", "labelOverride"].includes(k) && typeof v === "string" && v) {
        strip(`${k} (user free text — shape-preserving stand-in)`);
        out[k] = redactText(v);
        continue;
      }
      out[k] = v && typeof v === "object" ? scrub(v) : v;
    }
    return out;
  };

  /* ⚠ A RASTER IS CONVERTED TO A SPEC, NOT SCRUBBED — so its private fields never pass through
   * `scrub` and would be dropped WITHOUT BEING REPORTED. That is the "never silently remove
   * anything" rule broken in the one place it matters most (a Storage key carries the owner's user
   * id), and it is why every raster is walked for private fields explicitly here. */
  const noteRaster = (r) => {
    if (!r) return;
    for (const f of PRIVATE_FIELDS) if (r[f] != null) strip(`${f} (identity / cloud row)`);
    if (isDataUrl(r.src)) strip("raster bytes (src data URLs → rasterSpec)");
  };
  (plan.sheetOverlays || []).forEach(noteRaster);
  noteRaster(plan.underlay);

  const overlays = (plan.sheetOverlays || []).map((o) => rasterSpecOf(o, "sheetOverlay"));
  const underlay = plan.underlay ? rasterSpecOf(plan.underlay, "underlay") : null;

  const callouts = (plan.callouts || []).map((c) => {
    if (keepNames || !c.text) return scrub(c);
    strip("callout text (shape-preserving stand-in: exact line count, per-line length and whitespace positions; content destroyed)");
    return { ...scrub(c), text: redactText(c.text) };
  });

  const fixture = {
    _note: note || undefined,
    _redacted: stripped,
    schemaVersion: plan.schemaVersion,
    origin: plan.origin || null,
    county: plan.county || null,
    name: keepNames ? plan.name : undefined,
    site: keepNames ? plan.site : undefined,
    parcels: scrub(plan.parcels || []),
    parcelDrawings: scrub(plan.parcelDrawings || []),
    els: scrub(plan.els || []),
    markups: scrub(plan.markups || []),
    measures: scrub(plan.measures || []),
    callouts,
    elevation: scrub(plan.elevation || null),
    settings: scrub(plan.settings || {}),
    layerOverrides: scrub(plan.layerOverrides || {}),
    layerAbove: scrub(plan.layerAbove || {}),
    rasters: [...(underlay ? [underlay] : []), ...overlays].filter(Boolean),
  };
  if (!keepNames && (plan.name || plan.site)) strip("plan / site display names");
  return { fixture, stripped };
}

/* ---- Census -----------------------------------------------------------------------------------
 * Everything the report compares one plan against another on, COUNTED from the fixture rather than
 * asserted in prose. This is the NEW-3 table's data source, so the report cannot drift from the
 * file it describes.
 */
export function fixtureCensus(fixture) {
  const byType = {};
  let centerlineRoads = 0, polygonEls = 0, drawnVertices = 0, arcVertices = 0;
  for (const e of fixture.els || []) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    if (Array.isArray(e.pts)) { centerlineRoads++; drawnVertices += e.pts.length; }
    if (Array.isArray(e.points)) { polygonEls++; drawnVertices += e.points.length; }
    for (const v of e.vtx || []) if (v && Number.isFinite(v.radius)) arcVertices++;
  }
  const rasters = (fixture.rasters || []).map((r) => ({
    role: r.role, imgW: r.imgW, imgH: r.imgH,
    megapixels: +((r.imgW * r.imgH) / 1e6).toFixed(2),
    opacity: r.opacity,
    semiTransparent: r.opacity > 0 && r.opacity < 1,
    decodedBytes: specDecodedBytes(r),
    encodedBytes: r.encodedBytes,
    fromIdb: r.fromIdb,
    visible: r.visible,
  }));
  const shown = rasters.filter((r) => r.visible);
  return {
    elements: (fixture.els || []).length,
    parcels: (fixture.parcels || []).length,
    ponds: byType.pond || 0,
    byType, centerlineRoads, polygonEls, drawnVertices, arcVertices,
    parcelVertices: (fixture.parcels || []).reduce((n, p) => n + (p.points || []).length, 0),
    markups: (fixture.markups || []).length,
    measures: (fixture.measures || []).length,
    callouts: (fixture.callouts || []).length,
    parcelDrawings: (fixture.parcelDrawings || []).length,
    crossSections: ((fixture.elevation || {}).crossSections || []).length,
    layersOn: Object.values(fixture.layerOverrides || {}).filter(Boolean).length,
    rasters,
    rasterCount: shown.length,
    rasterMegapixels: +shown.reduce((s, r) => s + r.megapixels, 0).toFixed(2),
    decodedRasterBytes: shown.reduce((s, r) => s + r.decodedBytes, 0),
    encodedRasterBytes: shown.reduce((s, r) => s + (r.encodedBytes || 0), 0),
    semiTransparentRasters: shown.filter((r) => r.semiTransparent).length,
  };
}

/* ---- ARMS -------------------------------------------------------------------------------------
 * A hypothesis is only settled by a run with the suspect turned off, measured the same way and
 * interleaved with the baseline. These arms are the raster hypothesis decomposed so that each one
 * changes EXACTLY ONE THING.
 *
 * ⛔ `quarter` HOLDS THE ON-MAP FOOTPRINT CONSTANT, and that is the entire point of it. Halving
 * each axis quarters the pixel count; doubling `ftPerPx` puts the same rectangle on the map. Get
 * this wrong and the arm shrinks the picture as well as the texture, and then it isolates nothing —
 * it just draws less.
 */
export const RASTER_ARMS = {
  "bain": { title: "both rasters, exactly as he has them", changes: "nothing — the measured baseline" },
  "opaque": { title: "overlay forced to opacity 1.0", changes: "BLENDING only — same pixels, same footprint, no alpha" },
  "no-overlay": { title: "sheet overlay hidden, underlay kept", changes: "removes the 4.5 MP semi-transparent layer entirely" },
  "quarter": { title: "both rasters at a quarter of the pixel count", changes: "SIZE only — same footprint, same opacity, one quarter the texture" },
  "no-rasters": { title: "both rasters hidden", changes: "isolates Bain's GEOMETRY from Bain's rasters" },
  /* ---- NEW-2 -----------------------------------------------------------------------------------
   * ⛔ THE ARM THAT COULD NOT EXIST UNTIL THE REAL PLAN LANDED, and the reason it matters.
   *
   * The owner's sheet overlay is rotated **1.5°**. The synthesised fixture had `rotation: 0`, so
   * EVERY arm this harness has ever run — all six, both batteries, sixty runs — composited that
   * raster AXIS-ALIGNED. A rotated raster is a different job for the rasteriser: `renderSheetOverlay`
   * wraps the `<image>` in `rotate(θ cx cy)`, and an axis-aligned blit (a straight copy, one source
   * pixel to one destination pixel) is not available under a rotation — every destination pixel has
   * to be resampled from a neighbourhood.
   *
   * So this arm changes ONE thing: the overlay's rotation, 1.5° → 0. Pixel count, `ftPerPx`,
   * opacity, position and on-map footprint are all held EXACTLY, which is the same invariant
   * `quarter` holds for size and is unit-tested the same way.
   *
   * ⚠ WHAT THE ARM CANNOT HOLD, stated rather than glossed: rotating a rectangle enlarges its
   * axis-aligned BOUNDING BOX, so the rotated arm covers slightly more screen area. That is not a
   * confound to be corrected away — it is inherent to the change under test, and given finding 2
   * (the overlay's cost tracks the AREA IT COVERS) it is a candidate MECHANISM rather than noise.
   * A separating result must therefore be read as "rotation costs something", not yet as "resampling
   * costs something"; distinguishing the two needs a third arm and is not claimed here.
   */
  "unrotated": { title: "sheet overlay forced to rotation 0", changes: "ROTATION only — 1.5° → 0, same pixels, same ftPerPx, same opacity, same position" },
};

/* ---- ANNOTATION ARMS (NEW-3) ------------------------------------------------------------------
 * ⛔ THE AXIS EVERY PLAN THIS PROGRAM HAS MEASURED WAS ZERO ON.
 *
 * Bain: 0 markups, 0 measures, 0 callouts, 0 cross-sections. Goose Creek: 0 / 0 / 0 / 0. Both
 * batteries, every arm, every null result — taken on plans with NO ANNOTATIONS AT ALL. That is the
 * same structural blindness as the raster one (§0 of docs/PERF-BAIN.md): a plan with no callouts
 * cannot show a callout's cost, at any sample size, under any statistic.
 *
 * Sylvestri is the first plan here that is not zero: **16 callouts, 6 markups, 2 measures** — and
 * it is the plan the owner described as *"immediately loads super fast, and then literally three
 * seconds later it's lagging again."*
 *
 * ⛔ AND IT IS A CLEAN CONTROL, which is why it is worth more than a second Bain. Sylvestri has NO
 * SHEET OVERLAY AT ALL. Whatever it shows cannot be charged to a raster, cannot be confused with
 * blending, and cannot be explained by texture memory — the three hypotheses the Bain battery spent
 * sixty runs on. Its only raster is the `fromMap` underlay, which the app never paints on a plan
 * with an origin (see `paintedRasters`), so the arms below differ in annotations and in nothing else.
 *
 * The decomposition is per KIND, not one all-or-nothing pair, because the three are different work:
 * a callout is a text box that must be laid out and wrapped, a markup is a filled polygon, a
 * measure is two vertices and a label. Collapsing them would report "annotations cost X" and leave
 * the next question unanswerable.
 */
export const ANNOTATION_ARMS = {
  "sylvestri": { title: "the plan exactly as he has it", changes: "nothing — the measured baseline" },
  "no-callouts": { title: "the 16 callouts removed", changes: "CALLOUTS only — the text boxes that wrap, measure and collide" },
  "no-markups": { title: "the 6 markups removed", changes: "MARKUPS only — 4 filled polygons + 2 easement bands" },
  "no-measures": { title: "the 2 measurements removed", changes: "MEASURES only — the smallest arm, and expected to be null" },
  "no-annotations": { title: "callouts, markups and measures all removed", changes: "the whole annotation tier at once — the headline pair against the baseline" },
};

/* ---- THE BAIN PAIR (NEW-2) ---------------------------------------------------------------------
 * ⛔ THE STRONGEST EXPERIMENT IN THIS PROGRAM, AND IT IS THE OWNER'S, NOT THE HARNESS'S.
 *
 * He reported it himself: *"there's a Quiddity site plan on Bain, and then there's the original.
 * And the original seems to move a lot faster than the Quiddity one."* Two plans, same site, same
 * account, one fast and one slow.
 *
 * Measured from Supabase, `smr9olizi5ue` (fast) and `smshwnnijjfi` (slow) share:
 *   • the SAME sheet overlay — not an equivalent one, THE SAME ONE: same id `e1454614mmzcgq`, same
 *     `storageKey` (same PDF file), 1728 × 2592 @ 0.55, rotation 1.5°, same x/y, same ftPerPx;
 *   • the SAME `fromMap` aerial underlay, 1800 × 1167, byte for byte;
 *   • the SAME origin, the SAME county, and settings whose md5 matches.
 *
 * **A shared cause cannot explain a difference.** That single sentence does more work than the
 * sixty-run raster battery did: every one of those shared things is eliminated by IDENTITY, which
 * needs no noise floor, no sign test and no reps. It is not a stronger statistic — it is not a
 * statistic at all.
 *
 * WHAT ACTUALLY DIFFERS, and therefore what the arms below vary:
 *   • 52 elements vs 47 — five more out of about fifty, with SIX FEWER roads and THREE FEWER parcels
 *   • 3 pipeline EASEMENTS (18 / 28 / 4 points, widths 50 / 100 / 150, all `restrictsBuildings`) vs 0
 *   • 2 ponds carrying **68 vertices between them** vs 1 pond carrying **7**
 *
 * ⚠ THE ARMS ARE NOT SYMMETRIC AND THAT IS DELIBERATE. `original` is a WHOLE DIFFERENT PLAN — the
 * natural experiment, with no synthetic change anywhere. The other three are subtractions from the
 * SLOW plan, each removing exactly one candidate. A subtraction that lands on the fast plan's
 * timing tells you what the difference was made of.
 */
export const BAIN_PAIR_ARMS = {
  "quiddity": { title: "the SLOW plan, exactly as he has it", changes: "nothing — the baseline, and the half he reports as slow" },
  "original": { title: "the FAST plan, exactly as he has it", changes: "a different plan entirely — THE NATURAL EXPERIMENT, no synthetic change at all" },
  "no-easements": { title: "the slow plan minus its 3 pipeline easements", changes: "EASEMENTS only — 50 points of banded geometry removed, everything else held" },
  "one-pond": { title: "the slow plan minus its second pond", changes: "POND COUNT only — 2 ponds → 1, easements kept" },
  "unrestricting": { title: "easements drawn but not CONSTRAINING", changes: "restrictsBuildings + restrictsPaving forced false — separates DRAWING an easement from EVALUATING it" },
  "simple-ponds": { title: "two ponds still, but simple rings", changes: "RING COMPLEXITY only — pond COUNT held at 2, both rings decimated to the fast plan's vertex count, bounding boxes preserved EXACTLY" },
};

/** Ring vertex count to decimate toward when `original` carries no pond to read one off. */
const FALLBACK_RING_TARGET = 7;

/**
 * Decimate a closed ring to `target` vertices while preserving its BOUNDING BOX EXACTLY.
 *
 * ⛔ THE BOUNDING-BOX PROPERTY IS THE WHOLE REASON THIS IS NOT PLAIN INDEX SAMPLING. The arm it
 * serves has to vary vertex count and NOTHING ELSE — and a ring that shrinks has also changed its
 * painted area, its label-fit question and its overlap with every neighbouring element, which would
 * hand back three confounds in exchange for removing one. So the four extreme vertices (min-x,
 * max-x, min-y, max-y) are pinned first and the remainder is filled with evenly-spaced indices.
 * The result is a coarser polygon of the same extent, in the same place.
 *
 * Deterministic: same input, same output, every run. Returns the input unchanged when it is already
 * at or below `target`, or when `target` is under 4 (below which the extents cannot all be kept).
 */
export function decimateRing(points, target) {
  if (!Array.isArray(points) || target < 4 || points.length <= target) return points;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  points.forEach((p, i) => {
    if (p.x < points[minX].x) minX = i;
    if (p.x > points[maxX].x) maxX = i;
    if (p.y < points[minY].y) minY = i;
    if (p.y > points[maxY].y) maxY = i;
  });
  const idx = new Set([minX, maxX, minY, maxY]);
  for (let k = 0; k < target && idx.size < target; k++) {
    idx.add(Math.round((k * points.length) / target) % points.length);
  }
  for (let i = 0; i < points.length && idx.size < target; i++) idx.add(i);
  return [...idx].sort((a, b) => a - b).map((i) => points[i]);
}

/**
 * Apply a Bain-pair arm. `quiddity` is the slow plan, `original` the fast one.
 *
 * ⛔ `unrestricting` IS THE ARM THAT CAN DISCRIMINATE, and it is worth saying why before any number
 * exists. An easement is two things at once: a banded polygon that gets DRAWN, and a constraint
 * that gets EVALUATED against every building and paving element on the plan. `no-easements` removes
 * both at once and so cannot tell them apart. This arm removes only the second. If `unrestricting`
 * separates while `no-easements` does not, the cost is the constraint RELATION — which scales with
 * easements × elements, not with easements — and no amount of simplifying the drawn band would help.
 */
export function bainPairArmFixture(quiddity, original, arm) {
  if (arm === "original") return original;
  if (arm === "quiddity") return quiddity;
  if (arm === "no-easements") return { ...quiddity, markups: [] };
  if (arm === "one-pond") {
    /* Drop the LAST pond in z-order, so the arm is deterministic and the remaining pond is the same
     * one on every run. Everything else — including all three easements — is untouched. */
    const ponds = (quiddity.els || []).filter((e) => e.type === "pond");
    const drop = ponds.length > 1 ? ponds[ponds.length - 1].id : null;
    return drop ? { ...quiddity, els: quiddity.els.filter((e) => e.id !== drop) } : quiddity;
  }
  if (arm === "simple-ponds") {
    /* Hold pond COUNT at two and take the rings down to the fast plan's vertex count. `one-pond`
     * removed a pond AND 20 vertices in one move, so its −27% cannot say which of the two it
     * bought; this arm changes only the second. Neither outcome is a product instruction — see the
     * note on §5.5 in docs/PERF-REAL-PLANS.md. */
    const target = (original.els || [])
      .filter((e) => e.type === "pond" && Array.isArray(e.points))
      .reduce((m, p) => Math.min(m, p.points.length), FALLBACK_RING_TARGET);
    return {
      ...quiddity,
      els: (quiddity.els || []).map((e) => (
        e.type === "pond" && Array.isArray(e.points)
          ? { ...e, points: decimateRing(e.points, target) }
          : e
      )),
    };
  }
  if (arm === "unrestricting") {
    return {
      ...quiddity,
      markups: (quiddity.markups || []).map((m) => (
        m.kind === "easement" ? { ...m, restrictsBuildings: false, restrictsPaving: false } : m
      )),
    };
  }
  return quiddity;
}

/** Apply an annotation arm. Geometry, parcels, settings and rasters are untouched by every arm. */
export function annotationArmFixture(fixture, arm) {
  const drop = {
    "no-callouts": ["callouts"],
    "no-markups": ["markups"],
    "no-measures": ["measures"],
    "no-annotations": ["callouts", "markups", "measures"],
  }[arm];
  if (!drop) return fixture;
  const out = { ...fixture };
  for (const k of drop) out[k] = [];
  return out;
}

/* ---- ZOOM RE-RASTER ARMS (NEW-1) --------------------------------------------------------------
 * ⛔ THE AXIS EVERY BATTERY IN THIS PROGRAM HAS BEEN BLIND TO, and the blindness is structural
 * rather than accidental: `raster-arms.mjs` PANS, `annotation-arms.mjs` PANS, `session-axes.mjs`
 * PANS. B749's Tier-2 re-raster fires on ZOOM — it re-renders a PDF-backed overlay's page at up to
 * an 8192 px long edge once magnification passes ~1.5× the base raster — so no pan, at any length,
 * on any plan, can execute it. Sixty-plus runs and it has never once run.
 *
 * The four arms below change exactly one thing each, and the last one is the load-bearing control:
 *   below          the same stepped zoom, entirely UNDER the gate     ← the path must NOT fire
 *   across         the stepped zoom that CROSSES the gate             ← the path under test
 *   across-hidden  that same sweep, overlay hidden                    ← removes the overlay entirely
 *   across-image   that same sweep, overlay NOT PDF-backed            ← the arm that separates the
 *                                                                       PDF RE-RASTER from ordinary
 *                                                                       raster cost, holding pixel
 *                                                                       count, opacity, rotation and
 *                                                                       footprint EXACTLY
 *
 * `across-image` is what makes a separating result mean something. `across` versus `below` also
 * differs in how much of the plan is on screen (a deeper zoom culls more), so on its own it cannot
 * distinguish "the re-raster costs" from "this zoom range costs". `across-image` holds the zoom
 * range, the raster geometry and the blend identical and removes ONLY the PDF backing.
 */
export const RERASTER_ARMS = {
  "below": { title: "stepped zoom entirely below the magnification gate", changes: "nothing — the control; the re-raster must not fire", sweep: "below", expect: "below", budget: 0 },
  "across": { title: "stepped zoom crossing the magnification gate", changes: "the zoom range only — this is the path under test", sweep: "across", expect: "above", budget: 1 },
  "across-hidden": { title: "the crossing sweep with the sheet overlay hidden", changes: "removes the overlay entirely — no raster, no re-raster", sweep: "across", expect: "none", budget: 0 },
  "across-image": { title: "the crossing sweep with an equivalent NON-PDF raster", changes: "PDF BACKING only — same pixels, same opacity, same rotation, same footprint", sweep: "across", expect: "none", budget: 0 },
  /* ⛔ THE ARM THE GUARD IS BUILT ON. A zoom sweep is out AND BACK by definition, and the pre-fix
   * code revoked the hi-res the moment the view dropped below the gate — so a return trip paid the
   * whole 179 MB / 1.36 s raster again, and no single-direction sweep can see that. `budget: 1` is
   * the whole claim: eighteen notches in, out and back in cost ONE re-raster, not one per crossing. */
  "outback": { title: "in, back out below the gate, and in again", changes: "the gesture a real zoom actually is — it returns", sweep: "outback", expect: "above", budget: 1 },
};

/* The most re-rasters an arm may cost before `--assert` fails the run. A COUNT, deliberately, in
 * the idiom count-pond-invocations established: a millisecond budget passes the moment work that
 * should not happen at all merely gets cheaper. */
export const rerasterBudget = (arm) => (RERASTER_ARMS[arm] ? RERASTER_ARMS[arm].budget : 0);

/** Apply a re-raster arm to a fixture. Only the sheet overlay is ever touched. */
export function rerasterArmFixture(fixture, arm) {
  if (arm !== "across-hidden" && arm !== "across-image") return fixture;
  const rasters = (fixture.rasters || []).map((r) => {
    if (r.role !== "sheetOverlay") return r;
    if (arm === "across-hidden") return { ...r, visible: false };
    /* ⚠ `pdfBacked` IS THE ONLY FIELD REMOVED. Every property the compositor's cost depends on —
     * imgW, imgH, ftPerPx, opacity, rotation, position, visibility — is carried through untouched,
     * so this arm and `across` draw the SAME picture at the SAME zooms and differ only in whether
     * `SitePlanner.jsx` is willing to re-render the source page. */
    const { pdfBacked, ...rest } = r;
    return rest;
  });
  return { ...fixture, rasters };
}

export function armFixture(fixture, arm) {
  const rasters = (fixture.rasters || []).map((r) => {
    if (arm === "opaque") return r.role === "sheetOverlay" ? { ...r, opacity: 1 } : r;
    if (arm === "no-overlay") return r.role === "sheetOverlay" ? { ...r, visible: false } : r;
    if (arm === "no-rasters") return { ...r, visible: false };
    if (arm === "unrotated") return r.role === "sheetOverlay" ? { ...r, rotation: 0 } : r;
    if (arm === "quarter") {
      /* ⚠ THE FOOTPRINT IS PRESERVED ON THE WIDTH AXIS EXACTLY AND ON THE HEIGHT AXIS TO WITHIN
       * ROUNDING, and the asymmetry is the app's, not a shortcut. `renderSheetOverlay` sizes BOTH
       * axes from the single `ftPerPx` (only the underlay reads `ftPerPxY`), so an odd pixel height
       * — Bain's underlay is 1167 — cannot be halved into an integer and still land on exactly the
       * same rectangle. The residual is under 0.1% of the footprint, i.e. far below a pixel at any
       * working zoom, and the unit test pins it there rather than letting it drift. */
      const w = Math.max(1, Math.round(r.imgW / 2)), h = Math.max(1, Math.round(r.imgH / 2));
      return {
        ...r, imgW: w, imgH: h,
        ftPerPx: (r.imgW * r.ftPerPx) / w,
        ftPerPxY: r.ftPerPxY ? (r.imgH * r.ftPerPxY) / h : undefined,
        /* The string shrinks with the picture. Roughly quartered, like the pixel count — an
         * estimate, and the synthesiser reports what it actually achieved. */
        encodedBytes: r.encodedBytes ? Math.round(r.encodedBytes / 4) : null,
      };
    }
    return r;
  });
  return { ...fixture, rasters };
}

/* ---- Loading ----------------------------------------------------------------------------------
 * A fixture becomes two things: a site record for `planarfit:sites:v1`, and a set of IndexedDB
 * entries holding the raster strings. They are separate on purpose — that separation IS the
 * measured storage path, and collapsing it (inlining `src`) would quietly measure a different
 * program from the one the owner is running.
 */
export const overlayIdbKey = (siteId, overlayId) => `raster:${siteId}:overlay:${overlayId}`;
export const underlayIdbKey = (siteId) => `raster:${siteId}:underlay`;

export function rasterIdbKey(siteId, spec) {
  return spec.role === "underlay" ? underlayIdbKey(siteId) : overlayIdbKey(siteId, spec.id);
}

/** The Storage key a PDF-backed overlay is seeded with under `pdfStorage`. The shape mirrors
 *  `overlayStorage.overlayKey` (uid first, `.pdf` tail) because BOTH halves matter: the tail is what
 *  `SitePlanner.jsx` tests to decide the overlay is PDF-backed, and the shape is what the harness's
 *  route interception matches. No real uid appears — `fixture` stands in for one. */
export const fixtureStorageKey = (siteId, overlayId) => `fixture/site-overlays/${siteId}/${overlayId}.pdf`;

/**
 * The site record the logged-out planner store persists, with rasters attached by `idbKey` only.
 *
 * ⛔ `pdfStorage` — AND THE SEEDING FACT THAT MADE B749 UNREACHABLE IN EVERY ARM EVER RUN.
 *
 * `rasterSpecOf` carries `pdfBacked` through precisely because it gates a cost path, and the note
 * beside it says so. But this seeder never emitted anything a running app could read it from: the
 * record it builds has an `idbKey` (the RASTER's bytes) and no `storageKey` (the SOURCE PDF's), and
 * `SitePlanner.jsx`'s Tier-2 effect gates on `overlayDocs.has(id) || storageKey.endsWith(".pdf")`.
 * `overlayDocs` is populated only by dropping a file in-session, which no harness does. So the
 * fixture RECORDED that the overlay is PDF-backed and the seed DROPPED it, and the path was
 * unreachable by construction — a null nobody had measured, dressed as a measurement.
 *
 * It defaults to OFF, deliberately. The owner's real row DOES carry a storage key (it was redacted
 * out of the fixture because it embeds his user id), so every existing arm under-measures him by
 * exactly this path — but turning it on by default would silently perturb sixty-plus runs of
 * recorded history, including arms whose whole value is that they are comparable. Opt in, and say
 * in the report that you did.
 */
export function fixtureSite(fixture, { id, name = "fixture", site = "fixture", pdfStorage = false } = {}) {
  const specs = fixture.rasters || [];
  const under = specs.find((r) => r.role === "underlay");
  const overlays = specs.filter((r) => r.role === "sheetOverlay");
  const raster = (s) => ({
    id: s.id, x: s.x, y: s.y, imgW: s.imgW, imgH: s.imgH,
    ftPerPx: s.ftPerPx, ...(s.ftPerPxY ? { ftPerPxY: s.ftPerPxY } : {}),
    opacity: s.opacity, rotation: s.rotation, locked: s.locked,
    ...(s.page ? { page: s.page } : {}),
    ...(s.fromMap ? { fromMap: true } : {}),
    visible: s.visible,
    name: s.role === "underlay" ? "aerial" : `reference ${s.id}`,
    /* ⛔ `src: null` + `idbKey` IS THE MEASURED SHAPE. `dropIdbBackedSrc` (lib/storage.js) strips
     * the src from anything with an idbKey before persisting, so this is exactly what a real
     * signed-in plan holds on disk, and it is what makes the app take its IndexedDB read path. */
    src: null,
    idbKey: rasterIdbKey(id, s),
    ...(pdfStorage && s.role === "sheetOverlay" && s.pdfBacked ? { storageKey: fixtureStorageKey(id, s.id) } : {}),
  });
  return {
    id, groupId: id, site, name,
    schemaVersion: fixture.schemaVersion,
    origin: fixture.origin, county: fixture.county,
    parcels: fixture.parcels || [],
    parcelDrawings: fixture.parcelDrawings || [],
    els: fixture.els || [],
    markups: fixture.markups || [],
    measures: fixture.measures || [],
    callouts: fixture.callouts || [],
    elevation: fixture.elevation || undefined,
    settings: fixture.settings || {},
    layerOverrides: fixture.layerOverrides || {},
    layerAbove: fixture.layerAbove || {},
    underlay: under ? raster(under) : null,
    sheetOverlays: overlays.map(raster),
    deletedIds: [],
    updatedAt: 0, // fixed, so the seeded bytes are byte-identical run to run
    data: { status: "active" },
  };
}

/** The localStorage seed script, injected before navigation. */
export function fixtureSeed(fixture, opts) {
  return fixtureSeedMulti([{ fixture, ...opts }]);
}

/**
 * The same seed with SEVERAL real plans in the store at once.
 *
 * ⛔ WHY THIS IS NOT A CONVENIENCE. The plan-switch question — "load A, load B, come back to A, was
 * A ever released?" — needs two plans with DIFFERENT group ids, because the app switches by route
 * (`#/project/<groupId>/site`). Until now the only two-plan seed in the repo was
 * `perfScenarioSeedMulti`, whose plan B is plan A truncated by half; so every plan-switch reading
 * this program has ever taken was a switch between one synthetic plan and a subset of itself. The
 * owner switches between whole, unrelated, RASTER-BEARING plans, and those release different things.
 *
 * The first entry is the one the app opens on, unless `currentId` names another.
 */
export function fixtureSeedMulti(entries = [], currentId = null) {
  const recs = entries.map(({ fixture, ...opts }) => fixtureSite(fixture, opts));
  if (!recs.length) throw new Error("fixtureSeedMulti needs at least one plan");
  const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
  const current = currentId && byId[currentId] ? currentId : recs[0].id;
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(byId))});
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(current)});
  } catch (e) {} })();`;
}

/* ---- WHICH RASTERS ACTUALLY REACH THE SCREEN --------------------------------------------------
 * ⛔ A PRODUCT FACT THAT CHANGES THE WHOLE BAIN PICTURE, and it was found by this harness refusing
 * to accept an arm it could not prove.
 *
 * The planner renders the aerial UNDERLAY only when `showAerial && underlay && !(origin &&
 * basemapOn)` (SitePlanner.jsx), and `basemapSrc` initialises to `"esri"` whenever the plan has an
 * origin, with no persisted preference that could turn it off. So on ANY saved plan with an origin —
 * which is every real plan — **the underlay is never painted at all.** The app even says so in the
 * References panel: *"Hidden while the live map basemap is on — the basemap IS the aerial there."*
 *
 * That does NOT make the underlay free. Its ~8 MB base64 string is still read out of IndexedDB and
 * still sits in React state for the life of the session; what it does not do is allocate a texture
 * or cost a blend per frame. Distinguishing "held in memory" from "composited every frame" is
 * exactly what the raster hypothesis needs, and asserting the wrong one is how an arm silently
 * measures the wrong thing.
 */
export function paintedRasters(fixture, { hasOrigin = null } = {}) {
  const origin = hasOrigin == null ? !!fixture.origin : hasOrigin;
  return (fixture.rasters || []).filter((r) => r.visible !== false && (r.role !== "underlay" || !origin));
}

/** Rasters whose bytes are loaded and held but which the app will never paint. */
export function heldButUnpaintedRasters(fixture, opts) {
  const painted = new Set(paintedRasters(fixture, opts));
  return (fixture.rasters || []).filter((r) => r.visible !== false && !painted.has(r));
}

/** Which IndexedDB entries the fixture needs, paired with the spec each one's bytes must match.
 *  A HIDDEN raster still gets its entry — hiding a reference does not delete its bytes, and an arm
 *  that also removed them from storage would be measuring two changes at once. */
export function rasterIdbPlan(fixture, siteId) {
  return (fixture.rasters || []).map((s) => ({ key: rasterIdbKey(siteId, s), spec: s }));
}

/* Write one raster into the page's own IndexedDB, through the same database and object store the
 * app itself opens (`planyr` / `kv`, lib/localDb.js). Passed to `page.evaluate` as a REAL FUNCTION,
 * never as a source string.
 *
 * ⛔ THAT DISTINCTION COST AN HOUR AND IT FAILS SILENTLY, so it is written down. Playwright
 * evaluates a STRING as an EXPRESSION and does not call it with the argument — unlike Puppeteer. A
 * string wrapper here therefore evaluated to a function object, returned `undefined`, wrote
 * nothing, and reported no error whatsoever. The rasters were simply absent from every arm, and the
 * only reason it was caught is that `decodeFault` refuses to let an arm through without proving its
 * rasters decoded. A closure-free named function is passed by reference and is serialised properly.
 *
 * One entry per call on purpose: these are ~10 MB each, and batching them into one `addInitScript`
 * blob would push the whole payload through every navigation.
 */
export async function idbPutInPage({ key, value }) {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open("planyr", 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
  });
  db.close();
  return true;
}
