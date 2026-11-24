/* POST /api/csp-report — receives browser Content-Security-Policy violation reports (report-only soak, pen-test 2026-11-24).
 * Public by nature (the browser sends it with no credentials), so it stores nothing and trusts nothing: body capped, logged as one
 * truncated JSON line in the Pages Functions log, always answers 204. No CORS headers. */
const MAX = 4096;
export async function onRequestPost(context) {
  try {
    const text = (await context.request.text()).slice(0, MAX);
    const r = JSON.parse(text);
    const v = r["csp-report"] || (Array.isArray(r) ? (r[0] && r[0].body) : r.body) || {};
    const pick = (k) => String(v[k] || v[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] || "").slice(0, 200);
    console.log(JSON.stringify({ evt: "csp-violation", directive: pick("effective-directive") || pick("violated-directive"), blocked: pick("blocked-uri") || pick("blockedURL"), doc: pick("document-uri") || pick("documentURL"), src: pick("source-file") || pick("sourceFile"), ts: new Date().toISOString() }));
  } catch (_) { /* a malformed report is ignored */ }
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}
export const onRequest = (context) => (context.request.method === "POST" ? onRequestPost(context) : new Response(null, { status: 405, headers: { allow: "POST" } }));
