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
    visible: raster.visible !== false,
    /* Byte length of the stored base64 string, if the extractor could measure it. `null` means
     * "not measured", and the synthesiser reports an untargeted size rather than inventing one. */
    encodedBytes: Number.isFinite(raster.encodedBytes) ? raster.encodedBytes
      : (isDataUrl(src) ? src.length : null),
    /* Whether the bytes lived in IndexedDB (the measured Bain path) rather than inline. */
    fromIdb: !!raster.idbKey || raster.fromIdb === true,
    fromMap: raster.fromMap === true,
  };
}

/** Decoded texture bytes a spec costs the renderer — 4 per pixel, whatever the file's colour type. */
export const specDecodedBytes = (s) => (s ? Math.max(0, s.imgW) * Math.max(0, s.imgH) * 4 : 0);

/** On-map footprint in plan feet. Two rasters with the SAME footprint and different pixel counts
 *  are what isolates SIZE from BLENDING, so this is the invariant the `quarter` arm holds. */
export const specFootprintFt = (s) => (s ? { w: s.imgW * s.ftPerPx, h: s.imgH * (s.ftPerPxY || s.ftPerPx) } : null);

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
      if (k === "src" && isDataUrl(v)) { strip("raster bytes (src data URLs → rasterSpec)"); continue; }
      if (k === "idbKey") { continue; } // re-derived from the fixture's own site id at load time
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

  const callouts = (plan.callouts || []).map((c, i) => {
    if (keepNames || !c.text) return scrub(c);
    strip("callout text (replaced with a placeholder)");
    return { ...scrub(c), text: `Note ${i + 1}` };
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
};

export function armFixture(fixture, arm) {
  const rasters = (fixture.rasters || []).map((r) => {
    if (arm === "opaque") return r.role === "sheetOverlay" ? { ...r, opacity: 1 } : r;
    if (arm === "no-overlay") return r.role === "sheetOverlay" ? { ...r, visible: false } : r;
    if (arm === "no-rasters") return { ...r, visible: false };
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

/** The site record the logged-out planner store persists, with rasters attached by `idbKey` only. */
export function fixtureSite(fixture, { id, name = "fixture", site = "fixture" } = {}) {
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
  const rec = fixtureSite(fixture, opts);
  return `(() => { try {
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [rec.id]: rec }))});
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(rec.id)});
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
