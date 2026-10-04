/* NEW-1 (parcel-outline ARRIVAL cost) — absorb a /query response over several frames instead of one task.
 *
 * #1956 made SETTLING over lots already held free. What it left was the moment NEW lots land: esri-leaflet hands
 * the whole response (≈1,200 lots per z14 tile query, six queries per view) to `createLayers` in one rAF
 * callback, which projected every ring (`prepareParcel`), indexed every lot and marked the tiles dirty — measured
 * on Michael's Chrome (Bartow GA, build f853752) as frames of 57 and 101 ms on a zoom onto new data, 79 ms on a pan
 * onto new ground, 89 ms on a first-time zoom. A response is therefore queued here and drained under a per-frame
 * TIME budget; nothing in the layer does O(response) work in one task any more.
 *
 * Pure (no Leaflet, no DOM): the unit test drives it with a fake clock. The Leaflet wiring is in parcelDisplay.js.
 *
 * B137 (what you see is what you can select): a lot enters the layer's `_layers` — the ONLY thing the hit-test,
 * hover and export read — in the same step that puts it in the tile index, so a lot is selectable exactly when it is
 * drawable. A lot still waiting in the queue is simply "not there yet": a click on that ground falls to the live
 * point query, exactly as a click before the outlines arrived always did. */

/** Per-frame ingest budget (ms): ≈ a third of a 60 fps frame, leaving the rest to Leaflet, the paint step and the browser. */
export const INGEST_BUDGET_MS = 5;
/** Per-frame tile-repaint budget (ms). */
export const PAINT_BUDGET_MS = 4;

export class IngestQueue {
  /** @param {{process:(f:any)=>void, alive?:(coords:any)=>boolean, now?:()=>number}} o */
  constructor({ process, alive, now }) {
    this._process = process;
    this._alive = alive || (() => true);
    this._now = now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
    this._jobs = [];
    this._total = 0;
  }
  /** Lots queued and not yet created. */
  get pending() { return this._total; }
  push(features, coords) {
    if (!features || !features.length) return;
    this._jobs.push({ features, i: 0, coords });
    this._total += features.length;
  }
  /** Create lots until `budgetMs` is spent (the clock is read every few lots, never per lot). Returns lots created. */
  drain(budgetMs) {
    const t0 = this._now();
    let done = 0;
    while (this._jobs.length) {
      const job = this._jobs[0];
      if (!this._alive(job.coords)) { this._total -= job.features.length - job.i; this._jobs.shift(); continue; } // its cell left the view while queued
      const f = job.features;
      while (job.i < f.length) {
        this._process(f[job.i++]);
        this._total--; done++;
        if ((done & 7) === 0 && this._now() - t0 >= budgetMs) return done;
      }
      this._jobs.shift();
      if (this._now() - t0 >= budgetMs) return done;
    }
    return done;
  }
  clear() { this._jobs.length = 0; this._total = 0; }
}
