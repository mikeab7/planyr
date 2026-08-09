/* How the browser READS a baked flood archive — measured against the real host, not assumed.
 *
 * ⛔ THE FINDING THIS MODULE EXISTS FOR: CLOUDFLARE PAGES DOES NOT DO HTTP BYTE SERVING.
 * Measured 2026-08-09 against a real Pages deployment of this branch
 * (`claude-planyr-floodplain-pha.planyr.pages.dev`), with `cf-ray` and `server: cloudflare` on every
 * response:
 *
 *     GET /flood/flood-tx-harris.pmtiles   Range: bytes=0-126
 *       → HTTP 200 · content-length: 6246238 · NO accept-ranges · NO content-range
 *
 * Repeated (so it is not a cold-cache artifact), and reproduced on the 665 KB Adams archive, on
 * `manifest.json`, AND on a plain `/assets/index-*.js` bundle — so it is a property of the HOST,
 * not of these files. **The control rules out the sandbox's egress proxy:** the identical ranged
 * request through the same proxy returns `206` + `content-range` from raw.githubusercontent.com and
 * from registry.npmjs.org.
 *
 * WHY IT MATTERED ENOUGH TO BUILD THIS. `pmtiles`' own `FetchSource` REFUSES a 200-with-full-body:
 *
 *     Error: Server returned no content-length header or content-length exceeding request.
 *            Check that your storage backend supports HTTP Byte Serving.
 *
 * So the shipped layer would have thrown on its very FIRST read in production and fallen back to
 * live FEMA — correctly, silently, and permanently. And nothing would have caught it: the Vite dev
 * server DOES honour Range (verified: 206, 127 bytes), so the headless verifier, every unit test and
 * every local run stay green while the deployed feature is inert. That is the "green on a build that
 * cannot work" class this repo keeps naming.
 *
 * THE FIX IS ADAPTIVE, NOT A SWAP. The first read asks for a range like any other client:
 *   • 206 → byte serving works here; keep issuing ranged reads (a few KB per tile). Unchanged.
 *   • 200 with the whole body → the host ignored the range. KEEP that body and serve every
 *     subsequent read out of it, so the archive is fetched exactly ONCE.
 * Nothing has to know in advance which host it is talking to, a future Cloudflare that enables byte
 * serving is picked up for free, and the local dev server keeps its cheap path.
 *
 * ⛔ AND THE WHOLE-FILE PATH IS NOT A CONSOLATION PRIZE AT THIS SIZE — it is arguably the better
 * trade, which is why it is not treated as a degraded mode. The largest archive is 5.96 MiB and
 * measured 0.65 s to fetch complete from Pages; after that every tile in the county is a memory
 * slice with zero network. Static assets on Pages are UNMETERED. What it costs is one held
 * ArrayBuffer per open county (dropped by `forgetArchive`) and a slower first paint on a cold
 * cache — which is why `public/_headers` gives `/flood/*` a long, revalidated cache policy.
 *
 * Deliberately Leaflet-free so it can be unit-tested in Node with a stub `fetch`.
 */

/* Parse `content-range: bytes 0-126/6246238`. Returns null when absent or unparsable — a caller
 * must not infer "the range worked" from a header it could not read. */
const parseContentRange = (v) => {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(String(v || "").trim());
  return m ? { start: +m[1], end: +m[2], total: m[3] === "*" ? null : +m[3] } : null;
};

export class FloodArchiveSource {
  constructor(url, { fetchImpl = null } = {}) {
    this.url = url;
    this._fetch = fetchImpl || ((...a) => fetch(...a));
    this._whole = null;   // ArrayBuffer, once a host has proven it ignores Range
    this._etag = undefined;
    this._pending = null; // dedupes the concurrent first reads a cold viewport issues
  }

  getKey() { return this.url; }

  /* The `pmtiles` Source contract: resolve `{ data, etag, cacheControl, expires }`. */
  async getBytes(offset, length, signal, etag) {
    if (this._whole) return this._slice(offset, length);

    // A cold viewport asks for several tiles at once. Without this, each one would separately
    // discover the host ignores Range and separately download the whole archive.
    if (this._pending) { await this._pending; if (this._whole) return this._slice(offset, length); }

    const run = (async () => {
      const headers = new Headers();
      headers.set("range", `bytes=${offset}-${offset + length - 1}`);
      const res = await this._fetch(this.url, { signal: signal || undefined, headers });
      if (res.status >= 300) throw new Error(`flood archive: HTTP ${res.status}`);

      const cr = parseContentRange(res.headers.get("content-range"));
      const body = await res.arrayBuffer();

      /* THE DECISION, made on what came back rather than on what was asked for. A 206 with a
       * content-range is byte serving; anything else that hands back MORE than was requested is a
       * host that ignored the range, and the extra bytes are the whole archive — so keep them
       * instead of throwing them away and asking again. */
      if (res.status === 206 && cr) {
        return { data: body, etag: res.headers.get("etag") || undefined,
                 cacheControl: res.headers.get("Cache-Control") || undefined,
                 expires: res.headers.get("Expires") || undefined };
      }
      if (body.byteLength >= length) {
        this._whole = body;
        this._etag = res.headers.get("etag") || undefined;
        this._cacheControl = res.headers.get("Cache-Control") || undefined;
        this._expires = res.headers.get("Expires") || undefined;
        return this._slice(offset, length);
      }
      /* Short of what was asked for and not a 206 — the one case that is genuinely broken. Fail
       * LOUDLY; the layer's own `_die()` turns this into the live-FEMA fallback. */
      throw new Error(`flood archive: ${body.byteLength} bytes for a ${length}-byte read at ${offset}`);
    })();

    this._pending = run.catch(() => {}).then(() => { this._pending = null; });
    return run;
  }

  _slice(offset, length) {
    const end = Math.min(offset + length, this._whole.byteLength);
    if (offset >= this._whole.byteLength) throw new Error(`flood archive: read past end (${offset})`);
    return { data: this._whole.slice(offset, end), etag: this._etag,
             cacheControl: this._cacheControl, expires: this._expires };
  }

  /* Whether this source ended up holding the whole archive — read by the tests and by the layer's
   * status reporting, so "we downloaded 6 MB" is never a silent fact. */
  get wholeFileBytes() { return this._whole ? this._whole.byteLength : 0; }

  /* Drop the held archive. Called by `forgetArchive`. */
  release() { this._whole = null; this._pending = null; }
}
