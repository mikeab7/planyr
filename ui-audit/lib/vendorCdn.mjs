// The Sequence/Schedule app (public/sequence/index.html) is a standalone page that pulls
// Babel-standalone and supabase-js from public CDNs at runtime. In this sandbox the BROWSER
// has no egress — every one of those requests dies with ERR_CONNECTION_RESET — so the page renders
// a completely EMPTY body. That failure is silent in the worst way: `document.body.textContent` still
// returns the text of the inline <script> blocks, so a naive probe reads app copy off a page that never
// rendered a single row and reports a confident pass. Node CAN reach the CDNs (it honours HTTPS_PROXY),
// so we fetch each asset ONCE into a gitignored cache and rewrite the page to load them from the local
// test server.
//
// React/ReactDOM used to be on this list too — they were removed from this SOURCE page's runtime CDN
// pulls entirely (B1167200): the page now loads them from a locally vendored, checked-in copy
// (public/sequence/vendor/react*.production.min.js), served like any other public/ asset by every
// harness's fallback static handler. Nothing to fetch-and-rewrite for them any more.
//
// Nothing here changes what the app is: same bytes, same versions, same execution order — only the
// origin they arrive from. Harnesses that skip this are not testing the Schedule module, they are
// testing a blank page.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../.vendor/", import.meta.url).pathname;

// url → local basename. Matched against the page source as a literal substring.
// Empty since audit batches A and J3: supabase-js is vendored (public/sequence/vendor/supabase.js) and the page no
// longer loads Babel, so the page pulls nothing from a CDN. Kept (with its callers) so a future CDN asset has a home.
export const CDN_ASSETS = {};
// The icon webfont stylesheet is decorative — dropped rather than vendored, so a font CDN outage can
// never fail a scheduling assertion.
const DROP = ["https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css"];

/** Fetch-and-cache every CDN asset. Throws loudly if one can't be had — a harness must not quietly
 *  proceed to measure a page that will not render. */
export async function ensureVendored() {
  await mkdir(DIR, { recursive: true });
  for (const [url, name] of Object.entries(CDN_ASSETS)) {
    const fp = join(DIR, name);
    if (existsSync(fp)) continue;
    const r = await fetch(url, { redirect: "follow" });
    if (!r.ok) throw new Error(`vendorCdn: ${url} → HTTP ${r.status}. The browser cannot reach it either; a harness run now would measure an EMPTY page.`);
    await writeFile(fp, Buffer.from(await r.arrayBuffer()));
  }
  return DIR;
}

/** Rewrite a page's CDN URLs to `${prefix}<name>` (served by the harness's own server). */
export function rewriteCdn(html, prefix = "/__vendor/") {
  let out = String(html);
  for (const [url, name] of Object.entries(CDN_ASSETS)) out = out.split(url).join(prefix + name);
  for (const url of DROP) out = out.split(url).join("about:blank");
  return out;
}

/** Serve a vendored file if the request is for one. Returns true when it handled the response. */
export async function serveVendored(req, res, prefix = "/__vendor/") {
  const p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith(prefix)) return false;
  const name = p.slice(prefix.length);
  if (!Object.values(CDN_ASSETS).includes(name)) { res.writeHead(404); res.end(); return true; }
  res.writeHead(200, { "Content-Type": name.endsWith(".css") ? "text/css" : "text/javascript" });
  res.end(await readFile(join(DIR, name)));
  return true;
}
