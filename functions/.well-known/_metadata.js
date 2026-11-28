/* Shared reply for the OAuth discovery documents (not routed). Public, cacheable for a short while, any origin. */
export function metadataReply(request, body) {
  const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...headers, "access-control-allow-methods": "GET, OPTIONS" } });
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD, OPTIONS" } });
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), { status: 200, headers });
}
