/* lib/parcelWideEngine.js — NEW-1 (Select parcels, wide view): WHEN tile requests go out, and when they do not.
 *
 * Pure scheduling, no Leaflet, no network, no real clock: `fetchTile` and the timers are injected, so the unit test
 * (test/parcelWideEngine.test.js) drives every rule deterministically. The rules are the county-server-load contract the owner asked for:
 *   · NOTHING goes out while the view is moving — `setView` only arms a debounce; requests start `debounceMs` after the last change;
 *   · a tile that has LEFT the view is aborted (its fetch is cancelled, not just ignored);
 *   · at most `maxConcurrent` requests are in flight per host (one engine = one source = one host);
 *   · a 429 / 503 / 5xx / network failure backs the host off exponentially (2 s → 4 s → 8 s → 16 s); the tile is retried after the
 *     back-off, and after `maxAttempts` it is parked until the view next changes — and `onState({ busy:true })` says so, so the map shows
 *     a hint instead of a silently blank patch;
 *   · a tile whose answer hit the server's record cap (`exceeded`) is asked again with a bigger size cutoff (tier+1, up to MAX_TIER),
 *     the first (partial) answer staying drawn until the tighter one lands;
 *   · a tile already loaded is never re-requested (a pan re-uses it); the oldest are evicted past `maxTiles`.
 * A non-transient failure (a 400, an ArcGIS error body) is not retried: it is reported through `onState({ error })` once. */
import { MAX_TIER } from "./parcelWideRequest.js";

export const BACKOFF_MS = [2000, 4000, 8000, 16000];

export class WideTileEngine {
  constructor({ fetchTile, onTile, onState, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (h) => clearTimeout(h), now = () => Date.now(),
    debounceMs = 250, maxConcurrent = 3, maxTiles = 64, backoffMs = BACKOFF_MS, maxAttempts = 4 } = {}) {
    this.fetchTile = fetchTile; this.onTile = onTile || (() => {}); this.onState = onState || (() => {});
    // the DEFAULT timers are wrapped on purpose: a bare `setTimeout` stored on `this` and called as `this.setTimer(…)` throws "Illegal invocation" in a browser
    this.setTimer = (fn, ms) => setTimer(fn, ms); this.clearTimer = (h) => clearTimer(h); this.now = now;
    this.debounceMs = debounceMs; this.maxConcurrent = maxConcurrent; this.maxTiles = maxTiles; this.backoffMs = backoffMs; this.maxAttempts = maxAttempts;
    this.loaded = new Map(); // key -> { tile, features, tier, capped }
    this.inflight = new Map(); // key -> { handle, tile, tier, attempt }
    this.retry = new Map(); // key -> { tile, tier, attempt, at }
    this.dead = new Map(); // key -> message — permanent for this view's config (non-transient failure)
    this.parked = new Set(); // keys that ran out of attempts; cleared by the next setView
    this.want = []; // tiles of the current view, nearest the centre first
    this.wantKeys = new Set();
    this.failures = 0;
    this.blockedUntil = 0;
    this.debounce = null; this.wake = null;
    this.state = { loading: 0, busy: false, error: null };
    this.stats = { requests: 0, aborted: 0, retried: 0, tierUps: 0 };
  }

  /** The view moved / zoomed / changed stage. `view` = { tiles:[{key,…}] } or null (the tool left the stage: cancel everything NOW). */
  setView(view) {
    if (this.debounce) { this.clearTimer(this.debounce); this.debounce = null; }
    if (!view || !view.tiles || !view.tiles.length) { this._apply([]); return; }
    this.debounce = this.setTimer(() => { this.debounce = null; this._apply(view.tiles); }, this.debounceMs);
  }

  stop() {
    if (this.debounce) { this.clearTimer(this.debounce); this.debounce = null; }
    if (this.wake) { this.clearTimer(this.wake); this.wake = null; }
    this._apply([]);
  }

  _apply(tiles) {
    this.want = tiles;
    this.wantKeys = new Set(tiles.map((t) => t.key));
    this.parked.clear(); // moving the view is the user asking again
    for (const [key, job] of [...this.inflight]) {
      if (this.wantKeys.has(key)) continue;
      this.inflight.delete(key);
      this.stats.aborted++;
      try { job.handle && job.handle.abort && job.handle.abort(); } catch (_) { /* already gone */ }
    }
    for (const key of [...this.retry.keys()]) if (!this.wantKeys.has(key)) this.retry.delete(key);
    this._pump();
    this._emitState();
  }

