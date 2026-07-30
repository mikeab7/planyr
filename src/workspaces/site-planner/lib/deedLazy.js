/* The ONE entry point to the DEED WORKFLOW's code — the metes-and-bounds parser and the
 * deed→parcel alignment solver.
 *
 * Same shape, and the same reason, as `terrainLazy.js` (B1095) and the deed FILE reader
 * (`shared/files/docxText.js`, deferred by B1141): a cached dynamic `import()` plus a SYNCHRONOUS
 * accessor for the one caller that reads it during render.
 *
 * WHY: reading a deed only ever happens once the user is already in that workflow — dropping a
 * .docx or opening the title reader — and that workflow already loads its file reader on demand.
 * The planner's site route has essentially no bundle headroom, so ~8 KB of minified deed regexes
 * and alignment math have no business riding the boot path. **Nothing on the boot path may
 * static-import `deedParse.js` or `deedAlign.js`.** (The polyline offset/buffer primitives stayed
 * in `metesAndBounds.js` precisely because roads, easements and the KMZ export DO need them
 * synchronously.)
 *
 *   await loadDeed()  → the merged module (cached; concurrent calls share one import)
 *   deedNow()         → the merged module, or null if it hasn't loaded yet
 *
 * `deedNow()` returning null is a real state, not a failure: the title reader's live preview
 * renders its counts as zero for the one frame between opening and the module landing, then
 * re-renders. Callers must handle null rather than assume it.
 */
let mod = null;
let inflight = null;

export function loadDeed() {
  if (mod) return Promise.resolve(mod);
  if (!inflight) {
    inflight = Promise.all([import("./deedParse.js"), import("./deedAlign.js")])
      .then(([parse, align]) => { mod = { ...parse, ...align }; inflight = null; return mod; });
  }
  return inflight;
}

/** The module if it is already loaded, else null. Never triggers a load — call loadDeed(). */
export const deedNow = () => mod;

/** Test seam: drop the cache so a suite can assert the not-yet-loaded branch. */
export const _resetDeed = () => { mod = null; inflight = null; };
