#!/usr/bin/env node
/* extract-plan — turn a plan the owner ACTUALLY WORKS IN into a fixture the harness can open.
 *
 *   node scripts/extract-plan.mjs            # print the browser snippet
 *   node scripts/extract-plan.mjs --out FILE # write the snippet to a file (to hand to the owner)
 *
 * ⛔ WHY THIS EXISTS. Every performance number this repo has produced came from Goose Creek, because
 * Goose Creek is the only real plan anyone ever committed. The owner has reported TWO OTHER SITES as
 * slow — Bain and Sylvestri — and the harness could open neither, so the instrument has been
 * measuring the one site it CAN open while he reports on two it cannot. B1448 recorded that honestly
 * for Sylvestri and then measured Goose Creek anyway. The fix is not one more fixture; it is a PATH
 * from any plan he works in to a fixture the harness can drive, WITH its rasters.
 *
 * ⛔ AND IT NEVER TAKES HIS PICTURES. The one thing a plan carries that this repo must not hold is
 * ~20 MB of survey scans. So the snippet MEASURES every raster — dimensions, opacity, ftPerPx,
 * placement, stored byte length — and DISCARDS the bytes. The harness synthesises replacement
 * pixels to those exact parameters (ui-audit/lib/synthRaster.mjs), which is sound because decode
 * cost, texture size and blend cost are functions of the dimensions and the alpha, not of what the
 * drawing depicts.
 *
 * ── WHAT THE OWNER DOES (this is the whole of his part) ──────────────────────────────────────────
 *   1. Open planyr.io, signed in, on any plan.
 *   2. Open the browser console (F12 → Console) and paste the snippet.
 *   3. It downloads one `planyr-fixture-*.json` file per plan. Send those back.
 * Nothing is uploaded anywhere by the snippet; it only reads his own browser and saves a file.
 *
 * ── WHAT IS STRIPPED, and it is listed in the file itself under `_redacted` ──────────────────────
 *   • every raster's BYTES (replaced by a measured spec)
 *   • Supabase Storage keys and DWG source keys (they contain his user id)
 *   • cloud row ids / revisions
 *   • callout text (replaced with "Note N")
 *   • plan and site display names, unless `keepNames` is set
 * Geometry is deliberately NOT stripped: the coordinates are the thing being measured.
 */
import { writeFileSync } from "node:fs";

/* ---- The browser-side extractor -----------------------------------------------------------------
 * Written as a real function so it can be UNIT TESTED in node against a fake localStorage and
 * fake-indexeddb, rather than living as an untested template string. It closes over nothing and
 * touches only `localStorage`, `indexedDB`, `document` and `Blob`, so `.toString()` round-trips it
 * into a console-pasteable snippet with no build step.
 *
 * ⚠ IT DUPLICATES A LITTLE OF ui-audit/lib/planFixture.mjs's redaction ON PURPOSE. That module is
 * Node ESM and cannot be imported into a browser console; more importantly, the stripping has to
 * happen ON HIS MACHINE, before anything is written to a file. The unit test asserts the two agree
 * by round-tripping this function's output through `redactPlan` and checking nothing further is
 * stripped — so a drift between them fails the build instead of leaking bytes.
 */
