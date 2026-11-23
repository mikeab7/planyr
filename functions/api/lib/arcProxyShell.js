/* The shared HTTP shell for the three "ArcGIS-REST-shaped front" proxies (/gc, /mg, /okparcels — audit batch I7).
 * Each proxy keeps ONLY what differs (its pure adapter: path parsing, query translation, upstream URL, result
 * shaping, its plain-English error sentences); everything the three used to copy — method gate, path segments,
 * GET/POST params, the upstream timeout + optional single retry, the bad-query-is-HTTP-200 convention, and the
 * LOUD-FAILURE 502s — lives here. Not routed (no onRequest* export). */

const USER_AGENT = "planyr-gis-proxy";

const jsonCached = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

/* spec: {
 *   arcError(code, message)            — the adapter's ArcGIS error body
 *   parsePath(segs)                    — { error } | { op: "meta"|"query", ...ctx }
 *   metadata(parsed)                   — static layer metadata body
 *   translate(params, parsed)          — adapter query object (throws { mgBadRequest } on a bad query)
 *   upstreamUrl(parsed, q)             — the one URL to fetch
 *   toArc(gj, q, parsed)               — GeoJSON → ArcGIS query body
 *   timeoutMs, retry? { pauseMs }      — a 5xx or timeout earns ONE more try when set
 *   messages: { status(parsed, res), unreadable(parsed), unexpected?(parsed), failed(parsed) }
 *   validate?(gj)                      — true when the parsed answer has the expected shape (else messages.unexpected)
 * } */
export function makeArcProxy(spec) {
  const { arcError } = spec;

  async function once(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), spec.timeoutMs);
    try { return await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  }
  async function upstream(url) {
    if (!spec.retry) return once(url);
    let last = null;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await once(url);
        if (res.status < 500) return res;
        last = res;
      } catch (_e) { last = null; }
      if (i === 0) await new Promise((r) => setTimeout(r, spec.retry.pauseMs));
    }
    return last;
  }

  return async function onRequest(context) {
    const { request } = context;
    const method = request.method;
    if (method !== "GET" && method !== "POST") return jsonCached(arcError(405, "method not allowed"), 405);

    const p = context.params && context.params.path;
    const segs = (Array.isArray(p) ? p : String(p || "").split("/")).filter(Boolean);
    const parsed = spec.parsePath(segs);
    if (parsed.error) return jsonCached(arcError(404, parsed.error), 404);

    const params = Object.fromEntries(new URL(request.url).searchParams);
    if (method === "POST") {
      try { for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v; } catch (_) { return jsonCached(arcError(400, "unreadable request body"), 400); }
    }

    try {
      if (parsed.op === "meta") return jsonCached(spec.metadata(parsed), 200, "public, max-age=3600"); // static layer metadata

      let q;
      try { q = spec.translate(params, parsed); } catch (e) {
        if (e && e.mgBadRequest) return jsonCached(arcError(400, e.message), 200); // ArcGIS reports a bad query as HTTP 200 + {error}
        throw e;
      }
      const res = await upstream(spec.upstreamUrl(parsed, q));
      if (!res || !res.ok) return jsonCached(arcError(502, spec.messages.status(parsed, res)), 502);
      let gj;
      try { gj = JSON.parse(await res.text()); } catch (_) { return jsonCached(arcError(502, spec.messages.unreadable(parsed)), 502); }
      if (spec.validate && !spec.validate(gj)) return jsonCached(arcError(502, spec.messages.unexpected(parsed)), 502);
      return jsonCached(spec.toArc(gj, q, parsed), 200, "public, max-age=300");
    } catch (_e) {
      return jsonCached(arcError(502, spec.messages.failed(parsed)), 502);
    }
  };
}
