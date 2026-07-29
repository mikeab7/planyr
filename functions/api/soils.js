/* /api/soils — same-origin proxy for the USDA NRCS Soil Data Access (SDA) tabular endpoint.
 *
 * Cloudflare Pages Function, mirroring functions/api/pfds.js. `lib/soils.js` has always pointed
 * its `proxy:true` path here (SDA_PROXY_PATH = "/api/soils"), but the Function did not exist, so
 * the soil hydrologic group (HSG) was unreachable from the browser and every consumer that needed
 * a runoff curve number had to report an honest UNKNOWN. This relays the query same-origin.
 *
 *   POST /api/soils   { format: "JSON+COLUMNNAME", query: "SELECT … " }   → SDA's JSON body
 *
 * No secret involved — SDA is a public, unauthenticated service. The relay is deliberately NOT a
 * general-purpose SQL pass-through: the body must be a single SELECT of the shape lib/soils.js
 * builds (no semicolons, no DDL/DML verbs, bounded length), so this endpoint can only ever ask
 * SDA the question it exists to ask.
 *
 * Screening data — a soils reference for a screening runoff calc, never a geotechnical
 * determination. LOUD-FAILURE: an upstream outage returns a 502 with the reason, never an empty
 * body that would parse as "no coverage".
 */
const SDA_ENDPOINT = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";
const MAX_QUERY_CHARS = 2000;
// Anything that could mutate or chain. SDA is read-only to the public, but a relay that forwards
// arbitrary text is a relay someone will eventually point somewhere else.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|exec|execute|merge|grant|revoke)\b|;|--|\/\*/i;

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });

function sameOriginOk(origin, host) {
  if (!origin) return true; // same-origin POSTs from fetch() omit Origin in some browsers
  try { return new URL(origin).host === host; } catch (_) { return false; }
}

export async function onRequestPost(context) {
  const { request } = context;
  const url = new URL(request.url);
  if (!sameOriginOk(request.headers.get("Origin"), url.host)) return json({ error: "forbidden" }, 403);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: "body must be JSON" }, 400); }
  const query = body && typeof body.query === "string" ? body.query.trim() : "";
  const format = body && typeof body.format === "string" ? body.format : "JSON+COLUMNNAME";
  if (!query) return json({ error: "missing query" }, 400);
  if (query.length > MAX_QUERY_CHARS) return json({ error: "query too long" }, 400);
  if (!/^select\s/i.test(query)) return json({ error: "only SELECT queries are relayed" }, 400);
  if (FORBIDDEN.test(query)) return json({ error: "query rejected" }, 400);

  let upstreamRes;
  try {
    upstreamRes = await fetch(SDA_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "planyr-soils-proxy" },
      body: JSON.stringify({ format, query }),
    });
  } catch (e) {
    return json({ error: `SDA upstream fetch failed: ${e && e.message ? e.message : e}` }, 502);
  }
  if (!upstreamRes.ok) return json({ error: `SDA upstream HTTP ${upstreamRes.status}` }, 502);

  const text = await upstreamRes.text();
  // Soils at a point are effectively static — cache hard so a re-check is free.
  return new Response(text, {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
