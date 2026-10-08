/* TEMPORARY (B2158064 NEW-2 discovery) — reports what a public CAD data host answers from
 * Cloudflare's network, because the build sandbox's egress policy blocks them. Allow-listed
 * hosts only, ranged GET of the first bytes, read-only. Deleted once the real source is wired. */
const HOSTS = /^(www\.)?(hcad\.org|pdata\.hcad\.org|download\.hcad\.org|hctax\.net|fbcad\.org|search\.fbcad\.org|galvestoncad\.org|gcad\.org|mcad-tx\.org|esearch\.mcad-tx\.org|comptroller\.texas\.gov|tax\.fortbendcountytx\.gov|fortbendcountytx\.gov|data\.texas\.gov|gis\.hctx\.net|services\.arcgis\.com|services1\.arcgis\.com|services2\.arcgis\.com|services3\.arcgis\.com|services5\.arcgis\.com|services6\.arcgis\.com|services7\.arcgis\.com|services8\.arcgis\.com|services9\.arcgis\.com)$/i;

export async function onRequestGet({ request }) {
  const u = new URL(request.url);
  if (request.headers.get("Origin") && new URL(request.headers.get("Origin")).host !== u.host) return new Response("forbidden", { status: 403 });
  const targets = u.searchParams.getAll("u");
  const out = [];
  for (const t of targets.slice(0, 12)) {
    let r;
    try {
      const tu = new URL(t);
      if (tu.protocol !== "https:" || !HOSTS.test(tu.hostname)) { out.push({ url: t, error: "host not allow-listed" }); continue; }
      const res = await fetch(tu.toString(), { headers: { range: "bytes=0-3999", "user-agent": "Mozilla/5.0 (compatible; planyr-probe)" }, redirect: "manual" });
      const buf = new Uint8Array(await res.arrayBuffer());
      const ct = res.headers.get("content-type") || "";
      const textish = /text|json|xml|html|csv/i.test(ct);
      r = { url: t, status: res.status, ct, len: res.headers.get("content-length"), range: res.headers.get("content-range"), loc: res.headers.get("location"), server: res.headers.get("server"), cfmit: res.headers.get("cf-mitigated"),
        head: textish ? new TextDecoder().decode(buf.slice(0, 1500)) : `binary ${buf.length}b magic ${Array.from(buf.slice(0, 4)).map((b) => b.toString(16)).join("")}` };
    } catch (e) { r = { url: t, error: String(e && e.message || e) }; }
    out.push(r);
  }
  return new Response(JSON.stringify(out, null, 1), { headers: { "content-type": "application/json" } });
}