  _backoff() {
    // requests that were already in flight when the host started refusing all fail at once: that is ONE event, not three, so it must not jump the back-off to 8 s
    if (this.now() < this.blockedUntil) return;
    this.failures++;
    this.blockedUntil = this.now() + this.backoffMs[Math.min(this.failures, this.backoffMs.length) - 1];
  }

  _pump() {
    if (this.wake) { this.clearTimer(this.wake); this.wake = null; }
    const t = this.now();
    if (t < this.blockedUntil) { this.wake = this.setTimer(() => { this.wake = null; this._pump(); }, this.blockedUntil - t); return; }
    let nextRetryAt = Infinity;
    for (const tile of this.want) {
      if (this.inflight.size >= this.maxConcurrent) break;
      const key = tile.key;
      if (this.inflight.has(key) || this.dead.has(key) || this.parked.has(key)) continue;
      const have = this.loaded.get(key);
      const r = this.retry.get(key);
      if (have && !(r && r.tier > have.tier)) continue; // loaded, and no tighter re-ask pending
      if (r && r.at > t) { nextRetryAt = Math.min(nextRetryAt, r.at); continue; }
      this._start(tile, r ? r.tier : 0, r ? r.attempt : 0);
    }
    if (nextRetryAt < Infinity) this.wake = this.setTimer(() => { this.wake = null; this._pump(); }, nextRetryAt - t);
  }

  _start(tile, tier, attempt) {
    const key = tile.key;
    this.retry.delete(key);
    const job = { handle: null, tile, tier, attempt };
    this.inflight.set(key, job);
    this.stats.requests++;
    let done = false;
    const cb = (res) => {
      if (done || this.inflight.get(key) !== job) return; // aborted / superseded
      done = true;
      this.inflight.delete(key);
      this._result(tile, tier, attempt, res);
    };
    try { job.handle = this.fetchTile({ tile, tier }, cb); } catch (e) { cb({ ok: false, transient: false, message: (e && e.message) || "request failed" }); }
    this._emitState();
  }

  _result(tile, tier, attempt, res) {
    const key = tile.key;
    if (res && res.ok) {
      this.failures = 0; // the host is answering again; a back-off already running still runs out (an in-flight success is not permission to resume at full rate)
      const capped = !!res.exceeded && tier >= MAX_TIER;
      this.loaded.delete(key); // refresh LRU position
      this.loaded.set(key, { tile, features: res.features || [], tier, capped });
      this.onTile(key, this.loaded.get(key));
      if (res.exceeded && tier < MAX_TIER) { this.retry.set(key, { tile, tier: tier + 1, attempt: 0, at: 0 }); this.stats.tierUps++; }
      this._evict();
    } else if (res && res.transient) {
      this._backoff();
      if (attempt + 1 >= this.maxAttempts) this.parked.add(key);
      else { this.retry.set(key, { tile, tier, attempt: attempt + 1, at: this.blockedUntil }); this.stats.retried++; }
    } else {
      this.dead.set(key, (res && res.message) || "the parcel server refused the request");
    }
    this._pump();
    this._emitState();
  }

  _evict() {
    while (this.loaded.size > this.maxTiles) {
      let victim = null;
      for (const key of this.loaded.keys()) if (!this.wantKeys.has(key)) { victim = key; break; }
      if (victim === null) return;
      this.loaded.delete(victim);
      this.onTile(victim, null);
    }
  }

  _emitState() {
    let queued = 0;
    for (const tile of this.want) {
      const key = tile.key;
      if (this.inflight.has(key) || this.dead.has(key) || this.parked.has(key)) continue;
      const have = this.loaded.get(key), r = this.retry.get(key);
      if (!have || r) queued++;
    }
    const busy = this.parked.size > 0 || this.failures > 0;
    const error = this.dead.size ? [...this.dead.values()][0] : null;
    const next = { loading: this.inflight.size + queued, busy, error };
    const p = this.state;
    if (p.loading === next.loading && p.busy === next.busy && p.error === next.error) return;
    this.state = next;
    this.onState(next);
  }
}