export async function extractPlansInBrowser({ keepNames = false, download = true } = {}) {
  const PRIVATE = ["storageKey", "sourceDwgKey", "rev", "revision", "userId", "user_id", "uid", "ownerId"];
  const isDataUrl = (s) => typeof s === "string" && s.startsWith("data:");
  const out = [];

  /* Every store a plan can live in. A signed-in session keeps its plans under a per-user cloud
   * mirror key; a logged-out one uses the plain key. Both are read, so the snippet works whatever
   * state the browser is in, and it reports which key each plan came from. */
  const stores = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k === "planarfit:sites:v1" || (k && k.startsWith("planarfit:sites:cloud:"))) stores.push(k);
  }

  /* Raster byte lengths, measured from IndexedDB rather than guessed. The VALUES are read to take
   * their `.length` and are never copied anywhere. */
  const sizes = {};
  try {
    const db = await new Promise((res) => {
      const r = indexedDB.open("planyr", 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    });
    if (db) {
      const store = db.transaction("kv", "readonly").objectStore("kv");
      const keys = await new Promise((res) => { const q = store.getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); });
      for (const key of keys) {
        if (typeof key !== "string" || !key.startsWith("raster:")) continue;
        const v = await new Promise((res) => { const q = db.transaction("kv", "readonly").objectStore("kv").get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
        sizes[key] = typeof v === "string" ? v.length : null;
      }
      db.close();
    }
  } catch (e) { /* no IndexedDB → encodedBytes falls back to the inline src length, or null */ }

  const specOf = (raster, role, siteId) => {
    if (!raster) return null;
    const key = role === "underlay" ? `raster:${siteId}:underlay` : `raster:${siteId}:overlay:${raster.id}`;
    return {
      role, id: raster.id || role,
      imgW: raster.imgW || 0, imgH: raster.imgH || 0,
      opacity: typeof raster.opacity === "number" ? raster.opacity : 1,
      ftPerPx: raster.ftPerPx || 1,
      ftPerPxY: raster.ftPerPxY,
      x: raster.x || 0, y: raster.y || 0,
      rotation: raster.rotation || 0,
      locked: !!raster.locked, page: raster.page || undefined,
      visible: raster.visible !== false,
      encodedBytes: sizes[key] != null ? sizes[key] : (isDataUrl(raster.src) ? raster.src.length : null),
      fromIdb: !!raster.idbKey, fromMap: raster.fromMap === true,
    };
  };

  for (const storeKey of stores) {
    let sites;
    try { sites = JSON.parse(localStorage.getItem(storeKey) || "{}"); } catch (e) { continue; }
    for (const [id, plan] of Object.entries(sites)) {
      if (!plan || typeof plan !== "object") continue;
      const stripped = [];
      const note = (w) => { if (!stripped.includes(w)) stripped.push(w); };
      const scrub = (o) => {
        if (!o || typeof o !== "object") return o;
        const r = Array.isArray(o) ? [] : {};
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (PRIVATE.indexOf(k) >= 0) { if (v != null) note(k + " (identity / cloud row)"); continue; }
          if (k === "src" && isDataUrl(v)) { note("raster bytes (src data URLs → rasterSpec)"); continue; }
          if (k === "idbKey") continue;
          r[k] = v && typeof v === "object" ? scrub(v) : v;
        }
        return r;
      };
      /* ⚠ A raster becomes a SPEC and therefore never passes through `scrub`, so its private
       * fields would be dropped WITHOUT BEING REPORTED — the one place that matters most, because
       * a Storage key contains the user id. Walk them explicitly. */
      const noteRaster = (r) => {
        if (!r) return;
        for (const f of PRIVATE) if (r[f] != null) note(f + " (identity / cloud row)");
        if (isDataUrl(r.src)) note("raster bytes (src data URLs → rasterSpec)");
      };
      const rasters = [];
      if (plan.underlay) { noteRaster(plan.underlay); rasters.push(specOf(plan.underlay, "underlay", id)); }
      for (const o of plan.sheetOverlays || []) { noteRaster(o); rasters.push(specOf(o, "sheetOverlay", id)); }
      if (!keepNames && (plan.name || plan.site)) note("plan / site display names");

      out.push({
        /* ⛔ THE STORE KEY ITSELF CONTAINS THE USER ID (`planarfit:sites:cloud:<uid>`). Recording it
         * verbatim would leak the one identifier everything else here is careful to strip, through
         * a field that looks like harmless provenance. Masked. */
        _source: { store: storeKey.replace(/(planarfit:sites:cloud:).+$/, "$1<uid redacted>"), planId: id, extractedBy: "scripts/extract-plan.mjs" },
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
        callouts: (plan.callouts || []).map((c, i) => {
          if (keepNames || !c.text) return scrub(c);
          note("callout text (replaced with a placeholder)");
          const s = scrub(c); s.text = "Note " + (i + 1); return s;
        }),
        elevation: scrub(plan.elevation || null),
        settings: scrub(plan.settings || {}),
        layerOverrides: scrub(plan.layerOverrides || {}),
        layerAbove: scrub(plan.layerAbove || {}),
        rasters: rasters.filter(Boolean),
      });
    }
  }

  if (download && typeof document !== "undefined") {
    for (const f of out) {
      const blob = new Blob([JSON.stringify(f, null, 1)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `planyr-fixture-${f._source.planId}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  }
  return out;
}

/** The console-pasteable snippet, built from the function above so the two can never drift. */
export function snippet({ keepNames = false } = {}) {
  return `/* Planyr — export your plans as measurement fixtures.
   Paste this whole block into the browser console on planyr.io while signed in, then press Enter.
   It saves one small .json file per plan. Your drawings' PIXELS ARE NOT INCLUDED — only their size,
   opacity and placement. Nothing is uploaded; the files just download to your computer. */
(${extractPlansInBrowser.toString()})({ keepNames: ${!!keepNames} }).then((fs) => {
  console.log("Planyr: exported " + fs.length + " plan(s):");
  for (const f of fs) console.log("  · " + f._source.planId + " — " + (f.els || []).length + " elements, " + (f.rasters || []).length + " raster(s)");
}).catch((e) => console.error("Planyr export failed:", e));
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--out");
  const text = snippet({ keepNames: process.argv.includes("--keep-names") });
  if (i > -1 && process.argv[i + 1]) { writeFileSync(process.argv[i + 1], text); console.log(`wrote ${process.argv[i + 1]}`); }
  else console.log(text);
}
